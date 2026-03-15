/**
 * Trading Engine v3 — Item Integration
 *
 * v3 Item effects on trading:
 * - Ghost Trade: zero slippage for 8s
 * - Freeze: can't OPEN, can CLOSE at 5× slippage, 1%/s flat penalty (handled in game-loop)
 * - Boost: next close ×1.5 PnL (gains AND losses)
 * - Scalp: player locked out during auto-trade (handled in game-loop)
 * - Earthquake: all cooldowns reduced to 1s
 */

import type { MatchPlayer, TradeAction, TradeRecord, Direction } from './types.js';
import { isFrozen, consumeBoost, hasGhostTrade, getFreezeSlippageMultiplier, hasEarthquakeReducedCooldowns } from './items.js';
import {
    COOLDOWN_OPEN_CLOSE, COOLDOWN_CLOSE_OPEN,
    MAX_TRADES_PER_MATCH, BASE_SLIPPAGE,
} from '../utils/constants.js';

export interface TradeResult {
    success: boolean;
    trade: TradeRecord | null;
    reason: string | null;
    boosted?: boolean;
}

export function executeTrade(
    player: MatchPlayer,
    action: TradeAction,
    currentPrice: number,
    currentTick: number,
    leverage: number = 1,
): TradeResult {
    // v3 Freeze: can't OPEN, but CAN close (at 5× slippage)
    if (isFrozen(player.itemState, currentTick)) {
        if (action === 'OPEN_LONG' || action === 'OPEN_SHORT') {
            const remaining = player.itemState.frozenUntilTick - currentTick;
            return fail(`🧊 FROZEN — can't open for ${remaining}s (close is allowed)`);
        }
        // CLOSE is allowed but with penalty slippage — handled below via getFreezeSlippageMultiplier
    }

    if (player.tradeCount >= MAX_TRADES_PER_MATCH) {
        return fail('Max trades reached');
    }

    switch (action) {
        case 'OPEN_LONG':  return openPosition(player, 'LONG', currentPrice, currentTick);
        case 'OPEN_SHORT': return openPosition(player, 'SHORT', currentPrice, currentTick);
        case 'CLOSE':      return closePosition(player, currentPrice, currentTick, leverage);
        default:           return fail('Invalid action');
    }
}

function openPosition(
    player: MatchPlayer, direction: Direction,
    currentPrice: number, currentTick: number,
): TradeResult {
    if (player.position.status !== 'FLAT') {
        return fail('Already in position — close first');
    }

    // v3: Earthquake reduces cooldowns to 1s
    const closeToOpenCD = hasEarthquakeReducedCooldowns(player.itemState) ? 1 : COOLDOWN_CLOSE_OPEN;
    const ticksSinceClose = currentTick - player.lastCloseTick;
    if (player.lastCloseTick >= 0 && ticksSinceClose < closeToOpenCD) {
        return fail(`Cooldown: wait ${closeToOpenCD - ticksSinceClose}s`);
    }

    // v3: Ghost Trade = zero slippage
    const totalSlippage = hasGhostTrade(player.itemState, currentTick) ? 0 : BASE_SLIPPAGE;

    const execPrice = direction === 'LONG'
        ? currentPrice * (1 + totalSlippage)
        : currentPrice * (1 - totalSlippage);

    player.position = { status: direction, entryPrice: execPrice, entryTick: currentTick, direction };
    player.tradeCount++;
    player.lastTradeTick = currentTick;

    const action: TradeAction = direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT';

    return {
        success: true,
        trade: {
            player: player.address, action,
            price: round4(execPrice), slippage: round4(totalSlippage),
            tick: currentTick, timestamp: Date.now(),
        },
        reason: null,
    };
}

