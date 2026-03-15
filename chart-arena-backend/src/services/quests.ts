/**
 * Quest System v4 — Mode-Specific Quests
 *
 * 63 quests across 9 categories:
 *
 *   GLOBAL (21):
 *     play (6), win (5), streak (4), special (2), social (4)
 *
 *   MODE-SPECIFIC (36):
 *     classic (12): 6 milestones + 6 skill quests
 *     survival (12): 6 milestones + 6 skill quests
 *     chaos (12): 6 milestones + 6 skill quests
 *
 *   CROSS-MODE (5):
 *     crossmode: All-Rounder, Triple Threat, Daily Trifecta, Swiss Army Knife, Giant Killer
 *
 * Two checking paths:
 *   - Cumulative: checked after every match against player_mode_stats
 *   - Event: checked against PlayerMatchResult from the match that just ended
 */

import { db } from '../db/database.js';
import { logger } from '../utils/logger.js';
import { getPlayerTotalPoints } from './points-engine.js';
import { getRank } from '../utils/tiers.js';
import type { PlayerMatchResult } from '../game/types.js';

const TAG = 'Quests';

export type QuestCategory = 'play' | 'win' | 'streak' | 'special' | 'social'
    | 'classic' | 'survival' | 'chaos' | 'crossmode';

export interface QuestDef {
    readonly id: string;
    readonly category: QuestCategory;
    readonly title: string;
    readonly description: string;
    readonly emoji: string;
    readonly points: number;
    readonly requirement?: number;
    readonly actionUrl?: string;
    readonly sortOrder: number;
    readonly checkType: 'cumulative' | 'event' | 'social';
    readonly statField?: string;
    readonly mode?: 0 | 1 | 2;
    /** SPRINT 3: Quest depends on systems not yet implemented. Shown as "Coming Soon" in UI. */
    readonly comingSoon?: boolean;
}

const TWITTER_HANDLE = 'ChartArena';

