/**
 * Buy-In Tier System — Progressive stake levels with queue collapse.
 *
 * Tiers:
 *   BRONZE = 0 →   5 MOTO  (always unlocked)
 *   SILVER = 1 →  25 MOTO  (unlocked after 5 matches)
 *   GOLD   = 2 → 100 MOTO  (unlocked after 20 matches)
 *
 * Queue Collapse thresholds (by online player count):
 *   1-9   → Bronze Duel Classic only
 *   10-24 → All tiers, Duel Classic only
 *   25-49 → All tiers, Duel all modes + Arena Classic
 *   50+   → Everything open
 *
 * DEV_MODE: All tiers unlocked, no queue collapse.
 */

import { GameMode, Format, type GameModeValue, type FormatValue } from '../utils/constants.js';
import { db } from '../db/database.js';
import { getAuthenticatedCount } from '../ws/server.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'BuyInTiers';

// ── Tier Definitions ──

export const BuyInTier = { BRONZE: 0, SILVER: 1, GOLD: 2 } as const;
export type BuyInTierValue = (typeof BuyInTier)[keyof typeof BuyInTier];

export const MOTO_DECIMALS_MULTIPLIER = 10n ** 18n;

/** On-chain MOTO amounts per tier (18 decimals) */
export const TIER_AMOUNTS: Record<BuyInTierValue, bigint> = {
    [BuyInTier.BRONZE]:   5n * MOTO_DECIMALS_MULTIPLIER,
    [BuyInTier.SILVER]:  25n * MOTO_DECIMALS_MULTIPLIER,
    [BuyInTier.GOLD]:   100n * MOTO_DECIMALS_MULTIPLIER,
};

export const TIER_DISPLAY: Record<BuyInTierValue, string> = {
    [BuyInTier.BRONZE]: '5 MOTO',
    [BuyInTier.SILVER]: '25 MOTO',
    [BuyInTier.GOLD]:   '100 MOTO',
};

export const TIER_NAMES: Record<BuyInTierValue, string> = {
    [BuyInTier.BRONZE]: 'Bronze',
    [BuyInTier.SILVER]: 'Silver',
    [BuyInTier.GOLD]:   'Gold',
};

/** Matches required to unlock each tier (total matches, any tier) */
export const TIER_UNLOCK_MATCHES: Record<BuyInTierValue, number> = {
    [BuyInTier.BRONZE]: 0,
    [BuyInTier.SILVER]: 5,
    [BuyInTier.GOLD]:   20,
};

// ── Tier Validation ──

export function isValidTier(tier: unknown): tier is BuyInTierValue {
    return typeof tier === 'number' && Number.isInteger(tier) && tier >= 0 && tier <= 2;
}

export function getTierBuyIn(tier: BuyInTierValue): bigint {
    return TIER_AMOUNTS[tier];
}

// ── Unlock Checks ──

export interface TierUnlockStatus {
    readonly tier: BuyInTierValue;
    readonly name: string;
    readonly display: string;
    readonly unlocked: boolean;
    readonly matchesRequired: number;
    readonly matchesPlayed: number;
    readonly matchesRemaining: number;
}

export function isTierUnlocked(address: string, tier: BuyInTierValue): boolean {
    if (tier === BuyInTier.BRONZE) return true;
    if (config.devMode) return true; // DEV: all tiers unlocked
    const stats = db.getPlayerStats(address);
    const matchesPlayed = stats?.matches_played ?? 0;
    return matchesPlayed >= TIER_UNLOCK_MATCHES[tier];
}

export function getAllTierStatus(address: string): TierUnlockStatus[] {
    const stats = db.getPlayerStats(address);
    const matchesPlayed = stats?.matches_played ?? 0;

    return [BuyInTier.BRONZE, BuyInTier.SILVER, BuyInTier.GOLD].map((tier) => {
        const required = TIER_UNLOCK_MATCHES[tier];
        const unlocked = config.devMode ? true : matchesPlayed >= required;
        return {
            tier,
            name: TIER_NAMES[tier],
            display: TIER_DISPLAY[tier],
            unlocked,
            matchesRequired: required,
            matchesPlayed,
            matchesRemaining: unlocked ? 0 : required - matchesPlayed,
        };
    });
}

// ── Queue Collapse ──

export interface QueueAvailability {
    readonly onlinePlayers: number;
    readonly available: AvailableQueue[];
    readonly nextUnlock: { playersNeeded: number; description: string } | null;
}