function closePosition(
    player: MatchPlayer, currentPrice: number, currentTick: number, leverage: number = 1,
): TradeResult {
    if (player.position.status === 'FLAT') {
        return fail('No position to close');
    }

    // v3: Earthquake reduces cooldowns to 1s
    const openToCloseCD = hasEarthquakeReducedCooldowns(player.itemState) ? 1 : COOLDOWN_OPEN_CLOSE;
    const ticksSinceOpen = currentTick - player.position.entryTick;
    if (ticksSinceOpen < openToCloseCD) {
        return fail(`Cooldown: wait ${openToCloseCD - ticksSinceOpen}s`);
    }

    // v3: Freeze = 5× slippage on close; Ghost Trade = zero slippage
    const freezeMult = getFreezeSlippageMultiplier(player.itemState, currentTick);
    const baseSlip = hasGhostTrade(player.itemState, currentTick) ? 0 : BASE_SLIPPAGE;
    const totalSlippage = baseSlip * freezeMult;

    const direction = player.position.direction!;
    const execPrice = direction === 'LONG'
        ? currentPrice * (1 - totalSlippage)
        : currentPrice * (1 + totalSlippage);

    // PnL with optional Boost multiplier
    // LOGIC-15: Pass currentTick so consumeBoost can verify expiry
    const boostMult = consumeBoost(player.itemState, currentTick);
    const pnl = computePnL(player.equity, player.position.entryPrice, execPrice, direction, leverage) * boostMult;
    player.equity = round4(player.equity + pnl);
    // LOGIC-06 FIX: Clamp equity >= 0 (Survival 2× leverage can produce negative equity)
    player.equity = Math.max(0, player.equity);

    player.position = { status: 'FLAT', entryPrice: 0, entryTick: 0, direction: null };
    player.tradeCount++;
    player.lastTradeTick = currentTick;
    player.lastCloseTick = currentTick;

    return {
        success: true,
        trade: {
            player: player.address, action: 'CLOSE',
            price: round4(execPrice), slippage: round4(totalSlippage),
            tick: currentTick, timestamp: Date.now(),
        },
        reason: null,
        boosted: boostMult > 1,
    };
}

function computePnL(equity: number, entryPrice: number, exitPrice: number, direction: Direction, leverage: number = 1): number {
    if (entryPrice === 0) return 0;
    const rawPnl = direction === 'LONG'
        ? equity * (exitPrice / entryPrice - 1)
        : equity * (1 - exitPrice / entryPrice);
    return rawPnl * leverage;
}

export function computeEquity(player: MatchPlayer, currentPrice: number, leverage: number = 1): number {
    if (player.position.status === 'FLAT') return player.equity;
    const direction = player.position.direction!;
    const entry = player.position.entryPrice;
    if (entry === 0) return player.equity;
    const unrealizedPnl = computePnL(player.equity, entry, currentPrice, direction, leverage);
    return round4(player.equity + unrealizedPnl);
}

/**
 * Flat penalty v2 — mode-aware escalating.
 * LOGIC-16: Renamed penaltyPct → basePenalty (it's a flat $ amount, not a %).
 * Escalation: 1× base for 0-10s overtime, 2× for 10-20s, 3× for 20-40s, 5× for 40s+.
 */
export function applyFlatPenalty(
    player: MatchPlayer, thresholdSec: number, basePenalty: number,
    currentTick?: number, currentPhase?: string,
): void {
    if (player.position.status !== 'FLAT') {
        player.flatSeconds = 0;
        return;
    }

    // MED-8 FIX: Grace period = OPEN phase end tick (45) — was incorrectly hardcoded to 15
    if (currentTick !== undefined && currentTick < 45) return;

    player.flatSeconds++;

    const flat = player.flatSeconds;
    if (flat < thresholdSec) return;

    const overtime = flat - thresholdSec;
    let penaltyPerTick: number;
    if (overtime < 10) penaltyPerTick = basePenalty;
    else if (overtime < 20) penaltyPerTick = basePenalty * 2;
    else if (overtime < 40) penaltyPerTick = basePenalty * 3;
    else penaltyPerTick = basePenalty * 5;

    player.equity = Math.max(0, round4(player.equity - penaltyPerTick));
}

function fail(reason: string): TradeResult {
    return { success: false, trade: null, reason };
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}
