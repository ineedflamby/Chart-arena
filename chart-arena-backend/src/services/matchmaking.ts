import { randomBytes } from 'crypto';
import { config } from '../config.js';
import { contractService } from './contract.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/database.js';
import { createGame, type GameInstance, removeGame } from '../game/game-loop.js';
import { hasGhostTrade } from '../game/items.js';
import type { MatchLog, MatchSummary } from '../game/types.js';
import { settleMatch, runPostSettlementWork } from './settlement.js';
import { getBotAddresses, startBotTrading, stopBotTrading, isBotAddress } from './bot.js';
import { sendToSocket, sendToPlayer, broadcastToMatch, broadcastToMatchExcept, assignToMatch, broadcastToAll, type GameSocket } from '../ws/server.js';
import {
    ServerMsg, maxPlayers, type FormatValue,
    STARTING_CAPITAL,
} from '../utils/constants.js';
import { postAnnouncement, cleanupGameRoom } from '../services/chat.js';

const TAG = 'Matchmaking';

function uint8ToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface QueueEntry {
    readonly address: string;
    readonly buyIn: bigint;
    readonly mode: number;
    readonly format: number;
    readonly ws: GameSocket;
    readonly joinedAt: number;
}

const queue = new Map<string, QueueEntry[]>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
const searchTimers = new Map<string, ReturnType<typeof setInterval>>();
const autoDequeueTimers = new Map<string, ReturnType<typeof setTimeout>>();

const SEARCH_HEARTBEAT_MS = 15_000;  // "Still searching..." every 15s
const AUTO_DEQUEUE_MS = 120_000;     // Auto-dequeue after 2 minutes

function queueKey(buyIn: bigint, mode: number, format: number): string {
    return `${buyIn}-${mode}-${format}`;
}

export function queuePlayer(
    address: string, buyIn: bigint, mode: number, format: number, ws: GameSocket,
): void {
    const key = queueKey(buyIn, mode, format);
    if (!queue.has(key)) queue.set(key, []);
    const entries = queue.get(key)!;

    if (entries.some((e) => e.address === address)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Already in queue' }); return;
    }

    entries.push({ address, buyIn, mode, format, ws, joinedAt: Date.now() });
    sendToSocket(ws, ServerMsg.LOBBY_UPDATE, {
        action: 'queued', position: entries.length, needed: maxPlayers(format as FormatValue),
    });
    logger.info(TAG, `${address} queued [${key}] (${entries.length}/${maxPlayers(format as FormatValue)})`);

    const needed = maxPlayers(format as FormatValue);
    if (entries.length >= needed) {
        const matched = entries.splice(0, needed);
        // Cleanup search/dequeue timers for this queue key
        const hb = searchTimers.get(key);
        if (hb) { clearInterval(hb); searchTimers.delete(key); }
        const adt = autoDequeueTimers.get(key);
        if (adt) { clearTimeout(adt); autoDequeueTimers.delete(key); }
        if (entries.length === 0) queue.delete(key);
        launchMatch(matched, buyIn, mode, format as FormatValue);
        return;
    }

    // DEV_MODE: bots fill remaining slots after delay
    if (config.devMode && entries.length === 1) {
        logger.info(TAG, `DEV_MODE: Bots will join in ${config.devBotDelayMs}ms (format=${format})`);
        const timer = setTimeout(() => {
            const currentEntries = queue.get(key);
            if (currentEntries && currentEntries.length >= 1) {
                const matched = currentEntries.splice(0, currentEntries.length);
                launchMatch(matched, buyIn, mode, format as FormatValue, true);
            }
            botTimers.delete(key);
        }, config.devBotDelayMs);
        botTimers.set(key, timer);
    }

    // ── Search heartbeat: send "searching..." messages every 15s ──
    if (!searchTimers.has(key)) {
        let elapsed = 0;
        const heartbeat = setInterval(() => {
            elapsed += SEARCH_HEARTBEAT_MS / 1000;
            const currentEntries = queue.get(key);
            if (!currentEntries || currentEntries.length === 0) {
                clearInterval(heartbeat);
                searchTimers.delete(key);
                return;
            }
            for (const p of currentEntries) {
                sendToSocket(p.ws, ServerMsg.LOBBY_UPDATE, {
                    action: 'searching',
                    message: `Still searching for opponents... (${Math.floor(elapsed)}s)`,
                });
            }
        }, SEARCH_HEARTBEAT_MS);
        searchTimers.set(key, heartbeat);
    }

    // ── Auto-dequeue: kick players after 2 minutes to prevent stale queues ──
    // Reset per-player: only the latest joiner's timer matters for the whole key
    const existingAutoDequeue = autoDequeueTimers.get(key);
    if (existingAutoDequeue) clearTimeout(existingAutoDequeue);
    const dequeueTimer = setTimeout(() => {
        const currentEntries = queue.get(key);
        if (!currentEntries || currentEntries.length === 0) {
            autoDequeueTimers.delete(key);
            return;
        }
        // Dequeue all remaining players in this key
        for (const p of [...currentEntries]) {
            sendToSocket(p.ws, ServerMsg.LOBBY_UPDATE, {
                action: 'queue_timeout',
                message: 'No opponents found — returning to lobby.',
            });
            logger.info(TAG, `Auto-dequeue (timeout): ${p.address} from [${key}]`);
        }
        currentEntries.length = 0;
        queue.delete(key);
        // Cleanup search heartbeat
        const hb = searchTimers.get(key);
        if (hb) { clearInterval(hb); searchTimers.delete(key); }
        autoDequeueTimers.delete(key);
    }, AUTO_DEQUEUE_MS);
    autoDequeueTimers.set(key, dequeueTimer);
}

