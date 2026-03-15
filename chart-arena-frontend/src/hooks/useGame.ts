import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { gameWS } from '../services/ws';
import { aggregateCandles, type Candle, type PriceTick } from '../utils/candles';
import { sound } from '../services/sound';
import { str, num, bool, arr, validateTick, validateItemDrops, validateStandings } from '../services/wsGuards';

export type Screen = 'lobby' | 'onboarding' | 'queue' | 'waiting_onchain' | 'lobby_countdown' | 'seed_reveal' | 'preview' | 'playing' | 'results';
export type PositionStatus = 'FLAT' | 'LONG' | 'SHORT';
export type TradeAction = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE';

export type { PriceTick, Candle };
export interface Standing { address: string; rank: number; finalEquity: number; positionStatus: PositionStatus; eliminated?: boolean; eliminatedAtTick?: number; }

export interface ItemDrop { player: string; item: number; tick: number; }
export interface ItemUseEvent { player: string; item: number; target: string | null; tick: number; }

// Chat
export type ChatChannel = 'public' | 'announcement' | 'whisper' | 'game_room';
export interface ChatMessage {
    id: number;
    channel: ChatChannel;
    sender: string;
    senderDisplay: string;
    text: string;
    timestamp: number;
    matchId?: string;
    whisperTo?: string;
}

// Quests
export interface QuestStatus {
    id: string;
    category: 'volume' | 'social' | 'play' | 'win' | 'streak' | 'special' | 'classic' | 'survival' | 'chaos' | 'crossmode';
    title: string;
    description: string;
    emoji: string;
    points: number;
    completed: boolean;
    progress: number;
    current: number;
    requirement: number;
    actionUrl?: string;
    sortOrder: number;
    comingSoon?: boolean;
}

// Referral System
export interface ReferralData {
    code: string;
    referralUrl: string;
    totalReferrals: number;
    totalBonusPoints: number;
    referredPlayers: Array<{ address: string; displayName: string }>;
    hasReferrer: boolean;
}

// Battle Log
export interface BattleLogEntry {
    matchId: string;
    mode: number;
    format: number;
    buyIn: string;
    playerCount: number;
    rank: number;
    finalEquity: number;
    timestamp: number;
}

// Leaderboard
export interface LeaderboardEntry {
    rank: number;
    address: string;
    displayName: string;
    value: string;
    tier: string;
}

export interface LeaderboardData {
    pnl: LeaderboardEntry[];
    volume: LeaderboardEntry[];
    wins: LeaderboardEntry[];
}

// Winner ticker entry (extracted from announcements)
export interface WinnerTickerEntry {
    name: string;
    pnl: number;
    mode: string;
}

// All item IDs matching backend v4 — synced with game/items.ts
export const ITEM_NAMES: Record<number, { name: string; emoji: string; desc: string; tier: number }> = {
    // T1 — Trading Powers
    1:  { name: 'Ghost Trade', emoji: '👻', desc: 'Zero slippage + hidden position for 8s.', tier: 1 },
    2:  { name: 'Shield', emoji: '🛡', desc: 'Block next attack. 50% reflect. Grants Boost on block.', tier: 1 },
    3:  { name: 'Scalp', emoji: '⚡', desc: 'Auto-trade: momentum detection, 3× leverage, auto-close in 3s.', tier: 1 },
    4:  { name: 'Radar', emoji: '📡', desc: 'Reveal all positions, equity & inventories 10s. Breaks Ghost Trade.', tier: 1 },
    5:  { name: 'Boost', emoji: '🚀', desc: 'Next trade ×1.5 returns (gains AND losses). Visible to opponents.', tier: 1 },
    // T2 — Direct Attacks
    6:  { name: 'Freeze', emoji: '🧊', desc: "Can't open for 5s. Close at 5× slippage. Flat = 1%/s bleed.", tier: 2 },
    7:  { name: 'Mirror Curse', emoji: '🪞', desc: 'Target sees inverted chart for 8s.', tier: 2 },
    8:  { name: 'Drain', emoji: '🩸', desc: 'Steal 8% of target equity. You gain it, they lose it.', tier: 2 },
    9:  { name: 'Glitch', emoji: '👾', desc: "Target's chart freezes (stale data) for 6s.", tier: 2 },
    10: { name: 'Swap', emoji: '🔄', desc: 'Swap position direction AND entry price with target.', tier: 2 },
    // T3 — Ultimates
    11: { name: 'Nuke', emoji: '☢️', desc: 'Force-close ALL exposed. Price drops 3-5% scaled by victims.', tier: 3 },
    12: { name: 'Blackout', emoji: '🌑', desc: 'Everyone else loses UI 6s. You get 2s price preview.', tier: 3 },
    13: { name: 'Earthquake', emoji: '🌋', desc: 'Volatility ×5 for 8s. All cooldowns reduced to 1s.', tier: 3 },
    14: { name: 'Heist', emoji: '💰', desc: 'Steal 10% equity from #1 player.', tier: 3 },
};

// Sprint 5: Per-mode stats returned by profile API
export interface ModeProfileStats {
    matchesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    bestRank: number;
    bestStreak: number;
    totalTrades: number;
    totalItemsUsed: number;
    // Classic-specific
    avgTrades?: number;
    perfectReads?: number;
    oneTradeWins?: number;
    fullTradeWins?: number;
    clutchWins?: number;
    comebacks?: number;
    // Survival-specific
    bountiesClaimed?: number;
    ringEscapes?: number;
    itemsLooted?: number;
    bestSurvivalTick?: number;
    survivedPast200?: number;
    noItemsWins?: number;
    // Chaos-specific
    mutatorsExperienced?: number;
    flipsSurvived?: number;
    profitableFlips?: number;
    goldRushPnl?: number;
    robinHoodVictim?: number;
    bestMultiplierWin?: number;
    itemsUsedBestMatch?: number;
}

export interface GameState {
    screen: Screen;
    connected: boolean;
    authenticated: boolean;
    address: string | null;
    devMode: boolean;

    // Queue
    queuePosition: number;
    queueNeeded: number;
    queueMessage: string | null;

    // R-18: Lobby + Seed Reveal
    lobbySecondsLeft: number;
    seed: string | null;

    // Match
    matchId: string | null;
    players: string[];
    totalTicks: number;

    // Chart data (raw 1s ticks — use candles computed property for display)
    previewTicks: PriceTick[];
    priceTicks: PriceTick[];
    currentTick: number;
    currentPhase: string;

    // Player state
    equity: number;
    positionStatus: PositionStatus;
    entryPrice: number;
    startingCapital: number;

