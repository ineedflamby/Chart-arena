/**
 * WebSocket client for Chart Arena backend.
 */
import { WS_URL } from '../utils/constants';

export type MessageCallback = (msg: Record<string, unknown>) => void;

class GameWS {
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<MessageCallback>>();
    private _connected = false;
    private reconnectDelay = 3000; // HIGH-6 FIX: exponential backoff

    get connected(): boolean { return this._connected; }

    connect(): void {
        if (this.ws) return;
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
            this._connected = true;
            this.reconnectDelay = 3000; // HIGH-6: reset backoff on successful connect
            this.emit('_connected', {});
        };

        this.ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
                const type = msg['type'] as string;
                if (type) {
                    this.emit(type, msg);
                    this.emit('_any', msg); // wildcard
                }
            } catch { /* ignore malformed */ }
        };

        this.ws.onclose = () => {
            this._connected = false;
            this.ws = null;
            this.emit('_disconnected', {});
            // HIGH-6 FIX: Exponential backoff with jitter (3s → 6s → 12s → 30s → 60s max)
            const jitter = Math.random() * 1000;
            setTimeout(() => this.connect(), this.reconnectDelay + jitter);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
        };

        this.ws.onerror = () => {
            this.ws?.close();
        };
    }

    disconnect(): void {
        this.ws?.close();
        this.ws = null;
        this._connected = false;
    }

    send(type: string, payload: Record<string, unknown> = {}): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, ...payload }));
        }
    }

    on(type: string, cb: MessageCallback): () => void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
        return () => this.listeners.get(type)?.delete(cb);
    }

    private emit(type: string, msg: Record<string, unknown>): void {
        this.listeners.get(type)?.forEach((cb) => cb(msg));
    }
}

export const gameWS = new GameWS();
