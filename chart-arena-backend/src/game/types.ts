import type { FormatValue, GameModeValue, PhaseValue } from '../utils/constants.js';
import type { PlayerItemState } from './items.js';

// ── Price Tick (1 second) ──
export interface PriceTick {
    readonly tick: number;
    readonly price: number;
    readonly basePrice: number;
    readonly phase: PhaseValue;
}

// ── Position ──
export type Direction = 'LONG' | 'SHORT';
export type PositionStatus = 'FLAT' | 'LONG' | 'SHORT';
export type TradeAction = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE';

// ── Trade Record ──
export interface TradeRecord {
    readonly player: string;
    readonly action: TradeAction;
    readonly price: number;
    readonly slippage: number;       // actual slippage applied (base + snipe)
    readonly tick: number;
    readonly timestamp: number;
}

// ── Player Position ──
export interface PlayerPosition {
    status: PositionStatus;
    entryPrice: number;
    entryTick: number;
    direction: Direction | null;
}

// ── Player State ──
export interface MatchPlayer {
    readonly address: string;
    equity: number;
    position: PlayerPosition;
    tradeCount: number;
    lastTradeTick: number;
    lastCloseTick: number;
    flatSeconds: number;
    connected: boolean;
    disconnectedAtTick: number;      // -1 if connected, tick number when DC'd
    // R-10: Survival elimination
    eliminated: boolean;             // true if liquidated (equity ≤ 0)
    eliminatedAtTick: number;        // tick when eliminated (-1 if alive)
    equityAtElimination: number;     // equity just before liquidation (for tiebreak)
    itemState: PlayerItemState;      // item inventory + active effects
}

// ── Match State ──
export const OffchainMatchStatus = {
    PREVIEW: 'preview',              // showing 3 candles, no trading
    WAITING: 'waiting',
    IN_PROGRESS: 'in_progress',
    FINISHED: 'finished',
    SETTLING: 'settling',
    // Bug 6.10: PROPOSED status removed (was v4 scaffold — dispute window not implemented)
    SETTLED: 'settled',
    ERROR: 'error',
} as const;
export type OffchainMatchStatusValue = (typeof OffchainMatchStatus)[keyof typeof OffchainMatchStatus];

export interface GameMatch {
    readonly matchId: bigint;
    readonly mode: GameModeValue;
    readonly format: FormatValue;
    readonly buyIn: bigint;
    readonly seed: bigint;
    status: OffchainMatchStatusValue;
    readonly players: Map<string, MatchPlayer>;
    readonly trades: TradeRecord[];
    readonly priceTicks: PriceTick[];
    readonly events: MatchLogEvent[];   // #9: Item/game events for replay
    currentTick: number;
    currentPhase: PhaseValue;
    roundTimer: ReturnType<typeof setTimeout> | null;
}

// ── Standing ──
export interface Standing {
    readonly address: string;
    readonly rank: number;
    readonly finalEquity: number;
    readonly positionStatus: PositionStatus;
    readonly eliminated: boolean;            // R-10: Survival elimination tracking
    readonly eliminatedAtTick: number;       // R-10: -1 if alive
}

// ── Match Log Event (GDD §10.4) ──
export type MatchLogEventType = 'ITEM_DROP' | 'ITEM_USE' | 'ITEM_EFFECT_END' | 'ITEM_BLOCK' | 'ITEM_STEAL' | 'LIQUIDATION' | 'PHASE_CHANGE';

export interface MatchLogEvent {
    readonly type: MatchLogEventType;
    readonly tick: number;
    readonly player?: string;
    readonly item?: number;
    readonly target?: string | null;
    readonly detail?: string;
}

// ═══════════════════════════════════════════════════════════════════
// MATCH SUMMARY — Per-player result data captured at match end.
// This is the data pipeline that feeds per-mode stats, quests,
// and profile progression. Built by GameInstance.buildMatchSummary()
// before the game instance is cleaned up.
// ═══════════════════════════════════════════════════════════════════

export interface PlayerMatchResult {
    readonly address: string;
    readonly mode: GameModeValue;
    readonly format: FormatValue;
    readonly rank: number;
    readonly finalEquity: number;
    readonly won: boolean;
    readonly pnlDelta: number;              // finalEquity - startingCapital

    // ── Universal tracking ──
    readonly tradesExecuted: number;        // total trades this match
    readonly itemsUsed: number;             // total items activated by this player
    readonly itemsReceived: number;         // total items dropped to this player
    readonly positionTicks: number;         // ticks spent in a position (not flat)
    readonly eliminatedAtTick: number;      // -1 if survived

    // ── Classic-specific (0/false for other modes) ──
    readonly classicTradesOfLimit: number;  // trades used out of max (0 until Classic mode lands)

    // ── Survival-specific (0/false for other modes) ──
    readonly survivalSurvivedUntilTick: number;     // last tick alive (-1 if n/a)
    readonly survivalBountiesClaimed: number;        // times overtook #1 (0 until bounty system lands)
    readonly survivalRingDamageTaken: boolean;       // ever took ring bleed (false until ring lands)
    readonly survivalRingEscaped: boolean;           // took ring damage but survived to win
    readonly survivalEliminationCause: 'liquidation' | 'survived' | 'n/a';

    // ── Chaos-specific (empty/0/false for other modes) ──
    readonly chaosMultiplier: number;                // 1.0 until Chaos mode lands
    readonly chaosMutatorsExperienced: string[];     // mutator IDs seen this match
    readonly chaosWasInPositionDuringFlip: boolean;  // had open trade when FLIP fired
    readonly chaosSurvivedFlipProfitably: boolean;   // still profitable after flip
    readonly chaosGoldRushPnl: number;               // equity delta during Gold Rush windows
    readonly chaosWasRobinHoodVictim: boolean;       // was richest when Robin Hood fired
    readonly chaosPhantomMarketTraded: boolean;      // opened a trade during fake prices
    readonly chaosPhantomMarketProfited: boolean;    // ...and it was profitable
}

export interface MatchSummary {
    readonly matchId: bigint;
    readonly mode: GameModeValue;
    readonly format: FormatValue;
    readonly buyIn: bigint;
    readonly totalTicks: number;
    readonly durationTicks: number;         // actual ticks played (may differ from totalTicks in Survival)
    readonly players: Map<string, PlayerMatchResult>;
}

// ── Match Log ──
export interface MatchLog {
    readonly matchId: string;
    readonly seed: string;
    readonly mode: number;
    readonly format: number;
    readonly buyIn: string;
    readonly players: string[];
    readonly priceTicks: PriceTick[];
    readonly trades: TradeRecord[];
    readonly events: MatchLogEvent[];   // #9: Item/game events for replay
    readonly standings: Standing[];
    readonly payouts: Array<{ address: string; amount: string }>;
    readonly timestamp: number;
}