    // Items
    inventory: number[];
    activeEffects: string[];
    lastItemEvent: string | null;
    toasts: Array<{ id: number; text: string; ts: number }>; // Toast notification queue

    // Standings
    standings: Standing[];
    lastTrade: { action: string; price: number } | null;
    lastReject: string | null;

    // Results
    finalStandings: Standing[];
    settlementTx: string | null;
    settlementStatus: string | null;
    eliminatedPlayers: string[];     // R-10: addresses of eliminated players
    foggedPlayers: string[];         // T1: players hidden by Fog of War
    xrayInventories: Record<string, number[]>; // T1: other players' items (when X-Ray active)
    thickSkinActive: boolean;        // T1: is our Thick Skin up?
    shockwaveActive: boolean;        // T3: volatility x3
    blackoutActive: boolean;         // T3: chart hidden (we are blacked out)
    blackoutUser: string | null;     // T3: who activated blackout
    scrambleActive: boolean;         // T2: leaderboard scrambled
    mirrorCursed: boolean;           // T2: our chart is inverted
    muted: boolean;                  // T2: our PnL is hidden
    targetingItemId: number | null;  // Item awaiting target selection (null = not targeting)
    frozen: boolean;                 // T2: we are frozen (can't trade)
    frozenAtTick: number;            // Tick when freeze was applied (-1 = none)
    timeWarpActive: boolean;         // T3: chart speed x3 active
    activeItemVFX: number | null;    // Item ID currently showing VFX (auto-clears)
    lastQueueSettings: { tier: number; mode: number; format: number } | null;
    tradeCount: number;              // Trade counter for display
    jackpotAmount: string;           // #11: Current jackpot in token units
    // Profile
    profileOpen: boolean;
    profile: {
        matchesPlayed: number; wins: number; losses: number;
        totalEarnings: string; totalVolume: string; bestRank: number;
        tier: string; tierEmoji: string; tierColor: string;
        tierName: string; tierLevel: number; tierProgress: number;
        nextTierVolume: string;
        // Sprint 5: Mode stats
        classic: ModeProfileStats | null;
        survival: ModeProfileStats | null;
        chaos: ModeProfileStats | null;
        classicMastery: { level: number; max: number };
        survivalMastery: { level: number; max: number };
        chaosMastery: { level: number; max: number };
    } | null;

    // Chat
    chatMessages: Record<ChatChannel, ChatMessage[]>;
    chatActiveTab: ChatChannel;
    chatUnread: Record<ChatChannel, number>;
    chatWhisperTarget: string | null;

    // Auth
    nonce: string | null;

    // Username / onboarding
    username: string | null;
    twitterHandle: string | null;
    usernameError: string | null;
    playerNames: Record<string, string>;  // address → display name (for leaderboard)

    // Quests
    quests: QuestStatus[];
    totalPoints: number;
    profileTab: 'stats' | 'missions' | 'referring' | 'battlelog';

    // Referral
    referralData: ReferralData | null;
    referralApplyMsg: { success: boolean; text: string } | null;

    // Battle Log
    battleLog: BattleLogEntry[];

    // Leaderboard + Online Count
    leaderboard: LeaderboardData;
    onlineCount: number;
    winnerTicker: WinnerTickerEntry[];

    // Production match flow (on-chain)
    onchainAction: 'create_match' | 'join_match' | null;
    onchainMatchId: string | null;  // matchId for joiners
    onchainBuyIn: string;           // buy-in amount for on-chain tx
    onchainError: string | null;
    blockProgress: { startBlock: number; currentBlock: number; elapsed: number; confirmed: boolean } | null;
    matchBuyIn: string;  // MOTO buy-in for current match
    motoUsdPrice: number;  // MOTO/USD market price for display
    motoUsdPriceTs: number;
}

const initialState: GameState = {
    screen: 'lobby', connected: false, authenticated: false, address: null, devMode: false,
    queuePosition: 0, queueNeeded: 2, queueMessage: null,
    lobbySecondsLeft: 0, seed: null,
    matchId: null, players: [], totalTicks: 240,
    previewTicks: [], priceTicks: [], currentTick: 0, currentPhase: 'OPEN',
    equity: 5.0, positionStatus: 'FLAT', entryPrice: 0, startingCapital: 5.0,
    inventory: [], activeEffects: [], lastItemEvent: null, toasts: [],
    standings: [], lastTrade: null, lastReject: null,
    finalStandings: [], settlementTx: null, settlementStatus: null,
    eliminatedPlayers: [],
    foggedPlayers: [], xrayInventories: {}, thickSkinActive: false, shockwaveActive: false, blackoutActive: false, blackoutUser: null, scrambleActive: false, mirrorCursed: false, muted: false, targetingItemId: null, frozen: false, frozenAtTick: -1, timeWarpActive: false, activeItemVFX: null, lastQueueSettings: null, tradeCount: 0, jackpotAmount: '0', profileOpen: false, profile: null,
    chatMessages: { public: [], announcement: [], whisper: [], game_room: [] },
    chatActiveTab: 'public', chatUnread: { public: 0, announcement: 0, whisper: 0, game_room: 0 },
    chatWhisperTarget: null,
    nonce: null,
    username: null,
    twitterHandle: null,
    usernameError: null,
    playerNames: {},
    quests: [],
    totalPoints: 0,
    profileTab: 'stats',
    referralData: null,
    referralApplyMsg: null,
    battleLog: [],
    leaderboard: { pnl: [], volume: [], wins: [] },
    onlineCount: 0,
    winnerTicker: [],
    onchainAction: null,
    onchainMatchId: null,
    onchainBuyIn: '0',
    onchainError: null,
    blockProgress: null,
    matchBuyIn: '0',
    motoUsdPrice: 0,
    motoUsdPriceTs: 0,
};

