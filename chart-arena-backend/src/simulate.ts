/**
 * Chart Arena — Headless Match Simulator
 * 
 * Runs N simulated matches synchronously (no real-time delay).
 * Collects data on: item drops, tier distribution, PnL, wins, Drain/Heist impact, etc.
 * 
 * Usage: node build/simulate.js [numGames] [mode] [format]
 *   numGames: 10, 50, 100 (default: 50)
 *   mode: 0=Classic, 1=Survival, 2=Chaos (default: 0)
 *   format: 0=Duel, 1=Arena (default: 1)
 */

import {
    ItemId, ITEMS, ITEMS_T1, getDropTicks, processItemDrops, activateItem, tickItemEffects,
    createItemState, getItemUsableTick,
    type ItemIdValue, type PlayerItemState,
} from './game/items.js';
import { getPhase, STANDARD_TICKS, SURVIVAL_TICKS, STARTING_CAPITAL, GameMode, Format } from './utils/constants.js';

// ── Seeded RNG ──
class RNG {
    private state: number;
    constructor(seed: number) { this.state = seed | 1; }
    next(): number {
        this.state ^= this.state << 13;
        this.state ^= this.state >> 17;
        this.state ^= this.state << 5;
        return (this.state >>> 0) / 4294967296;
    }
}

// ── Simulated Player ──
interface SimPlayer {
    address: string;
    equity: number;
    position: { status: string; direction: string | null; entryPrice: number; entryTick: number };
    itemState: PlayerItemState;
    tradeCount: number;
    lastCloseTick: number;
    eliminated: boolean;
    eliminatedAtTick: number;
    // Bot personality
    openChance: number;
    closeChance: number;
    longBias: number;
    itemUseChance: number;
}

// ── Stats Collectors ──
interface MatchResult {
    mode: number;
    format: number;
    totalTicks: number;
    players: Array<{ address: string; equity: number; rank: number; trades: number }>;
    itemDrops: Array<{ item: number; tier: number; tick: number }>;
    itemUses: Array<{ item: number; tier: number; blocked: boolean; reflected: boolean; stolenEquity: number }>;
    drainTotal: number;
    heistTotal: number;
    nukeCount: number;
    blackoutCount: number;
    earthquakeCount: number;
}

// ── Price Generator (simplified GBM) ──
function generatePrice(prevPrice: number, tick: number, totalTicks: number, rng: RNG, volatilityMult: number = 1): number {
    const phase = tick < 45 ? 0.6 : tick < 165 ? 1.0 : tick < 210 ? 1.5 : 2.0;
    const baseVol = 0.003 * phase * volatilityMult;
    const drift = -0.0001; // slight downward drift for realism
    const delta = drift + baseVol * (rng.next() * 2 - 1);
    return Math.max(prevPrice * (1 + delta), 10); // floor at $10
}

