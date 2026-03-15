/**
 * Item System v2 — SPECTACULAR & IMPRESSIVE
 *
 * 14 items across 3 tiers:
 *   T1 (5): Phantom, Shield, Flash Trade, Radar, Boost
 *   T2 (5): Freeze, Mirror Curse, Drain, Glitch, Swap
 *   T3 (4): Nuke, Blackout, Earthquake, Heist
 *
 * Drop schedules are per-mode with escalating T3 rates per drop.
 * Classic Duel: 3 drops, NO T3 (pure skill)
 * Classic Arena: 4 drops, T3 escalates to 50%
 * Survival Arena: 5 drops, T3 escalates to 60%
 * Chaos Duel: 5 drops, T3 from drop 1 (10% → 60%)
 * Chaos Arena: 7 drops, T3 escalates to 65%
 *
 * Usable from:
 *   Classic/Survival: tick 45 (MID phase)
 *   Chaos: tick 20 (late OPEN — chaos starts early)
 */

import type { MatchPlayer } from './types.js';
import { Format, GameMode, type FormatValue, type GameModeValue } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const TAG = 'Items';

// ═══ ITEM DEFINITIONS ═══

export const ItemId = {
    // Tier 1 — Trading Powers
    GHOST_TRADE: 1,   // Zero slippage + hidden position 8s
    SHIELD: 2,        // Block next attack, 50% reflect, grants Boost on block. 10s
    SCALP: 3,         // Auto-trade: momentum detection, 3× leverage, 3s auto-close
    RADAR: 4,         // Reveal all positions+equity+inventories 10s, breaks Phantom
    BOOST: 5,         // Next trade ×1.5 returns (visible to opponents). 12s
    // Tier 2 — Direct Attacks
    FREEZE: 6,        // Target can't open 5s, can close at 5× slippage, flat penalty 1%/s
    MIRROR_CURSE: 7,  // Target sees inverted chart 8s
    DRAIN: 8,         // Steal 8% of target's equity
    GLITCH: 9,        // Target's chart freezes (stale data) 6s
    SWAP: 10,         // Swap position direction + entry price with target
    // Tier 3 — Ultimates
    NUKE: 11,         // Force-close all exposed, price drop 3-5% scaled by victims
    BLACKOUT: 12,     // Everyone else loses UI 6s, activator gets 2s price preview
    EARTHQUAKE: 13,   // Volatility ×5 for 8s, all cooldowns reduced to 1s
    HEIST: 14,        // Steal 10% equity from #1 player
} as const;
export type ItemIdValue = (typeof ItemId)[keyof typeof ItemId];

export interface ItemDef {
    readonly id: ItemIdValue;
    readonly name: string;
    readonly tier: 1 | 2 | 3;
    readonly emoji: string;
    readonly durationSec: number;    // 0 = instant
    readonly targetType: 'self' | 'opponent' | 'global';
    readonly desc: string;
}

