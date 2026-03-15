/**
 * Chart Arena — Item Visual Effects
 * All effects are CSS overlays on top of the chart canvas.
 * Zero impact on the 60fps chart render loop.
 */
import { useEffect, useRef, useMemo } from 'react';
import '../styles/vfx.css';

export interface VFXProps {
    frozen?: boolean;
    mirrorCursed?: boolean;
    shockwaveActive?: boolean;
    blackoutActive?: boolean;
    timeWarpActive?: boolean;
    thickSkinActive?: boolean;
    activeItemVFX?: number | null;
    chartCanvas?: HTMLCanvasElement | null;
}

export function ChartVFX(props: VFXProps) {
    const { frozen, mirrorCursed, shockwaveActive, blackoutActive, timeWarpActive, thickSkinActive, activeItemVFX, chartCanvas } = props;
    return (
        <div className="vfx-layer">
            {activeItemVFX === 1 && <GhostVFX />}
            {thickSkinActive && <ShieldVFX />}
            {activeItemVFX === 3 && <ScalpVFX />}
            {activeItemVFX === 4 && <RadarVFX />}
            {activeItemVFX === 5 && <BoostVFX />}
            {frozen && <FreezeVFX />}
            {mirrorCursed && <MirrorVFX />}
            {activeItemVFX === 8 && <DrainVFX />}
            {activeItemVFX === 9 && <GlitchVFX />}
            {activeItemVFX === 10 && <SwapVFX />}
            {activeItemVFX === 11 && <NukeVFX />}
            {blackoutActive && <BlackoutVFX chartCanvas={chartCanvas} />}
            {shockwaveActive && <EarthquakeVFX />}
            {activeItemVFX === 14 && <HeistVFX />}
            {timeWarpActive && <TimeWarpVFX />}
        </div>
    );
}

/* ═══════════════════════════════════════
   SEED — deterministic random positions
   ═══════════════════════════════════════ */
function seeded(i: number, offset: number) {
    return ((i * 2654435761 + offset) >>> 0) / 4294967296;
}

/* ═══════════════════════════════════════
   T1: GHOST TRADE
   ═══════════════════════════════════════ */
function GhostVFX() {
    const partRef = useRef<HTMLDivElement>(null);
    useInterval(partRef, 800, (el) => {
        for (let i = 0; i < 6; i++) {
            const p = document.createElement('div');
            const x = Math.random() * 100, y = Math.random() * 100;
            const dx = (Math.random() - 0.5) * 80, dy = (Math.random() - 0.5) * 80 - 40;
            const sz = 2 + Math.random() * 5;
            Object.assign(p.style, { position: 'absolute', left: x + '%', top: y + '%', width: sz + 'px', height: sz + 'px', borderRadius: '50%', background: 'rgba(100,200,255,0.6)', boxShadow: `0 0 ${sz * 2}px rgba(100,200,255,0.4)`, ['--dx' as any]: dx + 'px', ['--dy' as any]: dy + 'px', animation: `ghostParticle ${1 + Math.random() * 2}s ease-out forwards` });
            el.appendChild(p); setTimeout(() => p.remove(), 3000);
        }
    });
    return (<>
        <div className="vfx-abs vfx-ghost-bg"><div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(100,200,255,0.06),transparent 40%,rgba(180,100,255,0.04),transparent 70%,rgba(100,200,255,0.05))' }} /></div>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="vfx-ghost-rift" style={{ position: 'absolute', top: 30 + seeded(i, 1) * 260, left: 10 + seeded(i, 2) * 500, width: 60 + seeded(i, 3) * 120, height: 2 + seeded(i, 4) * 4, background: 'linear-gradient(90deg,transparent,rgba(100,200,255,0.4),rgba(180,100,255,0.3),transparent)', boxShadow: '0 0 12px rgba(100,200,255,0.3)', animationDuration: (1.5 + seeded(i, 5) * 2) + 's', animationDelay: seeded(i, 6) * 2 + 's' }} />)}
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="vfx-ghost-wisp" style={{ position: 'absolute', left: seeded(i, 10) * 100 + '%', top: 30 + seeded(i, 11) * 50 + '%', width: 30 + seeded(i, 12) * 60, height: 3, background: 'linear-gradient(90deg,transparent,rgba(180,100,255,0.15),transparent)', borderRadius: 3, animationDuration: (2 + seeded(i, 13) * 3) + 's', animationDelay: seeded(i, 14) * 2 + 's' }} />)}
        <div ref={partRef} className="vfx-abs" />
        <div className="vfx-center vfx-ghost-label">👻 PHASING OUT</div>
    </>);
}

/* ═══════════════════════════════════════
   T1: SHIELD
   ═══════════════════════════════════════ */
