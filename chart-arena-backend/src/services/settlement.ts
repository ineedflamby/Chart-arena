/**
 * Settlement Service — v3 Direct Settlement (Sprint 4 cleaned).
 *
 * Sprint 4 fixes:
 *   - Bug 4.4:  settledMatches.add() moved BEFORE TX broadcast (optimistic) to prevent
 *               double-settle during broadcast window. Removed on failure.
 *   - Bug 4.5:  settledMatches persisted to SQLite — survives server restarts.
 *   - Bug 4.7:  Removed all v4 scaffold (proposeSettlement, finalizeSettlement, disputeSettlement,
 *               pendingProposals, pollPendingProposals, startFinalizationPoller).
 *   - Bug 4.8:  Extracted runPostSettlementWork() — shared logic for stats, quests, jackpot.
 *   - Bug 4.11: Uses settleMatchWithRetry() for stale-data recovery.
 */
import { Address } from '@btc-vision/transaction';
import { contractService, OnChainStatus } from './contract.js';
import { logger } from '../utils/logger.js';
import {
    RAKE_BPS, BPS_DENOMINATOR, PODIUM_DUEL, PODIUM_ARENA, SURVIVAL_PAYOUTS,
    Format, GameMode, ServerMsg, STARTING_CAPITAL,
    type FormatValue, type GameModeValue,
} from '../utils/constants.js';
import type { Standing, MatchLog, GameMatch, MatchSummary } from '../game/types.js';
import { OffchainMatchStatus } from '../game/types.js';
import { db } from '../db/database.js';
import { broadcastToMatch, sendToPlayer } from '../ws/server.js';
import { checkVolumeQuests, checkMilestones, checkModeMilestones, checkEventQuests, getPlayerPoints } from './quests.js';
import { isBotAddress } from './bot.js';
import { onMatchComplete } from './points-engine.js';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { getAllTierStatus } from './buy-in-tiers.js';
// M-05 FIX: ELO import removed — ELO is dead code per project spec (not a planned feature)
// import { updateEloRatings } from './elo.js';

const TAG = 'Settlement';

// ── Double-settle prevention (Bug 4.5: backed by SQLite) ──
const settledMatches = new Set<string>();

/** Bug 4.5: Load persisted settled matches from DB on startup. */
export function loadSettledMatches(): void {
    const rows = db.getSettledMatchIds();
    for (const id of rows) settledMatches.add(id);
    logger.info(TAG, `Loaded ${settledMatches.size} settled matches from DB`);

    // H-02 FIX: Do NOT remove pending guards here. They are reconciled async
    // after contractService.init() via reconcilePendingSettlements().
    const pending = db.getPendingSettlements();
    if (pending.length > 0) {
        logger.warn(TAG, `${pending.length} pending settlement(s) found — will reconcile after contract init.`);
    }
}

/**
 * H-02 FIX: Reconcile pending settlements by checking on-chain status.
 * Call AFTER contractService.init().
 *
 * Old behavior: blindly removed guard → could re-settle already-settled matches.
 * New behavior: checks on-chain first:
 *   - If on-chain status is SETTLED → keep guard (already done), confirm off-chain payouts.
 *   - If on-chain status is LOCKED → remove guard so retry can happen.
 *   - If on-chain status is REFUNDED/CANCELLED → keep guard, log warning.
 */
