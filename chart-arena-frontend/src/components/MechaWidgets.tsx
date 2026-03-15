import React, { useState } from 'react';
import type { QuestStatus, ReferralData, BattleLogEntry } from '../hooks/useGame';
import { truncAddr } from '../utils/constants';

function mechaT(_dark: boolean) {
    // Always dark — cyberpunk angular design
    return {
        pageBg: '#0b0a14',
        pageGrad: 'radial-gradient(ellipse at 15% 0%, rgba(146,180,244,0.04) 0%, transparent 50%), radial-gradient(ellipse at 85% 100%, rgba(244,184,206,0.03) 0%, transparent 50%)',
        panelBg: 'linear-gradient(168deg, rgba(14,13,22,0.95), rgba(11,10,20,0.9))',
        panelInset: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        panelInsetBot: 'inset 0 -1px 0 rgba(255,255,255,0.02)',
        cardBg: 'rgba(14,13,22,0.65)',
        cardBgAlt: 'rgba(20,16,34,0.5)',
        cardWinBg: 'rgba(130,196,160,0.06)',
        topBarBg: 'rgba(11,10,20,0.9)',
        tabBg: 'rgba(14,13,22,0.8)',
        tabBorder: 'rgba(146,180,244,0.08)',
        tabBorderBot: 'rgba(146,180,244,0.06)',
        textPrimary: '#e0d8f0',
        textMid: '#a09abc',
        textLight: '#6b6590',
        textWhiteShadow: 'none',
        borderAlpha: '15',
        borderBotAlpha: '12',
        shadowAmbient: 'rgba(0,0,0,0.4)',
        glowMult: '20',
        innerHighlight: 'rgba(255,255,255,0.03)',
        scanlineOpacity: 0.02,
        blobOpacity: 0.03,
        badgeBg: 'rgba(14,13,22,0.6)',
        badgeBorder: 'rgba(146,180,244,0.08)',
        badgeBorderBot: 'rgba(146,180,244,0.06)',
        statBg: (c: string) => `${c}0a`,
        statBgGrad: (c: string) => `linear-gradient(180deg, ${c}0c, ${c}06)`,
        questBg: 'rgba(14,13,22,0.65)',
        questDoneBg: 'rgba(130,196,160,0.04)',
        inputBg: 'rgba(14,13,22,0.8)',
        inputBorder: 'rgba(146,180,244,0.12)',
    };
}

/* ═══ MECHA PASTEL COMPONENTS ═══ */

export { mechaT };

export function MechaPanel({ label, accent, accent2, accentDeep, children, tall = false, dark = false }: {
    label: string; accent: string; accent2?: string; accentDeep?: string; children: React.ReactNode; tall?: boolean; dark?: boolean;
}) {
    // Always dark — cyberpunk angular
    const bg = 'linear-gradient(168deg, rgba(14,13,22,0.95), rgba(11,10,20,0.9))';
    const ih = 'rgba(255,255,255,0.03)';
    const sa = 'rgba(0,0,0,0.4)';
    const ba = '15';
    const c2 = accent2 || accent;
    return (
        <div style={{
            position: 'relative', background: bg,
            border: `1px solid ${accent}${ba}`,
            borderRadius: 0, display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(12px)', transition: 'all 0.3s ease',
            boxShadow: `0 0 1px ${accent}20, 0 4px 20px ${sa}, inset 0 1px 0 ${ih}`,
            overflow: 'hidden',
            ...(tall ? {flex: 1, minHeight: 0} : {}),
        }}>
            {/* Corner glow dots — small, rounded, complement the panel */}
            <div style={{position: 'absolute', top: 3, left: 3, width: 4, height: 4, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}60`, zIndex: 2, opacity: 0.7}} />
            <div style={{position: 'absolute', top: 3, right: 3, width: 4, height: 4, borderRadius: '50%', background: c2, boxShadow: `0 0 6px ${c2}60`, zIndex: 2, opacity: 0.7}} />
            <div style={{position: 'absolute', bottom: 3, left: 3, width: 4, height: 4, borderRadius: '50%', background: c2, boxShadow: `0 0 6px ${c2}60`, zIndex: 2, opacity: 0.5}} />
            <div style={{position: 'absolute', bottom: 3, right: 3, width: 4, height: 4, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}60`, zIndex: 2, opacity: 0.5}} />
            {/* Top glow line */}
            <div style={{height: 2, flexShrink: 0,
                background: `linear-gradient(90deg, transparent, ${accent}50, ${c2}40, transparent)`,
            }} />
            {/* Header */}
            <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 6px', flexShrink: 0}}>
                <span style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem', letterSpacing: 2.5, color: accentDeep || accent, flexShrink: 0}}>{label}</span>
                <div style={{flex: 1, height: 1, background: `linear-gradient(90deg, ${accent}30, transparent)`}} />
            </div>
            <div style={{padding: '6px 14px 14px', ...(tall ? {flex: 1, overflow: 'auto', minHeight: 0} : {})}}>
                {children}
            </div>
            {/* Bottom glow line */}
            <div style={{height: 1, flexShrink: 0,
                background: `linear-gradient(90deg, transparent, ${accent}15, transparent)`}} />
        </div>
    );
}


