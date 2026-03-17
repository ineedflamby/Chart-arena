/**
 * Game Loop — Full GDD compliance.
 *
 * Tier 3 changes:
 *   R-13: On-the-fly price computation from baseDeltas (enables Shockwave)
 *   R-10: Survival mode (x2 leverage, liquidation, dynamic end condition)
 *   R-14: Nuke (force-close all exposed players via game loop)
 *   LOGIC-22: Time Warp removed (was never wired to any item/event)
 *
 * Timeline:
 *   Preview (15 ticks, read-only) → GO → 240 ticks (or 300 Survival)
 */

import type {
    PriceTick, GameMatch, MatchPlayer, Standing, TradeAction, TradeRecord,
    MatchSummary, PlayerMatchResult,
} from './types.js';
import { OffchainMatchStatus } from './types.js';
import { executeTrade, computeEquity, applyFlatPenalty } from './trading.js';
import { generateBaseDeltas, findValidSeed, computeTickPrice } from '../services/chart-engine.js';
import {
    createItemState, processItemDrops, activateItem, tickItemEffects,
    type ItemIdValue, type ItemDropEvent, type ItemUseEvent,
    ItemId, ITEMS, hasFogOfWar, hasXRay, hasScramble, hasMirrorCurse, isMuted, ITEMS_T1,
    hasGhostTrade, isBoostVisible, isFrozen, getFreezeFlatPenalty, hasBlackoutPreview,
    hasEarthquakeReducedCooldowns, getItemUsableTick, consumeBoost, getFreezeSlippageMultiplier,
    SCALP_LEVERAGE, SCALP_DURATION,
    NUKE_PRICE_DROP_BASE, NUKE_PRICE_DROP_PER_VICTIM, NUKE_PRICE_DROP_MAX,
} from './items.js';
import {
    type FormatValue, type PhaseValue, type GameModeValue,
    STARTING_CAPITAL, STANDARD_TICKS, SURVIVAL_TICKS,
    GameMode, Format, Phase, getPhase, BASE_SLIPPAGE,
    FLAT_PENALTY_CLASSIC_ARENA, FLAT_PENALTY_CLASSIC_DUEL, FLAT_PENALTY_CHAOS,
    SURVIVAL_LEVERAGE, CHAOS_VOLATILITY_MULTIPLIER,
    LOBBY_DURATION_DUEL, LOBBY_DURATION_ARENA, SEED_REVEAL_DURATION,
} from '../utils/constants.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'GameLoop';
const PREVIEW_TICKS = 15;