export async function reconcilePendingSettlements(): Promise<void> {
    const pending = db.getPendingSettlements();
    if (pending.length === 0) return;

    logger.info(TAG, `Reconciling ${pending.length} pending settlement(s)...`);
    for (const matchIdStr of pending) {
        try {
            const matchId = BigInt(matchIdStr);
            const info = await contractService.getMatchInfo(matchId);

            if (info.status === OnChainStatus.SETTLED) {
                // Already settled on-chain — keep guard, confirm any pending payouts
                logger.info(TAG, `  Match ${matchIdStr}: SETTLED on-chain — keeping guard, confirming off-chain payouts`);
                // The settled_matches DB row has txHash='pending' — we can't recover the real hash
                // but the match IS settled, so keep it guarded.
            } else if (info.status === OnChainStatus.LOCKED) {
                // Not yet settled — safe to retry
                settledMatches.delete(matchIdStr);
                logger.warn(TAG, `  Match ${matchIdStr}: still LOCKED on-chain — removed guard for retry`);
            } else if (info.status === OnChainStatus.REFUNDED) {
                logger.warn(TAG, `  Match ${matchIdStr}: REFUNDED on-chain — keeping guard`);
            } else if (info.status === OnChainStatus.CANCELLED) {
                logger.warn(TAG, `  Match ${matchIdStr}: CANCELLED on-chain — keeping guard`);
            } else {
                logger.warn(TAG, `  Match ${matchIdStr}: unexpected status ${info.status} — keeping guard`);
            }
        } catch (err) {
            // Can't reach the chain — keep the guard (conservative)
            logger.error(TAG, `  Match ${matchIdStr}: on-chain check failed — keeping guard. Error: ${err}`);
        }
    }
    logger.info(TAG, `Reconciliation complete.`);

    // C-03: Also check for any pending off-chain payouts that need confirmation
    await confirmAllPendingPayouts();
}

/** Bug 4.5: Persist a match ID to both memory and DB. */
function markSettled(matchIdStr: string, txHash: string): void {
    settledMatches.add(matchIdStr);
    db.addSettledMatch(matchIdStr, txHash);
}

/** Bug 4.5: Remove from memory (DB row stays as audit trail). */
function unmarkSettled(matchIdStr: string): void {
    settledMatches.delete(matchIdStr);
    // Note: we don't delete from DB — the DB entry is an audit record.
    // The in-memory Set is the authoritative guard.
}

export function isAlreadySettled(matchIdStr: string): boolean {
    return settledMatches.has(matchIdStr);
}

// ═══════════════════════════════════════════════════════════════════
// C-03 FIX: TX Confirmation Poller
// Upgrades 'pending' off-chain payouts to 'confirmed' once the TX is mined.
// ═══════════════════════════════════════════════════════════════════

const CONFIRM_POLL_INTERVAL_MS = 15_000; // Check every 15s
const CONFIRM_MAX_RETRIES = 40;          // Give up after ~10 minutes (40 × 15s)

/** Track in-flight confirmation checks to avoid duplicates */
const pendingConfirmations = new Map<string, { retries: number; matchIdStr: string }>();

/**
 * Schedule a confirmation check for a settlement TX.
 * Called immediately after broadcasting the settlement.
 */
function scheduleConfirmationCheck(txHash: string, matchIdStr: string): void {
    if (pendingConfirmations.has(txHash)) return; // already tracking
    pendingConfirmations.set(txHash, { retries: 0, matchIdStr });
    logger.info(TAG, `Scheduled confirmation check for TX ${txHash} (match ${matchIdStr})`);
}

/**
 * Check all pending TXs and confirm those that are mined.
 */
async function confirmAllPendingPayouts(): Promise<void> {
    const pendingTxHashes = db.getPendingPayoutTxHashes();
    if (pendingTxHashes.length === 0) return;

    logger.info(TAG, `Checking ${pendingTxHashes.length} pending payout TX(s)...`);
    for (const txHash of pendingTxHashes) {
        try {
            const blockNum = await contractService.isTransactionConfirmed(txHash);
            if (blockNum !== null) {
                const confirmed = db.confirmPendingPayouts(txHash);
                if (confirmed > 0) {
                    logger.info(TAG, `✅ Confirmed ${confirmed} payout(s) for TX ${txHash} (block ${blockNum})`);
                    pendingConfirmations.delete(txHash);
                }
            }
        } catch (err) {
            logger.warn(TAG, `Confirmation check failed for TX ${txHash}: ${err}`);
        }
    }
}

