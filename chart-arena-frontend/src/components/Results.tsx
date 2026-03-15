import { useGame } from '../hooks/useGame';
import { truncAddr } from '../utils/constants';

export function Results({ standings, address, txHash, status, tradeCount, matchDuration, matchBuyIn, startingCapital, motoUsdPrice, onBackToMenu, onPlayAgain }: {
    standings: ReturnType<typeof useGame>['state']['finalStandings'];
    address: string | null; txHash: string | null; status: string | null;
    tradeCount: number; matchDuration: number;
    matchBuyIn: string; startingCapital: number; motoUsdPrice: number;
    onBackToMenu: () => void;
    onPlayAgain: () => void;
}) {
    const myRank = standings.find((s) => s.address === address);
    const won = myRank?.rank === 1;
    const podium = standings.slice(0, 3);
    const rest = standings.slice(3);
    const podiumEmojis = ['🥇', '🥈', '🥉'];
    const minutes = Math.floor(matchDuration / 60);
    const seconds = matchDuration % 60;
    const accent = won ? '#82c4a0' : '#92B4F4';
    const buyInMoto = Number(BigInt(matchBuyIn || '0')) / 1e18;

    return (
        <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '40px 24px', gap: 20, fontFamily: "'Chakra Petch', sans-serif",
            background: '#0b0a14',
            backgroundImage: `radial-gradient(ellipse at 30% 20%, ${accent}08 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(244,184,206,0.04) 0%, transparent 50%)`,
            animation: 'pop-in 0.5s ease-out',
        }}>
            {/* Scanlines */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02,
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
                animation: 'scanDrift 20s linear infinite',
            }} />

            <div style={{ fontSize: '5rem', animation: 'countdown-pop 0.5s ease-out' }}>
                {won ? '🎉' : myRank && myRank.rank <= 3 ? '🏅' : '😅'}
            </div>
            <h1 style={{
                fontWeight: 700, fontSize: '3rem', animation: 'pop-in 0.6s ease-out',
                color: won ? '#82c4a0' : '#F4B8CE',
                textShadow: `0 0 30px ${won ? 'rgba(130,196,160,0.25)' : 'rgba(244,184,206,0.25)'}`,
                textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
                {won ? 'Victory!' : myRank && myRank.rank <= 3 ? 'Podium!' : 'GG!'}
            </h1>

            {/* PnL card */}
            {myRank && (() => {
                const isProfit = myRank.finalEquity >= startingCapital;
                const pnlRatio = (myRank.finalEquity - startingCapital) / startingCapital;
                const motoFinal = buyInMoto * (myRank.finalEquity / startingCapital);
                const motoResult = buyInMoto * Math.abs(pnlRatio);
                const motoUsd = motoUsdPrice > 0 ? motoFinal * motoUsdPrice : 0;
                return (
                <div style={{
                    padding: '16px 32px', textAlign: 'center',
                    clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
                    background: isProfit
                        ? 'linear-gradient(135deg, rgba(130,196,160,0.06), rgba(109,213,160,0.03))'
                        : 'linear-gradient(135deg, rgba(244,184,206,0.06), rgba(146,180,244,0.03))',
                    border: '1px solid ' + (isProfit ? 'rgba(130,196,160,0.2)' : 'rgba(244,184,206,0.2)'),
                    boxShadow: '0 0 20px ' + (isProfit ? 'rgba(130,196,160,0.08)' : 'rgba(244,184,206,0.08)'),
                    animation: 'slide-up 0.6s ease-out',
                }}>
                    <div style={{
                        fontSize: '2rem', fontWeight: 700,
                        color: isProfit ? '#82c4a0' : '#F4B8CE',
                    }}>
                        {buyInMoto > 0
                            ? `${isProfit ? '+' : '-'}${motoResult.toFixed(2)} MOTO`
                            : (isProfit ? '+$' + (myRank.finalEquity - startingCapital).toFixed(2) : '-$' + (startingCapital - myRank.finalEquity).toFixed(2))
                        }
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#8b7fb0', marginTop: 2 }}>
                        {buyInMoto > 0
                            ? `Final: ${motoFinal.toFixed(2)} MOTO${motoUsd > 0 ? ` (≈ $${motoUsd.toFixed(2)})` : ''} · Rank #${myRank.rank}`
                            : `Final: $${myRank.finalEquity.toFixed(2)} · Rank #${myRank.rank}`
                        }
                    </div>
                </div>
                );
            })()}

            {/* Stats */}
            <div className="results-stats" style={{ animation: 'slide-up 0.7s ease-out' }}>
                {[
                    { label: 'Trades', value: String(tradeCount), emoji: '📊', color: '#92B4F4' },
                    { label: 'Duration', value: `${minutes}:${String(seconds).padStart(2, '0')}`, emoji: '⏱️', color: '#92B4F4' },
                    { label: 'Players', value: String(standings.length), emoji: '👥', color: '#F4B8CE' },
                ].map((stat) => (
                    <div key={stat.label} style={{
                        padding: '8px 16px', textAlign: 'center', minWidth: 80,
                        background: stat.color + '06', border: '1px solid ' + stat.color + '18',
                        clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                    }}>
                        <div style={{ fontSize: '1rem' }}>{stat.emoji}</div>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#e0d8f0' }}>{stat.value}</div>
                        <div style={{ fontSize: '0.65rem', color: '#665C87', letterSpacing: 1 }}>{stat.label.toUpperCase()}</div>
                    </div>
                ))}
            </div>

            {/* Podium */}
            {standings.length > 2 && (
                <div className="results-podium" style={{ animation: 'slide-up 0.8s ease-out' }}>
                    {[1, 0, 2].map((idx) => {
                        const p = podium[idx];
                        if (!p) return null;
                        const isMe = p.address === address;
                        const heights = [130, 96, 76];
                        const podColors = ['#d4b978', '#92B4F4', '#F4B8CE'];
                        const pc = podColors[idx];
                        return (
                            <div key={p.address} style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                padding: '10px 14px', minWidth: 90, height: heights[idx],
                                justifyContent: 'flex-end',
                                clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                                background: isMe ? pc + '0a' : 'rgba(16,13,28,0.85)',
                                border: '1px solid ' + pc + (isMe ? '30' : '15'),
                                boxShadow: isMe ? '0 0 16px ' + pc + '15' : 'none',
                            }}>
                                <div style={{ fontSize: '1.4rem' }}>{podiumEmojis[idx]}</div>
                                <div style={{ fontWeight: 700, fontSize: '0.72rem', color: isMe ? pc : '#8b7fb0' }}>
                                    {isMe ? '✨ YOU' : truncAddr(p.address)}
                                </div>
                                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: p.finalEquity >= startingCapital ? '#82c4a0' : '#F4B8CE' }}>
                                    {buyInMoto > 0 ? (buyInMoto * (p.finalEquity / startingCapital)).toFixed(2) + ' MOTO' : '$' + p.finalEquity.toFixed(2)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Rest */}
            <div style={{
                background: 'rgba(16,13,28,0.85)', borderRadius: 0, padding: 16,
                width: '100%', maxWidth: 400, border: '1px solid rgba(146,180,244,0.06)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
                animation: 'slide-up 0.9s ease-out',
            }}>
                {(standings.length <= 2 ? standings : rest).map((s, i) => (
                    <div key={s.address} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                        fontSize: '0.75rem', animation: `slide-up ${0.8 + i * 0.1}s ease-out`,
                        ...(s.address === address ? { background: 'rgba(146,180,244,0.06)', border: '1px solid rgba(146,180,244,0.12)' } : {}),
                    }}>
                        <span style={{ fontWeight: 700, minWidth: 28, color: s.rank === 1 ? '#d4b978' : s.rank === 2 ? '#92B4F4' : s.rank === 3 ? '#F4B8CE' : '#8b7fb0' }}>#{s.rank}</span>
                        <span style={{ flex: 1, color: '#8b7fb0', fontSize: '0.68rem' }}>{s.address === address ? '✨ YOU' : truncAddr(s.address)}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: s.finalEquity >= startingCapital ? '#82c4a0' : '#F4B8CE' }}>{buyInMoto > 0 ? (buyInMoto * (s.finalEquity / startingCapital)).toFixed(2) + ' MOTO' : '$' + s.finalEquity.toFixed(2)}</span>
                    </div>
                ))}
            </div>

            {/* Settlement */}
            <div style={{ fontSize: '0.8rem', color: '#554d73', animation: 'slide-up 1s ease-out' }}>
                {status === 'settled' && txHash && <span>✅ TX: {truncAddr(txHash)}</span>}
                {status === 'failed' && <span style={{ color: '#F4B8CE' }}>❌ Settlement failed</span>}
                {!status && <span>⏳ Settling...</span>}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, animation: 'slide-up 1.1s ease-out' }}>
                <button onClick={onPlayAgain} style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.95rem',
                    padding: '12px 36px', cursor: 'pointer',
                    border: '1.5px solid rgba(130,196,160,0.4)',
                    background: 'rgba(130,196,160,0.15)',
                    color: '#82c4a0',
                    clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    transition: 'all 0.2s', animation: 'edgeGlow 3s infinite',
                }}>⚔️ Play Again</button>
                <button onClick={onBackToMenu} style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.95rem',
                    padding: '12px 36px', cursor: 'pointer',
                    border: '1.5px solid rgba(146,180,244,0.35)',
                    background: 'rgba(146,180,244,0.12)',
                    color: '#92B4F4',
                    clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    transition: 'all 0.2s',
                }}>Back to Menu</button>
            </div>
        </div>
    );
}