export function dequeuePlayer(address: string): void {
    for (const [key, entries] of queue) {
        const idx = entries.findIndex((e) => e.address === address);
        if (idx !== -1) {
            entries.splice(idx, 1);
            if (entries.length === 0) {
                queue.delete(key);
                const timer = botTimers.get(key);
                if (timer) { clearTimeout(timer); botTimers.delete(key); }
                // Cleanup search + auto-dequeue timers
                const hb = searchTimers.get(key);
                if (hb) { clearInterval(hb); searchTimers.delete(key); }
                const adt = autoDequeueTimers.get(key);
                if (adt) { clearTimeout(adt); autoDequeueTimers.delete(key); }
            }
            logger.info(TAG, `${address} dequeued from [${key}]`);
            return;
        }
    }
}

function launchMatch(
    humanPlayers: QueueEntry[], buyIn: bigint, mode: number, format: FormatValue,
    withBot = false,
): void {
    if (config.devMode) {
        startDevMatch(humanPlayers, buyIn, mode, format, withBot).catch((err) => {
            logger.error(TAG, 'Dev match failed', err);
            for (const p of humanPlayers)
                sendToSocket(p.ws, ServerMsg.ERROR, { message: 'Match failed: ' + String(err) });
        });
    } else {
        startProductionMatch(humanPlayers, buyIn, mode, format).catch((err) => {
            logger.error(TAG, 'Match flow failed', err);
            for (const p of humanPlayers)
                sendToSocket(p.ws, ServerMsg.ERROR, { message: 'Match creation failed' });
        });
    }
}

// ── DEV MODE ──