export const ITEMS: Map<ItemIdValue, ItemDef> = new Map([
    // ── TIER 1 — Trading Powers ──
    [ItemId.GHOST_TRADE, {
        id: ItemId.GHOST_TRADE, name: 'Ghost Trade', tier: 1,
        emoji: '👻', durationSec: 8, targetType: 'self',
        desc: 'Zero slippage + hidden position for 8s. Trade like a phantom.',
    }],
    [ItemId.SHIELD, {
        id: ItemId.SHIELD, name: 'Shield', tier: 1,
        emoji: '🛡', durationSec: 10, targetType: 'self',
        desc: 'Block next attack. 50% reflect. Grants Boost on successful block.',
    }],
    [ItemId.SCALP, {
        id: ItemId.SCALP, name: 'Scalp', tier: 1,
        emoji: '⚡', durationSec: 3, targetType: 'self',
        desc: 'Auto-trade: detects momentum, opens 3× leveraged position, auto-closes in 3s.',
    }],
    [ItemId.RADAR, {
        id: ItemId.RADAR, name: 'Radar', tier: 1,
        emoji: '📡', durationSec: 10, targetType: 'self',
        desc: 'Reveal all positions, live equity, inventories. Breaks active Ghost Trade.',
    }],
    [ItemId.BOOST, {
        id: ItemId.BOOST, name: 'Boost', tier: 1,
        emoji: '🚀', durationSec: 12, targetType: 'self',
        desc: 'Next trade ×1.5 returns (gains AND losses). Visible to opponents.',
    }],
    // ── TIER 2 — Direct Attacks ──
    [ItemId.FREEZE, {
        id: ItemId.FREEZE, name: 'Freeze', tier: 2,
        emoji: '🧊', durationSec: 5, targetType: 'opponent',
        desc: "Can't open positions 5s. Close at 5× slippage. Flat = 1%/s equity bleed.",
    }],
    [ItemId.MIRROR_CURSE, {
        id: ItemId.MIRROR_CURSE, name: 'Mirror Curse', tier: 2,
        emoji: '🪞', durationSec: 8, targetType: 'opponent',
        desc: 'Target sees inverted chart for 8s.',
    }],
    [ItemId.DRAIN, {
        id: ItemId.DRAIN, name: 'Drain', tier: 2,
        emoji: '🩸', durationSec: 0, targetType: 'opponent',
        desc: 'Steal 8% of target equity. You gain it, they lose it.',
    }],
    [ItemId.GLITCH, {
        id: ItemId.GLITCH, name: 'Glitch', tier: 2,
        emoji: '👾', durationSec: 6, targetType: 'opponent',
        desc: "Target's chart freezes (stale data) for 6s.",
    }],
    [ItemId.SWAP, {
        id: ItemId.SWAP, name: 'Swap', tier: 2,
        emoji: '🔄', durationSec: 0, targetType: 'opponent',
        desc: "Swap position direction AND entry price with target.",
    }],
    // ── TIER 3 — Ultimates ──
    [ItemId.NUKE, {
        id: ItemId.NUKE, name: 'Nuke', tier: 3,
        emoji: '☢️', durationSec: 0, targetType: 'global',
        desc: 'Force-close ALL exposed. Price drops 3-5% (more victims = bigger drop).',
    }],
    [ItemId.BLACKOUT, {
        id: ItemId.BLACKOUT, name: 'Blackout', tier: 3,
        emoji: '🌑', durationSec: 6, targetType: 'global',
        desc: 'Everyone else loses ALL UI 6s. YOU get 2s price preview.',
    }],
    [ItemId.EARTHQUAKE, {
        id: ItemId.EARTHQUAKE, name: 'Earthquake', tier: 3,
        emoji: '🌋', durationSec: 8, targetType: 'global',
        desc: 'Volatility ×5 for 8s. All trade cooldowns reduced to 1s. Scalp the chaos.',
    }],
    [ItemId.HEIST, {
        id: ItemId.HEIST, name: 'Heist', tier: 3,
        emoji: '💰', durationSec: 0, targetType: 'global',
        desc: 'Steal 10% equity from #1 ranked player.',
    }],
]);

// ═══ TIER POOLS ═══

export const ITEMS_T1: ItemIdValue[] = [ItemId.GHOST_TRADE, ItemId.SHIELD, ItemId.SCALP, ItemId.RADAR, ItemId.BOOST];
const ITEMS_T2: ItemIdValue[] = [ItemId.FREEZE, ItemId.MIRROR_CURSE, ItemId.DRAIN, ItemId.GLITCH, ItemId.SWAP];
const ITEMS_T3: ItemIdValue[] = [ItemId.NUKE, ItemId.BLACKOUT, ItemId.EARTHQUAKE, ItemId.HEIST];

// ═══ DROP SCHEDULES — Per Mode, Escalating Tier Rates ═══

interface DropConfig {
    readonly tick: number;
    readonly t1: number;  // 0-1
    readonly t2: number;  // 0-1 (t3 = 1 - t1 - t2)
}

// Classic Duel — 3 drops, NO T3
const CLASSIC_DUEL_DROPS: DropConfig[] = [
    { tick: 45,  t1: 0.70, t2: 0.30 },
    { tick: 120, t1: 0.50, t2: 0.50 },
    { tick: 180, t1: 0.30, t2: 0.70 },
];

// Classic Arena — 4 drops
const CLASSIC_ARENA_DROPS: DropConfig[] = [
    { tick: 45,  t1: 0.60, t2: 0.35 },  // 5% T3
    { tick: 105, t1: 0.40, t2: 0.40 },  // 20% T3
    { tick: 165, t1: 0.25, t2: 0.40 },  // 35% T3
    { tick: 210, t1: 0.15, t2: 0.35 },  // 50% T3
];

// Survival Arena — 5 drops (longer match)
const SURVIVAL_ARENA_DROPS: DropConfig[] = [
    { tick: 45,  t1: 0.60, t2: 0.35 },  // 5% T3
    { tick: 100, t1: 0.40, t2: 0.40 },  // 20% T3
    { tick: 155, t1: 0.25, t2: 0.40 },  // 35% T3
    { tick: 210, t1: 0.15, t2: 0.35 },  // 50% T3
    { tick: 260, t1: 0.10, t2: 0.30 },  // 60% T3
];

