import { useState, useEffect } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { gameWS } from '../services/ws';

export function WithdrawButton({ wallet, settlementTx }: { wallet: ReturnType<typeof useWalletConnect>; settlementTx?: string | null }) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [balance, setBalance] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [depositAmount, setDepositAmount] = useState('');
    const [depositStatus, setDepositStatus] = useState<'idle' | 'approving' | 'depositing' | 'success' | 'error'>('idle');
    const [depositError, setDepositError] = useState('');

    // Auto-refresh when a settlement TX lands
    useEffect(() => {
        if (settlementTx) {
            const t = setTimeout(() => setRefreshKey(k => k + 1), 8000);
            return () => clearTimeout(t);
        }
    }, [settlementTx]);

    // Fetch escrow balance on mount + every 30s + on manual refresh
    useEffect(() => {
        if (!wallet.walletAddress) return;
        let cancelled = false;
        const fetchBalance = async () => {
            try {
                const provider = (wallet as any).provider;
                const network = (wallet as any).network;
                if (!provider) return;
                const { getEscrowBalance } = await import('../services/contract');
                const bal = await getEscrowBalance(provider, network, wallet.walletAddress!);
                if (!cancelled) setBalance(bal.toString());
            } catch { if (!cancelled) setBalance('0'); }
        };
        fetchBalance();
        const iv = setInterval(fetchBalance, 30_000);
        return () => { cancelled = true; clearInterval(iv); };
    }, [wallet.walletAddress, refreshKey]);

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
            setTimeout(() => setRefreshKey(k => k + 1), 5000);
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
            const { approveMoto } = await import('../services/contract');
            // Precision-safe conversion
            const parts = depositAmount.split('.');
            const whole = BigInt(parts[0] || '0');
            const decimals = (parts[1] || '').padEnd(18, '0').slice(0, 18);
            const amountWei = whole * (10n ** 18n) + BigInt(decimals);

            // Step 1: Approve escrow to spend MOTO (direct token call — works fine)
            setDepositStatus('approving');
            await approveMoto(provider, network, amountWei, wallet.walletAddress!);

            // Step 2: Ask backend to pull the deposit via operator wallet
            // This avoids the cross-contract simulation issue on the frontend
            setDepositStatus('depositing');
            const unsub = gameWS.on('deposit_status', (msg) => {
                const s = msg['status'] as string;
                if (s === 'broadcast') {
                    unsub();
                    console.log('[Deposit] TX broadcast:', msg['txHash']);
                    setDepositStatus('success');
                    setDepositAmount('');
                    setTimeout(() => { setRefreshKey(k => k + 1); setDepositStatus('idle'); }, 8000);
                } else if (s === 'error') {
                    unsub();
                    console.error('[Deposit] Backend error:', msg['error']);
                    setDepositStatus('error');
                    setDepositError(String(msg['error']).slice(0, 100));
                    setTimeout(() => setDepositStatus('idle'), 5000);
                }
                // 'pulling' status = backend is working, keep showing "Depositing..."
            });
            gameWS.send('deposit_request', { amount: amountWei.toString() });

            // Timeout fallback — if no response in 60s
            setTimeout(() => {
                unsub();
                if (depositStatus === 'depositing') {
                    setDepositStatus('error');
                    setDepositError('Deposit request timed out. Check your escrow balance.');
                    setTimeout(() => setDepositStatus('idle'), 5000);
                }
            }, 60_000);
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
                    Fund your escrow to play matches instantly. The backend creates matches from your escrow balance — no wallet popups during matchmaking.
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
                        {depositStatus === 'approving' ? '⏳ Approving...'
                            : depositStatus === 'depositing' ? '⏳ Depositing...'
                            : depositStatus === 'success' ? '✓ Deposited!'
                            : 'Deposit'}
                    </button>
                </div>
                {depositError && <div style={{ fontSize: '0.6rem', color: '#F4B8CE', marginTop: 4 }}>{depositError}</div>}
                {depositStatus === 'success' && (
                    <div style={{ fontSize: '0.6rem', color: '#82C4A0', marginTop: 4 }}>
                        Deposit broadcast! Balance updates after block confirmation (~10 min).
                    </div>
                )}
            </div>
        </div>
    );
}