function ShieldVFX() {
    const sparkRef = useRef<HTMLDivElement>(null);
    const rippleRef = useRef<HTMLDivElement>(null);
    useInterval(sparkRef, 600, (el) => {
        for (let i = 0; i < 5; i++) {
            const s = document.createElement('div');
            const edge = Math.floor(Math.random() * 4);
            let x: number, y: number;
            if (edge === 0) { x = Math.random() * 100; y = 0.5; } else if (edge === 1) { x = Math.random() * 100; y = 99; } else if (edge === 2) { x = 0.5; y = Math.random() * 100; } else { x = 99; y = Math.random() * 100; }
            const sx = (Math.random() - 0.5) * 40, sy = (Math.random() - 0.5) * 40;
            Object.assign(s.style, { position: 'absolute', left: x + '%', top: y + '%', width: '3px', height: '3px', background: '#ffd83d', borderRadius: '50%', boxShadow: '0 0 6px #ffd83d,0 0 12px rgba(255,200,60,0.5)', ['--sx' as any]: sx + 'px', ['--sy' as any]: sy + 'px', animation: 'sparkFly 0.4s ease-out forwards' });
            el.appendChild(s); setTimeout(() => s.remove(), 500);
        }
    });
    useInterval(rippleRef, 2000, (el) => {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', border: '2px solid rgba(255,200,60,0.4)', borderRadius: '50%', animation: 'shieldRipple 1.5s ease-out forwards' });
        el.appendChild(r); setTimeout(() => r.remove(), 1600);
    });
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center,rgba(255,220,60,0.06),transparent 60%)', animation: 'shieldFlash 0.5s ease-out' }} />
        <div style={{ position: 'absolute', inset: 3, border: '3px solid rgba(255,200,60,0.35)' }} className="vfx-shield-border" />
        <div style={{ position: 'absolute', inset: 8, border: '1px solid rgba(255,200,60,0.15)' }} />
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {Array.from({ length: 18 }, (_, i) => { const cx = 40 + seeded(i, 20) * 580, cy = 30 + seeded(i, 21) * 260, sz = 15 + seeded(i, 22) * 30; return <polygon key={i} points={hexPts(cx, cy, sz)} fill="none" stroke="rgba(255,200,60,0.25)" strokeWidth={1.5} className="vfx-shield-hex" style={{ animationDuration: (2 + seeded(i, 23) * 2) + 's', animationDelay: seeded(i, 24) * 2 + 's', transformOrigin: `${cx}px ${cy}px` }} />; })}
        </svg>
        <div ref={rippleRef} className="vfx-abs" />
        <div ref={sparkRef} className="vfx-abs" />
        <div className="vfx-label" style={{ background: 'linear-gradient(135deg,rgba(255,200,60,0.12),rgba(255,160,40,0.08))', border: '1.5px solid rgba(255,200,60,0.3)', color: 'rgba(255,220,80,0.8)', fontSize: '0.9rem', textShadow: '0 0 15px rgba(255,200,60,0.4)' }}>🛡 SHIELD ACTIVE</div>
    </>);
}

function hexPts(cx: number, cy: number, r: number) {
    let s = ''; for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 6; s += (cx + r * Math.cos(a)) + ',' + (cy + r * Math.sin(a)) + ' '; } return s.trim();
}

/* ═══════════════════════════════════════
   T1: SCALP
   ═══════════════════════════════════════ */
function ScalpVFX() {
    const boltRef = useRef<HTMLCanvasElement>(null);
    const sparkRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const c = boltRef.current; if (!c) return;
        const ctx = c.getContext('2d')!;
        const id = setInterval(() => {
            ctx.clearRect(0, 0, c.width, c.height);
            const x1 = 50 + Math.random() * 560, y1 = 10 + Math.random() * 30;
            const x2 = x1 + (Math.random() - 0.5) * 180, y2 = 310 - Math.random() * 30;
            drawBolt(ctx, x1, y1, x2, y2, 1.5, 'rgba(0,200,255,0.5)');
            drawBolt(ctx, x1 + 1, y1 + 1, x2 + 1, y2 + 1, 0.8, 'rgba(200,240,255,0.3)');
            setTimeout(() => ctx.clearRect(0, 0, c.width, c.height), 120);
        }, 600);
        return () => clearInterval(id);
    }, []);
    useInterval(sparkRef, 500, (el) => {
        for (let i = 0; i < 4; i++) {
            const s = document.createElement('div');
            const x = Math.random() * 100, y = Math.random() * 100;
            const sx = (Math.random() - 0.5) * 50, sy = (Math.random() - 0.5) * 50;
            Object.assign(s.style, { position: 'absolute', left: x + '%', top: y + '%', width: '2px', height: '2px', background: '#fff', borderRadius: '50%', boxShadow: '0 0 3px #0cf,0 0 6px rgba(0,200,255,0.4)', ['--sx' as any]: sx + 'px', ['--sy' as any]: sy + 'px', animation: 'sparkFly 0.5s ease-out forwards' });
            el.appendChild(s); setTimeout(() => s.remove(), 600);
        }
    });
    return (<>
        <div style={{ position: 'absolute', inset: 2, border: '2px solid rgba(0,180,255,0.12)' }} className="vfx-scalp-border" />
        <canvas ref={boltRef} width={660} height={320} className="vfx-canvas" />
        <div ref={sparkRef} className="vfx-abs" />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%,rgba(0,180,255,0.03),transparent 70%)' }} />
        <div className="vfx-label vfx-scalp-label" style={{ background: 'rgba(0,200,255,0.08)', border: '1px solid rgba(0,200,255,0.2)', color: 'rgba(0,220,255,0.7)' }}>⚡ SCALP MODE</div>
    </>);
}

function drawBolt(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, col: string) {
    ctx.beginPath(); ctx.moveTo(x1, y1);
    let px = x1, py = y1; const dx = x2 - x1, dy = y2 - y1, segs = 5 + Math.floor(Math.random() * 4);
    for (let i = 1; i < segs; i++) {
        const t = i / segs; px = x1 + dx * t + (Math.random() - 0.5) * 50; py = y1 + dy * t + (Math.random() - 0.5) * 30;
        ctx.lineTo(px, py);
        if (Math.random() > 0.7) { ctx.moveTo(px, py); ctx.lineTo(px + (Math.random() - 0.5) * 30, py + (Math.random() - 0.5) * 20); ctx.moveTo(px, py); }
    }
    ctx.lineTo(x2, y2); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
}

/* ═══════════════════════════════════════
   T1: RADAR
   ═══════════════════════════════════════ */