export function MechaPanelCorner({ pos, c }: { pos: string; c: string }) {
    // Replaced with nothing — corners now handled as glow dots inside MechaPanel
    return null;
}


export function MechaCorner({ pos, c1, c2 }: { pos: string; c1: string; c2: string }) {
    // Small glow accent — no more bracket lines
    const base: React.CSSProperties = { position: 'absolute', width: 6, height: 6, borderRadius: '50%', zIndex: 3 };
    const m: Record<string, React.CSSProperties> = {
        tl: { top: -3, left: -3, background: c1, boxShadow: `0 0 8px ${c1}60` },
        tr: { top: -3, right: -3, background: c2, boxShadow: `0 0 8px ${c2}60` },
        bl: { bottom: -3, left: -3, background: c2, boxShadow: `0 0 8px ${c2}60` },
        br: { bottom: -3, right: -3, background: c1, boxShadow: `0 0 8px ${c1}60` },
    };
    return <div style={{...base, ...m[pos]}} />;
}


export function MechaHex({ c }: { c: string }) {
    return <span style={{color: c, fontSize: '0.65rem', opacity: 0.7, fontWeight: 700}}>⬡</span>;
}


export function MechaSectionLabel({ text, c, cd }: { text: string; c: string; cd: string }) {
    return (
        <div style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.68rem', fontWeight: 700, letterSpacing: 2.5, padding: '4px 0'}}>
            <div style={{width: 6, height: 6, borderRadius: 2, background: c, boxShadow: `0 0 8px ${c}60`, flexShrink: 0}} />
            <span style={{color: cd}}>{text}</span>
            <div style={{flex: 1, height: 1, background: `linear-gradient(90deg, ${c}50, transparent)`}} />
        </div>
    );
}


export function MechaQuestRow({ quest, onClaim, social = false, dark = false }: { quest: QuestStatus; onClaim: (id: string) => void; social?: boolean; dark?: boolean }) {
    const done = quest.completed;
    const cardBg = done ? 'rgba(130,196,160,0.04)' : 'rgba(14,13,22,0.65)';
    const textCol = '#e0d8f0';
    const textDim = '#6b6590';
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            background: cardBg,
            border: `1.5px solid ${done ? '#82c4a030' : '#92B4F415'}`,
            borderRadius: 0, transition: 'all 0.3s',
            boxShadow: `0 2px 10px ${done ? '#82c4a0' : '#92B4F4'}10`,
            opacity: done ? 0.6 : 1,
        }}>
            <div style={{
                width: 38, height: 38, borderRadius: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.2rem', flexShrink: 0,
                background: done ? '#82c4a020' : '#92B4F415',
                border: `1.5px solid ${done ? '#82c4a030' : '#92B4F420'}`,
            }}>{quest.emoji}</div>
            <div style={{flex: 1, minWidth: 0}}>
                <div style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.8rem',
                    color: done ? '#7BBF6A' : textCol, display: 'flex', alignItems: 'center',
                }}>
                    {quest.title}
                    {done && <span style={{fontSize: '0.65rem', marginLeft: 5}}>✅</span>}
                </div>
                <div style={{fontSize: '0.68rem', color: textDim, marginTop: 1}}>{quest.description}</div>
                {!social && !done && quest.progress !== undefined && (
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 5}}>
                        <div style={{flex: 1, height: 5, borderRadius: 4, background: '#92B4F420', overflow: 'hidden'}}>
                            <div style={{
                                height: '100%', borderRadius: 4,
                                width: Math.min(100, quest.progress * 100) + '%',
                                background: 'linear-gradient(90deg, #92B4F4, #92B4F4)',
                                boxShadow: '0 0 6px #92B4F440',
                            }} />
                        </div>
                        <span style={{fontSize: '0.65rem', color: '#B8AED4', fontWeight: 600}}>{quest.current}/{quest.requirement}</span>
                    </div>
                )}
            </div>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0}}>
                <span style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem', color: '#b89c5c'}}>+{quest.points}</span>
                {!done && social && (
                    <button onClick={() => {
                        if (quest.actionUrl) window.open(quest.actionUrl, '_blank');
                        setTimeout(() => onClaim(quest.id), 500);
                    }} style={{
                        padding: '4px 12px', clipPath: "polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)",
                        border: '1.5px solid #92B4F460',
                        background: 'linear-gradient(135deg, #92B4F425, #F4B8CE15)',
                        color: '#9B7FC7', cursor: 'pointer',
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem',
                        letterSpacing: 1, boxShadow: '0 2px 8px #92B4F420',
                    }}>CLAIM</button>
                )}
                {done && (
                    <span style={{
                        fontSize: '0.65rem', fontWeight: 700, color: '#7BBF6A',
                        padding: '2px 8px', clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                        background: '#82c4a020', border: '1px solid #82c4a030',
                        letterSpacing: 1,
                    }}>DONE</span>
                )}
            </div>
        </div>
    );
}


