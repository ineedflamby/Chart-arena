import { useState, useEffect } from 'react';
import type { ChatChannel, ChatMessage, LeaderboardData, LeaderboardEntry, WinnerTickerEntry, ReferralData } from '../hooks/useGame';
import { truncAddr } from '../utils/constants';
import { MODE_ICON_MAP, TierIcon, TierGallery, VOLUME_TIERS, getTierIndex } from './Icons';
import { LobbyBox } from './LobbyBox';

const LP = {
    cream: '#e0d8f0', sky: '#92B4F4', mauve: '#F4B8CE', rose: '#e08a9f',
    peach: '#d4b978', lime: '#82c4a0', lemon: '#d4b978', aqua: '#92B4F4',
    gold: '#d4b978', amber: '#d4b978',
};

const LOBBY_MODES = [
    { id: 0, name: 'Classic', emoji: '🏆', desc: 'Pure skill. Best PnL wins.', color: LP.lime, sub: 'No items in OPEN phase' },
    { id: 1, name: 'Survival', emoji: '💀', desc: 'x2 leverage. Last alive wins.', color: LP.rose, arenaOnly: true, sub: 'Elimination mode' },
    { id: 2, name: 'Chaos', emoji: '🌪️', desc: 'Double items. High volatility.', color: LP.mauve, sub: '6 item drops, 30% T3' },
];

const STAKE_TIERS = [
    { id: 0, name: 'Bronze', display: '5 MOTO', color: '#cd7f32' },
    { id: 1, name: 'Silver', display: '25 MOTO', color: '#c0c0c0' },
    { id: 2, name: 'Gold', display: '100 MOTO', color: '#ffd700' },
];