function RadarVFX() {
    const pingRef = useRef<HTMLDivElement>(null);
    const blipRef = useRef<HTMLDivElement>(null);
    const dataRef = useRef<HTMLDivElement>(null);
    useInterval(pingRef, 2500, (el) => {
        const p = document.createElement('div');
        Object.assign(p.style, { position: 'absolute', top: '50%', left: '50%', width: '80%', height: '80%', border: '2px solid rgba(0,255,140,0.4)', borderRadius: '50%', animation: 'radarPing 2s ease-out forwards' });
        el.appendChild(p); setTimeout(() => p.remove(), 2100);
    });
    useInterval(blipRef, 3000, (el) => {
        el.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const b = document.createElement('div');
            Object.assign(b.style, { position: 'absolute', left: (10 + Math.random() * 80) + '%', top: (10 + Math.random() * 80) + '%', width: '8px', height: '8px', background: 'rgba(0,255,140,0.7)', borderRadius: '50%', boxShadow: '0 0 6px rgba(0,255,140,0.5),0 0 12px rgba(0,255,140,0.3)', animation: 'blipPop 0.5s ease-out forwards' });
            el.appendChild(b);
        }
    });
    useInterval(dataRef, 200, (el) => {
        const d = document.createElement('div');
        d.textContent = Array.from({ length: 10 }, () => Math.random() > 0.5 ? '1' : '0').join('');
        Object.assign(d.style, { fontSize: '8px', fontFamily: 'monospace', color: 'rgba(0,255,140,0.6)', whiteSpace: 'nowrap', animation: 'dataStream 3s linear forwards', position: 'absolute', right: '0' });
        el.appendChild(d); setTimeout(() => d.remove(), 3100);
    });
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%,rgba(0,255,140,0.04),transparent 60%)' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: '200%', height: '200%', animation: 'radarSweep 3s linear infinite' }}>
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: '50%', height: '2px', transformOrigin: 'left center', background: 'linear-gradient(90deg,rgba(0,255,140,0.6),rgba(0,255,140,0))', boxShadow: '0 0 15px rgba(0,255,140,0.3)' }} />
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: '50%', height: '40px', transformOrigin: 'left center', transform: 'translateY(-20px)', background: 'linear-gradient(90deg,rgba(0,255,140,0.08),transparent)' }} />
        </div>
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <circle cx={330} cy={160} r={60} fill="none" stroke="rgba(0,255,140,0.08)" strokeWidth={1} />
            <circle cx={330} cy={160} r={120} fill="none" stroke="rgba(0,255,140,0.06)" strokeWidth={1} />
            <circle cx={330} cy={160} r={180} fill="none" stroke="rgba(0,255,140,0.04)" strokeWidth={1} />
            <line x1={330} y1={0} x2={330} y2={320} stroke="rgba(0,255,140,0.06)" strokeWidth={0.5} />
            <line x1={0} y1={160} x2={660} y2={160} stroke="rgba(0,255,140,0.06)" strokeWidth={0.5} />
        </svg>
        <div ref={pingRef} className="vfx-abs" />
        <div ref={blipRef} className="vfx-abs" />
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,transparent 5%,rgba(0,255,140,0.3),transparent 95%)', boxShadow: '0 0 8px rgba(0,255,140,0.2)', animation: 'scanLine 4s linear infinite' }} />
        </div>
        <div ref={dataRef} style={{ position: 'absolute', right: 20, top: 0, bottom: 0, width: 80, overflow: 'hidden', opacity: 0.4 }} />
        <div className="vfx-label" style={{ background: 'rgba(0,255,140,0.08)', border: '1px solid rgba(0,255,140,0.2)', color: 'rgba(0,255,140,0.7)', textShadow: '0 0 10px rgba(0,255,140,0.3)' }}>📡 SCANNING</div>
    </>);
}

/* ═══════════════════════════════════════
   T1: BOOST
   ═══════════════════════════════════════ */
function BoostVFX() {
    const trailRef = useRef<HTMLDivElement>(null);
    const starRef = useRef<HTMLDivElement>(null);
    const sparkRef = useRef<HTMLDivElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    useInterval(trailRef, 150, (el) => {
        for (let i = 0; i < 4; i++) {
            const t = document.createElement('div');
            const x = 80 + Math.random() * 500, w = 2 + Math.random() * 3;
            Object.assign(t.style, { position: 'absolute', left: x + 'px', top: '-20px', width: w + 'px', height: (20 + Math.random() * 40) + 'px', background: `linear-gradient(180deg,rgba(0,255,100,0.5),rgba(0,255,100,0))`, borderRadius: w + 'px', animation: `rocketTrail ${0.4 + Math.random() * 0.4}s linear forwards` });
            el.appendChild(t); setTimeout(() => t.remove(), 900);
        }
    });
    useInterval(starRef, 100, (el) => {
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('div');
            Object.assign(s.style, { position: 'absolute', left: Math.random() * 100 + '%', top: '-10px', width: (1 + Math.random() * 2) + 'px', height: (8 + Math.random() * 20) + 'px', background: 'rgba(255,255,255,0.3)', borderRadius: '1px', animation: `starStreak ${0.3 + Math.random() * 0.5}s linear forwards` });
            el.appendChild(s); setTimeout(() => s.remove(), 900);
        }
    });
    useInterval(sparkRef, 200, (el) => {
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('div');
            Object.assign(s.style, { position: 'absolute', left: (30 + Math.random() * 40) + '%', top: (60 + Math.random() * 30) + '%', width: '4px', height: '4px', background: '#0f8', borderRadius: '50%', boxShadow: '0 0 4px #0f8,0 0 8px rgba(0,255,100,0.4)', transition: 'all 0.3s ease-out' });
            el.appendChild(s);
            setTimeout(() => { s.style.transform = `translate(${(Math.random() - 0.5) * 50}px,${-20 - Math.random() * 40}px)`; s.style.opacity = '0'; }, 20);
            setTimeout(() => s.remove(), 400);
        }
    });
    useInterval(ringRef, 1800, (el) => {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'absolute', top: '70%', left: '50%', width: '200px', height: '200px', border: '2px solid rgba(0,255,100,0.3)', borderRadius: '50%', animation: 'pulseRing 1.5s ease-out forwards' });
        el.appendChild(r); setTimeout(() => r.remove(), 1600);
    });
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 80%,rgba(0,255,100,0.06),transparent 60%)', animation: 'boostFlash 0.4s ease-out' }} />
        <div style={{ position: 'absolute', inset: 2, animation: 'powerAura 1s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, borderBottom: '4px solid rgba(0,255,100,0.3)', borderLeft: '2px solid rgba(0,255,100,0.1)', borderRight: '2px solid rgba(0,255,100,0.1)', animation: 'glowPulse 0.8s ease-in-out infinite' }} />
        <div ref={trailRef} className="vfx-abs" />
        <div ref={starRef} className="vfx-abs" />
        <div ref={sparkRef} className="vfx-abs" />
        <div ref={ringRef} className="vfx-abs" />
        <div className="vfx-center" style={{ fontSize: '3rem', color: 'rgba(0,255,100,0.6)', textShadow: '0 0 30px rgba(0,255,100,0.4),0 0 60px rgba(0,255,100,0.2)', animation: 'glowPulse 0.6s ease-in-out infinite', letterSpacing: 4 }}>🚀 x1.5</div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(0deg,rgba(0,255,100,0.06),transparent)' }} />
    </>);
}

