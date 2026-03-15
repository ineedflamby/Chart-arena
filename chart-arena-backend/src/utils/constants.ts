// ── Match Status (on-chain) ──
export const MatchStatus = {
    NONE: 0, OPEN: 1, LOCKED: 2, SETTLED: 3, CANCELLED: 4, REFUNDED: 5,
} as const;
export type MatchStatusValue = (typeof MatchStatus)[keyof typeof MatchStatus];

// ── Game Mode ──
export const GameMode = { CLASSIC: 0, SURVIVAL: 1, CHAOS: 2 } as const;
export type GameModeValue = (typeof GameMode)[keyof typeof GameMode];

// ── Format ──
export const Format = { DUEL: 0, ARENA: 1 } as const;
export type FormatValue = (typeof Format)[keyof typeof Format];

export function maxPlayers(format: FormatValue): number {
    return format === Format.DUEL ? 2 : 5;
}

// ── Rake (GDD §6.1-6.2) ──
export const RAKE_BPS = 1000;
export const BPS_DENOMINATOR = 10000;
export const PODIUM_DUEL = [10000]; // Winner 100%
// Bug 6.6: Extended to 5 splits — all Arena players get a defined payout position
export const PODIUM_ARENA = [5000, 2500, 1200, 700, 600]; // 50/25/12/7/6
export const MOTO_DECIMALS = 18;

// ── Game Phases (GDD §1.2) ──
// Standard match = 240 ticks (4 minutes at 1 tick/second)
export const STANDARD_TICKS = 240;
export const SURVIVAL_TICKS = 300;

export const Phase = {
    OPEN: 'OPEN',
    MID: 'MID',
    CRUNCH: 'CRUNCH',
    OVERTIME: 'OVERTIME',
} as const;
export type PhaseValue = (typeof Phase)[keyof typeof Phase];

export interface PhaseConfig {
    readonly name: PhaseValue;
    readonly startTick: number;
    readonly endTick: number;         // exclusive
    readonly volatilityMultiplier: number;
}

// GDD §1.2: OPEN 0:00→0:45, MID 0:45→2:45, CRUNCH 2:45→3:30, OVERTIME 3:30→4:00
export const PHASES: PhaseConfig[] = [
    { name: Phase.OPEN,     startTick: 0,   endTick: 45,  volatilityMultiplier: 0.6 },
    { name: Phase.MID,      startTick: 45,  endTick: 165, volatilityMultiplier: 1.0 },
    { name: Phase.CRUNCH,   startTick: 165, endTick: 210, volatilityMultiplier: 1.5 },
    { name: Phase.OVERTIME, startTick: 210, endTick: 240, volatilityMultiplier: 2.0 },
];

// R-10: Survival uses extended OVERTIME (4:00→5:00 = ticks 210-300)
export const SURVIVAL_PHASES: PhaseConfig[] = [
    { name: Phase.OPEN,     startTick: 0,   endTick: 45,  volatilityMultiplier: 0.6 },
    { name: Phase.MID,      startTick: 45,  endTick: 165, volatilityMultiplier: 1.0 },
    { name: Phase.CRUNCH,   startTick: 165, endTick: 210, volatilityMultiplier: 1.5 },
    { name: Phase.OVERTIME, startTick: 210, endTick: 300, volatilityMultiplier: 2.0 },
];

export function getPhase(tick: number, mode?: GameModeValue): PhaseConfig {
    const phases = mode === GameMode.SURVIVAL ? SURVIVAL_PHASES : PHASES;
    for (const p of phases) {
        if (tick >= p.startTick && tick < p.endTick) return p;
    }
    return phases[phases.length - 1]; // fallback to OVERTIME
}

// R-11: Chaos base volatility multiplier (GDD §5.3)
export const CHAOS_VOLATILITY_MULTIPLIER = 1.3;

// R-10: Survival internal leverage (GDD §5.2)
export const SURVIVAL_LEVERAGE = 2;

// R-10: Survival payout tables by survivor count (GDD §5.2, FIX #66)
// Each array sums to 10000 (100%). Last entry gets remainder.
export const SURVIVAL_PAYOUTS: Record<number, number[]> = {
    1: [10000],                         // 100%
    2: [6500, 3500],                    // 65% / 35%
    3: [6500, 2500, 1000],              // 65% / 25% / 10%
    4: [5000, 2500, 1500, 1000],        // 50% / 25% / 15% / 10%
    5: [4000, 2500, 1500, 1200, 800],   // 40% / 25% / 15% / 12% / 8%
};

// ── Trading Rules (GDD §3.1-3.2) ──
export const STARTING_CAPITAL = 5.0;        // $5 (GDD §3.1)
export const START_PRICE = 100.0;           // Always 100.00 (GDD §2.1)
export const COOLDOWN_OPEN_CLOSE = 5;       // 5s min before closing (GDD §3.2)
export const COOLDOWN_CLOSE_OPEN = 3;       // 3s before reopening (GDD §3.2)
export const MAX_TRADES_PER_MATCH = 9999;   // Unlimited trades
export const BASE_SLIPPAGE = 0.001;         // 0.1% (GDD §3.2)