async function startDevMatch(
    humanPlayers: QueueEntry[], buyIn: bigint, mode: number, format: FormatValue,
    withBot: boolean,
): Promise<void> {
    const matchIdBytes = randomBytes(8);
    const matchId = BigInt('0x' + uint8ToHex(matchIdBytes));
    const seedBytes = randomBytes(32);
    const seed = BigInt('0x' + uint8ToHex(seedBytes));

    const playerAddresses = humanPlayers.map((p) => p.address);

    // Sprint 1: Fill remaining slots with bots (1 for Duel, up to 4 for Arena)
    const botAddresses: string[] = [];
    if (withBot) {
        const needed = maxPlayers(format);
        const botsNeeded = needed - playerAddresses.length;
        const bots = getBotAddresses(botsNeeded);
        botAddresses.push(...bots);
        playerAddresses.push(...bots);
    }

    logger.info(TAG, `DEV MATCH ${matchId} (${format === 0 ? 'Duel' : 'Arena'}, mode=${mode}): ${playerAddresses.length} players [${humanPlayers.length} human, ${botAddresses.length} bot]`);

    for (const p of humanPlayers) {
        sendToSocket(p.ws, ServerMsg.MATCH_CREATED, {
            buyIn: buyIn.toString(), mode, format,
            players: playerAddresses,
            message: 'DEV MODE: Match starting (no on-chain tx needed)',
        });
    }

    await sleep(1000);

    const devTotalTicks = config.roundsDuel * config.devRoundSeconds;
    const game = createGame(matchId, seed, mode, format, buyIn, playerAddresses, devTotalTicks);

    for (const p of humanPlayers) assignToMatch(p.ws, matchId);
    wireGameCallbacks(game, matchId);

    broadcastToMatch(matchId, ServerMsg.GAME_START, {
        matchId: matchId.toString(),
        totalTicks: game.totalMatchTicks,
        startingCapital: STARTING_CAPITAL,
        buyIn: buyIn.toString(),
        mode,
        format,
        players: playerAddresses,
        devMode: true,
    });

    // Send display names for all players in match
    const nameMap = db.getDisplayNames(playerAddresses);
    const displayNames: Record<string, string> = {};
    for (const addr of playerAddresses) {
        displayNames[addr] = nameMap.get(addr) ?? addr.slice(0, 8) + '…';
    }
    broadcastToMatch(matchId, ServerMsg.DISPLAY_NAMES, { names: displayNames });

    game.start();
    if (botAddresses.length > 0) startBotTrading(matchId, botAddresses);

    // Announce match start
    const modeNames = ['Classic', 'Survival', 'Chaos'];
    const formatName = format === 0 ? 'Duel' : 'Arena';
    const announcement = postAnnouncement(
        `⚔️ ${formatName} ${modeNames[mode] ?? 'Classic'} match started! ${playerAddresses.length} players competing.`
    );
    broadcastToAll(ServerMsg.CHAT_MESSAGE, { ...announcement });
}

// ── PRODUCTION ──

const pendingMatchResolvers = new Map<string, (matchId: bigint | null) => void>();
const pendingMatchBuyIns = new Map<string, bigint>(); // key → buyIn for match_join_ready

export function reportMatchId(playerAddress: string, matchId: bigint): void {
    // v5: No longer needed — operator creates matches directly.
    // Kept as no-op because handlers.ts still routes this message.
    logger.info(TAG, `reportMatchId (v5 no-op): ${playerAddress} reported matchId=${matchId}`);
}

