/**
 * Chart Engine v2 — Volatile & Interesting
 *
 * Fixes from v1:
 *   - 4× higher base volatility so noise visibly moves the chart
 *   - Mean reversion pulls price back toward 100 (prevents runaway)
 *   - 4-7 regime changes instead of 1-3 (more reversals)
 *   - Momentum system with decay (trends build and fade naturally)
 *   - Consolidation → breakout micro-patterns
 *   - Spike events are larger and more frequent
 *   - Tighter seed validation rejects boring charts
 *
 * Layer 1: Seed → base deltas (deterministic, verifiable from seed alone)
 * Layer 2: Phase multipliers applied at runtime
 *
 * price[t] = clamp(price[t-1] + baseDelta[t] × phaseMultiplier, 20, 150)
 */

import type { PriceTick } from '../game/types.js';
import { PHASES, STANDARD_TICKS, type PhaseValue, type GameModeValue, Phase, getPhase } from '../utils/constants.js';

// ── Seeded PRNG (xoshiro128**) ──

class SeededRNG {
    private s0: number;
    private s1: number;
    private s2: number;
    private s3: number;

    constructor(seed: bigint) {
        let s = Number(seed & 0xFFFFFFFFn);
        this.s0 = this.splitmix32(s); s = this.s0;
        this.s1 = this.splitmix32(s); s = this.s1;
        this.s2 = this.splitmix32(s); s = this.s2;
        this.s3 = this.splitmix32(s);
    }

    private splitmix32(state: number): number {
        state = (state + 0x9e3779b9) | 0;
        let t = state ^ (state >>> 16);
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ (t >>> 15);
        t = Math.imul(t, 0x735a2d97);
        t = t ^ (t >>> 15);
        return t >>> 0;
    }

    next(): number {
        const result = this.rotl(this.s1 * 5, 7) * 9;
        const t = this.s1 << 9;
        this.s2 ^= this.s0; this.s3 ^= this.s1;
        this.s1 ^= this.s2; this.s0 ^= this.s3;
        this.s2 ^= t; this.s3 = this.rotl(this.s3, 11);
        return (result >>> 0) / 4294967296;
    }

