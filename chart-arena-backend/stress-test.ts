/**
 * Chart Arena — Full Stress Test
 * Runs 100 games across all 6 mode/format combos and flags anomalies.
 *
 * Usage: npx ts-node --esm stress-test.ts
 *   OR:  compile and run with node
 */

import {
    ItemId, ITEMS, getDropTicks, processItemDrops, activateItem, tickItemEffects,
    createItemState, getItemUsableTick,
    type ItemIdValue, type PlayerItemState,
} from './src/game/items.js';
import {
    STANDARD_TICKS, SURVIVAL_TICKS, STARTING_CAPITAL, GameMode, Format,
    getPhase,
} from './src/utils/constants.js';

// ── RNG ──
class RNG {
    private state: number;
    constructor(seed: number) { this.state = (seed | 1) >>> 0; }
    next(): number {
        this.state ^= this.state << 13;
        this.state ^= this.state >> 17;
        this.state ^= this.state << 5;
        this.state = this.state >>> 0;
        return this.state / 4294967296;
    }
}

// ── Types ──
interface SimPlayer {
    address: string;
    equity: number;
    position: { status: string; direction: string | null; entryPrice: number; entryTick: number };
    itemState: PlayerItemState;
    tradeCount: number;
    lastCloseTick: number;
    flatSeconds: number;
    eliminated: boolean;
    eliminatedAtTick: number;
    openChance: number;
    closeChance: number;
    longBias: number;
    itemUseChance: number;
}

interface Anomaly {
    game: number;
    mode: string;
    format: string;
    tick: number;
    type: string;
    detail: string;
}

