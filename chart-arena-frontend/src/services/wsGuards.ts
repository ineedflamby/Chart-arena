/**
 * WebSocket Message Type Guards
 * Runtime validation for all incoming WS messages.
 * Prevents crashes from malformed/unexpected server data.
 */

/** Assert a field is present and of the expected type */
function has<T>(msg: Record<string, unknown>, key: string, type: string): msg is Record<string, unknown> & Record<typeof key, T> {
    return key in msg && typeof msg[key] === type;
}

function hasNum(msg: Record<string, unknown>, key: string): boolean {
    return key in msg && typeof msg[key] === 'number';
}

function hasStr(msg: Record<string, unknown>, key: string): boolean {
    return key in msg && typeof msg[key] === 'string';
}

function hasBool(msg: Record<string, unknown>, key: string): boolean {
    return key in msg && typeof msg[key] === 'boolean';
}

function hasArr(msg: Record<string, unknown>, key: string): boolean {
    return key in msg && Array.isArray(msg[key]);
}

/** Safely extract typed fields with fallbacks */
export function str(msg: Record<string, unknown>, key: string, fallback = ''): string {
    return hasStr(msg, key) ? msg[key] as string : fallback;
}

export function num(msg: Record<string, unknown>, key: string, fallback = 0): number {
    return hasNum(msg, key) ? msg[key] as number : fallback;
}

export function bool(msg: Record<string, unknown>, key: string, fallback = false): boolean {
    return hasBool(msg, key) ? msg[key] as boolean : fallback;
}

export function arr<T = unknown>(msg: Record<string, unknown>, key: string): T[] {
    return hasArr(msg, key) ? msg[key] as T[] : [];
}

export function obj(msg: Record<string, unknown>, key: string): Record<string, unknown> {
    return has(msg, key, 'object') && msg[key] !== null ? msg[key] as Record<string, unknown> : {};
}

// ═══════════════════════════════════════
// MESSAGE VALIDATORS
// ═══════════════════════════════════════

export interface ValidatedTick {
    tick: number;
    price: number;
    phase: string;
}

export function validateTick(msg: Record<string, unknown>): ValidatedTick | null {
    if (!hasNum(msg, 'tick') || !hasNum(msg, 'price') || !hasStr(msg, 'phase')) return null;
    return { tick: msg.tick as number, price: msg.price as number, phase: msg.phase as string };
}

export interface ValidatedItemDrop {
    player: string;
    item: number;
}

export function validateItemDrops(msg: Record<string, unknown>): ValidatedItemDrop[] {
    const drops = arr(msg, 'drops');
    return drops.filter((d: any) => typeof d?.player === 'string' && typeof d?.item === 'number') as ValidatedItemDrop[];
}

export interface ValidatedStanding {
    address: string;
    rank: number;
    finalEquity: number;
    positionStatus: string;
    eliminated?: boolean;
    eliminatedAtTick?: number;
}

export function validateStandings(msg: Record<string, unknown>): ValidatedStanding[] {
    const standings = arr(msg, 'standings');
    // FIX: Backend sends finalEquity, not pnl/capital
    return standings.filter((s: any) =>
        typeof s?.address === 'string' &&
        typeof s?.rank === 'number' &&
        typeof s?.finalEquity === 'number'
    ) as ValidatedStanding[];
}

export function validatePlayer(msg: Record<string, unknown>): { address: string; name?: string } | null {
    if (!hasStr(msg, 'address')) return null;
    return { address: msg.address as string, name: hasStr(msg, 'name') ? msg.name as string : undefined };
}

export function validateChat(msg: Record<string, unknown>): { channel: string; sender: string; text: string; senderName?: string } | null {
    if (!hasStr(msg, 'channel') || !hasStr(msg, 'sender') || !hasStr(msg, 'text')) return null;
    return {
        channel: msg.channel as string,
        sender: msg.sender as string,
        text: msg.text as string,
        senderName: hasStr(msg, 'senderName') ? msg.senderName as string : undefined,
    };
}
