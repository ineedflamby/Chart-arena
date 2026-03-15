/**
 * Daily Reset & Cron Jobs
 *
 * Runs at 00:00 UTC daily:
 * 1. Check if season should end → distribute rewards
 *
 * No more inactivity decay — airdrop points are earned, never lost.
 */

import { logger } from '../utils/logger.js';
import { checkSeasonEnd } from './season.js';

const TAG = 'DailyCron';

let cronTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Calculate ms until next 00:00 UTC.
 */
function msUntilMidnightUtc(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0,
    ));
    return midnight.getTime() - now.getTime();
}

/**
 * The daily job that runs at 00:00 UTC.
 */
function runDailyJob(): void {
    logger.info(TAG, '=== Daily Cron Running ===');

    try {
        // Check season end
        const rewards = checkSeasonEnd();
        if (rewards.length > 0) {
            logger.info(TAG, `Season ended! ${rewards.length} players rewarded.`);
        }

        logger.info(TAG, '=== Daily Cron Complete ===');
    } catch (err) {
        logger.error(TAG, 'Daily cron failed', err);
    }

    // Schedule next run
    scheduleDailyCron();
}

/**
 * Schedule the next daily cron execution.
 */
function scheduleDailyCron(): void {
    if (cronTimer) clearTimeout(cronTimer);
    const ms = msUntilMidnightUtc();
    logger.info(TAG, `Next daily cron in ${Math.round(ms / 60000)} minutes`);
    cronTimer = setTimeout(runDailyJob, ms);
}

/**
 * Start the daily cron system.
 */
export function startDailyCron(): void {
    logger.info(TAG, 'Daily cron system starting...');
    scheduleDailyCron();
}

/**
 * Stop the daily cron system.
 */
export function stopDailyCron(): void {
    if (cronTimer) {
        clearTimeout(cronTimer);
        cronTimer = null;
    }
    logger.info(TAG, 'Daily cron stopped.');
}