export const QUEST_DEFS: QuestDef[] = [

    // ═══ GLOBAL QUESTS (21) ═══

    // Play Milestones
    { id: 'play_1',    category: 'play', title: 'First Blood',       description: 'Play your first match',  emoji: '🎮', points: 10,   requirement: 1,    sortOrder: 1,  checkType: 'cumulative' },
    { id: 'play_10',   category: 'play', title: 'Getting Warmed Up', description: 'Play 10 matches',        emoji: '🔥', points: 30,   requirement: 10,   sortOrder: 2,  checkType: 'cumulative' },
    { id: 'play_50',   category: 'play', title: 'Regular',           description: 'Play 50 matches',        emoji: '⚡', points: 75,   requirement: 50,   sortOrder: 3,  checkType: 'cumulative' },
    { id: 'play_100',  category: 'play', title: 'Veteran',           description: 'Play 100 matches',       emoji: '🏅', points: 150,  requirement: 100,  sortOrder: 4,  checkType: 'cumulative' },
    { id: 'play_500',  category: 'play', title: 'Addict',            description: 'Play 500 matches',       emoji: '💊', points: 400,  requirement: 500,  sortOrder: 5,  checkType: 'cumulative' },
    { id: 'play_1000', category: 'play', title: 'No-Lifer',          description: 'Play 1,000 matches',     emoji: '☠️', points: 800,  requirement: 1000, sortOrder: 6,  checkType: 'cumulative' },

    // Win Milestones
    { id: 'win_1',   category: 'win', title: 'Winner Winner',  description: 'Win your first match',  emoji: '🏆', points: 15,   requirement: 1,   sortOrder: 10, checkType: 'cumulative' },
    { id: 'win_10',  category: 'win', title: 'Hat Trick',      description: 'Win 10 matches',        emoji: '🎩', points: 50,   requirement: 10,  sortOrder: 11, checkType: 'cumulative' },
    { id: 'win_50',  category: 'win', title: 'Dominator',      description: 'Win 50 matches',        emoji: '⚔️', points: 200,  requirement: 50,  sortOrder: 12, checkType: 'cumulative' },
    { id: 'win_100', category: 'win', title: 'Unstoppable',    description: 'Win 100 matches',       emoji: '💪', points: 500,  requirement: 100, sortOrder: 13, checkType: 'cumulative' },
    { id: 'win_500', category: 'win', title: 'Legend',          description: 'Win 500 matches',       emoji: '👑', points: 1500, requirement: 500, sortOrder: 14, checkType: 'cumulative' },

    // Streak Milestones
    { id: 'streak_3',  category: 'streak', title: 'On Fire',   description: 'Win 3 in a row', emoji: '🔥', points: 25,  requirement: 3,  sortOrder: 20, checkType: 'cumulative' },
    { id: 'streak_5',  category: 'streak', title: 'Rampage',   description: 'Win 5 in a row', emoji: '⚡', points: 75,  requirement: 5,  sortOrder: 21, checkType: 'cumulative' },
    { id: 'streak_10', category: 'streak', title: 'Godlike',   description: 'Win 10 in a row', emoji: '🌟', points: 300, requirement: 10, sortOrder: 22, checkType: 'cumulative' },
    { id: 'streak_15', category: 'streak', title: 'Immortal',  description: 'Win 15 in a row', emoji: '🦋', points: 750, requirement: 15, sortOrder: 23, checkType: 'cumulative' },

    // Special
    { id: 'special_og',     category: 'special', title: 'OG Player',  description: 'Play during Season 1',  emoji: '🏛️', points: 200, requirement: 1, sortOrder: 31, checkType: 'cumulative' },
    { id: 'special_rank_1', category: 'special', title: 'Champion',   description: 'Finish #1 in an Arena', emoji: '🥇', points: 100, requirement: 1, sortOrder: 32, checkType: 'cumulative' },

    // Social
    { id: 'social_link_twitter', category: 'social', title: 'Connect X',      description: 'Link your Twitter account',      emoji: '🐦', points: 100, sortOrder: 40, checkType: 'social' },
    { id: 'social_follow',       category: 'social', title: 'Follow Us',      description: `Follow @${TWITTER_HANDLE} on X`, emoji: '➕', points: 50,  sortOrder: 41, checkType: 'social', actionUrl: `https://twitter.com/intent/follow?screen_name=${TWITTER_HANDLE}` },
    { id: 'share_referral',      category: 'social', title: 'Invite Friends', description: 'Share your referral link',        emoji: '🔗', points: 40,  sortOrder: 42, checkType: 'social', actionUrl: '' },

    // ═══ 🎯 CLASSIC QUESTS (12) ═══

    // Milestones
    { id: 'classic_play_5',   category: 'classic', title: 'Purist',          description: 'Play 5 Classic matches',   emoji: '🎯', points: 15,  requirement: 5,   sortOrder: 100, checkType: 'cumulative', statField: 'matches_played', mode: 0 },
    { id: 'classic_play_25',  category: 'classic', title: 'Disciple',        description: 'Play 25 Classic matches',  emoji: '📊', points: 50,  requirement: 25,  sortOrder: 101, checkType: 'cumulative', statField: 'matches_played', mode: 0 },
    { id: 'classic_play_100', category: 'classic', title: 'Monk',            description: 'Play 100 Classic matches', emoji: '🧘', points: 150, requirement: 100, sortOrder: 102, checkType: 'cumulative', statField: 'matches_played', mode: 0 },
    { id: 'classic_win_3',    category: 'classic', title: 'Chart Reader',    description: 'Win 3 Classic matches',    emoji: '📈', points: 25,  requirement: 3,   sortOrder: 103, checkType: 'cumulative', statField: 'wins', mode: 0 },
    { id: 'classic_win_15',   category: 'classic', title: 'Chart Whisperer', description: 'Win 15 Classic matches',   emoji: '🔮', points: 100, requirement: 15,  sortOrder: 104, checkType: 'cumulative', statField: 'wins', mode: 0 },
    { id: 'classic_win_50',   category: 'classic', title: 'Chart Oracle',    description: 'Win 50 Classic matches',   emoji: '👁️', points: 350, requirement: 50,  sortOrder: 105, checkType: 'cumulative', statField: 'wins', mode: 0 },

    // Skill Quests
    { id: 'classic_perfect_read', category: 'classic', title: 'Perfect Read',  description: 'Win Classic using ≤4 of 8 trades',       emoji: '🎯', points: 75,  sortOrder: 110, checkType: 'event', mode: 0, comingSoon: true },
    { id: 'classic_one_trade',    category: 'classic', title: 'One Shot',      description: 'Win Classic with exactly 1 trade',        emoji: '🎪', points: 200, sortOrder: 111, checkType: 'event', mode: 0, comingSoon: true },
    { id: 'classic_full_trades',  category: 'classic', title: 'All In',        description: 'Win Classic using all 8 trades',          emoji: '♟️', points: 50,  sortOrder: 112, checkType: 'event', mode: 0, comingSoon: true },
    { id: 'classic_clutch_win',   category: 'classic', title: 'Clutch Legend',  description: 'Win during a Clutch overtime',            emoji: '⏰', points: 150, sortOrder: 113, checkType: 'event', mode: 0, comingSoon: true },
    { id: 'classic_comeback',     category: 'classic', title: 'The Comeback',   description: 'Win after being down 20%+ at midpoint',  emoji: '🔄', points: 100, sortOrder: 114, checkType: 'event', mode: 0, comingSoon: true },
    { id: 'classic_streak_5',     category: 'classic', title: 'Pure Streak',    description: 'Win 5 Classic matches in a row',         emoji: '🔥', points: 200, requirement: 5, sortOrder: 115, checkType: 'cumulative', statField: 'best_win_streak', mode: 0 },

    // ═══ 💀 SURVIVAL QUESTS (12) ═══

    // Milestones
    { id: 'survival_play_5',   category: 'survival', title: 'Fresh Meat',       description: 'Play 5 Survival matches',   emoji: '💀', points: 15,  requirement: 5,   sortOrder: 200, checkType: 'cumulative', statField: 'matches_played', mode: 1 },
    { id: 'survival_play_25',  category: 'survival', title: 'Seasoned Fighter', description: 'Play 25 Survival matches',  emoji: '⚔️', points: 50,  requirement: 25,  sortOrder: 201, checkType: 'cumulative', statField: 'matches_played', mode: 1 },
    { id: 'survival_play_100', category: 'survival', title: 'Veteran Hunter',   description: 'Play 100 Survival matches', emoji: '🏹', points: 150, requirement: 100, sortOrder: 202, checkType: 'cumulative', statField: 'matches_played', mode: 1 },
    { id: 'survival_win_3',    category: 'survival', title: 'Survivor',         description: 'Win 3 Survival matches',    emoji: '🛡️', points: 30,  requirement: 3,   sortOrder: 203, checkType: 'cumulative', statField: 'wins', mode: 1 },
    { id: 'survival_win_15',   category: 'survival', title: 'Apex Predator',    description: 'Win 15 Survival matches',   emoji: '🦈', points: 120, requirement: 15,  sortOrder: 204, checkType: 'cumulative', statField: 'wins', mode: 1 },
    { id: 'survival_win_50',   category: 'survival', title: 'Extinction Event', description: 'Win 50 Survival matches',   emoji: '☄️', points: 400, requirement: 50,  sortOrder: 205, checkType: 'cumulative', statField: 'wins', mode: 1 },

    // Skill Quests
    { id: 'survival_ring_escape',  category: 'survival', title: "Death's Door",  description: 'Take ring damage and still win',         emoji: '🚪', points: 100, sortOrder: 210, checkType: 'event', mode: 1, comingSoon: true },
    { id: 'survival_bounty_3',    category: 'survival', title: 'Bounty Hunter',  description: 'Claim 3 bounties total',                 emoji: '💰', points: 75,  requirement: 3, sortOrder: 211, checkType: 'cumulative', statField: 'total_bounties_claimed', mode: 1, comingSoon: true },
    { id: 'survival_bounty_snipe', category: 'survival', title: 'King Slayer',   description: 'Claim the bounty AND win the match',     emoji: '👑', points: 150, sortOrder: 212, checkType: 'event', mode: 1, comingSoon: true },
    { id: 'survival_no_items',    category: 'survival', title: 'Bare Hands',     description: 'Win Survival without using any items',   emoji: '✊', points: 250, sortOrder: 213, checkType: 'event', mode: 1 },
    { id: 'survival_tick_200',    category: 'survival', title: 'Ironclad',       description: 'Survive past tick 200 in 10 matches',    emoji: '🏔️', points: 100, requirement: 10, sortOrder: 214, checkType: 'cumulative', statField: 'survived_past_200_count', mode: 1 },
    { id: 'survival_loot_king',   category: 'survival', title: 'Grave Robber',   description: 'Loot 20 items from dead players',        emoji: '⚰️', points: 75,  requirement: 20, sortOrder: 215, checkType: 'cumulative', statField: 'total_items_looted', mode: 1, comingSoon: true },

    // ═══ 🌀 CHAOS QUESTS (12) ═══

    // Milestones
    { id: 'chaos_play_5',   category: 'chaos', title: 'Chaos Tourist',  description: 'Play 5 Chaos matches',   emoji: '🌀', points: 15,  requirement: 5,   sortOrder: 300, checkType: 'cumulative', statField: 'matches_played', mode: 2 },
    { id: 'chaos_play_25',  category: 'chaos', title: 'Chaos Regular',  description: 'Play 25 Chaos matches',  emoji: '🎲', points: 50,  requirement: 25,  sortOrder: 301, checkType: 'cumulative', statField: 'matches_played', mode: 2 },
    { id: 'chaos_play_100', category: 'chaos', title: 'Agent of Chaos', description: 'Play 100 Chaos matches', emoji: '🃏', points: 150, requirement: 100, sortOrder: 302, checkType: 'cumulative', statField: 'matches_played', mode: 2 },
    { id: 'chaos_win_3',    category: 'chaos', title: 'Lucky Winner',   description: 'Win 3 Chaos matches',    emoji: '🍀', points: 25,  requirement: 3,   sortOrder: 303, checkType: 'cumulative', statField: 'wins', mode: 2 },
    { id: 'chaos_win_15',   category: 'chaos', title: 'Chaos Master',   description: 'Win 15 Chaos matches',   emoji: '🌪️', points: 100, requirement: 15,  sortOrder: 304, checkType: 'cumulative', statField: 'wins', mode: 2 },
    { id: 'chaos_win_50',   category: 'chaos', title: 'Lord of Chaos',  description: 'Win 50 Chaos matches',   emoji: '👹', points: 400, requirement: 50,  sortOrder: 305, checkType: 'cumulative', statField: 'wins', mode: 2 },

    // Skill Quests
    { id: 'chaos_survive_flip',   category: 'chaos', title: 'Teflon',           description: 'Be in position during FLIP and still profit', emoji: '⚡', points: 75,  sortOrder: 310, checkType: 'event', mode: 2, comingSoon: true },
    { id: 'chaos_gold_digger',    category: 'chaos', title: 'Gold Digger',      description: 'Profit during Gold Rush',                     emoji: '💎', points: 50,  sortOrder: 311, checkType: 'event', mode: 2, comingSoon: true },
    { id: 'chaos_blind_faith',    category: 'chaos', title: 'Blind Faith',      description: 'Trade during Phantom Market and profit',      emoji: '👻', points: 100, sortOrder: 312, checkType: 'event', mode: 2, comingSoon: true },
    { id: 'chaos_multiplier_low', category: 'chaos', title: 'Against All Odds', description: 'Win Chaos with ≤0.8× chaos multiplier',      emoji: '🎰', points: 200, sortOrder: 313, checkType: 'event', mode: 2, comingSoon: true },
    { id: 'chaos_all_mutators',   category: 'chaos', title: 'Seen It All',      description: 'Experience all 8 mutator types',              emoji: '🧬', points: 150, sortOrder: 314, checkType: 'cumulative', statField: 'unique_mutators_seen', mode: 2, comingSoon: true },
    { id: 'chaos_item_spam',      category: 'chaos', title: 'Hoarder',          description: 'Use 10+ items in a single Chaos match',       emoji: '🎒', points: 75,  sortOrder: 315, checkType: 'event', mode: 2 },

    // ═══ 🏅 CROSS-MODE QUESTS (5) ═══

    { id: 'crossmode_all_modes',     category: 'crossmode', title: 'All-Rounder',      description: 'Win at least 1 match in each mode',          emoji: '🎯', points: 100, requirement: 1,  sortOrder: 400, checkType: 'cumulative' },
    { id: 'crossmode_triple_threat', category: 'crossmode', title: 'Triple Threat',     description: 'Win 10 matches in EACH mode',                 emoji: '🏅', points: 500, requirement: 10, sortOrder: 401, checkType: 'cumulative' },
    { id: 'crossmode_daily_tri',     category: 'crossmode', title: 'Daily Trifecta',    description: 'Play one match of each mode in a single day', emoji: '📅', points: 40,  requirement: 1,  sortOrder: 402, checkType: 'event', comingSoon: true },
    { id: 'crossmode_versatile',     category: 'crossmode', title: 'Swiss Army Knife',  description: '5+ win streak in 2 different modes',          emoji: '🔧', points: 200, requirement: 2,  sortOrder: 403, checkType: 'cumulative' },
    { id: 'crossmode_underdog',      category: 'crossmode', title: 'Giant Killer',      description: 'Beat an opponent with 200+ higher ELO',       emoji: '🐉', points: 100, requirement: 1,  sortOrder: 404, checkType: 'event', comingSoon: true },
    { id: 'crossmode_grinder',       category: 'crossmode', title: 'The Grinder',       description: 'Play 50 matches in every mode',               emoji: '⚙️', points: 300, requirement: 50, sortOrder: 405, checkType: 'cumulative' },
];

