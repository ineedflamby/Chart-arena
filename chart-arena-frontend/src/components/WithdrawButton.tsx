import { useState, useEffect, useCallback } from 'react';
import { BlockProgress } from './BlockProgress';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { gameWS } from '../services/ws';

export function WithdrawButton({ wallet, settlementTx }: { wallet: ReturnType<typeof useWalletConnect>; settlementTx?: string | null }) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [balance, setBalance] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [depositAmount, setDepositAmount] = useState('');
    const [depositStatus, setDepositStatus] = useState<'idle' | 'approving' | 'depositing' | 'success' | 'error'>('idle');
    const [depositError, setDepositError] = useState('');
    const [depositTxHash, setDepositTxHash] = useState<string | null>(null);

    // ══════════════════════════════════════════════════════════════
    // SPRINT 3 FIX: Use WS-based off-chain balance (instant) instead
    // of on-chain getEscrowBalance (10min block delay).
    //
    // The backend pushes 'escrow_balance' after:
    //   - deposit credit (handlers.ts)
    //   - settlement payout (settlement.ts)
    // And responds to 'get_escrow_balance' requests.
    // ══════════════════════════════════════════════════════════════

    const requestBalance = useCallback(() => {
        gameWS.send('get_escrow_balance');
    }, []);

    useEffect(() => {
        // Listen for balance pushes from backend
        const unsub = gameWS.on('escrow_balance', (msg) => {
            const bal = msg['balance'] as string | undefined;
            if (bal !== undefined) {
                setBalance(bal);
            }
        });

        // Request balance on mount
        requestBalance();

        // Also poll every 30s as fallback (WS push handles the fast path)
        const iv = setInterval(requestBalance, 30_000);

        return () => { unsub(); clearInterval(iv); };
    }, [requestBalance]);

    // Re-request when settlement lands
    useEffect(() => {
        if (settlementTx) {
            // Give backend a moment to process settlement
            const t = setTimeout(requestBalance, 3000);
            return () => clearTimeout(t);
        }
    }, [settlementTx, requestBalance]);

    const handleWithdraw = async () => {
        if (!wallet.walletAddress || status === 'loading') return;
        setStatus('loading');
        setErrorMsg('');
        try {
            const provider = (wallet as any).provider;
            const network = (wallet as any).network;
            if (!provider) throw new Error('No provider');
            const { withdrawOnChain } = await import('../services/contract');
            await withdrawOnChain(provider, network, wallet.walletAddress!);
            setStatus('success');
            setBalance('0');
            // Re-request after withdraw confirms
            setTimeout(requestBalance, 5000);
        } catch (err) {
            setStatus('error');
            setErrorMsg(String(err).slice(0, 80));
        }
    };

    const handleDeposit = async () => {
        if (!wallet.walletAddress || depositStatus === 'approving' || depositStatus === 'depositing') return;
        const amount = parseFloat(depositAmount);
        if (!amount || amount <= 0) { setDepositError('Enter a valid amount'); return; }
        setDepositError('');
        try {
            const provider = (wallet as any).provider;
            const network = (wallet as any).network;
            if (!provider) throw new Error('No provider');
            const { transferMotoToEscrow } = await import('../services/contract');
            // Precision-safe conversion
            const parts = depositAmount.split('.');
            const whole = BigInt(parts[0] || '0');
            const decimals = (parts[1] || '').padEnd(18, '0').slice(0, 18);
            const amountWei = whole * (10n ** 18n) + BigInt(decimals);

            // Step 1: Direct MOTO.transfer(escrow, amount) — single wallet popup, no cross-contract
            setDepositStatus('approving'); // reuse label: "Transferring..."
            setDepositTxHash(null); // clear any previous
            const transferTxHash = await transferMotoToEscrow(provider, network, amountWei, wallet.walletAddress!);
            setDepositTxHash(transferTxHash); // save for BlockProgress display

            // Step 2: Tell backend to credit the escrow balance
            setDepositStatus('depositing');
            const unsub = gameWS.on('deposit_status', (msg) => {
                const s = msg['status'] as string;
                if (s === 'broadcast') {
                    unsub();
                    console.log('[Deposit] Credit TX broadcast:', msg['txHash']);
                    setDepositStatus('success');
                    setDepositAmount('');
                    // Balance will be auto-pushed by backend via escrow_balance message
                    setTimeout(() => { setDepositStatus('idle'); setDepositTxHash(null); }, 8000);
                } else if (s === 'error') {
                    unsub();
                    console.error('[Deposit] Backend error:', msg['error']);
                    setDepositStatus('error');
                    setDepositError(String(msg['error']).slice(0, 100));
                    setTimeout(() => setDepositStatus('idle'), 5000);
                }
                // 'verifying'/'crediting' = backend is working, keep showing "Depositing..."
            });
            gameWS.send('deposit_request', { amount: amountWei.toString(), transferTxHash });

            // Timeout fallback — if no response in 90s (block time + operator TX)
            setTimeout(() => {
                unsub();
                if (depositStatus === 'depositing') {
                    setDepositStatus('error');
                    setDepositError('Deposit credit timed out. Your MOTO was transferred — balance will update after confirmation.');
                    setTimeout(() => setDepositStatus('idle'), 5000);
                }
            }, 90_000);
        } catch (err) {
            console.error('[Deposit] FAILED:', err);
            setDepositStatus('error');
            setDepositError(String(err).slice(0, 100));
            setTimeout(() => setDepositStatus('idle'), 5000);
        }
    };

    const balNum = balance ? Number(balance) / 1e18 : 0;
    const isDepositBusy = depositStatus === 'approving' || depositStatus === 'depositing';

    // Quick deposit buttons
    const QUICK_AMOUNTS = [5, 25, 100];

    return (
        <div style={{ marginTop: 12 }}>
            {/* Escrow Balance Display */}
            <div style={{
                padding: '14px 16px',
                background: 'linear-gradient(135deg, rgba(146,180,244,0.06), rgba(212,185,120,0.04))',
                border: '1.5px solid rgba(146,180,244,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
                <div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#8b7fb0', letterSpacing: 1.2 }}>
                        ESCROW BALANCE
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#d4b978', fontFamily: "'Chakra Petch', sans-serif" }}>
                        {balance === null ? '...' : balNum.toFixed(2) + ' MOTO'}
                    </div>
                </div>
                <button
                    onClick={handleWithdraw}
                    disabled={status === 'loading' || balNum <= 0}
                    style={{
                        padding: '8px 20px',
                        background: balNum > 0 ? 'rgba(130,196,160,0.12)' : 'rgba(146,180,244,0.04)',
                        border: `1.5px solid ${balNum > 0 ? 'rgba(130,196,160,0.3)' : 'rgba(146,180,244,0.1)'}`,
                        color: balNum > 0 ? '#82C4A0' : '#6b5b95',
                        cursor: balNum > 0 && status !== 'loading' ? 'pointer' : 'not-allowed',
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                        letterSpacing: '0.06em', opacity: status === 'loading' ? 0.6 : 1,
                    }}
                >
                    {status === 'loading' ? 'Withdrawing...'
                        : status === 'success' ? '✓ Withdrawn'
                        : status === 'error' ? 'Failed'
                        : 'Withdraw'}
                </button>
            </div>
            {errorMsg && <div style={{ fontSize: '0.6rem', color: '#F4B8CE', marginTop: 4, padding: '0 16px' }}>{errorMsg}</div>}

            {/* Deposit Section */}
            <div style={{
                marginTop: 8, padding: '12px 16px',
                background: 'rgba(146,180,244,0.03)',
                border: '1px solid rgba(146,180,244,0.08)',
            }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#8b7fb0', letterSpacing: 1.2, marginBottom: 8 }}>
                    DEPOSIT MOTO
                </div>
                <div style={{ fontSize: '0.6rem', color: '#665C87', marginBottom: 10, lineHeight: 1.5 }}>
                    Fund your escrow to play matches instantly. One wallet popup transfers MOTO to escrow — the backend handles the rest.
                </div>

                {/* Quick amount buttons */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {QUICK_AMOUNTS.map(amt => (
                        <button
                            key={amt}
                            onClick={() => setDepositAmount(String(amt))}
                            disabled={isDepositBusy}
                            style={{
                                flex: 1, padding: '6px 0',
                                background: depositAmount === String(amt)
                                    ? 'rgba(212,185,120,0.12)'
                                    : 'rgba(146,180,244,0.05)',
                                border: `1px solid ${depositAmount === String(amt)
                                    ? 'rgba(212,185,120,0.3)'
                                    : 'rgba(146,180,244,0.1)'}`,
                                color: depositAmount === String(amt) ? '#d4b978' : '#8b7fb0',
                                cursor: isDepositBusy ? 'not-allowed' : 'pointer',
                                fontFamily: "'Chakra Petch', sans-serif",
                                fontWeight: 700, fontSize: '0.7rem',
                            }}
                        >
                            {amt} MOTO
                        </button>
                    ))}
                </div>

                {/* Custom amount + deposit button */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="Custom amount"
                        value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)}
                        disabled={isDepositBusy}
                        style={{
                            flex: 1, padding: '8px 10px',
                            background: 'rgba(13,11,26,0.6)',
                            border: '1px solid rgba(146,180,244,0.15)',
                            color: '#BEDDF1', fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '0.75rem', outline: 'none',
                        }}
                    />
                    <button
                        onClick={handleDeposit}
                        disabled={isDepositBusy || !depositAmount || parseFloat(depositAmount) <= 0}
                        style={{
                            padding: '8px 20px',
                            background: depositAmount && parseFloat(depositAmount) > 0
                                ? 'rgba(212,185,120,0.12)'
                                : 'rgba(146,180,244,0.04)',
                            border: `1.5px solid ${depositAmount && parseFloat(depositAmount) > 0
                                ? 'rgba(212,185,120,0.25)'
                                : 'rgba(146,180,244,0.1)'}`,
                            color: depositAmount && parseFloat(depositAmount) > 0 ? '#d4b978' : '#6b5b95',
                            cursor: !isDepositBusy && depositAmount && parseFloat(depositAmount) > 0 ? 'pointer' : 'not-allowed',
                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                            letterSpacing: '0.06em',
                            opacity: isDepositBusy ? 0.6 : 1,
                        }}
                    >
                        {depositStatus === 'approving' ? '⏳ Transferring...'
                            : depositStatus === 'depositing' ? '⏳ Crediting...'
                            : depositStatus === 'success' ? '✓ Deposited!'
                            : 'Deposit'}
                    </button>
                </div>
                {depositError && <div style={{ fontSize: '0.6rem', color: '#F4B8CE', marginTop: 4 }}>{depositError}</div>}
                {(depositStatus === 'approving' || depositStatus === 'depositing') && (
                    <BlockProgress
                        pendingTxHash={depositTxHash}
                        compact
                    />
                )}
                {depositStatus === 'success' && (
                    <div style={{ fontSize: '0.6rem', color: '#82C4A0', marginTop: 4 }}>
                        Deposit confirmed! Balance updated.
                        {depositTxHash && (
                            <a
                                href={`https://mempool.space/signet/tx/${depositTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#92B4F4', marginLeft: 6, textDecoration: 'none', fontSize: '0.55rem' }}
                            >
                                View TX ↗
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
