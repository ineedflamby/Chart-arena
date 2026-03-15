/**
 * Bot Service — simulates opponents with varied trading styles.
 *
 * Sprint 1: Multi-bot support for Arena (5 players).
 * Each bot gets a unique address and slightly different behavior.
 */
import { config } from '../config.js';
import { getGame } from '../game/game-loop.js';
import { logger } from '../utils/logger.js';

const TAG = 'Bot';

// ── Bot Addresses (up to 4 bots for Arena) ──
// BE-4 FIX: Use a recognizable prefix + deterministic hex so they:
//   1. Won't collide with real wallet addresses
//   2. Are easy to filter in stats/leaderboards
//   3. Display cleanly in UI (first 8 chars shown)
const BOT_PREFIX = 'bot_';
const BOT_ADDRESSES = [
    'bot_0001_aggressive_alpha_000000000000000000',
    'bot_0002_cautious_beta_0000000000000000000000',
    'bot_0003_balanced_gamma_000000000000000000000',
    'bot_0004_random_delta_0000000000000000000000000',
];

/**
 * Bot personalities — each bot trades slightly differently.
 * openChance: probability of opening when FLAT
 * closeChance: probability of closing when in position
 * longBias: probability of going LONG vs SHORT when opening
 * itemUseChance: probability of using an item each tick
 * tickIntervalMs: base interval between decisions
 */
interface BotPersonality {
    readonly openChance: number;
    readonly closeChance: number;
    readonly longBias: number;
    readonly itemUseChance: number;
    readonly tickIntervalMs: number;
}

const PERSONALITIES: BotPersonality[] = [
    { openChance: 0.50, closeChance: 0.40, longBias: 0.65, itemUseChance: 0.35, tickIntervalMs: 2500 }, // aggressive
    { openChance: 0.25, closeChance: 0.20, longBias: 0.50, itemUseChance: 0.20, tickIntervalMs: 5000 }, // cautious
    { openChance: 0.35, closeChance: 0.30, longBias: 0.55, itemUseChance: 0.25, tickIntervalMs: 3500 }, // balanced
    { openChance: 0.40, closeChance: 0.35, longBias: 0.50, itemUseChance: 0.30, tickIntervalMs: 3000 }, // random
];

const activeBotIntervals = new Map<string, ReturnType<typeof setInterval>[]>();

/**
 * Get N bot addresses for a match.
 */
export function getBotAddresses(count: number): string[] {
    return BOT_ADDRESSES.slice(0, Math.min(count, BOT_ADDRESSES.length));
}

/** Legacy single-bot support */
export function getBotAddress(): string { return BOT_ADDRESSES[0]; }

export function isBotAddress(address: string): boolean {
    // BE-4: Check prefix first (catches any future bot addresses), then exact match
    return address.startsWith(BOT_PREFIX) || BOT_ADDRESSES.includes(address);
}

/**
 * Start bot trading for all bots in a match.
 */
export function startBotTrading(matchId: bigint, botAddresses: string[]): void {
    if (!config.devMode) return;

    const intervals: ReturnType<typeof setInterval>[] = [];

    for (let i = 0; i < botAddresses.length; i++) {
        const addr = botAddresses[i];
        const personality = PERSONALITIES[i % PERSONALITIES.length];
        const jitter = Math.random() * 1000; // stagger start times

        const interval = setInterval(() => {
            const game = getGame(matchId);
            if (!game) { clearInterval(interval); return; }
            if (game.match.status !== 'in_progress') {
                if (game.match.status === 'finished' || game.match.status === 'settled') {
                    clearInterval(interval);
                }
                return;
            }

            const player = game.match.players.get(addr);
            if (!player || player.eliminated) return;

            // Use items if available
            if (player.itemState.inventory.length > 0 && Math.random() < personality.itemUseChance) {
                const itemId = player.itemState.inventory[0];
                game.queueItemUse(addr, itemId);
                return;
            }

            // Trading decisions
            if (player.position.status === 'FLAT') {
                if (Math.random() < personality.openChance) {
                    const action = Math.random() < personality.longBias ? 'OPEN_LONG' : 'OPEN_SHORT';
                    game.queueTrade(addr, action);
                }
            } else {
                if (Math.random() < personality.closeChance) {
                    game.queueTrade(addr, 'CLOSE');
                }
            }
        }, personality.tickIntervalMs + jitter);

        intervals.push(interval);
    }

    activeBotIntervals.set(matchId.toString(), intervals);
    logger.info(TAG, `${botAddresses.length} bot(s) started for match ${matchId}`);
}

/**
 * Stop all bots for a match (cleanup).
 */
export function stopBotTrading(matchId: bigint): void {
    const key = matchId.toString();
    const intervals = activeBotIntervals.get(key);
    if (intervals) {
        for (const i of intervals) clearInterval(i);
        activeBotIntervals.delete(key);
    }
}