const QUEST_MAP = new Map(QUEST_DEFS.map(q => [q.id, q]));

// Volume tiers (cosmetic only)
export function getVolumeTier(volumeUsd: number): { name: string; emoji: string } {
    const rank = getRank(volumeUsd);
    return { name: rank.name, emoji: rank.name };
}

// ═══════════════════════════════════════════════════════════════════
// QUEST STATUS
// ═══════════════════════════════════════════════════════════════════

export interface QuestStatus {
    id: string; category: string; title: string; description: string;
    emoji: string; points: number; completed: boolean; progress: number;
    current: number; requirement: number; actionUrl?: string; sortOrder: number;
    comingSoon?: boolean;
}

export function getPlayerQuests(address: string): QuestStatus[] {
    const completed = db.getCompletedQuests(address);
    const globalStats = db.getPlayerStats(address);
    const modeStatsAll = db.getAllPlayerModeStats(address);
    const modeStatsMap = new Map(modeStatsAll.map(s => [s.mode, s]));

    return QUEST_DEFS.map(q => {
        const done = completed.has(q.id);
        let current = 0;
        const req = q.requirement ?? 1;

        // Global quests: player_stats
        if (globalStats) {
            if (q.category === 'play') current = globalStats.matches_played;
            else if (q.category === 'win') current = globalStats.wins;
            else if (q.category === 'streak') current = globalStats.best_win_streak;
            else if (q.category === 'special') {
                if (q.id === 'special_rank_1') current = globalStats.best_rank <= 1 ? 1 : 0;
            }
        }

        // Mode quests: player_mode_stats
        if (q.mode !== undefined && q.statField && q.checkType === 'cumulative') {
            const ms = modeStatsMap.get(q.mode);
            if (ms) current = getModeStatValue(ms, q.statField);
        }

        // Cross-mode quests
        if (q.category === 'crossmode' && q.checkType === 'cumulative') {
            current = getCrossModeProgress(q.id, modeStatsMap);
        }

        // Event quests: 0 until completed
        if (q.checkType === 'event' && !done) current = 0;

        // Social: twitter check
        if (q.id === 'social_link_twitter') {
            const profile = db.getProfile(address);
            if (profile?.twitter_handle) current = 1;
        }

        const displayCur = done ? req : Math.min(Math.floor(current), req);
        const progress = done ? 1 : (req > 0 ? Math.min(1, current / req) : 0);

        return {
            id: q.id, category: q.category,
            title: q.title, description: q.description,
            emoji: q.emoji, points: q.points,
            completed: done, progress, current: displayCur, requirement: req,
            actionUrl: q.id === 'share_referral'
                ? `https://chart-arena.gg/?ref=${address.slice(0, 12)}`
                : q.actionUrl,
            sortOrder: q.sortOrder,
            comingSoon: q.comingSoon,
        };
    });
}

