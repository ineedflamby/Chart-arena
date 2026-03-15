import { ITEM_NAMES } from '../hooks/useGame';
import { truncAddr } from '../utils/constants';

export function LeaderboardBanner({ standings, address, startingCapital, foggedPlayers, scrambleActive, thickSkinActive, xrayInventories, targetingItemId, onSelectTarget, onCancelTargeting, eliminatedPlayers, playerNames }: {
    standings: Array<{ address: string; rank: number; finalEquity: number; positionStatus: string }>;
    address: string | null;
    startingCapital: number;
    foggedPlayers: string[];
    scrambleActive: boolean;
    thickSkinActive: boolean;
    xrayInventories: Record<string, number[]>;
    targetingItemId: number | null;
    onSelectTarget: (address: string) => void;
    onCancelTargeting: () => void;
    eliminatedPlayers: string[];
    playerNames: Record<string, string>;
}) {
    const getName = (addr: string) => playerNames[addr] ?? truncAddr(addr).slice(0, 8);
    return (
        <div className="leaderboard-banner">
            {targetingItemId !== null && (
                <div style={{
                    fontSize: '0.68rem', fontWeight: 700, color: '#F4B8CE',
                    marginRight: 8, display: 'flex', alignItems: 'center', gap: 4,
                }}>
                    🎯 Pick target
                    <button onClick={onCancelTargeting} style={{
                        fontSize: '0.65rem', padding: '1px 8px', borderRadius: 0,
                        border: '1px solid rgba(244,184,206,0.2)', background: 'transparent',
                        color: '#F4B8CE', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600,
                    }}>✕</button>
                </div>
            )}
            {standings.length > 0 ? standings.map((s) => {
                const isFogged = foggedPlayers.includes(s.address) && s.address !== address;
                const isMe = s.address === address;
                const isEliminated = eliminatedPlayers.includes(s.address);
                const hasShield = isMe && thickSkinActive;
                const pnl = s.finalEquity - startingCapital;
                const canTarget = targetingItemId !== null && !isMe && !isFogged && !isEliminated;

                return (
                    <div
                        key={s.address}
                        className={`lb-player ${isMe ? 'lb-player--me' : ''} ${isEliminated ? 'lb-player--dead' : ''} ${canTarget ? 'lb-player--targetable' : ''}`}
                        style={{
                            ...(hasShield ? { boxShadow: '0 0 6px rgba(91,192,222,0.4)' } : {}),
                            ...(isFogged ? { opacity: 0.5 } : {}),
                        }}
                        onClick={() => canTarget && onSelectTarget(s.address)}
                    >
                        <span className={`lb-rank lb-rank--${s.rank}`}>#{s.rank}</span>
                        <span className="lb-name">
                            {isMe ? '✨YOU' : isFogged ? '👻???' : isEliminated ? '💀' + getName(s.address).slice(0,4) : getName(s.address)}
                        </span>
                        <span className="lb-pos" style={{
                            color: isFogged ? '#554d73'
                                : (scrambleActive && !isMe)
                                    ? ['#82c4a0','#F4B8CE','#554d73'][Math.floor((Date.now()/1000 + s.address.length) % 3)]
                                    : s.positionStatus === 'LONG' ? '#82c4a0' : s.positionStatus === 'SHORT' ? '#F4B8CE' : '#554d73',
                        }}>
                            {isFogged ? '👻'
                                : (scrambleActive && !isMe)
                                    ? ['🟢','🔴','⚪'][Math.floor((Date.now()/1000 + s.address.length) % 3)]
                                    : s.positionStatus === 'FLAT' ? '⚪' : s.positionStatus === 'LONG' ? '🟢' : '🔴'}
                        </span>
                        {xrayInventories[s.address] && !isMe && (
                            <span style={{ fontSize: '0.7rem' }}>
                                {xrayInventories[s.address].map((id: number) => {
                                    const names: Record<number, string> = {1:'👻',2:'🛡',3:'⚡',4:'📡',5:'🚀',6:'🧊',7:'🪞',8:'🩸',9:'👾',10:'🔄',11:'☢️',12:'🌑',13:'🌋',14:'💰'};
                                    return names[id] ?? '❓';
                                }).join('')}
                            </span>
                        )}
                        <span className="lb-pnl" style={{
                            color: isFogged ? '#554d73' : pnl >= 0 ? '#82c4a0' : '#F4B8CE',
                        }}>
                            {isFogged ? '???' : (pnl >= 0 ? '+' : '') + pnl.toFixed(2)}
                        </span>
                    </div>
                );
            }) : (
                <span style={{ fontSize: '0.7rem', color: '#554d73' }}>Waiting for first tick...</span>
            )}
        </div>
    );
}

/* ── Chat Panel ── */
