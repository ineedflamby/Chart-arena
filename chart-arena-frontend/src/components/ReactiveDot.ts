/**
 * Chart Arena — Reactive Price Dot
 *
 * Replaces the static drawPriceDot with a fully reactive dot that responds to:
 *   - Item effects (all 14 items with unique particle/glow/sound combos)
 *   - Position state (FLAT/LONG/SHORT × winning/losing)
 *   - Game phases (OPEN→MID→CRUNCH→OVERTIME)
 *   - Beat sync (pulse on BPM)
 *   - Item drops (exclamation burst)
 *
 * All rendering is canvas-based, runs inside the existing 60fps rAF loop.
 * Sound effects use the existing SoundEngine singleton.
 */

import { sound } from '../services/sound';

// ═══════════════════════════════════════
//  PARTICLE SYSTEM
// ═══════════════════════════════════════

type ParticleType = 'circle' | 'sparkle' | 'ember' | 'wisp' | 'crystal' |
    'shard' | 'rock' | 'hex' | 'smoke' | 'coin' | 'drop' | 'rect';

class Particle {
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; r: number;
    col: string; grav: number; drag: number;
    type: ParticleType; rot: number; rotV: number;

    constructor(
        x: number, y: number, vx: number, vy: number,
        life: number, r: number, col: string,
        grav = 0, drag = 0.98, type: ParticleType = 'circle',
    ) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = life; this.maxLife = life; this.r = r;
        this.col = col; this.grav = grav; this.drag = drag;
        this.type = type;
        this.rot = Math.random() * 6.28;
        this.rotV = (Math.random() - 0.5) * 0.2;
    }

    update(): void {
        this.vx *= this.drag; this.vy *= this.drag;
        this.vy += this.grav;
        this.x += this.vx; this.y += this.vy;
        this.life--; this.rot += this.rotV;
    }

    get alpha(): number {
        const p = this.life / this.maxLife;
        return p < 0.3 ? p / 0.3 : 1;
    }

    get dead(): boolean { return this.life <= 0; }
}

// ═══════════════════════════════════════
//  DOT STATE TYPES
// ═══════════════════════════════════════

export type DotTrigger =
    | 'idle' | 'win' | 'lose' | 'panic'
    | 'ghost' | 'shield' | 'scalp' | 'radar' | 'boost'
    | 'freeze' | 'mirror' | 'drain' | 'glitch' | 'swap'
    | 'nuke' | 'blackout' | 'quake' | 'heist'
    | 'drop';

/** Map item IDs (1-14) to dot trigger names */
const ITEM_TO_TRIGGER: Record<number, DotTrigger> = {
    1: 'ghost', 2: 'shield', 3: 'scalp', 4: 'radar', 5: 'boost',
    6: 'freeze', 7: 'mirror', 8: 'drain', 9: 'glitch', 10: 'swap',
    11: 'nuke', 12: 'blackout', 13: 'quake', 14: 'heist',
};

// ═══════════════════════════════════════
//  REACTIVE DOT ENGINE
// ═══════════════════════════════════════