export function getPlayerPoints(address: string): number {
    return getPlayerTotalPoints(address);
}

export function getModeMastery(address: string, category: QuestCategory): { level: number; max: number } {
    const quests = QUEST_DEFS.filter(q => q.category === category);
    const completed = db.getCompletedQuests(address);
    const done = quests.filter(q => completed.has(q.id)).length;
    return { level: done, max: quests.length };
}

// ═══════════════════════════════════════════════════════════════════
// CLAIM / AUTO-COMPLETE
// ═══════════════════════════════════════════════════════════════════

export function claimSocialQuest(address: string, questId: string): { success: boolean; points: number; error?: string } {
    const quest = QUEST_MAP.get(questId);
    if (!quest) return { success: false, points: 0, error: 'Unknown quest' };
    if (quest.category !== 'social') return { success: false, points: 0, error: 'Not a social quest' };
    const completed = db.getCompletedQuests(address);
    if (completed.has(questId)) return { success: false, points: 0, error: 'Already claimed' };
    if (questId === 'social_link_twitter') {
        const profile = db.getProfile(address);
        if (!profile?.twitter_handle) return { success: false, points: 0, error: 'Link Twitter first' };
    }
    db.completeQuest(address, questId, quest.points);
    logger.info(TAG, `🎯 ${address.slice(0, 8)} claimed "${quest.title}" (+${quest.points} pts)`);
    return { success: true, points: quest.points };
}

