import { useState, useEffect, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';

/**
 * Match status constants (from ChartArenaEscrow contract)
 * 0 = NONE, 1 = OPEN, 2 = LOCKED, 3 = SETTLED, 4 = CANCELLED, 5 = REFUNDED
 */
const STATUS_LABELS: Record<number, string> = {
    0: 'None', 1: 'Open', 2: 'Locked', 3: 'Settled', 4: 'Cancelled', 5: 'Refunded',
};

interface MatchInfo {
    matchId: bigint;
    status: number;
    buyIn: bigint;
    playerCount: number;
    lockBlock: number;
    pot: bigint;
}

type RecoveryAction = 'idle' | 'loading-info' | 'cancelling' | 'refunding' | 'withdrawing' | 'success' | 'error';

export function MatchRecovery({ wallet }: { wallet: ReturnType<typeof useWalletConnect> }) {
    const [matchIdInput, setMatchIdInput] = useState('');
    const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
    const [currentBlock, setCurrentBlock] = useState<number | null>(null);
    const [action, setAction] = useState<RecoveryAction>('idle');
    const [message, setMessage] = useState('');
    const [expanded, setExpanded] = useState(false);

    const provider = (wallet as any).provider;
    const network = (wallet as any).network;

    // Fetch current block number periodically
    useEffect(() => {
        if (!provider || !expanded) return;
        let cancelled = false;
        const fetchBlock = async () => {
            try {
                const bn = await provider.getBlockNumber();
                if (!cancelled) setCurrentBlock(Number(bn));
            } catch { /* ignore */ }
        };
        fetchBlock();
        const iv = setInterval(fetchBlock, 30_000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [provider, expanded]);

    // Lookup match info
    const lookupMatch = useCallback(async () => {
        if (!matchIdInput || !provider || !network) return;
        setAction('loading-info');
        setMessage('');
        setMatchInfo(null);
        try {
            // Ensure contract module is loaded (side-effect: registers __ca on window)
            await import('../services/contract');

            // We need to call getMatchInfo — but it's not exported yet.
            // Use the escrow contract directly via the cached contract helper.
            const { getContract, ABIDataTypes, BitcoinAbiTypes, OP_20_ABI } = await import('opnet');
            const ESCROW_ADDRESS = (await import('../utils/constants')).ESCROW_ADDRESS;

            const ESCROW_ABI = [
                {
                    name: 'getMatchInfo', type: 1 /*BitcoinAbiTypes.Function*/, constant: true,
                    inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
                    outputs: [
                        { name: 'buyIn', type: ABIDataTypes.UINT256 },
                        { name: 'mode', type: ABIDataTypes.UINT256 },
                        { name: 'format', type: ABIDataTypes.UINT256 },
                        { name: 'status', type: ABIDataTypes.UINT256 },
                        { name: 'playerCount', type: ABIDataTypes.UINT256 },
                        { name: 'maxPlayers', type: ABIDataTypes.UINT256 },
                        { name: 'lockBlock', type: ABIDataTypes.UINT256 },
                        { name: 'pot', type: ABIDataTypes.UINT256 },
                    ],
                },
            ];

            const escrow = getContract(ESCROW_ADDRESS as any, ESCROW_ABI as any, provider, network);
            const id = BigInt(matchIdInput);
            const result = await (escrow as any).getMatchInfo(id);
            if ('error' in result) throw new Error(result.error);

            const p = result.properties;
            setMatchInfo({
                matchId: id,
                status: Number(p.status as bigint),
                buyIn: p.buyIn as bigint,
                playerCount: Number(p.playerCount as bigint),
                lockBlock: Number(p.lockBlock as bigint),
                pot: p.pot as bigint,
            });
            setAction('idle');
        } catch (err) {
            setAction('error');
            setMessage(`Failed to fetch match info: ${String(err).slice(0, 100)}`);
        }
    }, [matchIdInput, provider, network]);

    // Cancel match (OPEN only, creator only)
    const handleCancel = async () => {
        if (!matchInfo || !wallet.walletAddress) return;
        setAction('cancelling');
        setMessage('Cancelling match... approve in wallet');
        try {
            const { cancelMatchOnChain } = await import('../services/contract');
            await cancelMatchOnChain(provider, network, matchInfo.matchId, wallet.walletAddress);
            setAction('withdrawing');
            setMessage('Match cancelled! Withdrawing funds...');
            try {
                const { withdrawOnChain } = await import('../services/contract');
                await withdrawOnChain(provider, network, wallet.walletAddress);
                setAction('success');
                setMessage('Done! Match cancelled and funds withdrawn to your wallet.');
            } catch {
                setAction('success');
                setMessage('Match cancelled! Funds moved to escrow balance — use Withdraw above.');
            }
        } catch (err) {
            setAction('error');
            setMessage(`Cancel failed: ${String(err).slice(0, 120)}`);
        }
    };

    // Emergency refund (LOCKED, 50+ blocks past lock)
    const handleEmergencyRefund = async () => {
        if (!matchInfo || !wallet.walletAddress) return;
        setAction('refunding');
        setMessage('Triggering emergency refund... approve in wallet');
        try {
            const { emergencyRefundOnChain } = await import('../services/contract');
            await emergencyRefundOnChain(provider, network, matchInfo.matchId, wallet.walletAddress);
            setAction('withdrawing');
            setMessage('Refund complete! Withdrawing funds...');
            try {
                const { withdrawOnChain } = await import('../services/contract');
                await withdrawOnChain(provider, network, wallet.walletAddress);
                setAction('success');
                setMessage('Done! Emergency refund processed and funds withdrawn.');
            } catch {
                setAction('success');
                setMessage('Refund processed! Funds moved to escrow balance — use Withdraw above.');
            }
        } catch (err) {
            setAction('error');
            setMessage(`Emergency refund failed: ${String(err).slice(0, 120)}`);
        }
    };

    const isLoading = action === 'cancelling' || action === 'refunding' || action === 'withdrawing' || action === 'loading-info';
    const blocksUntilRefund = matchInfo && matchInfo.lockBlock > 0 && currentBlock
        ? Math.max(0, (matchInfo.lockBlock + 50) - currentBlock)
        : null;
    const canEmergencyRefund = blocksUntilRefund !== null && blocksUntilRefund <= 0;

    // Accent colors from the mecha theme
    const accentWarn = '#E7D27C';
    const accentBlue = '#92B4F4';
    const accentGreen = '#82C4A0';
    const accentRose = '#F4B8CE';
    const dimText = '#665C87';
    const panelBg = 'rgba(146,180,244,0.03)';
    const panelBorder = 'rgba(146,180,244,0.08)';

    return (
        <div style={{
            marginTop: 10,
            border: `1px solid ${panelBorder}`,
            background: panelBg,
            overflow: 'hidden',
        }}>
            {/* Collapsible header */}
            <button
                onClick={() => setExpanded(e => !e)}
                style={{
                    width: '100%', padding: '10px 14px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    color: '#8b7fb0', fontFamily: "'Chakra Petch', sans-serif",
                }}
            >
                <span style={{ fontWeight: 700, fontSize: '0.68rem', letterSpacing: 0.5 }}>
                    ⚠️ Match Recovery
                </span>
                <span style={{ fontSize: '0.7rem', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
                    ▼
                </span>
            </button>

            {expanded && (
                <div style={{ padding: '0 14px 14px', fontSize: '0.65rem', color: dimText, lineHeight: 1.6 }}>
                    <div style={{ marginBottom: 10 }}>
                        If a match is stuck (not settled, server crashed, etc.), you can cancel or force-refund it here.
                    </div>

                    {/* Match ID input */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                        <input
                            type="number"
                            min="1"
                            placeholder="Match ID"
                            value={matchIdInput}
                            onChange={e => { setMatchIdInput(e.target.value); setMatchInfo(null); setAction('idle'); setMessage(''); }}
                            disabled={isLoading}
                            style={{
                                flex: 1, padding: '7px 10px',
                                background: 'rgba(13,11,26,0.6)',
                                border: `1px solid rgba(146,180,244,0.15)`,
                                color: '#BEDDF1', fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: '0.75rem', outline: 'none',
                            }}
                        />
                        <button
                            onClick={lookupMatch}
                            disabled={!matchIdInput || isLoading}
                            style={{
                                padding: '7px 16px',
                                background: 'rgba(146,180,244,0.08)',
                                border: `1.5px solid rgba(146,180,244,0.2)`,
                                color: accentBlue, cursor: matchIdInput && !isLoading ? 'pointer' : 'not-allowed',
                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem',
                                opacity: isLoading ? 0.5 : 1,
                            }}
                        >
                            {action === 'loading-info' ? 'Loading...' : 'Lookup'}
                        </button>
                    </div>

                    {/* Match info display */}
                    {matchInfo && (
                        <div style={{
                            padding: '10px 12px', marginBottom: 12,
                            background: 'rgba(13,11,26,0.4)',
                            border: `1px solid rgba(146,180,244,0.1)`,
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.63rem' }}>
                                <div>
                                    <span style={{ color: '#8b7fb0' }}>Status: </span>
                                    <span style={{
                                        fontWeight: 700,
                                        color: matchInfo.status === 1 ? accentGreen
                                            : matchInfo.status === 2 ? accentWarn
                                            : matchInfo.status >= 3 ? dimText
                                            : '#B8AED4',
                                    }}>
                                        {STATUS_LABELS[matchInfo.status] || `Unknown (${matchInfo.status})`}
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#8b7fb0' }}>Buy-in: </span>
                                    <span style={{ color: '#d4b978', fontWeight: 600 }}>
                                        {(Number(matchInfo.buyIn) / 1e18).toFixed(0)} MOTO
                                    </span>
                                </div>
                                <div>
                                    <span style={{ color: '#8b7fb0' }}>Players: </span>
                                    <span style={{ color: '#B8AED4' }}>{matchInfo.playerCount}</span>
                                </div>
                                <div>
                                    <span style={{ color: '#8b7fb0' }}>Pot: </span>
                                    <span style={{ color: '#d4b978', fontWeight: 600 }}>
                                        {(Number(matchInfo.pot) / 1e18).toFixed(0)} MOTO
                                    </span>
                                </div>
                                {matchInfo.status === 2 && matchInfo.lockBlock > 0 && (
                                    <>
                                        <div>
                                            <span style={{ color: '#8b7fb0' }}>Lock block: </span>
                                            <span style={{ color: '#B8AED4' }}>{matchInfo.lockBlock}</span>
                                        </div>
                                        <div>
                                            <span style={{ color: '#8b7fb0' }}>Refund in: </span>
                                            <span style={{
                                                fontWeight: 700,
                                                color: canEmergencyRefund ? accentGreen : accentWarn,
                                            }}>
                                                {canEmergencyRefund
                                                    ? '✓ Available now'
                                                    : `~${blocksUntilRefund} blocks`
                                                }
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Action buttons based on status */}
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                {/* OPEN → Cancel (creator only) */}
                                {matchInfo.status === 1 && (
                                    <button
                                        onClick={handleCancel}
                                        disabled={isLoading}
                                        style={{
                                            flex: 1, padding: '9px 16px',
                                            background: 'rgba(231,210,124,0.08)',
                                            border: `1.5px solid rgba(231,210,124,0.25)`,
                                            color: accentWarn,
                                            cursor: isLoading ? 'not-allowed' : 'pointer',
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                                            fontSize: '0.72rem', letterSpacing: '0.04em',
                                            opacity: isLoading ? 0.5 : 1,
                                        }}
                                    >
                                        {action === 'cancelling' ? '⏳ Cancelling...'
                                            : action === 'withdrawing' ? '⏳ Withdrawing...'
                                            : '✕ Cancel Match'}
                                    </button>
                                )}

                                {/* LOCKED → Emergency Refund (if 50 blocks passed) */}
                                {matchInfo.status === 2 && (
                                    <button
                                        onClick={handleEmergencyRefund}
                                        disabled={isLoading || !canEmergencyRefund}
                                        title={!canEmergencyRefund
                                            ? `Emergency refund available in ~${blocksUntilRefund} blocks`
                                            : 'Trigger emergency refund and withdraw'
                                        }
                                        style={{
                                            flex: 1, padding: '9px 16px',
                                            background: canEmergencyRefund
                                                ? 'rgba(244,184,206,0.08)'
                                                : 'rgba(146,180,244,0.04)',
                                            border: `1.5px solid ${canEmergencyRefund
                                                ? 'rgba(244,184,206,0.25)'
                                                : 'rgba(146,180,244,0.1)'}`,
                                            color: canEmergencyRefund ? accentRose : '#6b5b95',
                                            cursor: canEmergencyRefund && !isLoading ? 'pointer' : 'not-allowed',
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                                            fontSize: '0.72rem', letterSpacing: '0.04em',
                                            opacity: isLoading ? 0.5 : 1,
                                        }}
                                    >
                                        {action === 'refunding' ? '⏳ Refunding...'
                                            : action === 'withdrawing' ? '⏳ Withdrawing...'
                                            : !canEmergencyRefund
                                                ? `🔒 Refund in ~${blocksUntilRefund} blocks`
                                                : '🚨 Emergency Refund'}
                                    </button>
                                )}

                                {/* Already resolved */}
                                {matchInfo.status >= 3 && (
                                    <div style={{
                                        flex: 1, padding: '9px 16px', textAlign: 'center',
                                        color: accentGreen, fontWeight: 700, fontSize: '0.72rem',
                                        fontFamily: "'Chakra Petch', sans-serif",
                                    }}>
                                        ✓ Match already {STATUS_LABELS[matchInfo.status]?.toLowerCase() || 'resolved'}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Status messages */}
                    {message && (
                        <div style={{
                            padding: '8px 10px',
                            fontSize: '0.63rem',
                            lineHeight: 1.5,
                            background: action === 'error'
                                ? 'rgba(244,184,206,0.06)'
                                : action === 'success'
                                    ? 'rgba(130,196,160,0.06)'
                                    : 'rgba(146,180,244,0.04)',
                            border: `1px solid ${action === 'error'
                                ? 'rgba(244,184,206,0.15)'
                                : action === 'success'
                                    ? 'rgba(130,196,160,0.15)'
                                    : 'rgba(146,180,244,0.1)'}`,
                            color: action === 'error' ? accentRose
                                : action === 'success' ? accentGreen
                                : accentBlue,
                        }}>
                            {message}
                        </div>
                    )}

                    {/* Hint text */}
                    {!matchInfo && !message && (
                        <div style={{ fontSize: '0.6rem', color: '#555', lineHeight: 1.5 }}>
                            Enter a match ID to check its status. You can find match IDs in your battle log or from the server admin.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