/**
 * Start the background confirmation poller.
 * Call once after contractService.init().
 */
export function startSettlementConfirmationPoller(): void {
    setInterval(async () => {
        try {
            // Check tracked in-flight TXs
            for (const [txHash, state] of pendingConfirmations) {
                try {
                    const blockNum = await contractService.isTransactionConfirmed(txHash);
                    if (blockNum !== null) {
                        const confirmed = db.confirmPendingPayouts(txHash);
                        if (confirmed > 0) {
                            logger.info(TAG, `✅ TX confirmed: ${txHash} (block ${blockNum}) — upgraded ${confirmed} payout(s)`);
                            writeAuditLog({ event: 'PAYOUT_CONFIRMED', txHash, confirmedCount: confirmed, blockNumber: blockNum.toString() });
                        }
                        pendingConfirmations.delete(txHash);
                    } else {
                        state.retries++;
                        if (state.retries >= CONFIRM_MAX_RETRIES) {
                            logger.error(TAG, `⚠️  TX ${txHash} (match ${state.matchIdStr}) never confirmed after ${CONFIRM_MAX_RETRIES} checks. Manual review needed.`);
                            writeAuditLog({ event: 'PAYOUT_CONFIRMATION_TIMEOUT', txHash, matchId: state.matchIdStr });
                            pendingConfirmations.delete(txHash);
                        }
                    }
                } catch (err) {
                    logger.warn(TAG, `Confirmation poll error for ${txHash}: ${err}`);
                }
            }

            // Also sweep any pending entries in DB not tracked in memory (e.g., from pre-restart)
            await confirmAllPendingPayouts();
        } catch (err) {
            logger.error(TAG, 'Confirmation poller error', err);
        }
    }, CONFIRM_POLL_INTERVAL_MS);
    logger.info(TAG, `Settlement confirmation poller started (interval: ${CONFIRM_POLL_INTERVAL_MS / 1000}s)`);
}

// ── Audit log ──
const AUDIT_DIR = resolve('./data/audit');
try { mkdirSync(AUDIT_DIR, { recursive: true }); } catch {}

function writeAuditLog(entry: Record<string, unknown>): void {
    try {
        const line = JSON.stringify({ ...entry, auditTimestamp: new Date().toISOString() }) + '\n';
        appendFileSync(resolve(AUDIT_DIR, 'settlements.jsonl'), line);
    } catch (err) {
        logger.error(TAG, 'Failed to write audit log', err);
    }
}

function uint8ToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface PayoutEntry { readonly address: string; readonly amount: bigint; }

// ═══════════════════════════════════════════════════════════════════
// PAYOUT COMPUTATION
// ═══════════════════════════════════════════════════════════════════

export function computePayouts(
    pot: bigint, format: FormatValue, mode: GameModeValue, standings: Standing[],
): PayoutEntry[] {
    const rake = (pot * BigInt(RAKE_BPS)) / BigInt(BPS_DENOMINATOR);
    const netPot = pot - rake;
    let splits: number[];

    if (mode === GameMode.SURVIVAL) {
        const survivors = standings.filter((s) => !s.eliminated);
        if (survivors.length === 0) {
            // Bug 6.7: GDD §5.2 — 0 survivors → rank-1-takes-all.
            // Falls through to computeSplitPayouts with full standings,
            // so the last-eliminated player (rank 1) gets 100% of the net pot.
            splits = [10000];
        } else {
            const count = Math.min(survivors.length, 5);
            splits = SURVIVAL_PAYOUTS[count] ?? [10000];
            return computeSplitPayouts(netPot, splits, survivors);
        }
    } else {
        splits = format === Format.DUEL ? PODIUM_DUEL : PODIUM_ARENA;
    }
    return computeSplitPayouts(netPot, splits, standings);
}