export interface QuestCompletion { questId: string; title: string; emoji: string; points: number; }

// ═══════════════════════════════════════════════════════════════════
// GLOBAL MILESTONE CHECKER (unchanged logic)
// ═══════════════════════════════════════════════════════════════════

export function checkMilestones(address: string): QuestCompletion[] {
    const stats = db.getPlayerStats(address);
    if (!stats) return [];
    const completed = db.getCompletedQuests(address);
    const results: QuestCompletion[] = [];

    for (const quest of QUEST_DEFS) {
        if (quest.checkType !== 'cumulative') continue;
        if (quest.category === 'social') continue;
        if (quest.mode !== undefined || quest.category === 'crossmode') continue;
        if (completed.has(quest.id)) continue;
        const req = quest.requirement ?? 1;
        let current = 0;

        if (quest.category === 'play') current = stats.matches_played;
        else if (quest.category === 'win') current = stats.wins;
        else if (quest.category === 'streak') current = stats.best_win_streak;
        else if (quest.category === 'special') {
            if (quest.id === 'special_rank_1') current = stats.best_rank <= 1 ? 1 : 0;
        }

        if (current >= req) {
            db.completeQuest(address, quest.id, quest.points);
            results.push({ questId: quest.id, title: quest.title, emoji: quest.emoji, points: quest.points });
            logger.info(TAG, `🎯 ${address.slice(0, 8)} completed "${quest.title}" (+${quest.points} pts)`);
        }
    }
    return results;
}