// Chaos Duel — 5 drops, T3 enabled from drop 1
const CHAOS_DUEL_DROPS: DropConfig[] = [
    { tick: 20,  t1: 0.55, t2: 0.35 },  // 10% T3
    { tick: 60,  t1: 0.40, t2: 0.35 },  // 25% T3
    { tick: 100, t1: 0.30, t2: 0.35 },  // 35% T3
    { tick: 150, t1: 0.20, t2: 0.35 },  // 45% T3
    { tick: 200, t1: 0.10, t2: 0.30 },  // 60% T3
];

// Chaos Arena — 7 drops, maximum chaos
const CHAOS_ARENA_DROPS: DropConfig[] = [
    { tick: 20,  t1: 0.50, t2: 0.35 },  // 15% T3
    { tick: 50,  t1: 0.40, t2: 0.35 },  // 25% T3
    { tick: 80,  t1: 0.30, t2: 0.35 },  // 35% T3
    { tick: 110, t1: 0.25, t2: 0.35 },  // 40% T3
    { tick: 140, t1: 0.20, t2: 0.35 },  // 45% T3
    { tick: 175, t1: 0.15, t2: 0.30 },  // 55% T3
    { tick: 210, t1: 0.10, t2: 0.25 },  // 65% T3
];

function getDropSchedule(mode: GameModeValue, format: FormatValue): DropConfig[] {
    if (mode === GameMode.CHAOS) {
        return format === Format.DUEL ? CHAOS_DUEL_DROPS : CHAOS_ARENA_DROPS;
    }
    if (mode === GameMode.SURVIVAL) {
        return SURVIVAL_ARENA_DROPS;
    }
    // Classic
    return format === Format.DUEL ? CLASSIC_DUEL_DROPS : CLASSIC_ARENA_DROPS;
}

export function getDropTicks(mode: GameModeValue, format: FormatValue): number[] {
    return getDropSchedule(mode, format).map(d => d.tick);
}

/** When can items be used? */
export function getItemUsableTick(mode: GameModeValue): number {
    return mode === GameMode.CHAOS ? 20 : 45;
}

// ═══ ITEM ROLLING ═══

function rollItem(rng: () => number, tick: number, mode: GameModeValue, format: FormatValue): ItemIdValue {
    const schedule = getDropSchedule(mode, format);
    const dropConfig = schedule.find(d => d.tick === tick);
    if (!dropConfig) {
        // Fallback — use first drop's rates
        return ITEMS_T1[Math.floor(rng() * ITEMS_T1.length)];
    }

    const roll = rng();
    if (roll < dropConfig.t1) {
        return ITEMS_T1[Math.floor(rng() * ITEMS_T1.length)];
    } else if (roll < dropConfig.t1 + dropConfig.t2) {
        return ITEMS_T2[Math.floor(rng() * ITEMS_T2.length)];
    } else {
        return ITEMS_T3[Math.floor(rng() * ITEMS_T3.length)];
    }
}

// ═══ RULES & CONSTRAINTS ═══

const USE_COOLDOWN = 8;          // 8s between activations
const ANTI_FOCUS_COOLDOWN = 15;  // Same target can't be hit twice in 15s (Arena)
const DRAIN_PERCENT = 0.08;      // 8% equity steal (v3: up from 5%)
const DRAIN_MIN = 0.10;          // Min $0.10 stolen (v3: up from $0.05)
const HEIST_PERCENT = 0.10;      // 10% from #1
const NUKE_PRICE_DROP_BASE = 0.03;  // 3% base price drop
const NUKE_PRICE_DROP_PER_VICTIM = 0.005; // +0.5% per victim closed (max 5% total)
const NUKE_PRICE_DROP_MAX = 0.05;   // 5% cap
const SHIELD_REFLECT_CHANCE = 0.50; // 50% reflect
const FREEZE_CLOSE_SLIPPAGE_MULT = 5; // 5× slippage when frozen and closing
const FREEZE_FLAT_PENALTY_PER_SEC = 0.01; // 1% equity per second while flat+frozen
const SCALP_LEVERAGE = 3;        // 3× internal leverage for Scalp
const SCALP_DURATION = 3;        // 3 second auto-close

// ═══ PLAYER ITEM STATE ═══