export function MechaLobby({
    authenticated, connected, walletConnected, onPlay, onConnect, onProfile, onRefreshLeaderboard,
    jackpotAmount, onlineCount, winnerTicker, leaderboard, referralData, referralApplyMsg,
    onApplyReferral, chatMessages, onSendChat, username, address, walletAddress, tierEmoji, tierName,
    profile, totalPoints, walletBalance, walletProvider, walletNetwork,
}: {
    authenticated: boolean; connected: boolean; walletConnected: boolean;
    onPlay: (mode: number, format: number, tier?: number) => void; onConnect: () => void;
    onProfile: () => void; onRefreshLeaderboard: () => void;
    jackpotAmount: string; onlineCount: number;
    winnerTicker: WinnerTickerEntry[]; leaderboard: LeaderboardData;
    referralData: ReferralData | null; referralApplyMsg: { success: boolean; text: string } | null;
    onApplyReferral: (code: string) => void;
    chatMessages: Record<ChatChannel, ChatMessage[]>; onSendChat: (channel: ChatChannel, text: string) => void;
    username: string | null; address: string | null; walletAddress: string | null;
    tierEmoji: string; tierName: string;
    profile: { matchesPlayed: number; wins: number; losses: number; totalVolume: string; tierProgress: number; volumeUsd?: number; volumeMoto?: number } | null;
    totalPoints: number;
    walletBalance: { total: number; confirmed: number } | null;
    walletProvider: any;
    walletNetwork: any;
}) {
    const [selectedMode, setSelectedMode] = useState<number | null>(null);
    const [selectedFormat, setSelectedFormat] = useState<number | null>(null);
    const [lbTab, setLbTab] = useState<'pnl' | 'volume' | 'wins'>('pnl');
    const [chatInput, setChatInput] = useState('');
    const [copied, setCopied] = useState(false);
    const [showSats, setShowSats] = useState(false);
    const [motoBalance, setMotoBalance] = useState<string | null>(null);
    const [escrowBalance, setEscrowBalance] = useState<string | null>(null);
    const canPlay = authenticated && connected;

    // Fetch MOTO token balance via contract service (handles Address duck-typing)
    useEffect(() => {
        if (!walletProvider || !walletNetwork || !walletAddress) { setMotoBalance(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { getMotoBalance } = await import('../services/contract');
                const bal = await getMotoBalance(walletProvider, walletNetwork, walletAddress);
                if (!cancelled) setMotoBalance(bal.toString());
            } catch (err) {
                console.warn('[Balance] Failed to read MOTO balance:', err);
                if (!cancelled) setMotoBalance('0');
            }
        })();
        return () => { cancelled = true; };
    }, [walletProvider, walletNetwork, walletAddress]);

    // Fetch escrow balance
    useEffect(() => {
        if (!walletProvider || !walletNetwork || !walletAddress) { setEscrowBalance(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { getEscrowBalance } = await import('../services/contract');
                const bal = await getEscrowBalance(walletProvider, walletNetwork, walletAddress);
                if (!cancelled) setEscrowBalance(bal.toString());
            } catch (err) {
                console.warn('[Balance] Failed to read escrow balance:', err);
                if (!cancelled) setEscrowBalance('0');
            }
        })();
        return () => { cancelled = true; };
    }, [walletProvider, walletNetwork, walletAddress]);

    // Format BTC balance
    const btcSats = walletBalance?.confirmed ?? 0;
    const btcDisplay = showSats
        ? `${btcSats.toLocaleString()} sats`
        : `${(btcSats / 1e8).toFixed(btcSats > 0 ? 6 : 2)} BTC`;
    const motoDisplay = motoBalance !== null
        ? `${(Number(motoBalance) / 1e18).toFixed(2)} MOTO`
        : '...';
    const escrowDisplay = escrowBalance !== null
        ? `${(Number(escrowBalance) / 1e18).toFixed(2)} MOTO`
        : '...';

    const jackpotMoto = Number(BigInt(jackpotAmount || '0')) / 1e18;
    // P0-1 FIX: totalVolume is stored in MOTO units (e.g. "5"), NOT wei
    const volumeMoto = profile ? Number(profile.totalVolume || '0') : 0;
    const winRate = profile && profile.matchesPlayed > 0
        ? Math.round((profile.wins / profile.matchesPlayed) * 100) : 0;

    const allMsgs = [...(chatMessages.public || []), ...(chatMessages.announcement || [])].sort((a, b) => a.timestamp - b.timestamp).slice(-50);
    const tickerItems = winnerTicker.length > 0 ? winnerTicker : [];
    const lbData = leaderboard[lbTab] || [];

    const handleChatSend = () => {
        if (!chatInput.trim()) return;
        onSendChat('public', chatInput.trim());
        setChatInput('');
    };

    const handleCopyRef = () => {
        if (referralData?.referralUrl) {
            navigator.clipboard.writeText(referralData.referralUrl).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // ═══ LANDING PAGE — shown when wallet is NOT connected ═══
    if (!walletConnected) {
        return (
            <div style={{
                minHeight: '100vh', background: '#0b0a14',
                backgroundImage: 'radial-gradient(ellipse at 20% 0%, rgba(146,180,244,0.06) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, rgba(244,184,206,0.05) 0%, transparent 55%)',
                fontFamily: "'Chakra Petch', sans-serif", color: '#e0d8f0',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                overflow: 'auto',
            }}>
                {/* Scanlines */}
                <div style={{
                    position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02,
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
                    animation: 'scanDrift 20s linear infinite',
                }} />
                {/* Floating blobs */}
                <div style={{position: 'fixed', top: '-5%', left: '15%', width: 400, height: 400, borderRadius: '50%', opacity: 0.035, filter: 'blur(100px)', background: '#92B4F4', pointerEvents: 'none'}} />
                <div style={{position: 'fixed', bottom: '-5%', right: '10%', width: 350, height: 350, borderRadius: '50%', opacity: 0.03, filter: 'blur(100px)', background: '#F4B8CE', pointerEvents: 'none'}} />

                {/* ── HERO ── */}
                <div style={{
                    textAlign: 'center', padding: '80px 24px 40px', maxWidth: 640,
                    animation: 'slide-up 0.6s ease-out',
                }}>
                    <div style={{ fontSize: '4rem', marginBottom: 16, filter: 'drop-shadow(0 4px 20px rgba(146,180,244,0.3))' }}>⚡</div>
                    <h1 style={{
                        fontWeight: 700, fontSize: '2.8rem', lineHeight: 1.1, margin: '0 0 8px',
                        letterSpacing: '0.02em',
                    }}>
                        <span style={{ color: '#92B4F4' }}>CHART</span>
                        <span style={{ color: '#d4b978', margin: '0 8px', filter: 'drop-shadow(0 0 8px rgba(212,185,120,0.4))' }}>⚡</span>
                        <span style={{ color: '#F4B8CE' }}>ARENA</span>
                    </h1>
                    <p style={{
                        fontSize: '1.15rem', fontWeight: 700, color: '#c4b8e8',
                        letterSpacing: '0.06em', textTransform: 'uppercase', margin: '12px 0 0',
                    }}>
                        PvP Trading on Bitcoin
                    </p>
                    <p style={{
                        fontSize: '0.82rem', color: '#8b7fb0', lineHeight: 1.7,
                        maxWidth: 440, margin: '16px auto 0', fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                        Go LONG or SHORT on a live chart. Use items to sabotage your opponents.
                        Best P&L wins the pot. Built on OPNet — real stakes, real strategy.
                    </p>
                </div>

                {/* ── 3 VALUE PROPS ── */}
                <div className="landing-props" style={{
                    animation: 'slide-up 0.7s ease-out',
                }}>
                    {[
                        { emoji: '📈', title: 'Trade', desc: 'Go long or short on a live price chart. Close at the right moment.', color: '#82c4a0' },
                        { emoji: '💥', title: 'Sabotage', desc: '15 items across 3 tiers. Freeze, Nuke, Drain — destroy your rivals.', color: '#F4B8CE' },
                        { emoji: '🏆', title: 'Win', desc: 'Best P&L takes the pot. Climb the ranks. Earn your tier.', color: '#d4b978' },
                    ].map(v => (
                        <div key={v.title} style={{
                            flex: 1, padding: '20px 14px', textAlign: 'center',
                            background: `linear-gradient(168deg, ${v.color}08, transparent)`,
                            border: `1px solid ${v.color}18`,
                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                        }}>
                            <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>{v.emoji}</div>
                            <div style={{
                                fontWeight: 700, fontSize: '0.9rem', color: v.color,
                                letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6,
                            }}>{v.title}</div>
                            <div style={{
                                fontSize: '0.7rem', color: '#8b7fb0', lineHeight: 1.5,
                                fontFamily: "'IBM Plex Mono', monospace",
                            }}>{v.desc}</div>
                        </div>
                    ))}
                </div>

                {/* ── MODE PREVIEW ── */}
                <div className="landing-modes" style={{
                    animation: 'slide-up 0.8s ease-out',
                }}>
                    {LOBBY_MODES.map(m => (
                        <div key={m.id} style={{
                            flex: 1, padding: '14px 10px', textAlign: 'center',
                            background: 'rgba(14,13,22,0.65)',
                            border: '1px solid rgba(146,180,244,0.06)',
                            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                        }}>
                            <div style={{ fontSize: '1.3rem', marginBottom: 4 }}>{m.emoji}</div>
                            <div style={{
                                fontWeight: 700, fontSize: '0.8rem', color: m.color,
                                letterSpacing: '0.04em',
                            }}>{m.name}</div>
                            <div style={{ fontSize: '0.65rem', color: '#554d73', marginTop: 2, fontFamily: "'IBM Plex Mono', monospace" }}>{m.desc}</div>
                        </div>
                    ))}
                </div>

                {/* ── CTA ── */}
                <div style={{
                    padding: '36px 24px 20px', textAlign: 'center',
                    animation: 'slide-up 0.9s ease-out',
                }}>
                    <button onClick={onConnect} style={{
                        padding: '14px 48px', cursor: 'pointer',
                        border: '2px solid rgba(146,180,244,0.4)',
                        background: 'linear-gradient(135deg, rgba(146,180,244,0.12), rgba(244,184,206,0.06))',
                        clipPath: 'polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%)',
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.05rem',
                        color: '#92B4F4', textTransform: 'uppercase', letterSpacing: '0.08em',
                        transition: 'all 0.3s', animation: 'edgeGlow 3s infinite',
                        boxShadow: '0 0 30px rgba(146,180,244,0.1), 0 0 60px rgba(146,180,244,0.05)',
                    }}>
                        🔌 Connect Wallet to Play
                    </button>
                </div>

                {/* ── WALLET + FAUCET LINKS ── */}
                <div style={{
                    textAlign: 'center', padding: '0 24px 12px',
                    animation: 'slide-up 1s ease-out',
                }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b5b95', marginBottom: 8 }}>
                        Need a wallet?{' '}
                        <a href="https://opwallet.org" target="_blank" rel="noopener noreferrer"
                            style={{ color: '#92B4F4', textDecoration: 'underline', fontWeight: 600 }}>
                            Install OP_WALLET
                        </a>
                        {' '}— the OPNet browser extension.
                    </div>
                    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: '0.7rem' }}>
                        <a href="https://faucet.opnet.org" target="_blank" rel="noopener noreferrer"
                            style={{ color: '#d4b978', textDecoration: 'none', fontWeight: 600 }}>
                            🚰 Get testnet MOTO
                        </a>
                        <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer"
                            style={{ color: '#8b7fb0', textDecoration: 'none', fontWeight: 600 }}>
                            📖 Learn about OPNet
                        </a>
                    </div>
                </div>

                {/* ── SOCIAL PROOF BAR ── */}
                <div className="landing-stats" style={{
                    animation: 'slide-up 1.1s ease-out',
                }}>
                    {[
                        { label: 'ONLINE', value: onlineCount > 0 ? String(onlineCount) : '—', color: '#82c4a0' },
                        { label: 'MODES', value: '3', color: '#92B4F4' },
                        { label: 'ITEMS', value: '15', color: '#F4B8CE' },
                        { label: 'TIERS', value: '3', color: '#d4b978' },
                    ].map(s => (
                        <div key={s.label} style={{
                            textAlign: 'center', padding: '8px 16px',
                            background: `${s.color}06`, border: `1px solid ${s.color}12`,
                            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: '0.6rem', color: '#554d73', fontWeight: 700, letterSpacing: 1.5, marginTop: 2 }}>{s.label}</div>
                        </div>
                    ))}
                </div>

                {/* ── WINNER TICKER ── */}
                {tickerItems.length > 0 && (
                    <div style={{
                        width: '100%', overflow: 'hidden', whiteSpace: 'nowrap', padding: '10px 0',
                        borderTop: '1px solid rgba(146,180,244,0.06)',
                        background: 'rgba(8,8,14,0.6)',
                    }}>
                        <div style={{ display: 'inline-flex', animation: 'ticker-scroll 30s linear infinite' }}>
                            {[...tickerItems, ...tickerItems, ...tickerItems].map((w, i) => (
                                <span key={i} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '0 14px', fontSize: '0.67rem', fontWeight: 600,
                                    fontFamily: "'IBM Plex Mono', monospace",
                                }}>
                                    🏆
                                    <span style={{color: '#e0d8f0', fontWeight: 700}}>{w.name}</span>
                                    <span style={{color: w.pnl >= 0 ? '#82c4a0' : '#e08a9f', fontWeight: 700}}>
                                        {w.pnl >= 0 ? '+' : ''}${w.pnl.toFixed(2)}
                                    </span>
                                    <span style={{color: '#3e3a58'}}>◆</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── FOOTER ── */}
                <div style={{
                    padding: '20px 24px 32px', textAlign: 'center',
                    fontSize: '0.65rem', color: '#3e3a58', fontWeight: 600,
                    fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.04em',
                }}>
                    CHART ARENA v0.7 · TESTNET · BUILT ON OPNET · BITCOIN L1
                </div>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100vh', background: '#0b0a14',
            backgroundImage: `radial-gradient(ellipse at 20% 0%, rgba(146,180,244,0.04) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, rgba(244,184,206,0.03) 0%, transparent 55%)`,
            fontFamily: "'IBM Plex Mono', monospace", color: '#a09abc',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
            {/* Scanlines */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02,
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
                animation: 'scanDrift 20s linear infinite',
            }} />

            {/* Header is now universal — rendered by App above */}

            {/* ═══ WINNER TICKER ═══ */}
            <div style={{
                overflow: 'hidden', whiteSpace: 'nowrap', flexShrink: 0,
                padding: '6px 0',
                background: 'rgba(8,8,14,0.85)',
                borderBottom: '1px solid rgba(146,180,244,0.06)',
            }}>
                {tickerItems.length > 0 ? (
                    <div style={{ display: 'inline-flex', animation: 'ticker-scroll 30s linear infinite' }}>
                        {[...tickerItems, ...tickerItems, ...tickerItems].map((w, i) => (
                            <span key={i} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '0 14px', fontSize: '0.67rem', fontWeight: 600,
                                fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.03em',
                            }}>
                                🏆
                                <span style={{color: '#e0d8f0', fontWeight: 700}}>{w.name}</span>
                                <span style={{color: w.pnl >= 0 ? '#82c4a0' : '#e08a9f', fontWeight: 700}}>
                                    {w.pnl >= 0 ? '+' : ''}${w.pnl.toFixed(2)}
                                </span>
                                <span style={{color: '#3e3a58', fontSize: '0.65rem'}}>◆</span>
                            </span>
                        ))}
                    </div>
                ) : (
                    <div style={{textAlign: 'center', fontSize: '0.65rem', color: '#4a4668', fontWeight: 600, padding: '2px 0', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.04em'}}>
                        ⚡ CHART ARENA v0.7 · TESTNET · BUILT ON OPNET · BITCOIN L1
                    </div>
                )}
            </div>

            {/* ═══ MAIN CONTENT ═══ */}
            <div className="lobby-grid">

                {/* LEFT — Mode Selector + Leaderboard */}
                <div style={{display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto'}}>

                    {/* Mode Cards */}
                    <LobbyBox label="SELECT MISSION" accent={LP.sky} accent2={LP.mauve}>
                        <div className="lobby-modes">
                            {LOBBY_MODES.map(m => {
                                const active = selectedMode === m.id;
                                return (
                                    <div key={m.id} onClick={() => { if (selectedFormat !== null) return; setSelectedMode(active ? null : m.id); setSelectedFormat(null); }}
                                        style={{
                                            flex: 1, padding: '18px 12px 14px', cursor: 'pointer',
                                            border: `1.5px solid ${active ? m.color + '60' : 'rgba(146,180,244,0.06)'}`,
                                            background: active
                                                ? `${m.color}12`
                                                : 'rgba(14,13,22,0.65)',
                                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                                            transition: 'all 0.25s ease-out', position: 'relative',
                                            boxShadow: active ? `0 0 28px ${m.color}15` : 'none',
                                            fontFamily: "'Chakra Petch', sans-serif",
                                        }}>
                                        <div style={{fontSize: '1.8rem', filter: active ? 'none' : 'grayscale(0.3)', transition: 'filter 0.2s'}}>
                                            {(() => { const Ic = MODE_ICON_MAP[m.id]; return Ic ? <Ic size={52} active={active} /> : m.emoji; })()}
                                        </div>
                                        <div style={{fontWeight: 700, fontSize: '0.95rem', color: active ? m.color : '#6b6590', transition: 'color 0.2s'}}>{m.name}</div>
                                        <div style={{fontSize: '0.65rem', color: '#4a4668', textAlign: 'center', lineHeight: 1.3}}>{m.desc}</div>
                                        <div style={{fontSize: '0.65rem', color: '#3e3a58', fontStyle: 'italic'}}>{m.sub}</div>
                                        {m.arenaOnly && <div style={{
                                            position: 'absolute', top: 6, right: 6,
                                            fontSize: '0.65rem', fontWeight: 700, letterSpacing: 1,
                                            padding: '1px 5px',
                                            background: `${LP.rose}15`, color: LP.rose, border: `1px solid ${LP.rose}20`,
                                            clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                                        }}>ARENA ONLY</div>}

                                        {active && selectedFormat === null && (
                                            <div style={{display: 'flex', gap: 6, marginTop: 6, width: '100%', animation: 'slideUp 0.2s ease-out'}}>
                                                {!m.arenaOnly && (
                                                    <button onClick={(e) => { e.stopPropagation(); if (canPlay) setSelectedFormat(0); }}
                                                        disabled={!canPlay}
                                                        style={{
                                                            flex: 1, padding: '7px 0', cursor: canPlay ? 'pointer' : 'not-allowed',
                                                            border: `1px solid ${m.color}35`, background: `${m.color}0a`,
                                                            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                                                            color: canPlay ? m.color : '#554d73',
                                                            opacity: canPlay ? 1 : 0.35, transition: 'all 0.2s',
                                                            textTransform: 'uppercase', letterSpacing: '0.04em',
                                                        }}>⚔️ 1v1</button>
                                                )}
                                                <button onClick={(e) => { e.stopPropagation(); if (canPlay) setSelectedFormat(1); }}
                                                    disabled={!canPlay}
                                                    style={{
                                                        flex: 1, padding: '7px 0', cursor: canPlay ? 'pointer' : 'not-allowed',
                                                        border: `1px solid ${m.color}35`, background: `${m.color}0a`,
                                                        clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                                                        color: canPlay ? m.color : '#554d73',
                                                        opacity: canPlay ? 1 : 0.35, transition: 'all 0.2s',
                                                        textTransform: 'uppercase', letterSpacing: '0.04em',
                                                    }}>🏟️ Arena</button>
                                            </div>
                                        )}
                                        {/* Buy-in picker — shown after selecting format */}
                                        {active && selectedFormat !== null && (
                                            <div style={{marginTop: 6, width: '100%', animation: 'slideUp 0.2s ease-out'}}>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    marginBottom: 6,
                                                }}>
                                                    <span style={{fontSize: '0.65rem', color: '#8b7fb0', fontWeight: 600}}>
                                                        {selectedFormat === 0 ? '⚔️ 1v1' : '🏟️ Arena'} — choose buy-in:
                                                    </span>
                                                    <button onClick={(e) => { e.stopPropagation(); setSelectedFormat(null); }}
                                                        style={{
                                                            padding: '1px 6px', border: 'none',
                                                            background: 'rgba(255,255,255,0.06)', color: '#6b6590',
                                                            fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer',
                                                            fontFamily: "'Chakra Petch', sans-serif",
                                                            clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                                                        }}>✕ BACK</button>
                                                </div>
                                                <div style={{display: 'flex', gap: 4}}>
                                                    {STAKE_TIERS.map(s => (
                                                        <button key={s.id}
                                                            onClick={(e) => { e.stopPropagation(); onPlay(m.id, selectedFormat!, s.id); setSelectedFormat(null); }}
                                                            style={{
                                                                flex: 1, padding: '8px 4px', cursor: 'pointer',
                                                                border: `1px solid ${s.color}40`,
                                                                background: `${s.color}12`,
                                                                clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                                                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem',
                                                                color: s.color, transition: 'all 0.2s',
                                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                                                            }}>
                                                            <span style={{fontSize: '0.8rem', fontWeight: 700}}>{s.display}</span>
                                                            <span style={{fontSize: '0.65rem', color: '#6b6590'}}>{s.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {!walletConnected && (
                            <div style={{
                                textAlign: 'center', marginTop: 14, padding: '20px 16px',
                                background: 'linear-gradient(135deg, rgba(146,180,244,0.05), rgba(244,184,206,0.03))',
                                border: '1px solid rgba(146,180,244,0.08)',
                            }}>
                                {/* FI-1: Game explanation for new users */}
                                <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>⚡</div>
                                    <div style={{
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1rem',
                                        color: '#c4b8e8', letterSpacing: '0.04em', marginBottom: 8,
                                    }}>
                                        Competitive PvP Trading on Bitcoin
                                    </div>
                                    <div style={{
                                        fontSize: '0.75rem', color: '#8b7fb0', lineHeight: 1.6, maxWidth: 340, margin: '0 auto',
                                    }}>
                                        Go LONG or SHORT on a live chart. Use items to sabotage opponents.
                                        Best P&L wins the pot. Built on OPNet — real stakes, real strategy.
                                    </div>
                                </div>

                                <button onClick={onConnect} style={{
                                    padding: '10px 32px', cursor: 'pointer',
                                    border: '1.5px solid rgba(146,180,244,0.35)', background: 'rgba(146,180,244,0.1)',
                                    clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
                                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#92B4F4',
                                    textTransform: 'uppercase', letterSpacing: '0.06em',
                                    transition: 'all 0.2s', animation: 'edgeGlow 3s infinite',
                                }}>🔌 Connect Wallet to Play</button>

                                {/* FI-2: Wallet install detection + link */}
                                <div style={{ marginTop: 12, fontSize: '0.7rem', color: '#6b5b95' }}>
                                    Need a wallet?{' '}
                                    <a
                                        href="https://opwallet.org"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#92B4F4', textDecoration: 'underline' }}
                                    >
                                        Install OP_WALLET
                                    </a>
                                    {' '}— the OPNet browser extension for Bitcoin smart contracts.
                                </div>
                                <div style={{ marginTop: 6, display: 'flex', gap: 12, justifyContent: 'center', fontSize: '0.65rem' }}>
                                    <a href="https://faucet.opnet.org" target="_blank" rel="noopener noreferrer"
                                        style={{ color: '#d4b978', textDecoration: 'none' }}>
                                        🚰 Get testnet MOTO
                                    </a>
                                    <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer"
                                        style={{ color: '#8b7fb0', textDecoration: 'none' }}>
                                        📖 Learn about OPNet
                                    </a>
                                </div>
                            </div>
                        )}
                    </LobbyBox>

                    {/* Leaderboard */}
                    <LobbyBox label="LEADERBOARD" accent={LP.gold} accent2={LP.amber}>
                        <div style={{display: 'flex', gap: 3, marginBottom: 8}}>
                            {([
                                { id: 'pnl' as const, label: '💰 PnL' },
                                { id: 'volume' as const, label: '📊 Volume' },
                                { id: 'wins' as const, label: '🏆 Wins' },
                            ]).map(t => (
                                <button key={t.id} onClick={() => setLbTab(t.id)}
                                    style={{
                                        flex: 1, padding: '5px 0', clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                                        border: `1px solid ${lbTab === t.id ? LP.gold + '30' : 'rgba(255,255,255,0.04)'}`,
                                        background: lbTab === t.id ? `${LP.gold}0c` : 'transparent',
                                        color: lbTab === t.id ? LP.gold : '#554d73', cursor: 'pointer',
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600, fontSize: '0.68rem',
                                        transition: 'all 0.2s',
                                    }}>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div style={{display: 'flex', flexDirection: 'column', gap: 3}}>
                            {lbData.length === 0 ? (
                                <div style={{textAlign: 'center', padding: 16, color: '#443d60', fontSize: '0.72rem'}}>
                                    No data yet — play to get on the board!
                                </div>
                            ) : lbData.slice(0, 10).map((p, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 10px', clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                                    background: p.address === address ? `${LP.sky}08` : 'rgba(255,255,255,0.015)',
                                    border: `1px solid ${p.address === address ? LP.sky + '18' : 'transparent'}`,
                                    animation: 'slideUp 0.3s ease-out both',
                                    animationDelay: i * 0.04 + 's',
                                }}>
                                    <span style={{
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.8rem', minWidth: 26,
                                        color: p.rank === 1 ? LP.gold : p.rank === 2 ? LP.sky : p.rank === 3 ? LP.rose : '#554d73',
                                    }}>#{p.rank}</span>
                                    <span style={{fontSize: '0.85rem'}}>{p.tier}</span>
                                    <span style={{flex: 1, fontWeight: 700, fontSize: '0.75rem', color: '#d4cde8'}}>{p.displayName}</span>
                                    <span style={{
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.72rem',
                                        color: lbTab === 'pnl' ? LP.lime : lbTab === 'volume' ? LP.aqua : LP.gold,
                                    }}>
                                        {lbTab === 'pnl'
                                            ? `${Number(p.value) >= 0 ? '+' : ''}${Number(p.value).toFixed(2)} MOTO`
                                            : lbTab === 'volume'
                                                ? `${Number(p.value).toFixed(0)} MOTO`
                                                : `${p.value} wins`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </LobbyBox>
                </div>

                {/* RIGHT — Pilot Card + Rank + Chat */}
                <div style={{display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0}}>

                    {/* ═══ PILOT CARD — wallet balances + stats ═══ */}
                    <LobbyBox label="PILOT" accent={LP.sky} accent2={LP.gold}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

                            {/* Balances */}
                            {walletConnected && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, alignItems: 'stretch' }}>
                                    {/* BTC Balance */}
                                    <div style={{
                                        padding: '8px 10px',
                                        background: 'rgba(241,169,58,0.04)',
                                        border: '1px solid rgba(241,169,58,0.10)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 14, marginBottom: 6 }}>
                                            <span style={{fontSize: '0.5rem', color: '#6b5b95', fontWeight: 700, letterSpacing: '0.08em'}}>BTC</span>
                                            <button onClick={() => setShowSats(!showSats)} style={{
                                                background: 'rgba(241,169,58,0.08)', border: '1px solid rgba(241,169,58,0.15)',
                                                color: '#f1a93a', cursor: 'pointer', padding: '1px 5px',
                                                fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.45rem', fontWeight: 700,
                                                letterSpacing: '0.05em',
                                            }}>{showSats ? 'BTC' : 'SATS'}</button>
                                        </div>
                                        <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#f1a93a', lineHeight: 1.2 }}>
                                            {showSats ? `${btcSats.toLocaleString()}` : `${(btcSats / 1e8).toFixed(btcSats > 0 ? 6 : 2)}`}
                                        </div>
                                        <div style={{ fontSize: '0.5rem', color: '#f1a93a80', fontWeight: 700, marginTop: 2 }}>{showSats ? 'SATS' : 'BTC'}</div>
                                    </div>

                                    {/* Wallet MOTO */}
                                    <div style={{
                                        padding: '8px 10px',
                                        background: 'rgba(146,180,244,0.04)',
                                        border: '1px solid rgba(146,180,244,0.10)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', height: 14, marginBottom: 6 }}>
                                            <span style={{fontSize: '0.5rem', color: '#6b5b95', fontWeight: 700, letterSpacing: '0.08em'}}>WALLET</span>
                                        </div>
                                        <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#92B4F4', lineHeight: 1.2 }}>
                                            {motoBalance !== null ? (Number(motoBalance) / 1e18).toFixed(2) : '...'}
                                        </div>
                                        <div style={{ fontSize: '0.5rem', color: '#92B4F480', fontWeight: 700, marginTop: 2 }}>MOTO</div>
                                    </div>

                                    {/* Escrow MOTO */}
                                    <div style={{
                                        padding: '8px 10px',
                                        background: 'rgba(130,196,160,0.04)',
                                        border: '1px solid rgba(130,196,160,0.10)',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', height: 14, marginBottom: 6 }}>
                                            <span style={{fontSize: '0.5rem', color: '#6b5b95', fontWeight: 700, letterSpacing: '0.08em'}}>ESCROW</span>
                                        </div>
                                        <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.85rem', color: '#82c4a0', lineHeight: 1.2 }}>
                                            {escrowBalance !== null ? (Number(escrowBalance) / 1e18).toFixed(2) : '...'}
                                        </div>
                                        <div style={{ fontSize: '0.5rem', color: '#82c4a080', fontWeight: 700, marginTop: 2 }}>MOTO</div>
                                    </div>
                                </div>
                            )}

                            {/* Quick stats row */}
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4}}>
                                {[
                                    { val: String(profile?.matchesPlayed ?? 0), label: 'DUELS', c: '#92B4F4' },
                                    { val: `${winRate}%`, label: 'W/R', c: '#82c4a0' },
                                    { val: `${volumeMoto.toFixed(0)} MOTO`, label: 'VOL', c: '#d4b978' },
                                    { val: `${totalPoints}`, label: 'PTS', c: '#F4B8CE' },
                                ].map(s => (
                                    <div key={s.label} style={{
                                        textAlign: 'center', padding: '3px 0',
                                        background: `${s.c}06`, border: `1px solid ${s.c}08`,
                                    }}>
                                        <div style={{
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                                            fontSize: '0.75rem', color: s.c,
                                        }}>{s.val}</div>
                                        <div style={{
                                            fontSize: '0.45rem', color: '#4a4668', fontWeight: 700,
                                            letterSpacing: '0.08em',
                                        }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </LobbyBox>

                    {/* Tier Progression Card */}
                    <LobbyBox label="ARENA RANK" accent={LP.gold} accent2={LP.amber}>
                        {(() => {
                            const vol = profile ? Number(profile.totalVolume || '0') : 0;
                            const currentIdx = getTierIndex(vol);
                            const currentTier = VOLUME_TIERS[currentIdx];
                            const nextTier = VOLUME_TIERS[currentIdx + 1] || null;
                            const progress = nextTier
                                ? Math.min(1, (vol - currentTier.min) / (nextTier.min - currentTier.min))
                                : 1;
                            const nextVolStr = nextTier
                                ? (nextTier.min >= 1000000 ? `${(nextTier.min / 1000000).toFixed(0)}M MOTO`
                                    : nextTier.min >= 1000 ? `${(nextTier.min / 1000).toFixed(0)}K MOTO`
                                    : `${nextTier.min} MOTO`)
                                : 'MAX';

                            return (
                                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8}}>
                                    {/* Tier icon — custom SVG with glow */}
                                    <TierIcon name={currentTier.name} size={56} status="current" />

                                    {/* Tier name */}
                                    <div style={{
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1rem',
                                        color: LP.gold, letterSpacing: 1,
                                        textShadow: `0 0 12px ${LP.gold}30`,
                                    }}>{currentTier.name}</div>

                                    {/* Points */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <span style={{fontSize: '1.1rem'}}>⭐</span>
                                        <span style={{
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.3rem',
                                            color: '#e0d8f0',
                                        }}>{totalPoints.toLocaleString()}</span>
                                        <span style={{fontSize: '0.65rem', color: '#554d73', fontWeight: 600}}>PTS</span>
                                    </div>

                                    {/* Progress bar */}
                                    <div style={{width: '100%', marginTop: 2}}>
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            fontSize: '0.65rem', color: '#554d73', fontWeight: 600, marginBottom: 4,
                                        }}>
                                            <span style={{display: 'flex', alignItems: 'center', gap: 3, color: LP.gold}}>
                                                <TierIcon name={currentTier.name} size={12} status="current" /> {currentTier.name}
                                            </span>
                                            <span style={{display: 'flex', alignItems: 'center', gap: 3, color: LP.aqua}}>
                                                {nextTier ? nextTier.name : 'MAX'} {nextTier && <TierIcon name={nextTier.name} size={12} status="locked" />}
                                            </span>
                                        </div>
                                        <div style={{
                                            width: '100%', height: 10, borderRadius: 5,
                                            background: 'rgba(255,255,255,0.05)',
                                            border: `1px solid ${LP.gold}18`,
                                            overflow: 'hidden',
                                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
                                        }}>
                                            <div style={{
                                                height: '100%', borderRadius: 5,
                                                width: Math.max(2, progress * 100) + '%',
                                                background: `linear-gradient(90deg, ${LP.gold}, ${LP.amber})`,
                                                boxShadow: `0 0 10px ${LP.gold}50, 0 0 20px ${LP.gold}20`,
                                                transition: 'width 0.5s ease',
                                            }} />
                                        </div>
                                        <div style={{
                                            textAlign: 'center', marginTop: 4,
                                            fontSize: '0.65rem', color: '#8b7fb0', fontWeight: 600,
                                            fontFamily: "'Chakra Petch', sans-serif",
                                        }}>
                                            {vol.toLocaleString('en-US', {maximumFractionDigits: 0})} MOTO
                                            {nextTier && <span style={{color: '#554d73'}}> / {nextVolStr}</span>}
                                        </div>
                                    </div>

                                    {/* Referral link + count — compact */}
                                    <div style={{
                                        width: '100%', marginTop: 4,
                                        display: 'flex', gap: 6, alignItems: 'center',
                                        padding: '6px 10px', clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                                        background: 'rgba(255,255,255,0.025)', border: `1px solid ${LP.rose}15`,
                                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
                                    }}>
                                        <span style={{fontSize: '0.75rem'}}>🔗</span>
                                        <div style={{
                                            flex: 1, fontFamily: "'Chakra Petch', sans-serif", fontSize: '0.65rem', fontWeight: 600,
                                            color: LP.rose, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>{referralData?.referralUrl ?? 'Connect wallet'}</div>
                                        <button onClick={handleCopyRef} style={{
                                            padding: '3px 8px', border: `1px solid ${LP.rose}25`,
                                            clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                                            background: `${LP.rose}0c`, color: LP.rose, cursor: 'pointer',
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem',
                                        }}>{copied ? '✅' : '📋'}</button>
                                        <span style={{
                                            fontSize: '0.65rem', fontWeight: 700, color: LP.rose,
                                            fontFamily: "'Chakra Petch', sans-serif",
                                        }}>{referralData?.totalReferrals ?? 0} ref</span>
                                    </div>

                                    {/* Tier gallery — all 15 ranks with status */}
                                    <TierGallery currentTierIndex={currentIdx} />
                                </div>
                            );
                        })()}
                    </LobbyBox>

                    {/* Chat */}
                    <LobbyBox label="GLOBAL CHAT" accent={LP.sky} accent2={LP.aqua} flex>
                        <div style={{display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0}}>
                            <div style={{
                                flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3,
                                padding: '2px 0', minHeight: 0,
                            }}>
                                {allMsgs.length === 0 ? (
                                    <div style={{textAlign: 'center', color: '#443d60', fontSize: '0.7rem', padding: 20}}>
                                        No messages yet — say hi!
                                    </div>
                                ) : allMsgs.map((msg, i) => {
                                    const isSystem = msg.channel === 'announcement' || msg.sender === 'SYSTEM';
                                    return (
                                        <div key={i} style={{
                                            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 5,
                                            padding: isSystem ? '4px 8px' : '2px 0', fontSize: '0.7rem',
                                            ...(isSystem ? {
                                                clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                                                background: `linear-gradient(135deg, ${LP.mauve}06, ${LP.lime}03)`,
                                                border: `1px solid ${LP.mauve}0c`,
                                                fontWeight: 600, color: LP.mauve,
                                            } : {}),
                                        }}>
                                            {!isSystem && (
                                                <span style={{fontWeight: 700, fontSize: '0.65rem', color: LP.sky}}>
                                                    {msg.senderDisplay || truncAddr(msg.sender)}
                                                </span>
                                            )}
                                            <span style={{color: isSystem ? LP.mauve : '#b8aed0'}}>{msg.text}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{
                                display: 'flex', gap: 4, padding: '6px 0 0',
                                borderTop: `1px solid rgba(255,255,255,0.04)`, flexShrink: 0, marginTop: 'auto',
                            }}>
                                <input
                                    style={{
                                        flex: 1, padding: '7px 12px', clipPath: "polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)",
                                        border: `1px solid ${LP.sky}10`, background: 'rgba(255,255,255,0.02)',
                                        fontFamily: "'IBM Plex Mono'", fontSize: '0.72rem', color: '#d4cde8', outline: 'none',
                                    }}
                                    type="text"
                                    placeholder={authenticated ? 'Type a message...' : 'Connect wallet to chat'}
                                    disabled={!authenticated}
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleChatSend()}
                                />
                                <button onClick={handleChatSend} disabled={!authenticated} style={{
                                    padding: '7px 14px', clipPath: "polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)", border: 'none',
                                    background: authenticated ? `linear-gradient(135deg, ${LP.sky}25, ${LP.mauve}18)` : 'rgba(255,255,255,0.02)',
                                    color: '#fff', fontSize: '0.8rem', fontWeight: 700,
                                    cursor: authenticated ? 'pointer' : 'not-allowed',
                                    opacity: authenticated ? 1 : 0.3,
                                }}>➤</button>
                            </div>
                        </div>
                    </LobbyBox>
                </div>
            </div>
        </div>
    );
}


