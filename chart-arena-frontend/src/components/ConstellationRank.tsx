/**
 * Chart Arena — Constellation Rank Renderer
 * Animated canvas-based rank icons (15 tiers: Newcomer → Megalodon)
 *
 * Ported from constellation-ranks-v3.html
 */
import React, { useRef, useEffect, memo } from 'react';

// ── HELPERS ──────────────────────────────────────────────────────────
function hex2rgb(h: string): [number, number, number] {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// ── TYPES ────────────────────────────────────────────────────────────
interface OrbitDots {
  count: number; radius: number; speed: number; r: number; alpha: number;
}
interface Ripple { speed: number; count: number; }

interface RankStyle {
  dotScale: number[];
  pulseFreq: number[];
  pulseAmt: number[];
  crossLen: number;
  crossSpin: number;
  crossBranches: number;
  lineAlpha: number;
  lineShimmer: number;
  bgGlow: number;
  bgGlowRadius: number;
  trailDots: number;
  orbitDots?: OrbitDots;
  crownGlow?: boolean;
  flowDir?: boolean;
  ripple?: Ripple;
  electricArcs?: boolean;
  lightning?: boolean;
  waveRipple?: boolean;
  holyGlow?: boolean;
  ancientRunes?: boolean;
  inferno?: boolean;
}

interface RankDef {
  name: string;
  pts: number;
  color: string;
  dots: number[][];
  edges: number[][];
  style: RankStyle;
}

// ── RANK DEFINITIONS ─────────────────────────────────────────────────
const RANKS: RankDef[] = [
  {
    name: 'Newcomer', pts: 0, color: '#E7D27C',
    dots: [[.5, .5]],
    edges: [],
    style: {
      dotScale: [4.0],
      pulseFreq: [0.5], pulseAmt: [0.6],
      crossLen: 4.5, crossSpin: 0.15, crossBranches: 8,
      lineAlpha: 0, lineShimmer: 0,
      bgGlow: 0.18, bgGlowRadius: 0.55,
      trailDots: 0,
    }
  },
  {
    name: 'Plancton', pts: 50, color: '#6dd5a0',
    dots: [[.3, .38], [.7, .62], [.5, .25], [.5, .75]],
    edges: [[0, 1], [2, 3], [0, 2], [1, 3]],
    style: {
      dotScale: [1.8, 1.8, 1.8, 1.8],
      pulseFreq: [0.4, 0.55, 0.48, 0.51], pulseAmt: [0.25, 0.25, 0.25, 0.25],
      crossLen: 2.2, crossSpin: 0.08, crossBranches: 4,
      lineAlpha: 0.18, lineShimmer: 0.12,
      bgGlow: 0.06, bgGlowRadius: 0.45,
      orbitDots: { count: 2, radius: 0.32, speed: 0.4, r: 0.9, alpha: 0.5 },
      trailDots: 1,
    }
  },
  {
    name: 'Shrimp', pts: 100, color: '#F6B8D0',
    dots: [[.5, .14], [.18, .78], [.82, .78], [.5, .52]],
    edges: [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]],
    style: {
      dotScale: [2.8, 1.6, 1.6, 1.4],
      pulseFreq: [1.2, 0.6, 0.6, 0.8], pulseAmt: [0.4, 0.2, 0.2, 0.3],
      crossLen: 3, crossSpin: 0.5, crossBranches: 4,
      lineAlpha: 0.22, lineShimmer: 0.15,
      bgGlow: 0.07, bgGlowRadius: 0.4,
      trailDots: 2,
    }
  },
  {
    name: 'King Shrimp', pts: 500, color: '#ff88bb',
    dots: [[.5, .1], [.15, .42], [.85, .42], [.5, .85], [.32, .26], [.68, .26]],
    edges: [[0, 4], [0, 5], [4, 5], [4, 1], [5, 2], [1, 3], [2, 3], [0, 3]],
    style: {
      dotScale: [3.2, 1.5, 1.5, 1.5, 1.8, 1.8],
      pulseFreq: [1.4, 0.5, 0.5, 0.6, 0.9, 0.9], pulseAmt: [0.5, 0.2, 0.2, 0.2, 0.3, 0.3],
      crossLen: 3.5, crossSpin: 0.8, crossBranches: 6,
      lineAlpha: 0.25, lineShimmer: 0.18,
      bgGlow: 0.09, bgGlowRadius: 0.42,
      crownGlow: true,
      trailDots: 2,
    }
  },
  {
    name: 'Fish', pts: 1000, color: '#6BAFE0',
    dots: [[.12, .5], [.38, .22], [.38, .78], [.65, .5], [.88, .38], [.88, .62], [.55, .5]],
    edges: [[0, 1], [0, 2], [1, 6], [2, 6], [6, 3], [3, 4], [3, 5], [4, 5]],
    style: {
      dotScale: [2, 1.6, 1.6, 2.2, 1.4, 1.4, 1.3],
      pulseFreq: [0.7, 0.5, 0.5, 0.9, 0.6, 0.6, 0.4], pulseAmt: [0.3, 0.2, 0.2, 0.35, 0.2, 0.2, 0.15],
      crossLen: 2.8, crossSpin: 0.3, crossBranches: 4,
      lineAlpha: 0.2, lineShimmer: 0.14,
      bgGlow: 0.07, bgGlowRadius: 0.38,
      flowDir: true,
      trailDots: 3,
    }
  },
  {
    name: 'Glizzy Fish', pts: 2500, color: '#38b6ff',
    dots: [[.08, .5], [.3, .22], [.3, .78], [.55, .28], [.55, .72], [.78, .5], [.95, .38], [.95, .62]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [5, 6], [5, 7], [6, 7]],
    style: {
      dotScale: [1.8, 1.5, 1.5, 1.6, 1.6, 2.4, 1.4, 1.4],
      pulseFreq: [0.6, 0.5, 0.5, 0.7, 0.7, 1.0, 0.5, 0.5], pulseAmt: [0.25, 0.2, 0.2, 0.25, 0.25, 0.4, 0.2, 0.2],
      crossLen: 3.2, crossSpin: 0.4, crossBranches: 4,
      lineAlpha: 0.22, lineShimmer: 0.16,
      bgGlow: 0.08, bgGlowRadius: 0.4,
      flowDir: true,
      trailDots: 3,
      ripple: { speed: 1.2, count: 2 }
    }
  },
  {
    name: 'Baron Of Fish', pts: 5000, color: '#00d4ff',
    dots: [[.5, .06], [.28, .18], [.72, .18], [.1, .5], [.9, .5], [.28, .82], [.72, .82], [.5, .5], [.5, .3]],
    edges: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6], [7, 3], [7, 4], [8, 0], [8, 7]],
    style: {
      dotScale: [3, 1.5, 1.5, 1.6, 1.6, 1.5, 1.5, 1.8, 1.6],
      pulseFreq: [1.3, 0.5, 0.5, 0.6, 0.6, 0.5, 0.5, 0.8, 0.7], pulseAmt: [0.45, 0.2, 0.2, 0.22, 0.22, 0.2, 0.2, 0.3, 0.25],
      crossLen: 3.8, crossSpin: 0.6, crossBranches: 6,
      lineAlpha: 0.24, lineShimmer: 0.18,
      bgGlow: 0.1, bgGlowRadius: 0.45,
      crownGlow: true, flowDir: true,
      trailDots: 4,
    }
  },
  {
    name: 'Shark', pts: 10000, color: '#b87fff',
    dots: [[.5, .08], [.78, .26], [.9, .52], [.72, .82], [.5, .9], [.28, .82], [.1, .52], [.22, .26], [.5, .46], [.5, .24], [.35, .4], [.65, .4]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [8, 2], [8, 6], [9, 0], [9, 8], [10, 6], [10, 8], [11, 2], [11, 8], [10, 11]],
    style: {
      dotScale: [3, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 2, 1.8, 1.4, 1.4],
      pulseFreq: [1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.8, 0.5, 0.5],
      pulseAmt: [0.5, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.35, 0.3, 0.18, 0.18],
      crossLen: 4, crossSpin: 1.0, crossBranches: 4,
      lineAlpha: 0.2, lineShimmer: 0.2,
      bgGlow: 0.1, bgGlowRadius: 0.48,
      electricArcs: true,
      trailDots: 4,
      orbitDots: { count: 3, radius: 0.4, speed: 0.8, r: 1.0, alpha: 0.45 }
    }
  },
  {
    name: 'Fine Shark', pts: 25000, color: '#9f50ff',
    dots: [[.5, .07], [.76, .2], [.9, .48], [.76, .76], [.5, .88], [.24, .76], [.1, .48], [.24, .2], [.5, .48], [.5, .27], [.34, .4], [.66, .4], [.34, .58], [.66, .58]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [8, 2], [8, 6], [9, 0], [9, 8], [10, 6], [10, 8], [11, 2], [11, 8], [10, 11], [12, 5], [12, 8], [13, 3], [13, 8], [12, 13]],
    style: {
      dotScale: [3.2, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 2.2, 2, 1.3, 1.3, 1.3, 1.3],
      pulseFreq: [1.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0.9, 0.5, 0.5, 0.5, 0.5],
      pulseAmt: [0.52, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.38, 0.32, 0.18, 0.18, 0.18, 0.18],
      crossLen: 4.2, crossSpin: 1.2, crossBranches: 4,
      lineAlpha: 0.22, lineShimmer: 0.22,
      bgGlow: 0.11, bgGlowRadius: 0.5,
      electricArcs: true,
      trailDots: 5,
      orbitDots: { count: 3, radius: 0.42, speed: 1.0, r: 1.1, alpha: 0.5 }
    }
  },
  {
    name: 'ZkShark', pts: 100000, color: '#cc88ff',
    dots: [[.5, .06], [.76, .17], [.9, .44], [.82, .74], [.5, .9], [.18, .74], [.1, .44], [.24, .17], [.5, .47], [.5, .26], [.34, .37], [.66, .37], [.34, .59], [.66, .59], [.18, .3], [.82, .3]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [9, 0], [8, 9], [8, 3], [10, 6], [10, 8], [11, 2], [11, 8], [10, 11], [12, 5], [12, 8], [13, 3], [13, 8], [12, 13], [14, 7], [14, 10], [15, 2], [15, 11], [0, 9]],
    style: {
      dotScale: [3.5, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 2.4, 2.2, 1.3, 1.3, 1.3, 1.3, 1.6, 1.6],
      pulseFreq: [1.8, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.1, 1.0, 0.5, 0.5, 0.5, 0.5, 0.7, 0.7],
      pulseAmt: [0.55, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.42, 0.36, 0.18, 0.18, 0.18, 0.18, 0.25, 0.25],
      crossLen: 4.5, crossSpin: 1.5, crossBranches: 8,
      lineAlpha: 0.22, lineShimmer: 0.25,
      bgGlow: 0.12, bgGlowRadius: 0.52,
      electricArcs: true,
      trailDots: 5,
      orbitDots: { count: 4, radius: 0.44, speed: 1.2, r: 1.1, alpha: 0.55 },
      lightning: true,
    }
  },
  {
    name: 'Whale', pts: 250000, color: '#88ccee',
    dots: [[.5, .08], [.74, .16], [.9, .36], [.93, .58], [.76, .8], [.5, .9], [.24, .8], [.07, .58], [.1, .36], [.26, .16], [.5, .5], [.5, .3], [.3, .52], [.7, .52]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [10, 0], [10, 5], [11, 0], [11, 10], [12, 7], [12, 10], [13, 3], [13, 10], [12, 13]],
    style: {
      dotScale: [3.2, 1.4, 1.4, 1.4, 1.4, 1.6, 1.4, 1.4, 1.4, 1.4, 2.0, 1.8, 1.4, 1.4],
      pulseFreq: [0.8, 0.4, 0.4, 0.4, 0.4, 0.6, 0.4, 0.4, 0.4, 0.4, 0.6, 0.55, 0.4, 0.4],
      pulseAmt: [0.45, 0.15, 0.15, 0.15, 0.15, 0.2, 0.15, 0.15, 0.15, 0.15, 0.3, 0.25, 0.15, 0.15],
      crossLen: 4.0, crossSpin: 0.18, crossBranches: 4,
      lineAlpha: 0.18, lineShimmer: 0.12,
      bgGlow: 0.12, bgGlowRadius: 0.55,
      waveRipple: true,
      trailDots: 5,
      orbitDots: { count: 2, radius: 0.48, speed: 0.25, r: 1.2, alpha: 0.35 }
    }
  },
  {
    name: 'Biggy Whale', pts: 500000, color: '#55aadd',
    dots: [[.5, .06], [.74, .14], [.9, .34], [.93, .57], [.78, .79], [.5, .9], [.22, .79], [.07, .57], [.1, .34], [.26, .14], [.5, .48], [.5, .27], [.3, .5], [.7, .5], [.28, .05], [.72, .05], [.5, .01]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [10, 0], [10, 5], [11, 0], [11, 10], [12, 7], [12, 10], [13, 3], [13, 10], [12, 13], [14, 0], [15, 0], [16, 14], [16, 15], [14, 15]],
    style: {
      dotScale: [3.4, 1.4, 1.4, 1.4, 1.4, 1.6, 1.4, 1.4, 1.4, 1.4, 2.1, 1.9, 1.4, 1.4, 1.8, 1.8, 2.2],
      pulseFreq: [0.9, 0.4, 0.4, 0.4, 0.4, 0.6, 0.4, 0.4, 0.4, 0.4, 0.65, 0.6, 0.4, 0.4, 0.8, 0.8, 1.0],
      pulseAmt: [0.48, 0.15, 0.15, 0.15, 0.15, 0.22, 0.15, 0.15, 0.15, 0.15, 0.32, 0.28, 0.15, 0.15, 0.35, 0.35, 0.45],
      crossLen: 4.4, crossSpin: 0.22, crossBranches: 6,
      lineAlpha: 0.2, lineShimmer: 0.14,
      bgGlow: 0.13, bgGlowRadius: 0.58,
      waveRipple: true,
      trailDots: 6,
      orbitDots: { count: 3, radius: 0.5, speed: 0.3, r: 1.2, alpha: 0.4 }
    }
  },
  {
    name: 'Ancient Whale', pts: 750000, color: '#aaddff',
    dots: [[.5, .07], [.74, .15], [.9, .35], [.93, .58], [.78, .8], [.5, .9], [.22, .8], [.07, .58], [.1, .35], [.26, .15], [.5, .48], [.5, .27], [.3, .51], [.7, .51], [.28, .04], [.5, .0], [.72, .04], [.38, .13], [.62, .13]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [10, 0], [10, 5], [11, 0], [11, 10], [12, 7], [12, 10], [13, 3], [13, 10], [12, 13], [14, 15], [15, 16], [14, 17], [16, 18], [17, 0], [18, 0], [17, 18]],
    style: {
      dotScale: [3.6, 1.4, 1.4, 1.4, 1.4, 1.6, 1.4, 1.4, 1.4, 1.4, 2.2, 2.0, 1.4, 1.4, 1.9, 2.4, 1.9, 1.6, 1.6],
      pulseFreq: [0.7, 0.4, 0.4, 0.4, 0.4, 0.5, 0.4, 0.4, 0.4, 0.4, 0.55, 0.5, 0.4, 0.4, 0.7, 0.9, 0.7, 0.6, 0.6],
      pulseAmt: [0.5, 0.14, 0.14, 0.14, 0.14, 0.2, 0.14, 0.14, 0.14, 0.14, 0.32, 0.28, 0.14, 0.14, 0.35, 0.5, 0.35, 0.28, 0.28],
      crossLen: 5, crossSpin: 0.12, crossBranches: 8,
      lineAlpha: 0.2, lineShimmer: 0.16,
      bgGlow: 0.14, bgGlowRadius: 0.6,
      waveRipple: true, ancientRunes: true,
      trailDots: 6,
      orbitDots: { count: 3, radius: 0.52, speed: 0.2, r: 1.3, alpha: 0.45 }
    }
  },
  {
    name: 'White Whale', pts: 1000000, color: '#e8f4ff',
    dots: [[.5, .06], [.72, .13], [.88, .3], [.95, .52], [.88, .72], [.72, .86], [.5, .92], [.28, .86], [.12, .72], [.05, .52], [.12, .3], [.28, .13], [.5, .5], [.5, .28], [.3, .4], [.7, .4], [.3, .62], [.7, .62], [.5, .75], [.18, .52], [.82, .52]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 0], [12, 0], [12, 6], [13, 0], [13, 12], [14, 10], [14, 12], [15, 4], [15, 12], [16, 7], [16, 12], [17, 5], [17, 12], [14, 16], [15, 17], [18, 6], [18, 12], [19, 9], [19, 14], [20, 3], [20, 15]],
    style: {
      dotScale: [4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.6, 1.4, 1.4, 1.5, 1.4, 1.4, 2.4, 2.1, 1.5, 1.5, 1.5, 1.5, 1.8, 1.5, 1.5],
      pulseFreq: [0.6, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, 0.4, 0.3, 0.3, 0.5, 0.45, 0.35, 0.35, 0.35, 0.35, 0.45, 0.35, 0.35],
      pulseAmt: [0.55, 0.12, 0.12, 0.12, 0.12, 0.12, 0.2, 0.12, 0.12, 0.15, 0.12, 0.12, 0.38, 0.3, 0.18, 0.18, 0.18, 0.18, 0.25, 0.18, 0.18],
      crossLen: 6, crossSpin: 0.08, crossBranches: 8,
      lineAlpha: 0.15, lineShimmer: 0.12,
      bgGlow: 0.18, bgGlowRadius: 0.65,
      waveRipple: true, holyGlow: true,
      trailDots: 7,
      orbitDots: { count: 4, radius: 0.54, speed: 0.15, r: 1.4, alpha: 0.5 }
    }
  },
  {
    name: 'Megalodon', pts: 5000000, color: '#ff6030',
    dots: [
      [.5, .05], [.7, .1], [.86, .24], [.95, .44], [.92, .65], [.78, .82], [.5, .92], [.22, .82], [.08, .65], [.05, .44], [.14, .24], [.3, .1],
      [.5, .5], [.5, .3], [.32, .4], [.68, .4], [.32, .62], [.68, .62], [.5, .72],
      [.2, .2], [.8, .2], [.15, .5], [.85, .5], [.2, .75], [.8, .75]
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 0],
      [12, 0], [12, 6], [13, 0], [13, 12], [14, 10], [14, 12], [15, 4], [15, 12],
      [16, 8], [16, 12], [17, 5], [17, 12], [14, 16], [15, 17], [18, 6], [18, 12],
      [19, 11], [19, 14], [20, 3], [20, 15], [13, 18], [19, 20], [21, 9], [21, 16], [22, 3], [22, 17]
    ],
    style: {
      dotScale: [5, 1.6, 1.6, 1.6, 1.6, 1.6, 2.0, 1.6, 1.6, 1.6, 1.6, 1.6, 2.8, 2.4, 1.6, 1.6, 1.6, 1.6, 2.0, 1.8, 1.8, 1.5, 1.5, 1.5, 1.5],
      pulseFreq: [2.2, 0.6, 0.6, 0.6, 0.6, 0.6, 0.8, 0.6, 0.6, 0.6, 0.6, 0.6, 1.4, 1.2, 0.7, 0.7, 0.7, 0.7, 0.9, 0.8, 0.8, 0.6, 0.6, 0.6, 0.6],
      pulseAmt: [0.7, 0.22, 0.22, 0.22, 0.22, 0.22, 0.3, 0.22, 0.22, 0.22, 0.22, 0.22, 0.55, 0.45, 0.25, 0.25, 0.25, 0.25, 0.32, 0.3, 0.3, 0.22, 0.22, 0.22, 0.22],
      crossLen: 7, crossSpin: 2.5, crossBranches: 8,
      lineAlpha: 0.3, lineShimmer: 0.35,
      bgGlow: 0.22, bgGlowRadius: 0.7,
      electricArcs: true, waveRipple: true, holyGlow: false, inferno: true,
      trailDots: 8,
      orbitDots: { count: 5, radius: 0.56, speed: 2.0, r: 1.5, alpha: 0.6 }
    }
  },
];