export interface PlayerItemState {
    inventory: ItemIdValue[];       // max 2 items
    lastActivationTick: number;     // for use cooldown
    lastTargetedTick: number;       // anti-focus (Arena)
    // Active effects
    ghostTradeUntilTick: number;    // v3: zero slippage + hidden position (was phantomUntilTick)
    shieldUntilTick: number;        // blocks next enemy item (or consumed)
    radarUntilTick: number;         // reveals all positions
    boostPending: boolean;          // next trade gets ×1.5 returns
    boostExpiresAtTick: number;     // boost expires
    boostVisible: boolean;          // v3: opponents can see boost is active
    frozenUntilTick: number;        // can't open, can close at 5× slippage
    mirrorCurseUntilTick: number;   // inverted chart
    glitchUntilTick: number;        // frozen chart (stale data)
    // Scalp state (v3: auto-trade with 3× leverage)
    scalpActive: boolean;
    scalpDirection: 'LONG' | 'SHORT' | null;
    scalpEntryPrice: number;
    scalpEntryTick: number;
    scalpEquityAtEntry: number;     // equity snapshot when scalp opened
    // Global effects (tracked on activator)
    blackoutUntilTick: number;
    blackoutUser: string | null;
    blackoutPreviewUntilTick: number; // v3: activator gets price preview
    earthquakeUntilTick: number;
    earthquakeReducedCooldowns: boolean; // v3: all cooldowns → 1s during earthquake
}

export function createItemState(): PlayerItemState {
    return {
        inventory: [],
        lastActivationTick: -999,
        lastTargetedTick: -999,
        ghostTradeUntilTick: -1,
        shieldUntilTick: -1,
        radarUntilTick: -1,
        boostPending: false,
        boostExpiresAtTick: -1,
        boostVisible: false,
        frozenUntilTick: -1,
        mirrorCurseUntilTick: -1,
        glitchUntilTick: -1,
        scalpActive: false,
        scalpDirection: null,
        scalpEntryPrice: 0,
        scalpEntryTick: -1,
        scalpEquityAtEntry: 0,
        blackoutUntilTick: -1,
        blackoutUser: null,
        blackoutPreviewUntilTick: -1,
        earthquakeUntilTick: -1,
        earthquakeReducedCooldowns: false,
    };
}

// ═══ ITEM DROPS ═══

export interface ItemDropEvent {
    readonly player: string;
    readonly item: ItemIdValue;
    readonly tick: number;
}

export function processItemDrops(
    tick: number,
    players: Map<string, { itemState: PlayerItemState }>,
    format: FormatValue,
    mode: GameModeValue,
    rng: () => number,
    playerRanks?: Map<string, number>,
): ItemDropEvent[] {
    const schedule = getDropSchedule(mode, format);
    const dropConfig = schedule.find(d => d.tick === tick);
    if (!dropConfig) return [];

    const drops: ItemDropEvent[] = [];

    for (const [address, player] of players) {
        let item = rollItem(rng, tick, mode, format);

        // Rubber banding: rank 4-5 in Chaos get +20% tier upgrade chance
        if (mode === GameMode.CHAOS && playerRanks) {
            const rank = playerRanks.get(address) ?? 0;
            if (rank >= 4 && rng() < 0.20) {
                const currentTier = ITEMS.get(item)?.tier ?? 1;
                if (currentTier === 1 && ITEMS_T2.length > 0) {
                    item = ITEMS_T2[Math.floor(rng() * ITEMS_T2.length)];
                } else if (currentTier === 2 && ITEMS_T3.length > 0) {
                    item = ITEMS_T3[Math.floor(rng() * ITEMS_T3.length)];
                }
            }
        }

        // Add to inventory (max 2, oldest replaced)
        if (player.itemState.inventory.length >= 2) {
            player.itemState.inventory.shift();
        }
        player.itemState.inventory.push(item);
        drops.push({ player: address, item, tick });
        logger.debug(TAG, `Drop: ${address} got ${ITEMS.get(item)?.name} at tick ${tick}`);
    }

    return drops;
}

// ═══ ITEM ACTIVATION ═══

export interface ItemUseEvent {
    readonly player: string;
    readonly item: ItemIdValue;
    readonly target: string | null;
    readonly tick: number;
    readonly blocked?: boolean;
    readonly reflected?: boolean;     // Shield reflected the item back
    readonly stolenEquity?: number;   // Drain/Heist: amount stolen
    readonly swappedFrom?: string;    // Swap: what position user had
    readonly swappedTo?: string;      // Swap: what position target had
    readonly flippedPlayer?: string;  // Earthquake: who got flipped
}

export interface ItemUseResult {
    success: boolean;
    event: ItemUseEvent | null;
    reason: string | null;
}

