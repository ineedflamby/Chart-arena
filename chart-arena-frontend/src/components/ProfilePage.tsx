import { useState } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { useGame, type QuestStatus, type ReferralData, type BattleLogEntry } from '../hooks/useGame';
import { ConstellationRank } from './ConstellationRank';
import { TierIcon, TierGallery, VOLUME_TIERS, getTierIndex } from './Icons';
import { truncAddr } from '../utils/constants';
import { MatchRecovery } from './MatchRecovery';
import { mechaT, MechaPanel, MechaSectionLabel, MechaQuestRow, MechaReferralTab, MechaBattleLog } from './MechaWidgets';
import { WithdrawButton } from './WithdrawButton';

export function ProfilePage({ state, wallet, darkMode, closeProfile, setProfileTab, claimQuest, applyReferral }: {
    state: ReturnType<typeof useGame>['state'];
    wallet: ReturnType<typeof useWalletConnect>;
    darkMode: boolean;
    closeProfile: () => void;
    setProfileTab: (tab: 'stats' | 'missions' | 'referring' | 'battlelog') => void;
    claimQuest: (questId: string) => void;
    applyReferral: (code: string) => void;
}) {
    if (!state.profile) {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: '#0b0a14', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 16, fontFamily: "'Chakra Petch', sans-serif",
            }}>
                <div className="onchain-spinner" />
                <div style={{ color: '#8b7fb0', fontSize: '0.9rem' }}>Loading profile...</div>
                <button onClick={closeProfile} style={{
                    padding: '6px 16px', borderRadius: 0, border: '1px solid rgba(146,180,244,0.15)',
                    background: 'transparent', color: '#92B4F4', cursor: 'pointer',
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600, fontSize: '0.75rem',
                }}>‹ Back</button>
            </div>
        );
    }
    const T = mechaT(darkMode);
    return (
                <div style={{
                    position: 'fixed', top: 44, left: 0, right: 0, bottom: 0, zIndex: 200,
                    background: T.pageBg,
                    backgroundImage: T.pageGrad,
                    fontFamily: "'Chakra Petch', 'IBM Plex Mono', sans-serif",
                    color: T.textPrimary,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    transition: 'background 0.4s ease, color 0.3s ease',
                }}>
                    {/* Scanlines */}
                    <div style={{
                        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: T.scanlineOpacity,
                        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #92B4F415 2px, #92B4F415 4px)',
                    }} />
                    {/* Floating blobs */}
                    <div style={{position: 'fixed', top: '5%', left: '10%', width: 300, height: 300, borderRadius: '50%', opacity: T.blobOpacity, filter: 'blur(80px)', background: '#92B4F4', pointerEvents: 'none'}} />
                    <div style={{position: 'fixed', top: '60%', right: '5%', width: 250, height: 250, borderRadius: '50%', opacity: T.blobOpacity, filter: 'blur(80px)', background: '#F4B8CE', pointerEvents: 'none'}} />
                    <div style={{position: 'fixed', bottom: '10%', left: '30%', width: 200, height: 200, borderRadius: '50%', opacity: T.blobOpacity, filter: 'blur(80px)', background: '#d4b978', pointerEvents: 'none'}} />

                    {/* Simple back bar */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 24px',
                        borderBottom: '1px solid rgba(146,180,244,0.06)',
                        background: 'rgba(11,10,20,0.8)',
                        flexShrink: 0, position: 'relative', zIndex: 1,
                        backdropFilter: 'blur(12px)',
                    }}>
                        <button onClick={closeProfile} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'rgba(146,180,244,0.06)',
                            border: '1px solid rgba(146,180,244,0.12)',
                            padding: '5px 14px', cursor: 'pointer',
                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                            color: '#92B4F4', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.72rem',
                            letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>
                            ‹ ARENA
                        </button>
                        <div style={{
                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem',
                            letterSpacing: '0.12em', color: '#6b6590',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            ◇ PILOT PROFILE ◇
                        </div>
                        <div style={{ width: 80 }} />
                    </div>

                    {/* Main grid */}
                    <div className="profile-grid">
                        {/* ═══ LEFT COLUMN ═══ */}
                        <div style={{display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto'}}>

                            {/* PILOT ID */}
                            <MechaPanel label="PILOT ID" accent="#92B4F4" accent2="#F4B8CE" accentDeep="#92B4F4" dark={darkMode}>
                                <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
                                    <div style={{position: 'relative', width: 80, height: 80, flexShrink: 0}}>
                                        <div style={{
                                            width: '100%', height: '100%', border: '2.5px solid #92B4F470',
                                            borderBottom: '3.5px solid #92B4F460',
                                            overflow: 'hidden',
                                            boxShadow: `
                                                0 4px 16px #92B4F430,
                                                0 8px 32px rgba(0,0,0,0.05),
                                                inset 0 2px 4px rgba(255,255,255,0.8),
                                                inset 0 -2px 6px #92B4F412
                                            `,
                                        }}>
                                            <div style={{
                                                width: '100%', height: '100%',
                                                background: 'linear-gradient(145deg, #F0EBF8, #E5ECF8, #92B4F420)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                {state.twitterHandle ? (
                                                    <img
                                                        src={`https://unavatar.io/twitter/${state.twitterHandle}`}
                                                        alt=""
                                                        style={{width: '100%', height: '100%', objectFit: 'cover'}}
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }}
                                                    />
                                                ) : null}
                                                <span style={{fontSize: '2.4rem', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))', ...(state.twitterHandle ? {display: 'none'} : {})}}>{state.profile.tierEmoji}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{flex: 1}}>
                                        <div style={{fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.5rem', color: '#E0D8F0', lineHeight: 1.1}}>
                                            {state.username ?? truncAddr(state.address ?? '')}
                                        </div>
                                        <div style={{marginTop: 6}}>
                                            <span style={{
                                                display: 'inline-block', padding: '2px 10px', borderRadius: 0,
                                                fontSize: '0.68rem', fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif",
                                                border: '1.5px solid #92B4F4', color: '#9B7FC7',
                                                background: '#92B4F430', letterSpacing: 0.5,
                                            }}>{state.profile.tierName ?? state.profile.tier}</span>
                                        </div>
                                        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 10}}>
                                            <div style={{
                                                flex: 1, height: 7, borderRadius: 6,
                                                background: '#92B4F418', overflow: 'hidden',
                                                border: '1px solid #92B4F420',
                                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8)',
                                            }}>
                                                <div style={{
                                                    height: '100%', borderRadius: 6,
                                                    width: state.profile.tierProgress + '%',
                                                    background: 'linear-gradient(180deg, #92B4F4, #A8CFEA)',
                                                    boxShadow: '0 0 8px #92B4F440, inset 0 1px 0 rgba(255,255,255,0.5)',
                                                    transition: 'width 0.6s ease',
                                                }} />
                                            </div>
                                            <span style={{fontSize: '0.65rem', fontWeight: 700, color: '#92B4F4', fontFamily: "'Chakra Petch', sans-serif"}}>{state.profile.tierProgress}%</span>
                                        </div>
                                    </div>
                                </div>
                            </MechaPanel>

                            {/* ARENA POINTS */}
                            <MechaPanel label="ARENA POINTS" accent="#d4b978" accent2="#d4b978" accentDeep="#b89c5c" dark={darkMode}>
                                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                                        <span style={{fontSize: '1.5rem'}}>⭐</span>
                                        <span style={{
                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.8rem',
                                            background: 'linear-gradient(135deg, #b89c5c, #d4b978)',
                                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                        }}>{state.totalPoints.toLocaleString()}</span>
                                    </div>
                                    <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
                                        <span style={{fontSize: '0.68rem', color: '#8B7FB0', display: 'flex', alignItems: 'center', gap: 6}}>
                                            <span style={{color: '#7BBF6A'}}>●</span> {state.quests.filter(q => q.completed).length}/{state.quests.length} quests
                                        </span>
                                        <span style={{fontSize: '0.68rem', color: '#8B7FB0', display: 'flex', alignItems: 'center', gap: 6}}>
                                            <span style={{color: '#b89c5c'}}>●</span> Pre-launch
                                        </span>
                                    </div>
                                </div>
                            </MechaPanel>

                            {/* BADGES */}
                            <MechaPanel label="BADGES" accent="#92B4F4" accent2="#92B4F4" accentDeep="#92B4F4" dark={darkMode}>
                                <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                                    {(() => {
                                        // Build evolving badges from quest chains
                                        const buildBadge = (category: string, label: string, color: string) => {
                                            const quests = state.quests.filter(q => q.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
                                            const done = quests.filter(q => q.completed);
                                            const cur = quests.find(q => !q.completed);
                                            const last = done[done.length - 1];
                                            const maxed = !cur && !!last;
                                            const active = done.length > 0;
                                            return { label, quests, done, cur, last, maxed, active, tierCount: quests.length, color };
                                        };

                                        const globalBadges = [
                                            buildBadge('play', 'PLAY', '#92B4F4'),
                                            buildBadge('win', 'WIN', '#92B4F4'),
                                            buildBadge('streak', 'STREAK', '#92B4F4'),
                                        ];
                                        const modeBadges = [
                                            buildBadge('classic', '🎯 CLASSIC', '#82c4a0'),
                                            buildBadge('survival', '💀 SURVIVAL', '#e08a9f'),
                                            buildBadge('chaos', '🌀 CHAOS', '#9B7FC7'),
                                        ];

                                        // Skill trophies: event-based one-shot quests across all modes
                                        const skillQuests = state.quests.filter(q =>
                                            (q.category === 'classic' || q.category === 'survival' || q.category === 'chaos' || q.category === 'crossmode')
                                            && q.requirement <= 1
                                        ).sort((a, b) => a.sortOrder - b.sortOrder);

                                        // Triple Crown check
                                        const cm = state.profile?.classicMastery ?? { level: 0, max: 12 };
                                        const sm = state.profile?.survivalMastery ?? { level: 0, max: 12 };
                                        const chm = state.profile?.chaosMastery ?? { level: 0, max: 12 };
                                        const tripleCrown = cm.level >= cm.max && sm.level >= sm.max && chm.level >= chm.max;

                                        const renderBadgeRow = (b: ReturnType<typeof buildBadge>) => {
                                            const emoji = b.maxed ? b.last!.emoji : (b.last?.emoji ?? (b.cur?.emoji ?? '🔒'));
                                            const tierName = b.maxed ? b.last!.title : (b.last?.title ?? '—');
                                            const isLocked = !b.active;
                                            const c = b.color;
                                            return (
                                                <div key={b.label} style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '10px 14px',
                                                    background: b.maxed ? `${c}12` : b.active ? `${c}0a` : 'rgba(14,13,22,0.5)',
                                                    border: `1.5px solid ${b.maxed ? c + '40' : b.active ? c + '20' : 'rgba(255,255,255,0.06)'}`,
                                                    borderLeft: `3px solid ${b.maxed ? c + '80' : b.active ? c + '40' : 'rgba(255,255,255,0.06)'}`,
                                                    opacity: isLocked ? 0.4 : 1,
                                                    transition: 'all 0.2s',
                                                }}>
                                                    <div style={{
                                                        width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '1.3rem', flexShrink: 0,
                                                        background: b.maxed ? `${c}20` : b.active ? `${c}10` : 'rgba(255,255,255,0.03)',
                                                        border: `1px solid ${b.maxed ? c + '30' : b.active ? c + '15' : 'rgba(255,255,255,0.06)'}`,
                                                        filter: isLocked ? 'grayscale(0.6)' : (b.maxed ? `drop-shadow(0 2px 6px ${c}50)` : 'none'),
                                                    }}>{emoji}</div>
                                                    <div style={{flex: 1, minWidth: 0}}>
                                                        <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem', letterSpacing: 1.5, color: '#8B7FB0' }}>{b.label}</div>
                                                        <div style={{
                                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                                                            color: b.maxed ? '#7BBF6A' : b.active ? '#e0d8f0' : '#6b6590', marginTop: 1,
                                                        }}>
                                                            {isLocked ? 'Locked' : tierName}
                                                            {b.maxed && <span style={{fontSize: '0.6rem', marginLeft: 5}}>✅</span>}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: '0.6rem', color: c + 'aa', flexShrink: 0 }}>
                                                        {b.done.length}/{b.tierCount}
                                                    </div>
                                                </div>
                                            );
                                        };

                                        return (<>
                                            {/* Triple Crown */}
                                            {tripleCrown && (
                                                <div style={{
                                                    textAlign: 'center' as const, padding: '16px 12px',
                                                    background: 'linear-gradient(135deg, #d4b97825, #82c4a015, #9B7FC720)',
                                                    border: '2px solid #d4b97860',
                                                    boxShadow: '0 0 20px #d4b97830, inset 0 0 20px #d4b97810',
                                                    animation: 'pulse 2s ease-in-out infinite',
                                                }}>
                                                    <div style={{ fontSize: '2rem', marginBottom: 4 }}>👑</div>
                                                    <div style={{
                                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.9rem',
                                                        background: 'linear-gradient(90deg, #d4b978, #82c4a0, #9B7FC7, #d4b978)',
                                                        backgroundSize: '200% auto',
                                                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                                        letterSpacing: 3,
                                                    }}>TRIPLE CROWN</div>
                                                    <div style={{ fontSize: '0.6rem', color: '#b89c5c', marginTop: 4 }}>
                                                        Master of all three modes
                                                    </div>
                                                </div>
                                            )}

                                            {/* Global chains */}
                                            <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#6B6190', letterSpacing: 2, marginTop: 4, marginBottom: -4, fontFamily: "'Chakra Petch', sans-serif" }}>GLOBAL</div>
                                            {globalBadges.map(renderBadgeRow)}

                                            {/* Mode chains */}
                                            <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#6B6190', letterSpacing: 2, marginTop: 8, marginBottom: -4, fontFamily: "'Chakra Petch', sans-serif" }}>MODE MASTERY</div>
                                            {modeBadges.map(renderBadgeRow)}

                                            {/* Skill Trophies Grid */}
                                            {skillQuests.length > 0 && (<>
                                                <div style={{ fontSize: '0.55rem', fontWeight: 700, color: '#6B6190', letterSpacing: 2, marginTop: 8, marginBottom: 2, fontFamily: "'Chakra Petch', sans-serif" }}>SKILL TROPHIES</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                                                    {skillQuests.map(q => {
                                                        const trophyColor =
                                                            q.category === 'classic' ? '#82c4a0' :
                                                            q.category === 'survival' ? '#e08a9f' :
                                                            q.category === 'chaos' ? '#9B7FC7' : '#d4b978';
                                                        return (
                                                            <div key={q.id} title={`${q.title}: ${q.description}`} style={{
                                                                display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center',
                                                                padding: '8px 4px', minHeight: 56,
                                                                background: q.completed ? `${trophyColor}15` : 'rgba(14,13,22,0.4)',
                                                                border: `1px solid ${q.completed ? trophyColor + '35' : 'rgba(255,255,255,0.05)'}`,
                                                                opacity: q.completed ? 1 : 0.3,
                                                                filter: q.completed ? `drop-shadow(0 2px 6px ${trophyColor}40)` : 'grayscale(0.8)',
                                                                transition: 'all 0.2s',
                                                                cursor: 'default',
                                                            }}>
                                                                <span style={{ fontSize: '1.1rem' }}>{q.emoji}</span>
                                                                <span style={{
                                                                    fontSize: '0.45rem', fontWeight: 700, color: q.completed ? trophyColor : '#5A5480',
                                                                    fontFamily: "'Chakra Petch', sans-serif", marginTop: 3, textAlign: 'center' as const,
                                                                    lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden',
                                                                }}>{q.title}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>)}
                                        </>);
                                    })()}
                                </div>
                            </MechaPanel>
                        </div>

                        {/* ═══ RIGHT COLUMN ═══ */}
                        <div style={{display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0}}>

                            {/* Tab bar */}
                            <div style={{display: 'flex', gap: 4, flexShrink: 0}}>
                                {([
                                    { id: 'stats', label: 'COMBAT STATS', icon: '📊', c: '#92B4F4', cd: '#92B4F4' },
                                    { id: 'missions', label: 'MISSIONS', icon: '🎯', c: '#92B4F4', cd: '#9B7FC7' },
                                    { id: 'referring', label: 'REFER', icon: '🔗', c: '#d4b978', cd: '#C4956A' },
                                    { id: 'battlelog', label: 'BATTLE LOG', icon: '📜', c: '#F4B8CE', cd: '#D88BA7' },
                                ] as const).map(t => (
                                    <button key={t.id} onClick={() => setProfileTab(t.id)} style={{
                                        flex: 1, padding: '10px 8px', position: 'relative' as const,
                                        background: state.profileTab === t.id
                                            ? (darkMode ? `linear-gradient(180deg, ${t.c}30, ${t.c}18)` : `linear-gradient(180deg, ${t.c}50, ${t.c}30)`)
                                            : (darkMode ? 'linear-gradient(180deg, rgba(28,22,48,0.6), rgba(22,18,38,0.4))' : 'linear-gradient(180deg, #F5F0FA, #EBE5F5)'),
                                        border: state.profileTab === t.id
                                            ? `1.5px solid ${t.c}${darkMode ? '50' : '80'}`
                                            : `1.5px solid ${darkMode ? 'rgba(255,255,255,0.06)' : '#E5DFF0'}`,
                                        borderBottom: state.profileTab === t.id
                                            ? `2.5px solid ${t.c}${darkMode ? '40' : '90'}`
                                            : `2.5px solid ${darkMode ? 'rgba(255,255,255,0.04)' : '#DDD6EB'}`,
                                        borderRadius: 0, color: state.profileTab === t.id ? t.cd : '#B8AED4',
                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600, fontSize: '0.65rem',
                                        letterSpacing: 1, cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                        transition: 'all 0.2s', overflow: 'hidden' as const,
                                        boxShadow: state.profileTab === t.id
                                            ? `0 4px 16px ${t.c}25, inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(0,0,0,0.06)`
                                            : '0 2px 6px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)',
                                        textShadow: state.profileTab === t.id ? `0 1px 0 rgba(255,255,255,0.5)` : 'none',
                                        transform: state.profileTab === t.id ? 'translateY(-1px)' : 'none',
                                    }}>
                                        <span>{t.icon}</span> {t.label}
                                        {state.profileTab === t.id && <div style={{
                                            position: 'absolute' as const, bottom: 0, left: '15%', right: '15%',
                                            height: 3, borderRadius: 3, background: t.c, opacity: 0.8,
                                        }} />}
                                    </button>
                                ))}
                            </div>

                            {/* Tab content */}
                            <MechaPanel
                                label={state.profileTab === 'stats' ? 'COMBAT DATA' : state.profileTab === 'missions' ? 'MISSION BOARD' : state.profileTab === 'referring' ? 'REFERRAL HQ' : 'BATTLE LOG'}
                                accent={state.profileTab === 'stats' ? '#92B4F4' : state.profileTab === 'missions' ? '#92B4F4' : state.profileTab === 'referring' ? '#d4b978' : '#F4B8CE'}
                                accent2={state.profileTab === 'stats' ? '#d4b978' : state.profileTab === 'missions' ? '#F4B8CE' : state.profileTab === 'referring' ? '#d4b978' : '#d4b978'}
                                accentDeep={state.profileTab === 'stats' ? '#92B4F4' : state.profileTab === 'missions' ? '#9B7FC7' : state.profileTab === 'referring' ? '#C4956A' : '#D88BA7'}
                                dark={darkMode}
                                tall
                            >
                                {/* ━━━ STATS ━━━ */}
                                {state.profileTab === 'stats' && (
                                    <>
                                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10}}>
                                        {[
                                            { label: 'MATCHES', val: state.profile.matchesPlayed, emoji: '⚔️', c: '#92B4F4', cd: '#92B4F4' },
                                            { label: 'VICTORIES', val: state.profile.wins, emoji: '🏆', c: '#92B4F4', cd: '#92B4F4' },
                                            { label: 'DEFEATS', val: state.profile.losses, emoji: '💔', c: '#92B4F4', cd: '#92B4F4' },
                                            { label: 'WIN RATE', val: state.profile.matchesPlayed > 0 ? Math.round((state.profile.wins / state.profile.matchesPlayed) * 100) + '%' : '—', emoji: '📈', c: '#92B4F4', cd: '#92B4F4' },
                                            { label: 'BEST RANK', val: state.profile.bestRank < 999 ? '#' + state.profile.bestRank : '—', emoji: '🥇', c: '#92B4F4', cd: '#92B4F4' },
                                            { label: 'VOLUME', val: Number(state.profile.totalVolume).toFixed(0) + ' MOTO', emoji: '💰', c: '#92B4F4', cd: '#92B4F4' },
                                        ].map((s, i) => (
                                            <div key={s.label} style={{
                                                position: 'relative' as const, padding: '20px 10px 16px',
                                                background: darkMode ? `linear-gradient(180deg, ${s.c}12, ${s.c}06)` : `linear-gradient(180deg, ${s.c}22, ${s.c}10)`,
                                                border: `1.5px solid ${s.c}${darkMode ? '20' : '40'}`,
                                                borderBottom: `3px solid ${s.c}${darkMode ? '25' : '50'}`,
                                                borderRadius: 0, textAlign: 'center' as const, overflow: 'hidden' as const,
                                                boxShadow: `
                                                    0 4px 12px ${s.c}18,
                                                    0 8px 24px rgba(0,0,0,0.03),
                                                    inset 0 1px 0 rgba(255,255,255,0.7),
                                                    inset 0 -2px 4px ${s.c}08
                                                `,
                                                transition: 'transform 0.2s, box-shadow 0.2s',
                                            }}>
                                                <div style={{position: 'absolute' as const, top: 0, left: 0, right: 0, height: 3, borderRadius: '12px 12px 0 0',
                                                    background: `linear-gradient(90deg, ${s.c}70, ${s.c}35, ${s.c}70)`,
                                                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4)`}} />
                                                <div style={{fontSize: '1.4rem', marginBottom: 6, filter: `drop-shadow(0 2px 4px ${s.c}30)`}}>{s.emoji}</div>
                                                <div style={{
                                                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.4rem',
                                                    color: s.cd, textShadow: `0 1px 0 rgba(255,255,255,0.6), 0 2px 8px ${s.c}25`,
                                                }}>{s.val}</div>
                                                <div style={{fontSize: '0.65rem', fontWeight: 700, color: '#B8AED4', letterSpacing: 1.5, marginTop: 4,
                                                    textShadow: '0 1px 0 rgba(255,255,255,0.5)'}}>{s.label}</div>
                                                <div style={{position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 2,
                                                    background: `linear-gradient(90deg, transparent, ${s.c}45, transparent)`}} />
                                            </div>
                                        ))}
                                    </div>

                                    {/* ── Sprint 6: MODE STAT CARDS ── */}
                                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {([
                                            { key: 'classic', label: 'CLASSIC', emoji: '🎯', color: '#82c4a0', data: state.profile.classic, mastery: state.profile.classicMastery,
                                              stats: (d: NonNullable<typeof state.profile.classic>) => [
                                                  { k: 'W/L', v: `${d.wins}/${d.losses}` }, { k: 'WIN%', v: d.winRate + '%' },
                                                  { k: 'TRADES', v: d.totalTrades }, { k: 'STREAK', v: d.bestStreak },
                                                  { k: 'ITEMS', v: d.totalItemsUsed },
                                              ]},
                                            { key: 'survival', label: 'SURVIVAL', emoji: '💀', color: '#e08a9f', data: state.profile.survival, mastery: state.profile.survivalMastery,
                                              stats: (d: NonNullable<typeof state.profile.survival>) => [
                                                  { k: 'W/L', v: `${d.wins}/${d.losses}` }, { k: 'WIN%', v: d.winRate + '%' },
                                                  { k: 'BEST TICK', v: d.bestSurvivalTick ?? 0 }, { k: 'STREAK', v: d.bestStreak },
                                                  { k: 'ITEMS', v: d.totalItemsUsed },
                                              ]},
                                            { key: 'chaos', label: 'CHAOS', emoji: '🌀', color: '#9B7FC7', data: state.profile.chaos, mastery: state.profile.chaosMastery,
                                              stats: (d: NonNullable<typeof state.profile.chaos>) => [
                                                  { k: 'W/L', v: `${d.wins}/${d.losses}` }, { k: 'WIN%', v: d.winRate + '%' },
                                                  { k: 'MUTATORS', v: d.mutatorsExperienced ?? 0 }, { k: 'STREAK', v: d.bestStreak },
                                                  { k: 'ITEMS', v: d.totalItemsUsed },
                                              ]},
                                        ] as const).map(mode => {
                                            const c = mode.color;
                                            const d = mode.data;
                                            const m = mode.mastery ?? { level: 0, max: 12 };
                                            const pct = m.max > 0 ? Math.round(m.level / m.max * 100) : 0;

                                            return (
                                                <div key={mode.key} style={{
                                                    position: 'relative', overflow: 'hidden',
                                                    background: darkMode ? `linear-gradient(135deg, ${c}10, ${c}06)` : `linear-gradient(135deg, ${c}18, ${c}08)`,
                                                    border: `1.5px solid ${c}${darkMode ? '25' : '40'}`,
                                                    borderLeft: `3px solid ${c}${darkMode ? '50' : '80'}`,
                                                    padding: '14px 16px',
                                                }}>
                                                    {/* Header */}
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ fontSize: '1.2rem' }}>{mode.emoji}</span>
                                                            <span style={{
                                                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.8rem',
                                                                color: c, letterSpacing: 2, textTransform: 'uppercase' as const,
                                                            }}>{mode.label}</span>
                                                            {d && <span style={{ fontSize: '0.65rem', color: '#8B7FB0', marginLeft: 4 }}>
                                                                {d.matchesPlayed} matches
                                                            </span>}
                                                        </div>
                                                        {/* Mastery badge */}
                                                        <div style={{
                                                            display: 'flex', alignItems: 'center', gap: 6,
                                                            padding: '2px 8px',
                                                            background: `${c}15`, border: `1px solid ${c}30`,
                                                            fontSize: '0.6rem', fontWeight: 700, color: c,
                                                            fontFamily: "'IBM Plex Mono', monospace",
                                                        }}>
                                                            ⭐ {m.level}/{m.max}
                                                        </div>
                                                    </div>

                                                    {d ? (
                                                        <>
                                                            {/* Stat row */}
                                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                                                                {mode.stats(d as any).map((s: { k: string; v: string | number }) => (
                                                                    <div key={s.k} style={{
                                                                        flex: '1 1 0', minWidth: 50, textAlign: 'center' as const,
                                                                        padding: '6px 4px',
                                                                        background: darkMode ? `${c}08` : `${c}12`,
                                                                        border: `1px solid ${c}15`,
                                                                    }}>
                                                                        <div style={{
                                                                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                                                                            fontSize: '0.95rem', color: c,
                                                                        }}>{s.v}</div>
                                                                        <div style={{
                                                                            fontSize: '0.5rem', fontWeight: 700, color: '#8B7FB0',
                                                                            letterSpacing: 1, marginTop: 2,
                                                                        }}>{s.k}</div>
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            {/* Mastery progress bar */}
                                                            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <div style={{
                                                                    flex: 1, height: 4, background: `${c}15`, overflow: 'hidden',
                                                                }}>
                                                                    <div style={{
                                                                        height: '100%', width: pct + '%',
                                                                        background: `linear-gradient(90deg, ${c}80, ${c})`,
                                                                        boxShadow: `0 0 6px ${c}40`,
                                                                        transition: 'width 0.5s ease',
                                                                    }} />
                                                                </div>
                                                                <span style={{
                                                                    fontSize: '0.55rem', color: '#8B7FB0', fontWeight: 600,
                                                                    fontFamily: "'IBM Plex Mono', monospace", minWidth: 28,
                                                                }}>{pct}%</span>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        /* Locked state */
                                                        <div style={{
                                                            textAlign: 'center' as const, padding: '12px 0', color: '#6B6190',
                                                            fontSize: '0.7rem', fontFamily: "'Chakra Petch', sans-serif",
                                                        }}>
                                                            Play your first {mode.label.toLowerCase()} match to unlock stats
                                                        </div>
                                                    )}

                                                    {/* Accent line bottom */}
                                                    <div style={{
                                                        position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 1,
                                                        background: `linear-gradient(90deg, transparent, ${c}30, transparent)`,
                                                    }} />
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* FE-3 FIX: Withdraw button — allows players to withdraw escrowed funds */}
                                    {!state.devMode && (
                                        <WithdrawButton wallet={wallet} settlementTx={state.settlementTx} />
                                    )}

                                    {/* P2: Match recovery — cancel/refund stuck matches */}
                                    {!state.devMode && (
                                        <MatchRecovery wallet={wallet} />
                                    )}
                                    </>
                                )}
                                {state.profileTab === 'missions' && (() => {
                                    // eslint-disable-next-line react-hooks/rules-of-hooks
                                    const [missionFilter, setMissionFilter] = useState<string>('global');

                                    const MISSION_TABS = [
                                        { id: 'global',    label: 'GLOBAL',    emoji: '🌐', c: '#92B4F4' },
                                        { id: 'classic',   label: 'CLASSIC',   emoji: '🎯', c: '#82c4a0' },
                                        { id: 'survival',  label: 'SURVIVAL',  emoji: '💀', c: '#e08a9f' },
                                        { id: 'chaos',     label: 'CHAOS',     emoji: '🌀', c: '#9B7FC7' },
                                        { id: 'social',    label: 'SOCIAL',    emoji: '🔗', c: '#F4B8CE' },
                                    ];

                                    const globalCategories = new Set(['play', 'win', 'streak', 'special', 'crossmode']);
                                    const allNonSocial = state.quests.filter(q => q.category !== 'social');
                                    const totalDone = allNonSocial.filter(q => q.completed).length;

                                    // Count per tab
                                    const countFor = (tabId: string) => {
                                        if (tabId === 'global') return allNonSocial.length;
                                        if (tabId === 'social') return state.quests.filter(q => q.category === 'social').length;
                                        return state.quests.filter(q => q.category === tabId).length;
                                    };
                                    const doneFor = (tabId: string) => {
                                        if (tabId === 'global') return totalDone;
                                        if (tabId === 'social') return state.quests.filter(q => q.category === 'social' && q.completed).length;
                                        return state.quests.filter(q => q.category === tabId && q.completed).length;
                                    };

                                    // ── Progress bar ──
                                    const ProgressBar = ({ label, color, done, total }: { label: string; color: string; done: number; total: number }) => {
                                        const pct = total > 0 ? Math.round(done / total * 100) : 0;
                                        return (
                                            <div style={{ padding: '10px 14px', marginBottom: 8, background: `${color}08`, border: `1px solid ${color}20` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                    <span style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem', color, letterSpacing: 1 }}>{label}</span>
                                                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: '0.65rem', color: '#8B7FB0' }}>{done}/{total} ({pct}%)</span>
                                                </div>
                                                <div style={{ height: 6, background: `${color}15`, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: pct + '%', background: `linear-gradient(90deg, ${color}80, ${color})`, boxShadow: `0 0 8px ${color}40`, transition: 'width 0.5s ease' }} />
                                                </div>
                                            </div>
                                        );
                                    };

                                    // ── Quest row (for lists) ──
                                    const QuestRow = ({ q, color }: { q: QuestStatus; color: string }) => (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '10px 12px', marginBottom: 3,
                                            background: q.completed ? '#82c4a008' : `${color}06`,
                                            border: `1px solid ${q.completed ? '#82c4a018' : color + '15'}`,
                                            borderLeft: `3px solid ${q.completed ? '#7BBF6A80' : color + '50'}`,
                                            opacity: q.completed ? 0.55 : 1,
                                        }}>
                                            <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{q.emoji}</span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.72rem', color: q.completed ? '#7BBF6A' : '#e0d8f0' }}>
                                                        {q.title} {q.completed ? '✅' : ''}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.58rem', color: '#8B7FB0', marginTop: 1 }}>{q.description}</div>
                                                {!q.completed && q.requirement > 1 && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                                        <div style={{ flex: 1, height: 4, background: `${color}15`, overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', width: Math.min(100, q.progress * 100) + '%', background: color, boxShadow: `0 0 4px ${color}30` }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.55rem', color: '#8B7FB0', fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>{q.current}/{q.requirement}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: '0.6rem', color: q.completed ? '#6B6190' : '#b89c5c', flexShrink: 0 }}>
                                                {q.completed ? '' : `+${q.points}`}
                                            </span>
                                        </div>
                                    );

                                    // ── Render content per tab ──
                                    const renderContent = () => {

                                        // ═══ GLOBAL — 4 dashboard cards, 3 quests each ═══
                                        if (missionFilter === 'global') {
                                            const panels = [
                                                { tab: 'classic',  label: 'CLASSIC',  emoji: '🎯', c: '#82c4a0', quests: state.quests.filter(q => q.category === 'classic') },
                                                { tab: 'survival', label: 'SURVIVAL', emoji: '💀', c: '#e08a9f', quests: state.quests.filter(q => q.category === 'survival') },
                                                { tab: 'chaos',    label: 'CHAOS',    emoji: '🌀', c: '#9B7FC7', quests: state.quests.filter(q => q.category === 'chaos') },
                                                { tab: 'social',   label: 'SOCIAL',   emoji: '🔗', c: '#F4B8CE', quests: state.quests.filter(q => q.category === 'social') },
                                            ];

                                            return (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                    {panels.map(p => {
                                                        const done = p.quests.filter(q => q.completed).length;
                                                        const total = p.quests.length;
                                                        // Top 3 quests: incomplete sorted by progress desc, then completed
                                                        const sorted = [...p.quests].sort((a, b) => {
                                                            if (a.completed !== b.completed) return a.completed ? 1 : -1;
                                                            if (!a.completed && !b.completed) {
                                                                if (b.progress !== a.progress) return b.progress - a.progress;
                                                                return a.requirement - b.requirement;
                                                            }
                                                            return a.sortOrder - b.sortOrder;
                                                        });
                                                        const top3 = sorted.slice(0, 3);

                                                        return (
                                                            <div key={p.tab}
                                                                onClick={() => setMissionFilter(p.tab)}
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    background: `${p.c}06`,
                                                                    border: `1.5px solid ${p.c}20`,
                                                                    transition: 'all 0.15s',
                                                                    overflow: 'hidden',
                                                                }}
                                                            >
                                                                {/* ── Card Title Bar ── */}
                                                                <div style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                    padding: '8px 12px',
                                                                    background: `${p.c}15`,
                                                                    borderBottom: `1px solid ${p.c}25`,
                                                                }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                        <span style={{ fontSize: '0.85rem' }}>{p.emoji}</span>
                                                                        <span style={{ fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.7rem', color: p.c, letterSpacing: 1.5 }}>{p.label}</span>
                                                                    </div>
                                                                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem', color: p.c, fontWeight: 700 }}>{done}/{total}</span>
                                                                </div>

                                                                {/* ── Quest Rows ── */}
                                                                <div style={{ padding: '6px 10px 10px' }}>
                                                                    {top3.map((q, qi) => {
                                                                        const isDone = q.completed;
                                                                        const pct = isDone ? 100 : Math.min(100, q.progress * 100);
                                                                        return (
                                                                            <div key={q.id} style={{ marginBottom: qi < top3.length - 1 ? 8 : 0 }}>
                                                                                {/* Quest title + status */}
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                                                                    <span style={{ fontSize: '0.75rem' }}>{q.emoji}</span>
                                                                                    <span style={{
                                                                                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.65rem',
                                                                                        color: isDone ? '#7BBF6A' : '#e0d8f0',
                                                                                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                                                                                    }}>
                                                                                        {q.title}
                                                                                    </span>
                                                                                    {isDone && <span style={{ fontSize: '0.6rem', color: '#7BBF6A', flexShrink: 0 }}>✅</span>}
                                                                                </div>
                                                                                {/* Description */}
                                                                                <div style={{ fontSize: '0.5rem', color: '#8B7FB0', marginBottom: 3, lineHeight: 1.2 }}>
                                                                                    {isDone ? q.description : q.requirement > 1 ? `${q.current} of ${q.requirement} — ${q.description}` : q.description}
                                                                                </div>
                                                                                {/* Progress bar + counter */}
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                                    <div style={{ flex: 1, height: 5, background: `${p.c}12`, overflow: 'hidden' }}>
                                                                                        <div style={{
                                                                                            height: '100%', width: pct + '%',
                                                                                            background: isDone ? '#7BBF6A' : p.c,
                                                                                            boxShadow: isDone ? '0 0 4px #7BBF6A40' : `0 0 4px ${p.c}30`,
                                                                                            transition: 'width 0.4s ease',
                                                                                        }} />
                                                                                    </div>
                                                                                    <span style={{
                                                                                        fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.5rem', fontWeight: 700,
                                                                                        color: isDone ? '#7BBF6A' : '#8B7FB0', flexShrink: 0, minWidth: 28, textAlign: 'right' as const,
                                                                                    }}>
                                                                                        {isDone ? '✓' : q.requirement > 1 ? `${q.current}/${q.requirement}` : '—'}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {/* "See all" hint */}
                                                                    {total > 3 && (
                                                                        <div style={{ textAlign: 'center' as const, fontSize: '0.5rem', color: `${p.c}80`, marginTop: 6, fontFamily: "'Chakra Petch', sans-serif" }}>
                                                                            +{total - 3} more →
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        }

                                        // ═══ MODE TABS — Classic / Survival / Chaos ═══
                                        if (missionFilter === 'classic' || missionFilter === 'survival' || missionFilter === 'chaos') {
                                            const cat = missionFilter;
                                            const color = cat === 'classic' ? '#82c4a0' : cat === 'survival' ? '#e08a9f' : '#9B7FC7';
                                            const modeQ = state.quests.filter(q => q.category === cat);
                                            const modeDone = modeQ.filter(q => q.completed).length;
                                            const label = cat.toUpperCase();

                                            // Split: play milestones, win milestones, streak, skill trophies
                                            const playMilestones = modeQ.filter(q => q.description.toLowerCase().includes('play') && q.requirement > 1).sort((a, b) => a.requirement - b.requirement);
                                            const winMilestones = modeQ.filter(q => q.description.toLowerCase().includes('win') && q.requirement > 1 && !q.description.toLowerCase().includes('play')).sort((a, b) => a.requirement - b.requirement);
                                            const streakQ = modeQ.filter(q => q.description.toLowerCase().includes('streak') || q.description.toLowerCase().includes('in a row')).sort((a, b) => a.requirement - b.requirement);
                                            const milestoneIds = new Set([...playMilestones, ...winMilestones, ...streakQ].map(q => q.id));
                                            const skillTrophies = modeQ.filter(q => !milestoneIds.has(q.id)).sort((a, b) => a.sortOrder - b.sortOrder);

                                            const incomplete = modeQ.filter(q => !q.completed);
                                            const completed = modeQ.filter(q => q.completed);

                                            return (<>
                                                <ProgressBar label={`${label} PROGRESS`} color={color} done={modeDone} total={modeQ.length} />

                                                {/* Play milestones */}
                                                {playMilestones.filter(q => !q.completed).length > 0 && (<>
                                                    <MechaSectionLabel text={`${label} — PLAY`} c={color} cd={color} />
                                                    {playMilestones.filter(q => !q.completed).map(q => <QuestRow key={q.id} q={q} color={color} />)}
                                                </>)}

                                                {/* Win milestones */}
                                                {winMilestones.filter(q => !q.completed).length > 0 && (<>
                                                    <MechaSectionLabel text={`${label} — WIN`} c={color} cd={color} />
                                                    {winMilestones.filter(q => !q.completed).map(q => <QuestRow key={q.id} q={q} color={color} />)}
                                                </>)}

                                                {/* Streak */}
                                                {streakQ.filter(q => !q.completed).length > 0 && (<>
                                                    <MechaSectionLabel text={`${label} — STREAK`} c={color} cd={color} />
                                                    {streakQ.filter(q => !q.completed).map(q => <QuestRow key={q.id} q={q} color={color} />)}
                                                </>)}

                                                {/* Skill trophies */}
                                                {skillTrophies.filter(q => !q.completed).length > 0 && (<>
                                                    <MechaSectionLabel text={`${label} — SKILL TROPHIES`} c={color} cd={color} />
                                                    {skillTrophies.filter(q => !q.completed).map(q => <QuestRow key={q.id} q={q} color={color} />)}
                                                </>)}

                                                {/* All complete message */}
                                                {incomplete.length === 0 && (
                                                    <div style={{ textAlign: 'center' as const, padding: 20, background: '#82c4a010', border: '1px solid #82c4a025', fontSize: '0.8rem', color: '#7BBF6A', fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif" }}>
                                                        👑 ALL {label} QUESTS COMPLETE
                                                    </div>
                                                )}

                                                {/* Completed */}
                                                {completed.length > 0 && (<>
                                                    <div style={{ height: 6 }} />
                                                    <MechaSectionLabel text={`✅ COMPLETED (${completed.length})`} c="#82c4a0" cd="#7BBF6A" />
                                                    {completed.sort((a, b) => a.sortOrder - b.sortOrder).map(q => <QuestRow key={q.id} q={q} color="#82c4a0" />)}
                                                </>)}
                                            </>);
                                        }

                                        // ═══ SOCIAL ═══
                                        if (missionFilter === 'social') {
                                            const socialQ = state.quests.filter(q => q.category === 'social');
                                            const socialDone = socialQ.filter(q => q.completed).length;
                                            return (<>
                                                <ProgressBar label="SOCIAL MISSIONS" color="#F4B8CE" done={socialDone} total={socialQ.length} />
                                                {socialQ.sort((a, b) => (a.completed === b.completed ? a.sortOrder - b.sortOrder : a.completed ? 1 : -1)).map(q =>
                                                    <MechaQuestRow key={q.id} quest={q} onClaim={claimQuest} social dark={darkMode} />
                                                )}
                                            </>);
                                        }

                                        return null;
                                    };

                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {/* ── Tab bar ── */}
                                            <div style={{ display: 'flex', gap: 0, overflowX: 'auto' as const, paddingBottom: 2, borderBottom: '1px solid #92B4F415' }}>
                                                {MISSION_TABS.map(tab => {
                                                    const active = missionFilter === tab.id;
                                                    const tc = countFor(tab.id);
                                                    const td = doneFor(tab.id);
                                                    return (
                                                        <button key={tab.id}
                                                            onClick={() => setMissionFilter(tab.id)}
                                                            style={{
                                                                flex: '1 1 0', minWidth: 0, padding: '8px 4px',
                                                                background: active ? `${tab.c}18` : 'transparent',
                                                                border: 'none', borderBottom: active ? `2px solid ${tab.c}` : '2px solid transparent',
                                                                color: active ? tab.c : '#6B6190',
                                                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.55rem',
                                                                letterSpacing: 0.5, cursor: 'pointer', transition: 'all 0.2s',
                                                                whiteSpace: 'nowrap' as const,
                                                            }}
                                                        >
                                                            {tab.emoji} {tab.label}
                                                            <span style={{ display: 'block', fontSize: '0.5rem', fontWeight: 400, color: active ? tab.c + 'aa' : '#5A5480', marginTop: 1 }}>
                                                                {td}/{tc}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* ── Content ── */}
                                            {renderContent()}
                                        </div>
                                    );
                                })()}

                                {/* ━━━ REFERRING ━━━ */}
                                {state.profileTab === 'referring' && (
                                    <MechaReferralTab data={state.referralData} applyMsg={state.referralApplyMsg} onApply={applyReferral} dark={darkMode} />
                                )}

                                {/* ━━━ BATTLE LOG ━━━ */}
                                {state.profileTab === 'battlelog' && (
                                    <MechaBattleLog entries={state.battleLog} dark={darkMode} />
                                )}
                            </MechaPanel>
                        </div>
                    </div>
                </div>
    );
}