// ── Seeded RNG for item drops (deterministic from match seed) ──
// BE-11 FIX: mulberry32 PRNG — much better statistical properties than xorshift.
// Uses 128 bits of seed (4×32) via SplitMix32 initialization instead of just 32 bits.
class SimpleRNG {
    private state: number;
    constructor(seed: bigint) {
        // Initialize with 128 bits of seed via SplitMix32 mixing
        let s = Number(seed & 0xFFFFFFFFn) >>> 0;
        s = (s + 0x9e3779b9) >>> 0;
        let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad); t = t ^ (t >>> 15);
        t = Math.imul(t, 0x735a2d97); t = t ^ (t >>> 15);
        // Mix in more seed bits
        const s2 = Number((seed >> 32n) & 0xFFFFFFFFn) >>> 0;
        this.state = (t ^ s2) >>> 0;
        if (this.state === 0) this.state = 1; // avoid zero state
    }
    next(): number {
        // mulberry32: period 2^32, passes BigCrush
        let t = (this.state += 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

// ── Pending actions ──
interface PendingTrade { readonly player: string; readonly action: TradeAction; }
interface PendingItemUse { readonly player: string; readonly itemId: ItemIdValue; readonly target: string | null; }

export class GameInstance {
    public readonly match: GameMatch;

    // R-13: On-the-fly pricing — store base deltas, compute price each tick
    private readonly baseDeltas: number[];
    private readonly previewTicks: PriceTick[];
    public readonly totalMatchTicks: number;
    private prevPrice: number = 100;   // running price for on-the-fly computation
    private shockwaveActive: boolean = false;
    private shockwaveRealSecondsLeft: number = 0;
    private blackoutUser: string | null = null;
    private blackoutRealSecondsLeft: number = 0;
    private earthquakeReducedCooldowns: boolean = false; // v3: all cooldowns → 1s

    // LOGIC-22: Time Warp removed (was never triggered by any item/event)

    private tickInterval: ReturnType<typeof setInterval> | null = null;
    private pendingTrades: PendingTrade[] = [];
    private pendingItemUses: PendingItemUse[] = [];
    private lastPhase: PhaseValue = Phase.OPEN;
    private itemRng: SimpleRNG;
    // BE-8 FIX: Typed rate limiter (was untyped `(this as any)._tradeCountPerTick`)
    private _tradeCountPerTick = new Map<string, number>();

    // R-10: Survival leverage
    private readonly leverage: number;

    // Callbacks
    public onPreviewTick: ((matchId: bigint, tick: PriceTick) => void) | null = null;
    public onPreviewEnd: ((matchId: bigint) => void) | null = null;
    public onTick: ((matchId: bigint, tick: PriceTick) => void) | null = null;
    public onTradeExecuted: ((matchId: bigint, trade: TradeRecord) => void) | null = null;
    public onTradeRejected: ((matchId: bigint, player: string, reason: string) => void) | null = null;
    public onPhaseChange: ((matchId: bigint, phase: PhaseValue, tick: number) => void) | null = null;
    public onItemDrop: ((matchId: bigint, drops: ItemDropEvent[]) => void) | null = null;
    public onItemUsed: ((matchId: bigint, event: ItemUseEvent) => void) | null = null;
    public onItemRejected: ((matchId: bigint, player: string, reason: string) => void) | null = null;
    public onGameEnd: ((matchId: bigint, standings: Standing[], summary: MatchSummary) => void) | null = null;
    public onPortfolioUpdate: ((matchId: bigint, address: string, equity: number, status: string, entryPrice: number) => void) | null = null;
    public onElimination: ((matchId: bigint, address: string, tick: number) => void) | null = null;
    // T1 Items
    public onFogUpdate: ((matchId: bigint, foggedPlayers: string[]) => void) | null = null;
    public onXRayData: ((matchId: bigint, targetPlayer: string, inventories: Map<string, number[]>) => void) | null = null;
    public onThickSkinBlock: ((matchId: bigint, blocker: string, attacker: string, blockedItem: number) => void) | null = null;
    // T2 Items
    public onScrambleUpdate: ((matchId: bigint, scramblerAddress: string | null) => void) | null = null;
    public onMirrorCurseUpdate: ((matchId: bigint, cursedPlayers: string[]) => void) | null = null;
    public onMuteUpdate: ((matchId: bigint, mutedPlayers: string[]) => void) | null = null;
    // T3 Items
    public onShockwaveStart: ((matchId: bigint) => void) | null = null;
    public onShockwaveEnd: ((matchId: bigint) => void) | null = null;
    public onTimeWarpStart: ((matchId: bigint) => void) | null = null;
    public onTimeWarpEnd: ((matchId: bigint) => void) | null = null;
    public onBlackoutUpdate: ((matchId: bigint, blackoutUser: string | null) => void) | null = null;
    public onHeist: ((matchId: bigint, thief: string, victim: string | null, stolenEquity: number) => void) | null = null;
    // R-18: Lobby + Seed Reveal
    public onLobbyCountdown: ((matchId: bigint, secondsLeft: number) => void) | null = null;
    public onSeedReveal: ((matchId: bigint, seed: string) => void) | null = null;

    constructor(match: GameMatch, totalTicksOverride?: number) {
        this.match = match;
        this.itemRng = new SimpleRNG(match.seed + 12345n);
        this.leverage = match.mode === GameMode.SURVIVAL ? SURVIVAL_LEVERAGE : 1;

        this.totalMatchTicks = totalTicksOverride ?? (match.mode === GameMode.SURVIVAL ? SURVIVAL_TICKS : STANDARD_TICKS);

        const validSeed = findValidSeed(match.seed, this.totalMatchTicks);

        // R-13: Generate base deltas for on-the-fly pricing
        const chaosMultiplier = match.mode === GameMode.CHAOS ? CHAOS_VOLATILITY_MULTIPLIER : 1.0;
        const totalDeltas = PREVIEW_TICKS + this.totalMatchTicks;
        this.baseDeltas = generateBaseDeltas(validSeed, totalDeltas, chaosMultiplier);

        // LOGIC-10 FIX: Compute preview from the SAME baseDeltas used by the game.
        // Previously called generatePriceTicks(seed, 15) which derived different RNG params
        // (different totalTicks → different regime changes), creating a discontinuity.
        const previewPriceTicks: PriceTick[] = [];
        let previewPrice = 100; // START_PRICE
        for (let t = 0; t < PREVIEW_TICKS; t++) {
            const { price, basePrice, phase } = computeTickPrice(
                previewPrice, this.baseDeltas[t], t, false, match.mode,
            );
            previewPriceTicks.push({ tick: t, price, basePrice, phase });
            previewPrice = price;
        }
        this.previewTicks = previewPriceTicks;

        logger.info(TAG, `Match ${match.matchId}: ${PREVIEW_TICKS} preview + ${this.totalMatchTicks} game ticks (mode=${match.mode}, leverage=${this.leverage})${config.devMode ? ' (DEV)' : ''}`);
    }

    public start(): void {
        if (config.devMode) {
            // DEV: skip lobby/seed reveal, fast preview
            this.match.status = OffchainMatchStatus.PREVIEW;
            this.match.currentTick = 0;
            logger.info(TAG, `DEV: Skipping lobby/seed reveal for match ${this.match.matchId}`);
            for (const tick of this.previewTicks) {
                this.onPreviewTick?.(this.match.matchId, tick);
            }
            setTimeout(() => this.startMatch(), 2000);
            return;
        }

        // R-18: Phase 1 — Lobby countdown (GDD §1.1: 15s Duel, 20s Arena)
        const lobbyDuration = this.match.format === Format.DUEL ? LOBBY_DURATION_DUEL : LOBBY_DURATION_ARENA;
        let lobbySecondsLeft = lobbyDuration;
        logger.info(TAG, `Lobby started: match ${this.match.matchId} (${lobbyDuration}s)`);
        this.onLobbyCountdown?.(this.match.matchId, lobbySecondsLeft);

        const lobbyInterval = setInterval(() => {
            lobbySecondsLeft--;
            this.onLobbyCountdown?.(this.match.matchId, lobbySecondsLeft);
            if (lobbySecondsLeft <= 0) {
                clearInterval(lobbyInterval);
                this.startSeedReveal();
            }
        }, 1000);
    }

    /**
     * R-18: Phase 2 — Seed Reveal (5s). Show the seed publicly.
     */
    private startSeedReveal(): void {
        logger.info(TAG, `Seed reveal: match ${this.match.matchId}, seed=${this.match.seed}`);
        this.onSeedReveal?.(this.match.matchId, this.match.seed.toString());

        setTimeout(() => this.startPreview(), SEED_REVEAL_DURATION * 1000);
    }

    /**
     * R-18: Phase 3 — Preview. Candles shown before game starts, read-only.
     * SPRINT 3 FIX: First batch sent immediately (was 5s dead zone from setInterval).
     */
    private startPreview(): void {
        this.match.status = OffchainMatchStatus.PREVIEW;
        this.match.currentTick = 0;
        logger.info(TAG, `Preview started: match ${this.match.matchId}`);

        let previewIdx = 0;

        const sendBatch = (): boolean => {
            if (previewIdx >= this.previewTicks.length) {
                this.startMatch();
                return true;
            }
            const end = Math.min(previewIdx + 5, this.previewTicks.length);
            for (let i = previewIdx; i < end; i++) {
                this.onPreviewTick?.(this.match.matchId, this.previewTicks[i]);
            }
            previewIdx = end;
            return false;
        };

        // Send first batch NOW (no 5s dead zone)
        if (sendBatch()) return;

        const previewInterval = setInterval(() => {
            if (sendBatch()) clearInterval(previewInterval);
        }, 5000);
    }

    private startMatch(): void {
        this.match.status = OffchainMatchStatus.IN_PROGRESS;
        this.match.currentTick = 0;
        this.match.currentPhase = Phase.OPEN;
        this.prevPrice = this.previewTicks.length > 0
            ? this.previewTicks[this.previewTicks.length - 1].price
            : 100;
        this.onPreviewEnd?.(this.match.matchId);
        logger.info(TAG, `GO! Match ${this.match.matchId}`);
        this.realTick();
        this.tickInterval = setInterval(() => this.realTick(), 1000);
    }

    /** Execute trade immediately for instant feedback */
    public queueTrade(player: string, action: TradeAction): boolean {
        // M-07: Rate limit — max 2 trades per tick per player
        const tradeKey = player + ":" + this.match.currentTick;
        const count = this._tradeCountPerTick.get(tradeKey) ?? 0;
        if (count >= 2) return false;
        this._tradeCountPerTick.set(tradeKey, count + 1);
        if (this.match.status !== OffchainMatchStatus.IN_PROGRESS) return false;
        const p = this.match.players.get(player);
        if (!p || p.eliminated) return false;
        // v3: Block manual trades during active Scalp (auto-trade in progress)
        if (p.itemState.scalpActive) return false;
        // Execute immediately at current price instead of waiting for next tick
        const price = this.getCurrentPrice();
        const tick = this.match.currentTick;
        const result = executeTrade(p, action, price, tick, this.leverage);
        if (result.success && result.trade) {
            this.match.trades.push(result.trade);
            this.onTradeExecuted?.(this.match.matchId, result.trade);
            // Broadcast updated portfolio immediately
            const equity = computeEquity(p, price, this.leverage);
            this.onPortfolioUpdate?.(this.match.matchId, player, equity, p.position.status, p.position.entryPrice);
        } else if (result.reason) {
            this.onTradeRejected?.(this.match.matchId, player, result.reason);
        }
        return result.success ?? false;
    }

    /** Queue an item use */
    public queueItemUse(player: string, itemId: ItemIdValue, target: string | null = null): boolean {
        if (this.match.status !== OffchainMatchStatus.IN_PROGRESS) return false;
        const p = this.match.players.get(player);
        if (!p || p.eliminated) return false;
        // LOGIC-03 FIX: Use tick-based gate instead of phase check.
        // Chaos mode allows items from tick 20; Classic/Survival from tick 45.
        const itemUsableTick = getItemUsableTick(this.match.mode);
        if (this.match.currentTick < itemUsableTick) return false;
        this.pendingItemUses.push({ player, itemId, target });
        return true;
    }

    public markDisconnected(address: string): void {
        const player = this.match.players.get(address);
        if (!player) return;
        player.connected = false;
        player.disconnectedAtTick = this.match.currentTick;
        logger.info(TAG, `Player ${address} disconnected at tick ${this.match.currentTick}`);
    }

    public markReconnected(address: string): void {
        const player = this.match.players.get(address);
        if (!player) return;
        player.connected = true;
        player.disconnectedAtTick = -1;
        logger.info(TAG, `Player ${address} reconnected at tick ${this.match.currentTick}`);
    }

    public getStandings(): Standing[] {
        const price = this.getCurrentPrice();
        const entries: Array<{
            address: string; equity: number; status: string;
            eliminated: boolean; eliminatedAtTick: number; equityAtElimination: number;
        }> = [];

        for (const [address, player] of this.match.players) {
            const equity = player.eliminated
                ? player.equityAtElimination
                : computeEquity(player, price, this.leverage);
            entries.push({
                address, equity, status: player.position.status,
                eliminated: player.eliminated,
                eliminatedAtTick: player.eliminatedAtTick,
                equityAtElimination: player.equityAtElimination,
            });
        }

        // Sort: survivors first (by equity desc), then eliminated (by last-liquidated first for tiebreak)
        entries.sort((a, b) => {
            if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1; // survivors first
            if (!a.eliminated && !b.eliminated) {
                return b.equity !== a.equity ? b.equity - a.equity : a.address.localeCompare(b.address);
            }
            // Both eliminated: GDD §5.2 FIX #78 tiebreak chain:
            // (1) latest tick, (2) highest pre-liquidation equity, (3) lowest slot index
            if (a.eliminatedAtTick !== b.eliminatedAtTick) return b.eliminatedAtTick - a.eliminatedAtTick;
            if (a.equityAtElimination !== b.equityAtElimination) return b.equityAtElimination - a.equityAtElimination;
            return a.address.localeCompare(b.address);
        });

        return entries.map((e, i) => ({
            address: e.address, rank: i + 1, finalEquity: e.equity,
            positionStatus: e.status as Standing['positionStatus'],
            eliminated: e.eliminated, eliminatedAtTick: e.eliminatedAtTick,
        }));
    }

    public stop(): void {
        if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
    }

    // ── Private ──

    /**
     * Real-time tick handler (called every 1s by setInterval).
     * LOGIC-22: Time Warp removed — always processes exactly 1 game tick per call.
     */
    private realTick(): void {
        if (this.match.currentTick >= this.totalMatchTicks) {
            this.endGame();
            return;
        }
        this.processOneTick();
        if (this.match.status !== OffchainMatchStatus.IN_PROGRESS) return;

        // #20: Flat penalty runs once per real second
        this.applyPenalties();

        // Decrement Shockwave/Earthquake timer
        if (this.shockwaveRealSecondsLeft > 0) {
            this.shockwaveRealSecondsLeft--;
            if (this.shockwaveRealSecondsLeft <= 0) {
                this.shockwaveActive = false;
                // v3: Clear earthquake reduced cooldowns on all players
                this.earthquakeReducedCooldowns = false;
                for (const [, p] of this.match.players) {
                    p.itemState.earthquakeReducedCooldowns = false;
                }
                this.onShockwaveEnd?.(this.match.matchId);
                logger.info(TAG, `Earthquake ended for match ${this.match.matchId}`);
            }
        }

        // Decrement Blackout timer
        if (this.blackoutRealSecondsLeft > 0) {
            this.blackoutRealSecondsLeft--;
            if (this.blackoutRealSecondsLeft <= 0) {
                this.blackoutUser = null;
                this.onBlackoutUpdate?.(this.match.matchId, null);
                logger.info(TAG, `Blackout ended for match ${this.match.matchId}`);
            }
        }

        // Clear per-tick trade rate limiter once per real second
        this._tradeCountPerTick.clear();
    }

    /**
     * R-13: Process a single game tick with on-the-fly price computation.
     */
    private processOneTick(): void {
        const t = this.match.currentTick;
        const deltaIdx = PREVIEW_TICKS + t; // offset past preview deltas

        // R-13: Compute price on-the-fly from base delta
        const { price, basePrice, phase } = computeTickPrice(
            this.prevPrice,
            this.baseDeltas[deltaIdx] ?? 0,
            t,
            this.shockwaveActive,
            this.match.mode,
        );
        this.prevPrice = price;

        const priceTick: PriceTick = { tick: t, price, basePrice, phase };

        // 1. Phase change
        if (phase !== this.lastPhase) {
            this.lastPhase = phase;
            this.match.currentPhase = phase;
            this.onPhaseChange?.(this.match.matchId, phase, t);
            // #9: Store phase change event
            this.match.events.push({ type: 'PHASE_CHANGE', tick: t, detail: phase });
        }

        // 2. Store tick
        this.match.priceTicks.push(priceTick);

        // 3. Broadcast price
        this.onTick?.(this.match.matchId, priceTick);

        // 4. Item drops — R-11: pass player ranks for rubber banding
        const rankMap = this.getPlayerRankMap(price);
        const drops = processItemDrops(t, this.match.players, this.match.format, this.match.mode, () => this.itemRng.next(), rankMap);
        if (drops.length > 0) {
            this.onItemDrop?.(this.match.matchId, drops);
            // #9: Store drop events
            for (const d of drops) {
                this.match.events.push({ type: 'ITEM_DROP', tick: t, player: d.player, item: d.item });
            }
        }

        // 5. Process pending item uses
        this.processItemUses(t, price);

        // 6. Tick item effects
        tickItemEffects(t, this.match.players);

        // 6.5 v3: Process Scalp auto-closes (3× leverage, 3s duration)
        this.processScalpAutoClose(price, t);

        // 6.6 v3: Freeze flat penalty (1%/s equity bleed for frozen+flat players)
        for (const [, p] of this.match.players) {
            if (!p.eliminated && isFrozen(p.itemState, t) && p.position.status === 'FLAT') {
                const penalty = p.equity * getFreezeFlatPenalty();
                p.equity = Math.max(0, Math.round((p.equity - penalty) * 10000) / 10000);
            }
        }

        // 7. Trades now execute immediately in queueTrade() — clear any stale queue
        this.pendingTrades = [];

        // 8. Flat penalty — moved to realTick() for #20 (wall-clock seconds, not game ticks)

        // 8.5 Disconnect force-close
        this.checkDisconnects(price, t);

        // 9. R-10: Survival liquidation check
        if (this.match.mode === GameMode.SURVIVAL) {
            this.checkLiquidations(price, t);
            // Check end condition: 1 or 0 survivors
            const alive = this.countAlive();
            if (alive <= 1) {
                this.match.currentTick++;
                this.endGame();
                return;
            }
        }

        // 10. Portfolio updates
        this.broadcastPortfolios(price);

        // 10.5 Rate limiter cleared in realTick()

        // 11. Advance
        this.match.currentTick++;
        if (this.match.currentTick >= this.totalMatchTicks) this.endGame();
    }

    private processItemUses(tick: number, currentPrice: number): void {
        const rankMap = this.getPlayerRankMap(currentPrice);

        for (const pending of this.pendingItemUses) {
            const result = activateItem(
                pending.player, pending.itemId, tick,
                this.match.players, this.match.format,
                pending.target,
                () => this.itemRng.next(),
                rankMap,
            );
            if (result.success && result.event) {
                this.onItemUsed?.(this.match.matchId, result.event);

                this.match.events.push({
                    type: result.event.blocked ? 'ITEM_BLOCK' : result.event.stolenEquity !== undefined ? 'ITEM_STEAL' : 'ITEM_USE',
                    tick, player: result.event.player, item: result.event.item,
                    target: result.event.target,
                });

                // ── T3: NUKE — force-close + scaled price drop ──
                if (result.event.item === ItemId.NUKE) {
                    this.handleNuke(currentPrice, tick, result.event.player);
                }

                // ── T3: EARTHQUAKE — volatility ×5 + reduced cooldowns (v3: no flip) ──
                if (result.event.item === ItemId.EARTHQUAKE) {
                    this.shockwaveActive = true;
                    this.shockwaveRealSecondsLeft = 8;
                    this.earthquakeReducedCooldowns = true; // v3: all cooldowns → 1s
                    // Set flag on all players so trading.ts can check
                    for (const [, p] of this.match.players) {
                        p.itemState.earthquakeReducedCooldowns = true;
                    }
                    this.onShockwaveStart?.(this.match.matchId);
                    logger.info(TAG, '🌋 EARTHQUAKE! Volatility ×5, cooldowns → 1s for 8s');
                }

                // ── T3: BLACKOUT — hide UI + 2s price preview for activator ──
                if (result.event.item === ItemId.BLACKOUT) {
                    this.blackoutUser = result.event.player;
                    this.blackoutRealSecondsLeft = 6;
                    // LOGIC-14: Preview duration in ticks. With Time Warp removed (LOGIC-22),
                    // 1 tick = 1 real second always, so tick + 2 = 2 real seconds.
                    const activator = this.match.players.get(result.event.player);
                    if (activator) {
                        activator.itemState.blackoutPreviewUntilTick = tick + 2;
                    }
                    this.onBlackoutUpdate?.(this.match.matchId, this.blackoutUser);
                    logger.info(TAG, '🌑 BLACKOUT! UI hidden 6s, activator gets 2s preview');
                }

                // ── T3: HEIST — notify ──
                if (result.event.item === ItemId.HEIST && result.event.stolenEquity !== undefined) {
                    this.onHeist?.(this.match.matchId, result.event.player, result.event.target, result.event.stolenEquity);
                }

                // ── T1: SCALP — auto-trade with momentum detection + 3× leverage ──
                if (result.event.item === ItemId.SCALP) {
                    const p = this.match.players.get(pending.player);
                    if (p && !p.itemState.scalpActive) {
                        // LOGIC-04 FIX: Frozen players cannot activate Scalp (would bypass Freeze)
                        if (isFrozen(p.itemState, tick)) {
                            logger.info(TAG, `⚡ SCALP blocked for ${pending.player}: player is FROZEN`);
                        } else {
                        // Detect momentum from last 3 ticks
                        const recentTicks = this.match.priceTicks.slice(-3);
                        let upTicks = 0, downTicks = 0;
                        for (let i = 1; i < recentTicks.length; i++) {
                            if (recentTicks[i].price > recentTicks[i - 1].price) upTicks++;
                            else downTicks++;
                        }
                        const direction: 'LONG' | 'SHORT' = upTicks >= downTicks ? 'LONG' : 'SHORT';

                        // Activate scalp — snapshot equity, set entry
                        p.itemState.scalpActive = true;
                        p.itemState.scalpDirection = direction;
                        p.itemState.scalpEntryPrice = currentPrice;
                        p.itemState.scalpEntryTick = tick;
                        p.itemState.scalpEquityAtEntry = p.equity;

                        // If player had an open position, force-close it first
                        // LOGIC-20 FIX: Apply slippage, Boost, Freeze, and equity clamp
                        // (previously raw PnL bypassing all trading rules)
                        if (p.position.status !== 'FLAT') {
                            const dir = p.position.direction!;
                            const entry = p.position.entryPrice;
                            const freezeMult = getFreezeSlippageMultiplier(p.itemState, tick);
                            const baseSlip = hasGhostTrade(p.itemState, tick) ? 0 : BASE_SLIPPAGE;
                            const totalSlippage = baseSlip * freezeMult;
                            const execPrice = dir === 'LONG'
                                ? currentPrice * (1 - totalSlippage)
                                : currentPrice * (1 + totalSlippage);
                            const boostMult = consumeBoost(p.itemState, tick);
                            const pnl = (dir === 'LONG'
                                ? p.equity * (execPrice / entry - 1) * this.leverage
                                : p.equity * (1 - execPrice / entry) * this.leverage) * boostMult;
                            p.equity = Math.round((p.equity + pnl) * 10000) / 10000;
                            p.equity = Math.max(0, p.equity);
                            p.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
                            this.match.trades.push({
                                player: p.address, action: 'CLOSE',
                                price: Math.round(execPrice * 10000) / 10000,
                                slippage: Math.round(totalSlippage * 10000) / 10000,
                                tick, timestamp: Date.now(),
                            });
                        }

                        // Open the scalp position
                        p.position = { status: direction, entryPrice: currentPrice, entryTick: tick, direction };
                        p.itemState.scalpEquityAtEntry = p.equity;

                        this.match.trades.push({
                            player: p.address,
                            action: direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
                            price: currentPrice, slippage: 0, tick, timestamp: Date.now(),
                        });
                        logger.info(TAG, `⚡ SCALP by ${pending.player}: ${direction} @ ${currentPrice} (3× leverage, auto-close in ${SCALP_DURATION}s)`);
                        } // end else (not frozen)
                    }
                }
            } else if (result.reason) {
                this.onItemRejected?.(this.match.matchId, pending.player, result.reason);
            }
        }
        this.pendingItemUses = [];
    }

    /**
     * R-14: Nuke — force-close all players in a position (long or short).
     * No slippage. Flat players unaffected. Snipes consumed without applying (handled by items.ts).
     *
     * LOGIC-23: Nuke user is immune to their own Nuke (HIGH-5). Combined with the
     * scaled price drop (3-5%), a SHORT+Nuke combo is powerful but intentional:
     * - T3 items are rare drops with escalating probability
     * - Requires being in a SHORT position at the right moment
     * - Price drop is capped at 5% and benefits any surviving SHORT holder
     * - Other players can counter by staying FLAT or using Shield
     * This is an intended high-skill play for Ultimate-tier items.
     */
    private handleNuke(currentPrice: number, tick: number, nukeUser: string): void {
        let victimsClosed = 0;
        for (const [, player] of this.match.players) {
            if (player.position.status === 'FLAT') continue;
            if (player.eliminated) continue;
            // HIGH-5 FIX: Nuke user is immune to their own nuke
            if (player.address === nukeUser) continue;

            const dir = player.position.direction!;
            const entry = player.position.entryPrice;
            // LOGIC-07 FIX: Consume Boost on force-close (prevents "saving" boost past Nuke)
            const boostMult = consumeBoost(player.itemState, tick);
            const pnl = (dir === 'LONG'
                ? player.equity * (currentPrice / entry - 1) * this.leverage
                : player.equity * (1 - currentPrice / entry) * this.leverage) * boostMult;
            player.equity = Math.round((player.equity + pnl) * 10000) / 10000;
            // LOGIC-06 FIX: Clamp equity >= 0
            player.equity = Math.max(0, player.equity);
            player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
            // LOGIC-02 FIX: Clear scalp state so processScalpAutoClose doesn't double-close
            if (player.itemState.scalpActive) {
                player.itemState.scalpActive = false;
                player.itemState.scalpDirection = null;
                player.itemState.scalpEntryPrice = 0;
                player.itemState.scalpEntryTick = -1;
                player.itemState.scalpEquityAtEntry = 0;
            }
            this.match.trades.push({
                player: player.address, action: 'CLOSE',
                price: currentPrice, slippage: 0, tick, timestamp: Date.now(),
            });
            victimsClosed++;
        }
        // v3: Scaled price drop — 3% base + 0.5% per victim, max 5%
        const priceDrop = Math.min(NUKE_PRICE_DROP_MAX, NUKE_PRICE_DROP_BASE + victimsClosed * NUKE_PRICE_DROP_PER_VICTIM);
        this.prevPrice = Math.round(this.prevPrice * (1 - priceDrop) * 10000) / 10000;
        logger.info(TAG, `☢️ NUKE by ${nukeUser} — ${victimsClosed} closed, price -${(priceDrop * 100).toFixed(1)}% → ${this.prevPrice}`);
    }

    /**
     * v3: Process Scalp auto-closes. Scalp positions run at 3× internal leverage
     * and auto-close after 3 seconds. Player cannot manually trade during scalp.
     */
    private processScalpAutoClose(currentPrice: number, tick: number): void {
        for (const [, player] of this.match.players) {
            if (!player.itemState.scalpActive) continue;
            if (player.eliminated) continue;

            const elapsed = tick - player.itemState.scalpEntryTick;
            if (elapsed >= SCALP_DURATION) {
                // Auto-close the scalp position at 3× leverage
                // LOGIC-01 FIX: PnL computed from snapshot (position size at entry),
                // but ADDED to current equity (preserves Drain/Heist during scalp window)
                const dir = player.itemState.scalpDirection!;
                const entry = player.itemState.scalpEntryPrice;
                const equityAtEntry = player.itemState.scalpEquityAtEntry;
                const pnl = dir === 'LONG'
                    ? equityAtEntry * (currentPrice / entry - 1) * SCALP_LEVERAGE
                    : equityAtEntry * (1 - currentPrice / entry) * SCALP_LEVERAGE;
                player.equity = Math.round((player.equity + pnl) * 10000) / 10000;
                player.equity = Math.max(0, player.equity); // can't go negative
                player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };

                // Record close trade
                this.match.trades.push({
                    player: player.address, action: 'CLOSE',
                    price: currentPrice, slippage: 0, tick, timestamp: Date.now(),
                });

                const pnlPct = ((pnl / equityAtEntry) * 100).toFixed(1);
                logger.info(TAG, `⚡ SCALP auto-closed for ${player.address}: ${dir} ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)} (${pnlPct}%)`);

                // Reset scalp state
                player.itemState.scalpActive = false;
                player.itemState.scalpDirection = null;
                player.itemState.scalpEntryPrice = 0;
                player.itemState.scalpEntryTick = -1;
                player.itemState.scalpEquityAtEntry = 0;
            }
        }
    }

    // LOW-1: processTrades() removed — trades now execute immediately in queueTrade()

    private applyPenalties(): void {
        if (this.match.mode === GameMode.SURVIVAL) return; // No flat penalty in Survival

        // Bug 5.8: Pass correct mode-specific penalty config instead of 0,0,0
        const cfg = this.match.mode === GameMode.CHAOS ? FLAT_PENALTY_CHAOS
            : this.match.format === Format.DUEL ? FLAT_PENALTY_CLASSIC_DUEL
            : FLAT_PENALTY_CLASSIC_ARENA;

        for (const [, p] of this.match.players) {
            if (!p.eliminated) {
                // LOGIC-17 FIX: Skip flat penalty for Frozen players — Freeze has its own
                // 1%/s equity bleed (step 6.6 in processOneTick). Stacking both is double-dipping.
                if (isFrozen(p.itemState, this.match.currentTick)) continue;
                applyFlatPenalty(p, cfg.thresholdSec, cfg.penaltyPerTick, this.match.currentTick, this.match.currentPhase);
            }
        }
    }

    private checkDisconnects(currentPrice: number, currentTick: number): void {
        const DC_FORCE_CLOSE_TICKS = 30;
        for (const [, player] of this.match.players) {
            if (player.connected || player.disconnectedAtTick < 0 || player.eliminated) continue;
            if (player.position.status === 'FLAT') continue;
            if (currentTick - player.disconnectedAtTick >= DC_FORCE_CLOSE_TICKS) {
                const dir = player.position.direction!;
                const entry = player.position.entryPrice;
                // LOGIC-08 FIX: Respect Freeze slippage + Ghost Trade on DC force-close
                const freezeMult = getFreezeSlippageMultiplier(player.itemState, currentTick);
                const baseSlip = hasGhostTrade(player.itemState, currentTick) ? 0 : BASE_SLIPPAGE;
                const totalSlippage = baseSlip * freezeMult;
                const execPrice = dir === 'LONG'
                    ? currentPrice * (1 - totalSlippage)
                    : currentPrice * (1 + totalSlippage);
                // LOGIC-07 FIX: Consume Boost on DC force-close
                const boostMult = consumeBoost(player.itemState, currentTick);
                const pnl = (dir === 'LONG'
                    ? player.equity * (execPrice / entry - 1) * this.leverage
                    : player.equity * (1 - execPrice / entry) * this.leverage) * boostMult;
                player.equity = Math.round((player.equity + pnl) * 10000) / 10000;
                // LOGIC-06 FIX: Clamp equity >= 0
                player.equity = Math.max(0, player.equity);
                player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
                // Clear scalp state if active (consistent with LOGIC-02)
                if (player.itemState.scalpActive) {
                    player.itemState.scalpActive = false;
                    player.itemState.scalpDirection = null;
                    player.itemState.scalpEntryPrice = 0;
                    player.itemState.scalpEntryTick = -1;
                    player.itemState.scalpEquityAtEntry = 0;
                }
                this.match.trades.push({
                    player: player.address, action: 'CLOSE',
                    price: Math.round(execPrice * 10000) / 10000,
                    slippage: Math.round(totalSlippage * 10000) / 10000,
                    tick: currentTick, timestamp: Date.now(),
                });
                logger.info(TAG, `Force-closed ${player.address} (disconnected 30s)${freezeMult > 1 ? ' [Frozen: 5× slippage]' : ''}`);
            }
        }
    }

    /**
     * R-10: Survival liquidation check — equity ≤ 0 = eliminated.
     */
    private checkLiquidations(currentPrice: number, currentTick: number): void {
        for (const [, player] of this.match.players) {
            if (player.eliminated) continue;
            const equity = computeEquity(player, currentPrice, this.leverage);
            if (equity <= 0) {
                // Record pre-liquidation equity for tiebreak
                player.equityAtElimination = Math.max(0, player.equity); // equity before this tick
                player.eliminated = true;
                player.eliminatedAtTick = currentTick;
                // Force-close position
                if (player.position.status !== 'FLAT') {
                    player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
                    this.match.trades.push({
                        player: player.address, action: 'CLOSE',
                        price: currentPrice, slippage: 0, tick: currentTick, timestamp: Date.now(),
                    });
                }
                player.equity = 0;
                logger.info(TAG, `💀 ${player.address} LIQUIDATED at tick ${currentTick}`);
                this.onElimination?.(this.match.matchId, player.address, currentTick);
            }
        }
    }

    private countAlive(): number {
        let count = 0;
        for (const [, p] of this.match.players) {
            if (!p.eliminated) count++;
        }
        return count;
    }

    private broadcastPortfolios(price: number): void {
        // Collect fogged players
        const foggedPlayers: string[] = [];
        for (const [address, player] of this.match.players) {
            if (player.eliminated) continue;
            if (hasFogOfWar(player.itemState, this.match.currentTick)) {
                foggedPlayers.push(address);
            }
            const equity = computeEquity(player, price, this.leverage);
            this.onPortfolioUpdate?.(this.match.matchId, address, equity, player.position.status, player.position.entryPrice);
        }

        // Broadcast fog state — always send, empty array = effects cleared
        this.onFogUpdate?.(this.match.matchId, foggedPlayers);

        // X-Ray: send inventory data to players with X-Ray active
        for (const [address, player] of this.match.players) {
            if (player.eliminated) continue;
            if (hasXRay(player.itemState, this.match.currentTick)) {
                const inventories = new Map<string, number[]>();
                for (const [otherAddr, otherPlayer] of this.match.players) {
                    if (otherAddr !== address && !otherPlayer.eliminated) {
                        inventories.set(otherAddr, [...otherPlayer.itemState.inventory]);
                    }
                }
                this.onXRayData?.(this.match.matchId, address, inventories);
            }
        }

        // T2: Scramble — notify all clients; null scrambler = effect ended
        let activeScramblerAddr: string | null = null;
        for (const [address, player] of this.match.players) {
            if (player.eliminated) continue;
            if (hasScramble(player.itemState, this.match.currentTick)) {
                activeScramblerAddr = address;
                break;
            }
        }
        this.onScrambleUpdate?.(this.match.matchId, activeScramblerAddr);

        // T2: Mirror Curse — collect cursed players
        const cursedPlayers: string[] = [];
        for (const [address, player] of this.match.players) {
            if (!player.eliminated && hasMirrorCurse(player.itemState, this.match.currentTick)) {
                cursedPlayers.push(address);
            }
        }
        // T2: Mirror Curse — always broadcast, empty array = effect ended
        this.onMirrorCurseUpdate?.(this.match.matchId, cursedPlayers);

        // T2: Mute — collect muted players
        const mutedNow: string[] = [];
        for (const [address, player] of this.match.players) {
            if (!player.eliminated && isMuted(player.itemState, this.match.currentTick)) {
                mutedNow.push(address);
            }
        }
        // T2: Mute — always broadcast, empty array = effect ended
        this.onMuteUpdate?.(this.match.matchId, mutedNow);
    }

    /**
     * R-11: Build rank map for rubber banding in item drops.
     */
    private getPlayerRankMap(price: number): Map<string, number> {
        const entries: Array<{ address: string; equity: number }> = [];
        for (const [address, player] of this.match.players) {
            if (!player.eliminated) {
                entries.push({ address, equity: computeEquity(player, price, this.leverage) });
            }
        }
        entries.sort((a, b) => b.equity - a.equity);
        const map = new Map<string, number>();
        entries.forEach((e, i) => map.set(e.address, i + 1));
        return map;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MATCH SUMMARY — Captures per-player data before game cleanup.
    // This is the ONLY window to extract this data — once endGame()
    // fires the callback, the GameInstance will be removed.
    // ═══════════════════════════════════════════════════════════════════

    private buildMatchSummary(standings: Standing[]): MatchSummary {
        const standingMap = new Map<string, Standing>();
        for (const s of standings) standingMap.set(s.address, s);

        const players = new Map<string, PlayerMatchResult>();

        for (const [address, player] of this.match.players) {
            const standing = standingMap.get(address);
            if (!standing) continue;

            // ── Count trades for this player ──
            let tradesExecuted = 0;
            for (const t of this.match.trades) {
                if (t.player === address) tradesExecuted++;
            }

            // ── Count items used (ITEM_USE events) and items received (ITEM_DROP events) ──
            let itemsUsed = 0;
            let itemsReceived = 0;
            for (const evt of this.match.events) {
                if (evt.player === address) {
                    if (evt.type === 'ITEM_USE' || evt.type === 'ITEM_STEAL') itemsUsed++;
                    if (evt.type === 'ITEM_DROP') itemsReceived++;
                }
            }

            // ── Count ticks spent in a position (not flat) ──
            // Walk through trades to reconstruct position timeline
            let positionTicks = 0;
            let inPosition = false;
            let posOpenTick = 0;
            // Sort trades by tick for this player
            const playerTrades = this.match.trades
                .filter(t => t.player === address)
                .sort((a, b) => a.tick - b.tick);
            for (const trade of playerTrades) {
                if (trade.action === 'OPEN_LONG' || trade.action === 'OPEN_SHORT') {
                    inPosition = true;
                    posOpenTick = trade.tick;
                } else if (trade.action === 'CLOSE' && inPosition) {
                    positionTicks += trade.tick - posOpenTick;
                    inPosition = false;
                }
            }
            // If still in position at end (shouldn't happen after force-close, but defensive)
            if (inPosition) {
                positionTicks += this.match.currentTick - posOpenTick;
            }

            // ── Survival: survived until tick ──
            let survivalSurvivedUntilTick = -1;
            let survivalEliminationCause: 'liquidation' | 'survived' | 'n/a' = 'n/a';
            if (this.match.mode === GameMode.SURVIVAL) {
                if (player.eliminated) {
                    survivalSurvivedUntilTick = player.eliminatedAtTick;
                    survivalEliminationCause = 'liquidation';
                } else {
                    survivalSurvivedUntilTick = this.match.currentTick;
                    survivalEliminationCause = 'survived';
                }
            }

            players.set(address, {
                address,
                mode: this.match.mode,
                format: this.match.format,
                rank: standing.rank,
                finalEquity: standing.finalEquity,
                won: standing.rank === 1,
                pnlDelta: Math.round((standing.finalEquity - STARTING_CAPITAL) * 10000) / 10000,

                tradesExecuted,
                itemsUsed,
                itemsReceived,
                positionTicks,
                eliminatedAtTick: player.eliminatedAtTick,

                // Classic (future — zeroed until Classic mode mechanics land)
                classicTradesOfLimit: 0,

                // Survival
                survivalSurvivedUntilTick,
                survivalBountiesClaimed: 0,      // future: bounty system
                survivalRingDamageTaken: false,   // future: ring system
                survivalRingEscaped: false,       // future: ring system
                survivalEliminationCause,

                // Chaos (future — zeroed until Chaos mutator engine lands)
                chaosMultiplier: 1.0,
                chaosMutatorsExperienced: [],
                chaosWasInPositionDuringFlip: false,
                chaosSurvivedFlipProfitably: false,
                chaosGoldRushPnl: 0,
                chaosWasRobinHoodVictim: false,
                chaosPhantomMarketTraded: false,
                chaosPhantomMarketProfited: false,
            });
        }

        return {
            matchId: this.match.matchId,
            mode: this.match.mode,
            format: this.match.format,
            buyIn: this.match.buyIn,
            totalTicks: this.totalMatchTicks,
            durationTicks: this.match.currentTick,
            players,
        };
    }

    private endGame(): void {
        this.stop();
        const lastPrice = this.getCurrentPrice();
        const lastTick = this.match.currentTick;

        // Force-close all open positions (non-eliminated)
        for (const [, player] of this.match.players) {
            if (player.eliminated) continue;
            if (player.position.status !== 'FLAT') {
                const dir = player.position.direction!;
                const entry = player.position.entryPrice;
                // LOGIC-21 FIX: Apply slippage on endGame close (prevents "wait for timer" exploit)
                const freezeMult = getFreezeSlippageMultiplier(player.itemState, lastTick);
                const baseSlip = hasGhostTrade(player.itemState, lastTick) ? 0 : BASE_SLIPPAGE;
                const totalSlippage = baseSlip * freezeMult;
                const execPrice = dir === 'LONG'
                    ? lastPrice * (1 - totalSlippage)
                    : lastPrice * (1 + totalSlippage);
                // LOGIC-07 FIX: Consume Boost on end-of-game force-close
                const boostMult = consumeBoost(player.itemState, lastTick);
                const pnl = (dir === 'LONG'
                    ? player.equity * (execPrice / entry - 1) * this.leverage
                    : player.equity * (1 - execPrice / entry) * this.leverage) * boostMult;
                player.equity = Math.round((player.equity + pnl) * 10000) / 10000;
                // LOGIC-06 FIX: Clamp equity >= 0
                player.equity = Math.max(0, player.equity);
                player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
                this.match.trades.push({
                    player: player.address, action: 'CLOSE',
                    price: Math.round(execPrice * 10000) / 10000,
                    slippage: Math.round(totalSlippage * 10000) / 10000,
                    tick: lastTick, timestamp: Date.now(),
                });
            }
        }

        this.match.status = OffchainMatchStatus.FINISHED;
        const standings = this.getStandings();

        // Build match summary BEFORE game cleanup — this is the only window
        const summary = this.buildMatchSummary(standings);

        logger.info(TAG, `Game ended: match ${this.match.matchId} (${summary.players.size} players, ${summary.durationTicks} ticks)`);
        this.onGameEnd?.(this.match.matchId, standings, summary);
    }

    private getCurrentPrice(): number {
        const last = this.match.priceTicks[this.match.priceTicks.length - 1];
        return last ? last.price : 100;
    }

    /**
     * Get full game state snapshot for a reconnecting player.
     * Sends everything they need to resume mid-game.
     */
    public getReconnectSnapshot(address: string): Record<string, unknown> {
        const player = this.match.players.get(address);
        const price = this.getCurrentPrice();
        const playerAddresses: string[] = [];
        for (const [addr] of this.match.players) playerAddresses.push(addr);

        // Build standings
        const standings: Array<{ address: string; rank: number; finalEquity: number; positionStatus: string }> = [];
        const entries: Array<{ address: string; equity: number; status: string }> = [];
        for (const [addr, p] of this.match.players) {
            const eq = p.eliminated ? p.equityAtElimination : computeEquity(p, price, this.leverage);
            entries.push({ address: addr, equity: eq, status: p.position.status });
        }
        entries.sort((a, b) => b.equity - a.equity);
        entries.forEach((e, i) => standings.push({
            address: e.address, rank: i + 1, finalEquity: e.equity, positionStatus: e.status,
        }));

        // Player's own equity
        const equity = player
            ? (player.eliminated ? player.equityAtElimination : computeEquity(player, price, this.leverage))
            : 0;

        // FE-9 FIX: Include active item effects so reconnecting players see correct visual state
        const currentTick = this.match.currentTick;
        const foggedPlayers: string[] = [];
        const cursedPlayers: string[] = [];
        const mutedPlayers: string[] = [];
        let activeScramblerAddr: string | null = null;
        for (const [addr, p] of this.match.players) {
            if (p.eliminated) continue;
            if (hasFogOfWar(p.itemState, currentTick)) foggedPlayers.push(addr);
            if (hasMirrorCurse(p.itemState, currentTick)) cursedPlayers.push(addr);
            if (isMuted(p.itemState, currentTick)) mutedPlayers.push(addr);
            if (hasScramble(p.itemState, currentTick)) activeScramblerAddr = addr;
        }
        const playerFrozen = player ? isFrozen(player.itemState, currentTick) : false;
        const playerFrozenTick = player?.itemState.frozenUntilTick ?? -1;

        return {
            matchId: this.match.matchId.toString(),
            // L-04 FIX: Don't leak raw seed in reconnect — send commitment hash only.
            // Raw seed is revealed in GAME_END for post-match verification.
            seed: 'reconnect:hidden',
            totalTicks: this.totalMatchTicks,
            startingCapital: STARTING_CAPITAL,
            buyIn: this.match.buyIn.toString(),
            mode: this.match.mode,
            format: this.match.format,
            players: playerAddresses,
            devMode: config.devMode,
            // Current state
            currentTick: this.match.currentTick,
            currentPhase: this.match.currentPhase,
            priceTicks: this.match.priceTicks,
            // Player state
            equity,
            positionStatus: player?.position.status ?? 'FLAT',
            entryPrice: player?.position.entryPrice ?? 0,
            inventory: player?.itemState.inventory ?? [],
            tradeCount: player?.tradeCount ?? 0,
            // FE-9: Active effects
            shockwaveActive: this.shockwaveActive,
            timeWarpActive: false, // LOGIC-22: Time Warp removed
            blackoutUser: this.blackoutUser,
            foggedPlayers,
            scrambleActive: activeScramblerAddr !== null && activeScramblerAddr !== address,
            mirrorCursed: cursedPlayers.includes(address),
            muted: mutedPlayers.includes(address),
            frozen: playerFrozen,
            frozenAtTick: playerFrozen ? playerFrozenTick - 5 : -1, // approximate start tick
            // Match state
            standings,
            status: this.match.status,
        };
    }
}

// ── Registry ──

const activeGames = new Map<string, GameInstance>();
// BE-15 FIX: Track creation time for TTL sweep
const gameCreatedAt = new Map<string, number>();
const GAME_TTL_MS = 30 * 60 * 1000; // 30 minutes max lifetime

// BE-15: Sweep stale games every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, created] of gameCreatedAt) {
        if (now - created > GAME_TTL_MS) {
            const game = activeGames.get(key);
            if (game) {
                game.stop();
                activeGames.delete(key);
                logger.warn(TAG, `Swept stale game ${key} (age ${Math.round((now - created) / 60000)}min)`);
            }
            gameCreatedAt.delete(key);
        }
    }
}, 5 * 60 * 1000);