export function useGame() {
    const [state, setState] = useState<GameState>(initialState);

    // R-19: Compute 5s candles from raw 1s ticks (memoized)
    const candles = useMemo(() => aggregateCandles(state.priceTicks), [state.priceTicks]);
    const previewCandles = useMemo(() => aggregateCandles(state.previewTicks), [state.previewTicks]);

    useEffect(() => {
        gameWS.connect();
        const unsubs: Array<() => void> = [];

        unsubs.push(gameWS.on('_connected', () => setState((s) => ({ ...s, connected: true }))));
        unsubs.push(gameWS.on('_disconnected', () => setState((s) => ({ ...s, connected: false, nonce: null }))));
        unsubs.push(gameWS.on('nonce', (msg) => {
            setState((s) => ({ ...s, nonce: msg['nonce'] as string }));
        }));
        unsubs.push(gameWS.on('auth_ok', (msg) => {
            setState((s) => ({
                ...s,
                authenticated: true,
                address: msg['address'] as string,
            }));
            // Store session token for reconnect without re-signing
            const sessionToken = msg['sessionToken'] as string | undefined;
            if (sessionToken) {
                try { localStorage.setItem('ca-session-token', sessionToken); } catch {}
                try { localStorage.setItem('ca-session-address', msg['address'] as string); } catch {}
            }
            // #11: Request jackpot on auth
            gameWS.send('get_jackpot');
            // Request leaderboard + online count for lobby
            gameWS.send('get_leaderboard');
            gameWS.send('get_online_count');
            // Fetch profile + referral + quests for lobby tier card + points
            gameWS.send('get_profile');
            gameWS.send('get_quests');
            gameWS.send('get_referral_stats');
        }));

        // Profile: server says we need to pick a username
        unsubs.push(gameWS.on('profile_setup_required', () => {
            setState((s) => ({ ...s, screen: 'onboarding' }));
        }));

        // Profile: server says we're good (has username)
        unsubs.push(gameWS.on('profile_ready', (msg) => {
            setState((s) => ({
                ...s,
                username: msg['displayName'] as string,
                twitterHandle: (msg['twitterHandle'] as string) || null,
                screen: s.screen === 'onboarding' ? 'lobby' : s.screen,
                usernameError: null,
            }));
        }));

        // Display names map for match players
        unsubs.push(gameWS.on('display_names', (msg) => {
            setState((s) => ({ ...s, playerNames: msg['names'] as Record<string, string> }));
        }));

        // Twitter OAuth: open authorization URL in popup
        unsubs.push(gameWS.on('twitter_auth_url', (msg) => {
            const url = msg['url'] as string;
            if (url) {
                const w = 600, h = 700;
                const left = (screen.width - w) / 2;
                const top = (screen.height - h) / 2;
                window.open(url, 'twitter_auth', `width=${w},height=${h},left=${left},top=${top}`);
            }
        }));

        // #11: Jackpot data
        unsubs.push(gameWS.on('jackpot_data', (msg) => {
            setState((s) => ({ ...s, jackpotAmount: msg['jackpot'] as string }));
        }));

        // Quests
        unsubs.push(gameWS.on('quest_data', (msg) => {
            setState((s) => ({
                ...s,
                quests: msg['quests'] as QuestStatus[],
                totalPoints: msg['totalPoints'] as number,
            }));
        }));

        unsubs.push(gameWS.on('quest_completed', (msg) => {
            const questId = msg['questId'] as string;
            const points = msg['points'] as number;
            const totalPoints = msg['totalPoints'] as number;
            setState((s) => ({
                ...s,
                totalPoints,
                quests: s.quests.map(q => q.id === questId ? { ...q, completed: true, progress: 1 } : q),
                toasts: [...s.toasts.slice(-2), {
                    id: Date.now() + Math.random(),
                    text: `🎯 Quest complete: ${msg['emoji']} ${msg['title']} (+${points} pts)`,
                    ts: Date.now(),
                }],
            }));
        }));

        unsubs.push(gameWS.on('quest_claimed', (msg) => {
            const questId = msg['questId'] as string;
            const totalPoints = msg['totalPoints'] as number;
            setState((s) => ({
                ...s,
                totalPoints,
                quests: s.quests.map(q => q.id === questId ? { ...q, completed: true, progress: 1 } : q),
            }));
        }));

        // ── Referral System ──
        unsubs.push(gameWS.on('referral_data', (msg) => {
            setState((s) => ({
                ...s,
                referralData: {
                    code: msg['code'] as string,
                    referralUrl: msg['referralUrl'] as string,
                    totalReferrals: msg['totalReferrals'] as number,
                    totalBonusPoints: msg['totalBonusPoints'] as number,
                    referredPlayers: msg['referredPlayers'] as Array<{ address: string; displayName: string }>,
                    hasReferrer: msg['hasReferrer'] as boolean,
                },
            }));
        }));

        unsubs.push(gameWS.on('referral_applied', (msg) => {
            const success = msg['success'] as boolean;
            setState((s) => ({
                ...s,
                referralApplyMsg: {
                    success,
                    text: success
                        ? `Referral applied! +${msg['bonusPoints'] ?? 50} bonus pts`
                        : (msg['error'] as string) ?? 'Failed',
                },
            }));
            // Auto-clear after 4s
            setTimeout(() => setState((s) => ({ ...s, referralApplyMsg: null })), 4000);
        }));

        // ── Battle Log ──
        unsubs.push(gameWS.on('battle_log_data', (msg) => {
            setState((s) => ({
                ...s,
                battleLog: (msg['entries'] as BattleLogEntry[]) ?? [],
            }));
        }));

        // ── Leaderboard ──
        unsubs.push(gameWS.on('leaderboard_data', (msg) => {
            setState((s) => ({
                ...s,
                leaderboard: {
                    pnl: (msg['pnl'] as LeaderboardEntry[]) ?? [],
                    volume: (msg['volume'] as LeaderboardEntry[]) ?? [],
                    wins: (msg['wins'] as LeaderboardEntry[]) ?? [],
                },
            }));
        }));

        // ── Online Count ──
        unsubs.push(gameWS.on('online_count', (msg) => {
            setState((s) => ({ ...s, onlineCount: (msg['count'] as number) ?? 0 }));
        }));

        // MOTO/USD price updates from backend
        unsubs.push(gameWS.on('moto_price', (msg) => {
            const price = msg['price'] as number;
            if (typeof price === 'number' && price > 0) {
                setState((s) => ({ ...s, motoUsdPrice: price, motoUsdPriceTs: Date.now() }));
            }
        }));

        // ── Winner ticker: extract from announcement messages ──
        unsubs.push(gameWS.on('chat_message', (msg) => {
            const channel = msg['channel'] as string;
            if (channel !== 'announcement') return;
            const text = msg['text'] as string;
            if (!text) return;
            // Parse: "🏆 Match ended! <name> wins with $X.XX (+Y.YY)"
            const winMatch = text.match(/🏆 Match ended! (.+?) wins with \$[\d.]+\s*\(([+-][\d.]+)\)/);
            if (winMatch) {
                const entry: WinnerTickerEntry = {
                    name: winMatch[1].replace('🤖 ', ''),
                    pnl: parseFloat(winMatch[2]),
                    mode: 'Match',
                };
                setState((s) => ({
                    ...s,
                    winnerTicker: [...s.winnerTicker.slice(-9), entry], // keep last 10
                }));
            }
        }));

        unsubs.push(gameWS.on('lobby_update', (msg) => {
            const action = msg['action'] as string;
            if (action === 'queued') setState((s) => ({ ...s, screen: 'queue',
                queuePosition: msg['position'] as number, queueNeeded: msg['needed'] as number }));
            else if (action === 'left_queue') setState((s) => ({ ...s, screen: 'lobby', queueMessage: null }));
            else if (action === 'searching') setState((s) => ({ ...s, queueMessage: msg['message'] as string ?? 'Searching...' }));
            else if (action === 'queue_timeout') setState((s) => ({ ...s, screen: 'lobby', queueMessage: null }));
            else if (action === 'block_progress') setState((s) => ({
                ...s,
                blockProgress: {
                    startBlock: msg['startBlock'] as number,
                    currentBlock: msg['currentBlock'] as number,
                    elapsed: msg['elapsed'] as number,
                    confirmed: !!(msg['confirmed']),
                },
            }));
        }));

        unsubs.push(gameWS.on('match_created', (msg) => {
            const devMode = !!(msg['message'] as string)?.includes('DEV MODE');
            const players = msg['players'] as string[];
            const buyIn = (msg['buyIn'] as string) ?? '0';
            setState((s) => {
                // In DEV mode: skip on-chain, go straight to queue (backend handles bots)
                if (devMode) {
                    return { ...s, screen: 'queue', players, devMode };
                }
                // v5: Backend creates match via operator — no player TX needed.
                // Just show waiting screen until backend sends game_start.
                return {
                    ...s,
                    screen: 'waiting_onchain',
                    players,
                    devMode,
                    onchainAction: null, // v5: no player TX during matchmaking
                    onchainBuyIn: buyIn,
                    onchainError: null,
                    blockProgress: null,
                };
            });
        }));

        // v5: match_join_ready is no longer sent (operator creates match directly)
        // Kept for backward compat — no-op if received
        unsubs.push(gameWS.on('match_join_ready', (msg) => {
            console.log('[useGame] match_join_ready received (v5 no-op)');
        }));

        // R-18: Lobby countdown
        unsubs.push(gameWS.on('lobby_countdown', (msg) => {
            setState((s) => ({ ...s, screen: 'lobby_countdown',
                lobbySecondsLeft: msg['secondsLeft'] as number }));
        }));

        // R-18: Seed reveal
        unsubs.push(gameWS.on('seed_reveal', (msg) => {
            setState((s) => ({ ...s, screen: 'seed_reveal',
                seed: msg['seed'] as string }));
        }));

        // Preview
        unsubs.push(gameWS.on('preview_tick', (msg) => {
            const tick: PriceTick = { tick: msg['tick'] as number, price: msg['price'] as number,
                basePrice: 0, phase: 'PREVIEW' };
            setState((s) => ({ ...s, screen: 'preview', previewTicks: [...s.previewTicks, tick] }));
        }));

        // preview_end = GO! Transition to playing screen
        unsubs.push(gameWS.on('preview_end', () => {
            setState((s) => ({
                ...s,
                screen: 'playing',
                priceTicks: [...s.previewTicks],
            }));
        }));

        unsubs.push(gameWS.on('game_start', (msg) => {
            const capital = (msg['startingCapital'] as number) ?? 5;
            setState((s) => ({
                ...s,
                matchId: msg['matchId'] as string,
                totalTicks: (msg['totalTicks'] as number) ?? 240,
                devMode: !!(msg['devMode']),
                matchBuyIn: (msg['buyIn'] as string) ?? '0',
                priceTicks: [...s.previewTicks], // keep preview ticks on chart
                currentTick: 0, currentPhase: 'OPEN',
                equity: capital, positionStatus: 'FLAT', entryPrice: 0, startingCapital: capital,
                inventory: [], activeEffects: [], lastItemEvent: null, toasts: [],
                standings: [], lastTrade: null, lastReject: null,
                eliminatedPlayers: [],
    foggedPlayers: [], xrayInventories: {}, thickSkinActive: false, shockwaveActive: false, blackoutActive: false, blackoutUser: null, scrambleActive: false, mirrorCursed: false, muted: false, targetingItemId: null, frozen: false, frozenAtTick: -1, timeWarpActive: false, activeItemVFX: null, lastQueueSettings: null, tradeCount: 0,
    // Bug #6: preserve profile data across game_start (don't reset profileOpen/profile)
    // Clear game_room chat on new match, switch tab to game
    chatMessages: { ...s.chatMessages, game_room: [] }, chatActiveTab: 'game_room' as ChatChannel,
    chatUnread: { ...s.chatUnread, game_room: 0 },
            }));
        }));

        // BUG-1 FIX: Reconnect to active game after page refresh
        unsubs.push(gameWS.on('game_reconnect', (msg) => {
            const capital = (msg['startingCapital'] as number) ?? 5;
            const ticks = (msg['priceTicks'] as PriceTick[]) ?? [];
            setState((s) => ({
                ...s,
                screen: 'playing',
                matchId: msg['matchId'] as string,
                totalTicks: (msg['totalTicks'] as number) ?? 240,
                devMode: !!(msg['devMode']),
                matchBuyIn: (msg['buyIn'] as string) ?? '0',
                priceTicks: ticks,
                previewTicks: [],
                currentTick: (msg['currentTick'] as number) ?? 0,
                currentPhase: (msg['currentPhase'] as string) ?? 'OPEN',
                equity: (msg['equity'] as number) ?? capital,
                positionStatus: (msg['positionStatus'] as PositionStatus) ?? 'FLAT',
                entryPrice: (msg['entryPrice'] as number) ?? 0,
                startingCapital: capital,
                inventory: (msg['inventory'] as number[]) ?? [],
                standings: (msg['standings'] as Standing[]) ?? [],
                players: (msg['players'] as string[]) ?? [],
                tradeCount: (msg['tradeCount'] as number) ?? 0,
                // FE-9 FIX: Restore active item effects from snapshot instead of resetting
                foggedPlayers: (msg['foggedPlayers'] as string[]) ?? [],
                xrayInventories: {}, thickSkinActive: false,
                shockwaveActive: !!(msg['shockwaveActive']),
                blackoutActive: !!(msg['blackoutUser']) && (msg['blackoutUser'] as string) !== s.address,
                blackoutUser: (msg['blackoutUser'] as string) ?? null,
                scrambleActive: !!(msg['scrambleActive']),
                mirrorCursed: !!(msg['mirrorCursed']),
                muted: !!(msg['muted']),
                targetingItemId: null,
                frozen: !!(msg['frozen']),
                frozenAtTick: (msg['frozenAtTick'] as number) ?? -1,
                timeWarpActive: !!(msg['timeWarpActive']),
                chatActiveTab: 'game_room' as ChatChannel,
            }));
        }));

        unsubs.push(gameWS.on('candle_update', (msg) => {
            const tick: PriceTick = { tick: msg['tick'] as number, price: msg['price'] as number,
                basePrice: msg['basePrice'] as number, phase: msg['phase'] as string };
            setState((s) => {
                // FE-14 FIX: Auto-expire freeze after 5 ticks (matching backend Freeze durationSec: 5)
                const frozen = s.frozen && s.frozenAtTick >= 0 && tick.tick < s.frozenAtTick + 5;
                return { ...s, priceTicks: [...s.priceTicks, tick],
                    currentTick: tick.tick, currentPhase: tick.phase, frozen };
            });
        }));

        unsubs.push(gameWS.on('phase_change', (msg) => {
            sound.playPhaseChange();
            setState((s) => ({ ...s, currentPhase: str(msg, 'phase') }));
        }));

        unsubs.push(gameWS.on('portfolio_update', (msg) => {
            const addr = msg['address'] as string;
            const equity = msg['equity'] as number;
            const posStatus = (msg['positionStatus'] as PositionStatus) ?? 'FLAT';
            const entry = (msg['entryPrice'] as number) ?? 0;
            setState((s) => {
                // Clear T2 effects that auto-expire (no active message = effect ended)
                // Scramble/Mirror/Mute clear themselves when backend stops sending active messages

                // Update own equity
                const isSelf = addr === s.address;
                const selfUpdates = isSelf ? { equity, positionStatus: posStatus, entryPrice: entry } : {};

                // Build standings from all players
                const playerMap = new Map<string, Standing>();
                for (const st of s.standings) playerMap.set(st.address, st);
                playerMap.set(addr, { address: addr, rank: 0, finalEquity: equity, positionStatus: posStatus });

                // Sort by equity desc, assign ranks
                const sorted = Array.from(playerMap.values()).sort((a, b) => b.finalEquity - a.finalEquity);
                sorted.forEach((st, i) => { (st as any).rank = i + 1; });

                return { ...s, ...selfUpdates, standings: sorted };
            });
        }));

        unsubs.push(gameWS.on('trade_executed', (msg) => {
            const trade = msg['trade'] as Record<string, unknown>;
            setState((s) => {
                if (trade['player'] !== s.address) return s;
                return { ...s, lastTrade: { action: trade['action'] as string, price: trade['price'] as number }, lastReject: null, tradeCount: s.tradeCount + 1 };
            });
        }));

        unsubs.push(gameWS.on('trade_rejected', (msg) =>
            setState((s) => ({ ...s, lastReject: msg['reason'] as string }))));

        // Items
        unsubs.push(gameWS.on('item_drop', (msg) => {
            const drops = validateItemDrops(msg);
            if (drops.length === 0) return;
            setState((s) => {
                const myDrop = drops.find((d) => d.player === s.address);
                if (!myDrop) return s;
                sound.playItemReceived();
                const inv = [...s.inventory];
                if (inv.length >= 2) inv.shift();
                inv.push(myDrop.item);
                const itemName = ITEM_NAMES[myDrop.item]?.name ?? 'Unknown';
                return { ...s, inventory: inv,
                    lastItemEvent: `📦 You got ${ITEM_NAMES[myDrop.item]?.emoji} ${itemName}!` };
            });
        }));

        unsubs.push(gameWS.on('item_used', (msg) => {
            const player = str(msg, 'player');
            const itemId = num(msg, 'item');
            const target = str(msg, 'target') || null;
            if (!player || !itemId) return;
            const item = ITEM_NAMES[itemId];

            setState((s) => {
                let event: string;
                // VFX items: self-use 1,3,4,5 | targeted 8,9,10,14 | global 11
                const selfVFX = [1, 3, 4, 5];
                const targetVFX = [8, 9, 10, 14];
                if (player === s.address) {
                    event = `${item?.emoji} You used ${item?.name}`;
                    sound.playItemById(itemId);
                    const inv = [...s.inventory];
                    const idx = inv.indexOf(itemId);
                    if (idx >= 0) inv.splice(idx, 1);
                    // FE-13 FIX: Track Shield (item 2) activation, not Scalp (item 3)
                    const thickSkin = itemId === 2 ? true : s.thickSkinActive;
                    const vfx = selfVFX.includes(itemId) || itemId === 11 ? itemId : s.activeItemVFX;
                    return { ...s, inventory: inv, lastItemEvent: event, thickSkinActive: thickSkin, activeItemVFX: vfx };
                } else if (target === s.address) {
                    event = `${item?.emoji} ${item?.name} used on you!`;
                    sound.playHitByItem();
                    // #14: Track frozen state when Freeze hits us
                    const frozen = itemId === 6 ? true : s.frozen;
                    const frozenAtTick = itemId === 6 ? s.currentTick : s.frozenAtTick;
                    const vfx = targetVFX.includes(itemId) ? itemId : s.activeItemVFX;
                    return { ...s, lastItemEvent: event, frozen, frozenAtTick, activeItemVFX: vfx };
                } else {
                    // #17: All item uses visible by all players (GDD §4.1)
                    const shortAddr = player.slice(0, 6) + '…';
                    event = `${item?.emoji} ${shortAddr} used ${item?.name}`;
                    // Nuke is global — everyone sees VFX
                    const vfx = itemId === 11 ? 11 : s.activeItemVFX;
                    return { ...s, lastItemEvent: event, activeItemVFX: vfx };
                }
            });
        }));

        unsubs.push(gameWS.on('item_rejected', (msg) =>
            setState((s) => ({ ...s, lastItemEvent: `✗ ${msg['reason']}` }))));

        // R-10: Elimination (Survival)
        unsubs.push(gameWS.on('elimination', (msg) => {
            const address = msg['address'] as string;
            sound.playElimination();
            setState((s) => ({
                ...s,
                eliminatedPlayers: [...s.eliminatedPlayers, address],
                lastItemEvent: address === s.address
                    ? '💀 You have been liquidated!'
                    : `💀 Player eliminated`,
            }));
        }));

        // T1: Thick Skin block
        unsubs.push(gameWS.on('thick_skin_block', (msg) => {
            const blocker = msg['blocker'] as string;
            const attacker = msg['attacker'] as string;
            sound.playShieldBlock();
            setState((s) => ({
                ...s,
                // #15: Thick Skin consumed on block
                thickSkinActive: blocker === s.address ? false : s.thickSkinActive,
                lastItemEvent: blocker === s.address
                    ? '🛡 Thick Skin blocked an attack!'
                    : attacker === s.address
                    ? '🛡 Your item was blocked by Thick Skin!'
                    : '🛡 Thick Skin blocked!',
            }));
        }));

        // Profile data
        unsubs.push(gameWS.on('profile_data', (msg) => {
            setState((s) => ({
                ...s,
                twitterHandle: (msg['twitterHandle'] as string) || s.twitterHandle,
                totalPoints: typeof msg['totalPoints'] === 'number' ? msg['totalPoints'] : s.totalPoints,
                profile: {
                    matchesPlayed: msg['matchesPlayed'] as number,
                    wins: msg['wins'] as number,
                    losses: msg['losses'] as number,
                    totalEarnings: msg['totalEarnings'] as string,
                    totalVolume: msg['totalVolume'] as string,
                    bestRank: msg['bestRank'] as number,
                    tier: msg['tier'] as string,
                    tierEmoji: msg['tierEmoji'] as string,
                    tierColor: msg['tierColor'] as string,
                    tierName: msg['tierName'] as string,
                    tierLevel: msg['tierLevel'] as number,
                    tierProgress: msg['tierProgress'] as number,
                    nextTierVolume: (msg['nextRankVolume'] as string) ?? (msg['nextTierVolume'] as string) ?? '0',
                    // Sprint 5: Mode stats
                    classic: (msg['classic'] as ModeProfileStats) ?? null,
                    survival: (msg['survival'] as ModeProfileStats) ?? null,
                    chaos: (msg['chaos'] as ModeProfileStats) ?? null,
                    classicMastery: (msg['classicMastery'] as { level: number; max: number }) ?? { level: 0, max: 12 },
                    survivalMastery: (msg['survivalMastery'] as { level: number; max: number }) ?? { level: 0, max: 12 },
                    chaosMastery: (msg['chaosMastery'] as { level: number; max: number }) ?? { level: 0, max: 12 },
                },
            }));
        }));

        // T3: Shockwave
        unsubs.push(gameWS.on('shockwave_start', () => {
            sound.playEarthquake();
            setState((s) => ({ ...s, shockwaveActive: true, lastItemEvent: '💥 SHOCKWAVE! Volatility ×3!' }));
        }));
        unsubs.push(gameWS.on('shockwave_end', () => {
            setState((s) => ({ ...s, shockwaveActive: false, lastItemEvent: '💥 Shockwave ended' }));
        }));

        // DEAD-04: Time Warp removed (LOGIC-22) — listeners cleaned up

        // T3: Blackout
        unsubs.push(gameWS.on('blackout_update', (msg) => {
            const blackoutUser = msg['blackoutUser'] as string | null;
            if (blackoutUser) sound.playBlackout();
            setState((s) => ({
                ...s,
                blackoutUser,
                blackoutActive: blackoutUser !== null && blackoutUser !== s.address,
                lastItemEvent: blackoutUser ? (blackoutUser === s.address ? '🌑 You activated Blackout!' : '🌑 BLACKOUT! Chart hidden!') : null,
            }));
        }));

        // T3: Heist
        unsubs.push(gameWS.on('heist', (msg) => {
            const thief = msg['thief'] as string;
            const victim = msg['victim'] as string | null;
            // WIRE-04 FIX: Backend sends stolenEquity (dollar amount), not an item ID
            const stolenEquity = msg['stolenEquity'] as number ?? msg['stolenItem'] as number ?? 0;
            setState((s) => {
                let event: string;
                if (thief === s.address) {
                    event = victim ? `🏴‍☠️ You stole $${stolenEquity.toFixed(2)}!` : '🏴‍☠️ Heist — no valid targets';
                } else if (victim === s.address) {
                    event = `🏴‍☠️ $${stolenEquity.toFixed(2)} stolen from you!`;
                } else {
                    event = '🏴‍☠️ Heist! Equity stolen!';
                }
                return { ...s, lastItemEvent: event };
            });
        }));

        // T2: Scramble — leaderboard shows fake data (null scrambler = effect ended)
        unsubs.push(gameWS.on('scramble_active', (msg) => {
            const scrambler = msg['scrambler'] as string | null;
            setState((s) => {
                const wasActive = s.scrambleActive;
                const isNowActive = scrambler !== null && scrambler !== s.address;
                // Push toast directly to avoid lastItemEvent overwrites when multiple effects expire same tick
                if (wasActive && !isNowActive) {
                    const id = Date.now() + Math.random();
                    return { ...s, scrambleActive: false, toasts: [...s.toasts.slice(-2), { id, text: '🔀 Scramble ended — leaderboard restored', ts: Date.now() }] };
                }
                return { ...s, scrambleActive: isNowActive };
            });
        }));

        // T2: Mirror Curse — invert chart for cursed player
        unsubs.push(gameWS.on('mirror_curse', (msg) => {
            const cursedPlayers = msg['cursedPlayers'] as string[];
            setState((s) => {
                const wasActive = s.mirrorCursed;
                const isNowActive = cursedPlayers.includes(s.address ?? '');
                if (wasActive && !isNowActive) {
                    const id = Date.now() + Math.random();
                    return { ...s, mirrorCursed: false, toasts: [...s.toasts.slice(-2), { id, text: '🪞 Mirror Curse ended — chart restored', ts: Date.now() }] };
                }
                return { ...s, mirrorCursed: isNowActive };
            });
        }));

        // T2: Mute — hide PnL for muted player
        unsubs.push(gameWS.on('mute_active', (msg) => {
            const mutedPlayers = msg['mutedPlayers'] as string[];
            setState((s) => {
                const wasActive = s.muted;
                const isNowActive = mutedPlayers.includes(s.address ?? '');
                if (wasActive && !isNowActive) {
                    const id = Date.now() + Math.random();
                    return { ...s, muted: false, toasts: [...s.toasts.slice(-2), { id, text: '🔇 Mute ended — PnL visible', ts: Date.now() }] };
                }
                return { ...s, muted: isNowActive };
            });
        }));

        // T1: Fog of War — detect self-fog clearing
        unsubs.push(gameWS.on('fog_update', (msg) => {
            setState((s) => {
                const newFogged = msg['foggedPlayers'] as string[];
                const wasFogged = s.foggedPlayers.includes(s.address ?? '');
                const isNowFogged = newFogged.includes(s.address ?? '');
                if (wasFogged && !isNowFogged) {
                    const id = Date.now() + Math.random();
                    return { ...s, foggedPlayers: newFogged, toasts: [...s.toasts.slice(-2), { id, text: '👻 Fog of War ended — you are visible', ts: Date.now() }] };
                }
                return { ...s, foggedPlayers: newFogged };
            });
        }));

        // T1: X-Ray — clear when no data arrives (backend stops sending xray_data when expired)
        // Auto-clear xray inventories every 3 seconds if no fresh data
        let xrayTimer: ReturnType<typeof setTimeout> | null = null;
        unsubs.push(gameWS.on('xray_data', (msg) => {
            setState((s) => ({ ...s, xrayInventories: msg['inventories'] as Record<string, number[]> }));
            if (xrayTimer) clearTimeout(xrayTimer);
            xrayTimer = setTimeout(() => {
                setState((s) => {
                    if (Object.keys(s.xrayInventories).length > 0) {
                        return { ...s, xrayInventories: {}, lastItemEvent: '🔍 X-Ray ended' };
                    }
                    return s;
                });
            }, 2000);
        }));

        // Chat message received
        unsubs.push(gameWS.on('chat_message', (msg) => {
            const chatMsg = msg as unknown as ChatMessage;
            if (!chatMsg.channel) return;
            setState((s) => {
                const channel = chatMsg.channel as ChatChannel;
                const updated = { ...s.chatMessages };
                updated[channel] = [...(updated[channel] ?? []), chatMsg].slice(-100);
                const unread = { ...s.chatUnread };
                if (s.chatActiveTab !== channel) {
                    unread[channel] = (unread[channel] ?? 0) + 1;
                }
                return { ...s, chatMessages: updated, chatUnread: unread };
            });
        }));

        // Chat history received
        unsubs.push(gameWS.on('chat_history', (msg) => {
            const channel = msg['channel'] as ChatChannel;
            const messages = msg['messages'] as ChatMessage[];
            if (!channel) return;
            setState((s) => {
                const updated = { ...s.chatMessages };
                updated[channel] = messages ?? [];
                return { ...s, chatMessages: updated };
            });
        }));

        // Game end
        unsubs.push(gameWS.on('game_end', (msg) => {
            const standings = validateStandings(msg);
            if (standings.length === 0) return;
            setState((s) => {
                const myStanding = standings.find(st => st.address === s.address);
                if (myStanding?.rank === 1) sound.playVictory();
                else sound.playDefeat();
                return { ...s, screen: 'results', finalStandings: standings as unknown as Standing[] };
            });
        }));

        unsubs.push(gameWS.on('settlement', (msg) => {
            setState((s) => ({ ...s, settlementTx: str(msg, 'txHash') || null,
                settlementStatus: str(msg, 'status') }));
            gameWS.send('get_battle_log');
            gameWS.send('get_leaderboard');
        }));

        unsubs.push(gameWS.on('error', (msg) => {
            const message = str(msg, 'message', 'Unknown error');
            const action = str(msg, 'action', '');
            console.warn('[Chart Arena]', message, action ? `(action: ${action})` : '');
            // V5-04 FIX: Surface errors to user via toast and return to lobby from any pre-game screen
            setState((s) => {
                if (s.screen === 'onboarding') return { ...s, usernameError: message };
                // V5-04: If on waiting_onchain, return to lobby with error
                if (s.screen === 'waiting_onchain') {
                    const prefix = action === 'deposit_required' ? '💰 ' : '❌ ';
                    const toast = { id: Date.now(), text: prefix + message, ts: Date.now() };
                    return { ...s, screen: 'lobby', onchainAction: null, onchainError: null, toasts: [...s.toasts, toast] };
                }
                if (s.screen === 'lobby' || s.screen === 'queue') {
                    // Show error as toast so the user knows why the button didn't work
                    const toast = { id: Date.now(), text: message, ts: Date.now() };
                    return { ...s, screen: 'lobby', toasts: [...s.toasts, toast] };
                }
                return s;
            });
        }));

        return () => {
            unsubs.forEach((u) => u());
            if (xrayTimer) clearTimeout(xrayTimer);
            gameWS.disconnect();
        };
    }, []);

    // V5-09 FIX: Client-side timeout for waiting_onchain screen.
    // If backend crashes or TX never confirms, auto-return to lobby after 15 minutes.
    useEffect(() => {
        if (state.screen !== 'waiting_onchain') return;
        const timeout = setTimeout(() => {
            setState((s) => {
                if (s.screen !== 'waiting_onchain') return s;
                const toast = { id: Date.now(), text: 'Match creation timed out. Returning to lobby — your escrow balance is safe.', ts: Date.now() };
                return { ...s, screen: 'lobby', onchainAction: null, onchainError: null, toasts: [...s.toasts, toast] };
            });
        }, 15 * 60 * 1000); // 15 minutes
        return () => clearTimeout(timeout);
    }, [state.screen]);

    const authenticate = useCallback((addr: string, signature: string, nonce?: string, pubkey?: string) =>
        gameWS.send('auth', { address: addr, signature, ...(nonce ? { nonce } : {}), ...(pubkey ? { pubkey } : {}) }), []);
    const resumeSession = useCallback(() => {
        try {
            const token = localStorage.getItem('ca-session-token');
            if (token) { gameWS.send('token_auth', { token }); return true; }
        } catch {}
        return false;
    }, []);
    const joinQueue = useCallback((tier: number, mode = 0, format = 0) => {
        setState((s) => ({ ...s, lastQueueSettings: { tier, mode, format } }));
        gameWS.send('queue', { tier, mode, format });
    }, []);
    const leaveQueue = useCallback(() => gameWS.send('leave_queue'), []);
    const reportMatchId = useCallback((id: string) => gameWS.send('report_match_id', { matchId: id }), []);

    const trade = useCallback((action: TradeAction) => {
        if (!state.matchId) return;
        gameWS.send('trade', { matchId: state.matchId, action });
    }, [state.matchId]);

    // T2 items that need target selection in Arena (all opponent-targeted)
    const NEEDS_TARGET = new Set([6, 7, 8, 9, 10]); // Freeze, Mirror Curse, Drain, Glitch, Swap

    const useItem = useCallback((itemId: number) => {
        if (!state.matchId) return;
        // In Arena, targetable items enter targeting mode
        // In Duel, always auto-target
        const isDuel = state.players.length <= 2;
        if (!isDuel && NEEDS_TARGET.has(itemId)) {
            // Enter targeting mode — wait for player to click a standings row
            setState((s) => ({ ...s, targetingItemId: itemId }));
            return;
        }
        // Self/global items or Duel: send immediately
        gameWS.send('use_item', { matchId: state.matchId, itemId });
    }, [state.matchId, state.players.length]);

    const selectTarget = useCallback((targetAddress: string) => {
        if (!state.matchId || state.targetingItemId === null) return;
        gameWS.send('use_item', { matchId: state.matchId, itemId: state.targetingItemId, target: targetAddress });
        setState((s) => ({ ...s, targetingItemId: null }));
    }, [state.matchId, state.targetingItemId]);

    const requestProfile = useCallback(() => {
        gameWS.send('get_profile');
        gameWS.send('get_quests');
        gameWS.send('get_referral_stats');
        gameWS.send('get_battle_log');
        setState((s) => ({ ...s, profileOpen: true, profileTab: 'stats' }));
    }, []);

    const closeProfile = useCallback(() => {
        setState((s) => ({ ...s, profileOpen: false }));
    }, []);

    const setProfileTab = useCallback((tab: 'stats' | 'missions' | 'referring' | 'battlelog') => {
        setState((s) => ({ ...s, profileTab: tab }));
        if (tab === 'missions') gameWS.send('get_quests');
        if (tab === 'referring') gameWS.send('get_referral_stats');
        if (tab === 'battlelog') gameWS.send('get_battle_log');
    }, []);

    const applyReferral = useCallback((code: string) => {
        gameWS.send('apply_referral', { code });
    }, []);

    const claimQuest = useCallback((questId: string) => {
        gameWS.send('claim_quest', { questId });
    }, []);

    const cancelTargeting = useCallback(() => {
        setState((s) => ({ ...s, targetingItemId: null }));
    }, []);

    // Toast system: auto-create toast from lastItemEvent, auto-dismiss after 2s
    // FE-10 FIX: Max 3 toasts (was 5), 2s dismiss (was 3s) to avoid obscuring gameplay
    const toastIdRef = useRef(0);
    useEffect(() => {
        if (!state.lastItemEvent) return;
        const id = ++toastIdRef.current;
        setState((s) => ({
            ...s,
            toasts: [...s.toasts.slice(-2), { id, text: s.lastItemEvent!, ts: Date.now() }], // keep max 3
            lastItemEvent: null, // consume it
        }));
        const timer = setTimeout(() => {
            setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
        }, 2000);
        return () => clearTimeout(timer);
    }, [state.lastItemEvent]);

    const dismissToast = useCallback((id: number) => {
        setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    }, []);

    // Auto-dismiss all toasts after 2s (covers both lastItemEvent toasts and direct-push toasts)
    useEffect(() => {
        if (state.toasts.length === 0) return;
        const timers = state.toasts.map((toast) => {
            const age = Date.now() - toast.ts;
            const remaining = Math.max(0, 2000 - age);
            return setTimeout(() => {
                setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== toast.id) }));
            }, remaining);
        });
        return () => timers.forEach(clearTimeout);
    }, [state.toasts.length]);

    const requestLeaderboard = useCallback(() => {
        gameWS.send('get_leaderboard');
        gameWS.send('get_online_count');
    }, []);

    const backToLobby = useCallback(() =>
        setState((s) => ({ ...initialState, connected: s.connected, authenticated: s.authenticated, address: s.address, nonce: s.nonce,
            username: s.username, twitterHandle: s.twitterHandle, playerNames: {},
            devMode: s.devMode, motoUsdPrice: s.motoUsdPrice,
            chatMessages: s.chatMessages, chatActiveTab: 'public', chatUnread: s.chatUnread, chatWhisperTarget: s.chatWhisperTarget,
            leaderboard: s.leaderboard, onlineCount: s.onlineCount, winnerTicker: s.winnerTicker,
            profile: s.profile, referralData: s.referralData, totalPoints: s.totalPoints,
        })), []);

    const playAgain = useCallback(() => {
        const last = state.lastQueueSettings;
        if (last) {
            setState((s) => ({ ...initialState, connected: s.connected, authenticated: s.authenticated, address: s.address, nonce: s.nonce,
                username: s.username, twitterHandle: s.twitterHandle, playerNames: {},
                devMode: s.devMode, motoUsdPrice: s.motoUsdPrice,
                chatMessages: s.chatMessages, chatActiveTab: 'public', chatUnread: s.chatUnread, chatWhisperTarget: s.chatWhisperTarget,
                leaderboard: s.leaderboard, onlineCount: s.onlineCount, winnerTicker: s.winnerTicker,
                profile: s.profile, referralData: s.referralData, totalPoints: s.totalPoints,
                lastQueueSettings: last,
            }));
            gameWS.send('queue', last);
        } else {
            backToLobby();
        }
    }, [state.lastQueueSettings, backToLobby]);

    // ── Chat actions ──

    const sendChatMessage = useCallback((channel: ChatChannel, text: string, target?: string) => {
        gameWS.send('chat_send', { channel, text, ...(target ? { target } : {}) });
    }, []);

    const setChatTab = useCallback((tab: ChatChannel) => {
        setState((s) => {
            const unread = { ...s.chatUnread };
            unread[tab] = 0;
            return { ...s, chatActiveTab: tab, chatUnread: unread };
        });
        // Request history for the tab on switch
        gameWS.send('chat_get_history', { channel: tab });
    }, []);

    const setChatWhisperTarget = useCallback((target: string | null) => {
        setState((s) => ({ ...s, chatWhisperTarget: target }));
    }, []);

    // ── Onboarding actions ──

    const setUsername = useCallback((username: string, twitterHandle?: string) => {
        setState((s) => ({ ...s, usernameError: null }));
        gameWS.send('set_username', { username, ...(twitterHandle ? { twitterHandle } : {}) });
    }, []);

    const startTwitterAuth = useCallback(() => {
        gameWS.send('start_twitter_auth');
    }, []);

    const clearOnchainAction = useCallback(() => {
        setState((s) => ({ ...s, onchainAction: null, onchainError: null }));
    }, []);

    const setOnchainError = useCallback((error: string) => {
        setState((s) => ({ ...s, onchainAction: null, onchainError: error }));
    }, []);

    // Auto-clear item VFX after duration (T1: 3s, T2: 4s, T3: 3s)
    useEffect(() => {
        if (state.activeItemVFX === null) return;
        const id = state.activeItemVFX;
        const duration = id <= 5 ? 3000 : id <= 10 ? 4000 : 3000;
        const timer = setTimeout(() => {
            setState((s) => s.activeItemVFX === id ? { ...s, activeItemVFX: null } : s);
        }, duration);
        return () => clearTimeout(timer);
    }, [state.activeItemVFX]);

    return {
        state,
        selectTarget,
        cancelTargeting,
        dismissToast,
        requestProfile,
        closeProfile,
        setProfileTab,
        claimQuest,
        applyReferral,
        requestLeaderboard,
        clearOnchainAction,
        setOnchainError,
        candles,           // R-19: 5s OHLC candles computed from priceTicks
        previewCandles,    // R-19: 5s candles from preview phase
        authenticate,
        resumeSession,
        joinQueue,
        leaveQueue,
        reportMatchId,
        trade,
        useItem,
        backToLobby,
        playAgain,
        // Chat
        sendChatMessage,
        setChatTab,
        setChatWhisperTarget,
        // Onboarding
        setUsername,
        startTwitterAuth,
    };
}