// ═══════════════════════════════════════════════════════════════════
// MODE MILESTONE CHECKER (cumulative mode + cross-mode quests)
// ═══════════════════════════════════════════════════════════════════

export function checkModeMilestones(address: string): QuestCompletion[] {
    const completed = db.getCompletedQuests(address);
    const modeStatsAll = db.getAllPlayerModeStats(address);
    const modeStatsMap = new Map(modeStatsAll.map(s => [s.mode, s]));
    const results: QuestCompletion[] = [];

    for (const quest of QUEST_DEFS) {
        if (quest.checkType !== 'cumulative') continue;
        if (completed.has(quest.id)) continue;

        // Mode-specific quests
        if (quest.mode !== undefined && quest.statField) {
            const ms = modeStatsMap.get(quest.mode);
            if (!ms) continue;
            const req = quest.requirement ?? 1;
            const current = getModeStatValue(ms, quest.statField);
            if (current >= req) {
                db.completeQuest(address, quest.id, quest.points);
                results.push({ questId: quest.id, title: quest.title, emoji: quest.emoji, points: quest.points });
                logger.info(TAG, `🎯 ${address.slice(0, 8)} completed "${quest.title}" (+${quest.points} pts)`);
            }
            continue;
        }

        // Cross-mode quests
        if (quest.category === 'crossmode') {
            const req = quest.requirement ?? 1;
            const current = getCrossModeProgress(quest.id, modeStatsMap);
            if (current >= req) {
                db.completeQuest(address, quest.id, quest.points);
                results.push({ questId: quest.id, title: quest.title, emoji: quest.emoji, points: quest.points });
                logger.info(TAG, `🎯 ${address.slice(0, 8)} completed "${quest.title}" (+${quest.points} pts)`);
            }
        }
    }
    return results;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT QUEST CHECKER (one-shot achievements from a match)
// ═══════════════════════════════════════════════════════════════════

export function checkEventQuests(address: string, result: PlayerMatchResult): QuestCompletion[] {
    const completed = db.getCompletedQuests(address);
    const results: QuestCompletion[] = [];

    for (const quest of QUEST_DEFS) {
        if (quest.checkType !== 'event') continue;
        if (completed.has(quest.id)) continue;
        if (quest.mode !== undefined && quest.mode !== result.mode) continue;

        if (evaluateEventCondition(quest.id, result)) {
            db.completeQuest(address, quest.id, quest.points);
            results.push({ questId: quest.id, title: quest.title, emoji: quest.emoji, points: quest.points });
            logger.info(TAG, `🎯 ${address.slice(0, 8)} completed "${quest.title}" (+${quest.points} pts)`);
        }
    }
    return results;
}

// ═══════════════════════════════════════════════════════════════════
// TWITTER + VOLUME (unchanged)
// ═══════════════════════════════════════════════════════════════════

export function checkTwitterQuest(address: string): QuestCompletion | null {
    const completed = db.getCompletedQuests(address);
    if (completed.has('social_link_twitter')) return null;
    const profile = db.getProfile(address);
    if (!profile?.twitter_handle) return null;
    const quest = QUEST_MAP.get('social_link_twitter')!;
    db.completeQuest(address, quest.id, quest.points);
    logger.info(TAG, `🎯 ${address.slice(0, 8)} auto-completed "Connect X" (+${quest.points} pts)`);
    return { questId: quest.id, title: quest.title, emoji: quest.emoji, points: quest.points };
}

export function checkVolumeQuests(_address: string): QuestCompletion[] { return []; }

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function getModeStatValue(stats: NonNullable<ReturnType<typeof db.getPlayerModeStats>>, field: string): number {
    const s = stats as unknown as Record<string, unknown>;
    const val = s[field];
    if (field === 'unique_mutators_seen') {
        try {
            const arr = JSON.parse(val as string ?? '[]');
            return Array.isArray(arr) ? arr.length : 0;
        } catch { return 0; }
    }
    return typeof val === 'number' ? val : 0;
}

function getCrossModeProgress(
    questId: string,
    modeStatsMap: Map<number, NonNullable<ReturnType<typeof db.getPlayerModeStats>>>,
): number {
    const classic = modeStatsMap.get(0);
    const survival = modeStatsMap.get(1);
    const chaos = modeStatsMap.get(2);

    switch (questId) {
        case 'crossmode_all_modes': {
            let m = 0;
            if (classic && classic.wins >= 1) m++;
            if (survival && survival.wins >= 1) m++;
            if (chaos && chaos.wins >= 1) m++;
            return m >= 3 ? 1 : 0;
        }
        case 'crossmode_triple_threat':
            return Math.min(classic?.wins ?? 0, survival?.wins ?? 0, chaos?.wins ?? 0);
        case 'crossmode_versatile': {
            let m = 0;
            if (classic && classic.best_win_streak >= 5) m++;
            if (survival && survival.best_win_streak >= 5) m++;
            if (chaos && chaos.best_win_streak >= 5) m++;
            return m;
        }
        case 'crossmode_grinder':
            return Math.min(
                classic?.matches_played ?? 0,
                survival?.matches_played ?? 0,
                chaos?.matches_played ?? 0,
            );
        default:
            return 0;
    }
}

function evaluateEventCondition(questId: string, r: PlayerMatchResult): boolean {
    switch (questId) {
        // Classic
        case 'classic_perfect_read':
            return r.won && r.classicTradesOfLimit > 0 && r.classicTradesOfLimit <= 4;
        case 'classic_one_trade':
            return r.won && r.classicTradesOfLimit === 1;
        case 'classic_full_trades':
            return r.won && r.classicTradesOfLimit === 8;
        case 'classic_clutch_win':
            return false; // TODO: needs clutchTriggered field
        case 'classic_comeback':
            return false; // TODO: needs equityAtMidpoint field

        // Survival
        case 'survival_ring_escape':
            return r.won && r.survivalRingDamageTaken && r.survivalRingEscaped;
        case 'survival_bounty_snipe':
            return r.won && r.survivalBountiesClaimed > 0;
        case 'survival_no_items':
            return r.won && r.mode === 1 && r.itemsUsed === 0;

        // Chaos
        case 'chaos_survive_flip':
            return r.chaosWasInPositionDuringFlip && r.chaosSurvivedFlipProfitably;
        case 'chaos_gold_digger':
            return r.chaosGoldRushPnl > 0;
        case 'chaos_blind_faith':
            return r.chaosPhantomMarketTraded && r.chaosPhantomMarketProfited;
        case 'chaos_multiplier_low':
            return r.won && r.chaosMultiplier > 0 && r.chaosMultiplier <= 0.8;
        case 'chaos_item_spam':
            return r.mode === 2 && r.itemsUsed >= 10;

        // Cross-mode
        case 'crossmode_daily_tri':
            return false; // TODO: needs daily mode tracking
        case 'crossmode_underdog':
            return false; // TODO: needs opponent ELO in PlayerMatchResult

        default:
            return false;
    }
}
