/**
 * Constellation Rank System — Volume Based
 *
 * 15 tiers based on cumulative trading volume (USD).
 * This is the ONLY rank/tier system in Chart Arena.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  RANK              │  VOLUME (USD)  │  COLOR    │ SECTION  │
 * ├─────────────────────────────────────────────────────────┤
 * │  Newcomer           │  $0            │  #E7D27C  │ Newcomers│
 * │  Plancton           │  $50           │  #6dd5a0  │          │
 * │  Shrimp             │  $100          │  #F6B8D0  │          │
 * │  King Shrimp        │  $500          │  #ff88bb  │          │
 * │  Fish               │  $1,000        │  #6BAFE0  │          │
 * ├─────────────────────────────────────────────────────────┤
 * │  Glizzy Fish        │  $2,500        │  #38b6ff  │ Deep Sea │
 * │  Baron Of Fish      │  $5,000        │  #00d4ff  │          │
 * │  Shark              │  $10,000       │  #b87fff  │          │
 * │  Fine Shark         │  $25,000       │  #9f50ff  │          │
 * │  ZkShark            │  $100,000      │  #cc88ff  │          │
 * ├─────────────────────────────────────────────────────────┤
 * │  Whale              │  $250,000      │  #88ccee  │ Apex     │
 * │  Biggy Whale        │  $500,000      │  #55aadd  │          │
 * │  Ancient Whale      │  $750,000      │  #aaddff  │          │
 * │  White Whale        │  $1,000,000    │  #e8f4ff  │          │
 * │  Megalodon          │  $5,000,000    │  #ff6030  │          │
 * └─────────────────────────────────────────────────────────┘
 *
 * Points System (separate):
 *   Points are for AIRDROP allocation only.
 *   Points come from 4 pillars: Engagement, Skill, Volume, Community.
 *   See points-engine.ts for details.
 *
 * Buy-In Tiers (separate):
 *   Bronze/Silver/Gold stake levels are match entry costs.
 *   See buy-in-tiers.ts for details.
 */

// ══════════════════════════════════════════════════════════════
// RANK DEFINITIONS
// ══════════════════════════════════════════════════════════════

export interface ConstellationRank {
    /** Internal index (0-14) */
    readonly index: number;
    /** Display name */
    readonly name: string;
    /** Minimum cumulative volume (USD) to reach this rank */
    readonly minVolume: number;
    /** Theme color (hex) — matches frontend constellation renderer */
    readonly color: string;
    /** Section grouping */
    readonly section: 'Newcomers' | 'Deep Sea' | 'Apex';
}

const RANKS: readonly ConstellationRank[] = [
    // ── Newcomers ──
    { index: 0,  name: 'Newcomer',       minVolume: 0,         color: '#E7D27C', section: 'Newcomers' },
    { index: 1,  name: 'Plancton',       minVolume: 50,        color: '#6dd5a0', section: 'Newcomers' },
    { index: 2,  name: 'Shrimp',         minVolume: 100,       color: '#F6B8D0', section: 'Newcomers' },
    { index: 3,  name: 'King Shrimp',    minVolume: 500,       color: '#ff88bb', section: 'Newcomers' },
    { index: 4,  name: 'Fish',           minVolume: 1_000,     color: '#6BAFE0', section: 'Newcomers' },
    // ── Deep Sea ──
    { index: 5,  name: 'Glizzy Fish',    minVolume: 2_500,     color: '#38b6ff', section: 'Deep Sea' },
    { index: 6,  name: 'Baron Of Fish',  minVolume: 5_000,     color: '#00d4ff', section: 'Deep Sea' },
    { index: 7,  name: 'Shark',          minVolume: 10_000,    color: '#b87fff', section: 'Deep Sea' },
    { index: 8,  name: 'Fine Shark',     minVolume: 25_000,    color: '#9f50ff', section: 'Deep Sea' },
    { index: 9,  name: 'ZkShark',        minVolume: 100_000,   color: '#cc88ff', section: 'Deep Sea' },
    // ── Apex ──
    { index: 10, name: 'Whale',          minVolume: 250_000,   color: '#88ccee', section: 'Apex' },
    { index: 11, name: 'Biggy Whale',    minVolume: 500_000,   color: '#55aadd', section: 'Apex' },
    { index: 12, name: 'Ancient Whale',  minVolume: 750_000,   color: '#aaddff', section: 'Apex' },
    { index: 13, name: 'White Whale',    minVolume: 1_000_000, color: '#e8f4ff', section: 'Apex' },
    { index: 14, name: 'Megalodon',      minVolume: 5_000_000, color: '#ff6030', section: 'Apex' },
] as const;