    nextGaussian(): number {
        const u1 = Math.max(this.next(), 1e-10);
        const u2 = this.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    nextRange(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    private rotl(x: number, k: number): number {
        return ((x << k) | (x >>> (32 - k))) >>> 0;
    }
}

// ── Chart Parameters (derived from seed) ──

interface ChartParams {
    trendBias: number;              // -1.0 to +1.0 (initial direction)
    baseVolatility: number;         // 0.5 to 1.2
    meanReversionStrength: number;  // 0.003 to 0.012
    momentumDecay: number;          // 0.92 to 0.98
    regimeChanges: number[];        // tick indices where trend flips
    spikeEvents: Array<{ tick: number; magnitude: number }>; // sudden moves
    consolidationZones: Array<{ start: number; end: number }>; // low-vol zones before breakouts
}

// ── Constants ──

const MIN_PRICE = 20.0;
const MAX_PRICE = 150.0;
const START_PRICE = 100.0;

// ── Public API ──

/**
 * Generate LAYER 1: base deltas from seed (no phase multipliers).
 * These deltas are deterministic and verifiable from the seed alone.
 * R-11: chaosMultiplier applies ×1.3 base volatility for Chaos mode.
 */
export function generateBaseDeltas(seed: bigint, totalTicks: number = STANDARD_TICKS, chaosMultiplier: number = 1.0): number[] {
    const rng = new SeededRNG(seed);
    const params = deriveParams(rng, totalTicks);
    return computeBaseDeltas(rng, params, totalTicks, chaosMultiplier);
}

/**
 * R-13: Compute a single tick's price on-the-fly from base delta.
 * Used by the game loop for real-time Shockwave/Time Warp support.
 */
export function computeTickPrice(
    prevPrice: number,
    baseDelta: number,
    tick: number,
    shockwaveActive: boolean = false,
    mode?: GameModeValue,
): { price: number; basePrice: number; phase: PhaseValue } {
    const phaseConfig = getPhase(tick, mode);
    const basePrice = clamp(prevPrice + baseDelta, MIN_PRICE, MAX_PRICE);

    let multiplier = phaseConfig.volatilityMultiplier;
    if (shockwaveActive) multiplier *= 5; // GDD §4.3: Earthquake ×5

    const realPrice = clamp(prevPrice + baseDelta * multiplier, MIN_PRICE, MAX_PRICE);

    return {
        price: round4(realPrice),
        basePrice: round4(basePrice),
        phase: phaseConfig.name,
    };
}

/**
 * Generate LAYER 2: final price ticks with phase multipliers applied.
 */
export function generatePriceTicks(
    seed: bigint,
    totalTicks: number = STANDARD_TICKS,
    shockwaveActive?: Set<number>,
): PriceTick[] {
    const baseDeltas = generateBaseDeltas(seed, totalTicks);
    const ticks: PriceTick[] = [];
    let basePrice = START_PRICE;
    let realPrice = START_PRICE;

    for (let t = 0; t < totalTicks; t++) {
        const phase = getPhase(t);
        const delta = baseDeltas[t];

        basePrice = clamp(basePrice + delta, MIN_PRICE, MAX_PRICE);

        let multiplier = phase.volatilityMultiplier;
        if (shockwaveActive?.has(t)) {
            multiplier *= 5;
        }

        realPrice = clamp(realPrice + delta * multiplier, MIN_PRICE, MAX_PRICE);

        ticks.push({
            tick: t,
            price: round4(realPrice),
            basePrice: round4(basePrice),
            phase: phase.name,
        });
    }

    return ticks;
}

/**
 * Validate seed quality — much stricter than v1.
 * Ensures charts have visible volatility and reversals.
 */
export function validateSeed(seed: bigint, totalTicks: number = STANDARD_TICKS): boolean {
    const ticks = generatePriceTicks(seed, totalTicks);
    const prices = ticks.map((t) => t.price);

    // 1. Range minimum: at least ±12% total movement (was 8%)
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const totalRange = (maxP - minP) / START_PRICE;
    if (totalRange < 0.12) return false;

    // 2. End price: must end within ±18% of start (was 25%)
    //    Prevents charts that just drift endlessly in one direction
    const lastPrice = prices[prices.length - 1];
    const drift = (lastPrice - START_PRICE) / START_PRICE;
    if (Math.abs(drift) > 0.18) return false;

    // 3. Preview signal: first 15 ticks must show at least 2.5% movement
    const previewPrices = prices.slice(0, 15);
    const previewRange = (Math.max(...previewPrices) - Math.min(...previewPrices)) / START_PRICE;
    if (previewRange < 0.025) return false;

    // 4. Direction changes: count significant reversals (>2% swing)
    //    Must have at least 4 across the whole match
    let reversals = 0;
    let lastDir = 0; // -1 = down, 0 = none, 1 = up
    let swingStart = prices[0];
    for (let i = 1; i < prices.length; i++) {
        const move = (prices[i] - swingStart) / swingStart;
        if (move > 0.02 && lastDir !== 1) {
            if (lastDir === -1) reversals++;
            lastDir = 1;
            swingStart = prices[i];
        } else if (move < -0.02 && lastDir !== -1) {
            if (lastDir === 1) reversals++;
            lastDir = -1;
            swingStart = prices[i];
        }
    }
    if (reversals < 4) return false;

    // 5. MID phase volatility: at least 5 ticks with >0.8% movement (was 3 at 1%)
    let bigMoves = 0;
    for (let i = 46; i < Math.min(165, prices.length); i++) {
        const move = Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]);
        if (move > 0.008) bigMoves++;
    }
    if (bigMoves < 5) return false;

    // 6. No 30-tick monotonic runs (every 30 ticks must have at least one reversal)
    for (let start = 0; start < prices.length - 30; start += 15) {
        const segment = prices.slice(start, start + 30);
        let allUp = true, allDown = true;
        for (let i = 1; i < segment.length; i++) {
            if (segment[i] < segment[i - 1]) allUp = false;
            if (segment[i] > segment[i - 1]) allDown = false;
        }
        if (allUp || allDown) return false;
    }

    return true;
}

/**
 * Find a valid seed (rehash up to 20 times if needed).
 */
export function findValidSeed(initialSeed: bigint, totalTicks: number = STANDARD_TICKS): bigint {
    let seed = initialSeed;
    for (let i = 0; i < 20; i++) {
        if (validateSeed(seed, totalTicks)) return seed;
        seed = seed + 1n;
    }
    // Fallback
    return initialSeed;
}

// ── Internal ──

