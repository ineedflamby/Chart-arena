/**
 * Season Manager — 28-Day Competitive Seasons
 *
 * At season end:
 * 1. Snapshot all player ELO ratings
 * 2. Distribute season rank bonuses
 * 3. Reset ELO (soft reset: pull towards 1000)
 * 4. Archive season data
 */

import { db } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_ELO } from './elo.js';

const TAG = 'Season';

const SEASON_DURATION_DAYS = 28;

// Season rank bonus distribution
const SEASON_RANK_BONUSES: Array<{ minRank: number; maxRank: number; points: number; label: string }> = [
    { minRank: 1,   maxRank: 1,   points: 5000, label: 'Champion' },
    { minRank: 2,   maxRank: 5,   points: 3000, label: 'Diamond' },
    { minRank: 6,   maxRank: 15,  points: 1500, label: 'Platinum' },
    { minRank: 16,  maxRank: 50,  points: 750,  label: 'Gold' },
    { minRank: 51,  maxRank: 100, points: 300,  label: 'Silver' },
];

const PARTICIPATION_BONUS = 100;          // Everyone with 10+ matches
const MIN_MATCHES_FOR_PARTICIPATION = 10;
const ELO_SOFT_RESET_FACTOR = 0.5;       // Pull 50% towards default

export interface SeasonInfo {
    seasonId: number;
    startDate: string;
    endDate: string;
    daysRemaining: number;
    isActive: boolean;
}

export interface SeasonReward {
    address: string;
    rank: number;
    elo: number;
    label: string;
    points: number;
}

/**
 * Get or create the current season.
 */
export function getCurrentSeason(): SeasonInfo {
    const current = db.getCurrentSeason();

    if (current) {
        const endDate = new Date(current.end_date);
        const now = new Date();
        const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

        return {
            seasonId: current.season_id,
            startDate: current.start_date,
            endDate: current.end_date,
            daysRemaining,
            isActive: now < endDate,
        };
    }

    // No active season — create one
    return createNewSeason();
}

function createNewSeason(): SeasonInfo {
    const lastSeason = db.getLastSeason();
    const seasonId = lastSeason ? lastSeason.season_id + 1 : 1;

    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0); // Midnight UTC today

    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + SEASON_DURATION_DAYS);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    db.createSeason(seasonId, startStr, endStr);
    logger.info(TAG, `Season ${seasonId} created: ${startStr} → ${endStr}`);

    return {
        seasonId,
        startDate: startStr,
        endDate: endStr,
        daysRemaining: SEASON_DURATION_DAYS,
        isActive: true,
    };
}

/**
 * End the current season, distribute rewards, and start a new one.
 * Called by the daily cron when the season end date is reached.
 */
export function endSeason(): SeasonReward[] {
    const season = getCurrentSeason();
    if (season.isActive && season.daysRemaining > 0) {
        logger.info(TAG, `Season ${season.seasonId} still active (${season.daysRemaining} days left)`);
        return [];
    }

    logger.info(TAG, `Ending Season ${season.seasonId}...`);
    const rewards: SeasonReward[] = [];

    // 1. Get final ELO leaderboard
    const leaderboard = db.getEloLeaderboard(200); // Top 200

    // 2. Distribute rank bonuses
    // DEAD-05 FIX: Count matches played DURING this season, not lifetime
    const seasonStartMs = new Date(season.startDate + 'T00:00:00Z').getTime();
    for (const entry of leaderboard) {
        const matchesThisSeason = db.countPlayerMatchesSince(entry.address, seasonStartMs);

        // Check minimum matches
        if (matchesThisSeason < MIN_MATCHES_FOR_PARTICIPATION) continue;

        let points = PARTICIPATION_BONUS;
        let label = 'Participant';

        for (const tier of SEASON_RANK_BONUSES) {
            if (entry.rank >= tier.minRank && entry.rank <= tier.maxRank) {
                points = tier.points;
                label = tier.label;
                break;
            }
        }

        db.addPointsByPillar(entry.address, 0, points, `season_${season.seasonId}`, 0, 0);
        rewards.push({
            address: entry.address,
            rank: entry.rank,
            elo: entry.elo,
            label,
            points,
        });

        logger.info(TAG, `Season ${season.seasonId} reward: ${entry.address.slice(0, 8)} rank #${entry.rank} (${label}) → +${points} skill pts`);
    }

    // 3. Snapshot season data
    db.snapshotSeason(season.seasonId, leaderboard);

    // 4. Soft-reset ELO (pull towards default)
    for (const entry of leaderboard) {
        const resetElo = Math.round(entry.elo * (1 - ELO_SOFT_RESET_FACTOR) + DEFAULT_ELO * ELO_SOFT_RESET_FACTOR);
        db.upsertEloRating(entry.address, resetElo);
    }

    // 5. Mark season as ended
    db.endSeason(season.seasonId);

    // 6. Create new season
    const newSeason = createNewSeason();
    logger.info(TAG, `Season ${season.seasonId} ended. ${rewards.length} rewards distributed. New season: ${newSeason.seasonId}`);

    return rewards;
}

/**
 * Check if season should end (called by daily cron).
 */
export function checkSeasonEnd(): SeasonReward[] {
    const season = getCurrentSeason();
    if (season.daysRemaining <= 0) {
        return endSeason();
    }
    return [];
}

export { SEASON_RANK_BONUSES, PARTICIPATION_BONUS, MIN_MATCHES_FOR_PARTICIPATION };