// ── Flat Penalty (GDD §3.2) ──
// LOGIC-16: Renamed penaltyPct → penaltyPerTick (it's a flat $ amount deducted per tick, not a %)
export const FLAT_PENALTY_CLASSIC_ARENA = { thresholdSec: 90, penaltyPerTick: 0.01, intervalSec: 30 };
export const FLAT_PENALTY_CLASSIC_DUEL  = { thresholdSec: 60, penaltyPerTick: 0.015, intervalSec: 30 };
export const FLAT_PENALTY_CHAOS         = { thresholdSec: 60, penaltyPerTick: 0.02, intervalSec: 30 };
// Survival: no flat penalty

// ── WebSocket message types ──
export const ServerMsg = {
    ERROR: 'error', NONCE: 'nonce', AUTH_OK: 'auth_ok',
    LOBBY_UPDATE: 'lobby_update', MATCH_CREATED: 'match_created',
    MATCH_JOIN_READY: 'match_join_ready',  // { matchId } — sent to joiners after creator reports matchId
    // DEAD-08: MATCH_JOINED/MATCH_LOCKED removed — never sent by matchmaking.ts
    LOBBY_COUNTDOWN: 'lobby_countdown',  // R-18: { secondsLeft }
    SEED_REVEAL: 'seed_reveal',          // R-18: { seed }
    GAME_START: 'game_start', GAME_RECONNECT: 'game_reconnect',
    CANDLE_UPDATE: 'candle_update',
    TRADE_EXECUTED: 'trade_executed', TRADE_REJECTED: 'trade_rejected',
    GAME_END: 'game_end', // DEAD-07: ROUND_END removed — game uses continuous ticks
    SETTLEMENT: 'settlement', PORTFOLIO_UPDATE: 'portfolio_update',
    PREVIEW_TICK: 'preview_tick',
    PREVIEW_END: 'preview_end',
    ITEM_DROP: 'item_drop',
    ITEM_USED: 'item_used',
    ITEM_REJECTED: 'item_rejected',
    PHASE_CHANGE: 'phase_change',
    ELIMINATION: 'elimination',          // R-10: { address, tick }
    FOG_UPDATE: 'fog_update',            // T1: { foggedPlayers: string[] }
    XRAY_DATA: 'xray_data',             // T1: { inventories: Record<string, number[]> }
    THICK_SKIN_BLOCK: 'thick_skin_block', // T1: { blocker, attacker, blockedItem }
    SCRAMBLE_ACTIVE: 'scramble_active',   // T2: { scrambler } — fake leaderboard for others
    MIRROR_CURSE_ACTIVE: 'mirror_curse',  // T2: { cursedPlayers } — inverted chart
    MUTE_ACTIVE: 'mute_active',           // T2: { mutedPlayers } — PnL hidden
    SHOCKWAVE_START: 'shockwave_start',   // T3: volatility x3 started
    SHOCKWAVE_END: 'shockwave_end',       // T3: volatility x3 ended
    // DEAD-04: TIME_WARP_START/END removed (LOGIC-22: Time Warp never fires)
    BLACKOUT_UPDATE: 'blackout_update',   // T3: { blackoutUser } — null = ended
    HEIST: 'heist',                       // T3: { thief, victim, stolenItem }
    PROFILE_DATA: 'profile_data',         // { address, stats, tier info }
    JACKPOT_DATA: 'jackpot_data',         // #11: { jackpot: string }
    // Chat
    CHAT_MESSAGE: 'chat_message',         // { channel, sender, senderDisplay, text, timestamp }
    CHAT_HISTORY: 'chat_history',         // { channel, messages[] }
    // Profiles / Onboarding
    PROFILE_SETUP_REQUIRED: 'profile_setup_required',  // { address } — no username set yet
    PROFILE_READY: 'profile_ready',       // { address, displayName, twitterHandle? }
    DISPLAY_NAMES: 'display_names',       // { names: Record<string, string> }
    TWITTER_AUTH_URL: 'twitter_auth_url',  // { url } — open this in popup
    QUEST_DATA: 'quest_data',             // { quests[], totalPoints }
    QUEST_COMPLETED: 'quest_completed',   // { questId, title, emoji, points, totalPoints }
    QUEST_CLAIMED: 'quest_claimed',       // { questId, points, totalPoints }
    // Referral System
    REFERRAL_DATA: 'referral_data',       // { code, referralUrl, totalReferrals, totalBonusPoints, referredPlayers[], hasReferrer }
    REFERRAL_APPLIED: 'referral_applied', // { success, bonusPoints?, error? }
    // Battle Log
    BATTLE_LOG_DATA: 'battle_log_data',   // { entries: BattleLogEntry[] }
    // Leaderboard + Online Count
    LEADERBOARD_DATA: 'leaderboard_data', // { pnl[], volume[], wins[] }
    ONLINE_COUNT: 'online_count',         // { count: number }
    // Buy-In Tiers
    TIER_STATUS: 'tier_status',               // { tiers: TierUnlockStatus[] }
    QUEUE_AVAILABILITY: 'queue_availability',  // { onlinePlayers, available[], nextUnlock }
    MOTO_PRICE: 'moto_price',                 // { price: number } — MOTO/USD market price
    // ── Points V2 / ELO / Seasons (DEAD-02 FIX) ──
    POINTS_SUMMARY: 'points_summary',         // { volumePoints, questPoints, total }
    ELO_UPDATE: 'elo_update',                 // { address, oldElo, newElo, delta }
    SEASON_INFO: 'season_info',               // { seasonId, startDate, endDate, daysRemaining, isActive }
    ELO_LEADERBOARD: 'elo_leaderboard',       // { entries: [{ address, elo, rank }] }
    // v5.1: Deposit via operator
    DEPOSIT_STATUS: 'deposit_status',           // { status, amount?, txHash?, error? }
    // SPRINT 3: Off-chain balance query
    ESCROW_BALANCE: 'escrow_balance',           // { balance: string, source: 'offchain'|'onchain' }
} as const;