/** Lookup map for fast access by name */
const RANK_MAP = new Map<string, RankDef>();
RANKS.forEach(r => RANK_MAP.set(r.name, r));

/** Get rank definition by name */
export function getRankDef(name: string): RankDef | undefined {
  return RANK_MAP.get(name);
}

/** Export RANKS for external use (e.g. gallery) */
export { RANKS };

// ── DRAW FUNCTION ────────────────────────────────────────────────────
function drawRank(ctx: CanvasRenderingContext2D, rank: RankDef, size: number, t: number) {
  const pad = size * 0.1;
  const inner = size - pad * 2;
  const [r, g, b] = hex2rgb(rank.color);
  const s = rank.style;

  ctx.clearRect(0, 0, size, size);

  const pts = rank.dots.map(([x, y]) => [pad + x * inner, pad + y * inner] as [number, number]);
  const cx = size / 2, cy = size / 2;

  // ── BG ambient glow ──
  const bgR = s.bgGlowRadius * size;
  const bgAlpha = s.bgGlow * (0.8 + 0.2 * Math.sin(t * 0.5));
  const bgGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, bgR);
  bgGrd.addColorStop(0, `rgba(${r},${g},${b},${bgAlpha * 2.5})`);
  bgGrd.addColorStop(0.4, `rgba(${r},${g},${b},${bgAlpha})`);
  bgGrd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = bgGrd;
  ctx.fillRect(0, 0, size, size);

  // ── Inferno: fiery radial pulses ──
  if (s.inferno) {
    for (let p = 0; p < 3; p++) {
      const phase = (t * 0.8 + p * 0.33) % 1.0;
      const rr = phase * bgR * 1.1;
      const aa = (1 - phase) * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${aa})`;
      ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // ── Holy glow: white outer rings ──
  if (s.holyGlow) {
    for (let p = 0; p < 2; p++) {
      const phase = (t * 0.3 + p * 0.5) % 1.0;
      const rr = bgR * 0.5 + phase * bgR * 0.6;
      const aa = (1 - phase) * 0.07;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${aa})`;
      ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // ── Wave ripple (whale family) ──
  if (s.waveRipple) {
    for (let p = 0; p < 3; p++) {
      const phase = (t * 0.5 + p * 0.33) % 1.0;
      const rr = phase * bgR * 1.3;
      const aa = (1 - phase) * 0.06;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${aa})`;
      ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  // ── Orbit dots ──
  if (s.orbitDots) {
    const od = s.orbitDots;
    const orbitR = od.radius * inner * 0.5;
    for (let i = 0; i < od.count; i++) {
      const angle = t * od.speed + (i / od.count) * Math.PI * 2;
      const ox = cx + Math.cos(angle) * orbitR;
      const oy = cy + Math.sin(angle) * orbitR;
      const dotR = od.r * (size <= 60 ? 1 : 2);
      const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, dotR * 3);
      halo.addColorStop(0, `rgba(${r},${g},${b},${od.alpha * 0.4})`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ox, oy, dotR * 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ox, oy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${od.alpha})`; ctx.fill();
    }
  }

  // ── Electric arcs (shark family) ──
  if (s.electricArcs && size > 60) {
    const arcCount = 2;
    for (let a = 0; a < arcCount; a++) {
      const phase = (t * 2.5 + a * 0.5) % 1.0;
      if (phase > 0.6) {
        const startIdx = Math.floor((t * 7 + a * 3)) % pts.length;
        const endIdx = (startIdx + 2 + a) % pts.length;
        const [sx, sy] = pts[startIdx];
        const [ex, ey] = pts[endIdx];
        const alpha = (1 - phase / 0.4) * 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        const mx = lerp(sx, ex, 0.5) + (Math.random() - 0.5) * inner * 0.15;
        const my = lerp(sy, ey, 0.5) + (Math.random() - 0.5) * inner * 0.15;
        ctx.quadraticCurveTo(mx, my, ex, ey);
        ctx.strokeStyle = `rgba(220,180,255,${alpha})`;
        ctx.lineWidth = 0.7; ctx.stroke();
      }
    }
  }

  // ── EDGES ──
  const lw = size <= 60 ? 0.7 : 1.3;
  rank.edges.forEach(([a, bb], ei) => {
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[bb];
    const phase = (t * 0.45 + ei * 0.29) % (Math.PI * 2);
    const alpha = s.lineAlpha + s.lineShimmer * Math.sin(phase);

    // flow direction — brighter at head
    if (s.flowDir) {
      const sp = (t * 0.35 + ei * 0.17) % 1.0;
      const linG = ctx.createLinearGradient(
        lerp(x1, x2, Math.max(0, sp - 0.3)), lerp(y1, y2, Math.max(0, sp - 0.3)),
        lerp(x1, x2, Math.min(1, sp + 0.3)), lerp(y1, y2, Math.min(1, sp + 0.3))
      );
      linG.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.3})`);
      linG.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 1.8})`);
      linG.addColorStop(1, `rgba(${r},${g},${b},${alpha * 0.3})`);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = linG; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
    }

    // glow pass
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.35})`;
    ctx.lineWidth = lw * 4; ctx.lineCap = 'round'; ctx.stroke();

    // core
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = lw; ctx.stroke();

    // travelling sparkle
    if (s.trailDots > 0) {
      for (let td = 0; td < Math.min(s.trailDots, 2); td++) {
        const sp2 = ((t * 0.3 + ei * 0.13 + td * 0.5) % 1.0);
        const sx = lerp(x1, x2, sp2), sy = lerp(y1, y2, sp2);
        const sa = 0.7 * Math.sin(sp2 * Math.PI);
        ctx.beginPath(); ctx.arc(sx, sy, size <= 60 ? 0.8 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${sa})`; ctx.fill();
      }
    }
  });

  // ── DOTS ──
  pts.forEach(([x, y], i) => {
    const isMain = i === 0;
    const scale = (s.dotScale && s.dotScale[i]) || (isMain ? 3.5 : 1.5);
    const pf = (s.pulseFreq && s.pulseFreq[i]) || (isMain ? 1.0 : 0.5);
    const pa = (s.pulseAmt && s.pulseAmt[i]) || (isMain ? 0.4 : 0.2);
    const pulse = 1 + pa * Math.sin(t * pf + i * 1.1);
    const baseR = scale * (size <= 60 ? 1.0 : 2.2);
    const dotR = baseR * pulse;

    // outer halo
    const haloR = dotR * (isMain ? 4 : 3);
    const hGrd = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    hGrd.addColorStop(0, `rgba(${r},${g},${b},${(isMain ? .14 : .07) * pulse})`);
    hGrd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fillStyle = hGrd; ctx.fill();

    // mid glow
    const mGrd = ctx.createRadialGradient(x, y, 0, x, y, dotR * 2.2);
    mGrd.addColorStop(0, `rgba(${r},${g},${b},${0.5 * pulse})`);
    mGrd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(x, y, dotR * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = mGrd; ctx.fill();

    // white core
    const cGrd = ctx.createRadialGradient(x, y, 0, x, y, dotR);
    cGrd.addColorStop(0, 'rgba(255,255,255,0.98)');
    cGrd.addColorStop(0.35, `rgba(${r},${g},${b},1)`);
    cGrd.addColorStop(1, `rgba(${r},${g},${b},0.5)`);
    ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fillStyle = cGrd; ctx.fill();

    // sparkle rays on main + big dots
    if (isMain || scale >= 2.8) {
      const branches = isMain ? (s.crossBranches || 4) : 4;
      const cl = dotR * (isMain ? (s.crossLen || 3.5) : 2.5);
      const spin = isMain ? (s.crossSpin || 0.3) : 0.2;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * spin);
      for (let br = 0; br < branches; br++) {
        const angle = (br / branches) * Math.PI * 2;
        const llen = cl * (br % 2 === 0 ? 1 : 0.6);
        const lGrd = ctx.createLinearGradient(0, 0, Math.cos(angle) * llen, Math.sin(angle) * llen);
        lGrd.addColorStop(0, `rgba(255,255,255,${0.6 + 0.3 * Math.sin(t * pf)})`);
        lGrd.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * llen, Math.sin(angle) * llen);
        ctx.strokeStyle = lGrd;
        ctx.lineWidth = size <= 60 ? 0.6 : 1.0;
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  // ── Crown glow pulse ──
  if (s.crownGlow) {
    const [x0, y0] = pts[0];
    const crR = (s.dotScale[0] || 3) * (size <= 60 ? 1.0 : 2.2) * 5;
    const crA = 0.08 + 0.05 * Math.sin(t * 2);
    const crGrd = ctx.createRadialGradient(x0, y0, 0, x0, y0, crR);
    crGrd.addColorStop(0, `rgba(255,220,150,${crA})`);
    crGrd.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.beginPath(); ctx.arc(x0, y0, crR, 0, Math.PI * 2);
    ctx.fillStyle = crGrd; ctx.fill();
  }
}

// ── SHARED ANIMATION MANAGER ─────────────────────────────────────────
// Batches all visible constellation canvases into a single rAF loop
type CanvasEntry = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rank: RankDef;
  size: number;
};

const activeCanvases = new Map<string, CanvasEntry>();
let globalAnimId: number | null = null;

function startGlobalAnim() {
  if (globalAnimId !== null) return;
  function tick(ts: number) {
    const t = ts * 0.001;
    activeCanvases.forEach(entry => {
      drawRank(entry.ctx, entry.rank, entry.size, t);
    });
    globalAnimId = requestAnimationFrame(tick);
  }
  globalAnimId = requestAnimationFrame(tick);
}

function stopGlobalAnim() {
  if (globalAnimId !== null) {
    cancelAnimationFrame(globalAnimId);
    globalAnimId = null;
  }
}

function registerCanvas(id: string, entry: CanvasEntry) {
  activeCanvases.set(id, entry);
  startGlobalAnim();
}

function unregisterCanvas(id: string) {
  activeCanvases.delete(id);
  if (activeCanvases.size === 0) stopGlobalAnim();
}

// ── REACT COMPONENT ──────────────────────────────────────────────────
let instanceCounter = 0;

export type ConstellationStatus = 'passed' | 'current' | 'locked';

interface ConstellationRankProps {
  /** Tier name — must match one of the 15 rank names */
  name: string;
  /** Canvas pixel size (will render at this × devicePixelRatio for retina) */
  size?: number;
  /** Display status — controls dimming/blur */
  status?: ConstellationStatus;
  /** Whether to animate (false = static single frame) */
  animate?: boolean;
}

export const ConstellationRank = memo(function ConstellationRank({
  name,
  size = 52,
  status = 'current',
  animate = true,
}: ConstellationRankProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idRef = useRef(`cr-${++instanceCounter}`);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rank = RANK_MAP.get(name);
    if (!rank) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    if (animate) {
      const id = idRef.current;
      registerCanvas(id, { canvas, ctx, rank, size });
      return () => unregisterCanvas(id);
    } else {
      // Static render — draw once
      drawRank(ctx, rank, size, 0);
    }
  }, [name, size, animate]);

  const rank = RANK_MAP.get(name);

  // Status-based visual treatment
  const filterStyle: React.CSSProperties = status === 'locked'
    ? { filter: 'blur(1.5px) saturate(0.3) brightness(0.35)', opacity: 0.35 }
    : status === 'passed'
      ? { filter: 'brightness(0.65) saturate(0.5)', opacity: 0.7 }
      : {};

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        display: 'block',
        transition: 'filter 0.3s, opacity 0.3s',
        ...filterStyle,
      }}
      title={rank ? `${rank.name} — ${rank.pts >= 1e6 ? `${(rank.pts / 1e6).toFixed(0)}M` : rank.pts >= 1e3 ? `${(rank.pts / 1e3).toFixed(0)}K` : rank.pts} pts` : name}
    />
  );
});

