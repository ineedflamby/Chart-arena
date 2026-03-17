import type { GameSocket } from './server.js';
import { sendToSocket, registerPlayerSocket, assignToMatch, broadcastToMatch, broadcastToAll, sendToPlayer, getPlayerMatchId, getAuthenticatedCount } from './server.js';
import { authenticate, authenticateWithToken, generateSessionToken, getPlayerAddress, isAuthenticated } from './auth.js';
import { ClientMsg, ServerMsg, ChatChannel, type ChatChannelValue, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_REGEX, RESERVED_USERNAMES } from '../utils/constants.js';
import { db } from '../db/database.js';
import { getRank, getRankProgress, getNextRankVolume, buildRankProfile } from '../utils/tiers.js';
import { queuePlayer, dequeuePlayer, reportMatchId } from '../services/matchmaking.js';
import { getGame, getGameByPlayer } from '../game/game-loop.js';
import { contractService } from '../services/contract.js';
import { config } from '../config.js';
import type { TradeAction } from '../game/types.js';
import type { ItemIdValue } from '../game/items.js';
import { logger } from '../utils/logger.js';
import {
    sendPublicMessage, sendGameRoomMessage, sendWhisperMessage,
    getPublicHistory, getAnnouncementHistory, getGameRoomHistory, getWhisperHistory,
    canSendChat, validateChatText,
} from '../services/chat.js';
import { startTwitterAuth } from '../services/twitter-auth.js';
import { getPlayerQuests, getPlayerPoints, claimSocialQuest, getModeMastery } from '../services/quests.js';
import {
    isValidTier, getTierBuyIn, validateQueueRequest,
    getAllTierStatus, getQueueAvailability,
    type BuyInTierValue,
} from '../services/buy-in-tiers.js';
import { getPlayerPointsSummary } from '../services/points-engine.js';
import { getCurrentSeason } from '../services/season.js';
import { getEloLeaderboard } from '../services/elo.js';

const TAG = 'WSHandler';
const VALID_ACTIONS: Set<string> = new Set(['OPEN_LONG', 'OPEN_SHORT', 'CLOSE']);
const MAX_MATCH_ID = 2n ** 128n;

/** Validate matchId string: must be digits-only and within u128 range */
function isValidMatchId(s: string): boolean {
    if (typeof s !== 'string' || !/^\d+$/.test(s)) return false;
    try {
        const n = BigInt(s);
        return n > 0n && n < MAX_MATCH_ID;
    } catch { return false; }
}

// PROD-04 FIX: Per-type rate limiting for expensive DB queries
// Allows 1 call per EXPENSIVE_COOLDOWN_MS per player per message type
const EXPENSIVE_TYPES = new Set([
    ClientMsg.GET_LEADERBOARD, ClientMsg.GET_PROFILE, ClientMsg.GET_QUESTS,
    ClientMsg.GET_REFERRAL_STATS, ClientMsg.GET_BATTLE_LOG,
    ClientMsg.GET_POINTS_SUMMARY, ClientMsg.GET_ELO_LEADERBOARD,
]);
const EXPENSIVE_COOLDOWN_MS = 3000;
const lastExpensiveCall = new Map<string, number>(); // "wsId:type" → timestamp

function isThrottled(wsId: string, type: string): boolean {
    if (!EXPENSIVE_TYPES.has(type as any)) return false;
    const key = `${wsId}:${type}`;
    const now = Date.now();
    const last = lastExpensiveCall.get(key) ?? 0;
    if (now - last < EXPENSIVE_COOLDOWN_MS) return true;
    lastExpensiveCall.set(key, now);
    return false;
}

// Cleanup stale entries every 60s
setInterval(() => {
    const cutoff = Date.now() - EXPENSIVE_COOLDOWN_MS * 10;
    for (const [key, ts] of lastExpensiveCall) {
        if (ts < cutoff) lastExpensiveCall.delete(key);
    }
}, 60_000);