/* ═══════════════════════════════════════
   T2: FREEZE
   ═══════════════════════════════════════ */
function FreezeVFX() {
    const cracks = useMemo(() => Array.from({ length: 8 }, (_, i) => {
        let x = seeded(i, 30) * 660, y = seeded(i, 31) * 320;
        let d = `M${x} ${y}`;
        for (let j = 0; j < 4 + Math.floor(seeded(i, 32 + j) * 4); j++) {
            x += (seeded(i, 40 + j * 2) - 0.5) * 80; y += (seeded(i, 41 + j * 2) - 0.5) * 60;
            d += ` L${x} ${y}`;
            if (seeded(i, 50 + j) > 0.5) d += ` M${x} ${y} L${x + (seeded(i, 60 + j) - 0.5) * 40} ${y + (seeded(i, 61 + j) - 0.5) * 30} M${x} ${y}`;
        }
        return d;
    }), []);
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(77,201,246,0.08),rgba(168,230,255,0.03) 30%,transparent 60%,rgba(77,201,246,0.04))' }} />
        <div style={{ position: 'absolute', inset: 3, border: '4px solid rgba(77,201,246,0.2)' }} className="vfx-freeze-border" />
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {cracks.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(168,230,255,0.3)" strokeWidth={1} strokeDasharray={200} style={{ animation: `iceCrack 2s ease-out ${seeded(i, 70) * 2}s forwards` }} />)}
        </svg>
        {Array.from({ length: 12 }, (_, i) => {
            const edge = Math.floor(seeded(i, 80) * 4);
            const x = edge < 2 ? seeded(i, 81) * 100 : edge === 2 ? 0 : 95;
            const y = edge >= 2 ? seeded(i, 82) * 100 : edge === 0 ? 0 : 90;
            const sz = 20 + seeded(i, 83) * 40;
            return <div key={i} style={{ position: 'absolute', left: x + '%', top: y + '%', width: sz, height: sz, background: 'radial-gradient(circle,rgba(168,230,255,0.15),transparent 70%)', borderRadius: '50%', opacity: 0, animation: `frostGrow 1s ease-out ${seeded(i, 84) * 1.5}s forwards` }} />;
        })}
        {Array.from({ length: 20 }, (_, i) => <div key={i} className="vfx-snow" style={{ left: (i * 5 + seeded(i, 90) * 3) % 100 + '%', width: 2 + (i % 4) * 1.5, height: 2 + (i % 4) * 1.5, opacity: 0.3 + seeded(i, 91) * 0.3, boxShadow: `0 0 ${3 + (i % 3) * 2}px rgba(168,230,255,0.2)`, animationDuration: (4 + seeded(i, 92) * 7) + 's', animationDelay: seeded(i, 93) * 8 + 's' }} />)}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 40%,rgba(77,201,246,0.06) 100%)' }} />
        <div className="vfx-center vfx-freeze-label" style={{ fontSize: '1.8rem', color: 'rgba(77,201,246,0.6)', letterSpacing: 8 }}>🧊 FROZEN</div>
    </>);
}

/* ═══════════════════════════════════════
   T2: MIRROR CURSE
   ═══════════════════════════════════════ */