/** Convenience: constellation + label in a styled container (for galleries etc.) */
export function ConstellationRankCard({
  name,
  size = 52,
  status = 'current',
  showLabel = true,
  showPts = true,
}: {
  name: string;
  size?: number;
  status?: ConstellationStatus;
  showLabel?: boolean;
  showPts?: boolean;
}) {
  const rank = RANK_MAP.get(name);
  if (!rank) return null;

  const [r, g, b] = hex2rgb(rank.color);
  const isCurrent = status === 'current';
  const isPassed = status === 'passed';
  const isLocked = status === 'locked';

  // 3 distinct border styles
  const borderColor = isCurrent
    ? `rgba(${r},${g},${b},0.4)`         // current: rank color glow
    : isPassed
      ? 'rgba(130,196,160,0.35)'           // passed: green "completed" tint
      : 'rgba(255,255,255,0.04)';          // locked: barely visible

  // 3 distinct backgrounds
  const bgColor = isCurrent
    ? `rgba(${r},${g},${b},0.06)`         // current: subtle rank color
    : isPassed
      ? 'rgba(130,196,160,0.06)'           // passed: subtle green
      : 'rgba(255,255,255,0.015)';         // locked: near-invisible

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size > 60 ? 10 : 4,
      padding: size > 60 ? '14px 8px 10px' : '4px 2px',
      borderRadius: size > 60 ? 14 : 6,
      border: `1px solid ${borderColor}`,
      background: bgColor,
      cursor: 'pointer', position: 'relative', overflow: 'hidden',
      transition: 'transform 0.3s ease, border-color 0.3s, box-shadow 0.3s',
      boxShadow: isCurrent ? `0 0 12px rgba(${r},${g},${b},0.15)` : 'none',
    }}>
      {/* Passed: small check badge */}
      {isPassed && (
        <div style={{
          position: 'absolute',
          top: size > 60 ? 4 : 1,
          right: size > 60 ? 4 : 1,
          width: size > 60 ? 14 : 8,
          height: size > 60 ? 14 : 8,
          borderRadius: '50%',
          background: 'rgba(130,196,160,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size > 60 ? '8px' : '5px',
          color: '#0a1628',
          fontWeight: 900,
          lineHeight: 1,
          zIndex: 2,
        }}>✓</div>
      )}
      <ConstellationRank name={name} size={size} status={status} />
      {showLabel && (
        <div style={{
          fontFamily: "'Fredoka', sans-serif",
          fontSize: size > 60 ? '0.68rem' : '0.38rem',
          fontWeight: 700,
          color: isCurrent ? rank.color
            : isPassed ? 'rgba(130,196,160,0.8)'   // passed: green text
            : '#332d50',                             // locked: dark
          textAlign: 'center', lineHeight: 1.2,
          opacity: isCurrent ? 0.9 : isPassed ? 0.85 : 0.6,
        }}>{rank.name}</div>
      )}
      {showPts && (
        <div style={{
          fontFamily: "'Space Mono', monospace",
          fontSize: size > 60 ? '0.48rem' : '0.3rem',
          color: isCurrent ? 'rgba(255,255,255,0.3)'
            : isPassed ? 'rgba(130,196,160,0.4)'
            : '#332d50',
          letterSpacing: '0.05em',
        }}>{fmtPts(rank.pts)}</div>
      )}
    </div>
  );
}