export function handleMessage(ws: GameSocket, msg: Record<string, unknown>): void {
    const type = msg['type'] as string | undefined;
    if (!type) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing message type' }); return; }
    const wsId = ws._data.id;

    // PROD-04: Throttle expensive queries
    if (isThrottled(wsId, type)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Too fast — try again in a moment' });
        return;
    }

    switch (type) {
        case ClientMsg.AUTH: handleAuth(ws, msg, wsId); break;
        case 'token_auth': handleTokenAuth(ws, msg, wsId); break;
        case ClientMsg.QUEUE: handleQueue(ws, msg, wsId); break;
        case ClientMsg.LEAVE_QUEUE: handleLeaveQueue(ws, wsId); break;
        case ClientMsg.TRADE: handleTrade(ws, msg, wsId); break;
        case ClientMsg.REPORT_MATCH_ID: handleReportMatchId(ws, msg, wsId); break;
        case ClientMsg.USE_ITEM: handleUseItem(ws, msg, wsId); break;
        case ClientMsg.GET_PROFILE: handleGetProfile(ws, wsId); break;
        case ClientMsg.GET_JACKPOT: handleGetJackpot(ws, wsId); break;
        case ClientMsg.CHAT_SEND: handleChatSend(ws, msg, wsId); break;
        case ClientMsg.CHAT_GET_HISTORY: handleChatGetHistory(ws, msg, wsId); break;
        case ClientMsg.SET_USERNAME: handleSetUsername(ws, msg, wsId); break;
        case ClientMsg.START_TWITTER_AUTH: handleStartTwitterAuth(ws, wsId); break;
        case ClientMsg.GET_QUESTS: handleGetQuests(ws, wsId); break;
        case ClientMsg.CLAIM_QUEST: handleClaimQuest(ws, msg, wsId); break;
        // Referral System
        case ClientMsg.GET_REFERRAL_STATS: handleGetReferralStats(ws, wsId); break;
        case ClientMsg.APPLY_REFERRAL: handleApplyReferral(ws, msg, wsId); break;
        // Battle Log
        case ClientMsg.GET_BATTLE_LOG: handleGetBattleLog(ws, msg, wsId); break;
        // Buy-In Tiers
        case ClientMsg.GET_TIER_STATUS: handleGetTierStatus(ws, wsId); break;
        case ClientMsg.GET_QUEUE_AVAILABILITY: handleGetQueueAvailability(ws, wsId); break;
        // Leaderboard & Online Count
        case ClientMsg.GET_LEADERBOARD: handleGetLeaderboard(ws, wsId); break;
        case ClientMsg.GET_ONLINE_COUNT: handleGetOnlineCount(ws, wsId); break;
        // Points V2 / ELO / Seasons (DEAD-02 FIX)
        case ClientMsg.GET_POINTS_SUMMARY: handleGetPointsSummary(ws, wsId); break;
        case ClientMsg.GET_SEASON_INFO: handleGetSeasonInfo(ws, wsId); break;
        case ClientMsg.GET_ELO_LEADERBOARD: handleGetEloLeaderboard(ws, msg, wsId); break;
        // v5.1: Deposit via operator
        case ClientMsg.DEPOSIT_REQUEST: handleDepositRequest(ws, msg, wsId); break;
        // SPRINT 3: Off-chain balance
        case ClientMsg.GET_ESCROW_BALANCE: handleGetEscrowBalance(ws, wsId); break;
        default: sendToSocket(ws, ServerMsg.ERROR, { message: 'Unknown type: ' + type });
    }
}

async function handleAuth(ws: GameSocket, msg: Record<string, unknown>, wsId: string): Promise<void> {
    const address = msg['address'] as string | undefined;
    const signature = msg['signature'] as string | undefined;
    const pubkey = msg['pubkey'] as string | undefined;
    if (!address) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing address' }); return; }
    const ok = await authenticate(wsId, address, signature, pubkey);
    if (ok) {
        registerPlayerSocket(address, ws);
        // Issue a session token so the client can reconnect without re-signing
        const sessionToken = generateSessionToken(address);
        sendToSocket(ws, ServerMsg.AUTH_OK, { address, sessionToken });
        // Sprint 2 FIX: Pre-cache address resolution (non-blocking).
        // If the node knows this pubkey, we cache it now. If not, deposit retry handles it.
        contractService.warmupAddressCache(address).catch(() => {});
        // Send chat history on auth
        sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel: ChatChannel.PUBLIC, messages: getPublicHistory() });
        sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel: ChatChannel.ANNOUNCEMENT, messages: getAnnouncementHistory() });
        // Check if player has a profile (username)
        const profile = db.getProfile(address);
        if (profile) {
            sendToSocket(ws, ServerMsg.PROFILE_READY, {
                address, displayName: profile.username,
                twitterHandle: profile.twitter_handle,
            });
        } else {
            sendToSocket(ws, ServerMsg.PROFILE_SETUP_REQUIRED, { address });
        }
        // Send buy-in tier unlock status + queue availability on auth
        const tiers = getAllTierStatus(address);
        sendToSocket(ws, ServerMsg.TIER_STATUS, { tiers });
        const availability = getQueueAvailability();
        sendToSocket(ws, ServerMsg.QUEUE_AVAILABILITY, availability as unknown as Record<string, unknown>);
        // Send MOTO/USD price for portfolio display
        if (config.motoUsdPrice > 0) {
            sendToSocket(ws, ServerMsg.MOTO_PRICE, { price: config.motoUsdPrice });
        }

        // ── RECONNECT: Check if player is in an active game ──
        const activeGame = getGameByPlayer(address);
        if (activeGame) {
            const { matchId, game } = activeGame;
            logger.info(TAG, `Reconnecting ${address} to active match ${matchId}`);
            // Reassign websocket to match
            assignToMatch(ws, matchId);
            game.markReconnected(address);
            // Send full game state snapshot
            const snapshot = game.getReconnectSnapshot(address);
            sendToSocket(ws, ServerMsg.GAME_RECONNECT, snapshot);
            // Send display names
            const playerAddresses = snapshot['players'] as string[];
            const nameMap = db.getDisplayNames(playerAddresses);
            const displayNames: Record<string, string> = {};
            for (const addr of playerAddresses) {
                displayNames[addr] = nameMap.get(addr) ?? addr.slice(0, 8) + '…';
            }
            sendToSocket(ws, ServerMsg.DISPLAY_NAMES, { names: displayNames });
        }
    } else {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Authentication failed' });
    }
}

