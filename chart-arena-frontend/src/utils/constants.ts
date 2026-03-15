// SEC-9 FIX: Auto-derive WS URL from page origin if VITE_WS_URL not set.
// Deployed builds behind nginx get wss://domain/ws automatically.
function deriveWsUrl(): string {
    const explicit = import.meta.env.VITE_WS_URL;
    if (explicit) return explicit;
    if (typeof window !== 'undefined' && window.location) {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://localhost:8080';
}
export const WS_URL = deriveWsUrl();
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://testnet.opnet.org';
export const ESCROW_ADDRESS = 'opt1sqqkgy2qk9lvsc6d4lz2f5y8x7vj5dmmd4y9j82aq';
export const ESCROW_ADDRESS_HEX = '0xbce38383b13b9895445f2fe53bd69487f88617572004cf7635ab778e2242f2ed';
export const MOTO_TOKEN = import.meta.env.VITE_MOTO ?? '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd';

export const GameMode = { CLASSIC: 0, SURVIVAL: 1, CHAOS: 2 } as const;
export const Format = { DUEL: 0, ARENA: 1 } as const;

export function truncAddr(addr: string): string {
    if (addr.length <= 16) return addr;
    return addr.slice(0, 8) + '...' + addr.slice(-6);
}

export function formatValue(val: number): string {
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Buy-In Tiers ──
export const BuyInTier = { BRONZE: 0, SILVER: 1, GOLD: 2 } as const;
export type BuyInTierValue = (typeof BuyInTier)[keyof typeof BuyInTier];

export const TIER_INFO: Record<BuyInTierValue, { name: string; amount: string; emoji: string; color: string }> = {
    [BuyInTier.BRONZE]: { name: 'Bronze', amount: '5 MOTO',   emoji: '🥉', color: '#cd7f32' },
    [BuyInTier.SILVER]: { name: 'Silver', amount: '25 MOTO',  emoji: '🥈', color: '#c0c0c0' },
    [BuyInTier.GOLD]:   { name: 'Gold',   amount: '100 MOTO', emoji: '🥇', color: '#ffd700' },
};

/** On-chain MOTO amounts per tier (18 decimals) — used for on-chain tx */
export const TIER_AMOUNTS: Record<BuyInTierValue, string> = {
    [BuyInTier.BRONZE]: '5000000000000000000',
    [BuyInTier.SILVER]: '25000000000000000000',
    [BuyInTier.GOLD]:   '100000000000000000000',
};

export interface TierUnlockStatus {
    tier: BuyInTierValue;
    name: string;
    display: string;
    unlocked: boolean;
    matchesRequired: number;
    matchesPlayed: number;
    matchesRemaining: number;
}

export interface AvailableQueue {
    tier: BuyInTierValue;
    tierName: string;
    tierDisplay: string;
    mode: number;
    format: number;
    enabled: boolean;
    reason?: string;
}

export interface QueueAvailability {
    onlinePlayers: number;
    available: AvailableQueue[];
    nextUnlock: { playersNeeded: number; description: string } | null;
}