async function startProductionMatch(
    players: QueueEntry[], buyIn: bigint, mode: number, format: FormatValue,
): Promise<void> {
    logger.info(TAG, `Match flow (v5 operator): ${players.map((p) => p.address).join(', ')}`);

    // Notify players that a match was found — backend is creating it on-chain
    for (const p of players) {
        sendToSocket(p.ws, ServerMsg.MATCH_CREATED, {
            buyIn: buyIn.toString(), mode, format,
            players: players.map((pl) => pl.address),
            message: 'Match found! Creating match on-chain...',
        });
    }

    // v5 + SPRINT 2 FIX: Check escrow balances using OFF-CHAIN ledger (instant, no block wait)
    // Falls back to on-chain check if player has no ledger entries (pre-ledger deposits)
    for (const p of players) {
        try {
            const offchainBalance = db.getOffchainEscrowBalance(p.address);
            const hasLedgerEntries = offchainBalance !== 0n || db.getEscrowLedger(p.address, 1).length > 0;
            let balance: bigint;

            if (hasLedgerEntries) {
                balance = offchainBalance;
                logger.info(TAG, `Balance check (offchain ledger): ${p.address.slice(0,12)}… = ${balance}`);
            } else {
                // No ledger entries — this player deposited before Sprint 2. Fall back to on-chain.
                balance = await contractService.getPlayerBalance(p.address);
                logger.info(TAG, `Balance check (on-chain fallback): ${p.address.slice(0,12)}… = ${balance}`);
            }

            if (balance < buyIn) {
                const needed = Number(buyIn - balance) / 1e18;
                logger.warn(TAG, `Player ${p.address} has insufficient escrow balance: ${balance} < ${buyIn}`);
                sendToSocket(p.ws, ServerMsg.ERROR, {
                    message: `Insufficient escrow balance. Please deposit at least ${needed.toFixed(0)} more MOTO.`,
                    action: 'deposit_required',
                });
                for (const other of players) {
                    if (other !== p) {
                        sendToSocket(other.ws, ServerMsg.ERROR, {
                            message: 'Opponent has insufficient escrow balance. Returning to lobby.',
                        });
                    }
                }
                return;
            }
        } catch (err) {
            logger.error(TAG, `Failed to check balance for ${p.address}`, err);
            for (const pl of players) sendToSocket(pl.ws, ServerMsg.ERROR, { message: 'Balance check failed. Please try again.' });
            return;
        }
    }

    // v5: Operator creates match directly — straight to LOCKED, 1 TX
    let matchId: bigint;
    try {
        logger.info(TAG, `Operator creating match: buyIn=${buyIn}, mode=${mode}, format=${format}`);
        const result = await contractService.operatorCreateMatch(
            buyIn, mode, format, players[0].address, players[1].address,
        );
        matchId = result.matchId;
        logger.info(TAG, `Match ${matchId} created on-chain (TX: ${result.txHash}). Waiting for confirmation...`);

        // SPRINT 2: Record debit in off-chain ledger (instant — don't wait for block)
        const matchIdStr = matchId.toString();
        for (const p of players) {
            db.recordEscrowChange(p.address, (-buyIn).toString(), 'match_debit', matchIdStr, result.txHash);
        }
        logger.info(TAG, `Off-chain ledger: debited ${Number(buyIn) / 1e18} MOTO from ${players.length} players for match ${matchId}`);
    } catch (err) {
        logger.error(TAG, `operatorCreateMatch failed`, err);
        for (const p of players) sendToSocket(p.ws, ServerMsg.ERROR, {
            message: `Match creation failed: ${String(err).slice(0, 100)}`,
        });
        return;
    }

    // Wait for the TX to be mined (poll getMatchInfo until LOCKED)
    const locked = await waitForMatchLocked(matchId, players);
    if (!locked) {
        for (const p of players) sendToSocket(p.ws, ServerMsg.ERROR, {
            message: `Match ${matchId} did not confirm in time. Please try again.`,
            matchId: matchId.toString(),
        });
        return;
    }

    const info = await contractService.getMatchInfo(matchId);
    // H-04: Include server secret so seed can't be predicted from on-chain data
    const seedInput = `${matchId}:${info.lockBlock}:${config.seedSecret}`;
    const seedBytes = new TextEncoder().encode(seedInput);
    const hashBuffer = await crypto.subtle.digest('SHA-256', seedBytes);
    const seed = BigInt('0x' + uint8ToHex(new Uint8Array(hashBuffer)));

    const playerAddresses = players.map((p) => p.address);
    const game = createGame(matchId, seed, mode, format, buyIn, playerAddresses);

    for (const p of players) assignToMatch(p.ws, matchId);
    wireGameCallbacks(game, matchId);

    broadcastToMatch(matchId, ServerMsg.GAME_START, {
        matchId: matchId.toString(),
        totalTicks: game.totalMatchTicks,
        startingCapital: STARTING_CAPITAL,
        buyIn: buyIn.toString(),
        mode,
        format,
        players: playerAddresses,
    });

    // Send display names for all players in match
    const nameMap = db.getDisplayNames(playerAddresses);
    const displayNames: Record<string, string> = {};
    for (const addr of playerAddresses) {
        displayNames[addr] = nameMap.get(addr) ?? addr.slice(0, 8) + '…';
    }
    broadcastToMatch(matchId, ServerMsg.DISPLAY_NAMES, { names: displayNames });

    game.start();
}

function waitForMatchId(players: QueueEntry[]): Promise<bigint | null> {
    const key = players.map((p) => p.address).join(',');
    // Store buyIn so reportMatchId can include it in match_join_ready
    pendingMatchBuyIns.set(key, players[0].buyIn);
    return new Promise<bigint | null>((resolve) => {
        // Bug 6.2: Send periodic "waiting..." messages so players know it's not stuck
        let elapsed = 0;
        const progressInterval = setInterval(() => {
            elapsed += 30;
            for (const p of players) {
                sendToSocket(p.ws, ServerMsg.LOBBY_UPDATE, {
                    action: 'waiting_for_match_id',
                    message: `Waiting for on-chain match creation... (${elapsed}s elapsed)`,
                    elapsedSec: elapsed,
                });
            }
        }, 30000);

        const timer = setTimeout(() => {
            clearInterval(progressInterval);
            pendingMatchResolvers.delete(key);
            pendingMatchBuyIns.delete(key);
            resolve(null);
        }, 600000);

        pendingMatchResolvers.set(key, (id) => {
            clearInterval(progressInterval);
            clearTimeout(timer);
            resolve(id);
        });
    });
}

