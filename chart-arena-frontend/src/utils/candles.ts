/**
 * R-19: Candle Aggregation — 1s ticks → 5s OHLC candles.
 *
 * GDD §2.2: "Bougies de 1 seconde (tick-level), affichées en 5s pour lisibilité."
 * The backend sends raw 1s ticks. The frontend aggregates 5 consecutive ticks
 * into one visible candle with open/high/low/close.
 */

export interface Candle {
    readonly startTick: number;       // first tick in this candle
    readonly endTick: number;         // last tick in this candle
    readonly open: number;            // price at first tick
    readonly high: number;            // highest price in the 5 ticks
    readonly low: number;             // lowest price in the 5 ticks
    readonly close: number;           // price at last tick
    readonly phase: string;           // phase of the last tick
}

export interface PriceTick {
    tick: number;
    price: number;
    basePrice: number;
    phase: string;
}

const CANDLE_SIZE = 5; // 5 ticks per candle

/**
 * Aggregate an array of 1-second price ticks into 5-second candles.
 * Incomplete candles at the end are included (the current forming candle).
 */
export function aggregateCandles(ticks: PriceTick[]): Candle[] {
    if (ticks.length === 0) return [];

    const candles: Candle[] = [];

    for (let i = 0; i < ticks.length; i += CANDLE_SIZE) {
        const chunk = ticks.slice(i, i + CANDLE_SIZE);
        if (chunk.length === 0) break;

        const prices = chunk.map((t) => t.price);
        candles.push({
            startTick: chunk[0].tick,
            endTick: chunk[chunk.length - 1].tick,
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices[prices.length - 1],
            phase: chunk[chunk.length - 1].phase,
        });
    }

    return candles;
}

/**
 * Get the current (latest) candle being formed.
 * Useful for real-time display — this candle may have 1-4 ticks.
 */
export function getCurrentCandle(ticks: PriceTick[]): Candle | null {
    if (ticks.length === 0) return null;
    const remainder = ticks.length % CANDLE_SIZE;
    const startIdx = remainder === 0
        ? ticks.length - CANDLE_SIZE
        : ticks.length - remainder;
    const chunk = ticks.slice(startIdx);
    const prices = chunk.map((t) => t.price);
    return {
        startTick: chunk[0].tick,
        endTick: chunk[chunk.length - 1].tick,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        phase: chunk[chunk.length - 1].phase,
    };
}