export function activateItem(
    playerAddress: string,
    itemId: ItemIdValue,
    currentTick: number,
    players: Map<string, MatchPlayer>,
    format: FormatValue,
    explicitTarget: string | null = null,
    rng: () => number = Math.random,
    playerRanks?: Map<string, number>,
): ItemUseResult {
    const player = players.get(playerAddress);
    if (!player) return fail('Player not found');

    const state = player.itemState;

    // Check item in inventory
    const invIdx = state.inventory.indexOf(itemId);
    if (invIdx === -1) return fail('Item not in inventory');

    // Use cooldown: 8s between activations
    if (currentTick - state.lastActivationTick < USE_COOLDOWN) {
        const wait = USE_COOLDOWN - (currentTick - state.lastActivationTick);
        return fail(`Cooldown: wait ${wait}s`);
    }

    // Remove from inventory
    state.inventory.splice(invIdx, 1);
    const prevActivationTick = state.lastActivationTick;
    state.lastActivationTick = currentTick;

    const def = ITEMS.get(itemId);
    if (!def) return fail('Unknown item');

    // ── Resolve target for opponent-targeted items ──
    let target: string | null = null;
    if (def.targetType === 'opponent') {
        if (explicitTarget && format !== Format.DUEL) {
            const targetPlayer = players.get(explicitTarget);
            if (!targetPlayer || explicitTarget === playerAddress) {
                state.inventory.push(itemId);
                state.lastActivationTick = prevActivationTick;
                return fail('Invalid target');
            }
            if (currentTick - targetPlayer.itemState.lastTargetedTick < ANTI_FOCUS_COOLDOWN) {
                state.inventory.push(itemId);
                state.lastActivationTick = prevActivationTick;
                return fail('Target protected (anti-focus 15s)');
            }
            target = explicitTarget;
        } else {
            target = findOpponent(playerAddress, players, currentTick, rng);
            if (!target) {
                state.inventory.push(itemId);
                state.lastActivationTick = prevActivationTick;
                return fail('No target available');
            }
        }
    }

    // ── Shield check for opponent-targeted items ──
    if (target) {
        const targetPlayer = players.get(target);
        if (targetPlayer && hasShield(targetPlayer.itemState, currentTick)) {
            targetPlayer.itemState.shieldUntilTick = -1; // consumed

            // v3: Shield grants 3s Boost on successful block
            targetPlayer.itemState.boostPending = true;
            targetPlayer.itemState.boostExpiresAtTick = currentTick + 3;
            targetPlayer.itemState.boostVisible = true;
            logger.info(TAG, `🛡🚀 Shield block granted 3s Boost to ${target}!`);

            // 50% chance to reflect
            const reflected = rng() < SHIELD_REFLECT_CHANCE;
            if (reflected) {
                logger.info(TAG, `🛡✨ Shield REFLECTED ${def.name} back to ${playerAddress}!`);
                applyTargetedEffect(itemId, players.get(playerAddress)!, currentTick, def, targetPlayer);
                targetPlayer.itemState.lastTargetedTick = currentTick;
                // LOGIC-19 FIX: Give attacker anti-focus protection too (they just got hit by reflection)
                player.itemState.lastTargetedTick = currentTick;
                return {
                    success: true,
                    event: { player: playerAddress, item: itemId, target, tick: currentTick, blocked: true, reflected: true },
                    reason: null,
                };
            } else {
                logger.info(TAG, `🛡 Shield BLOCKED ${def.name} on ${target}`);
                targetPlayer.itemState.lastTargetedTick = currentTick;
                return {
                    success: true,
                    event: { player: playerAddress, item: itemId, target, tick: currentTick, blocked: true, reflected: false },
                    reason: null,
                };
            }
        }
    }

    // ── Apply effects ──
    switch (itemId) {

        // ── T1: GHOST TRADE (was Phantom) ──
        case ItemId.GHOST_TRADE:
            state.ghostTradeUntilTick = currentTick + def.durationSec;
            logger.info(TAG, `👻 ${playerAddress} activated Ghost Trade — zero slippage + hidden for ${def.durationSec}s`);
            break;

        // ── T1: SHIELD ──
        case ItemId.SHIELD:
            state.shieldUntilTick = currentTick + def.durationSec;
            break;

        // ── T1: SCALP (was Flash Trade) ──
        // Activation just signals the game loop. Game loop handles momentum detection + auto-trade.
        case ItemId.SCALP:
            break;

        // ── T1: RADAR ──
        case ItemId.RADAR: {
            state.radarUntilTick = currentTick + def.durationSec;
            // v3: Radar breaks active Ghost Trade on all opponents
            for (const [addr, p] of players) {
                if (addr !== playerAddress && p.itemState.ghostTradeUntilTick > currentTick) {
                    p.itemState.ghostTradeUntilTick = -1;
                    logger.info(TAG, `📡 Radar BROKE Ghost Trade on ${addr}!`);
                }
            }
            break;
        }

        // ── T1: BOOST ──
        case ItemId.BOOST:
            state.boostPending = true;
            state.boostExpiresAtTick = currentTick + def.durationSec;
            state.boostVisible = true; // v3: visible to opponents
            break;

        // ── T2: FREEZE ──
        case ItemId.FREEZE: {
            const tp = players.get(target!);
            if (tp) {
                tp.itemState.frozenUntilTick = currentTick + def.durationSec;
                tp.itemState.lastTargetedTick = currentTick;
            }
            break;
        }

        // ── T2: MIRROR CURSE ──
        case ItemId.MIRROR_CURSE: {
            const tp = players.get(target!);
            if (tp) {
                tp.itemState.mirrorCurseUntilTick = currentTick + def.durationSec;
                tp.itemState.lastTargetedTick = currentTick;
            }
            break;
        }

        // ── T2: DRAIN (v3: 8%) ──
        case ItemId.DRAIN: {
            const tp = players.get(target!);
            if (tp) {
                // LOGIC-05 FIX: Cap stolen at victim's equity to prevent negative equity
                const stolen = Math.min(tp.equity, Math.max(DRAIN_MIN, tp.equity * DRAIN_PERCENT));
                tp.equity = Math.round((tp.equity - stolen) * 10000) / 10000;
                player.equity = Math.round((player.equity + stolen) * 10000) / 10000;
                tp.itemState.lastTargetedTick = currentTick;
                logger.info(TAG, `🩸 ${playerAddress} DRAINED $${stolen.toFixed(2)} from ${target}`);
                return {
                    success: true,
                    event: { player: playerAddress, item: itemId, target, tick: currentTick, stolenEquity: stolen },
                    reason: null,
                };
            }
            break;
        }

        // ── T2: GLITCH ──
        case ItemId.GLITCH: {
            const tp = players.get(target!);
            if (tp) {
                tp.itemState.glitchUntilTick = currentTick + def.durationSec;
                tp.itemState.lastTargetedTick = currentTick;
            }
            break;
        }

        // ── T2: SWAP (v3: swaps direction + entry price, NOT equity) ──
        case ItemId.SWAP: {
            const tp = players.get(target!);
            if (tp) {
                // LOGIC-18 FIX: Block Swap if either player is FLAT — swapping with a FLAT
                // player creates a "free" inherited position (profit or loss the recipient didn't earn)
                if (player.position.status === 'FLAT' || tp.position.status === 'FLAT') {
                    logger.info(TAG, `🔄 Swap fizzled: ${playerAddress}=${player.position.status}, ${target}=${tp.position.status} (both must be in position)`);
                    break;
                }
                const myPos = { ...player.position };
                const theirPos = { ...tp.position };
                // v3: Swap direction AND entry price — "we traded places"
                player.position = { status: theirPos.status, entryPrice: theirPos.entryPrice, entryTick: currentTick, direction: theirPos.direction };
                tp.position = { status: myPos.status, entryPrice: myPos.entryPrice, entryTick: currentTick, direction: myPos.direction };
                tp.itemState.lastTargetedTick = currentTick;
                logger.info(TAG, `🔄 ${playerAddress} SWAPPED with ${target} (${myPos.status}@${myPos.entryPrice.toFixed(2)} ↔ ${theirPos.status}@${theirPos.entryPrice.toFixed(2)})`);
                return {
                    success: true,
                    event: {
                        player: playerAddress, item: itemId, target, tick: currentTick,
                        swappedFrom: myPos.status, swappedTo: theirPos.status,
                    },
                    reason: null,
                };
            }
            break;
        }

        // ── T3: NUKE ──
        case ItemId.NUKE:
            // Force-close + scaled price drop handled by game loop
            break;

        // ── T3: BLACKOUT ──
        case ItemId.BLACKOUT:
            // All UI hidden for others + price preview for activator — handled by game loop
            break;

        // ── T3: EARTHQUAKE (v3: no random flip, reduced cooldowns handled by game loop) ──
        case ItemId.EARTHQUAKE:
            // Volatility ×5 + reduced cooldowns — handled by game loop
            return {
                success: true,
                event: { player: playerAddress, item: itemId, target: null, tick: currentTick },
                reason: null,
            };

        // ── T3: HEIST ──
        case ItemId.HEIST: {
            // Steal 10% from #1 player (or #2 if user is #1)
            if (!playerRanks) break;
            let victimAddr: string | null = null;
            for (const [addr, rank] of playerRanks) {
                if (rank === 1 && addr !== playerAddress) { victimAddr = addr; break; }
            }
            if (!victimAddr) {
                for (const [addr, rank] of playerRanks) {
                    if (rank === 2 && addr !== playerAddress) { victimAddr = addr; break; }
                }
            }
            if (victimAddr) {
                const victim = players.get(victimAddr);
                if (victim) {
                    // LOGIC-05 FIX: Cap stolen at victim's equity to prevent negative equity
                    const stolen = Math.min(victim.equity, Math.max(DRAIN_MIN, victim.equity * HEIST_PERCENT));
                    victim.equity = Math.round((victim.equity - stolen) * 10000) / 10000;
                    player.equity = Math.round((player.equity + stolen) * 10000) / 10000;
                    logger.info(TAG, `💰 ${playerAddress} HEISTED $${stolen.toFixed(2)} from #1 ${victimAddr}!`);
                    return {
                        success: true,
                        event: { player: playerAddress, item: itemId, target: victimAddr, tick: currentTick, stolenEquity: stolen },
                        reason: null,
                    };
                }
            }
            logger.info(TAG, `💰 Heist fizzled — no valid target`);
            break;
        }
    }

    logger.info(TAG, `${def.emoji} ${playerAddress} used ${def.name}${target ? ` on ${target}` : ''} at tick ${currentTick}`);
    return {
        success: true,
        event: { player: playerAddress, item: itemId, target, tick: currentTick },
        reason: null,
    };
}

