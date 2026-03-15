import { useState } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { truncAddr } from '../utils/constants';
import { TierIcon } from './Icons';
import { sound } from '../services/sound';

export function Header({ wallet, connected, onProfile, tierEmoji, tierColor, username, onlineCount }: {
    wallet: ReturnType<typeof useWalletConnect>; connected: boolean;
    onProfile: () => void; tierEmoji: string; tierColor: string;
    username: string | null; onlineCount?: number;
}) {
    const [muted, setMuted] = useState(sound.muted);
    return (
        <header style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 24px',
            background: 'rgba(11,10,20,0.97)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(146,180,244,0.08)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 201,
            fontFamily: "'Chakra Petch', sans-serif",
        }}>
            {/* Logo + TESTNET + Online/Live — all left-aligned together */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: '1.3rem', letterSpacing: '0.03em' }}>
                    <span style={{ color: '#92B4F4' }}>CHART</span>
                    <span style={{ color: '#d4b978', margin: '0 2px', filter: 'drop-shadow(0 0 4px rgba(212,185,120,0.3))' }}>⚡</span>
                    <span style={{ color: '#F4B8CE' }}>ARENA</span>
                </div>
                <span style={{
                    fontSize: '0.65rem', color: '#4a4668',
                    border: '1px solid rgba(146,180,244,0.15)',
                    padding: '1px 6px', letterSpacing: '0.1em',
                    fontFamily: "'IBM Plex Mono', monospace",
                }}>TESTNET</span>

                {/* Online count */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '2px 10px',
                    background: connected ? 'rgba(130,196,160,0.06)' : 'rgba(85,77,115,0.1)',
                    border: '1px solid ' + (connected ? 'rgba(130,196,160,0.15)' : 'rgba(85,77,115,0.2)'),
                    clipPath: 'polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
                    fontSize: '0.6rem', fontWeight: 700, color: connected ? '#82c4a0' : '#554d73',
                    letterSpacing: '0.08em',
                }}>
                    <span style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: connected ? '#82c4a0' : '#554d73',
                        boxShadow: connected ? '0 0 8px #82c4a0' : 'none',
                        animation: connected ? 'pulse 2s infinite' : 'none',
                    }} />
                    {onlineCount !== undefined ? `${onlineCount} ONLINE` : (connected ? 'ONLINE' : 'OFFLINE')}
                </div>

                {/* Live indicator */}
                <span style={{
                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em',
                    color: connected ? '#82c4a0' : '#554d73',
                }}>
                    {connected ? '● LIVE' : '○ OFFLINE'}
                </span>
            </div>

            {/* Right — sound + tier + profile + wallet */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setMuted(sound.toggleMute())} title={muted ? 'Unmute' : 'Mute'} style={{
                    padding: '3px 8px', cursor: 'pointer',
                    border: '1px solid rgba(146,180,244,0.12)', background: 'rgba(146,180,244,0.04)',
                    clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                    fontSize: '0.75rem', color: muted ? '#554d73' : '#92B4F4',
                    transition: 'all 0.2s',
                }}>{muted ? '\u{1F507}' : '\u{1F50A}'}</button>
                {wallet.walletAddress && connected && (
                    <>
                        <div style={{
                            padding: '3px 10px',
                            background: tierColor + '0c', border: '1px solid ' + tierColor + '1a',
                            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                            fontSize: '0.65rem', fontWeight: 700, color: tierColor,
                            display: 'flex', alignItems: 'center', gap: 5,
                            letterSpacing: '0.04em',
                        }}><TierIcon name={tierEmoji} size={14} status="current" /> {tierEmoji}</div>
                        <button onClick={onProfile} style={{
                            padding: '4px 12px', cursor: 'pointer',
                            border: '1.5px solid rgba(244,184,206,0.25)', background: 'rgba(244,184,206,0.06)',
                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem', color: '#F4B8CE',
                            transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>{username ?? 'Profile'}</button>
                    </>
                )}
                {wallet.walletAddress ? (
                    <button onClick={() => {
                        try { localStorage.removeItem('ca-session-token'); } catch {}
                        wallet.disconnect?.();
                        window.location.reload();
                    }} title="Disconnect wallet" style={{
                        padding: '4px 12px', cursor: 'pointer',
                        border: '1px solid rgba(130,196,160,0.2)', background: 'rgba(130,196,160,0.06)',
                        clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                        fontWeight: 600, fontSize: '0.68rem', color: '#82c4a0',
                        fontFamily: "'IBM Plex Mono', monospace",
                        transition: 'all 0.2s',
                    }}>✓ {truncAddr(wallet.walletAddress)} ✕</button>
                ) : (
                    <button onClick={wallet.openConnectModal} disabled={wallet.connecting} style={{
                        padding: '5px 16px', cursor: 'pointer',
                        border: '1.5px solid rgba(146,180,244,0.35)', background: 'rgba(146,180,244,0.1)',
                        clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.68rem', color: '#92B4F4',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        transition: 'all 0.2s',
                    }}>{wallet.connecting ? 'Connecting...' : '🔌 Connect Wallet'}</button>
                )}
            </div>
        </header>
    );
}

/* ═══ MECHA LOBBY — Full-screen cyberpunk pastel lobby ═══ */