/** Token-based re-authentication — no wallet signing needed */
function handleTokenAuth(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    const token = msg['token'] as string | undefined;
    if (!token) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing token' }); return; }
    const address = authenticateWithToken(wsId, token);
    if (address) {
        registerPlayerSocket(address, ws);
        // Issue a fresh token
        const newToken = generateSessionToken(address);
        sendToSocket(ws, ServerMsg.AUTH_OK, { address, sessionToken: newToken });
        // Sprint 2 FIX: Pre-cache address resolution (non-blocking)
        contractService.warmupAddressCache(address).catch(() => {});
        // Same post-auth flow as normal auth
        sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel: ChatChannel.PUBLIC, messages: getPublicHistory() });
        sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel: ChatChannel.ANNOUNCEMENT, messages: getAnnouncementHistory() });
        const profile = db.getProfile(address);
        if (profile) {
            sendToSocket(ws, ServerMsg.PROFILE_READY, {
                address, displayName: profile.username,
                twitterHandle: profile.twitter_handle,
            });
        } else {
            sendToSocket(ws, ServerMsg.PROFILE_SETUP_REQUIRED, { address });
        }
        const tiers = getAllTierStatus(address);
        sendToSocket(ws, ServerMsg.TIER_STATUS, { tiers });
        const availability = getQueueAvailability();
        sendToSocket(ws, ServerMsg.QUEUE_AVAILABILITY, availability as unknown as Record<string, unknown>);
        // Send MOTO/USD price for portfolio display
        if (config.motoUsdPrice > 0) {
            sendToSocket(ws, ServerMsg.MOTO_PRICE, { price: config.motoUsdPrice });
        }
        // Reconnect to active game if any
        const activeGame = getGameByPlayer(address);
        if (activeGame) {
            const { matchId, game } = activeGame;
            assignToMatch(ws, matchId);
            game.markReconnected(address);
            const snapshot = game.getReconnectSnapshot(address);
            sendToSocket(ws, ServerMsg.GAME_RECONNECT, snapshot);
            const playerAddresses = snapshot['players'] as string[];
            const nameMap = db.getDisplayNames(playerAddresses);
            const displayNames: Record<string, string> = {};
            for (const addr of playerAddresses) {
                displayNames[addr] = nameMap.get(addr) ?? addr.slice(0, 8) + '…';
            }
            sendToSocket(ws, ServerMsg.DISPLAY_NAMES, { names: displayNames });
        }
    } else {
        // Token invalid/expired — client should fall back to wallet signing
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Token expired' });
    }
}

function handleQueue(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;

    // BUG-2 FIX: Prevent queuing while in an active game
    const activeGame = getGameByPlayer(address);
    if (activeGame) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Already in an active game. Finish or abandon first.' });
        return;
    }

    const tier = msg['tier'] as number | undefined;
    const mode = msg['mode'] as number | undefined;
    const format = msg['format'] as number | undefined;

    if (tier === undefined || mode === undefined || format === undefined) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing tier, mode, or format' }); return;
    }

    // Validate tier (0=Bronze, 1=Silver, 2=Gold)
    if (!isValidTier(tier)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid tier (0=Bronze, 1=Silver, 2=Gold)' }); return;
    }
    if (typeof mode !== 'number' || !Number.isInteger(mode) || mode < 0 || mode > 2) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid mode (0-2)' }); return;
    }
    if (typeof format !== 'number' || !Number.isInteger(format) || format < 0 || format > 1) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid format (0-1)' }); return;
    }
    // GDD §5.2: Survival mode is Arena-only (reject Survival+Duel)
    if (mode === 1 && format === 0) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Survival mode requires Arena format' }); return;
    }

    // Validate tier unlock + queue collapse
    const rejection = validateQueueRequest(address, tier as BuyInTierValue, mode, format);
    if (rejection) {
        sendToSocket(ws, ServerMsg.ERROR, { message: rejection }); return;
    }

    // Resolve tier → on-chain buy-in amount
    const buyIn = getTierBuyIn(tier as BuyInTierValue);
    queuePlayer(address, buyIn, mode, format, ws);
}