/** Apply a targeted effect to a player (used for Shield reflection).
 *  Bug 5.5: shieldHolder receives stolen equity when Drain is reflected. */
function applyTargetedEffect(itemId: ItemIdValue, victim: MatchPlayer, tick: number, def: ItemDef, shieldHolder?: MatchPlayer): void {
    switch (itemId) {
        case ItemId.FREEZE:
            victim.itemState.frozenUntilTick = tick + def.durationSec;
            break;
        case ItemId.MIRROR_CURSE:
            victim.itemState.mirrorCurseUntilTick = tick + def.durationSec;
            break;
        case ItemId.DRAIN: {
            // LOGIC-05 FIX: Cap stolen at victim's equity to prevent negative equity
            const stolen = Math.min(victim.equity, Math.max(DRAIN_MIN, victim.equity * DRAIN_PERCENT));
            victim.equity = Math.round((victim.equity - stolen) * 10000) / 10000;
            // Bug 5.5: Shield holder gains the stolen equity on reflect
            if (shieldHolder) {
                shieldHolder.equity = Math.round((shieldHolder.equity + stolen) * 10000) / 10000;
            }
            break;
        }
        case ItemId.GLITCH:
            victim.itemState.glitchUntilTick = tick + def.durationSec;
            break;
    }
}

