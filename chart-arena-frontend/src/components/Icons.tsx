/**
 * Chart Arena — Custom SVG Icons
 * Mode icons (Classic, Survival, Chaos) + 15 Tier rank icons
 */
import React from 'react';

/* ═══════════════════════════════════════
   MODE ICONS
   ═══════════════════════════════════════ */

/** Classic — Rising candlestick chart with crown */
export function ClassicIcon({ size = 48, active = false }: { size?: number; active?: boolean }) {
    const o = active ? 1 : 0.5;
    const blur = active ? 3 : 1.5;
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
            <defs>
                <linearGradient id="clg" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#3ba55d"/><stop offset="100%" stopColor="#D1FEB8"/></linearGradient>
                <filter id="clf"><feGaussianBlur stdDeviation={String(blur)} result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <g filter="url(#clf)" opacity={o}>
                <rect x="10" y="32" width="6" height="14" rx="1" fill="url(#clg)" opacity={0.6}/>
                <line x1="13" y1="30" x2="13" y2="48" stroke="url(#clg)" strokeWidth="1.2" opacity={0.4}/>
                <rect x="20" y="24" width="6" height="16" rx="1" fill="url(#clg)" opacity={0.7}/>
                <line x1="23" y1="20" x2="23" y2="42" stroke="url(#clg)" strokeWidth="1.2" opacity={0.5}/>
                <rect x="30" y="28" width="6" height="12" rx="1" fill="url(#clg)" opacity={0.65}/>
                <line x1="33" y1="24" x2="33" y2="42" stroke="url(#clg)" strokeWidth="1.2" opacity={0.45}/>
                <rect x="40" y="14" width="8" height="24" rx="1.5" fill="url(#clg)" opacity={0.9}/>
                <line x1="44" y1="10" x2="44" y2="40" stroke="url(#clg)" strokeWidth="1.5" opacity={0.7}/>
                <rect x="40" y="14" width="8" height="24" rx="1.5" fill="none" stroke="#D1FEB8" strokeWidth="0.5" opacity={active ? 0.5 : 0.2}/>
                <path d="M10 44 Q22 36 30 34 Q38 32 50 14" stroke="#D1FEB8" strokeWidth="1.5" strokeDasharray={active ? undefined : '4 3'} fill="none" opacity={active ? 0.6 : 0.3} strokeLinecap="round"/>
                <path d="M38 12 L41 6 L44 10 L47 6 L50 12 Z" fill="#E7D27C" opacity={active ? 0.9 : 0.4}/>
                <circle cx="41" cy="6.5" r="1" fill="#FFFEE0" opacity={active ? 0.8 : 0.3}/>
                <circle cx="44" cy="9" r="1" fill="#FFFEE0" opacity={active ? 0.8 : 0.3}/>
                <circle cx="47" cy="6.5" r="1" fill="#FFFEE0" opacity={active ? 0.8 : 0.3}/>
                {active && (
                    <>
                        <text x="8" y="18" fontFamily="Fredoka" fontSize="9" fill="#D1FEB8" opacity={0.5} fontWeight={700}>$</text>
                        <circle cx="54" cy="28" r="1.2" fill="#D1FEB8" opacity={0.5}><animate attributeName="r" values="0.8;1.8;0.8" dur="2s" repeatCount="indefinite"/></circle>
                        <circle cx="8" cy="26" r="1" fill="#6dd5a0" opacity={0.4}><animate attributeName="r" values="0.5;1.5;0.5" dur="2.5s" repeatCount="indefinite"/></circle>
                    </>
                )}
            </g>
        </svg>
    );
}

/** Survival — Skull with heartbeat flatline */
export function SurvivalIcon({ size = 48, active = false }: { size?: number; active?: boolean }) {
    const o = active ? 1 : 0.5;
    const blur = active ? 3 : 1.5;
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
            <defs>
                <linearGradient id="svg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#F6B8D0"/><stop offset="100%" stopColor="#c03060"/></linearGradient>
                <filter id="svf"><feGaussianBlur stdDeviation={String(blur)} result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <g filter="url(#svf)" opacity={o}>
                <path d="M32 10 Q44 10 48 22 Q50 28 48 32 L42 34 Q42 38 38 40 L36 38 L34 40 L32 38 L30 40 L28 38 L26 40 Q22 38 22 34 L16 32 Q14 28 16 22 Q20 10 32 10 Z" fill="url(#svg)" opacity={0.85}/>
                <path d="M23 22 L27 20 L29 24 L25 26 Z" fill="#0a0914"/>
                <path d="M35 24 L37 20 L41 22 L39 26 Z" fill="#0a0914"/>
                <circle cx="26" cy="23" r="1.5" fill={active ? '#F6B8D0' : '#3a1828'} opacity={active ? 0.9 : 0.4}>
                    {active && <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/>}
                </circle>
                <circle cx="38" cy="23" r="1.5" fill={active ? '#F6B8D0' : '#3a1828'} opacity={active ? 0.9 : 0.4}>
                    {active && <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/>}
                </circle>
                <path d="M30 28 L32 31 L34 28" fill="#0a0914" opacity={0.5}/>
                <path d="M4 50 L18 50 L22 42 L26 54 L30 46 L32 50 L64 50" stroke="#F6B8D0" strokeWidth="1.5" fill="none" opacity={active ? 0.6 : 0.25} strokeLinecap="round" strokeLinejoin="round"/>
                {active && (
                    <path d="M4 50 L18 50 L22 42 L26 54 L30 46 L32 50 L64 50" stroke="#F6B8D0" strokeWidth="1.5" fill="none" opacity={0.3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40 60">
                        <animate attributeName="stroke-dashoffset" from="0" to="-100" dur="2s" repeatCount="indefinite"/>
                    </path>
                )}
                <path d="M10 12 L16 18 M16 12 L10 18" stroke="#F6B8D0" strokeWidth="1.5" strokeLinecap="round" opacity={0.15}/>
                <path d="M48 12 L54 18 M54 12 L48 18" stroke="#F6B8D0" strokeWidth="1.5" strokeLinecap="round" opacity={0.15}/>
            </g>
        </svg>
    );
}

