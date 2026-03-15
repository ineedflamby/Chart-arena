/**
 * Chart Arena — Sound Engine
 *
 * All sounds synthesized via Web Audio API. Zero audio files.
 * Singleton pattern: import { sound } from './sound' then call sound.playXxx().
 * Mute state persisted in localStorage.
 */

type OscType = OscillatorType;

class SoundEngine {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private _muted: boolean;
    private _volume: number;

    constructor() {
        this._muted = localStorage.getItem('ca-muted') === '1';
        this._volume = parseFloat(localStorage.getItem('ca-volume') ?? '0.5');
        // Warm up AudioContext on first user gesture (browser autoplay policy)
        const warmup = () => {
            this.init();
            if (this.ctx!.state === 'suspended') this.ctx!.resume();
            document.removeEventListener('click', warmup);
            document.removeEventListener('touchstart', warmup);
            document.removeEventListener('keydown', warmup);
        };
        document.addEventListener('click', warmup);
        document.addEventListener('touchstart', warmup);
        document.addEventListener('keydown', warmup);
    }

    private init(): void {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._muted ? 0 : this._volume;
        this.master.connect(this.ctx.destination);
    }

    private ensure(): void {
        this.init();
        if (this.ctx!.state === 'suspended') this.ctx!.resume();
    }

    get muted(): boolean { return this._muted; }
    get volume(): number { return this._volume; }

    toggleMute(): boolean {
        this._muted = !this._muted;
        localStorage.setItem('ca-muted', this._muted ? '1' : '0');
        if (this.master) this.master.gain.value = this._muted ? 0 : this._volume;
        return this._muted;
    }

    setVolume(v: number): void {
        this._volume = Math.max(0, Math.min(1, v));
        localStorage.setItem('ca-volume', String(this._volume));
        if (this.master && !this._muted) this.master.gain.value = this._volume;
    }

    // ── Primitives ──