// ═══ TICK EFFECTS — Expire active effects ═══

export function tickItemEffects(
    currentTick: number,
    players: Map<string, { itemState: PlayerItemState }>,
): void {
    for (const [, player] of players) {
        const s = player.itemState;
        if (s.ghostTradeUntilTick > 0 && currentTick >= s.ghostTradeUntilTick) s.ghostTradeUntilTick = -1;
        if (s.shieldUntilTick > 0 && currentTick >= s.shieldUntilTick) s.shieldUntilTick = -1;
        if (s.radarUntilTick > 0 && currentTick >= s.radarUntilTick) s.radarUntilTick = -1;
        if (s.frozenUntilTick > 0 && currentTick >= s.frozenUntilTick) s.frozenUntilTick = -1;
        if (s.mirrorCurseUntilTick > 0 && currentTick >= s.mirrorCurseUntilTick) s.mirrorCurseUntilTick = -1;
        if (s.glitchUntilTick > 0 && currentTick >= s.glitchUntilTick) s.glitchUntilTick = -1;
        if (s.blackoutUntilTick > 0 && currentTick >= s.blackoutUntilTick) { s.blackoutUntilTick = -1; s.blackoutUser = null; }
        if (s.blackoutPreviewUntilTick > 0 && currentTick >= s.blackoutPreviewUntilTick) s.blackoutPreviewUntilTick = -1;
        if (s.earthquakeUntilTick > 0 && currentTick >= s.earthquakeUntilTick) {
            s.earthquakeUntilTick = -1;
            s.earthquakeReducedCooldowns = false;
        }
        // Expire Boost
        if (s.boostPending && currentTick >= s.boostExpiresAtTick) {
            s.boostPending = false;
            s.boostExpiresAtTick = -1;
            s.boostVisible = false;
        }
    }
}

// ═══ QUERY HELPERS ═══

export function isFrozen(state: PlayerItemState, currentTick: number): boolean {
    return state.frozenUntilTick > 0 && currentTick < state.frozenUntilTick;
}

/** v3: Can frozen player close? Yes, but at 5× slippage. */
export function getFreezeSlippageMultiplier(state: PlayerItemState, currentTick: number): number {
    return isFrozen(state, currentTick) ? FREEZE_CLOSE_SLIPPAGE_MULT : 1;
}