function MirrorVFX() {
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(180,100,255,0.03)' }} />
        {Array.from({ length: 5 }, (_, i) => <div key={i} style={{ position: 'absolute', top: 20 + seeded(i, 100) * 280, left: 0, right: 0, height: 3 + seeded(i, 101) * 15, background: 'linear-gradient(90deg,rgba(255,60,60,0.06),rgba(180,100,255,0.08),rgba(60,60,255,0.06))', transform: `translateX(${(seeded(i, 102) - 0.5) * 20}px)` }} />)}
        {Array.from({ length: 3 }, (_, i) => <div key={'l' + i} style={{ position: 'absolute', top: seeded(i, 103) * 320, left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />)}
        {Array.from({ length: 8 }, (_, i) => <div key={'s' + i} style={{ position: 'absolute', left: seeded(i, 110) * 620, top: seeded(i, 111) * 280, width: 10 + seeded(i, 112) * 25, height: (10 + seeded(i, 112) * 25) * 0.6, background: 'linear-gradient(135deg,rgba(180,100,255,0.1),rgba(255,255,255,0.05))', border: '1px solid rgba(180,100,255,0.15)', clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)', animation: `shardFloat ${3 + seeded(i, 113) * 3}s ease-in-out ${seeded(i, 114) * 2}s infinite` }} />)}
        <div style={{ position: 'absolute', inset: 2, border: '2px solid rgba(180,100,255,0.15)', animation: 'mirrorFlip 4s steps(1) infinite' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 50%,rgba(180,100,255,0.05) 100%)' }} />
        <div className="vfx-label" style={{ background: 'rgba(180,100,255,0.1)', border: '1px solid rgba(180,100,255,0.25)', color: 'rgba(180,100,255,0.7)', letterSpacing: 3, animation: 'mirrorGlitch 0.3s steps(3) infinite' }}>🪞 MIRROR CURSE</div>
    </>);
}

/* ═══════════════════════════════════════
   T2: DRAIN
   ═══════════════════════════════════════ */
function DrainVFX() {
    const dripRef = useRef<HTMLDivElement>(null);
    const soulRef = useRef<HTMLDivElement>(null);
    useInterval(dripRef, 400, (el) => {
        for (let i = 0; i < 3; i++) {
            const d = document.createElement('div');
            const x = Math.random() * 100, w = 2 + Math.random() * 3;
            Object.assign(d.style, { position: 'absolute', left: x + '%', top: '-10px', width: w + 'px', height: (15 + Math.random() * 20) + 'px', background: 'linear-gradient(180deg,rgba(180,20,60,0.5),rgba(180,20,60,0))', borderRadius: `0 0 ${w}px ${w}px`, animation: `bloodDrip ${1.5 + Math.random() * 2}s linear forwards` });
            el.appendChild(d); setTimeout(() => d.remove(), 3500);
        }
    });
    useInterval(soulRef, 450, (el) => {
        for (let i = 0; i < 5; i++) {
            const s = document.createElement('div');
            const angle = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 140;
            const sx = Math.cos(angle) * dist, sy = Math.sin(angle) * dist;
            const sz = 5 + Math.random() * 8;
            Object.assign(s.style, { position: 'absolute', left: '50%', top: '50%', width: sz + 'px', height: sz + 'px', background: 'radial-gradient(circle,rgba(255,40,60,0.8),rgba(180,20,40,0.4))', borderRadius: '50%', animation: `bloodDot 0.6s ease-in-out infinite,soulPull ${0.7 + Math.random() * 0.8}s ease-in forwards`, ['--sx' as any]: sx + 'px', ['--sy' as any]: sy + 'px' });
            el.appendChild(s); setTimeout(() => s.remove(), 1600);
        }
    });
    const veins = useMemo(() => Array.from({ length: 10 }, (_, i) => {
        const edge = Math.floor(seeded(i, 120) * 4);
        let x1: number, y1: number;
        if (edge === 0) { x1 = seeded(i, 121) * 660; y1 = 0; } else if (edge === 1) { x1 = seeded(i, 121) * 660; y1 = 320; } else if (edge === 2) { x1 = 0; y1 = seeded(i, 121) * 320; } else { x1 = 660; y1 = seeded(i, 121) * 320; }
        let d = `M${x1} ${y1}`, px = x1, py = y1;
        for (let j = 0; j < 3 + Math.floor(seeded(i, 122 + j) * 3); j++) {
            const tx = 330 + (seeded(i, 130 + j * 2) - 0.5) * 200, ty = 160 + (seeded(i, 131 + j * 2) - 0.5) * 100;
            d += ` Q${px + (tx - px) * 0.3 + (seeded(i, 140 + j) - 0.5) * 60} ${py + (ty - py) * 0.3 + (seeded(i, 141 + j) - 0.5) * 60} ${tx} ${ty}`;
            px = tx; py = ty;
        }
        return d;
    }), []);
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%,rgba(180,20,60,0.06),transparent 60%)', animation: 'drainPulse 1s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(180,20,60,0.15)' }} />
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {veins.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(180,20,60,0.2)" strokeWidth={1.5} style={{ animation: `veinPulse ${1 + seeded(i, 150) * 1.5}s ease-in-out ${seeded(i, 151) * 2}s infinite` }} />)}
        </svg>
        <div ref={dripRef} className="vfx-abs" />
        <div ref={soulRef} className="vfx-abs" />
        <div className="vfx-center" style={{ animation: 'heartbeat 1s ease-in-out infinite', fontSize: '1.6rem', color: 'rgba(180,20,60,0.6)', letterSpacing: 6, textShadow: '0 0 20px rgba(180,20,60,0.4)' }}>🩸 DRAINING</div>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.15) 100%)' }} />
    </>);
}

/* ═══════════════════════════════════════
   T2: GLITCH
   ═══════════════════════════════════════ */
function GlitchVFX() {
    const noiseRef = useRef<HTMLCanvasElement>(null);
    const sliceRef = useRef<HTMLDivElement>(null);
    const scanRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const c = noiseRef.current; if (!c) return;
        const ctx = c.getContext('2d')!;
        let id: number;
        function draw() { const img = ctx.createImageData(165, 80); for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 80; img.data[i] = v; img.data[i + 1] = v * 0.7; img.data[i + 2] = v; img.data[i + 3] = 200; } ctx.putImageData(img, 0, 0); id = requestAnimationFrame(draw); }
        draw(); return () => cancelAnimationFrame(id);
    }, []);
    useInterval(sliceRef, 300, (el) => {
        el.innerHTML = '';
        for (let i = 0; i < 6; i++) { const y = Math.random() * 100, h = 2 + Math.random() * 20, off = (Math.random() - 0.5) * 30;
            const s = document.createElement('div'); Object.assign(s.style, { position: 'absolute', top: y + '%', left: 0, right: 0, height: h + 'px', background: 'linear-gradient(90deg,rgba(255,0,100,0.06),rgba(0,255,200,0.04))', transform: `translateX(${off}px)` }); el.appendChild(s);
        }
        for (let i = 0; i < 3; i++) { const l = document.createElement('div'); Object.assign(l.style, { position: 'absolute', top: Math.random() * 100 + '%', left: 0, right: 0, height: '1px', background: `rgba(${Math.random() > 0.5 ? '255,0,100' : '0,255,200'},0.1)` }); el.appendChild(l); }
    });
    useInterval(scanRef, 800, (el) => {
        const s = document.createElement('div'); Object.assign(s.style, { position: 'absolute', left: 0, right: 0, height: '20px', background: 'linear-gradient(180deg,transparent,rgba(0,255,150,0.06),rgba(255,0,100,0.04),transparent)', animation: 'corruptScan 1s linear forwards' });
        el.appendChild(s); setTimeout(() => s.remove(), 1100);
    });
    return (<>
        <canvas ref={noiseRef} width={165} height={80} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', animation: 'staticFlash 0.5s steps(1) infinite', mixBlendMode: 'screen' }} />
        <div ref={sliceRef} className="vfx-abs" />
        <div ref={scanRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />
        {Array.from({ length: 3 }, (_, i) => <div key={i} style={{ position: 'absolute', left: seeded(i, 160) * 560, top: seeded(i, 161) * 290, fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,60,80,0.5)', fontWeight: 700, animation: `errorBlink ${0.5 + seeded(i, 162) * 1}s steps(1) infinite ${seeded(i, 163) * 2}s` }}>{['ERR_0x4F', 'CORRUPT', 'SEGFAULT'][i]}</div>)}
        <div className="vfx-label" style={{ background: 'rgba(0,255,150,0.08)', border: '1px solid rgba(0,255,150,0.2)', color: 'rgba(0,255,150,0.7)' }}>👾 GLITCHED</div>
    </>);
}

/* ═══════════════════════════════════════
   T2: SWAP
   ═══════════════════════════════════════ */
function SwapVFX() {
    const trailRef = useRef<HTMLDivElement>(null);
    const spiralRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = trailRef.current; if (!el) return;
        let frame = 0, id: number;
        function loop() {
            if (!el) return;
            frame++;
            const a1 = (frame * 3) * Math.PI / 180, a2 = a1 + Math.PI, r = 100;
            for (const [angle, col] of [[a1, 'rgba(255,180,0,0.3)'], [a2, 'rgba(0,180,255,0.3)']] as const) {
                const t = document.createElement('div');
                Object.assign(t.style, { position: 'absolute', left: `calc(50% + ${Math.cos(angle) * r}px)`, top: `calc(50% + ${Math.sin(angle) * r}px)`, width: '6px', height: '6px', background: col, borderRadius: '50%', animation: 'trailFade 0.6s ease-out forwards' });
                el.appendChild(t); setTimeout(() => t.remove(), 700);
            }
            id = requestAnimationFrame(loop);
        }
        loop(); return () => cancelAnimationFrame(id);
    }, []);
    useInterval(spiralRef, 1200, (el) => {
        const s = document.createElement('div');
        const col = Math.random() > 0.5 ? 'rgba(255,180,0,0.15)' : 'rgba(0,180,255,0.15)';
        Object.assign(s.style, { position: 'absolute', top: '50%', left: '50%', width: '200px', height: '200px', border: `2px solid ${col}`, borderRadius: '50%', borderTopColor: 'transparent', borderLeftColor: 'transparent', animation: 'spiralGrow 1.5s ease-out forwards' });
        el.appendChild(s); setTimeout(() => s.remove(), 1600);
    });
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(255,180,0,0.03),transparent 50%,rgba(0,180,255,0.03))' }} />
        <div style={{ position: 'absolute', inset: 0, animation: 'swapPulse 2s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,180,0,0.7)', boxShadow: '0 0 12px rgba(255,180,0,0.5)', animation: 'orbitA 2s linear infinite' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,180,255,0.7)', boxShadow: '0 0 12px rgba(0,180,255,0.5)', animation: 'orbitB 2s linear infinite' }} />
        <div ref={trailRef} className="vfx-abs" />
        <div ref={spiralRef} className="vfx-abs" />
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <ellipse cx={330} cy={160} rx={100} ry={60} fill="none" stroke="rgba(255,180,0,0.1)" strokeWidth={1} strokeDasharray="8 4" />
            <ellipse cx={330} cy={160} rx={130} ry={80} fill="none" stroke="rgba(0,180,255,0.08)" strokeWidth={1} strokeDasharray="6 6" />
        </svg>
        <div className="vfx-label" style={{ background: 'linear-gradient(135deg,rgba(255,180,0,0.08),rgba(0,180,255,0.08))', border: '1px solid rgba(255,200,50,0.2)', color: 'rgba(255,220,80,0.7)' }}>🔄 SWAPPING</div>
    </>);
}