async function waitForMatchLocked(matchId: bigint, players?: QueueEntry[]): Promise<boolean> {
    // PERF: Poll every 10s — both TXs may land in 1-2 blocks, need fast detection
    const POLL_INTERVAL_MS = 10_000;
    const MAX_POLLS = 60; // 10s × 60 = 10min max

    // Get starting block for progress tracking
    let startBlock = 0;
    try { startBlock = Number(await contractService.getBlockNumber()); } catch { /* ignore */ }

    for (let i = 0; i < MAX_POLLS; i++) {
        try {
            const info = await contractService.getMatchInfo(matchId);
            if (info.status === 2n) {
                // Send 100% progress before returning
                if (players) {
                    let currentBlock = startBlock;
                    try { currentBlock = Number(await contractService.getBlockNumber()); } catch { /* ignore */ }
                    for (const p of players) {
                        sendToSocket(p.ws, ServerMsg.LOBBY_UPDATE, {
                            action: 'block_progress',
                            startBlock, currentBlock, elapsed: (i + 1) * (POLL_INTERVAL_MS / 1000),
                            confirmed: true,
                        });
                    }
                }
                return true;
            }
            if (info.status >= 3n) return false;
        } catch { /* retry */ }

        const elapsedSec = (i + 1) * (POLL_INTERVAL_MS / 1000);
        logger.info(TAG, `Match ${matchId} waiting for LOCKED... (${elapsedSec}s / ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s)`);

        // Send block progress to players
        if (players) {
            let currentBlock = startBlock;
            try { currentBlock = Number(await contractService.getBlockNumber()); } catch { /* ignore */ }
            for (const p of players) {
                sendToSocket(p.ws, ServerMsg.LOBBY_UPDATE, {
                    action: 'block_progress',
                    startBlock, currentBlock, elapsed: elapsedSec,
                    confirmed: false,
                });
            }
        }

        await sleep(POLL_INTERVAL_MS);
    }
    // V5-07 FIX: In v5, operatorCreateMatch goes straight to LOCKED. If still not
    // LOCKED after timeout, the TX didn't mine (status=NONE) — NOT OPEN like v4.
    logger.warn(TAG, `Match ${matchId} lock timeout — checking on-chain status...`);
    try {
        const info = await contractService.getMatchInfo(matchId);
        if (info.status === 2n) {
            // It actually locked during the timeout check
            logger.info(TAG, `Match ${matchId} locked during timeout check — proceeding`);
            return true;
        } else if (info.status === 0n) {
            // v5: Operator TX probably didn't mine. Match doesn't exist on-chain yet.
            logger.warn(TAG, `Match ${matchId} status NONE — operatorCreateMatch TX may not have mined`);
            if (players && players.length > 0) {
                for (const p of players) {
                    sendToSocket(p.ws, ServerMsg.ERROR, {
                        message: 'Match creation TX did not confirm in time. Your escrow balance is safe — please try again.',
                        matchId: matchId.toString(),
                    });
                }
            }
        } else if (info.status === 1n) {
            // Legacy OPEN state — shouldn't happen with v5 operator flow
            logger.warn(TAG, `Match ${matchId} unexpectedly in OPEN state — possible legacy createMatch`);
            if (players && players.length > 0) {
                sendToSocket(players[0].ws, ServerMsg.ERROR, {
                    message: `Match in unexpected state. Contact support with match #${matchId}.`,
                    matchId: matchId.toString(),
                });
            }
        } else {
            logger.info(TAG, `Match ${matchId} already in terminal state: ${info.status}`);
        }
    } catch (checkErr) {
        logger.error(TAG, `Failed to check match ${matchId} status after timeout`, checkErr);
    }
    return false;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ── Game Callbacks → WebSocket ──

function wireGameCallbacks(game: GameInstance, matchId: bigint): void {
    // R-18: Lobby countdown
    game.onLobbyCountdown = (_m, secondsLeft) =>
        broadcastToMatch(matchId, ServerMsg.LOBBY_COUNTDOWN, { secondsLeft });

    // R-18: Seed reveal
    game.onSeedReveal = (_m, seed) => {
        // H-03 FIX: Send commitment hash before game, not raw seed
        // Raw seed revealed in GAME_END for post-match verification
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(seed))).then(buf => {
            const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            broadcastToMatch(matchId, ServerMsg.SEED_REVEAL, { seed: 'commitment:' + hash });
        });
    };

    // Preview
    game.onPreviewTick = (_m, tick) =>
        broadcastToMatch(matchId, ServerMsg.PREVIEW_TICK, {
            tick: tick.tick, price: tick.price, phase: 'PREVIEW',
        });

    game.onPreviewEnd = () =>
        broadcastToMatch(matchId, ServerMsg.PREVIEW_END, {});

    // Price ticks
    game.onTick = (_m, tick) =>
        broadcastToMatch(matchId, ServerMsg.CANDLE_UPDATE, {
            tick: tick.tick, price: tick.price, basePrice: tick.basePrice, phase: tick.phase,
        });

    // Phases
    game.onPhaseChange = (_m, phase, tick) =>
        broadcastToMatch(matchId, ServerMsg.PHASE_CHANGE, { phase, tick });

    // Trades
    game.onTradeExecuted = (_m, trade) =>
        broadcastToMatch(matchId, ServerMsg.TRADE_EXECUTED, { trade });

    game.onTradeRejected = (_m, player, reason) =>
        sendToPlayer(player, ServerMsg.TRADE_REJECTED, { reason });

    // Items
    game.onItemDrop = (_m, drops) =>
        broadcastToMatch(matchId, ServerMsg.ITEM_DROP, { drops });

    game.onItemUsed = (_m, event) =>
        broadcastToMatch(matchId, ServerMsg.ITEM_USED, {
            player: event.player, item: event.item, target: event.target, tick: event.tick,
        });

    game.onItemRejected = (_m, player, reason) =>
        sendToPlayer(player, ServerMsg.ITEM_REJECTED, { reason });

    // Portfolios
    // H-03 FIX: Ghost Trade hides position status from opponents.
    // Send real data to the player, obfuscated data to everyone else.
    game.onPortfolioUpdate = (_m, address, equity, status, entryPrice) => {
        const player = game.match.players.get(address);
        const tick = game.match.currentTick;
        const isGhosted = player ? hasGhostTrade(player.itemState, tick) : false;

        if (isGhosted) {
            // Send real data only to the player themselves
            sendToPlayer(address, ServerMsg.PORTFOLIO_UPDATE, {
                address, equity, positionStatus: status, entryPrice,
            });
            // Send obfuscated data to opponents
            broadcastToMatchExcept(matchId, address, ServerMsg.PORTFOLIO_UPDATE, {
                address, equity, positionStatus: 'HIDDEN', entryPrice: 0,
            });
        } else {
            // Normal broadcast
            broadcastToMatch(matchId, ServerMsg.PORTFOLIO_UPDATE, {
                address, equity, positionStatus: status, entryPrice,
            });
        }
    };

    // R-10: Elimination (Survival)
    game.onElimination = (_m, address, tick) =>
        broadcastToMatch(matchId, ServerMsg.ELIMINATION, { address, tick });

    // T1: Fog of War — tell all clients which players are fogged
    game.onFogUpdate = (_m, foggedPlayers) =>
        broadcastToMatch(matchId, ServerMsg.FOG_UPDATE, { foggedPlayers });

    // T1: X-Ray — send inventory data to the X-Ray user only
    game.onXRayData = (_m, targetPlayer, inventories) => {
        const invObj: Record<string, number[]> = {};
        for (const [addr, items] of inventories) invObj[addr] = items;
        sendToPlayer(targetPlayer, ServerMsg.XRAY_DATA, { inventories: invObj });
    };

    // T1: Thick Skin block notification
    game.onThickSkinBlock = (_m, blocker, attacker, blockedItem) =>
        broadcastToMatch(matchId, ServerMsg.THICK_SKIN_BLOCK, { blocker, attacker, blockedItem });

    // T2: Scramble — tell everyone except scrambler to show fake positions
    game.onScrambleUpdate = (_m, scramblerAddress) =>
        broadcastToMatch(matchId, ServerMsg.SCRAMBLE_ACTIVE, { scrambler: scramblerAddress });

    // T2: Mirror Curse — tell cursed players to invert their chart
    game.onMirrorCurseUpdate = (_m, cursedPlayers) =>
        broadcastToMatch(matchId, ServerMsg.MIRROR_CURSE_ACTIVE, { cursedPlayers });

    // T2: Mute — tell muted players to hide their PnL
    game.onMuteUpdate = (_m, mutedPlayers) =>
        broadcastToMatch(matchId, ServerMsg.MUTE_ACTIVE, { mutedPlayers });

    // T3: Shockwave — volatility x3 notification
    game.onShockwaveStart = () =>
        broadcastToMatch(matchId, ServerMsg.SHOCKWAVE_START, {});
    game.onShockwaveEnd = () =>
        broadcastToMatch(matchId, ServerMsg.SHOCKWAVE_END, {});

    // DEAD-04: Time Warp removed (LOGIC-22) — callback wiring cleaned up

    // T3: Blackout — chart hidden for everyone except user
    game.onBlackoutUpdate = (_m, blackoutUser) =>
        broadcastToMatch(matchId, ServerMsg.BLACKOUT_UPDATE, { blackoutUser });

    // T3: Heist — equity stolen notification (WIRE-04 FIX: renamed stolenItem → stolenEquity)
    game.onHeist = (_m, thief, victim, stolenEquity) =>
        broadcastToMatch(matchId, ServerMsg.HEIST, { thief, victim, stolenEquity });

    // Game end
    game.onGameEnd = (_m, standings, summary) => {
        broadcastToMatch(matchId, ServerMsg.GAME_END, { standings });

        // Announce winner
        const winner = standings[0];
        if (winner) {
            const winAddr = winner.address.slice(0, 8) + '…';
            const pnl = (winner.finalEquity - STARTING_CAPITAL).toFixed(2);
            const ann = postAnnouncement(
                `🏆 Match ended! ${isBotAddress(winner.address) ? '🤖 Bot' : winAddr} wins with $${winner.finalEquity.toFixed(2)} (${Number(pnl) >= 0 ? '+' : ''}${pnl})`
            );
            broadcastToAll(ServerMsg.CHAT_MESSAGE, { ...ann });
        }

        if (config.devMode) {
            logger.info(TAG, `DEV: Game ended, skipping on-chain settlement`);
            broadcastToMatch(matchId, ServerMsg.SETTLEMENT, {
                matchId: matchId.toString(), txHash: 'dev_mode_no_tx',
                standings, status: 'settled',
            });

            // BUG-3 FIX: Store match log even in DEV mode (for battle log)
            const playerAddresses: string[] = [];
            for (const [addr] of game.match.players) playerAddresses.push(addr);
            const matchLog: MatchLog = {
                matchId: matchId.toString(),
                seed: game.match.seed.toString(),
                mode: game.match.mode,
                format: game.match.format,
                buyIn: game.match.buyIn.toString(),
                players: playerAddresses,
                priceTicks: game.match.priceTicks,
                trades: game.match.trades,
                events: game.match.events,
                standings,
                payouts: [],
                timestamp: Date.now(),
            };
            db.storeMatchLog(matchLog);
            logger.info(TAG, `DEV: Match log stored for ${matchId}`);

            // CRIT-3 FIX: Single source of truth for post-game work
            const matchBuyIn = game.match.buyIn.toString();
            runPostSettlementWork(matchId, standings, matchBuyIn, true, game.match.format, summary)
                .then(() => { stopBotTrading(matchId); cleanupGameRoom(matchId.toString()); removeGame(matchId); })
                .catch((err) => { logger.error(TAG, 'DEV post-settlement failed', err); stopBotTrading(matchId); cleanupGameRoom(matchId.toString()); removeGame(matchId); });
        } else {
            settleMatch(game.match, standings)
                .then(async (txHash) => {
                    broadcastToMatch(matchId, ServerMsg.SETTLEMENT, {
                        matchId: matchId.toString(), txHash, standings, status: 'settled',
                    });
                    // CRIT-3 FIX: Single source of truth for post-game work
                    const matchBuyIn = game.match.buyIn.toString();
                    await runPostSettlementWork(matchId, standings, matchBuyIn, false, game.match.format, summary);
                    stopBotTrading(matchId); cleanupGameRoom(matchId.toString()); removeGame(matchId);
                })
                .catch((err) => {
                    logger.error(TAG, 'Settlement failed', err);
                    broadcastToMatch(matchId, ServerMsg.SETTLEMENT, {
                        matchId: matchId.toString(), status: 'failed', error: String(err),
                    });
                    // H-04 FIX: Queue for retry instead of giving up.
                    // The match stays LOCKED on-chain — we have ~50 blocks before emergency refund.
                    queueSettlementRetry(matchId, game.match, standings, summary);
                    stopBotTrading(matchId); cleanupGameRoom(matchId.toString()); removeGame(matchId);
                });
        }
    };
}

