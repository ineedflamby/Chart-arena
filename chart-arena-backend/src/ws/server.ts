/**
 * WebSocket Server — real-time game communication.
 * Uses ws library. Can be swapped to uWebSockets.js later for perf.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ServerMsg } from '../utils/constants.js';
import { generateNonce, removeSession, getPlayerAddress, AUTH_TIMEOUT_MS } from './auth.js';
import { getQueueAvailability } from '../services/buy-in-tiers.js';

const TAG = 'WSServer';

// SEC-5 FIX: 5 msg/sec is sufficient for gameplay (trade + item + chat)
const MAX_MESSAGES_PER_SECOND = 15;

export interface SocketData {
    readonly id: string;
    matchId: string | null;
    msgCount: number;
    msgWindowStart: number;
    authTimer: ReturnType<typeof setTimeout> | null;
}

export interface GameSocket extends WebSocket {
    _data: SocketData;
}

const playerSockets = new Map<string, GameSocket>();
const allSockets = new Map<string, GameSocket>();
// BE-6 FIX: matchId â†’ Set<wsId> index for O(1) match broadcasts instead of O(n) full scan
const matchSockets = new Map<string, Set<string>>();

type MessageHandler = (ws: GameSocket, msg: Record<string, unknown>) => void;
type DisconnectHandler = (address: string, matchId: string) => void;
let _handleMessage: MessageHandler | null = null;
let _handleDisconnect: DisconnectHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
    _handleMessage = handler;
}

export function setDisconnectHandler(handler: DisconnectHandler): void {
    _handleDisconnect = handler;
}

export function sendToSocket(ws: GameSocket, type: string, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...payload }));
    }
}

export function sendToPlayer(address: string, type: string, payload: Record<string, unknown>): void {
    const ws = playerSockets.get(address);
    if (ws) sendToSocket(ws, type, payload);
}

export function broadcastToMatch(matchId: bigint, type: string, payload: Record<string, unknown>): void {
    const matchIdStr = matchId.toString();
    const socketIds = matchSockets.get(matchIdStr);
    if (!socketIds || socketIds.size === 0) return;
    const msg = JSON.stringify({ type, ...payload });
    for (const wsId of socketIds) {
        const ws = allSockets.get(wsId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
        }
    }
}

/**
 * R-17: Broadcast to all players in a match EXCEPT one (e.g., Blackout affects everyone except user).
 */
export function broadcastToMatchExcept(
    matchId: bigint, excludeAddress: string, type: string, payload: Record<string, unknown>,
): void {
    const matchIdStr = matchId.toString();
    const socketIds = matchSockets.get(matchIdStr);
    if (!socketIds || socketIds.size === 0) return;
    const msg = JSON.stringify({ type, ...payload });
    for (const wsId of socketIds) {
        const ws = allSockets.get(wsId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            const addr = getPlayerAddress(ws._data.id);
            if (addr !== excludeAddress) ws.send(msg);
        }
    }
}

/**
 * R-17: Broadcast per-player variant messages (e.g., Mirror Curse sends inverted price to one player).
 * payloadFn receives the player address and returns the payload for that player, or null to skip.
 */
export function broadcastToMatchFiltered(
    matchId: bigint, type: string, payloadFn: (address: string) => Record<string, unknown> | null,
): void {
    const matchIdStr = matchId.toString();
    const socketIds = matchSockets.get(matchIdStr);
    if (!socketIds || socketIds.size === 0) return;
    for (const wsId of socketIds) {
        const ws = allSockets.get(wsId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            const addr = getPlayerAddress(ws._data.id);
            if (!addr) continue;
            const payload = payloadFn(addr);
            if (payload !== null) {
                ws.send(JSON.stringify({ type, ...payload }));
            }
        }
    }
}

export function registerPlayerSocket(address: string, ws: GameSocket): void {
    playerSockets.set(address, ws);
    broadcastOnlineStatus();
}

export function assignToMatch(ws: GameSocket, matchId: bigint): void {
    const matchIdStr = matchId.toString();
    // BE-6: Remove from old match index if reassigned
    if (ws._data.matchId) {
        const oldSet = matchSockets.get(ws._data.matchId);
        if (oldSet) {
            oldSet.delete(ws._data.id);
            if (oldSet.size === 0) matchSockets.delete(ws._data.matchId);
        }
    }
    ws._data.matchId = matchIdStr;
    // Add to new match index
    if (!matchSockets.has(matchIdStr)) matchSockets.set(matchIdStr, new Set());
    matchSockets.get(matchIdStr)!.add(ws._data.id);
}

/**
 * Returns the number of authenticated (logged-in) players currently connected.
 * Used by handlers.ts for online count feature.
 */
export function getAuthenticatedCount(): number {
    return playerSockets.size;
}