/** Chaos — Vortex rings with lightning bolt */
export function ChaosIcon({ size = 48, active = false }: { size?: number; active?: boolean }) {
    const o = active ? 1 : 0.5;
    const blur = active ? 3.5 : 1.5;
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
            <defs>
                <linearGradient id="chg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#EBCCFF"/><stop offset="50%" stopColor="#BEDDF1"/><stop offset="100%" stopColor="#F6B8D0"/></linearGradient>
                <filter id="chgf"><feGaussianBlur stdDeviation={String(blur)} result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <g filter="url(#chgf)" opacity={o}>
                <circle cx="32" cy="32" r="22" stroke="url(#chg)" strokeWidth="2" fill="none" opacity={0.4} strokeDasharray="8 6">
                    {active && <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="12s" repeatCount="indefinite"/>}
                </circle>
                <circle cx="32" cy="32" r="16" stroke="url(#chg)" strokeWidth="2.2" fill="none" opacity={0.6} strokeDasharray="6 5">
                    {active && <animateTransform attributeName="transform" type="rotate" from="360 32 32" to="0 32 32" dur="8s" repeatCount="indefinite"/>}
                </circle>
                <circle cx="32" cy="32" r="10" stroke="url(#chg)" strokeWidth="2.5" fill="none" opacity={0.8} strokeDasharray="4 4">
                    {active && <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="5s" repeatCount="indefinite"/>}
                </circle>
                <path d="M34 18 L28 30 L33 30 L30 46 L36 34 L31 34 Z" fill="url(#chg)" opacity={active ? 0.95 : 0.6}/>
                {active && (
                    <>
                        <circle cx="32" cy="8" r="2.5" fill="#EBCCFF" opacity={0.7}><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="4s" repeatCount="indefinite"/></circle>
                        <circle cx="54" cy="32" r="2" fill="#BEDDF1" opacity={0.6}><animateTransform attributeName="transform" type="rotate" from="90 32 32" to="450 32 32" dur="6s" repeatCount="indefinite"/></circle>
                        <circle cx="32" cy="56" r="1.8" fill="#F6B8D0" opacity={0.5}><animateTransform attributeName="transform" type="rotate" from="180 32 32" to="540 32 32" dur="5s" repeatCount="indefinite"/></circle>
                    </>
                )}
            </g>
        </svg>
    );
}

export const MODE_ICON_MAP: Record<number, React.FC<{ size?: number; active?: boolean }>> = {
    0: ClassicIcon,
    1: SurvivalIcon,
    2: ChaosIcon,
};

/* ═══════════════════════════════════════
   TIER ICONS — 15 constellation ranks
   Now uses animated canvas via ConstellationRank
   Status: 'passed' = dark, 'current' = glow, 'locked' = blurred
   ═══════════════════════════════════════ */

import { ConstellationRank, ConstellationGallery, type ConstellationStatus } from './ConstellationRank';

type TierStatus = 'passed' | 'current' | 'locked';

/** Returns animated constellation canvas for a given tier name and status */
export function TierIcon({ name, size = 28, status = 'current' }: { name: string; size?: number; status?: TierStatus }) {
    return (
        <div style={{ display: 'inline-flex', transition: 'all 0.3s' }}>
            <ConstellationRank
                name={name}
                size={size}
                status={status as ConstellationStatus}
                animate={status === 'current'}
            />
        </div>
    );
}

/** Tier gallery component — constellation rank gallery with section headers */
export function TierGallery({ currentTierIndex }: { currentTierIndex: number }) {
    return <ConstellationGallery currentTierIndex={currentTierIndex} />;
}
export const VOLUME_TIERS = [
    { min: 0,       name: 'Newcomer' },
    { min: 50,      name: 'Plancton' },
    { min: 100,     name: 'Shrimp' },
    { min: 500,     name: 'King Shrimp' },
    { min: 1000,    name: 'Fish' },
    { min: 2500,    name: 'Glizzy Fish' },
    { min: 5000,    name: 'Baron Of Fish' },
    { min: 10000,   name: 'Shark' },
    { min: 25000,   name: 'Fine Shark' },
    { min: 100000,  name: 'ZkShark' },
    { min: 250000,  name: 'Whale' },
    { min: 500000,  name: 'Biggy Whale' },
    { min: 750000,  name: 'Ancient Whale' },
    { min: 1000000, name: 'White Whale' },
    { min: 5000000, name: 'Megalodon' },
];

/** Get current tier index from volume */
export function getTierIndex(volumeUsd: number): number {
    for (let i = VOLUME_TIERS.length - 1; i >= 0; i--) {
        if (volumeUsd >= VOLUME_TIERS[i].min) return i;
    }
    return 0;
}