function computeSplitPayouts(netPot: bigint, splits: number[], standings: Standing[]): PayoutEntry[] {
    const payouts: PayoutEntry[] = [];
    let distributed = 0n;
    for (let i = 0; i < splits.length && i < standings.length; i++) {
        const amount = i === splits.length - 1 ? netPot - distributed
            : (netPot * BigInt(splits[i])) / BigInt(BPS_DENOMINATOR);
        payouts.push({ address: standings[i].address, amount });
        distributed += amount;
    }
    const sum = payouts.reduce((acc, p) => acc + p.amount, 0n);
    if (sum !== netPot) throw new Error(`Payout sum mismatch: sum=${sum}, netPot=${netPot}`);
    logger.info(TAG, `Payouts: netPot=${netPot}, splits=${JSON.stringify(splits)}`, payouts);
    return payouts;
}

export async function computeLogHash(matchLog: MatchLog): Promise<bigint> {
    const serialized = JSON.stringify(matchLog);
    const bytes = new TextEncoder().encode(serialized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return BigInt('0x' + uint8ToHex(new Uint8Array(hashBuffer)));
}

export function buildMatchLog(match: GameMatch, standings: Standing[], payouts: PayoutEntry[]): MatchLog {
    return {
        matchId: match.matchId.toString(), seed: match.seed.toString(),
        mode: match.mode, format: match.format, buyIn: match.buyIn.toString(),
        players: Array.from(match.players.keys()),
        priceTicks: match.priceTicks, trades: match.trades,
        events: match.events, standings,
        payouts: payouts.map((p) => ({ address: p.address, amount: p.amount.toString() })),
        timestamp: Date.now(),
    };
}

// ═══════════════════════════════════════════════════════════════════
// C-04 VERIFICATION GUARDS
// ═══════════════════════════════════════════════════════════════════

async function verifyOnChainState(
    match: GameMatch, payouts: PayoutEntry[],
): Promise<{ valid: boolean; reason?: string }> {
    try {
        const info = await contractService.getMatchInfo(match.matchId);
        if (info.status !== OnChainStatus.LOCKED) {
            return { valid: false, reason: `On-chain status ${info.status}, expected LOCKED` };
        }
        const expectedRake = (info.pot * BigInt(RAKE_BPS)) / BigInt(BPS_DENOMINATOR);
        const expectedNetPot = info.pot - expectedRake;
        const payoutSum = payouts.reduce((sum, p) => sum + p.amount, 0n);
        if (payoutSum !== expectedNetPot) return { valid: false, reason: `Sum ${payoutSum} != netPot ${expectedNetPot}` };
        if (info.mode !== BigInt(match.mode)) return { valid: false, reason: 'Mode mismatch' };
        if (info.format !== BigInt(match.format)) return { valid: false, reason: 'Format mismatch' };
        if (info.playerCount !== BigInt(match.players.size)) return { valid: false, reason: 'PlayerCount mismatch' };
        if (info.buyIn !== match.buyIn) return { valid: false, reason: 'BuyIn mismatch' };
        return { valid: true };
    } catch (err) {
        return { valid: false, reason: `On-chain check failed: ${err}` };
    }
}

function sanityCheckPayouts(
    payouts: PayoutEntry[], netPot: bigint, matchPlayers: Map<string, unknown>,
): { valid: boolean; reason?: string } {
    if (payouts.length === 0) return { valid: false, reason: 'Empty payouts' };
    const sum = payouts.reduce((acc, p) => acc + p.amount, 0n);
    if (sum !== netPot) return { valid: false, reason: `Sum ${sum} != netPot ${netPot}` };
    for (const p of payouts) {
        if (p.amount < 0n) return { valid: false, reason: `Negative payout: ${p.address}` };
        if (p.amount > netPot) return { valid: false, reason: `Exceeds netPot: ${p.address}` };
        if (!matchPlayers.has(p.address)) return { valid: false, reason: `Not in match: ${p.address}` };
    }
    const addrSet = new Set(payouts.map(p => p.address));
    if (addrSet.size !== payouts.length) return { valid: false, reason: 'Duplicate addresses' };
    return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════
// SETTLEMENT (v3 direct — canonical path)
// ═══════════════════════════════════════════════════════════════════

/**
 * v3: Direct settlement. Computes payouts, verifies on-chain state, broadcasts TX.
 *
 * Bug 4.4: settledMatches.add() BEFORE broadcast to prevent race condition.
 *          Removed on failure so the match can be retried.
 *
 * Bug 6.8: TOCTOU note — there is an inherent race between reading on-chain state
 *          (verifyOnChainState) and submitting the settlement TX. However, the contract
 *          itself enforces status == LOCKED in settleMatch(), so even if stale data is
 *          read, the TX will revert if the match was already settled/cancelled.
 *          settleMatchWithRetry() (Bug 4.11) handles stale-data reverts gracefully.
 */
export async function settleMatch(match: GameMatch, standings: Standing[]): Promise<string> {
    const matchIdStr = match.matchId.toString();

    if (settledMatches.has(matchIdStr)) {
        writeAuditLog({ event: 'DOUBLE_SETTLE_BLOCKED', matchId: matchIdStr });
        throw new Error(`Match ${matchIdStr} already settled`);
    }

    // Bug 4.4: Mark settled BEFORE broadcast to block concurrent attempts
    markSettled(matchIdStr, 'pending');
    match.status = OffchainMatchStatus.SETTLING;

    try {
        const info = await contractService.getMatchInfo(match.matchId);
        const payouts = computePayouts(info.pot, match.format, match.mode, standings);
        const rake = (info.pot * BigInt(RAKE_BPS)) / BigInt(BPS_DENOMINATOR);
        const netPot = info.pot - rake;

        const sanity = sanityCheckPayouts(payouts, netPot, match.players);
        if (!sanity.valid) throw new Error(`Sanity: ${sanity.reason}`);

        const verification = await verifyOnChainState(match, payouts);
        if (!verification.valid) throw new Error(`Verify: ${verification.reason}`);

        const matchLog = buildMatchLog(match, standings, payouts);
        const logHash = await computeLogHash(matchLog);
        db.storeMatchLog(matchLog);

        writeAuditLog({
            event: 'SETTLE_ATTEMPT', matchId: matchIdStr,
            pot: info.pot.toString(), netPot: netPot.toString(),
            payouts: payouts.map(p => ({ addr: p.address, amt: p.amount.toString() })),
            logHash: logHash.toString(16),
        });

        // Build payout map — resolveAddress returns PublicKeyInfo (opnet SDK handles it)
        const payoutMap = new Map<any, bigint>();
        for (const p of payouts) {
            const addr = await contractService.resolveAddress(p.address);
            logger.info(TAG, `  Payout: ${p.address.slice(0, 12)}… = ${p.amount}`);
            payoutMap.set(addr, p.amount);
        }

        // Bug 4.11: Use retry wrapper for stale-data recovery
        const txHash = await contractService.settleMatchWithRetry(match.matchId, logHash, payoutMap);

        // C-03 FIX: Record payouts as PENDING — confirmed after TX is mined.
        // Players see pending balance immediately but can't queue with it.
        for (const p of payouts) {
            if (p.amount > 0n) {
                db.recordEscrowChange(p.address, p.amount.toString(), 'match_payout', matchIdStr, txHash, 'pending');
            }
        }
        logger.info(TAG, `Off-chain ledger: recorded PENDING payouts for match ${matchIdStr} (TX: ${txHash})`);

        // C-03 FIX: Push balance with pending breakdown to each player
        for (const p of payouts) {
            const { confirmed, pending } = db.getOffchainDisplayBalance(p.address);
            sendToPlayer(p.address, ServerMsg.ESCROW_BALANCE, {
                balance: confirmed.toString(),
                pending: pending.toString(),
                source: 'offchain',
            });
        }

        // Schedule TX confirmation check (C-03: will upgrade pending → confirmed)
        scheduleConfirmationCheck(txHash, matchIdStr);

        // Update the DB record with actual TX hash
        db.addSettledMatch(matchIdStr, txHash);
        match.status = OffchainMatchStatus.SETTLED;

        writeAuditLog({ event: 'SETTLE_SUCCESS', matchId: matchIdStr, txHash });
        logger.info(TAG, `Match ${matchIdStr} settled. TX: ${txHash}`);
        return txHash;
    } catch (err) {
        // Bug 4.4: Unmark on failure so the match can be retried
        unmarkSettled(matchIdStr);
        match.status = OffchainMatchStatus.ERROR;
        writeAuditLog({ event: 'SETTLE_FAILED', matchId: matchIdStr, error: String(err) });
        logger.error(TAG, `Settlement failed: ${matchIdStr}`, err);
        throw err;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Bug 4.8: SHARED POST-SETTLEMENT WORK
// ═══════════════════════════════════════════════════════════════════

/**
 * CRIT-3 FIX: Single source of truth for all post-settlement work.
 * Called from both dev and production paths in matchmaking.ts.
 * Handles: stats, milestones, points, tiers, referrals, quests, jackpot.
 *
 * NOTE: Settlement broadcast is NOT done here — callers handle it
 * because dev and prod paths broadcast different data.
 */
export async function runPostSettlementWork(
    matchId: bigint,
    standings: Standing[],
    buyIn: string,
    isDevMode: boolean = false,
    format: FormatValue = 0 as FormatValue,
    summary?: MatchSummary,
): Promise<void> {
    const matchIdStr = matchId.toString();
    try {
        // Sprint 1: Log match summary for verification (Sprint 2 will store per-mode stats)
        if (summary) {
            const modeNames = ['Classic', 'Survival', 'Chaos'];
            const modeName = modeNames[summary.mode] ?? `Mode${summary.mode}`;
            logger.info(TAG, `📊 MatchSummary: ${matchIdStr} [${modeName}] ${summary.players.size} players, ${summary.durationTicks}/${summary.totalTicks} ticks`);
            for (const [addr, result] of summary.players) {
                if (!isBotAddress(addr)) {
                    logger.info(TAG, `  📊 ${addr.slice(0, 8)} rank=${result.rank} equity=${result.finalEquity.toFixed(4)} pnl=${result.pnlDelta >= 0 ? '+' : ''}${result.pnlDelta.toFixed(4)} trades=${result.tradesExecuted} items_used=${result.itemsUsed} items_recv=${result.itemsReceived} pos_ticks=${result.positionTicks}${result.survivalSurvivedUntilTick >= 0 ? ` surv_tick=${result.survivalSurvivedUntilTick} cause=${result.survivalEliminationCause}` : ''}`);
                }
            }
        }

        // 1. Update player stats (skip bots)
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const won = s.rank === 1;
                const pnlRatio = (s.finalEquity - STARTING_CAPITAL) / STARTING_CAPITAL;
                // SPRINT 3 FIX: Use float math for earnings (was integer division → 0.75 MOTO became "0")
                const buyInMoto = Number(BigInt(buyIn)) / 1e18;
                const earningsMoto = (pnlRatio * buyInMoto).toFixed(6);
                // Volume already stored in MOTO units (not wei).
                const volumeMoto = (BigInt(buyIn) / (10n ** 18n)).toString();
                db.updatePlayerStats(s.address, won, earningsMoto, s.rank, volumeMoto);

                // Sprint 2: Per-mode stats
                if (summary) {
                    const result = summary.players.get(s.address);
                    if (result) {
                        db.updatePlayerModeStats(s.address, result, earningsMoto, volumeMoto);
                    }
                }

                onMatchComplete(s.address); // recalculate airdrop volume points
            }
        }
        logger.info(TAG, `Player stats updated for ${standings.filter(s => !isBotAddress(s.address)).length} human player(s)`);

        // M-05 FIX: ELO code removed from settlement path.
        // ELO is not a planned feature — dead code that was actively modifying state and sending WS messages.
        // The elo.ts module still exists for potential future use but is no longer called here.

        // 2. Check milestones (play_10, win_5, etc.) for airdrop quest points
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const newMilestones = checkMilestones(s.address);
                for (const m of newMilestones) {
                    const totalPoints = getPlayerPoints(s.address);
                    sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                        questId: m.questId, title: m.title, emoji: m.emoji,
                        points: m.points, totalPoints,
                    });
                }
            }
        }

        // 2b. Check mode-specific milestones (classic_play_5, survival_win_3, etc.)
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const modeMilestones = checkModeMilestones(s.address);
                for (const m of modeMilestones) {
                    const totalPoints = getPlayerPoints(s.address);
                    sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                        questId: m.questId, title: m.title, emoji: m.emoji,
                        points: m.points, totalPoints,
                    });
                }
            }
        }

        // 2c. Check event-based quests (one-shot achievements from match result)
        if (summary) {
            for (const s of standings) {
                if (!isBotAddress(s.address)) {
                    const result = summary.players.get(s.address);
                    if (result) {
                        const eventQuests = checkEventQuests(s.address, result);
                        for (const q of eventQuests) {
                            const totalPoints = getPlayerPoints(s.address);
                            sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                                questId: q.questId, title: q.title, emoji: q.emoji,
                                points: q.points, totalPoints,
                            });
                        }
                    }
                }
            }
        }

        // 3. Send updated tier unlock status
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const tiers = getAllTierStatus(s.address);
                sendToPlayer(s.address, ServerMsg.TIER_STATUS, { tiers });
            }
        }

        // 4. Track referral volume (MOTO units, not wei)
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const referrer = db.getReferrer(s.address);
                if (referrer) {
                    const volumeMoto = (BigInt(buyIn) / (10n ** 18n)).toString();
                    db.addReferralVolume(referrer, s.address, volumeMoto);
                    db.markReferralPlayed(s.address);
                }
            }
        }

        // 5. Check volume quests + credit referral bonus
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const newQuests = checkVolumeQuests(s.address);
                for (const q of newQuests) {
                    db.creditReferralBonus(s.address, q.points);
                    const totalPoints = getPlayerPoints(s.address);
                    sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                        questId: q.questId, title: q.title, emoji: q.emoji,
                        points: q.points, totalPoints,
                    });
                }
            }
        }

        // 6. Jackpot trigger — 0.5% chance per match (skip in dev mode)
        if (!isDevMode && standings.length > 0) {
            const jackpotRoll = crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF;
            if (jackpotRoll < 0.005) {
                const n = standings.length;
                const limit = Math.floor(0x100000000 / n) * n;
                let raw: number;
                do {
                    raw = crypto.getRandomValues(new Uint32Array(1))[0];
                } while (raw >= limit);
                const winnerIdx = raw % n;
                const winner = standings[winnerIdx].address;
                try {
                    const jpTx = await contractService.distributeJackpot(winner);
                    logger.info(TAG, `🎰 JACKPOT distributed to ${winner}, TX: ${jpTx}`);
                    broadcastToMatch(matchId, ServerMsg.SETTLEMENT, {
                        matchId: matchIdStr, jackpot: true, jackpotWinner: winner,
                    });
                } catch (jpErr) {
                    logger.error(TAG, 'Jackpot distribution failed', jpErr);
                }
            }
        }
    } catch (err) {
        logger.error(TAG, `Post-settlement work failed: ${matchIdStr}`, err);
    }
}