/* ═══════════════════════════════════════
   T3: NUKE
   ═══════════════════════════════════════ */
function NukeVFX() {
    const stageRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = stageRef.current?.parentElement?.parentElement; // chart-container
        if (!el) return;
        let intensity = 14, frames = 0;
        const shk = setInterval(() => {
            if (frames > 40) { clearInterval(shk); el.style.transform = ''; return; }
            el.style.transform = `translate(${(Math.random() - 0.5) * intensity}px,${(Math.random() - 0.5) * intensity}px)`;
            intensity *= 0.94; frames++;
        }, 16);
        return () => { clearInterval(shk); el.style.transform = ''; };
    }, []);
    const debrisRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = debrisRef.current; if (!el) return;
        const t = setTimeout(() => {
            for (let i = 0; i < 25; i++) {
                const d = document.createElement('div');
                const angle = Math.random() * Math.PI * 2, dist = 150 + Math.random() * 200;
                const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
                const sz = 2 + Math.random() * 5;
                const col = Math.random() > 0.5 ? 'rgba(255,150,30,0.7)' : 'rgba(255,80,20,0.6)';
                Object.assign(d.style, { position: 'absolute', left: '50%', top: '50%', width: sz + 'px', height: sz + 'px', background: col, borderRadius: Math.random() > 0.5 ? '50%' : '0', boxShadow: `0 0 ${sz * 2}px ${col}`, ['--dx' as any]: dx + 'px', ['--dy' as any]: dy + 'px', animation: `debrisfly ${0.5 + Math.random() * 1}s ease-out forwards` });
                el.appendChild(d);
            }
        }, 150);
        return () => clearTimeout(t);
    }, []);
    return (<div ref={stageRef}>
        <div style={{ position: 'absolute', inset: 0, background: 'white', animation: 'nukeWhite 0.3s ease-out forwards', zIndex: 10 }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,200,50,0.8),rgba(255,100,20,0.5),rgba(200,30,0,0.3),transparent)', animation: 'fireball 1s ease-out 0.1s forwards', opacity: 0, zIndex: 9 }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,160,40,0.4),rgba(255,80,20,0.2),transparent 70%)', animation: 'mushroom 1.5s ease-out 0.1s forwards', opacity: 0, zIndex: 8 }} />
        {[0, 1, 2].map(i => <div key={i} style={{ position: 'absolute', top: '50%', left: '50%', width: 100, height: 100, border: `3px solid rgba(255,${150 - i * 40},${40 - i * 10},0.5)`, borderRadius: '50%', animation: `nukeRing 1.2s ease-out ${0.2 + i * 0.2}s forwards`, opacity: 0 }} />)}
        <div ref={debrisRef} className="vfx-abs" />
        {Array.from({ length: 15 }, (_, i) => <div key={i} style={{ position: 'absolute', left: (i * 7) % 100 + '%', top: '-10px', width: 1 + seeded(i, 170) * 3, height: 1 + seeded(i, 170) * 3, background: 'rgba(180,140,100,0.3)', borderRadius: '50%', animation: `ashFall ${2 + seeded(i, 171) * 4}s linear ${0.6 + seeded(i, 172) * 3}s infinite` }} />)}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,80,20,0.08),transparent 80%)', transition: 'opacity 2s', opacity: 0, animation: 'nukeWhite 2s ease-out 0.5s reverse forwards' }} />
    </div>);
}

/* ═══════════════════════════════════════
   T3: BLACKOUT
   ═══════════════════════════════════════ */