// ── Run One Match ──
function simulateMatch(seed: number, mode: number, format: number): MatchResult {
    const rng = new RNG(seed);
    const numPlayers = format === 0 ? 2 : 5;
    const totalTicks = mode === 1 ? SURVIVAL_TICKS : STANDARD_TICKS;
    const leverage = mode === 1 ? 2 : 1;
    const usableTick = getItemUsableTick(mode as any);

    // Create players
    const players: SimPlayer[] = [];
    for (let i = 0; i < numPlayers; i++) {
        players.push({
            address: `player_${i}`,
            equity: STARTING_CAPITAL,
            position: { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 },
            itemState: createItemState(),
            tradeCount: 0,
            lastCloseTick: -999,
            eliminated: false,
            eliminatedAtTick: -1,
            openChance: 0.15 + rng.next() * 0.3,    // 15-45%
            closeChance: 0.10 + rng.next() * 0.25,   // 10-35%
            longBias: 0.4 + rng.next() * 0.2,        // 40-60%
            itemUseChance: 0.15 + rng.next() * 0.2,  // 15-35%
        });
    }

    // Build player map for item system
    const playerMap = new Map<string, any>();
    for (const p of players) {
        playerMap.set(p.address, p);
    }

    // Stats
    const itemDrops: MatchResult['itemDrops'] = [];
    const itemUses: MatchResult['itemUses'] = [];
    let drainTotal = 0, heistTotal = 0, nukeCount = 0, blackoutCount = 0, earthquakeCount = 0;
    let volatilityMult = 1;
    let earthquakeUntil = -1;

    let price = 100;

    // ── Tick loop ──
    for (let tick = 0; tick < totalTicks; tick++) {
        // Generate price
        const currentVolMult = volatilityMult * (tick >= earthquakeUntil ? 1 : 5);
        price = generatePrice(price, tick, totalTicks, rng, currentVolMult);

        // Phase
        const phase = getPhase(tick, mode as any);

        // Item drops
        const drops = processItemDrops(tick, playerMap, format as any, mode as any, () => rng.next());
        for (const d of drops) {
            const def = ITEMS.get(d.item);
            itemDrops.push({ item: d.item, tier: def?.tier ?? 0, tick });
        }

        // Expire effects
        tickItemEffects(tick, playerMap);

        // Expire earthquake
        if (earthquakeUntil > 0 && tick >= earthquakeUntil) {
            earthquakeUntil = -1;
        }

        // Bot decisions (each player)
        for (const p of players) {
            if (p.eliminated) continue;

            // Use items?
            if (tick >= usableTick && p.itemState.inventory.length > 0 && rng.next() < p.itemUseChance) {
                const itemId = p.itemState.inventory[0];
                const rankMap = new Map<string, number>();
                const sorted = [...players].filter(x => !x.eliminated).sort((a, b) => computeEquity(b, price, leverage) - computeEquity(a, price, leverage));
                sorted.forEach((s, i) => rankMap.set(s.address, i + 1));

                const result = activateItem(
                    p.address, itemId, tick, playerMap, format as any, null, () => rng.next(), rankMap,
                );
                if (result.success && result.event) {
                    const def = ITEMS.get(itemId);
                    itemUses.push({
                        item: itemId,
                        tier: def?.tier ?? 0,
                        blocked: !!result.event.blocked,
                        reflected: !!result.event.reflected,
                        stolenEquity: result.event.stolenEquity ?? 0,
                    });

                    // Handle special items
                    if (itemId === ItemId.DRAIN && result.event.stolenEquity) {
                        drainTotal += result.event.stolenEquity;
                    }
                    if (itemId === ItemId.HEIST && result.event.stolenEquity) {
                        heistTotal += result.event.stolenEquity;
                    }
                    if (itemId === ItemId.NUKE) {
                        nukeCount++;
                        // Force-close all exposed
                        for (const pl of players) {
                            if (pl.address === p.address || pl.eliminated) continue;
                            if (pl.position.status !== 'FLAT') {
                                pl.equity = computeEquity(pl, price, leverage);
                                pl.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                            }
                        }
                        // Price drop 3%
                        price *= 0.97;
                    }
                    if (itemId === ItemId.BLACKOUT) blackoutCount++;
                    if (itemId === ItemId.EARTHQUAKE) {
                        earthquakeCount++;
                        earthquakeUntil = tick + 8;
                    }
                }
                continue; // Skip trading this tick
            }

            // Frozen check
            if (p.itemState.frozenUntilTick > 0 && tick < p.itemState.frozenUntilTick) continue;

            // Trading
            if (p.position.status === 'FLAT') {
                if (rng.next() < p.openChance) {
                    // Check cooldown
                    if (tick - p.lastCloseTick >= 3) {
                        const direction = rng.next() < p.longBias ? 'LONG' : 'SHORT';
                        const slippage = 0.001;
                        const execPrice = direction === 'LONG' ? price * (1 + slippage) : price * (1 - slippage);
                        p.position = { status: direction, direction, entryPrice: execPrice, entryTick: tick };
                        p.tradeCount++;
                    }
                }
            } else {
                if (rng.next() < p.closeChance && tick - p.position.entryTick >= 5) {
                    // Close
                    const dir = p.position.direction!;
                    const entry = p.position.entryPrice;
                    const slippage = 0.001;
                    const execPrice = dir === 'LONG' ? price * (1 - slippage) : price * (1 + slippage);

                    // Boost check
                    let boostMult = 1;
                    if (p.itemState.boostPending && tick < p.itemState.boostExpiresAtTick) {
                        boostMult = 1.5;
                        p.itemState.boostPending = false;
                        p.itemState.boostExpiresAtTick = -1;
                    }

                    const rawPnl = dir === 'LONG'
                        ? p.equity * (execPrice / entry - 1)
                        : p.equity * (1 - execPrice / entry);
                    p.equity = Math.round((p.equity + rawPnl * leverage * boostMult) * 10000) / 10000;
                    p.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                    p.lastCloseTick = tick;
                    p.tradeCount++;
                }
            }

            // Survival: liquidation check
            if (mode === 1) {
                const eq = computeEquity(p, price, leverage);
                if (eq <= 0 && !p.eliminated) {
                    p.eliminated = true;
                    p.eliminatedAtTick = tick;
                    p.equity = 0;
                    p.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                }
            }
        }
    }

    // Final equity calculation
    for (const p of players) {
        if (!p.eliminated) {
            p.equity = computeEquity(p, price, leverage);
        }
    }

    // Rank
    const ranked = [...players].sort((a, b) => b.equity - a.equity);
    return {
        mode, format, totalTicks,
        players: ranked.map((p, i) => ({ address: p.address, equity: p.equity, rank: i + 1, trades: p.tradeCount })),
        itemDrops, itemUses,
        drainTotal, heistTotal, nukeCount, blackoutCount, earthquakeCount,
    };
}