// ═══════════════════════════════════════════════════════════════════
// H-04 FIX: Settlement retry queue + deadline watchdog
//
// If settlement fails, the match stays LOCKED on-chain. Without retry,
// it sits there until emergency refund (50 blocks ≈ 8h on signet).
// This queue retries every 60s with exponential backoff.
// ═══════════════════════════════════════════════════════════════════

interface FailedSettlement {
    matchId: bigint;
    match: import('../game/types.js').GameMatch;
    standings: import('../game/types.js').Standing[];
    summary: import('../game/types.js').MatchSummary | undefined;
    attempts: number;
    lastAttempt: number;
    createdAt: number;
}

const failedSettlements = new Map<string, FailedSettlement>();
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_BASE_MS = 30_000;     // 30s first retry
const RETRY_MAX_MS = 5 * 60_000;  // 5 min max between retries

function queueSettlementRetry(
    matchId: bigint,
    match: import('../game/types.js').GameMatch,
    standings: import('../game/types.js').Standing[],
    summary: import('../game/types.js').MatchSummary | undefined,
): void {
    const key = matchId.toString();
    if (failedSettlements.has(key)) return; // already queued
    failedSettlements.set(key, {
        matchId, match, standings, summary,
        attempts: 0, lastAttempt: 0, createdAt: Date.now(),
    });
    logger.warn(TAG, `⚠️  Settlement queued for retry: match ${key}`);
}