function BlackoutVFX({ chartCanvas }: { chartCanvas?: HTMLCanvasElement | null }) {
    const noiseRef = useRef<HTMLCanvasElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const c = noiseRef.current; if (!c) return;
        const ctx = c.getContext('2d')!;
        let id: number, frame = 0;
        function draw() {
            const img = ctx.createImageData(220, 107);
            for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 50; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + Math.random() * 10; img.data[i + 3] = 230; }
            for (let y = 0; y < 107; y += 2) for (let x = 0; x < 220; x++) { const idx = (y * 220 + x) * 4; img.data[idx + 3] = Math.max(0, img.data[idx + 3] - 50); }
            ctx.putImageData(img, 0, 0);
            frame++; id = requestAnimationFrame(draw);
        }
        draw(); return () => cancelAnimationFrame(id);
    }, []);
    useEffect(() => {
        const el = ghostRef.current;
        if (!el || !chartCanvas) return;
        const id = setInterval(() => {
            el.style.opacity = '0.12';
            setTimeout(() => { el.style.opacity = '0'; }, 80 + Math.random() * 40);
        }, 3000 + Math.random() * 2000);
        return () => clearInterval(id);
    }, [chartCanvas]);
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: '#0c0a18', animation: 'boFlicker 1s steps(1) forwards', zIndex: 5 }} />
        <canvas ref={noiseRef} width={220} height={107} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', zIndex: 6, animation: 'staticJitter 0.1s steps(2) infinite' }} />
        {chartCanvas && <div ref={ghostRef} style={{ position: 'absolute', inset: 0, zIndex: 7, opacity: 0, transition: 'opacity 0.05s' }}>
            <img src={chartCanvas.toDataURL()} style={{ width: '100%', height: '100%', filter: 'brightness(0.3) contrast(2) hue-rotate(180deg)' }} />
        </div>}
        {Array.from({ length: 5 }, (_, i) => <div key={i} style={{ position: 'absolute', left: 0, right: 0, height: 1, top: seeded(i, 180) * 100 + '%', background: 'rgba(255,255,255,0.06)', zIndex: 7 }} />)}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translateX(-50%)', zIndex: 8, fontSize: '1.4rem', fontWeight: 700, color: 'rgba(255,255,255,0.15)', fontFamily: "'Chakra Petch',sans-serif", letterSpacing: 8, animation: 'signalGlitch 0.2s steps(3) infinite', whiteSpace: 'nowrap' }}>📡 SIGNAL LOST</div>
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 3, zIndex: 8 }}>
            {[8, 12, 16, 20, 24].map((h, i) => <div key={i} style={{ width: 4, height: h, background: `rgba(255,${i < 2 ? '60,60' : '255,255'},${i < 2 ? 0.5 : 0.1})` }} />)}
        </div>
    </>);
}

/* ═══════════════════════════════════════
   T3: EARTHQUAKE
   ═══════════════════════════════════════ */
function EarthquakeVFX() {
    const dustRef = useRef<HTMLDivElement>(null);
    const rubRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = dustRef.current?.parentElement?.parentElement;
        if (!el) return;
        const id = setInterval(() => { el.style.transform = `translate(${(Math.random() - 0.5) * 10}px,${(Math.random() - 0.5) * 10}px)`; }, 16);
        return () => { clearInterval(id); el.style.transform = ''; };
    }, []);
    useInterval(dustRef, 300, (el) => {
        for (let i = 0; i < 5; i++) {
            const d = document.createElement('div');
            const sz = 3 + Math.random() * 6, sp = 2 + Math.random() * 4;
            Object.assign(d.style, { position: 'absolute', left: Math.random() * 100 + '%', bottom: '0', width: sz + 'px', height: sz + 'px', background: 'rgba(180,140,80,0.4)', borderRadius: '50%', boxShadow: `0 0 ${sz * 2}px rgba(180,140,80,0.2)`, animation: `dustRise ${sp}s linear forwards` });
            el.appendChild(d); setTimeout(() => d.remove(), sp * 1000 + 100);
        }
    });
    useInterval(rubRef, 500, (el) => {
        for (let i = 0; i < 3; i++) {
            const r = document.createElement('div');
            const sz = 3 + Math.random() * 8, sp = 1 + Math.random() * 2;
            Object.assign(r.style, { position: 'absolute', left: Math.random() * 100 + '%', top: '-20px', width: sz + 'px', height: (sz * 0.7) + 'px', background: 'rgba(120,100,70,0.5)', ['--rot' as any]: Math.random() * 720 + 'deg', animation: `rubbleFall ${sp}s linear forwards` });
            el.appendChild(r); setTimeout(() => r.remove(), sp * 1000 + 100);
        }
    });
    const cracks = useMemo(() => Array.from({ length: 6 }, (_, i) => {
        let x = 200 + seeded(i, 190) * 260, y = 100 + seeded(i, 191) * 120;
        let d = `M${x} ${y}`;
        for (let j = 0; j < 5 + Math.floor(seeded(i, 192 + j) * 4); j++) {
            x += (seeded(i, 200 + j * 2) - 0.5) * 100; y += (seeded(i, 201 + j * 2) - 0.5) * 70;
            d += ` L${x} ${y}`;
            if (seeded(i, 210 + j) > 0.5) d += ` M${x} ${y} L${x + (seeded(i, 220 + j) - 0.5) * 50} ${y + (seeded(i, 221 + j) - 0.5) * 40} M${x} ${y}`;
        }
        return d;
    }), []);
    return (<>
        <div style={{ position: 'absolute', inset: 0, animation: 'quakeVignette 1.5s ease-in-out infinite' }} />
        <svg viewBox="0 0 660 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {cracks.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(255,120,40,0.35)" strokeWidth={2} strokeDasharray={200} style={{ animation: `crackGrow 1.5s ease-out ${i * 0.3}s forwards` }} />)}
        </svg>
        <div ref={dustRef} className="vfx-abs" />
        <div ref={rubRef} className="vfx-abs" />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', background: 'linear-gradient(0deg,rgba(255,60,10,0.06),rgba(255,120,40,0.02),transparent)', animation: 'lavaGlow 2s ease-in-out infinite' }} />
        <div className="vfx-label" style={{ background: 'rgba(255,80,30,0.12)', border: '1.5px solid rgba(255,80,30,0.3)', color: 'rgba(255,120,40,0.8)', fontSize: '0.9rem', textShadow: '0 0 15px rgba(255,80,30,0.4)' }}>🌋 EARTHQUAKE ×5</div>
    </>);
}