// ── R-18: Lobby durations ──
// SPRINT 3: Reduced from 15/20/5 to 5/10/2 — 40s ceremony → 17s for Duel, 22s for Arena
export const LOBBY_DURATION_DUEL = 5;    // was 15
export const LOBBY_DURATION_ARENA = 10;  // was 20
export const SEED_REVEAL_DURATION = 2;   // was 5

export const ClientMsg = {
    AUTH: 'auth', QUEUE: 'queue', LEAVE_QUEUE: 'leave_queue',
    TRADE: 'trade', REPORT_MATCH_ID: 'report_match_id',
    USE_ITEM: 'use_item',
    GET_PROFILE: 'get_profile',
    GET_JACKPOT: 'get_jackpot',     // #11: request current jackpot
    CHAT_SEND: 'chat_send',         // { channel, text, target? }
    CHAT_GET_HISTORY: 'chat_get_history', // { channel }
    SET_USERNAME: 'set_username',    // { username, twitterHandle? }
    START_TWITTER_AUTH: 'start_twitter_auth', // no params — starts OAuth flow
    GET_QUESTS: 'get_quests',            // no params — returns quest data
    CLAIM_QUEST: 'claim_quest',          // { questId }
    // Referral System
    GET_REFERRAL_STATS: 'get_referral_stats',  // no params
    APPLY_REFERRAL: 'apply_referral',          // { code }
    // Battle Log
    GET_BATTLE_LOG: 'get_battle_log',          // no params (or { limit? })
    // Leaderboard + Online Count
    GET_LEADERBOARD: 'get_leaderboard',        // no params
    GET_ONLINE_COUNT: 'get_online_count',       // no params
    // Buy-In Tiers
    GET_TIER_STATUS: 'get_tier_status',           // no params — returns tier unlock status
    GET_QUEUE_AVAILABILITY: 'get_queue_availability', // no params — returns which queues are open
    // ── Points V2 / ELO / Seasons (DEAD-02 FIX) ──
    GET_POINTS_SUMMARY: 'get_points_summary',       // no params — returns volume + quest point breakdown
    GET_SEASON_INFO: 'get_season_info',             // no params — returns current season info
    GET_ELO_LEADERBOARD: 'get_elo_leaderboard',     // { limit? } — returns ELO rankings
    // v5.1: Deposit via operator (avoids frontend cross-contract simulation issue)
    DEPOSIT_REQUEST: 'deposit_request',              // { amount: string } — amount in wei
    // SPRINT 3: Off-chain balance query
    GET_ESCROW_BALANCE: 'get_escrow_balance',        // no params — returns off-chain ledger balance
} as const;

// ── Chat Channels ──
export const ChatChannel = {
    PUBLIC: 'public',
    ANNOUNCEMENT: 'announcement',
    WHISPER: 'whisper',
    GAME_ROOM: 'game_room',
} as const;
export type ChatChannelValue = (typeof ChatChannel)[keyof typeof ChatChannel];

export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 1000;  // 1 message per second
export const CHAT_HISTORY_SIZE = 100;  // store last 100 per channel

// ── Username Rules ──
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 16;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;  // alphanumeric + underscore
export const RESERVED_USERNAMES = new Set([
    'system', 'admin', 'bot', 'mod', 'moderator', 'chart', 'arena',
    'chartarena', 'you', 'unknown', 'anonymous', 'null', 'undefined',
]);