function computeEquity(p: SimPlayer, price: number, leverage: number): number {
    if (p.position.status === 'FLAT') return p.equity;
    const dir = p.position.direction!;
    const entry = p.position.entryPrice;
    if (entry === 0) return p.equity;
    const pnl = dir === 'LONG'
        ? p.equity * (price / entry - 1)
        : p.equity * (1 - price / entry);
    return Math.round((p.equity + pnl * leverage) * 10000) / 10000;
}

// ═══ MAIN ═══

const args = process.argv.slice(2);
const NUM_GAMES = parseInt(args[0] ?? '50');
const MODE = parseInt(args[1] ?? '0');      // 0=Classic, 1=Survival, 2=Chaos
const FORMAT = parseInt(args[2] ?? '1');    // 0=Duel, 1=Arena

const MODE_NAMES = ['Classic', 'Survival', 'Chaos'];
const FORMAT_NAMES = ['Duel', 'Arena'];

console.log(`\n═══ CHART ARENA SIMULATOR ═══`);
console.log(`Running ${NUM_GAMES} ${MODE_NAMES[MODE]} ${FORMAT_NAMES[FORMAT]} matches...\n`);

const results: MatchResult[] = [];
const startTime = Date.now();

for (let i = 0; i < NUM_GAMES; i++) {
    const seed = (i + 1) * 7919 + 42; // deterministic seeds
    results.push(simulateMatch(seed, MODE, FORMAT));
}

const elapsed = Date.now() - startTime;
console.log(`⏱️  ${NUM_GAMES} games simulated in ${elapsed}ms (${(elapsed / NUM_GAMES).toFixed(1)}ms/game)\n`);

// ═══ ANALYSIS ═══

// 1. Item Drop Distribution
const tierDrops = { 1: 0, 2: 0, 3: 0 };
const itemDropCounts: Record<number, number> = {};
let totalDrops = 0;

for (const r of results) {
    for (const d of r.itemDrops) {
        tierDrops[d.tier as 1|2|3]++;
        itemDropCounts[d.item] = (itemDropCounts[d.item] ?? 0) + 1;
        totalDrops++;
    }
}

console.log(`📦 ITEM DROP DISTRIBUTION (${totalDrops} total drops across ${NUM_GAMES} games)`);
console.log(`   T1: ${tierDrops[1]} (${(tierDrops[1]/totalDrops*100).toFixed(1)}%)`);
console.log(`   T2: ${tierDrops[2]} (${(tierDrops[2]/totalDrops*100).toFixed(1)}%)`);
console.log(`   T3: ${tierDrops[3]} (${(tierDrops[3]/totalDrops*100).toFixed(1)}%)`);
console.log(`   Avg drops/game: ${(totalDrops/NUM_GAMES).toFixed(1)}`);
console.log('');

console.log(`📊 PER-ITEM DROP FREQUENCY:`);
const sortedItems = Object.entries(itemDropCounts).sort((a, b) => b[1] - a[1]);
for (const [id, count] of sortedItems) {
    const def = ITEMS.get(Number(id) as ItemIdValue);
    if (def) {
        console.log(`   ${def.emoji} ${def.name.padEnd(14)} T${def.tier} — ${count} drops (${(count/totalDrops*100).toFixed(1)}%)`);
    }
}
console.log('');

// 2. Item Usage Stats
const tierUses = { 1: 0, 2: 0, 3: 0 };
const itemUseCounts: Record<number, { used: number; blocked: number; reflected: number }> = {};
let totalUses = 0, totalBlocked = 0, totalReflected = 0;

for (const r of results) {
    for (const u of r.itemUses) {
        tierUses[u.tier as 1|2|3]++;
        if (!itemUseCounts[u.item]) itemUseCounts[u.item] = { used: 0, blocked: 0, reflected: 0 };
        itemUseCounts[u.item].used++;
        if (u.blocked) { totalBlocked++; itemUseCounts[u.item].blocked++; }
        if (u.reflected) { totalReflected++; itemUseCounts[u.item].reflected++; }
        totalUses++;
    }
}

console.log(`⚔️  ITEM USAGE (${totalUses} activations, ${totalBlocked} blocked, ${totalReflected} reflected)`);
console.log(`   Shield block rate: ${totalUses > 0 ? (totalBlocked/totalUses*100).toFixed(1) : 0}%`);
console.log(`   Shield reflect rate: ${totalBlocked > 0 ? (totalReflected/totalBlocked*100).toFixed(1) : 0}% of blocks`);
console.log('');