export function MechaReferralTab({ data, applyMsg, onApply, dark = false }: {
    data: ReferralData | null; applyMsg: { success: boolean; text: string } | null; onApply: (code: string) => void; dark?: boolean;
}) {
    const [inputCode, setInputCode] = useState('');
    const [copied, setCopied] = useState(false);
    if (!data) return <div style={{textAlign: 'center', color: '#B8AED4', fontSize: '0.8rem', padding: 20}}>Loading...</div>;

    return (
        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
            <div style={{
                padding: '14px 16px',
                background: 'linear-gradient(135deg, #d4b97830, #d4b97815)',
                border: '1.5px solid #d4b97860',
                boxShadow: '0 3px 16px #d4b97815',
            }}>
                <MechaSectionLabel text="YOUR REFERRAL LINK" c="#d4b978" cd="#C4956A" />
                <div style={{display: 'flex', gap: 8, alignItems: 'center', marginTop: 8}}>
                    <div style={{
                        flex: 1, padding: '8px 10px',
                        background: dark ? 'rgba(22,18,38,0.8)' : 'white', border: `1.5px solid ${dark ? 'rgba(247,223,194,0.15)' : '#d4b97840'}`,
                        fontSize: '0.7rem', color: '#4A3D6B', fontFamily: 'monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{data.referralUrl}</div>
                    <button onClick={() => { navigator.clipboard.writeText(data.referralUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{
                        padding: '8px 16px', clipPath: "polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
                        background: copied ? '#82c4a040' : '#d4b97840',
                        border: `1.5px solid ${copied ? '#82c4a0' : '#d4b978'}60`,
                        color: copied ? '#7BBF6A' : '#C4956A',
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer',
                    }}>{copied ? '✓ COPIED' : 'COPY'}</button>
                </div>
                <div style={{fontSize: '0.65rem', color: '#B8AED4', marginTop: 6}}>
                    Earn <b style={{color: '#b89c5c'}}>100 pts</b> per referral + <b style={{color: '#b89c5c'}}>5%</b> of their earnings
                </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
                <div style={{padding: '14px', borderRadius: 0, textAlign: 'center', background: '#92B4F415', border: '1.5px solid #92B4F430', boxShadow: '0 2px 12px #92B4F410'}}>
                    <div style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: '#9B7FC7'}}>{data.totalReferrals}</div>
                    <div style={{fontSize: '0.65rem', color: '#B8AED4', fontWeight: 700, letterSpacing: 1}}>REFERRALS</div>
                </div>
                <div style={{padding: '14px', borderRadius: 0, textAlign: 'center', background: '#d4b97815', border: '1.5px solid #d4b97830', boxShadow: '0 2px 12px #d4b97810'}}>
                    <div style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: '#b89c5c'}}>{data.totalBonusPoints}</div>
                    <div style={{fontSize: '0.65rem', color: '#B8AED4', fontWeight: 700, letterSpacing: 1}}>BONUS PTS</div>
                </div>
            </div>

            {data.referredPlayers.length > 0 && (<>
                <MechaSectionLabel text="YOUR RECRUITS" c="#92B4F4" cd="#9B7FC7" />
                {data.referredPlayers.map((p, i) => (
                    <div key={p.address} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 0, background: i % 2 === 0 ? '#E5ECF860' : 'transparent'}}>
                        <span style={{fontSize: '0.9rem'}}>👤</span>
                        <span style={{fontSize: '0.75rem', color: '#4A3D6B', fontWeight: 600, fontFamily: "'Chakra Petch', sans-serif"}}>{p.displayName}</span>
                    </div>
                ))}
            </>)}

            {!data.hasReferrer && (
                <div style={{padding: '14px 16px', background: '#92B4F408', border: '1.5px dashed #92B4F430'}}>
                    <div style={{fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1, marginBottom: 8}}>HAVE A REFERRAL CODE?</div>
                    <div style={{display: 'flex', gap: 8}}>
                        <input type="text" value={inputCode} onChange={e => setInputCode(e.target.value)} placeholder="Enter code..."
                            style={{flex: 1, padding: '8px 10px', border: '1.5px solid #92B4F430', background: 'white', fontSize: '0.8rem', fontFamily: 'monospace', color: '#4A3D6B', outline: 'none'}} />
                        <button onClick={() => { if (inputCode.trim()) onApply(inputCode.trim()); }} style={{
                            padding: '8px 16px', clipPath: "polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
                            background: inputCode.trim() ? '#92B4F440' : '#E5ECF860',
                            border: `1.5px solid ${inputCode.trim() ? '#92B4F4' : '#E5ECF8'}`,
                            color: inputCode.trim() ? '#9B7FC7' : '#B8AED4',
                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem', cursor: inputCode.trim() ? 'pointer' : 'default',
                        }}>APPLY</button>
                    </div>
                    {applyMsg && <div style={{marginTop: 6, fontSize: '0.7rem', fontWeight: 600, color: applyMsg.success ? '#7BBF6A' : '#D88BA7'}}>{applyMsg.text}</div>}
                </div>
            )}
            {data.hasReferrer && (
                <div style={{padding: '8px 12px', borderRadius: 0, background: '#82c4a015', border: '1px solid #82c4a030', fontSize: '0.7rem', color: '#7BBF6A', fontWeight: 600, textAlign: 'center', fontFamily: "'Chakra Petch', sans-serif"}}>
                    ✓ Referral bonus active
                </div>
            )}
        </div>
    );
}