/** v3: Freeze flat penalty rate (1%/sec equity bleed while flat+frozen). */
export function getFreezeFlatPenalty(): number {
    return FREEZE_FLAT_PENALTY_PER_SEC;
}

export function hasGhostTrade(state: PlayerItemState, currentTick: number): boolean {
    return state.ghostTradeUntilTick > 0 && currentTick < state.ghostTradeUntilTick;
}

export function hasShield(state: PlayerItemState, currentTick: number): boolean {
    return state.shieldUntilTick > 0 && currentTick < state.shieldUntilTick;
}

export function hasRadar(state: PlayerItemState, currentTick: number): boolean {
    return state.radarUntilTick > 0 && currentTick < state.radarUntilTick;
}

export function hasBoost(state: PlayerItemState, currentTick: number): boolean {
    return state.boostPending && currentTick < state.boostExpiresAtTick;
}

export function isBoostVisible(state: PlayerItemState, currentTick: number): boolean {
    return state.boostVisible && state.boostPending && currentTick < state.boostExpiresAtTick;
}

export function consumeBoost(state: PlayerItemState, currentTick?: number): number {
    // LOGIC-15 FIX: Verify boost hasn't expired (tick-based check, not just boostPending flag)
    if (state.boostPending && (currentTick === undefined || currentTick < state.boostExpiresAtTick)) {
        state.boostPending = false;
        state.boostExpiresAtTick = -1;
        state.boostVisible = false;
        return 1.5; // ×1.5 multiplier
    }
    return 1.0; // no boost
}

export function hasMirrorCurse(state: PlayerItemState, currentTick: number): boolean {
    return state.mirrorCurseUntilTick > 0 && currentTick < state.mirrorCurseUntilTick;
}

export function hasGlitch(state: PlayerItemState, currentTick: number): boolean {
    return state.glitchUntilTick > 0 && currentTick < state.glitchUntilTick;
}

// Semantic wrappers used by game-loop.ts
export function hasFogOfWar(state: PlayerItemState, currentTick: number): boolean {
    return hasGhostTrade(state, currentTick);
}

export function hasXRay(state: PlayerItemState, currentTick: number): boolean {
    return hasRadar(state, currentTick);
}

// MED-2 FIX: These are semantic aliases that map game concepts to item effects.
// The function names describe the GAME EFFECT, not the item name.
// isMuted() = player can't see PnL → caused by GLITCH item (stale data = hidden info)
// hasScramble() = leaderboard scrambled → caused by MIRROR CURSE item (inverted perception)
export function isMuted(state: PlayerItemState, currentTick: number): boolean {
    return state.glitchUntilTick > 0 && currentTick < state.glitchUntilTick; // Glitch → muted PnL
}

export function hasScramble(state: PlayerItemState, currentTick: number): boolean {
    return state.mirrorCurseUntilTick > 0 && currentTick < state.mirrorCurseUntilTick; // Mirror Curse → scrambled leaderboard
}

export function hasBlackoutPreview(state: PlayerItemState, currentTick: number): boolean {
    return state.blackoutPreviewUntilTick > 0 && currentTick < state.blackoutPreviewUntilTick;
}

export function hasEarthquakeReducedCooldowns(state: PlayerItemState): boolean {
    return state.earthquakeReducedCooldowns;
}

/** v3: Scalp constants exported for game-loop */
export { SCALP_LEVERAGE, SCALP_DURATION, NUKE_PRICE_DROP_BASE, NUKE_PRICE_DROP_PER_VICTIM, NUKE_PRICE_DROP_MAX };

// ═══ HELPERS ═══

function findOpponent(
    playerAddress: string,
    players: Map<string, { address: string; itemState: PlayerItemState; eliminated?: boolean }>,
    currentTick: number,
    rng: () => number,
): string | null {
    const opponents: string[] = [];
    for (const [addr, p] of players) {
        if (addr === playerAddress) continue;
        // Bug 5.7: Skip eliminated players (Survival mode)
        if (p.eliminated) continue;
        if (currentTick - p.itemState.lastTargetedTick < ANTI_FOCUS_COOLDOWN) continue;
        opponents.push(addr);
    }
    if (opponents.length === 0) {
        // Fallback: ignore anti-focus, but still skip eliminated
        for (const [addr, p] of players) {
            if (addr !== playerAddress && !p.eliminated) opponents.push(addr);
        }
    }
    if (opponents.length === 0) return null;
    return opponents[Math.floor(rng() * opponents.length)];
}

function fail(reason: string): ItemUseResult {
    return { success: false, event: null, reason };
}
