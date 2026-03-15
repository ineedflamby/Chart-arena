/**
 * Price Chart — true 60fps snake.
 * 
 * Key fixes for smooth rendering:
 * 1. Scale (minP/maxP) computed from HISTORICAL ticks only, then lerped at 0.03/frame
 *    so the Y-axis never jumps when a new tick arrives.
 * 2. Live tip interpolated via elapsed time + ease-in-out cubic.
 * 3. Catmull-Rom with SUB=6 for smooth curves.
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import type { PriceTick } from '../hooks/useGame';
import { ChartVFX } from './ChartVFX';
import { ReactiveDot } from './ReactiveDot';

export interface ChartItem {
    id: number;
    emoji: string;
    name: string;
}

interface Props {
    ticks: PriceTick[];
    entryPrice: number;
    positionStatus: string;
    equity: number;
    startingCapital: number;
    currentPhase: string;
    items?: ChartItem[];
    canUseItems?: boolean;
    onUseItem?: (itemId: number) => void;
    mirrorCursed?: boolean;
    shockwaveActive?: boolean;
    blackoutActive?: boolean;
    timeWarpActive?: boolean;
    frozen?: boolean;
    thickSkinActive?: boolean;
    activeItemVFX?: number | null;
}

type Timeframe = '1s' | '3s' | '5s';

interface Candle {
    open: number; high: number; low: number; close: number;
    startTick: number; phase: string;
}

const PHASE_BG: Record<string, string> = {
    OPEN: 'transparent', MID: 'transparent',
    CRUNCH: 'transparent', OVERTIME: 'transparent',
    PREVIEW: 'transparent',
};

const MAX_VISIBLE = 120;
const PADDING = { top: 24, right: 72, bottom: 32, left: 12 };
const LINE_COLOR = '#EBCCFF';
const LINE_GLOW = 'rgba(235,204,255,0.2)';
const GRID_COLOR = 'rgba(190,221,241,0.06)';
const GRID_TEXT = '#554d73';
const PRICE_DOT = '#F6B8D0';
const DOT_RADIUS = 6;
const ENTRY_LINE = 'rgba(109,213,160,0.5)';
const BG = '#0c0a18';
const CANDLE_UP = '#6dd5a0';
const CANDLE_DOWN = '#F6B8D0';

function aggregateCandles(ticks: PriceTick[], size: number): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < ticks.length; i += size) {
        const chunk = ticks.slice(i, i + size);
        if (chunk.length === 0) break;
        const prices = chunk.map(t => t.price);
        candles.push({
            open: prices[0], high: Math.max(...prices),
            low: Math.min(...prices), close: prices[prices.length - 1],
            startTick: chunk[0].tick, phase: chunk[chunk.length - 1].phase,
        });
    }
    return candles;
}

export function CandleChart({ ticks, entryPrice, positionStatus, equity, startingCapital, currentPhase, items, canUseItems, onUseItem, mirrorCursed, shockwaveActive, blackoutActive, timeWarpActive, frozen, thickSkinActive, activeItemVFX }: Props) {
    const [timeframe, setTimeframe] = useState<Timeframe>('1s');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animRef = useRef<number>(0);
    const ticksRef = useRef<PriceTick[]>([]);
    const entryRef = useRef(entryPrice);
    const posRef = useRef(positionStatus);
    const mirrorRef = useRef(false);
    const tfRef = useRef<Timeframe>('1s');
    const sizeRef = useRef({ w: 0, h: 0 });

    // Reactive dot engine
    const dotRef = useRef<ReactiveDot>(new ReactiveDot());
    const equityRef = useRef(equity);
    const capitalRef = useRef(startingCapital);
    const phaseRef = useRef(currentPhase);
    const frozenRef = useRef(false);
    const itemVFXRef = useRef<number | null>(null);

    // Snake: animate tip between prev→target over 1s
    const snakeRef = useRef({
        prevPrice: 100,
        targetPrice: 100,
        lastTickAt: 0,
        tickCount: 0,
    });

    // Stable scale: lerp min/max slowly so Y-axis never jumps
    const scaleRef = useRef({ minP: 95, maxP: 105 });

    ticksRef.current = ticks;
    entryRef.current = entryPrice;
    posRef.current = positionStatus;
    mirrorRef.current = mirrorCursed ?? false;
    tfRef.current = timeframe;
    equityRef.current = equity;
    capitalRef.current = startingCapital;
    phaseRef.current = currentPhase;
    frozenRef.current = frozen ?? false;
    itemVFXRef.current = activeItemVFX ?? null;

    // Feed state changes into reactive dot
    dotRef.current.reactToState(
        activeItemVFX ?? null,
        positionStatus,
        equity,
        startingCapital,
        currentPhase,
        frozen ?? false,
        DOT_RADIUS,
    );

    // Detect new tick
    if (ticks.length !== snakeRef.current.tickCount) {
        const prev = ticks[ticks.length - 2]?.price ?? snakeRef.current.targetPrice;
        const curr = ticks[ticks.length - 1]?.price ?? prev;
        snakeRef.current.prevPrice = prev;
        snakeRef.current.targetPrice = curr;
        snakeRef.current.lastTickAt = performance.now();
        snakeRef.current.tickCount = ticks.length;
    }

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const rect = container.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);

        if (sizeRef.current.w !== w || sizeRef.current.h !== h) {
            canvas.width = w * 2; canvas.height = h * 2;
            canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
            sizeRef.current = { w, h };
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(2, 0, 0, 2, 0, 0);

        const allTicks = ticksRef.current;
        const entry = entryRef.current;
        const pos = posRef.current;
        const tf = tfRef.current;

        // Live interpolated price (ease-in-out over 1s)
        const snake = snakeRef.current;
        const rawP = Math.min((performance.now() - snake.lastTickAt) / 1000, 1);
        const eased = rawP < 0.5
            ? 4 * rawP * rawP * rawP
            : 1 - Math.pow(-2 * rawP + 2, 3) / 2;
        const livePrice = snake.prevPrice + (snake.targetPrice - snake.prevPrice) * eased;

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, w, h);

        // Update reactive dot (particles, lerps, beat sync) once per frame
        dotRef.current.update();

        if (allTicks.length === 0) {
            ctx.fillStyle = GRID_TEXT; ctx.font = '13px "Fredoka", sans-serif';
            ctx.textAlign = 'center'; ctx.fillText('Waiting for chart data...', w / 2, h / 2);
            animRef.current = requestAnimationFrame(draw); return;
        }

        let processedTicks = allTicks;
        let dp = livePrice;
        if (mirrorRef.current) {
            processedTicks = allTicks.map(t => ({ ...t, price: 200 - t.price }));
            dp = 200 - livePrice;
        }

        const chartW = w - PADDING.left - PADDING.right;
        const chartH = h - PADDING.top - PADDING.bottom;

        if (tf === '1s') {
            const historicalTicks = processedTicks.slice(-MAX_VISIBLE);

            // ── Stable scale: compute target from history only, lerp slowly ──
            // This prevents the Y-axis from rescaling 60x/second as dp changes
            const histPrices = historicalTicks.map(t => t.price);
            if (entry > 0) histPrices.push(entry);
            histPrices.push(snake.prevPrice, snake.targetPrice); // include full range of current segment
            let targetMin = Math.min(...histPrices);
            let targetMax = Math.max(...histPrices);
            const margin = (targetMax - targetMin) * 0.14 || 2;
            targetMin -= margin; targetMax += margin;

            // Lerp scale at 3%/frame — smooth but not laggy
            scaleRef.current.minP += (targetMin - scaleRef.current.minP) * 0.03;
            scaleRef.current.maxP += (targetMax - scaleRef.current.maxP) * 0.03;

            const { minP, maxP } = scaleRef.current;
            const range = maxP - minP;

            const xOf = (i: number) => PADDING.left + (i / Math.max(historicalTicks.length - 1, 1)) * chartW;
            const yOf = (price: number) => PADDING.top + chartH * (1 - (price - minP) / range);

            drawPhaseBg(ctx, historicalTicks, xOf, chartH);
            drawGrid(ctx, w, h, chartH, minP, maxP, range);
            if (entry > 0 && pos !== 'FLAT') drawEntryLine(ctx, w, chartW, entry, dp, pos, yOf);

            // Build points: all historical + live tip
            const prices = historicalTicks.map((t, i) =>
                i === historicalTicks.length - 1 ? dp : t.price
            );

            if (prices.length >= 2) {
                const rawPoints = prices.map((p, i) => ({ x: xOf(i), y: yOf(p) }));
                const SUB = 6;
                const interp: Array<{x: number; y: number}> = [];
                for (let i = 0; i < rawPoints.length - 1; i++) {
                    const p0 = rawPoints[Math.max(0, i - 1)];
                    const p1 = rawPoints[i];
                    const p2 = rawPoints[i + 1];
                    const p3 = rawPoints[Math.min(rawPoints.length - 1, i + 2)];
                    for (let s = 0; s < SUB; s++) {
                        const t = s / SUB;
                        const t2 = t * t, t3 = t2 * t;
                        interp.push({
                            x: 0.5 * ((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
                            y: 0.5 * ((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
                        });
                    }
                }
                interp.push(rawPoints[rawPoints.length - 1]);

                // Area fill
                ctx.beginPath();
                ctx.moveTo(interp[0].x, PADDING.top + chartH);
                for (const pt of interp) ctx.lineTo(pt.x, pt.y);
                ctx.lineTo(interp[interp.length - 1].x, PADDING.top + chartH);
                ctx.closePath();
                const grad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + chartH);
                grad.addColorStop(0, 'rgba(235,204,255,0.08)');
                grad.addColorStop(1, 'rgba(235,204,255,0.005)');
                ctx.fillStyle = grad; ctx.fill();

                // Line
                ctx.beginPath();
                ctx.moveTo(interp[0].x, interp[0].y);
                for (let i = 1; i < interp.length; i++) ctx.lineTo(interp[i].x, interp[i].y);
                ctx.strokeStyle = LINE_COLOR; ctx.lineWidth = 2.5;
                ctx.shadowColor = LINE_GLOW; ctx.shadowBlur = 8;
                ctx.stroke(); ctx.shadowBlur = 0;
            }

            dotRef.current.draw(ctx, xOf(prices.length - 1), yOf(dp), dp, w, DOT_RADIUS);
            drawFooter(ctx, w, h, historicalTicks[historicalTicks.length - 1]?.phase ?? '', allTicks.length);

        } else {
            // Candle mode
            const candleSize = tf === '3s' ? 3 : 5;
            const allCandles = aggregateCandles(processedTicks, candleSize);
            const maxCandles = Math.floor(chartW / 12);
            const visible = allCandles.slice(-maxCandles);
            if (visible.length === 0) { animRef.current = requestAnimationFrame(draw); return; }

            const allPrices = visible.flatMap(c => [c.high, c.low]);
            let minP = Math.min(...allPrices); let maxP = Math.max(...allPrices);
            if (entry > 0) { minP = Math.min(minP, entry); maxP = Math.max(maxP, entry); }
            const margin = (maxP - minP) * 0.12 || 1;
            minP -= margin; maxP += margin;
            const range = maxP - minP;

            const candleW = Math.max(4, chartW / visible.length - 2);
            const gap = (chartW - candleW * visible.length) / Math.max(visible.length - 1, 1);
            const xOf = (i: number) => PADDING.left + i * (candleW + gap);
            const yOf = (price: number) => PADDING.top + chartH * (1 - (price - minP) / range);

            drawGrid(ctx, w, h, chartH, minP, maxP, range);
            if (entry > 0 && pos !== 'FLAT') drawEntryLine(ctx, w, chartW, entry, dp, pos, yOf);

            for (let i = 0; i < visible.length; i++) {
                const candle = visible[i];
                const x = xOf(i);
                const isUp = candle.close >= candle.open;
                const color = isUp ? CANDLE_UP : CANDLE_DOWN;
                const wickX = x + candleW / 2;
                ctx.strokeStyle = color; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(wickX, yOf(candle.high)); ctx.lineTo(wickX, yOf(candle.low)); ctx.stroke();
                const bodyTop = yOf(isUp ? candle.close : candle.open);
                const bodyBot = yOf(isUp ? candle.open : candle.close);
                const bodyH = Math.max(1, bodyBot - bodyTop);
                ctx.fillStyle = color; ctx.globalAlpha = 0.85;
                roundRectFill(ctx, x, bodyTop, candleW, bodyH, 2);
                ctx.globalAlpha = 1;
            }

            const volHeight = chartH * 0.18;
            const volBase = PADDING.top + chartH;
            const volumes = visible.map(c => {
                const seed = ((c.startTick * 2654435761) >>> 0) / 4294967296;
                return (c.high - c.low) * (0.7 + seed * 0.6);
            });
            const maxVol = Math.max(...volumes, 0.01);
            for (let i = 0; i < visible.length; i++) {
                const x = xOf(i);
                const barH = (volumes[i] / maxVol) * volHeight;
                const isUp = visible[i].close >= visible[i].open;
                ctx.fillStyle = isUp ? 'rgba(109,213,160,0.15)' : 'rgba(246,184,208,0.15)';
                ctx.fillRect(x, volBase - barH, candleW, barH);
            }

            dotRef.current.draw(ctx, xOf(visible.length - 1) + candleW / 2, yOf(dp), dp, w, DOT_RADIUS);
            drawFooter(ctx, w, h, visible[visible.length - 1]?.phase ?? '', allTicks.length);
        }

        animRef.current = requestAnimationFrame(draw);
    }, []);

    useEffect(() => {
        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, [draw]);

    useEffect(() => {}, [ticks, entryPrice, positionStatus, timeframe, mirrorCursed, activeItemVFX, equity, startingCapital, currentPhase, frozen]);

    return (
        <div ref={containerRef} className="chart-container" style={{ position: 'relative' }}>
            <canvas ref={canvasRef} />

            <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', gap: 4, zIndex: 10 }}>
                {(['1s', '3s', '5s'] as Timeframe[]).map(tf => (
                    <button key={tf} onClick={() => setTimeframe(tf)} style={{
                        padding: '4px 12px', fontSize: '0.7rem',
                        fontFamily: "'Fredoka', sans-serif", fontWeight: 600,
                        border: '1px solid ' + (tf === timeframe ? 'rgba(235,204,255,0.35)' : 'rgba(235,204,255,0.1)'),
                        borderRadius: 8,
                        background: tf === timeframe ? 'rgba(235,204,255,0.12)' : 'rgba(255,255,255,0.04)',
                        color: tf === timeframe ? '#EBCCFF' : '#554d73',
                        cursor: 'pointer', transition: 'all 0.15s', backdropFilter: 'blur(4px)',
                    }}>{tf}</button>
                ))}
            </div>

            <ChartVFX
                frozen={frozen} mirrorCursed={mirrorCursed} shockwaveActive={shockwaveActive}
                blackoutActive={blackoutActive} timeWarpActive={timeWarpActive}
                thickSkinActive={thickSkinActive} activeItemVFX={activeItemVFX}
                chartCanvas={canvasRef.current}
            />

            <div style={{ position: 'absolute', top: 12, right: 84, display: 'flex', gap: 8, zIndex: 10 }}>
                {[0, 1].map((slot) => {
                    const item = items?.[slot];
                    return item ? (
                        <button key={slot} onClick={() => onUseItem?.(item.id)} disabled={!canUseItems} style={{
                            width: 52, height: 52, borderRadius: 14, border: '2px solid rgba(235,204,255,0.2)',
                            background: 'rgba(16,13,28,0.85)', backdropFilter: 'blur(8px)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.3)', cursor: canUseItems ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.6rem', transition: 'all 0.2s', opacity: canUseItems ? 1 : 0.5,
                        }} title={item.name + ' — click to use'}>{item.emoji}</button>
                    ) : (
                        <div key={slot} style={{ width: 52, height: 52, borderRadius: 14, border: '2px dashed rgba(235,204,255,0.1)', background: 'rgba(16,13,28,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: '#554d73' }}>—</div>
                    );
                })}
            </div>
        </div>
    );
}

function drawPhaseBg(ctx: CanvasRenderingContext2D, visible: PriceTick[], xOf: (i: number) => number, chartH: number) {
    let lastPhase = visible[0]?.phase ?? '';
    let phaseStart = 0;
    for (let i = 1; i <= visible.length; i++) {
        const phase = i < visible.length ? visible[i].phase : '';
        if (phase !== lastPhase || i === visible.length) {
            ctx.fillStyle = PHASE_BG[lastPhase] ?? 'transparent';
            ctx.fillRect(xOf(phaseStart), PADDING.top, xOf(Math.min(i - 1, visible.length - 1)) - xOf(phaseStart), chartH);
            phaseStart = i; lastPhase = phase;
        }
    }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, chartH: number, minP: number, maxP: number, range: number) {
    ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = PADDING.top + (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(PADDING.left, y); ctx.lineTo(w - PADDING.right, y); ctx.stroke();
        ctx.fillStyle = GRID_TEXT; ctx.font = '10px "Nunito", sans-serif'; ctx.textAlign = 'left';
        ctx.fillText((maxP - (range / 5) * i).toFixed(2), w - PADDING.right + 8, y + 3);
    }
}

function drawEntryLine(ctx: CanvasRenderingContext2D, w: number, chartW: number, entry: number, dp: number, pos: string, yOf: (p: number) => number) {
    const entryY = yOf(entry);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = ENTRY_LINE; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PADDING.left, entryY); ctx.lineTo(w - PADDING.right, entryY); ctx.stroke();
    ctx.restore();
    const lastY = yOf(dp);
    const isProfit = (pos === 'LONG' && dp > entry) || (pos === 'SHORT' && dp < entry);
    ctx.fillStyle = isProfit ? 'rgba(109,213,160,0.04)' : 'rgba(246,184,208,0.04)';
    ctx.fillRect(PADDING.left, Math.min(entryY, lastY), chartW, Math.abs(lastY - entryY));
    ctx.fillStyle = 'rgba(109,213,160,0.6)'; ctx.font = '9px "Nunito", sans-serif';
    ctx.fillText('ENTRY ' + entry.toFixed(2), w - PADDING.right + 8, entryY - 5);
}

function drawFooter(ctx: CanvasRenderingContext2D, w: number, h: number, phase: string, tickCount: number) {
    ctx.fillStyle = GRID_TEXT; ctx.font = '10px "Fredoka", sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(phase, PADDING.left + 4, h - 10);
    ctx.textAlign = 'right'; ctx.fillText('TICK ' + tickCount, w - PADDING.right, h - 10);
}

function roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); ctx.fill();
}
