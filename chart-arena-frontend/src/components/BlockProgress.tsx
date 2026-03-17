/**
 * BlockProgress.tsx — Live block & mempool status strip.
 *
 * Shows current block, mempool stats, fee tiers, projected blocks,
 * and tracks the player's pending deposit TX if active.
 * Links out to mempool.space/signet for the full block explorer.
 *
 * Data: mempool.space signet WebSocket + REST API.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

const MEMPOOL_WS = 'wss://mempool.space/signet/api/v1/ws';
const MEMPOOL_API = 'https://mempool.space/signet/api';
const MEMPOOL_URL = 'https://mempool.space/signet';

interface BlockInfo {
    height: number;
    timestamp: number;
    txCount: number;
    size: number;
}

interface FeeRec {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    economyFee: number;
    minimumFee: number;
}

interface MempoolBlock {
    blockSize: number;
    blockVSize: number;
    nTx: number;
    totalFees: number;
    medianFee: number;
    feeRange: number[];
}

interface MempoolStats {
    count: number;
    vsize: number;
    totalFee: number;
}

interface Props {
    /** If set, tracks this TX hash and shows confirmation status */
    pendingTxHash?: string | null;
    /** Compact mode (just block + mempool count) */
    compact?: boolean;
}

export function BlockProgress({ pendingTxHash, compact = false }: Props) {
    const [block, setBlock] = useState<BlockInfo | null>(null);
    const [fees, setFees] = useState<FeeRec | null>(null);
    const [mempoolBlocks, setMempoolBlocks] = useState<MempoolBlock[]>([]);
    const [mempoolStats, setMempoolStats] = useState<MempoolStats | null>(null);
    const [txConfirmed, setTxConfirmed] = useState(false);
    const [txBlock, setTxBlock] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    // Fetch REST data
    const fetchData = useCallback(async () => {
        try {
            const [blocksRes, feesRes, mbRes, mpRes] = await Promise.allSettled([
                fetch(`${MEMPOOL_API}/v1/blocks`).then(r => r.json()),
                fetch(`${MEMPOOL_API}/v1/fees/recommended`).then(r => r.json()),
                fetch(`${MEMPOOL_API}/v1/fees/mempool-blocks`).then(r => r.json()),
                fetch(`${MEMPOOL_API}/mempool`).then(r => r.json()),
            ]);
            if (blocksRes.status === 'fulfilled' && blocksRes.value?.[0]) {
                const b = blocksRes.value[0];
                setBlock({ height: b.height, timestamp: b.timestamp, txCount: b.tx_count, size: b.size });
            }
            if (feesRes.status === 'fulfilled') setFees(feesRes.value);
            if (mbRes.status === 'fulfilled') setMempoolBlocks(mbRes.value);
            if (mpRes.status === 'fulfilled') {
                const m = mpRes.value;
                setMempoolStats({ count: m.count, vsize: m.vsize, totalFee: m.total_fee });
            }
        } catch { /* silent */ }
    }, []);

    // WebSocket for real-time updates
    useEffect(() => {
        let ws: WebSocket;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        function connect() {
            ws = new WebSocket(MEMPOOL_WS);
            wsRef.current = ws;
            ws.onopen = () => {
                setConnected(true);
                ws.send(JSON.stringify({ action: 'init' }));
                ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats', 'mempool-blocks'] }));
                if (pendingTxHash) ws.send(JSON.stringify({ 'track-tx': pendingTxHash }));
            };
            ws.onmessage = (ev) => {
                try {
                    const d = JSON.parse(ev.data);
                    if (d.block) {
                        setBlock({ height: d.block.height, timestamp: d.block.timestamp, txCount: d.block.tx_count, size: d.block.size ?? 0 });
                        setElapsed(0);
                        fetchData();
                    }
                    if (d.mempoolInfo) {
                        setMempoolStats(prev => ({
                            count: d.mempoolInfo.count ?? prev?.count ?? 0,
                            vsize: d.mempoolInfo.vsize ?? prev?.vsize ?? 0,
                            totalFee: d.mempoolInfo.total_fee ?? prev?.totalFee ?? 0,
                        }));
                    }
                    if (d.fees) setFees(d.fees);
                    if (d['projected-blocks'] || d.mempoolBlocks) {
                        setMempoolBlocks(d['projected-blocks'] ?? d.mempoolBlocks);
                    }
                    if (d['txConfirmation'] || d['tx-confirmed']) {
                        setTxConfirmed(true);
                        setTxBlock(d.block?.height ?? block?.height ?? null);
                    }
                } catch { /* ignore */ }
            };
            ws.onclose = () => { setConnected(false); wsRef.current = null; reconnectTimer = setTimeout(connect, 5000); };
            ws.onerror = () => ws.close();
        }

        connect();
        return () => { clearTimeout(reconnectTimer); ws?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Track TX changes
    useEffect(() => {
        if (pendingTxHash && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ 'track-tx': pendingTxHash }));
            setTxConfirmed(false);
            setTxBlock(null);
        }
    }, [pendingTxHash]);

    // Initial data fetch
    useEffect(() => { fetchData(); }, [fetchData]);

    // Elapsed timer
    useEffect(() => {
        const t = setInterval(() => setElapsed(e => e + 1), 1000);
        return () => clearInterval(t);
    }, []);

    // Calculations
    const timeSinceBlock = block ? Math.floor(Date.now() / 1000) - block.timestamp : 0;
    const totalElapsed = timeSinceBlock > 0 ? timeSinceBlock : elapsed;
    const mm = Math.floor(totalElapsed / 60);
    const ss = totalElapsed % 60;
    const timeStr = mm > 0 ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
    const progressPct = Math.min(95, (totalElapsed / 600) * 100);
    const vsizeMB = mempoolStats ? (mempoolStats.vsize / 1_000_000).toFixed(2) : null;
    const totalPendingTxs = mempoolBlocks.reduce((s, b) => s + b.nTx, 0);
    const blocksToClr = mempoolBlocks.length;

    const txUrl = pendingTxHash ? `${MEMPOOL_URL}/tx/${pendingTxHash}` : null;
    const blockUrl = block ? `${MEMPOOL_URL}/block/${block.height}` : MEMPOOL_URL;

    // ── Compact mode ──
    if (compact) {
        return (
            <div style={S.compact}>
                <div style={S.cRow}>
                    <span style={S.dot(connected)} />
                    <a href={blockUrl} target="_blank" rel="noopener noreferrer" style={S.cLink}>#{block?.height ?? '···'}</a>
                    <span style={S.cSep}>·</span>
                    <span style={S.cDim}>{mempoolStats?.count?.toLocaleString() ?? '—'} txs</span>
                    <span style={S.cSep}>·</span>
                    <span style={S.cDim}>{timeStr} ago</span>
                    {fees && <>
                        <span style={S.cSep}>·</span>
                        <span style={S.cFee}>{fees.fastestFee} sat/vB</span>
                    </>}
                </div>
                <div style={S.bar}><div style={{ ...S.barFill, width: `${progressPct}%` }} /></div>
                {pendingTxHash && (
                    <div style={S.txRow}>
                        {txConfirmed
                            ? <span style={S.txOk}>✓ Confirmed{txBlock ? ` #${txBlock}` : ''}</span>
                            : <span style={S.txWait}>⏳ Pending</span>}
                        {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" style={S.txLnk}>mempool.space ↗</a>}
                    </div>
                )}
            </div>
        );
    }

    // ── Full mode ──
    return (
        <div style={S.box}>
            {/* Row 1: Block + time */}
            <div style={S.row}>
                <div style={S.left}>
                    <span style={S.dot(connected)} />
                    <a href={blockUrl} target="_blank" rel="noopener noreferrer" style={S.bLink}>
                        Block #{block?.height?.toLocaleString() ?? '···'}
                    </a>
                    <span style={S.sep}>·</span>
                    <span style={S.dim}>{block?.txCount?.toLocaleString() ?? '—'} txs</span>
                    <span style={S.sep}>·</span>
                    <span style={S.dim}>{timeStr} ago</span>
                </div>
                <a href={MEMPOOL_URL} target="_blank" rel="noopener noreferrer" style={S.mspLink}>
                    mempool.space ↗
                </a>
            </div>

            {/* Progress bar */}
            <div style={S.bar}><div style={{ ...S.barFill, width: `${progressPct}%` }} /></div>

            {/* Row 2: Stats grid */}
            <div style={S.grid}>
                {/* Mempool size */}
                <div style={S.stat}>
                    <span style={S.sLabel}>MEMPOOL</span>
                    <span style={S.sVal}>
                        {mempoolStats?.count?.toLocaleString() ?? '—'}
                        <span style={S.sUnit}> txs</span>
                    </span>
                    {vsizeMB && <span style={S.sSub}>{vsizeMB} vMB</span>}
                </div>

                {/* Blocks to clear */}
                <div style={S.stat}>
                    <span style={S.sLabel}>BACKLOG</span>
                    <span style={S.sVal}>
                        {blocksToClr > 0 ? blocksToClr : '—'}
                        <span style={S.sUnit}> {blocksToClr === 1 ? 'block' : 'blocks'}</span>
                    </span>
                    {totalPendingTxs > 0 && <span style={S.sSub}>~{totalPendingTxs.toLocaleString()} txs queued</span>}
                </div>

                {/* Next block preview */}
                {mempoolBlocks[0] && (
                    <div style={S.stat}>
                        <span style={S.sLabel}>NEXT BLOCK</span>
                        <span style={S.sVal}>
                            {mempoolBlocks[0].nTx.toLocaleString()}
                            <span style={S.sUnit}> txs</span>
                        </span>
                        <span style={S.sSub}>
                            {(mempoolBlocks[0].blockVSize / 1_000_000).toFixed(2)} vMB · ~{mempoolBlocks[0].medianFee.toFixed(1)} sat/vB
                        </span>
                    </div>
                )}

                {/* Fee tiers */}
                <div style={S.stat}>
                    <span style={S.sLabel}>FEE ESTIMATE</span>
                    {fees ? (
                        <div style={S.feeGrid}>
                            <div style={S.feeItem}>
                                <span style={S.feeDot(0)} />
                                <span style={S.feeName}>No priority</span>
                                <span style={S.feeVal}>{fees.minimumFee}</span>
                            </div>
                            <div style={S.feeItem}>
                                <span style={S.feeDot(1)} />
                                <span style={S.feeName}>Low</span>
                                <span style={S.feeVal}>{fees.hourFee}</span>
                            </div>
                            <div style={S.feeItem}>
                                <span style={S.feeDot(2)} />
                                <span style={S.feeName}>Medium</span>
                                <span style={S.feeVal}>{fees.halfHourFee}</span>
                            </div>
                            <div style={S.feeItem}>
                                <span style={S.feeDot(3)} />
                                <span style={S.feeName}>High</span>
                                <span style={S.feeVal}>{fees.fastestFee}</span>
                            </div>
                            <span style={S.feeUnit}>sat/vB</span>
                        </div>
                    ) : (
                        <span style={S.sVal}>—</span>
                    )}
                </div>
            </div>

            {/* Projected blocks mini-strip */}
            {mempoolBlocks.length > 1 && (
                <div style={S.stripWrap}>
                    <span style={S.sLabel}>PROJECTED BLOCKS</span>
                    <div style={S.strip}>
                        {mempoolBlocks.slice(0, 8).map((mb, i) => {
                            const fillPct = Math.min(100, (mb.blockVSize / 1_000_000) * 100);
                            return (
                                <div key={i} style={S.miniBlock}>
                                    <div style={S.miniBar}>
                                        <div style={{ ...S.miniFill, height: `${fillPct}%`, background: feeColor(mb.medianFee) }} />
                                    </div>
                                    <span style={S.miniLabel}>{mb.nTx}</span>
                                    <span style={S.miniSub}>~{mb.medianFee.toFixed(0)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Pending TX tracker */}
            {pendingTxHash && (
                <div style={S.txFull}>
                    <div style={S.txL}>
                        {txConfirmed ? (
                            <span style={S.txOk}>✓ Confirmed{txBlock ? ` in block #${txBlock}` : ''}</span>
                        ) : (
                            <>
                                <span style={S.txWait}>⏳ TX pending</span>
                                <span style={S.txH}>{pendingTxHash.slice(0, 8)}···{pendingTxHash.slice(-6)}</span>
                            </>
                        )}
                    </div>
                    {txUrl && <a href={txUrl} target="_blank" rel="noopener noreferrer" style={S.txLnk}>View TX ↗</a>}
                </div>
            )}
        </div>
    );
}

// Fee color based on sat/vB
function feeColor(fee: number): string {
    if (fee <= 1) return '#82c4a0';
    if (fee <= 3) return '#92B4F4';
    if (fee <= 10) return '#e8cc8a';
    return '#F4B8CE';
}

// ── Styles ──
const F = "'Chakra Petch', 'IBM Plex Mono', monospace";
const feeColors = ['#82c4a0', '#92B4F4', '#e8cc8a', '#F4B8CE'];

const S = {
    box: { fontFamily: F, padding: '10px 14px', background: 'rgba(11,10,20,0.6)', borderRadius: '6px', border: '1px solid rgba(146,180,244,0.08)', fontSize: '12px' } as React.CSSProperties,
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const } as React.CSSProperties,
    left: { display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
    dot: (on: boolean) => ({ width: '6px', height: '6px', borderRadius: '50%', background: on ? '#82c4a0' : '#F4B8CE', boxShadow: on ? '0 0 6px rgba(130,196,160,0.4)' : 'none', flexShrink: 0 }) as React.CSSProperties,
    bLink: { color: '#92B4F4', fontWeight: 700, textDecoration: 'none', letterSpacing: '0.02em' } as React.CSSProperties,
    sep: { color: '#554d73', fontSize: '10px' } as React.CSSProperties,
    dim: { color: '#8b7fb0', fontSize: '11px' } as React.CSSProperties,
    mspLink: { color: '#554d73', fontSize: '9px', textDecoration: 'none', letterSpacing: '0.04em', textTransform: 'uppercase' as const } as React.CSSProperties,

    bar: { height: '2px', background: 'rgba(146,180,244,0.06)', borderRadius: '1px', marginTop: '6px', overflow: 'hidden' } as React.CSSProperties,
    barFill: { height: '100%', background: 'linear-gradient(90deg, #92B4F4, #d4a0e0)', borderRadius: '1px', transition: 'width 1s linear' } as React.CSSProperties,

    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginTop: '10px' } as React.CSSProperties,
    stat: { display: 'flex', flexDirection: 'column' as const, gap: '1px' } as React.CSSProperties,
    sLabel: { fontSize: '8px', color: '#554d73', letterSpacing: '0.1em', textTransform: 'uppercase' as const, fontWeight: 600 } as React.CSSProperties,
    sVal: { fontSize: '13px', color: '#c0b8e0', fontWeight: 600, lineHeight: 1.2 } as React.CSSProperties,
    sUnit: { fontSize: '9px', color: '#8b7fb0', fontWeight: 400 } as React.CSSProperties,
    sSub: { fontSize: '9px', color: '#554d73' } as React.CSSProperties,

    feeGrid: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const, marginTop: '2px' } as React.CSSProperties,
    feeItem: { display: 'flex', alignItems: 'center', gap: '3px' } as React.CSSProperties,
    feeDot: (i: number) => ({ width: '5px', height: '5px', borderRadius: '50%', background: feeColors[i], flexShrink: 0 }) as React.CSSProperties,
    feeName: { fontSize: '8px', color: '#8b7fb0' } as React.CSSProperties,
    feeVal: { fontSize: '11px', color: '#c0b8e0', fontWeight: 600 } as React.CSSProperties,
    feeUnit: { fontSize: '8px', color: '#554d73', marginLeft: '2px' } as React.CSSProperties,

    stripWrap: { marginTop: '10px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
    strip: { display: 'flex', gap: '3px', alignItems: 'flex-end', height: '40px' } as React.CSSProperties,
    miniBlock: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '1px', flex: 1, minWidth: '28px' } as React.CSSProperties,
    miniBar: { width: '100%', height: '24px', background: 'rgba(146,180,244,0.04)', borderRadius: '2px', position: 'relative' as const, overflow: 'hidden' } as React.CSSProperties,
    miniFill: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, borderRadius: '2px 2px 0 0', transition: 'height 0.5s ease' } as React.CSSProperties,
    miniLabel: { fontSize: '8px', color: '#8b7fb0', lineHeight: 1 } as React.CSSProperties,
    miniSub: { fontSize: '7px', color: '#554d73', lineHeight: 1 } as React.CSSProperties,

    txFull: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(146,180,244,0.06)', gap: '8px' } as React.CSSProperties,
    txL: { display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
    txRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '10px' } as React.CSSProperties,
    txWait: { color: '#e8cc8a', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
    txOk: { color: '#82c4a0', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
    txH: { color: '#554d73', fontSize: '10px', fontFamily: "'IBM Plex Mono', monospace" } as React.CSSProperties,
    txLnk: { color: '#92B4F4', fontSize: '10px', textDecoration: 'none', opacity: 0.7 } as React.CSSProperties,

    // Compact
    compact: { fontFamily: F, fontSize: '10px' } as React.CSSProperties,
    cRow: { display: 'flex', alignItems: 'center', gap: '5px' } as React.CSSProperties,
    cLink: { color: '#92B4F4', fontWeight: 700, textDecoration: 'none', fontSize: '10px' } as React.CSSProperties,
    cSep: { color: '#554d73', fontSize: '8px' } as React.CSSProperties,
    cDim: { color: '#8b7fb0' } as React.CSSProperties,
    cFee: { color: '#e8cc8a', fontWeight: 600 } as React.CSSProperties,
};