interface MatchResult {
    mode: number;
    format: number;
    totalTicks: number;
    endedAtTick: number;
    players: Array<{ address: string; equity: number; rank: number; trades: number; eliminated: boolean }>;
    itemDropCounts: number;
    itemUseCounts: number;
    drainTotal: number;
    heistTotal: number;
    nukeCount: number;
    anomalies: Anomaly[];
    // Per-item stats
    drops: Array<{ item: number; tier: number; tick: number }>;
    uses: Array<{ item: number; tier: number; blocked: boolean; reflected: boolean; stolenEquity: number }>;
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

function generatePrice(prevPrice: number, tick: number, rng: RNG, volatilityMult = 1, mode: number): number {
    const phase = getPhase(tick, mode as any);
    const baseVol = 0.003 * phase.volatilityMultiplier * volatilityMult;
    const delta = -0.0001 + baseVol * (rng.next() * 2 - 1);
    return Math.max(prevPrice * (1 + delta), 5);
}

function simulateMatch(seed: number, mode: number, format: number, gameIdx: number): MatchResult {
    const rng = new RNG(seed);
    const numPlayers = format === Format.DUEL ? 2 : 5;
    const totalTicks = mode === GameMode.SURVIVAL ? SURVIVAL_TICKS : STANDARD_TICKS;
    const leverage = mode === GameMode.SURVIVAL ? 2 : 1;
    const usableTick = getItemUsableTick(mode as any);
    const MODE_NAMES = ['Classic', 'Survival', 'Chaos'];
    const FORMAT_NAMES = ['Duel', 'Arena'];
    const anomalies: Anomaly[] = [];

    const flag = (tick: number, type: string, detail: string) => anomalies.push({
        game: gameIdx, mode: MODE_NAMES[mode], format: FORMAT_NAMES[format], tick, type, detail,
    });

    // Create players
    const players: SimPlayer[] = [];
    for (let i = 0; i < numPlayers; i++) {
        players.push({
            address: `p${i}`,
            equity: STARTING_CAPITAL,
            position: { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 },
            itemState: createItemState(),
            tradeCount: 0,
            lastCloseTick: -999,
            flatSeconds: 0,
            eliminated: false,
            eliminatedAtTick: -1,
            openChance: 0.15 + rng.next() * 0.30,
            closeChance: 0.10 + rng.next() * 0.25,
            longBias: 0.40 + rng.next() * 0.20,
            itemUseChance: 0.15 + rng.next() * 0.20,
        });
    }
    const playerMap = new Map<string, any>();
    for (const p of players) playerMap.set(p.address, p);

    // Stats
    const drops: MatchResult['drops'] = [];
    const uses: MatchResult['uses'] = [];
    let drainTotal = 0, heistTotal = 0, nukeCount = 0;
    let earthquakeUntil = -1;
    let price = 100;
    let endedAtTick = totalTicks;

    // Verify drop schedule fires correctly
    const expectedDropTicks = getDropTicks(mode as any, format as any);

    for (let tick = 0; tick < totalTicks; tick++) {
        const voltMult = tick < earthquakeUntil ? 5 : 1;
        price = generatePrice(price, tick, rng, voltMult, mode);

        // ── Anomaly checks ──
        if (price > 300) flag(tick, 'PRICE_HIGH', `Price hit $${price.toFixed(2)}`);
        if (price < 10)  flag(tick, 'PRICE_LOW',  `Price hit $${price.toFixed(2)}`);

        // Item drops
        const tickDrops = processItemDrops(tick, playerMap, format as any, mode as any, () => rng.next());
        for (const d of tickDrops) {
            const def = ITEMS.get(d.item);
            drops.push({ item: d.item, tier: def?.tier ?? 0, tick });
            if (!def) flag(tick, 'UNKNOWN_ITEM_DROP', `Unknown itemId=${d.item}`);
        }

        // Verify expected drops fire
        if (expectedDropTicks.includes(tick) && tickDrops.length === 0) {
            flag(tick, 'MISSING_DROP', `Expected drop at tick ${tick} but 0 drops fired`);
        }
        if (!expectedDropTicks.includes(tick) && tickDrops.length > 0) {
            flag(tick, 'UNEXPECTED_DROP', `Drop fired at tick ${tick} (not in schedule)`);
        }

        tickItemEffects(tick, playerMap);
        if (tick >= earthquakeUntil) earthquakeUntil = -1;

        // Bot decisions
        for (const p of players) {
            if (p.eliminated) continue;

            // Use item
            if (tick >= usableTick && p.itemState.inventory.length > 0 && rng.next() < p.itemUseChance) {
                const itemId = p.itemState.inventory[0];
                const rankMap = new Map<string, number>();
                [...players].filter(x => !x.eliminated)
                    .sort((a, b) => computeEquity(b, price, leverage) - computeEquity(a, price, leverage))
                    .forEach((s, i) => rankMap.set(s.address, i + 1));

                const result = activateItem(p.address, itemId, tick, playerMap, format as any, null, () => rng.next(), rankMap);
                if (result.success && result.event) {
                    const def = ITEMS.get(itemId);
                    if (!def) flag(tick, 'UNKNOWN_ITEM_USE', `itemId=${itemId}`);
                    uses.push({
                        item: itemId, tier: def?.tier ?? 0,
                        blocked: !!result.event.blocked,
                        reflected: !!result.event.reflected,
                        stolenEquity: result.event.stolenEquity ?? 0,
                    });

                    if (itemId === ItemId.DRAIN)      drainTotal += result.event.stolenEquity ?? 0;
                    if (itemId === ItemId.HEIST)      heistTotal += result.event.stolenEquity ?? 0;
                    if (itemId === ItemId.NUKE) {
                        nukeCount++;
                        for (const pl of players) {
                            if (pl.address === p.address || pl.eliminated) continue;
                            if (pl.position.status !== 'FLAT') {
                                pl.equity = computeEquity(pl, price, leverage);
                                pl.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                            }
                        }
                        price *= 0.97;
                    }
                    if (itemId === ItemId.EARTHQUAKE) earthquakeUntil = tick + 8;
                }
                continue;
            }

            // Frozen
            if (p.itemState.frozenUntilTick > 0 && tick < p.itemState.frozenUntilTick) continue;

            // Trading
            if (p.position.status === 'FLAT') {
                p.flatSeconds++;
                if (rng.next() < p.openChance && tick - p.lastCloseTick >= 3) {
                    const dir = rng.next() < p.longBias ? 'LONG' : 'SHORT';
                    const execPrice = dir === 'LONG' ? price * 1.001 : price * 0.999;
                    p.position = { status: dir, direction: dir, entryPrice: execPrice, entryTick: tick };
                    p.tradeCount++;
                    p.flatSeconds = 0;
                }
            } else {
                if (rng.next() < p.closeChance && tick - p.position.entryTick >= 5) {
                    const dir = p.position.direction!;
                    const entry = p.position.entryPrice;
                    const execPrice = dir === 'LONG' ? price * 0.999 : price * 1.001;
                    const rawPnl = dir === 'LONG'
                        ? p.equity * (execPrice / entry - 1)
                        : p.equity * (1 - execPrice / entry);
                    const newEquity = Math.round((p.equity + rawPnl * leverage) * 10000) / 10000;

                    // Anomaly: equity went negative via trade
                    if (newEquity < 0) flag(tick, 'NEGATIVE_EQUITY_TRADE', `${p.address} equity=${newEquity.toFixed(4)}`);

                    p.equity = Math.max(0, newEquity);
                    p.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                    p.lastCloseTick = tick;
                    p.tradeCount++;
                }
            }

            // Survival liquidation
            if (mode === GameMode.SURVIVAL) {
                const eq = computeEquity(p, price, leverage);
                if (eq <= 0 && !p.eliminated) {
                    p.eliminated = true;
                    p.eliminatedAtTick = tick;
                    p.equity = 0;
                    p.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
                }
            }
        }

        // Survival early end
        if (mode === GameMode.SURVIVAL) {
            const alive = players.filter(p => !p.eliminated).length;
            if (alive <= 1) { endedAtTick = tick; break; }
        }
    }

    // Force-close all open positions at end
    for (const p of players) {
        if (!p.eliminated && p.position.status !== 'FLAT') {
            const dir = p.position.direction!;
            const entry = p.position.entryPrice;
            const pnl = dir === 'LONG'
                ? p.equity * (price / entry - 1)
                : p.equity * (1 - price / entry);
            p.equity = Math.round((p.equity + pnl * leverage) * 10000) / 10000;
            p.position = { status: 'FLAT', direction: null, entryPrice: 0, entryTick: 0 };
        }
    }

    // Final equity anomaly checks
    for (const p of players) {
        if (isNaN(p.equity)) flag(endedAtTick, 'NAN_EQUITY', `${p.address}`);
        if (p.equity > 500) flag(endedAtTick, 'EQUITY_TOO_HIGH', `${p.address} equity=$${p.equity.toFixed(2)}`);
    }

    // Check item drops total
    const expectedDropCount = expectedDropTicks.length * numPlayers;
    if (drops.length !== expectedDropCount) {
        flag(-1, 'DROP_COUNT_MISMATCH', `Expected ${expectedDropCount} drops, got ${drops.length}`);
    }

    // Rank
    const ranked = [...players].sort((a, b) => b.equity - a.equity);
    return {
        mode, format, totalTicks, endedAtTick,
        players: ranked.map((p, i) => ({
            address: p.address, equity: p.equity, rank: i + 1,
            trades: p.tradeCount, eliminated: p.eliminated,
        })),
        itemDropCounts: drops.length,
        itemUseCounts: uses.length,
        drainTotal, heistTotal, nukeCount,
        anomalies, drops, uses,
    };
}

// ═══ MAIN ═══

const N = 100;
const COMBOS = [
    { mode: 0, format: 0 }, // Classic Duel
    { mode: 0, format: 1 }, // Classic Arena
    { mode: 1, format: 1 }, // Survival Arena (no Survival Duel in GDD)
    { mode: 2, format: 0 }, // Chaos Duel
    { mode: 2, format: 1 }, // Chaos Arena
];
const MODE_NAMES = ['Classic', 'Survival', 'Chaos'];
const FORMAT_NAMES = ['Duel', 'Arena'];

console.log(`\n${'═'.repeat(60)}`);
console.log(`  CHART ARENA — FULL STRESS TEST  (${N} games × ${COMBOS.length} combos)`);
console.log(`${'═'.repeat(60)}\n`);

const allAnomalies: Anomaly[] = [];
const startTime = Date.now();

for (const { mode, format } of COMBOS) {
    const label = `${MODE_NAMES[mode]} ${FORMAT_NAMES[format]}`;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  🎮 ${label.toUpperCase()} — ${N} games`);
    console.log(`${'─'.repeat(60)}`);

    const results: MatchResult[] = [];
    for (let i = 0; i < N; i++) {
        const seed = (i + 1) * 6271 + mode * 1000 + format * 100;
        results.push(simulateMatch(seed, mode, format, i + 1));
    }

    const anomalies = results.flatMap(r => r.anomalies);
    allAnomalies.push(...anomalies);

    // ── Drop stats ──
    const allDrops = results.flatMap(r => r.drops);
    const tierCount = { 1: 0, 2: 0, 3: 0 };
    for (const d of allDrops) tierCount[d.tier as 1|2|3]++;
    const totalDrops = allDrops.length;
    const avgDrops = totalDrops / N;
    const expectedDropsPerGame = getDropTicks(mode as any, format as any).length * (format === 0 ? 2 : 5);

    console.log(`\n  📦 ITEM DROPS`);
    console.log(`     Total: ${totalDrops}  |  Avg/game: ${avgDrops.toFixed(1)}  |  Expected/game: ${expectedDropsPerGame}`);
    if (Math.abs(avgDrops - expectedDropsPerGame) > 0.5) {
        console.log(`     ⚠️  DROP COUNT MISMATCH! Expected ${expectedDropsPerGame}/game, got ${avgDrops.toFixed(1)}`);
    } else {
        console.log(`     ✅ Drop count correct`);
    }
    if (totalDrops > 0) {
        console.log(`     T1: ${(tierCount[1]/totalDrops*100).toFixed(1)}%  T2: ${(tierCount[2]/totalDrops*100).toFixed(1)}%  T3: ${(tierCount[3]/totalDrops*100).toFixed(1)}%`);
    }

    // Per-item drops
    const itemDropMap: Record<number, number> = {};
    for (const d of allDrops) itemDropMap[d.item] = (itemDropMap[d.item] ?? 0) + 1;
    const topDrops = Object.entries(itemDropMap).sort((a,b) => b[1]-a[1]).slice(0, 5);
    console.log(`     Top items: ${topDrops.map(([id, cnt]) => `${ITEMS.get(Number(id) as ItemIdValue)?.emoji ?? '?'} ${ITEMS.get(Number(id) as ItemIdValue)?.name ?? id}(${cnt})`).join(', ')}`);

    // ── Usage stats ──
    const allUses = results.flatMap(r => r.uses);
    const totalUses = allUses.length;
    const blocked = allUses.filter(u => u.blocked).length;
    const reflected = allUses.filter(u => u.reflected).length;
    const avgUses = totalUses / N;
    const useRate = totalDrops > 0 ? (totalUses / totalDrops * 100) : 0;

    console.log(`\n  ⚔️  ITEM USAGE`);
    console.log(`     Uses: ${totalUses}  |  Avg/game: ${avgUses.toFixed(1)}  |  Use rate: ${useRate.toFixed(1)}% of drops`);
    console.log(`     Blocked: ${blocked} (${totalUses > 0 ? (blocked/totalUses*100).toFixed(1) : 0}%)  |  Reflected: ${reflected}`);

    if (useRate < 5) console.log(`     ⚠️  Very low item use rate — bots may not be using items`);
    if (useRate > 90) console.log(`     ⚠️  Very high item use rate — suspicious`);

    // ── PnL ──
    const allPnL = results.flatMap(r => r.players.map(p => p.equity - STARTING_CAPITAL));
    const avgPnL = allPnL.reduce((s, v) => s + v, 0) / allPnL.length;
    const maxPnL = Math.max(...allPnL);
    const minPnL = Math.min(...allPnL);
    const profitable = allPnL.filter(p => p > 0).length;

    console.log(`\n  💰 PnL`);
    console.log(`     Avg: $${avgPnL.toFixed(3)}  |  Best: +$${maxPnL.toFixed(2)}  |  Worst: -$${Math.abs(minPnL).toFixed(2)}`);
    console.log(`     Profitable: ${profitable}/${allPnL.length} (${(profitable/allPnL.length*100).toFixed(1)}%)`);

    if (Math.abs(avgPnL) > 1.0) console.log(`     ⚠️  High avg PnL drift ($${avgPnL.toFixed(3)}) — possible equity leak`);

    // ── Survival: elimination stats ──
    if (mode === GameMode.SURVIVAL) {
        const elimCounts = results.map(r => r.players.filter(p => p.eliminated).length);
        const avgElim = elimCounts.reduce((s, v) => s + v, 0) / N;
        const gamesEndedEarly = results.filter(r => r.endedAtTick < r.totalTicks).length;
        console.log(`\n  💀 SURVIVAL`);
        console.log(`     Avg eliminations/game: ${avgElim.toFixed(1)} / 5`);
        console.log(`     Games ended early: ${gamesEndedEarly}/${N}`);
        if (avgElim < 1) console.log(`     ⚠️  Very few eliminations — leverage may not be effective`);
    }

    // ── Tick count check ──
    const wrongTicks = results.filter(r => mode !== GameMode.SURVIVAL && r.endedAtTick !== r.totalTicks);
    if (wrongTicks.length > 0) {
        console.log(`\n  ⚠️  ${wrongTicks.length} games ended at wrong tick!`);
    } else if (mode !== GameMode.SURVIVAL) {
        const expectedTicks = mode === GameMode.SURVIVAL ? SURVIVAL_TICKS : STANDARD_TICKS;
        console.log(`\n  ✅ All games ran full ${expectedTicks} ticks`);
    }

    // ── Anomalies ──
    if (anomalies.length === 0) {
        console.log(`  ✅ No anomalies detected`);
    } else {
        const byType: Record<string, number> = {};
        for (const a of anomalies) byType[a.type] = (byType[a.type] ?? 0) + 1;
        console.log(`\n  🚨 ANOMALIES: ${anomalies.length} total`);
        for (const [type, count] of Object.entries(byType).sort((a,b) => b[1]-a[1])) {
            console.log(`     ${type}: ${count}`);
        }
        // Show first 3 examples per type
        const shown = new Set<string>();
        for (const a of anomalies) {
            if (!shown.has(a.type)) {
                console.log(`     └─ Example: tick=${a.tick} ${a.detail}`);
                shown.add(a.type);
            }
        }
    }
}

const elapsed = Date.now() - startTime;
const totalGames = N * COMBOS.length;

console.log(`\n${'═'.repeat(60)}`);
console.log(`  SUMMARY`);
console.log(`${'═'.repeat(60)}`);
console.log(`  ⏱️  ${totalGames} games in ${elapsed}ms (${(elapsed/totalGames).toFixed(1)}ms/game)`);

if (allAnomalies.length === 0) {
    console.log(`  ✅ ZERO anomalies across all ${totalGames} games!`);
} else {
    const byType: Record<string, number> = {};
    for (const a of allAnomalies) byType[a.type] = (byType[a.type] ?? 0) + 1;
    console.log(`  🚨 ${allAnomalies.length} total anomalies:`);
    for (const [type, count] of Object.entries(byType).sort((a,b) => b[1]-a[1])) {
        console.log(`     ${type.padEnd(30)} × ${count}`);
    }
}
console.log(`\n${'═'.repeat(60)}\n`);