function fmtPts(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M pts`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K pts`;
  return `${n} pts`;
}

/** Section groupings */
export const RANK_SECTIONS = [
  { label: 'Newcomers', names: ['Newcomer', 'Plancton', 'Shrimp', 'King Shrimp', 'Fish'] },
  { label: 'Deep Sea', names: ['Glizzy Fish', 'Baron Of Fish', 'Shark', 'Fine Shark', 'ZkShark'] },
  { label: 'Apex', names: ['Whale', 'Biggy Whale', 'Ancient Whale', 'White Whale', 'Megalodon'] },
];

/** Full constellation gallery with section headers — replaces old TierGallery */
export function ConstellationGallery({ currentTierIndex }: { currentTierIndex: number }) {
  const allNames = RANK_SECTIONS.flatMap(s => s.names);

  return (
    <div style={{ marginTop: 8 }}>
      {RANK_SECTIONS.map(section => (
        <div key={section.label}>
          {/* Section divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px',
          }}>
            <span style={{
              fontFamily: "'Space Mono', monospace", fontSize: '0.42rem',
              letterSpacing: '0.18em', textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.12)',
            }}>{section.label}</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.04)' }} />
          </div>
          {/* 5-column grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6,
            padding: 6, borderRadius: 8,
            background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.04)',
          }}>
            {section.names.map(rname => {
              const idx = allNames.indexOf(rname);
              const status: ConstellationStatus = idx < currentTierIndex ? 'passed' : idx === currentTierIndex ? 'current' : 'locked';
              return (
                <ConstellationRankCard
                  key={rname}
                  name={rname}
                  size={22}
                  status={status}
                  showPts={false}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