/** Exported for index.ts startup */
export function startSettlementWatchdog(): void {
    setInterval(async () => {
        for (const [key, entry] of failedSettlements) {
            // Exponential backoff
            const delay = Math.min(RETRY_BASE_MS * Math.pow(2, entry.attempts), RETRY_MAX_MS);
            if (Date.now() - entry.lastAttempt < delay) continue;

            entry.attempts++;
            entry.lastAttempt = Date.now();

            if (entry.attempts > MAX_RETRY_ATTEMPTS) {
                logger.error(TAG, `🚨 CRITICAL: Settlement retry exhausted for match ${key} after ${MAX_RETRY_ATTEMPTS} attempts. Manual intervention required.`);
                failedSettlements.delete(key);
                continue;
            }

            logger.info(TAG, `Retrying settlement for match ${key} (attempt ${entry.attempts}/${MAX_RETRY_ATTEMPTS})...`);
            try {
                const txHash = await settleMatch(entry.match, entry.standings);
                logger.info(TAG, `✅ Settlement retry succeeded for match ${key}: ${txHash}`);
                const matchBuyIn = entry.match.buyIn.toString();
                await runPostSettlementWork(
                    entry.matchId, entry.standings, matchBuyIn, false,
                    entry.match.format, entry.summary,
                );
                failedSettlements.delete(key);
            } catch (err) {
                const msg = String(err);
                // If already settled or refunded, remove from queue
                if (msg.includes('already settled') || msg.includes('not locked') || msg.includes('Match is not locked')) {
                    logger.info(TAG, `Match ${key} no longer needs settlement (${msg.slice(0, 60)})`);
                    failedSettlements.delete(key);
                } else {
                    logger.warn(TAG, `Settlement retry ${entry.attempts} failed for match ${key}: ${msg.slice(0, 100)}`);
                }
            }
        }
    }, 60_000); // Check every 60s
    logger.info(TAG, 'Settlement retry watchdog started (interval: 60s)');
}