/** All 15 ranks in order. */
export { RANKS };

/** Total number of ranks. */
export const RANK_COUNT = RANKS.length;

// ══════════════════════════════════════════════════════════════
// LOOKUP FUNCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * Get a player's constellation rank from their cumulative volume (USD).
 * Walks the list top-down, returns the highest rank they qualify for.
 */
export function getRank(totalVolumeUsd: number): ConstellationRank {
    for (let i = RANKS.length - 1; i >= 0; i--) {
        if (totalVolumeUsd >= RANKS[i].minVolume) return RANKS[i];
    }
    return RANKS[0]; // Newcomer
}

/**
 * Get a player's rank index (0-14) from volume.
 */
export function getRankIndex(totalVolumeUsd: number): number {
    return getRank(totalVolumeUsd).index;
}

/**
 * Get progress toward the next rank (0.0 to 1.0).
 * Returns 1.0 if at max rank (Megalodon).
 */
export function getRankProgress(totalVolumeUsd: number): number {
    const current = getRank(totalVolumeUsd);
    if (current.index >= RANKS.length - 1) return 1; // Megalodon — max

    const next = RANKS[current.index + 1];
    const range = next.minVolume - current.minVolume;
    if (range <= 0) return 1;

    return Math.min(1, (totalVolumeUsd - current.minVolume) / range);
}

/**
 * Get the volume needed to reach the next rank.
 * Returns 0 if at max rank.
 */
export function getNextRankVolume(totalVolumeUsd: number): number {
    const current = getRank(totalVolumeUsd);
    if (current.index >= RANKS.length - 1) return 0;
    return RANKS[current.index + 1].minVolume;
}

/**
 * Get a rank by name (case-sensitive).
 */
export function getRankByName(name: string): ConstellationRank | undefined {
    return RANKS.find(r => r.name === name);
}

/**
 * Get a rank by index (0-14).
 */
export function getRankByIndex(index: number): ConstellationRank | undefined {
    return RANKS[index];
}

// ══════════════════════════════════════════════════════════════
// CONVENIENCE: PROFILE DATA BUILDER
// ══════════════════════════════════════════════════════════════

export interface RankProfileData {
    /** Full rank name, e.g. "Shark" */
    readonly rankName: string;
    /** Rank index (0-14) */
    readonly rankIndex: number;
    /** Theme color hex */
    readonly rankColor: string;
    /** Section label */
    readonly rankSection: string;
    /** Progress to next rank (0-100 integer) */
    readonly rankProgress: number;
    /** Volume needed for next rank (0 if max) */
    readonly nextRankVolume: number;
    /** Next rank name (null if max) */
    readonly nextRankName: string | null;
}

/**
 * Build the rank profile payload sent to the frontend via WS.
 */
export function buildRankProfile(totalVolumeUsd: number): RankProfileData {
    const rank = getRank(totalVolumeUsd);
    const progress = getRankProgress(totalVolumeUsd);
    const nextVol = getNextRankVolume(totalVolumeUsd);
    const nextRank = rank.index < RANKS.length - 1 ? RANKS[rank.index + 1] : null;

    return {
        rankName: rank.name,
        rankIndex: rank.index,
        rankColor: rank.color,
        rankSection: rank.section,
        rankProgress: Math.round(progress * 100),
        nextRankVolume: nextVol,
        nextRankName: nextRank?.name ?? null,
    };
}