function handleLeaveQueue(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    dequeuePlayer(getPlayerAddress(wsId)!);
    sendToSocket(ws, ServerMsg.LOBBY_UPDATE, { action: 'left_queue' });
}

function handleTrade(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const matchId = msg['matchId'] as string | undefined;
    const action = msg['action'] as string | undefined;
    if (!matchId || !action) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing matchId or action' }); return;
    }
    if (!VALID_ACTIONS.has(action)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Use OPEN_LONG, OPEN_SHORT, or CLOSE' }); return;
    }
    if (!isValidMatchId(matchId)) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid matchId' }); return; }
    // BE-7 FIX: Verify player's socket is assigned to this match (prevents cross-match trades)
    const socketMatchId = ws._data.matchId;
    if (socketMatchId !== matchId) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Not in this match' }); return;
    }
    const game = getGame(BigInt(matchId));
    if (!game) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Match not found' }); return; }
    const queued = game.queueTrade(address, action as TradeAction);
    if (!queued) sendToSocket(ws, ServerMsg.ERROR, { message: 'Trade rejected — game not in progress' });
}

function handleUseItem(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const matchId = msg['matchId'] as string | undefined;
    const itemId = msg['itemId'] as number | undefined;
    const target = msg['target'] as string | undefined;  // Optional: explicit target for Arena
    if (!matchId || itemId === undefined) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing matchId or itemId' }); return;
    }
    // A-05 FIX: Bounds-check itemId at WS layer (valid range 1–14)
    if (typeof itemId !== 'number' || !Number.isInteger(itemId) || itemId < 1 || itemId > 14) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid itemId (must be 1-14)' }); return;
    }
    if (typeof matchId !== 'string' || !isValidMatchId(matchId)) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid matchId' }); return; }
    const game = getGame(BigInt(matchId));
    if (!game) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Match not found' }); return; }
    const queued = game.queueItemUse(address, itemId as ItemIdValue, target ?? null);
    if (!queued) sendToSocket(ws, ServerMsg.ERROR, { message: 'Cannot use items now' });
}

function handleReportMatchId(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const matchIdStr = msg['matchId'] as string | undefined;
    if (!matchIdStr || !isValidMatchId(matchIdStr)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid matchId' }); return;
    }
    reportMatchId(address, BigInt(matchIdStr));
}

function handleGetProfile(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const stats = db.getPlayerStats(address);
    const profile = db.getProfile(address);

    // Volume is stored in MOTO units (not wei) — use directly
    const volumeMoto = Number(stats?.total_volume ?? '0');

    const rank = getRank(volumeMoto);
    const rankProfile = buildRankProfile(volumeMoto);

    const totalPoints = getPlayerPoints(address);

    // Sprint 5: Per-mode stats
    const classicStats = db.getPlayerModeStats(address, 0);
    const survivalStats = db.getPlayerModeStats(address, 1);
    const chaosStats = db.getPlayerModeStats(address, 2);
    const classicMastery = getModeMastery(address, 'classic');
    const survivalMastery = getModeMastery(address, 'survival');
    const chaosMastery = getModeMastery(address, 'chaos');

    sendToSocket(ws, ServerMsg.PROFILE_DATA, {
        address,
        totalPoints,
        matchesPlayed: stats?.matches_played ?? 0,
        wins: stats?.wins ?? 0,
        losses: stats?.losses ?? 0,
        totalEarnings: stats?.total_earnings ?? '0',
        totalVolume: stats?.total_volume ?? '0',
        bestRank: stats?.best_rank ?? 999,
        // Constellation rank fields (new)
        rankName: rank.name,
        rankIndex: rank.index,
        rankColor: rank.color,
        rankSection: rankProfile.rankSection,
        rankProgress: rankProfile.rankProgress,
        nextRankVolume: rankProfile.nextRankVolume.toString(),
        nextRankName: rankProfile.nextRankName,
        // Backward compat (frontend reads these field names)
        tier: rank.name,
        tierEmoji: rank.name,
        tierColor: rank.color,
        tierName: rank.name,
        tierLevel: rank.index,
        tierProgress: rankProfile.rankProgress,
        twitterHandle: profile?.twitter_handle ?? null,

        // ── Sprint 5: Mode Stats ──
        classic: classicStats ? {
            matchesPlayed: classicStats.matches_played,
            wins: classicStats.wins,
            losses: classicStats.losses,
            winRate: classicStats.matches_played > 0 ? Math.round(classicStats.wins / classicStats.matches_played * 100) : 0,
            bestRank: classicStats.best_rank,
            bestStreak: classicStats.best_win_streak,
            totalTrades: classicStats.total_trades,
            totalItemsUsed: classicStats.total_items_used,
            avgTrades: classicStats.matches_played > 0 ? +(classicStats.total_trades_of_limit / classicStats.matches_played).toFixed(1) : 0,
            perfectReads: classicStats.perfect_reads,
            oneTradeWins: classicStats.one_trade_wins,
            fullTradeWins: classicStats.full_trade_wins,
            clutchWins: classicStats.clutch_wins,
            comebacks: classicStats.comebacks,
        } : null,

        survival: survivalStats ? {
            matchesPlayed: survivalStats.matches_played,
            wins: survivalStats.wins,
            losses: survivalStats.losses,
            winRate: survivalStats.matches_played > 0 ? Math.round(survivalStats.wins / survivalStats.matches_played * 100) : 0,
            bestRank: survivalStats.best_rank,
            bestStreak: survivalStats.best_win_streak,
            totalTrades: survivalStats.total_trades,
            totalItemsUsed: survivalStats.total_items_used,
            bountiesClaimed: survivalStats.total_bounties_claimed,
            ringEscapes: survivalStats.total_ring_escapes,
            itemsLooted: survivalStats.total_items_looted,
            bestSurvivalTick: survivalStats.best_survival_tick,
            survivedPast200: survivalStats.survived_past_200_count,
            noItemsWins: survivalStats.no_items_wins,
        } : null,

        chaos: chaosStats ? {
            matchesPlayed: chaosStats.matches_played,
            wins: chaosStats.wins,
            losses: chaosStats.losses,
            winRate: chaosStats.matches_played > 0 ? Math.round(chaosStats.wins / chaosStats.matches_played * 100) : 0,
            bestRank: chaosStats.best_rank,
            bestStreak: chaosStats.best_win_streak,
            totalTrades: chaosStats.total_trades,
            totalItemsUsed: chaosStats.total_items_used,
            mutatorsExperienced: chaosStats.total_mutators_experienced,
            flipsSurvived: chaosStats.total_flips_survived,
            profitableFlips: chaosStats.profitable_flips,
            goldRushPnl: +chaosStats.total_gold_rush_pnl.toFixed(4),
            robinHoodVictim: chaosStats.robin_hood_victim_count,
            bestMultiplierWin: chaosStats.best_chaos_multiplier_win,
            itemsUsedBestMatch: chaosStats.items_used_single_match_best,
        } : null,

        // Mode mastery levels
        classicMastery,
        survivalMastery,
        chaosMastery,
    });
}