    private O(type: OscType, freq: number, dur: number, vol: number, rampTo?: number, delay?: number): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        setTimeout(() => {
            const s = c.createOscillator(), g = c.createGain();
            s.type = type; s.frequency.value = freq; g.gain.value = 0;
            s.connect(g); g.connect(m);
            const t = c.currentTime;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            if (rampTo) s.frequency.exponentialRampToValueAtTime(rampTo, t + dur);
            s.start(t); s.stop(t + dur);
        }, delay || 0);
    }

    private N(dur: number, vol: number, delay?: number): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        setTimeout(() => {
            const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
            const d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const s = c.createBufferSource(); s.buffer = b;
            const g = c.createGain(); const t = c.currentTime;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            s.connect(g); g.connect(m); s.start(t); s.stop(t + dur);
        }, delay || 0);
    }

    private HN(dur: number, vol: number, freq: number, delay?: number): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        setTimeout(() => {
            const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
            const d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const s = c.createBufferSource(); s.buffer = b;
            const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = freq; fl.Q.value = 3;
            const g = c.createGain(); const t = c.currentTime;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            s.connect(fl); fl.connect(g); g.connect(m); s.start(t); s.stop(t + dur);
        }, delay || 0);
    }

    private BP(dur: number, vol: number, freq: number, q: number, delay?: number): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        setTimeout(() => {
            const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
            const d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const s = c.createBufferSource(); s.buffer = b;
            const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = freq; fl.Q.value = q;
            const g = c.createGain(); const t = c.currentTime;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            s.connect(fl); fl.connect(g); g.connect(m); s.start(t); s.stop(t + dur);
        }, delay || 0);
    }

    private DN(dur: number, vol: number, freq: number, q?: number, delay?: number): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        setTimeout(() => {
            const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
            const d = b.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const s = c.createBufferSource(); s.buffer = b;
            const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = freq; fl.Q.value = q || 1;
            const ws = c.createWaveShaper();
            const curve = new Float32Array(256);
            for (let i = 0; i < 256; i++) { const x = i * 2 / 256 - 1; curve[i] = Math.tanh(x * 4); }
            ws.curve = curve; ws.oversample = '4x';
            const g = c.createGain(); const t = c.currentTime;
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            s.connect(fl); fl.connect(ws); ws.connect(g); g.connect(m); s.start(t); s.stop(t + dur);
        }, delay || 0);
    }

    // ═══════════════════════════════════════
    // GAME EVENTS
    // ═══════════════════════════════════════

    playLongOpen(): void {
        this.O('square', 400, 0.12, 0.15, 900);
        this.O('sine', 880, 0.08, 0.12, undefined, 80);
        this.O('triangle', 660, 0.06, 0.04, undefined, 40);
        this.N(0.03, 0.04);
    }

    playShortOpen(): void {
        this.O('square', 900, 0.12, 0.15, 350);
        this.O('sine', 330, 0.08, 0.12, undefined, 80);
        this.O('triangle', 500, 0.06, 0.04, undefined, 40);
        this.N(0.03, 0.04);
    }

    playClosePosition(): void {
        this.O('triangle', 600, 0.06, 0.15);
        this.O('triangle', 500, 0.06, 0.12, undefined, 50);
        this.O('sine', 700, 0.04, 0.04, undefined, 20);
    }

    playItemReceived(): void {
        this.O('square', 587, 0.08, 0.12);
        this.O('square', 784, 0.08, 0.12, undefined, 80);
        this.O('square', 1047, 0.12, 0.15, undefined, 160);
        this.O('sine', 1047, 0.2, 0.04, undefined, 200);
    }

    playItemUsedSelf(): void {
        this.O('sawtooth', 300, 0.2, 0.1, 1200);
        this.N(0.08, 0.06);
        this.O('sine', 800, 0.1, 0.04, 1400, 120);
    }

    playHitByItem(): void {
        this.O('square', 180, 0.06, 0.2);
        this.O('square', 120, 0.1, 0.18, undefined, 50);
        this.N(0.1, 0.1);
        this.DN(0.08, 0.06, 400, 1, 80);
    }

    playPhaseChange(): void {
        this.O('triangle', 400, 0.25, 0.12, 800);
        this.O('sine', 800, 0.15, 0.1, undefined, 200);
        this.O('triangle', 600, 0.1, 0.04, undefined, 100);
    }

    playCountdownTick(): void {
        this.O('triangle', 1000, 0.04, 0.15);
        this.O('square', 1000, 0.02, 0.05);
    }

    playGo(): void {
        this.O('square', 523, 0.08, 0.12);
        this.O('square', 659, 0.08, 0.12, undefined, 70);
        this.O('square', 784, 0.08, 0.12, undefined, 140);
        this.O('square', 1047, 0.2, 0.18, undefined, 210);
        this.O('sine', 1047, 0.15, 0.06, undefined, 250);
    }

    playVictory(): void {
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
            this.O('square', f, 0.15, 0.12, undefined, i * 100));
        this.O('sine', 1319, 0.4, 0.1, undefined, 500);
        this.O('triangle', 1319, 0.3, 0.04, undefined, 520);
    }

    playDefeat(): void {
        this.O('triangle', 400, 0.25, 0.12);
        this.O('triangle', 350, 0.25, 0.1, undefined, 200);
        this.O('triangle', 280, 0.4, 0.08, undefined, 400);
        this.O('sine', 200, 0.2, 0.04, undefined, 550);
    }

    playShieldBlock(): void {
        this.O('square', 1000, 0.03, 0.2);
        this.O('sine', 1600, 0.3, 0.12);
        this.O('sine', 2000, 0.2, 0.06, undefined, 50);
        this.N(0.04, 0.1);
        this.O('sine', 2400, 0.15, 0.04, undefined, 80);
        this.O('sine', 1600, 0.15, 0.04, 1400, 200);
    }

    playElimination(): void {
        this.O('sine', 500, 0.15, 0.12, 200);
        this.O('sine', 350, 0.2, 0.1, 150, 120);
        this.O('triangle', 200, 0.3, 0.08, 80, 250);
        this.DN(0.2, 0.08, 400, 1, 300);
        this.O('sine', 120, 0.2, 0.04, 60, 400);
    }

    // ═══════════════════════════════════════
    // T1 — TRADING POWERS
    // ═══════════════════════════════════════

    /** ID 1 — Ghost Trade */
    playGhostTrade(): void {
        // P1: spectral charge
        this.O('sine', 1200, 0.15, 0.08, 2400); this.O('sine', 1800, 0.12, 0.05, 3200); this.HN(0.1, 0.06, 3000); this.BP(0.12, 0.05, 4000, 5);
        // P2: body dissolve
        this.O('sine', 600, 0.3, 0.12, 2800, 100); this.O('triangle', 900, 0.25, 0.08, 3500, 100); this.HN(0.2, 0.1, 2500, 120); this.O('sawtooth', 400, 0.2, 0.06, 1800, 140);
        // P3: echo scatter
        this.O('sine', 2200, 0.08, 0.07, undefined, 300); this.O('sine', 2600, 0.06, 0.05, undefined, 380); this.O('sine', 3000, 0.05, 0.04, undefined, 450); this.O('sine', 2400, 0.04, 0.03, undefined, 510); this.HN(0.08, 0.04, 4000, 350);
        // P4: vanish whisper
        this.HN(0.3, 0.05, 5000, 550); this.O('sine', 100, 0.2, 0.04, 60, 550); this.BP(0.2, 0.03, 6000, 8, 600);
    }

    /** ID 2 — Shield */
    playShield(): void {
        // P1: energy charge
        this.O('sawtooth', 200, 0.1, 0.08, 600); this.O('sawtooth', 205, 0.1, 0.06, 610); this.N(0.06, 0.05);
        // P2: metallic impact
        this.O('square', 900, 0.04, 0.25, undefined, 100); this.O('square', 1100, 0.03, 0.2, undefined, 100); this.N(0.05, 0.18, 100); this.HN(0.04, 0.15, 2000, 100);
        // P3: resonant ring
        this.O('sine', 1200, 0.5, 0.15, undefined, 140); this.O('sine', 1800, 0.4, 0.08, undefined, 140); this.O('sine', 2400, 0.35, 0.05, undefined, 150); this.O('sine', 3600, 0.3, 0.03, undefined, 160);
        // P4: harmonic decay
        this.O('sine', 1200, 0.3, 0.04, 1100, 500); this.O('sine', 1800, 0.25, 0.03, 1700, 520); this.BP(0.2, 0.02, 1500, 6, 550);
    }

    /** ID 3 — Scalp */
    playScalp(): void {
        // P1: static buildup
        this.HN(0.15, 0.06, 2000); this.O('square', 3000, 0.01, 0.04); this.O('square', 4000, 0.01, 0.03, undefined, 30); this.O('square', 3500, 0.01, 0.04, undefined, 60);
        // P2: main zap
        this.O('sawtooth', 2000, 0.06, 0.2, 800, 100); this.O('square', 2800, 0.04, 0.18, undefined, 100); this.HN(0.06, 0.18, 3000, 100); this.N(0.05, 0.12, 105);
        // P3: crackle chain
        this.O('square', 2200, 0.02, 0.1, undefined, 180); this.O('square', 3400, 0.02, 0.08, undefined, 210); this.O('square', 1800, 0.02, 0.09, undefined, 240); this.O('square', 2900, 0.02, 0.07, undefined, 265); this.O('square', 3800, 0.02, 0.06, undefined, 290);
        // P4: arc dissipation
        this.O('sawtooth', 1500, 0.2, 0.06, 300, 330); this.O('triangle', 800, 0.15, 0.04, 200, 360); this.BP(0.15, 0.03, 2000, 3, 350);
    }

    /** ID 4 — Radar */
    playRadar(): void {
        // P1: power-on hum
        this.O('sawtooth', 100, 0.2, 0.06, 200); this.O('sawtooth', 102, 0.2, 0.04, 202); this.DN(0.15, 0.04, 300, 1);
        // P2: initial ping
        this.O('sine', 1400, 0.2, 0.18, undefined, 180); this.O('sine', 1400, 0.5, 0.06, undefined, 180); this.O('triangle', 1400, 0.15, 0.04, undefined, 190);
        // P3: scan sweep
        this.O('triangle', 600, 0.4, 0.06, 3000, 350); this.O('triangle', 650, 0.35, 0.04, 3100, 370); this.O('triangle', 3000, 0.35, 0.05, 600, 400);
        // P4: target lock
        this.O('sine', 1400, 0.06, 0.1, undefined, 700); this.O('sine', 1400, 0.05, 0.1, undefined, 770); this.O('sine', 1400, 0.04, 0.1, undefined, 830); this.O('sine', 1800, 0.2, 0.1, undefined, 910); this.O('sine', 1400, 0.15, 0.06, undefined, 910);
    }

    /** ID 5 — Boost (positive ascending power-up) */
    playBoost(): void {
        // P1: sparkle charge
        this.O('sine', 880, 0.06, 0.1); this.O('sine', 1100, 0.05, 0.08, undefined, 30); this.O('sine', 1320, 0.05, 0.06, undefined, 55);
        this.O('triangle', 660, 0.04, 0.05); this.BP(0.04, 0.04, 2000, 5, 20);
        // P2: rising energy — ascending major arpeggio
        this.O('square', 440, 0.1, 0.1, undefined, 80); this.O('square', 554, 0.1, 0.1, undefined, 150); this.O('square', 659, 0.1, 0.1, undefined, 220); this.O('square', 880, 0.12, 0.12, undefined, 290);
        this.O('sine', 440, 0.08, 0.05, undefined, 80); this.O('sine', 554, 0.08, 0.05, undefined, 150); this.O('sine', 659, 0.08, 0.05, undefined, 220); this.O('sine', 880, 0.1, 0.06, undefined, 290);
        // P3: thrust surge
        this.O('sawtooth', 400, 0.3, 0.12, 2400, 370); this.O('sawtooth', 410, 0.28, 0.08, 2450, 370);
        this.O('triangle', 800, 0.2, 0.08, 3200, 390); this.HN(0.15, 0.06, 2500, 400); this.N(0.12, 0.05, 380);
        // P4: burst peak
        this.O('sine', 1760, 0.2, 0.14, undefined, 580); this.O('sine', 2200, 0.15, 0.08, undefined, 590); this.O('sine', 1320, 0.18, 0.06, undefined, 600);
        this.BP(0.08, 0.04, 4000, 6, 620); this.BP(0.06, 0.03, 5000, 5, 660); this.O('sine', 1760, 0.12, 0.03, 1600, 700);
    }

    // ═══════════════════════════════════════
    // T2 — DIRECT ATTACKS
    // ═══════════════════════════════════════

    /** ID 6 — Freeze */
    playFreeze(): void {
        // P1: cold wind
        this.HN(0.2, 0.08, 1500); this.BP(0.15, 0.06, 3000, 5); this.O('sine', 4000, 0.12, 0.03, 6000); this.O('sine', 5000, 0.1, 0.02, 7000, 40);
        // P2: ice crack
        this.HN(0.06, 0.2, 2500, 150); this.O('square', 2000, 0.03, 0.15, undefined, 150); this.O('sine', 4000, 0.05, 0.12, 2500, 155); this.HN(0.08, 0.15, 3500, 160); this.N(0.04, 0.1, 155);
        // P3: crystal spread
        this.O('sine', 3200, 0.06, 0.08, undefined, 230); this.O('sine', 4200, 0.05, 0.06, undefined, 270); this.O('sine', 3600, 0.05, 0.07, undefined, 310); this.O('sine', 5000, 0.04, 0.05, undefined, 345); this.O('sine', 2800, 0.04, 0.04, undefined, 380); this.HN(0.06, 0.05, 4000, 250);
        // P4: frozen lock hum
        this.O('sine', 150, 0.5, 0.06, 120, 420); this.O('triangle', 300, 0.4, 0.04, 200, 440); this.BP(0.3, 0.03, 250, 4, 450);
    }

    /** ID 7 — Mirror Curse (shield reflection) */
    playMirrorCurse(): void {
        // P1: incoming projectile
        this.O('sawtooth', 1200, 0.12, 0.1, 400); this.O('sawtooth', 1000, 0.1, 0.08, 350, 20);
        this.DN(0.08, 0.08, 800, 2); this.N(0.06, 0.06); this.O('triangle', 800, 0.08, 0.04, 300, 40);
        // P2: shield impact — metallic CLANG
        this.O('square', 900, 0.04, 0.25, undefined, 110); this.O('square', 1200, 0.03, 0.2, undefined, 110); this.O('square', 700, 0.03, 0.15, undefined, 115);
        this.N(0.05, 0.2, 110); this.HN(0.04, 0.15, 2500, 112);
        this.O('sine', 1400, 0.3, 0.12, undefined, 120); this.O('sine', 2100, 0.25, 0.08, undefined, 125); this.O('sine', 2800, 0.2, 0.05, undefined, 130);
        // P3: reflection burst — energy shoots back
        this.O('sine', 400, 0.2, 0.12, 1800, 200); this.O('sine', 500, 0.18, 0.1, 2200, 210); this.O('sawtooth', 300, 0.15, 0.08, 1500, 220);
        this.HN(0.1, 0.1, 2000, 220); this.N(0.08, 0.06, 230); this.O('triangle', 600, 0.15, 0.06, 2400, 240);
        // P4: ricochet fade
        this.O('sine', 2400, 0.06, 0.06, undefined, 380); this.O('sine', 3200, 0.05, 0.05, undefined, 420); this.O('sine', 2800, 0.04, 0.04, undefined, 460); this.O('sine', 3600, 0.03, 0.03, undefined, 495);
        this.BP(0.06, 0.03, 3000, 6, 400); this.O('sine', 1400, 0.15, 0.03, 1200, 520);
    }

    /** ID 8 — Drain */
    playDrain(): void {
        // P1: grip latch
        this.O('square', 120, 0.05, 0.18); this.O('sine', 80, 0.08, 0.12); this.DN(0.06, 0.12, 500, 2); this.N(0.04, 0.08);
        // P2: extraction pull
        this.O('sawtooth', 800, 0.4, 0.15, 120, 80); this.O('sawtooth', 600, 0.35, 0.1, 100, 100); this.O('triangle', 500, 0.3, 0.08, 80, 120); this.DN(0.3, 0.1, 600, 2, 90);
        // P3: energy siphon
        this.O('sine', 300, 0.08, 0.08, undefined, 350); this.O('sine', 280, 0.08, 0.07, undefined, 420); this.O('sine', 260, 0.08, 0.06, undefined, 490); this.O('sine', 240, 0.07, 0.05, undefined, 555); this.DN(0.06, 0.04, 400, 1, 370);
        // P4: victim gasp
        this.HN(0.15, 0.06, 1500, 600); this.BP(0.2, 0.05, 2000, 3, 610); this.O('sine', 500, 0.2, 0.04, 200, 620);
    }

    /** ID 9 — Glitch */
    playGlitch(): void {
        // P1: data corrupt
        this.O('square', 80, 0.03, 0.12); this.O('square', 2500, 0.02, 0.1, undefined, 25); this.O('square', 200, 0.03, 0.08, undefined, 45); this.N(0.04, 0.1, 20);
        // P2: bitcrush burst
        this.DN(0.1, 0.2, 2000, 3, 90); this.O('square', 100, 0.05, 0.18, 4000, 90); this.O('square', 3000, 0.04, 0.15, 60, 95); this.DN(0.08, 0.15, 4000, 2, 100);
        // P3: error cascade
        this.O('square', 3000, 0.03, 0.12, undefined, 200); this.O('square', 150, 0.03, 0.1, undefined, 230); this.O('square', 2200, 0.03, 0.1, undefined, 255); this.O('square', 80, 0.03, 0.08, undefined, 280); this.O('square', 4000, 0.02, 0.07, undefined, 305); this.DN(0.04, 0.06, 1500, 2, 210);
        // P4: system stutter
        this.O('square', 300, 0.02, 0.06, undefined, 370); this.O('square', 300, 0.02, 0.05, undefined, 400); this.O('square', 300, 0.02, 0.04, undefined, 430); this.O('square', 300, 0.02, 0.03, undefined, 460); this.O('sine', 200, 0.1, 0.02, 100, 490);
    }

    /** ID 10 — Swap */
    playSwap(): void {
        // P1: detach pop
        this.O('square', 600, 0.03, 0.12); this.O('triangle', 400, 0.04, 0.1); this.N(0.03, 0.08); this.O('square', 800, 0.03, 0.1, undefined, 40);
        // P2: spin whoosh
        this.O('sine', 300, 0.3, 0.1, 1800, 80); this.O('sine', 1800, 0.3, 0.1, 300, 80); this.O('triangle', 400, 0.25, 0.06, 1600, 100); this.O('triangle', 1600, 0.25, 0.06, 400, 100); this.N(0.15, 0.04, 100);
        // P3: cross exchange
        this.O('sine', 1000, 0.06, 0.15, undefined, 320); this.O('square', 1200, 0.04, 0.12, undefined, 320); this.HN(0.05, 0.1, 2000, 320); this.N(0.04, 0.08, 325);
        // P4: reattach lock
        this.O('triangle', 800, 0.04, 0.12, undefined, 400); this.O('triangle', 1000, 0.04, 0.1, undefined, 430); this.O('sine', 600, 0.15, 0.06, undefined, 460); this.BP(0.1, 0.03, 800, 4, 480);
    }

    // ═══════════════════════════════════════
    // T3 — ULTIMATES
    // ═══════════════════════════════════════

    /** ID 11 — Nuke (V3 HUGE) */
    playNuke(): void {
        this.ensure();
        const c = this.ctx!, m = this.master!;
        const t = c.currentTime;
        // P1: reverse swell
        const pre = c.createOscillator(), pg = c.createGain();
        pre.type = 'sawtooth'; pre.frequency.value = 300;
        pre.frequency.exponentialRampToValueAtTime(60, t + 0.3);
        pg.gain.setValueAtTime(0.001, t); pg.gain.exponentialRampToValueAtTime(0.25, t + 0.27); pg.gain.setValueAtTime(0.001, t + 0.3);
        pre.connect(pg); pg.connect(m); pre.start(t); pre.stop(t + 0.32);
        const p2 = c.createOscillator(), p2g = c.createGain();
        p2.type = 'sawtooth'; p2.frequency.value = 305; p2.detune.value = 15;
        p2.frequency.exponentialRampToValueAtTime(58, t + 0.3);
        p2g.gain.setValueAtTime(0.001, t); p2g.gain.exponentialRampToValueAtTime(0.15, t + 0.27); p2g.gain.setValueAtTime(0.001, t + 0.3);
        p2.connect(p2g); p2g.connect(m); p2.start(t); p2.stop(t + 0.32);
        // P2: impact
        setTimeout(() => { this.O('square', 60, 0.06, 0.5); this.O('square', 90, 0.05, 0.4); this.O('sawtooth', 45, 0.06, 0.45); this.O('sawtooth', 48, 0.05, 0.35); this.DN(0.1, 0.45, 2000, 2); this.DN(0.08, 0.35, 4000, 1); }, 260);
        // P3: sub-bass body
        setTimeout(() => { this.O('sine', 30, 1.8, 0.35, 12); this.O('sine', 42, 1.4, 0.25, 14); this.O('triangle', 55, 1.0, 0.15, 18); this.O('sawtooth', 80, 0.6, 0.12, 20); this.DN(1.2, 0.28, 700, 1.5); this.DN(1.0, 0.2, 400, 2); }, 300);
        // P4: debris
        setTimeout(() => { this.O('square', 50, 0.08, 0.2); this.DN(0.15, 0.2, 1500, 1); this.O('sine', 25, 1.0, 0.2, 10); }, 550);
        setTimeout(() => { this.DN(0.8, 0.15, 350, 1); this.O('sine', 22, 0.8, 0.15, 10); this.O('triangle', 40, 0.5, 0.08, 15); }, 800);
        // P5: rumble tail
        setTimeout(() => { this.DN(0.7, 0.1, 200, 1); this.O('sine', 18, 0.7, 0.1, 10); }, 1200);
        setTimeout(() => { this.DN(0.5, 0.06, 120, 1); this.O('sine', 15, 0.5, 0.06, 8); }, 1600);
        setTimeout(() => { this.O('sine', 12, 0.4, 0.04, 8); this.DN(0.3, 0.03, 80, 1); }, 1900);
    }

    /** ID 12 — Blackout */
    playBlackout(): void {
        // P1: power flicker
        this.O('sawtooth', 400, 0.03, 0.1); this.O('sawtooth', 400, 0.03, 0.08, undefined, 60); this.O('sawtooth', 380, 0.03, 0.1, undefined, 120); this.O('sawtooth', 360, 0.04, 0.06, undefined, 170); this.HN(0.02, 0.06, 2000, 40); this.HN(0.02, 0.05, 2000, 100);
        // P2: main shutdown
        this.O('sawtooth', 600, 0.6, 0.18, 25, 220); this.O('sawtooth', 610, 0.6, 0.12, 23, 220); this.O('square', 400, 0.5, 0.1, 18, 240); this.DN(0.5, 0.15, 800, 1.5, 230); this.N(0.1, 0.1, 220);
        // P3: darkness sweep
        this.DN(0.6, 0.12, 400, 2, 500); this.DN(0.5, 0.08, 200, 1, 600); this.O('sine', 60, 0.5, 0.08, 20, 520); this.O('triangle', 80, 0.4, 0.05, 25, 560);
        // P4: dead hum
        this.O('sine', 30, 0.8, 0.06, 22, 850); this.O('sine', 45, 0.6, 0.03, 28, 880); this.DN(0.5, 0.04, 100, 1, 900);
    }

    /** ID 13 — Earthquake */
    playEarthquake(): void {
        // P1: tectonic crack
        this.O('sine', 80, 0.08, 0.2, 30); this.O('square', 60, 0.06, 0.15); this.DN(0.1, 0.18, 600, 2); this.N(0.06, 0.12);
        // P2: main tremor
        this.O('sine', 30, 1.2, 0.25, 15, 80); this.O('sine', 45, 1.0, 0.18, 18, 80); this.O('triangle', 60, 0.8, 0.12, 22, 100); this.DN(0.9, 0.22, 500, 2, 80);
        // P3: aftershock hits
        this.O('square', 55, 0.06, 0.15, undefined, 300); this.DN(0.12, 0.12, 800, 2, 300);
        this.O('square', 50, 0.05, 0.12, undefined, 480); this.DN(0.1, 0.1, 700, 1, 480);
        this.O('square', 60, 0.04, 0.1, undefined, 620); this.DN(0.08, 0.08, 600, 1, 620);
        this.O('square', 45, 0.04, 0.07, undefined, 740);
        // P4: rumble tail
        this.O('sine', 22, 0.8, 0.1, 12, 850); this.DN(0.6, 0.08, 250, 1, 880); this.O('sine', 18, 0.5, 0.06, 10, 1000); this.DN(0.4, 0.04, 150, 1, 1050);
    }

    /** ID 14 — Heist */
    playHeist(): void {
        // P1: sneak approach
        this.O('triangle', 150, 0.15, 0.05, 120); this.O('sine', 200, 0.12, 0.04, 160, 40); this.O('triangle', 180, 0.1, 0.03, 140, 80); this.BP(0.1, 0.03, 300, 2, 30);
        // P2: grab snatch
        this.O('square', 400, 0.04, 0.15, undefined, 140); this.O('sawtooth', 300, 0.05, 0.12, undefined, 140); this.N(0.04, 0.1, 140); this.O('sine', 200, 0.08, 0.08, 600, 150); this.DN(0.06, 0.08, 800, 1, 145);
        // P3: coin scatter
        this.O('sine', 3000, 0.05, 0.1, undefined, 220); this.O('sine', 3500, 0.04, 0.08, undefined, 260); this.O('sine', 4000, 0.04, 0.07, undefined, 295); this.O('sine', 3200, 0.04, 0.06, undefined, 335); this.O('sine', 3800, 0.05, 0.08, undefined, 370); this.O('sine', 2800, 0.03, 0.05, undefined, 405); this.O('sine', 4200, 0.03, 0.04, undefined, 435);
        // P4: escape dash
        this.O('sawtooth', 300, 0.2, 0.08, 1500, 470); this.O('sawtooth', 310, 0.18, 0.05, 1520, 480); this.N(0.15, 0.06, 480); this.HN(0.1, 0.04, 2000, 520);
    }

    // ═══════════════════════════════════════
    // ITEM ROUTER — call by item ID
    // ═══════════════════════════════════════

    playItemById(itemId: number): void {
        switch (itemId) {
            case 1: this.playGhostTrade(); break;
            case 2: this.playShield(); break;
            case 3: this.playScalp(); break;
            case 4: this.playRadar(); break;
            case 5: this.playBoost(); break;
            case 6: this.playFreeze(); break;
            case 7: this.playMirrorCurse(); break;
            case 8: this.playDrain(); break;
            case 9: this.playGlitch(); break;
            case 10: this.playSwap(); break;
            case 11: this.playNuke(); break;
            case 12: this.playBlackout(); break;
            case 13: this.playEarthquake(); break;
            case 14: this.playHeist(); break;
        }
    }
}

export const sound = new SoundEngine();
