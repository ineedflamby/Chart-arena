// ═══════════════════════════════════════════════════════════════════
//
//  INTEGRATION GUIDE — How to wire up the new points system
//
//  This file contains the exact code patches for:
//  1. ws/handlers.ts — new WS message handlers
//  2. services/matchmaking.ts — hook points engine into game-end
//  3. services/settlement.ts — hook points into post-finalization
//  4. index.ts — start cron jobs + season init
//
// ═══════════════════════════════════════════════════════════════════


// ─────────────────────────────────────────────────────────────────
// 1. ws/handlers.ts CHANGES
// ─────────────────────────────────────────────────────────────────

// ADD these imports at top:
// import { getPlayerPointsSummary, getDailyProgress, POINTS_CONFIG } from '../services/points-engine.js';
// import { getCurrentSeason } from '../services/season.js';
// import { getEloLeaderboard } from '../services/elo.js';

// ADD these cases to the switch(type) in handleMessage():
//     case ClientMsg.GET_POINTS_SUMMARY: handleGetPointsSummary(ws, wsId); break;
//     case ClientMsg.GET_DAILY_PROGRESS: handleGetDailyProgress(ws, wsId); break;
//     case ClientMsg.GET_SEASON_INFO: handleGetSeasonInfo(ws, wsId); break;
//     case ClientMsg.GET_ELO_LEADERBOARD: handleGetEloLeaderboard(ws, msg, wsId); break;

// ADD these handler functions:

function handleGetPointsSummary(ws: any, wsId: string): void {
    // if (!requireAuth(ws, wsId)) return;
    // const address = getPlayerAddress(wsId)!;
    // const summary = getPlayerPointsSummary(address);
    // sendToSocket(ws, ServerMsg.POINTS_SUMMARY, summary as any);
}

function handleGetDailyProgress(ws: any, wsId: string): void {
    // if (!requireAuth(ws, wsId)) return;
    // const address = getPlayerAddress(wsId)!;
    // const progress = getDailyProgress(address);
    // sendToSocket(ws, ServerMsg.DAILY_PROGRESS, progress as any);
}

function handleGetSeasonInfo(ws: any, wsId: string): void {
    // if (!requireAuth(ws, wsId)) return;
    // const season = getCurrentSeason();
    // sendToSocket(ws, ServerMsg.SEASON_INFO, season as any);
}

function handleGetEloLeaderboard(ws: any, msg: any, wsId: string): void {
    // if (!requireAuth(ws, wsId)) return;
    // const limit = typeof msg['limit'] === 'number' ? Math.min(msg['limit'] as number, 100) : 50;
    // const entries = getEloLeaderboard(limit);
    // // Attach display names
    // const addresses = entries.map(e => e.address);
    // const names = db.getDisplayNames(addresses);
    // const enriched = entries.map(e => ({
    //     ...e,
    //     displayName: names.get(e.address) ?? e.address.slice(0, 8) + '…',
    // }));
    // sendToSocket(ws, ServerMsg.ELO_LEADERBOARD, { entries: enriched });
}


// ─────────────────────────────────────────────────────────────────
// 2. services/matchmaking.ts CHANGES
// ─────────────────────────────────────────────────────────────────

// ADD import at top:
// import { awardMatchPoints } from './points-engine.js';
// import { updateEloRatings } from './elo.js';
// import { checkMilestones } from './quests.js';  // renamed from checkVolumeQuests

// In the game.onGameEnd callback, AFTER the stats are updated and AFTER
// the existing checkVolumeQuests loop, ADD this block for BOTH dev and prod paths:

/*
    // ── Points V2: Award match points ──
    for (const s of standings) {
        if (!isBotAddress(s.address)) {
            const breakdown = awardMatchPoints(
                s.address, s, standings,
                game.match.trades, game.match.mode, game.match.format,
                game.match.buyIn.toString(),
            );
            // Send match points breakdown to player
            sendToPlayer(s.address, ServerMsg.MATCH_POINTS, { breakdown });

            // Check milestones (renamed from checkVolumeQuests)
            const newMilestones = checkMilestones(s.address);
            for (const m of newMilestones) {
                const totalPoints = getPlayerPoints(s.address);
                sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                    questId: m.questId, title: m.title, emoji: m.emoji,
                    points: m.points, totalPoints,
                });
            }
        }
    }

    // ── ELO Update ──
    const eloChanges = updateEloRatings(standings, game.match.format);
    for (const change of eloChanges) {
        if (!isBotAddress(change.address)) {
            sendToPlayer(change.address, ServerMsg.ELO_UPDATE, {
                address: change.address,
                oldElo: change.oldElo,
                newElo: change.newElo,
                delta: change.delta,
            });
        }
    }
*/


// ─────────────────────────────────────────────────────────────────
// 3. services/settlement.ts CHANGES (postFinalizationWork)
// ─────────────────────────────────────────────────────────────────

// Same changes as matchmaking — in postFinalizationWork(), after
// db.updatePlayerStats() and the existing quest check loop, add:

/*
    // ── Points V2: Award match points ──
    // (Retrieve match data from the stored match log)
    const matchLog = db.getMatchLog(matchIdStr);
    if (matchLog) {
        for (const s of standings) {
            if (!isBotAddress(s.address)) {
                const breakdown = awardMatchPoints(
                    s.address, s, standings,
                    matchLog.trades,
                    matchLog.mode as GameModeValue,
                    matchLog.format as FormatValue,
                    buyIn,
                );
                sendToPlayer(s.address, ServerMsg.MATCH_POINTS, { breakdown });

                const newMilestones = checkMilestones(s.address);
                for (const m of newMilestones) {
                    const totalPoints = getPlayerPoints(s.address);
                    sendToPlayer(s.address, ServerMsg.QUEST_COMPLETED, {
                        questId: m.questId, title: m.title, emoji: m.emoji,
                        points: m.points, totalPoints,
                    });
                }
            }
        }

        const eloChanges = updateEloRatings(standings, matchLog.format as FormatValue);
        for (const change of eloChanges) {
            if (!isBotAddress(change.address)) {
                sendToPlayer(change.address, ServerMsg.ELO_UPDATE, change);
            }
        }
    }
*/


// ─────────────────────────────────────────────────────────────────
// 4. index.ts CHANGES
// ─────────────────────────────────────────────────────────────────

// ADD imports:
// import { startDailyCron, stopDailyCron } from './services/daily-reset.js';
// import { getCurrentSeason } from './services/season.js';

// After db.init() in main(), ADD:
//     getCurrentSeason();  // Ensure a season exists
//     startDailyCron();    // Start daily task reset + season check

// In the shutdown handler, ADD:
//     stopDailyCron();