export function createGame(
    matchId: bigint, seed: bigint, mode: number, format: FormatValue,
    buyIn: bigint, playerAddresses: string[], totalTicksOverride?: number,
): GameInstance {
    const players = new Map<string, MatchPlayer>();
    for (const addr of playerAddresses) {
        players.set(addr, {
            address: addr, equity: STARTING_CAPITAL,
            position: { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null },
            tradeCount: 0, lastTradeTick: -999, lastCloseTick: -999,
            flatSeconds: 0, connected: true, disconnectedAtTick: -1,
            eliminated: false, eliminatedAtTick: -1, equityAtElimination: 0,
            itemState: createItemState(),
        });
    }
    const match: GameMatch = {
        matchId, mode: mode as GameMatch['mode'], format, buyIn, seed,
        status: OffchainMatchStatus.WAITING, players, trades: [], priceTicks: [],
        events: [],  // #9: Match log events
        currentTick: 0, currentPhase: Phase.OPEN, roundTimer: null,
    };
    const instance = new GameInstance(match, totalTicksOverride);
    activeGames.set(matchId.toString(), instance);
    gameCreatedAt.set(matchId.toString(), Date.now()); // BE-15: track for TTL sweep
    return instance;
}

export function getGame(matchId: bigint): GameInstance | undefined {
    return activeGames.get(matchId.toString());
}

export function removeGame(matchId: bigint): void {
    const key = matchId.toString();
    const game = activeGames.get(key);
    if (game) { game.stop(); activeGames.delete(key); }
    gameCreatedAt.delete(key); // BE-15: cleanup TTL tracker
}

/**
 * Find the active game a player is currently in (if any).
 * Used for reconnect after page reload.
 */
export function getGameByPlayer(address: string): { matchId: bigint; game: GameInstance } | null {
    for (const [key, game] of activeGames) {
        if (game.match.players.has(address) &&
            game.match.status !== 'finished' &&
            game.match.status !== 'settled' &&
            game.match.status !== 'error') {
            return { matchId: BigInt(key), game };
        }
    }
    return null;
}