const MAX_PARTICLES = 300;
const BEAT_BPM = 100;
const BEAT_MS = 60000 / BEAT_BPM;

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpArr(a: number[], b: number[], t: number): number[] {
    return a.map((v, i) => lerp(v, b[i] ?? v, t));
}
function cStr(c: number[], a: number): string {
    return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

export class ReactiveDot {
    private particles: Particle[] = [];
    private frame = 0;
    private stateTimer = 0;
    private currentState: DotTrigger = 'idle';

    // Lerped visual params
    private dotColor = [246, 184, 208];
    private dotColorTgt = [246, 184, 208];
    private glowR = 0; private glowRT = 0;
    private glowC = [246, 184, 208]; private glowCT = [246, 184, 208];
    private glowA = 0; private glowAT = 0;
    private glow2R = 0; private glow2RT = 0;
    private glow2C = [246, 184, 208]; private glow2CT = [246, 184, 208];
    private glow2A = 0; private glow2AT = 0;
    private ringR = 0; private ringRT = 0;
    private ringC = [130, 196, 160]; private ringCT = [130, 196, 160];
    private ringA = 0; private ringAT = 0;
    private ringDash = 0;
    private dotScale = 1; private dotScaleTgt = 1;
    private shakeAmt = 0; private shakeTgt = 0;
    private shakeX = 0; private shakeY = 0;
    private ghostAlpha = 1; private ghostAlphaTgt = 1;
    private glitchAmt = 0; private glitchTgt = 0;
    private frozen = 0; private frozenTgt = 0;
    private spin = 0; private spinV = 0;
    private pulseAmt = 0.3; private pulseTgt = 0.3;
    private exclaim = 0;

    // Beat tracking
    private lastBeatTime = 0;
    private beatImpact = 0;

    // Track last triggered item to avoid re-triggering
    private lastItemVFX: number | null = null;

    /** Trigger a dot state change with particles + sound */
    trigger(state: DotTrigger, dotRadius: number): void {
        this.currentState = state;
        this.stateTimer = 0;
        this.dotScaleTgt = 1.8;
        this.beatImpact = 1;

        // Reset targets
        this.ringAT = 0; this.ringDash = 0;
        this.glowAT = 0; this.glow2AT = 0;
        this.shakeTgt = 0; this.glitchTgt = 0;
        this.ghostAlphaTgt = 1; this.frozenTgt = 0;
        this.pulseTgt = 0.3; this.exclaim = 0;
        this.dotColorTgt = [246, 184, 208];
        this.glowCT = [246, 184, 208];
        this.glow2CT = [246, 184, 208];
        this.ringCT = [130, 196, 160];

        const R = dotRadius;

        switch (state) {
            case 'idle': break;

            case 'win':
                this.dotColorTgt = [130, 196, 160]; this.glowCT = [130, 196, 160];
                this.glowRT = R * 3; this.glowAT = 0.3;
                this.glow2CT = [130, 196, 160]; this.glow2RT = R * 5; this.glow2AT = 0.1;
                this.pulseTgt = 0.5;
                this._burst(40, 7, 5, 'rgba(130,196,160,', -0.06, 0.97, 'sparkle', 2, 2);
                break;

            case 'lose':
                this.dotColorTgt = [244, 140, 170]; this.glowCT = [244, 140, 170];
                this.glowRT = R * 2.5; this.glowAT = 0.2; this.shakeTgt = 1.5; this.pulseTgt = 0.15;
                break;

            case 'panic':
                this.dotColorTgt = [255, 255, 255]; this.glowCT = [255, 100, 120];
                this.glowRT = R * 3; this.glowAT = 0.35; this.shakeTgt = 3; this.pulseTgt = 0.6;
                for (let i = 0; i < 10; i++)
                    this._emit(R + Math.random() * 4, -R - Math.random() * 4, 0.3 + Math.random() * 0.5, -0.5 - Math.random() * 0.3, 50 + Math.random() * 20, 2.5, 'rgba(146,180,244,', 0.04, 0.99, 'drop');
                break;

            case 'drop':
                this.exclaim = 80; this.dotScaleTgt = 2.2;
                this.dotColorTgt = [212, 185, 120]; this.glowCT = [212, 185, 120];
                this.glowRT = R * 4; this.glowAT = 0.3; this.pulseTgt = 0.5;
                break;

            case 'ghost':
                this.ghostAlphaTgt = 0.2;
                this.dotColorTgt = [146, 180, 244]; this.glowCT = [146, 180, 244];
                this.glowRT = R * 4; this.glowAT = 0.08;
                for (let i = 0; i < 25; i++)
                    this._emit(0, 0, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 60 + Math.random() * 40, 3, 'rgba(146,180,244,', 0, 0.96, 'wisp');
                break;

            case 'shield':
                this.dotColorTgt = [130, 196, 160]; this.ringCT = [130, 196, 160];
                this.ringRT = R * 4; this.ringAT = 0.5; this.ringDash = 1;
                this.glowCT = [130, 196, 160]; this.glowRT = R * 2.5; this.glowAT = 0.15;
                for (let i = 0; i < 40; i++) {
                    const a = i * Math.PI * 2 / 40; const r = R * 4;
                    this._emit(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 80, 2, 'rgba(130,196,160,', 0, 0.99, 'hex');
                }
                break;

            case 'scalp':
                this.dotColorTgt = [255, 230, 100]; this.glowCT = [255, 230, 100];
                this.glowRT = R * 3; this.glowAT = 0.35; this.shakeTgt = 1; this.pulseTgt = 0.6;
                this._burst(25, 9, 7, 'rgba(255,230,100,', -0.02, 0.95, 'sparkle', 2, 1);
                break;

            case 'radar':
                this.dotColorTgt = [146, 180, 244]; this.ringCT = [146, 180, 244];
                this.ringRT = R * 5; this.ringAT = 0.3;
                this.glowCT = [146, 180, 244]; this.glowRT = R * 3; this.glowAT = 0.12;
                break;

            case 'boost':
                this.dotColorTgt = [255, 200, 60]; this.glowCT = [255, 140, 30];
                this.glowRT = R * 3.5; this.glowAT = 0.35;
                this.glow2CT = [255, 100, 20]; this.glow2RT = R * 5; this.glow2AT = 0.12;
                this.pulseTgt = 0.5;
                break;

            case 'freeze':
                this.frozenTgt = 1;
                this.dotColorTgt = [100, 200, 255]; this.glowCT = [100, 200, 255];
                this.glowRT = R * 3; this.glowAT = 0.2;
                this.ringCT = [150, 220, 255]; this.ringRT = R * 3.5; this.ringAT = 0.4;
                this.pulseTgt = 0.05;
                for (let i = 0; i < 35; i++) {
                    const a = Math.random() * 6.28; const r = R + Math.random() * 25;
                    this._emit(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 90 + Math.random() * 60, 2 + Math.random() * 3, 'rgba(150,220,255,', 0, 0.995, 'crystal');
                }
                break;

            case 'mirror':
                this.dotColorTgt = [200, 150, 255]; this.glowCT = [200, 150, 255];
                this.glowRT = R * 3; this.glowAT = 0.25; this.shakeTgt = 2; this.glitchTgt = 0.5;
                for (let i = 0; i < 20; i++)
                    this._emit(0, 0, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 50, 4 + Math.random() * 4, 'rgba(200,150,255,', 0, 0.97, 'shard');
                break;

            case 'drain':
                this.dotColorTgt = [255, 60, 80]; this.glowCT = [255, 60, 80];
                this.glowRT = R * 2; this.glowAT = 0.3; this.shakeTgt = 2; this.dotScaleTgt = 0.5;
                for (let i = 0; i < 45; i++) {
                    const a = Math.random() * 6.28; const r = R * 0.5; const sp = 3 + Math.random() * 4;
                    this._emit(r * Math.cos(a), r * Math.sin(a), Math.cos(a) * sp, Math.sin(a) * sp, 60 + Math.random() * 30, 2.5, 'rgba(255,60,80,', 0, 0.97, 'circle');
                }
                break;

            case 'glitch':
                this.glitchTgt = 1;
                this.dotColorTgt = [180, 100, 255]; // Purple glitch
                this.glowCT = [180, 100, 255];
                this.glowRT = R * 3; this.glowAT = 0.25;
                this.shakeTgt = 5; this.pulseTgt = 0.8;
                for (let i = 0; i < 15; i++)
                    this._emit((Math.random() - 0.5) * 35, (Math.random() - 0.5) * 35, 0, 0, 30 + Math.random() * 20, 5 + Math.random() * 7, 'rgba(180,100,255,', 0, 1, 'rect');
                break;

            case 'swap':
                this.spinV = 0.4;
                this.dotColorTgt = [200, 150, 255]; this.glowCT = [200, 150, 255];
                this.glowRT = R * 3; this.glowAT = 0.25; this.shakeTgt = 1;
                for (let i = 0; i < 30; i++) {
                    const a = i * Math.PI * 2 / 30;
                    this._emit(0, 0, Math.cos(a) * 5, Math.sin(a) * 5, 50, 2.5, 'rgba(200,150,255,', 0, 0.96, 'sparkle');
                }
                break;

            case 'nuke':
                this.dotColorTgt = [255, 255, 255]; this.glowCT = [255, 80, 30];
                this.glowRT = R * 6; this.glowAT = 0.5;
                this.glow2CT = [255, 180, 60]; this.glow2RT = R * 10; this.glow2AT = 0.15;
                this.shakeTgt = 12; this.dotScaleTgt = 0.3; this.pulseTgt = 0.8;
                for (let i = 0; i < 90; i++) {
                    const a = Math.random() * 6.28; const sp = 4 + Math.random() * 10;
                    this._emit(0, 0, Math.cos(a) * sp, Math.sin(a) * sp, 60 + Math.random() * 40, 3 + Math.random() * 4,
                        `rgba(255,${Math.floor(80 + Math.random() * 120)},30,`, 0, 0.97, 'ember');
                }
                break;

            case 'blackout':
                this.dotColorTgt = [255, 50, 80]; this.glowCT = [0, 0, 0];
                this.glowRT = R * 8; this.glowAT = 0.6;
                this.glow2CT = [20, 10, 30]; this.glow2RT = R * 12; this.glow2AT = 0.3;
                this.pulseTgt = 0.1;
                for (let i = 0; i < 25; i++) {
                    const a = Math.random() * 6.28; const r = R * 2 + Math.random() * 20;
                    this._emit(Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * 0.3, -Math.sin(a) * 0.3, 80 + Math.random() * 40, 4, 'rgba(20,10,30,', 0, 0.99, 'smoke');
                }
                break;

            case 'quake':
                this.shakeTgt = 8;
                this.dotColorTgt = [220, 180, 100]; this.glowCT = [180, 150, 80];
                this.glowRT = R * 3; this.glowAT = 0.25; this.pulseTgt = 0.6;
                for (let i = 0; i < 55; i++)
                    this._emit((Math.random() - 0.5) * 50, R + Math.random() * 12, (Math.random() - 0.5) * 5, -3 - Math.random() * 4, 40 + Math.random() * 30, 3 + Math.random() * 3, 'rgba(180,150,100,', 0.12, 0.96, 'rock');
                break;

            case 'heist':
                this.dotColorTgt = [212, 185, 120]; this.glowCT = [212, 185, 120];
                this.glowRT = R * 3; this.glowAT = 0.25; this.pulseTgt = 0.4;
                for (let i = 0; i < 25; i++)
                    this._emit((Math.random() - 0.5) * 14, -R * 2 - Math.random() * 12, (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, 50 + Math.random() * 30, 3, 'rgba(212,185,120,', 0.05, 0.98, 'coin');
                break;
        }

        // Play sound via SoundEngine
        this._playSound(state);
    }

    /**
     * Called from CandleChart's draw loop to react to game state changes.
     * Returns true if a new trigger was fired (so caller can avoid redundant calls).
     */
    reactToState(
        activeItemVFX: number | null,
        positionStatus: string,
        equity: number,
        startingCapital: number,
        currentPhase: string,
        frozen: boolean,
        dotRadius: number,
    ): void {
        // Item VFX takes priority
        if (activeItemVFX !== null && activeItemVFX !== this.lastItemVFX) {
            this.lastItemVFX = activeItemVFX;
            const trig = ITEM_TO_TRIGGER[activeItemVFX];
            if (trig) this.trigger(trig, dotRadius);
            return;
        }
        // Item still active — don't override
        if (activeItemVFX !== null) return;

        // Item just cleared
        if (this.lastItemVFX !== null) {
            this.lastItemVFX = null;
        }

        // Frozen override
        if (frozen && this.currentState !== 'freeze') {
            this.trigger('freeze', dotRadius);
            return;
        }

        // Position/PnL-based ambient state (runs every frame, only sets lerp targets)
        this._setPositionState(positionStatus, equity, startingCapital, currentPhase, dotRadius);
    }

    /** Set dot state based on position + PnL without particles/sound (smooth ambient) */
    private _setPositionState(pos: string, equity: number, capital: number, phase: string, R: number): void {
        const pnl = equity - capital;
        const winning = pnl > 0.05;
        const losing = pnl < -0.05;
        const bigLoss = pnl < -capital * 0.15;
        const overtime = phase === 'OVERTIME';

        if (bigLoss || (losing && overtime)) {
            this.currentState = 'panic';
            this.dotColorTgt = [255, 255, 255]; this.glowCT = [255, 100, 120];
            this.glowRT = R * 3; this.glowAT = 0.3; this.shakeTgt = 2;
            this.pulseTgt = 0.6;
        } else if (losing) {
            this.currentState = 'lose';
            this.dotColorTgt = [244, 140, 170]; this.glowCT = [244, 140, 170];
            this.glowRT = R * 2.5; this.glowAT = 0.15; this.shakeTgt = 0.5;
            this.pulseTgt = 0.15;
        } else if (winning) {
            this.currentState = 'win';
            this.dotColorTgt = [130, 196, 160]; this.glowCT = [130, 196, 160];
            this.glowRT = R * 3; this.glowAT = 0.2;
            this.pulseTgt = 0.4;
        } else {
            this.currentState = 'idle';
            this.dotColorTgt = [246, 184, 208];
            this.glowAT = 0; this.glow2AT = 0; this.ringAT = 0;
            this.shakeTgt = 0; this.glitchTgt = 0;
            this.ghostAlphaTgt = 1; this.frozenTgt = 0;
            this.pulseTgt = 0.3;
        }
    }

    /** Called once per frame from the draw loop. Updates lerps, particles, beat. */
    update(): void {
        this.frame++;
        this.stateTimer++;
        const S = 0.08;
        const S2 = 0.05;

        // Beat
        const now = performance.now();
        const bp = (now % BEAT_MS) / BEAT_MS;
        if (bp < 0.08 && now - this.lastBeatTime > BEAT_MS * 0.8) {
            this.lastBeatTime = now;
            this.beatImpact = Math.max(this.beatImpact, 0.4);
        }
        this.beatImpact *= 0.88;

        // Lerp all params
        this.dotColor = lerpArr(this.dotColor, this.dotColorTgt, S2);
        this.glowR = lerp(this.glowR, this.glowRT, S);
        this.glowC = lerpArr(this.glowC, this.glowCT, S2);
        this.glowA = lerp(this.glowA, this.glowAT, S);
        this.glow2R = lerp(this.glow2R, this.glow2RT, S);
        this.glow2C = lerpArr(this.glow2C, this.glow2CT, S2);
        this.glow2A = lerp(this.glow2A, this.glow2AT, S);
        this.ringR = lerp(this.ringR, this.ringRT, S);
        this.ringC = lerpArr(this.ringC, this.ringCT, S2);
        this.ringA = lerp(this.ringA, this.ringAT, S);
        this.dotScale = lerp(this.dotScale, this.dotScaleTgt, 0.12);
        this.dotScaleTgt = lerp(this.dotScaleTgt, 1, 0.05);
        this.shakeAmt = lerp(this.shakeAmt, this.shakeTgt, 0.12);
        const decayStates = ['idle', 'win', 'shield', 'boost', 'radar', 'drop', 'heist'];
        if (decayStates.includes(this.currentState)) this.shakeTgt = lerp(this.shakeTgt, 0, 0.03);
        this.glitchAmt = lerp(this.glitchAmt, this.glitchTgt, 0.1);
        if (this.currentState !== 'glitch' && this.currentState !== 'mirror') this.glitchTgt = lerp(this.glitchTgt, 0, 0.03);
        this.ghostAlpha = lerp(this.ghostAlpha, this.ghostAlphaTgt, 0.06);
        if (this.currentState !== 'ghost') this.ghostAlphaTgt = lerp(this.ghostAlphaTgt, 1, 0.02);
        this.frozen = lerp(this.frozen, this.frozenTgt, 0.05);
        if (this.currentState !== 'freeze') this.frozenTgt = lerp(this.frozenTgt, 0, 0.02);
        this.pulseAmt = lerp(this.pulseAmt, this.pulseTgt, S);
        this.spin += this.spinV; this.spinV *= 0.95;
        if (this.exclaim > 0) this.exclaim--;

        // Shake
        this.shakeX = this.shakeAmt * (Math.random() - 0.5) * 2;
        this.shakeY = this.shakeAmt * (Math.random() - 0.5) * 2;

        // Continuous particles per state
        const t = this.frame / 60;
        const R = 8; // approx dot radius for particle offsets
        if (this.currentState === 'boost' && this.frame % 2 === 0)
            this._emit(Math.random() * 6 - 3, R * 1.5, -0.3 + Math.random() * 0.6, -2 - Math.random() * 2.5, 25 + Math.random() * 15, 2 + Math.random() * 1.5, `rgba(255,${Math.floor(120 + Math.random() * 100)},30,`, 0, 0.96, 'ember');
        if (this.currentState === 'ghost' && this.frame % 4 === 0) {
            const a = Math.random() * 6.28;
            this._emit(Math.cos(a) * 20, Math.sin(a) * 20, (Math.random() - 0.5) * 0.5, -0.3 - Math.random() * 0.5, 40 + Math.random() * 30, 3 + Math.random(), 'rgba(146,180,244,', 0, 0.98, 'wisp');
        }
        if (this.currentState === 'shield' && this.frame % 6 === 0) {
            const a = t * 2 + Math.random() * 0.5; const r = this.ringR || R * 4;
            this._emit(Math.cos(a) * r, Math.sin(a) * r, Math.cos(a + 1.57) * 0.5, Math.sin(a + 1.57) * 0.5, 50, 2, 'rgba(130,196,160,', 0, 0.99, 'hex');
        }
        if (this.currentState === 'radar' && this.frame % 15 === 0)
            for (let i = 0; i < 20; i++) {
                const a = i * Math.PI * 2 / 20; const r = this.ringR || R * 5;
                this._emit(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, Math.cos(a) * 2.5, Math.sin(a) * 2.5, 35, 1.5, 'rgba(146,180,244,', 0, 0.98, 'circle');
            }
        if (this.currentState === 'freeze' && this.frame % 8 === 0)
            this._emit((Math.random() - 0.5) * 35, (Math.random() - 0.5) * 35, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 80, 2 + Math.random() * 2.5, 'rgba(150,220,255,', 0, 0.998, 'crystal');
        if (this.currentState === 'quake' && this.frame % 3 === 0)
            this._emit((Math.random() - 0.5) * 50, R * 2, (Math.random() - 0.5) * 4, -3 - Math.random() * 4, 30, 3 + Math.random(), 'rgba(180,150,100,', 0.1, 0.96, 'rock');
        if (this.currentState === 'nuke' && this.stateTimer < 90 && this.frame % 2 === 0) {
            const a = Math.random() * 6.28;
            this._emit(0, 0, Math.cos(a) * (3 + Math.random() * 6), Math.sin(a) * (3 + Math.random() * 6), 40, 3 + Math.random() * 3, `rgba(255,${Math.floor(50 + Math.random() * 150)},20,`, 0, 0.97, 'ember');
        }
        if (this.currentState === 'blackout' && this.frame % 4 === 0) {
            const a = Math.random() * 6.28; const r = 15 + Math.random() * 15;
            this._emit(Math.cos(a) * r, Math.sin(a) * r, -Math.cos(a) * 0.4, -Math.sin(a) * 0.4, 60 + Math.random() * 30, 3.5, 'rgba(20,10,30,', 0, 0.99, 'smoke');
        }
        if (this.currentState === 'heist' && this.frame % 6 === 0)
            this._emit((Math.random() - 0.5) * 8, -R * 3, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, 40, 2.5, 'rgba(212,185,120,', 0.04, 0.98, 'coin');

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update();
            if (this.particles[i].dead) this.particles.splice(i, 1);
        }
    }

    /**
     * Draw the reactive dot + particles + price label.
     * Replaces the old drawPriceDot entirely.
     */
    draw(ctx: CanvasRenderingContext2D, x: number, y: number, price: number, canvasWidth: number, dotRadius: number): void {
        const t = this.frame / 60;
        const bp = (performance.now() % BEAT_MS) / BEAT_MS;
        const beatPulse = 1 + Math.sin(bp * Math.PI * 2) * this.pulseAmt * this.beatImpact * 2 + this.beatImpact * 0.15;
        const r = dotRadius * this.dotScale * beatPulse;

        // ── Particles behind ──
        this._drawParticles(ctx, x, y, false);

        ctx.save();
        ctx.translate(x + this.shakeX, y + this.shakeY);

        // Ghost alpha
        ctx.globalAlpha = this.ghostAlpha + (this.currentState === 'ghost' ? Math.sin(t * 6) * 0.08 : 0);

        // Spin
        if (Math.abs(this.spinV) > 0.01) ctx.rotate(this.spin);

        // Glitch RGB split
        if (this.glitchAmt > 0.05) {
            const g = this.glitchAmt * 6;
            ctx.save(); ctx.globalAlpha *= 0.4 * this.glitchAmt; ctx.globalCompositeOperation = 'screen' as GlobalCompositeOperation;
            ctx.fillStyle = '#aa44ff'; ctx.beginPath(); ctx.arc(-g, 0, r, 0, Math.PI * 2); ctx.fill(); // Purple split
            ctx.fillStyle = '#44aaff'; ctx.beginPath(); ctx.arc(g, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // Outer glow 2
        if (this.glow2A > 0.01) {
            const g2 = ctx.createRadialGradient(0, 0, r, 0, 0, this.glow2R * this.dotScale);
            g2.addColorStop(0, cStr(this.glow2C, this.glow2A));
            g2.addColorStop(1, cStr(this.glow2C, 0));
            ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, this.glow2R * this.dotScale, 0, Math.PI * 2); ctx.fill();
        }

        // Inner glow
        if (this.glowA > 0.01) {
            const g1 = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, this.glowR * this.dotScale);
            g1.addColorStop(0, cStr(this.glowC, this.glowA));
            g1.addColorStop(1, cStr(this.glowC, 0));
            ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(0, 0, this.glowR * this.dotScale, 0, Math.PI * 2); ctx.fill();
        }

        // Ring
        if (this.ringA > 0.02) {
            ctx.strokeStyle = cStr(this.ringC, this.ringA); ctx.lineWidth = 1.5;
            if (this.ringDash) { ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 25; }
            ctx.beginPath(); ctx.arc(0, 0, this.ringR * this.dotScale, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            if (this.currentState === 'radar') {
                const r2 = this.ringR * this.dotScale * (0.5 + Math.sin(t * 3) * 0.15);
                ctx.strokeStyle = cStr(this.ringC, this.ringA * 0.4); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(0, 0, r2, 0, Math.PI * 2); ctx.stroke();
            }
        }

        // Freeze shell
        if (this.frozen > 0.05) {
            ctx.strokeStyle = `rgba(150,220,255,${this.frozen * 0.5})`; ctx.lineWidth = 2 + this.frozen * 2;
            ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.stroke();
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3 + t * 0.4; const cr = r + 6;
                ctx.fillStyle = `rgba(200,240,255,${this.frozen * 0.6})`;
                ctx.save(); ctx.translate(Math.cos(a) * cr, Math.sin(a) * cr); ctx.rotate(a + t);
                ctx.beginPath(); ctx.moveTo(0, -2.5); ctx.lineTo(1.5, 0); ctx.lineTo(0, 2.5); ctx.lineTo(-1.5, 0); ctx.fill();
                ctx.restore();
            }
        }

        // Outer soft ring (always)
        ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = cStr(this.dotColor, 0.08); ctx.fill();

        // Main dot
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = cStr(this.dotColor, 0.9); ctx.fill();

        // Highlight
        ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();

        ctx.restore();

        // ── Price label ──
        ctx.fillStyle = cStr(this.dotColor, 1);
        this._roundRect(ctx, canvasWidth - 72 + 4, y - 11, 62, 22, 4); ctx.fill();
        ctx.fillStyle = '#0c0a18'; ctx.font = 'bold 10px "Nunito", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(price.toFixed(2), canvasWidth - 72 + 35, y + 4);

        // ── Exclaim popup ──
        if (this.exclaim > 0) {
            const ea = Math.min(this.exclaim / 20, 1);
            const ey = Math.min(1, (80 - this.exclaim) / 15);
            ctx.save();
            ctx.translate(x + dotRadius + 6, y - dotRadius * 2 - ey * 10);
            ctx.globalAlpha = ea;
            ctx.fillStyle = '#d4b978'; ctx.font = 'bold 18px "Nunito", sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('!', 0, 0);
            ctx.restore();
        }

        // ── Particles front ──
        this._drawParticles(ctx, x, y, true);
    }

    // ═══ PRIVATE HELPERS ═══

    private _emit(x: number, y: number, vx: number, vy: number, life: number, r: number, col: string, grav: number, drag: number, type: ParticleType): void {
        if (this.particles.length < MAX_PARTICLES)
            this.particles.push(new Particle(x, y, vx, vy, life, r, col, grav, drag, type));
    }

    private _burst(count: number, spreadX: number, spreadY: number, col: string, grav: number, drag: number, type: ParticleType, minR: number, rSpread: number): void {
        for (let i = 0; i < count; i++)
            this._emit(0, 0, (Math.random() - 0.5) * spreadX, -Math.random() * spreadY - 1, 40 + Math.random() * 30, minR + Math.random() * rSpread, col, grav, drag, type);
    }

    private _drawParticles(ctx: CanvasRenderingContext2D, ox: number, oy: number, front: boolean): void {
        const frontTypes = new Set<ParticleType>(['sparkle', 'ember', 'coin', 'hex']);
        for (const p of this.particles) {
            if (frontTypes.has(p.type) !== front) continue;
            ctx.save();
            ctx.translate(ox + p.x, oy + p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = p.alpha;
            const sz = p.r * (0.5 + p.alpha * 0.5);

            switch (p.type) {
                case 'circle':
                    ctx.fillStyle = p.col + p.alpha + ')';
                    ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI * 2); ctx.fill(); break;
                case 'sparkle':
                    ctx.fillStyle = p.col + p.alpha + ')'; ctx.beginPath();
                    for (let i = 0; i < 4; i++) {
                        const a = i * Math.PI / 2;
                        ctx.lineTo(Math.cos(a) * sz, Math.sin(a) * sz);
                        ctx.lineTo(Math.cos(a + Math.PI / 4) * sz * 0.35, Math.sin(a + Math.PI / 4) * sz * 0.35);
                    }
                    ctx.fill(); break;
                case 'ember': {
                    const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, sz);
                    eg.addColorStop(0, p.col + '0.9)'); eg.addColorStop(0.6, p.col + '0.4)'); eg.addColorStop(1, p.col + '0)');
                    ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(0, 0, sz, 0, Math.PI * 2); ctx.fill(); break;
                }
                case 'wisp':
                    ctx.fillStyle = p.col + (p.alpha * 0.4) + ')';
                    ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 1.8, p.rot, 0, Math.PI * 2); ctx.fill(); break;
                case 'crystal':
                    ctx.fillStyle = p.col + (p.alpha * 0.7) + ')'; ctx.beginPath();
                    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.6, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.6, 0); ctx.fill(); break;
                case 'shard':
                    ctx.fillStyle = p.col + (p.alpha * 0.5) + ')'; ctx.beginPath();
                    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.5, sz * 0.3); ctx.lineTo(-sz * 0.4, sz * 0.5); ctx.fill(); break;
                case 'rock':
                    ctx.fillStyle = p.col + (p.alpha * 0.7) + ')';
                    ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.8); break;
                case 'hex':
                    ctx.strokeStyle = p.col + (p.alpha * 0.6) + ')'; ctx.lineWidth = 1.5; ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const a = i * Math.PI / 3;
                        i === 0 ? ctx.moveTo(Math.cos(a) * sz, Math.sin(a) * sz) : ctx.lineTo(Math.cos(a) * sz, Math.sin(a) * sz);
                    }
                    ctx.closePath(); ctx.stroke(); break;
                case 'smoke':
                    ctx.fillStyle = p.col + (p.alpha * 0.3) + ')';
                    ctx.beginPath(); ctx.arc(0, 0, sz * 1.5, 0, Math.PI * 2); ctx.fill(); break;
                case 'coin':
                    ctx.fillStyle = `rgba(212,185,120,${p.alpha * 0.8})`;
                    ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * Math.abs(Math.cos(p.rot * 3)), 0, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = `rgba(180,150,80,${p.alpha * 0.5})`; ctx.lineWidth = 0.8; ctx.stroke(); break;
                case 'drop':
                    ctx.fillStyle = p.col + (p.alpha * 0.6) + ')'; ctx.beginPath();
                    ctx.moveTo(0, -sz); ctx.quadraticCurveTo(sz, sz * 0.5, 0, sz); ctx.quadraticCurveTo(-sz, sz * 0.5, 0, -sz); ctx.fill(); break;
                case 'rect':
                    ctx.fillStyle = p.col + (p.alpha * 0.4) + ')';
                    ctx.fillRect(-sz, -sz * 0.3, sz * 2, sz * 0.6); break;
            }
            ctx.restore();
        }
    }

    private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }

    /** Synthesized SFX via existing SoundEngine primitives */
    private _playSound(state: DotTrigger): void {
        // Access private primitives via the sound singleton's playItemById or direct calls
        // We use the existing item sounds for item states, and add new ones for position states
        switch (state) {
            case 'win':
                this._O('sine', 523, 0.12, 0.12); this._O('sine', 659, 0.12, 0.1, 0, 60);
                this._O('sine', 784, 0.2, 0.12, 0, 120); this._O('sine', 1047, 0.3, 0.08, 0, 180); break;
            case 'lose':
                this._O('sine', 400, 0.3, 0.1, 200); this._O('sine', 300, 0.4, 0.08, 150, 100); break;
            case 'panic':
                this._O('square', 800, 0.06, 0.08); this._O('square', 900, 0.06, 0.06, 0, 70);
                this._O('square', 1000, 0.06, 0.06, 0, 140); break;
            case 'drop':
                this._O('sine', 600, 0.06, 0.08); this._O('sine', 900, 0.06, 0.08, 0, 60);
                this._O('sine', 1200, 0.1, 0.1, 0, 120); break;
            // Items already have sounds via sound.playItemById — don't double up
            default: break;
        }
    }

    /** Quick oscillator helper using a fresh AudioContext-safe approach */
    private _O(type: OscillatorType, freq: number, dur: number, vol: number, rampTo?: number, delay?: number): void {
        // Use a small timeout to avoid blocking the draw frame
        setTimeout(() => {
            try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const o = ctx.createOscillator(); const g = ctx.createGain();
                o.type = type; o.frequency.value = freq;
                g.gain.setValueAtTime(vol * (sound.muted ? 0 : sound.volume), ctx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
                if (rampTo) o.frequency.exponentialRampToValueAtTime(rampTo, ctx.currentTime + dur);
                o.connect(g); g.connect(ctx.destination);
                o.start(ctx.currentTime); o.stop(ctx.currentTime + dur + 0.05);
                // Cleanup
                setTimeout(() => ctx.close(), (dur + 0.1) * 1000);
            } catch (_) { /* ignore audio errors */ }
        }, delay || 0);
    }
}