export interface AvailableQueue {
    readonly tier: BuyInTierValue;
    readonly tierName: string;
    readonly tierDisplay: string;
    readonly mode: GameModeValue;
    readonly format: FormatValue;
    readonly enabled: boolean;
    readonly reason?: string;
}

// P1: Lowered for early launch — raise once player base grows
const COLLAPSE_THRESHOLDS = {
    TIER_1: 3,
    TIER_2: 3,
    TIER_3: 25,
};

export function isQueueAvailable(
    tier: BuyInTierValue, mode: number, format: number,
): { available: boolean; reason?: string } {
    if (config.devMode) return { available: true }; // DEV: no queue collapse

    const online = getAuthenticatedCount();

    if (online < COLLAPSE_THRESHOLDS.TIER_1) {
        if (tier !== BuyInTier.BRONZE) {
            return { available: false, reason: `Silver/Gold opens at ${COLLAPSE_THRESHOLDS.TIER_1}+ players online (currently ${online})` };
        }
        if (format !== Format.DUEL || mode !== GameMode.CLASSIC) {
            return { available: false, reason: `Only Duel Classic available with ${online} players online (need ${COLLAPSE_THRESHOLDS.TIER_1}+)` };
        }
        return { available: true };
    }

    if (online < COLLAPSE_THRESHOLDS.TIER_2) {
        if (format !== Format.DUEL || mode !== GameMode.CLASSIC) {
            return { available: false, reason: `Only Duel Classic available with ${online} players online (need ${COLLAPSE_THRESHOLDS.TIER_2}+ for more modes)` };
        }
        return { available: true };
    }

    if (online < COLLAPSE_THRESHOLDS.TIER_3) {
        if (format === Format.ARENA && mode !== GameMode.CLASSIC) {
            return { available: false, reason: `Arena ${mode === GameMode.SURVIVAL ? 'Survival' : 'Chaos'} opens at ${COLLAPSE_THRESHOLDS.TIER_3}+ players (currently ${online})` };
        }
        return { available: true };
    }

    return { available: true };
}

export function getQueueAvailability(): QueueAvailability {
    const online = getAuthenticatedCount();

    const tiers: BuyInTierValue[] = [BuyInTier.BRONZE, BuyInTier.SILVER, BuyInTier.GOLD];
    const modes: GameModeValue[] = [GameMode.CLASSIC, GameMode.SURVIVAL, GameMode.CHAOS];
    const formats: FormatValue[] = [Format.DUEL, Format.ARENA];

    const available: AvailableQueue[] = [];

    for (const tier of tiers) {
        for (const mode of modes) {
            for (const format of formats) {
                if (mode === GameMode.SURVIVAL && format === Format.DUEL) continue;
                const check = isQueueAvailable(tier, mode, format);
                available.push({
                    tier, tierName: TIER_NAMES[tier], tierDisplay: TIER_DISPLAY[tier],
                    mode, format, enabled: check.available, reason: check.reason,
                });
            }
        }
    }

    let nextUnlock: QueueAvailability['nextUnlock'] = null;
    if (!config.devMode) {
        if (online < COLLAPSE_THRESHOLDS.TIER_1) {
            nextUnlock = { playersNeeded: COLLAPSE_THRESHOLDS.TIER_1, description: `All tiers unlock at ${COLLAPSE_THRESHOLDS.TIER_1} players online` };
        } else if (online < COLLAPSE_THRESHOLDS.TIER_2) {
            nextUnlock = { playersNeeded: COLLAPSE_THRESHOLDS.TIER_2, description: `More modes unlock at ${COLLAPSE_THRESHOLDS.TIER_2} players online` };
        } else if (online < COLLAPSE_THRESHOLDS.TIER_3) {
            nextUnlock = { playersNeeded: COLLAPSE_THRESHOLDS.TIER_3, description: `All Arena modes unlock at ${COLLAPSE_THRESHOLDS.TIER_3} players online` };
        }
    }

    return { onlinePlayers: online, available, nextUnlock };
}

export function validateQueueRequest(
    address: string, tier: BuyInTierValue, mode: number, format: number,
): string | null {
    if (!isTierUnlocked(address, tier)) {
        const required = TIER_UNLOCK_MATCHES[tier];
        const stats = db.getPlayerStats(address);
        const played = stats?.matches_played ?? 0;
        return `${TIER_NAMES[tier]} tier requires ${required} matches played (you have ${played}). Play ${required - played} more match(es) to unlock.`;
    }

    const { available, reason } = isQueueAvailable(tier, mode, format);
    if (!available) {
        return reason ?? 'This queue is not currently available';
    }

    return null;
}
