/**
 * ELO Rating System for Chart Arena
 *
 * Standard ELO with K-factor adjustments:
 * - New players (< 30 matches): K = 40 (faster calibration)
 * - Established players: K = 20 (more stable)
 *
 * Duel: Direct 1v1 ELO update
 * Arena/Survival: Multi-player ELO via pairwise comparisons
 */

import { db } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { Format, type FormatValue } from '../utils/constants.js';
import type { Standing } from '../game/types.js';

const TAG = 'ELO';

const DEFAULT_ELO = 1000;
const K_NEW = 40;        // First 30 matches
const K_ESTABLISHED = 20;
const NEW_PLAYER_THRESHOLD = 30;

interface EloChange {
    address: string;
    oldElo: number;
    newElo: number;
    delta: number;
}

/**
 * Expected score (probability of winning) for player A vs player B.
 */
function expectedScore(eloA: number, eloB: number): number {
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * Get K-factor based on number of matches played.
 */
function getKFactor(matchesPlayed: number): number {
    return matchesPlayed < NEW_PLAYER_THRESHOLD ? K_NEW : K_ESTABLISHED;
}

/**
 * Update ELO ratings after a match.
 *
 * For Duels: simple 1v1 update.
 * For Arena/Survival: pairwise comparison — each player is compared
 * against every other player, and ELO shifts based on aggregate expected vs actual.
 */
export function updateEloRatings(standings: Standing[], format: FormatValue): EloChange[] {
    const changes: EloChange[] = [];
    const playerCount = standings.length;
    if (playerCount < 2) return changes;

    // Get current ELO for all players
    const elos = new Map<string, number>();
    const matchCounts = new Map<string, number>();

    for (const s of standings) {
        const eloRow = db.getEloRating(s.address);
        elos.set(s.address, eloRow?.elo ?? DEFAULT_ELO);
        const stats = db.getPlayerStats(s.address);
        matchCounts.set(s.address, stats?.matches_played ?? 0);
    }

    if (format === Format.DUEL && playerCount === 2) {
        // ── Simple 1v1 ELO ──
        const winner = standings[0];
        const loser = standings[1];
        const eloW = elos.get(winner.address)!;
        const eloL = elos.get(loser.address)!;
        const kW = getKFactor(matchCounts.get(winner.address)!);
        const kL = getKFactor(matchCounts.get(loser.address)!);

        const expectedW = expectedScore(eloW, eloL);
        const expectedL = expectedScore(eloL, eloW);

        const newEloW = Math.round(eloW + kW * (1 - expectedW));
        const newEloL = Math.round(eloL + kL * (0 - expectedL));

        changes.push({ address: winner.address, oldElo: eloW, newElo: newEloW, delta: newEloW - eloW });
        changes.push({ address: loser.address, oldElo: eloL, newElo: newEloL, delta: newEloL - eloL });
    } else {
        // ── Multi-player ELO (pairwise) ──
        // Each player is compared against every other player.
        // Score: 1 for beating them (higher rank), 0.5 for tie, 0 for losing.
        for (const player of standings) {
            const playerElo = elos.get(player.address)!;
            const k = getKFactor(matchCounts.get(player.address)!);

            let totalExpected = 0;
            let totalActual = 0;

            for (const opponent of standings) {
                if (opponent.address === player.address) continue;
                const oppElo = elos.get(opponent.address)!;
                totalExpected += expectedScore(playerElo, oppElo);

                // Actual score: 1 if player ranks higher (lower rank number), 0 if lower
                if (player.rank < opponent.rank) totalActual += 1;
                else if (player.rank === opponent.rank) totalActual += 0.5;
                // else: 0
            }

            // Scale K by number of opponents for multi-player (prevent huge swings)
            const scaledK = k / (playerCount - 1);
            const delta = Math.round(scaledK * (totalActual - totalExpected) * (playerCount - 1));
            const newElo = Math.max(100, playerElo + delta); // Floor at 100

            changes.push({
                address: player.address,
                oldElo: playerElo,
                newElo,
                delta: newElo - playerElo,
            });
        }
    }

    // Write all ELO changes to DB
    for (const change of changes) {
        db.upsertEloRating(change.address, change.newElo);
        logger.info(TAG, `${change.address.slice(0, 8)}: ${change.oldElo} → ${change.newElo} (${change.delta >= 0 ? '+' : ''}${change.delta})`);
    }

    return changes;
}

/**
 * Get ELO leaderboard for the current season.
 */
export function getEloLeaderboard(limit: number = 50): Array<{ address: string; elo: number; rank: number }> {
    return db.getEloLeaderboard(limit);
}

export { DEFAULT_ELO };