function requireAuth(ws: GameSocket, wsId: string): boolean {
    if (!isAuthenticated(wsId)) { sendToSocket(ws, ServerMsg.ERROR, { message: 'Not authenticated' }); return false; }
    return true;
}

async function handleGetJackpot(ws: GameSocket, wsId: string): Promise<void> {
    if (!requireAuth(ws, wsId)) return;
    try {
        if (config.devMode) {
            // DEV: simulated jackpot
            sendToSocket(ws, ServerMsg.JACKPOT_DATA, { jackpot: '50000000000000000000' }); // 50 MOTO
        } else {
            const jackpot = await contractService.getJackpot();
            sendToSocket(ws, ServerMsg.JACKPOT_DATA, { jackpot: jackpot.toString() });
        }
    } catch (err) {
        logger.warn(TAG, 'Failed to fetch jackpot', err);
        sendToSocket(ws, ServerMsg.JACKPOT_DATA, { jackpot: '0' });
    }
}

// ── Username / Onboarding ──

async function handleStartTwitterAuth(ws: GameSocket, wsId: string): Promise<void> {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    try {
        const url = await startTwitterAuth(address);
        sendToSocket(ws, ServerMsg.TWITTER_AUTH_URL, { url });
    } catch (err) {
        logger.error(TAG, 'Twitter auth start failed', err);
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Twitter auth failed — try username instead' });
    }
}