console.log(`📊 PER-ITEM USAGE:`);
const sortedUses = Object.entries(itemUseCounts).sort((a, b) => b[1].used - a[1].used);
for (const [id, stats] of sortedUses) {
    const def = ITEMS.get(Number(id) as ItemIdValue);
    if (def) {
        const blockStr = stats.blocked > 0 ? ` (${stats.blocked} blocked, ${stats.reflected} reflected)` : '';
        console.log(`   ${def.emoji} ${def.name.padEnd(14)} — ${stats.used} uses${blockStr}`);
    }
}
console.log('');

// 3. T3 Impact Stats
const totalDrain = results.reduce((s, r) => s + r.drainTotal, 0);
const totalHeist = results.reduce((s, r) => s + r.heistTotal, 0);
const totalNukes = results.reduce((s, r) => s + r.nukeCount, 0);
const totalBlackouts = results.reduce((s, r) => s + r.blackoutCount, 0);
const totalEarthquakes = results.reduce((s, r) => s + r.earthquakeCount, 0);

console.log(`💥 HIGH-IMPACT STATS:`);
console.log(`   🩸 Drain: $${totalDrain.toFixed(2)} total stolen (avg $${(totalDrain/NUM_GAMES).toFixed(2)}/game)`);
console.log(`   💰 Heist: $${totalHeist.toFixed(2)} total stolen (avg $${(totalHeist/NUM_GAMES).toFixed(2)}/game)`);
console.log(`   ☢️  Nukes: ${totalNukes} total (${(totalNukes/NUM_GAMES).toFixed(2)}/game)`);
console.log(`   🌑 Blackouts: ${totalBlackouts} total (${(totalBlackouts/NUM_GAMES).toFixed(2)}/game)`);
console.log(`   🌋 Earthquakes: ${totalEarthquakes} total (${(totalEarthquakes/NUM_GAMES).toFixed(2)}/game)`);
console.log('');

// 4. PnL Distribution
const allPnL: number[] = [];
const winnerPnL: number[] = [];
const loserPnL: number[] = [];

for (const r of results) {
    for (const p of r.players) {
        const pnl = p.equity - STARTING_CAPITAL;
        allPnL.push(pnl);
        if (p.rank === 1) winnerPnL.push(pnl);
        else loserPnL.push(pnl);
    }
}

const avgPnL = allPnL.reduce((s, v) => s + v, 0) / allPnL.length;
const avgWinnerPnL = winnerPnL.reduce((s, v) => s + v, 0) / winnerPnL.length;
const avgLoserPnL = loserPnL.reduce((s, v) => s + v, 0) / loserPnL.length;
const positivePnL = allPnL.filter(p => p > 0).length;
const maxPnL = Math.max(...allPnL);
const minPnL = Math.min(...allPnL);

console.log(`💰 PnL DISTRIBUTION (${allPnL.length} player-games):`);
console.log(`   Average PnL: $${avgPnL.toFixed(2)}`);
console.log(`   Winner avg PnL: $${avgWinnerPnL.toFixed(2)}`);
console.log(`   Loser avg PnL: $${avgLoserPnL.toFixed(2)}`);
console.log(`   Profitable players: ${positivePnL}/${allPnL.length} (${(positivePnL/allPnL.length*100).toFixed(1)}%)`);
console.log(`   Best PnL: +$${maxPnL.toFixed(2)}`);
console.log(`   Worst PnL: -$${Math.abs(minPnL).toFixed(2)}`);
console.log('');

// 5. Trade Count Distribution
const allTrades = results.flatMap(r => r.players.map(p => p.trades));
const avgTrades = allTrades.reduce((s, v) => s + v, 0) / allTrades.length;
console.log(`📈 TRADE STATS:`);
console.log(`   Avg trades/player: ${avgTrades.toFixed(1)}`);
console.log(`   Max trades in a game: ${Math.max(...allTrades)}`);
console.log('');

// 6. Final Equity Histogram
const brackets = [0, 2, 4, 4.5, 5, 5.5, 6, 8, 10, 999];
const hist: number[] = new Array(brackets.length - 1).fill(0);
for (const pnl of allPnL) {
    const eq = STARTING_CAPITAL + pnl;
    for (let i = 0; i < brackets.length - 1; i++) {
        if (eq >= brackets[i] && eq < brackets[i + 1]) { hist[i]++; break; }
    }
}

console.log(`📊 FINAL EQUITY HISTOGRAM:`);
for (let i = 0; i < hist.length; i++) {
    const label = `$${brackets[i]}-${brackets[i+1] === 999 ? '∞' : '$'+brackets[i+1]}`;
    const bar = '█'.repeat(Math.ceil(hist[i] / allPnL.length * 50));
    console.log(`   ${label.padEnd(10)} ${bar} ${hist[i]} (${(hist[i]/allPnL.length*100).toFixed(1)}%)`);
}

console.log(`\n═══ SIMULATION COMPLETE ═══\n`);