export function getTimeAgo(date: Date): string {
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}


export function MechaBattleLog({ entries, dark = false }: { entries: BattleLogEntry[]; dark?: boolean }) {
    const MODE_NAMES = ['Classic', 'Survival', 'Chaos'];
    const FORMAT_NAMES = ['Duel', 'Arena'];

    if (entries.length === 0) return (
        <div style={{textAlign: 'center', padding: '32px 16px'}}>
            <div style={{fontSize: '2rem', marginBottom: 8}}>🗡️</div>
            <div style={{fontSize: '0.85rem', color: '#8B7FB0', fontWeight: 600, fontFamily: "'Chakra Petch', sans-serif"}}>No battles yet</div>
            <div style={{fontSize: '0.7rem', color: '#B8AED4', marginTop: 4}}>Play your first match to start your battle log</div>
        </div>
    );

    return (
        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            <div style={{display: 'flex', padding: '6px 12px', gap: 8, borderBottom: '1px solid #92B4F420'}}>
                <span style={{flex: 0.5, fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1.5}}>RANK</span>
                <span style={{flex: 2, fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1.5}}>MODE</span>
                <span style={{flex: 0.8, fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1.5}}>P&L</span>
                <span style={{flex: 1, fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1.5, textAlign: 'right'}}>TIME</span>
            </div>
            {entries.map((e, i) => {
                const pnl = e.finalEquity - 5;
                const date = new Date(e.timestamp * 1000);
                const ago = getTimeAgo(date);
                return (
                    <div key={e.matchId + '-' + i} style={{
                        display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8,
                        background: e.rank === 1 ? (dark ? 'rgba(130,196,160,0.06)' : '#82c4a012') : (dark ? 'rgba(22,18,38,0.6)' : '#E5ECF860'),
                        border: `1.5px solid ${e.rank === 1 ? '#82c4a030' : (dark ? 'rgba(255,255,255,0.06)' : '#E5ECF8')}`,
                        borderRadius: 0,
                        boxShadow: `0 2px 8px ${e.rank === 1 ? '#82c4a0' : '#E5ECF8'}15`,
                    }}>
                        <div style={{flex: 0.5, fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.9rem',
                            color: e.rank === 1 ? '#b89c5c' : e.rank <= 3 ? '#92B4F4' : '#B8AED4'}}>#{e.rank}</div>
                        <div style={{flex: 2}}>
                            <div style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.76rem', color: '#4A3D6B'}}>{FORMAT_NAMES[e.format]} {MODE_NAMES[e.mode]}</div>
                            <div style={{fontSize: '0.65rem', color: '#B8AED4'}}>{e.playerCount}p</div>
                        </div>
                        <div style={{flex: 0.8, fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.88rem',
                            color: pnl >= 0 ? '#7BBF6A' : '#D88BA7'}}>
                            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                        <div style={{flex: 1, fontSize: '0.68rem', color: '#B8AED4', textAlign: 'right'}}>{ago}</div>
                    </div>
                );
            })}
        </div>
    );
}