function handleSetUsername(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const username = msg['username'] as string | undefined;
    const twitterHandle = msg['twitterHandle'] as string | undefined;

    if (!username || typeof username !== 'string') {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing username' }); return;
    }

    const trimmed = username.trim();

    // Validate length
    if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
        sendToSocket(ws, ServerMsg.ERROR, { message: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters` }); return;
    }

    // Validate characters
    if (!USERNAME_REGEX.test(trimmed)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Username: letters, numbers, underscores only' }); return;
    }

    // Check reserved
    if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'That username is reserved' }); return;
    }

    // Check uniqueness (allow updating own username)
    const existingProfile = db.getProfile(address);
    if (existingProfile?.username.toLowerCase() !== trimmed.toLowerCase() && db.isUsernameTaken(trimmed)) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Username already taken' }); return;
    }

    // Validate twitter handle if provided
    let cleanTwitter: string | undefined;
    if (twitterHandle && typeof twitterHandle === 'string') {
        cleanTwitter = twitterHandle.trim().replace(/^@/, '');
        if (cleanTwitter.length > 0 && !/^[a-zA-Z0-9_]{1,15}$/.test(cleanTwitter)) {
            sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid Twitter handle' }); return;
        }
        if (cleanTwitter.length === 0) cleanTwitter = undefined;
    }

    const ok = db.setProfile(address, trimmed, cleanTwitter);
    if (!ok) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Failed to save username' }); return;
    }

    logger.info(TAG, `Profile set: ${address} → @${trimmed}${cleanTwitter ? ` (𝕏 @${cleanTwitter})` : ''}`);
    sendToSocket(ws, ServerMsg.PROFILE_READY, {
        address, displayName: trimmed, twitterHandle: cleanTwitter ?? null,
    });
}

// ── Quest Handlers ──

function handleGetQuests(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const quests = getPlayerQuests(address);
    const totalPoints = getPlayerPoints(address);
    sendToSocket(ws, ServerMsg.QUEST_DATA, { quests, totalPoints });
}

function handleClaimQuest(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const questId = msg['questId'] as string | undefined;
    if (!questId) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing questId' }); return;
    }
    const result = claimSocialQuest(address, questId);
    if (result.success) {
        // Credit referral bonus to referrer (5% of points earned)
        db.creditReferralBonus(address, result.points);
        const totalPoints = getPlayerPoints(address);
        sendToSocket(ws, ServerMsg.QUEST_CLAIMED, { questId, points: result.points, totalPoints });
    } else {
        sendToSocket(ws, ServerMsg.ERROR, { message: result.error ?? 'Claim failed' });
    }
}

// ── Referral Handlers ──

function handleGetReferralStats(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const stats = db.getReferralStats(address);
    sendToSocket(ws, ServerMsg.REFERRAL_DATA, stats as unknown as Record<string, unknown>);
}

function handleApplyReferral(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const code = msg['code'] as string | undefined;

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
        sendToSocket(ws, ServerMsg.REFERRAL_APPLIED, { success: false, error: 'Missing referral code' }); return;
    }

    const trimmedCode = code.trim();

    // Resolve the referral code to a referrer address
    const referrerAddress = db.resolveReferralCode(trimmedCode);
    if (!referrerAddress) {
        sendToSocket(ws, ServerMsg.REFERRAL_APPLIED, { success: false, error: 'Invalid referral code' }); return;
    }

    if (referrerAddress === address) {
        sendToSocket(ws, ServerMsg.REFERRAL_APPLIED, { success: false, error: 'Cannot use your own referral code' }); return;
    }

    const applied = db.applyReferral(address, referrerAddress);
    if (!applied) {
        sendToSocket(ws, ServerMsg.REFERRAL_APPLIED, { success: false, error: 'Already referred' }); return;
    }

    logger.info(TAG, `🔗 Referral applied: ${address.slice(0, 8)} referred by ${referrerAddress.slice(0, 8)}`);
    sendToSocket(ws, ServerMsg.REFERRAL_APPLIED, {
        success: true,
        bonusPoints: 50, // referred player bonus
    });
}

// ── Battle Log Handler ──

function handleGetBattleLog(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const limit = typeof msg['limit'] === 'number' ? Math.min(msg['limit'] as number, 50) : 30;
    const entries = db.getPlayerMatchHistory(address, limit);
    sendToSocket(ws, ServerMsg.BATTLE_LOG_DATA, { entries });
}

// ── Buy-In Tier Handlers ──

function handleGetTierStatus(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const tiers = getAllTierStatus(address);
    sendToSocket(ws, ServerMsg.TIER_STATUS, { tiers });
}

function handleGetQueueAvailability(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const availability = getQueueAvailability();
    sendToSocket(ws, ServerMsg.QUEUE_AVAILABILITY, availability as unknown as Record<string, unknown>);
}

// ── Chat Handlers ──

function handleChatSend(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const channel = msg['channel'] as string | undefined;
    const text = msg['text'] as string | undefined;
    const target = msg['target'] as string | undefined; // for whisper

    if (!channel || !text) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing channel or text' }); return;
    }

    // Rate limit check
    const rateErr = canSendChat(address);
    if (rateErr) {
        sendToSocket(ws, ServerMsg.ERROR, { message: rateErr }); return;
    }

    // Validate text
    const { sanitized, error } = validateChatText(text);
    if (!sanitized || error) {
        sendToSocket(ws, ServerMsg.ERROR, { message: error ?? 'Invalid message' }); return;
    }

    switch (channel) {
        case ChatChannel.PUBLIC: {
            const chatMsg = sendPublicMessage(address, sanitized);
            if (chatMsg) {
                broadcastToAll(ServerMsg.CHAT_MESSAGE, chatMsg as unknown as Record<string, unknown>);
            }
            break;
        }
        case ChatChannel.GAME_ROOM: {
            const matchId = getPlayerMatchId(address);
            if (!matchId) {
                sendToSocket(ws, ServerMsg.ERROR, { message: 'Not in a game' }); return;
            }
            const chatMsg = sendGameRoomMessage(address, matchId, sanitized);
            if (chatMsg) {
                broadcastToMatch(BigInt(matchId), ServerMsg.CHAT_MESSAGE, chatMsg as unknown as Record<string, unknown>);
            }
            break;
        }
        case ChatChannel.WHISPER: {
            if (!target) {
                sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing whisper target' }); return;
            }
            const chatMsg = sendWhisperMessage(address, target, sanitized);
            if (chatMsg) {
                // Send to both sender and recipient
                sendToPlayer(address, ServerMsg.CHAT_MESSAGE, chatMsg as unknown as Record<string, unknown>);
                sendToPlayer(target, ServerMsg.CHAT_MESSAGE, chatMsg as unknown as Record<string, unknown>);
            }
            break;
        }
        default:
            sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid channel: ' + channel });
    }
}

function handleChatGetHistory(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const channel = msg['channel'] as string | undefined;

    if (!channel) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Missing channel' }); return;
    }

    switch (channel) {
        case ChatChannel.PUBLIC: {
            const messages = getPublicHistory();
            sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages });
            break;
        }
        case ChatChannel.ANNOUNCEMENT: {
            const messages = getAnnouncementHistory();
            sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages });
            break;
        }
        case ChatChannel.GAME_ROOM: {
            const matchId = getPlayerMatchId(address);
            if (!matchId) { sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages: [] }); return; }
            const messages = getGameRoomHistory(matchId);
            sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages });
            break;
        }
        case ChatChannel.WHISPER: {
            const target = msg['target'] as string | undefined;
            if (!target) { sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages: [] }); return; }
            const messages = getWhisperHistory(address, target);
            sendToSocket(ws, ServerMsg.CHAT_HISTORY, { channel, messages });
            break;
        }
        default:
            sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid channel' });
    }
}

// ── Leaderboard & Online Count ──

function handleGetLeaderboard(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    try {
        const pnlRows = db.getTopByEarnings(10);
        const volRows = db.getTopByVolume(10);
        const winRows = db.getTopByWins(10);

        const buildEntries = (rows: Array<{ address: string; value: string | number }>) =>
            rows.map((r, i) => {
                const volStats = db.getPlayerStats(r.address);
                const volumeMoto = Number(volStats?.total_volume ?? '0');
                const rank = getRank(volumeMoto);
                const profile = db.getProfile(r.address);
                return {
                    rank: i + 1,
                    address: r.address,
                    displayName: profile?.username ?? r.address.slice(0, 8) + '…',
                    value: r.value?.toString() ?? '0',
                    tier: rank.name,
                };
            });

        sendToSocket(ws, ServerMsg.LEADERBOARD_DATA, {
            pnl: buildEntries(pnlRows),
            volume: buildEntries(volRows),
            wins: buildEntries(winRows),
        });
    } catch (err) {
        logger.warn(TAG, 'Failed to build leaderboard', err);
        sendToSocket(ws, ServerMsg.LEADERBOARD_DATA, { pnl: [], volume: [], wins: [] });
    }
}

function handleGetOnlineCount(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    sendToSocket(ws, ServerMsg.ONLINE_COUNT, { count: getAuthenticatedCount() });
}

// ── Points V2 / ELO / Seasons (DEAD-02 FIX) ──

function handleGetPointsSummary(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const summary = getPlayerPointsSummary(address);
    const eloRow = db.getEloRating(address);
    sendToSocket(ws, ServerMsg.POINTS_SUMMARY, {
        volumePoints: summary.volumePoints,
        questPoints: summary.questPoints,
        total: summary.total,
        elo: eloRow?.elo ?? 1000,
    });
}

function handleGetSeasonInfo(ws: GameSocket, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const season = getCurrentSeason();
    sendToSocket(ws, ServerMsg.SEASON_INFO, {
        seasonId: season.seasonId,
        startDate: season.startDate,
        endDate: season.endDate,
        daysRemaining: season.daysRemaining,
        isActive: season.isActive,
    });
}

function handleGetEloLeaderboard(ws: GameSocket, msg: Record<string, unknown>, wsId: string): void {
    if (!requireAuth(ws, wsId)) return;
    const limit = typeof msg['limit'] === 'number' ? Math.min(msg['limit'] as number, 100) : 50;
    const entries = getEloLeaderboard(limit);
    // Enrich with display names
    const addresses = entries.map(e => e.address);
    const nameMap = db.getDisplayNames(addresses);
    const enriched = entries.map(e => ({
        ...e,
        displayName: nameMap.get(e.address) ?? e.address.slice(0, 8) + '…',
    }));
    sendToSocket(ws, ServerMsg.ELO_LEADERBOARD, { entries: enriched });
}

/**
 * v5.2 PATCHED: Handle deposit request with P0 security fixes.
 *
 * P0 FIX #1: Double-deposit prevention — check processed_deposits before crediting
 * P0 FIX #2: Use verified amount from verifyMotoTransfer (not frontend claim)
 * P1 FIX: Validate TX hash format
 */
async function handleDepositRequest(ws: GameSocket, msg: Record<string, unknown>, wsId: string): Promise<void> {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    const amountStr = msg['amount'] as string | undefined;
    const transferTxHash = msg['transferTxHash'] as string | undefined;
    if (!amountStr) {
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'error', error: 'Missing amount' });
        return;
    }
    if (!transferTxHash) {
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'error', error: 'Missing transfer TX hash' });
        return;
    }
    // P1 FIX: Validate TX hash format
    if (typeof transferTxHash !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(transferTxHash)) {
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'error', error: 'Invalid TX hash format' });
        return;
    }
    let amount: bigint;
    try {
        amount = BigInt(amountStr);
        if (amount <= 0n) throw new Error('non-positive');
    } catch {
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'error', error: 'Invalid amount' });
        return;
    }

    // ── P0 FIX #1: Double-deposit prevention ──
    if (db.isDepositProcessed(transferTxHash)) {
        logger.warn(TAG, `DOUBLE DEPOSIT BLOCKED: ${address} tried to reuse TX ${transferTxHash}`);
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, {
            status: 'error',
            error: 'This transfer has already been credited.',
        });
        return;
    }

    sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'verifying', amount: amountStr });
    logger.info(TAG, `Deposit request: ${address} transferred ${Number(amount) / 1e18} MOTO (tx: ${transferTxHash})`);
    try {
        // Step 1: Verify the MOTO transfer TX (P0 FIX #2: returns ACTUAL verified amount)
        const verifiedAmount = await contractService.verifyMotoTransfer(transferTxHash, address, amount);

        // P0 FIX #1: Mark TX as processed BEFORE crediting (prevents race condition)
        db.markDepositProcessed(transferTxHash, address, verifiedAmount.toString());

        // Step 2: Credit the player's escrow balance via operator TX
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'crediting', amount: verifiedAmount.toString() });
        const txHash = await contractService.operatorCreditDeposit(address, verifiedAmount);
        logger.info(TAG, `Deposit credit TX broadcast for ${address}: ${txHash} (verified: ${Number(verifiedAmount) / 1e18} MOTO)`);

        // SPRINT 2: Record in off-chain ledger for instant balance tracking
        db.recordEscrowChange(address, verifiedAmount.toString(), 'deposit', undefined, txHash);

        // SPRINT 3: Push updated balance to player immediately
        const newBalance = db.getOffchainEscrowBalance(address);
        sendToSocket(ws, ServerMsg.ESCROW_BALANCE, { balance: newBalance.toString(), source: 'offchain' });

        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, { status: 'broadcast', amount: verifiedAmount.toString(), txHash });
    } catch (err) {
        logger.error(TAG, `Deposit failed for ${address}`, err);
        logger.warn(TAG, `⚠️  Deposit TX ${transferTxHash} for ${address} may need manual review.`);
        sendToSocket(ws, ServerMsg.DEPOSIT_STATUS, {
            status: 'error',
            error: String(err).slice(0, 120),
        });
    }
}

/**
 * SPRINT 3: Get escrow balance from off-chain ledger (instant, no block wait).
 * Falls back to on-chain if no ledger entries exist (pre-Sprint2 deposits).
 * Sprint 2 FIX: Uses getPlayerBalanceOrNull to avoid error spam for new wallets
 * whose public key hasn't been indexed by the OPNet node yet.
 */
async function handleGetEscrowBalance(ws: GameSocket, wsId: string): Promise<void> {
    if (!requireAuth(ws, wsId)) return;
    const address = getPlayerAddress(wsId)!;
    try {
        const offchainBalance = db.getOffchainEscrowBalance(address);
        const hasLedger = offchainBalance !== 0n || db.getEscrowLedger(address, 1).length > 0;

        if (hasLedger) {
            sendToSocket(ws, ServerMsg.ESCROW_BALANCE, {
                balance: offchainBalance.toString(),
                source: 'offchain',
            });
        } else {
            // No ledger entries — try on-chain (graceful: returns null if address unresolvable)
            const onchainBalance = await contractService.getPlayerBalanceOrNull(address);
            if (onchainBalance !== null) {
                sendToSocket(ws, ServerMsg.ESCROW_BALANCE, {
                    balance: onchainBalance.toString(),
                    source: 'onchain',
                });
            } else {
                // Sprint 2 FIX: New wallet — node hasn't indexed pubkey yet.
                // Return 0 with 'new_player' source instead of error spam.
                // Balance will update once they make their first deposit.
                sendToSocket(ws, ServerMsg.ESCROW_BALANCE, {
                    balance: '0',
                    source: 'new_player',
                });
            }
        }
    } catch (err) {
        logger.warn(TAG, `Balance check failed for ${address}: ${err}`);
        sendToSocket(ws, ServerMsg.ESCROW_BALANCE, { balance: '0', source: 'error' });
    }
}