function deriveParams(rng: SeededRNG, totalTicks: number): ChartParams {
    const trendBias = rng.nextRange(-0.6, 0.6);
    const baseVolatility = rng.nextRange(0.5, 1.2);
    const meanReversionStrength = rng.nextRange(0.003, 0.012);
    const momentumDecay = rng.nextRange(0.92, 0.98);

    // 4-7 regime changes (was 1-3) — more direction flips
    const numRegimes = rng.nextInt(4, 7);
    const regimeChanges: number[] = [];
    for (let i = 0; i < numRegimes; i++) {
        regimeChanges.push(rng.nextInt(
            Math.floor(totalTicks * 0.08),
            Math.floor(totalTicks * 0.92),
        ));
    }
    regimeChanges.sort((a, b) => a - b);

    // Spike events: 2-5 (was 0-2), bigger and more frequent
    const numSpikes = rng.nextInt(2, 5);
    const spikeEvents: Array<{ tick: number; magnitude: number }> = [];
    for (let i = 0; i < numSpikes; i++) {
        spikeEvents.push({
            tick: rng.nextInt(16, totalTicks - 31),
            magnitude: rng.nextRange(3, 8),
        });
    }

    // Consolidation zones: 1-3 tight ranges that break out
    const numConsol = rng.nextInt(1, 3);
    const consolidationZones: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < numConsol; i++) {
        const start = rng.nextInt(20, totalTicks - 40);
        const duration = rng.nextInt(8, 20);
        consolidationZones.push({ start, end: start + duration });
    }

    return { trendBias, baseVolatility, meanReversionStrength, momentumDecay, regimeChanges, spikeEvents, consolidationZones };
}

function computeBaseDeltas(rng: SeededRNG, params: ChartParams, totalTicks: number, chaosMultiplier: number = 1.0): number[] {
    const deltas: number[] = [];
    let currentTrend = params.trendBias;
    let regimeIdx = 0;
    let momentum = 0;
    let runningPrice = START_PRICE; // track for mean reversion

    for (let t = 0; t < totalTicks; t++) {
        // ── Regime change: flip trend direction ──
        if (regimeIdx < params.regimeChanges.length && t >= params.regimeChanges[regimeIdx]) {
            // Stronger flip: fully reverse + random variation
            currentTrend = -currentTrend * rng.nextRange(0.6, 1.4);
            currentTrend = Math.max(-1, Math.min(1, currentTrend));
            // Momentum gets a kick in the new direction
            momentum += (currentTrend > 0 ? 1 : -1) * rng.nextRange(0.1, 0.3);
            regimeIdx++;
        }

        // ── Mean reversion: pull back toward 100 ──
        const deviation = (runningPrice - START_PRICE) / START_PRICE;
        const meanRevForce = -deviation * params.meanReversionStrength * START_PRICE;

        // ── Consolidation zone: drastically reduce volatility ──
        let consolMultiplier = 1.0;
        let inConsol = false;
        for (const zone of params.consolidationZones) {
            if (t >= zone.start && t < zone.end) {
                consolMultiplier = 0.2;
                inConsol = true;
            }
            // Breakout tick: double volatility right after consolidation
            if (t === zone.end) {
                consolMultiplier = 2.5;
                momentum += (rng.next() > 0.5 ? 1 : -1) * rng.nextRange(0.3, 0.6);
            }
        }

        // ── Base volatility with Gaussian noise ──
        // sigma is 4× higher than v1: 0.08 instead of 0.02
        const sigma = params.baseVolatility * 0.08 * consolMultiplier;

        let dW = rng.nextGaussian();

        // ── Spike events ──
        for (const spike of params.spikeEvents) {
            if (t === spike.tick) {
                dW *= spike.magnitude;
            }
        }

        // ── Momentum: trends build up and decay ──
        momentum *= params.momentumDecay;
        // Small random momentum shifts every ~20 ticks
        if (t % 20 === 0 && rng.next() > 0.5) {
            momentum += rng.nextGaussian() * 0.15;
        }

        // ── Compose delta ──
        const trendComponent = currentTrend * 0.15; // stronger trend influence
        const noiseComponent = sigma * dW * START_PRICE;
        const momentumComponent = momentum * 0.3;

        const delta = (trendComponent + noiseComponent + momentumComponent + meanRevForce) * chaosMultiplier;

        deltas.push(delta);
        runningPrice = clamp(runningPrice + delta, MIN_PRICE, MAX_PRICE);
    }

    return deltas;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}