export function startWSServer(): void {
    // P1 FIX: Verify origin on WebSocket upgrade to prevent CSRF
    const ALLOWED_ORIGIN = process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:5173';
    const wss = new WebSocketServer({
        port: config.wsPort,
        maxPayload: 16384,
        verifyClient: (info: { origin: string; req: { headers: Record<string, string | string[] | undefined> } }) => {
            if (config.devMode) return true;
            const origin = info.origin || (info.req.headers['origin'] as string) || '';
            if (origin === ALLOWED_ORIGIN) return true;
            if (!origin) return true; // server-to-server, health checks
            logger.warn(TAG, `WS connection rejected: origin=${origin} (allowed=${ALLOWED_ORIGIN})`);
            return false;
        },
    });

    wss.on('connection', (rawWs: WebSocket) => {
        const ws = rawWs as GameSocket;
        const id = randomUUID();
        ws._data = { id, matchId: null, msgCount: 0, msgWindowStart: Date.now(), authTimer: null };
        (ws as any)._isAlive = true; // HIGH-4: heartbeat flag
        allSockets.set(id, ws);

        // HIGH-4: Reset heartbeat flag on pong
        ws.on('pong', () => { (ws as any)._isAlive = true; });

        const nonce = generateNonce(id);
        sendToSocket(ws, ServerMsg.NONCE, { nonce });
        logger.debug(TAG, `Client connected: ${id}`);

        // M-06: Disconnect if not authenticated within timeout
        ws._data.authTimer = setTimeout(() => {
            if (!getPlayerAddress(id)) {
                logger.debug(TAG, `Auth timeout for ${id} — disconnecting`);
                sendToSocket(ws, ServerMsg.ERROR, { message: 'Authentication timeout' });
                ws.close();
            }
        }, AUTH_TIMEOUT_MS);

        ws.on('message', (data: Buffer) => {
            try {
                // H-03: Rate limiting
                const now = Date.now();
                if (now - ws._data.msgWindowStart > 1000) {
                    ws._data.msgCount = 0;
                    ws._data.msgWindowStart = now;
                }
                ws._data.msgCount++;
                if (ws._data.msgCount > MAX_MESSAGES_PER_SECOND) {
                    sendToSocket(ws, ServerMsg.ERROR, { message: 'Rate limited' });
                    return;
                }

                const text = data.toString('utf-8');
                const parsed: unknown = JSON.parse(text);
                if (typeof parsed === 'object' && parsed !== null && _handleMessage) {
                    _handleMessage(ws, parsed as Record<string, unknown>);
                }
            } catch {
                sendToSocket(ws, ServerMsg.ERROR, { message: 'Invalid message format' });
            }
        });

        ws.on('close', () => {
            if (ws._data.authTimer) clearTimeout(ws._data.authTimer);
            // BE-6: Remove from matchSockets index
            if (ws._data.matchId) {
                const mSet = matchSockets.get(ws._data.matchId);
                if (mSet) {
                    mSet.delete(id);
                    if (mSet.size === 0) matchSockets.delete(ws._data.matchId);
                }
            }
            allSockets.delete(id);
            const address = getPlayerAddress(id);
            if (address) {
                // Notify game of disconnect if player was in a match
                if (ws._data.matchId && _handleDisconnect) {
                    _handleDisconnect(address, ws._data.matchId);
                }
                playerSockets.delete(address);
                broadcastOnlineStatus();
            }
            removeSession(id);
            logger.debug(TAG, `Client disconnected: ${id}`);
        });

        ws.on('error', (err) => {
            logger.error(TAG, `WebSocket error for ${id}`, err);
        });
    });

    wss.on('listening', () => {
        logger.info(TAG, `WebSocket server listening on port ${config.wsPort}`);

        // HIGH-4 FIX: Ping/pong heartbeat to detect zombie connections
        const HEARTBEAT_MS = 30_000;
        setInterval(() => {
            for (const [id, ws] of allSockets) {
                if ((ws as any)._isAlive === false) {
                    // Missed last pong â€” terminate
                    logger.debug(TAG, `Heartbeat timeout for ${id} â€” terminating`);
                    ws.terminate();
                    continue;
                }
                (ws as any)._isAlive = false;
                ws.ping();
            }
        }, HEARTBEAT_MS);
    });

    wss.on('error', (err) => {
        logger.error(TAG, 'WebSocket server error', err);
    });
}

export function broadcastToAll(type: string, payload: Record<string, unknown>): void {
    // HIGH-3 FIX: Only broadcast to authenticated players, not raw unauthenticated connections
    const msg = JSON.stringify({ type, ...payload });
    for (const [, ws] of playerSockets) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
        }
    }
}

export function getPlayerMatchId(address: string): string | null {
    const ws = playerSockets.get(address);
    return ws?._data.matchId ?? null;
}

/** Broadcast queue availability to authenticated players only (not raw connections) */
function broadcastOnlineStatus(): void {
    const availability = getQueueAvailability();
    const msg = JSON.stringify({ type: 'queue_availability', ...availability });
    for (const [, ws] of playerSockets) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
        }
    }
}