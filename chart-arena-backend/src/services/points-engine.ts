/**
 * Airdrop Points Engine — Simple & Clean
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  AIRDROP POINTS = VOLUME POINTS + QUEST POINTS              │
 * │                                                              │
 * │  Volume Points:                                              │
 * │    Formula: min(800, 100 × log10(totalVolumeUsd + 1))       │
 * │    Recalculated idempotently after every match.              │
 * │    Stored in player_points_v2.volume_pts                     │
 * │                                                              │
 * │  Quest Points:                                               │
 * │    Awarded on milestone/social quest completion.             │
 * │    Stored in player_quests.points_earned (summed on read).   │
 * │    See quests.ts for definitions.                            │
 * │                                                              │
 * │  That's it. No decay. No daily tasks. No streak multipliers. │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Constellation Rank (Newcomer → Megalodon) is a SEPARATE system
 * based on cumulative trading volume. See utils/tiers.ts.
 */

import { db } from '../db/database.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'PointsEngine';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

/** log10 multiplier for volume → points conversion */
const VOLUME_LOG_MULTIPLIER = 100;

/** Maximum volume points a player can earn */
const VOLUME_POINTS_CAP = 800;

// ══════════════════════════════════════════════════════════════
// VOLUME POINTS (LOG-SCALED)
// ══════════════════════════════════════════════════════════════

/**
 * Calculate volume points from total trading volume (USD).
 * Formula: min(800, 100 × log10(totalVolumeUsd + 1))
 */
export function calculateVolumePoints(totalVolumeUsd: number): number {
    if (totalVolumeUsd <= 0) return 0;
    const raw = VOLUME_LOG_MULTIPLIER * Math.log10(totalVolumeUsd + 1);
    return Math.min(VOLUME_POINTS_CAP, Math.floor(raw));
}

/**
 * Recalculate volume points for a player.
 * Idempotent — always recalculates from total volume stored in player_stats.
 * Call this after every match.
 */
export function recalculateVolumePoints(address: string): number {
    const stats = db.getPlayerStats(address);
    if (!stats) return 0;

    // Volume is stored in MOTO units — convert to USD for point calculation
    const rawVolume = stats.total_volume ?? '0';
    const volumeMoto = Number(rawVolume);
    // P1-B FIX: Use USD value (MOTO × price) not raw MOTO for log-scaled points
    const volumeUsd = volumeMoto * config.motoUsdPrice;
    const newVolPts = calculateVolumePoints(volumeUsd);

    db.setVolumePoints(address, newVolPts);
    return newVolPts;
}

// ══════════════════════════════════════════════════════════════
// QUEST POINTS (SUMMED FROM DB)
// ══════════════════════════════════════════════════════════════

/**
 * Get total quest points for a player.
 * Reads from player_quests table — sum of all points_earned.
 */
export function getQuestPoints(address: string): number {
    return db.getQuestPointsTotal(address);
}

// ══════════════════════════════════════════════════════════════
// TOTAL AIRDROP POINTS
// ══════════════════════════════════════════════════════════════

/**
 * Get total airdrop points for a player.
 * This is THE number that determines airdrop allocation.
 */
export function getPlayerTotalPoints(address: string): number {
    const volPts = db.getPointsByPillar(address).volume;
    const questPts = getQuestPoints(address);
    return volPts + questPts;
}

/**
 * Get a breakdown of airdrop points for the player dashboard.
 */
export interface AirdropPointsSummary {
    volumePoints: number;
    questPoints: number;
    total: number;
}

export function getPlayerPointsSummary(address: string): AirdropPointsSummary {
    const volPts = db.getPointsByPillar(address).volume;
    const questPts = getQuestPoints(address);
    return {
        volumePoints: volPts,
        questPoints: questPts,
        total: volPts + questPts,
    };
}

// ══════════════════════════════════════════════════════════════
// POST-MATCH HOOK
// ══════════════════════════════════════════════════════════════

/**
 * Called after every match for each human player.
 * Recalculates volume points (the only thing that changes per-match).
 */
export function onMatchComplete(address: string): void {
    const newVolPts = recalculateVolumePoints(address);
    logger.info(TAG, `${address.slice(0, 8)} → volume pts recalculated: ${newVolPts}`);
}

// ══════════════════════════════════════════════════════════════
// EXPORTS FOR CONFIG (useful for frontend/tests)
// ══════════════════════════════════════════════════════════════

export const POINTS_CONFIG = {
    VOLUME_LOG_MULTIPLIER,
    VOLUME_POINTS_CAP,
} as const;