/* ═══════════════════════════════════════
   T3: HEIST
   ═══════════════════════════════════════ */
function HeistVFX() {
    const coinRef = useRef<HTMLDivElement>(null);
    const fpRef = useRef<HTMLDivElement>(null);
    const countRef = useRef<HTMLDivElement>(null);
    useInterval(coinRef, 600, (el) => {
        for (let i = 0; i < 5; i++) {
            const c = document.createElement('div');
            const sx = (Math.random() - 0.5) * 60, sy = (Math.random() - 0.5) * 60;
            const tx = (Math.random() - 0.5) * 280, ty = -80 - Math.random() * 120;
            const sz = 8 + Math.random() * 6;
            Object.assign(c.style, { position: 'absolute', left: '50%', top: '50%', width: sz + 'px', height: sz + 'px', borderRadius: '50%', background: 'linear-gradient(135deg,#ffd700,#daa520)', boxShadow: '0 0 6px rgba(255,215,0,0.5),0 0 14px rgba(255,180,0,0.3)', ['--sx' as any]: sx + 'px', ['--sy' as any]: sy + 'px', ['--tx' as any]: tx + 'px', ['--ty' as any]: ty + 'px', animation: `coinFly ${0.7 + Math.random() * 0.9}s ease-out forwards` });
            el.appendChild(c); setTimeout(() => c.remove(), 2000);
        }
    });
    useInterval(fpRef, 2000, (el) => {
        const f = document.createElement('div');
        f.innerHTML = `<svg width="40" height="50" viewBox="0 0 40 50"><ellipse cx="20" cy="25" rx="12" ry="16" fill="none" stroke="rgba(212,185,120,0.2)" stroke-width="1"/><ellipse cx="20" cy="25" rx="8" ry="11" fill="none" stroke="rgba(212,185,120,0.15)" stroke-width="1"/><ellipse cx="20" cy="25" rx="4" ry="6" fill="none" stroke="rgba(212,185,120,0.1)" stroke-width="1"/></svg>`;
        Object.assign(f.style, { position: 'absolute', left: Math.random() * 90 + '%', top: Math.random() * 85 + '%', animation: 'fingerprint 3s ease-in-out forwards' });
        el.appendChild(f); setTimeout(() => f.remove(), 3100);
    });
    useEffect(() => {
        const el = countRef.current; if (!el) return;
        let stolen = 0;
        const id = setInterval(() => {
            stolen += Math.floor(Math.random() * 200) + 50;
            el.innerHTML = `<div style="font-size:8px;color:rgba(212,185,120,0.3);letter-spacing:1px">STOLEN</div><div style="font-size:16px;font-weight:700;color:rgba(255,215,0,0.6);font-family:'Chakra Petch',sans-serif">$${stolen.toLocaleString()}</div>`;
        }, 400);
        return () => clearInterval(id);
    }, []);
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(0,0,0,0.15),transparent 30%,transparent 70%,rgba(0,0,0,0.15))' }} />
        <div style={{ position: 'absolute', inset: 2, border: '2px solid rgba(212,185,120,0.1)', animation: 'heistPulse 1.5s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 80, background: 'linear-gradient(90deg,transparent,rgba(255,255,200,0.05),transparent)', animation: 'spotlightSweep 4s linear infinite' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 50, background: 'linear-gradient(90deg,transparent,rgba(255,255,200,0.03),transparent)', animation: 'spotlightSweep 6s linear 2s infinite' }} />
        </div>
        <div ref={coinRef} className="vfx-abs" />
        <div ref={fpRef} className="vfx-abs" />
        <div ref={countRef} style={{ position: 'absolute', right: 30, top: 30, fontFamily: 'monospace', zIndex: 8 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.12) 100%)' }} />
        <div className="vfx-center" style={{ fontSize: '1.6rem', color: 'rgba(212,185,120,0.5)', letterSpacing: 6, textShadow: '0 0 20px rgba(212,185,120,0.3)' }}>💰 HEIST IN PROGRESS</div>
    </>);
}

/* ═══════════════════════════════════════
   T3: TIME WARP (from earlier preview)
   ═══════════════════════════════════════ */
function TimeWarpVFX() {
    const lineRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = lineRef.current; if (!c) return;
        const ctx = c.getContext('2d')!;
        let offset = 0, id: number;
        function draw() {
            ctx.clearRect(0, 0, 640, 300);
            ctx.strokeStyle = 'rgba(200,180,255,0.5)'; ctx.lineWidth = 1;
            for (let i = 0; i < 20; i++) {
                const y = (i * 32 + offset) % 340 - 20;
                ctx.beginPath(); ctx.moveTo(640, y - 40); ctx.lineTo(0, y + 40); ctx.stroke();
            }
            offset = (offset + 3) % 340;
            id = requestAnimationFrame(draw);
        }
        draw(); return () => cancelAnimationFrame(id);
    }, []);
    return (<>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(146,120,255,0.04)' }} />
        <canvas ref={lineRef} width={640} height={300} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.12 }} />
        <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(146,120,255,0.15)' }} />
        <div className="vfx-label" style={{ background: 'rgba(146,120,255,0.1)', border: '1px solid rgba(146,120,255,0.2)', color: 'rgba(146,120,255,0.7)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', animation: 'radarSweep 1s linear infinite', transformOrigin: 'center' }}>⏳</span> TIME WARP ×3
        </div>
    </>);
}

/* ═══════════════════════════════════════
   HELPER: useInterval for particle spawning
   ═══════════════════════════════════════ */
function useInterval(ref: React.RefObject<HTMLDivElement | null>, ms: number, fn: (el: HTMLDivElement) => void) {
    useEffect(() => {
        const el = ref.current; if (!el) return;
        fn(el); // initial spawn
        const id = setInterval(() => fn(el), ms);
        return () => clearInterval(id);
    }, []);
}
