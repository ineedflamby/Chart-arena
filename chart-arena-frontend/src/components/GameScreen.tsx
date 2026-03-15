import React from 'react';
import { useGame, type TradeAction, ITEM_NAMES, type ChatChannel } from '../hooks/useGame';
import { CandleChart, type ChartItem } from './CandleChart';
import { truncAddr, formatValue } from '../utils/constants';
import { ChatPanel } from './ChatPanel';
import { LeaderboardBanner } from './LeaderboardBanner';
import { sound } from '../services/sound';

/* ── Game sidebar panel ── */
function GameBox({ label, accent, accent2, children, flex = false }: {
    label: string; accent: string; accent2?: string; children: React.ReactNode; flex?: boolean;
}) {
    const c2 = accent2 || accent;
    return (
        <div style={{
            background: 'linear-gradient(168deg, rgba(22,18,38,0.92), rgba(12,10,22,0.85))',
            border: `1px solid ${accent}15`,
            display: 'flex', flexDirection: 'column',
            ...(flex ? { flex: 1, minHeight: 0 } : {}),
            overflow: 'hidden',
        }}>
            <div style={{
                height: 2, flexShrink: 0,
                background: `linear-gradient(90deg, transparent, ${accent}60, ${c2}40, transparent)`,
                boxShadow: `0 1px 6px ${accent}20`,
            }} />
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 3px', flexShrink: 0,
            }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }} />
                <span style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.6rem',
                    letterSpacing: 2, color: accent, textShadow: `0 0 8px ${accent}40`,
                }}>{label}</span>
            </div>
            <div style={{ padding: '4px 10px 10px', ...(flex ? { flex: 1, overflow: 'auto', minHeight: 0 } : {}) }}>
                {children}
            </div>
        </div>
    );
}

export function GameScreen({ state, onTrade, onUseItem, onSelectTarget, onCancelTargeting, onDismissToast, onSendChat, onSetChatTab, onSetWhisperTarget, isPreview }: {
    state: ReturnType<typeof useGame>['state'];
    onTrade: (action: TradeAction) => void;
    onUseItem: (itemId: number) => void;
    onSelectTarget: (address: string) => void;
    onCancelTargeting: () => void;
    onDismissToast?: (id: number) => void;
    onSendChat: (channel: ChatChannel, text: string, target?: string) => void;
    onSetChatTab: (tab: ChatChannel) => void;
    onSetWhisperTarget: (target: string | null) => void;
    isPreview: boolean;
}) {
    const lastPrice = state.priceTicks.length > 0
        ? state.priceTicks[state.priceTicks.length - 1].price : 100;
    const pnl = state.equity - state.startingCapital;
    const pnlPct = (pnl / state.startingCapital) * 100;
    const pnlColor = pnl > 0.001 ? '#82c4a0' : pnl < -0.001 ? '#F4B8CE' : '#8b7fb0';

    // MOTO-based portfolio display
    const buyInMoto = Number(BigInt(state.matchBuyIn || '0')) / 1e18;
    const motoEquity = buyInMoto > 0 ? buyInMoto * (state.equity / state.startingCapital) : 0;
    const motoPnl = buyInMoto > 0 ? buyInMoto * (pnl / state.startingCapital) : 0;
    const motoUsdValue = state.motoUsdPrice > 0 ? motoEquity * state.motoUsdPrice : 0;
    // P2: Price stale if >5 minutes since last update (or never received)
    const priceStale = state.motoUsdPriceTs > 0 && (Date.now() - state.motoUsdPriceTs) > 300_000;

    const ticksLeft = state.totalTicks - state.currentTick;
    const minutes = Math.floor(ticksLeft / 60);
    const seconds = ticksLeft % 60;

    const phaseColors: Record<string, string> = {
        OPEN: '#92B4F4', MID: '#82c4a0', CRUNCH: '#d4b978', OVERTIME: '#F4B8CE', PREVIEW: '#92B4F4',
    };
    const phaseColor = phaseColors[state.currentPhase] ?? '#8b7fb0';

    return (
        <div className="game" style={{
            backgroundImage: 'radial-gradient(ellipse at 10% 0%, rgba(146,180,244,0.04) 0%, transparent 50%), radial-gradient(ellipse at 90% 100%, rgba(244,184,206,0.03) 0%, transparent 50%)',
        }}>
            {/* Scanlines */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.015,
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.08) 2px, rgba(146,180,244,0.08) 4px)',
            }} />

            {/* ── HEADER BAR ── */}
            <div style={{
                gridColumn: '1 / -1', gridRow: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 16px',
                background: 'linear-gradient(180deg, rgba(16,13,28,0.95), rgba(10,9,20,0.85))',
                borderBottom: `1px solid ${phaseColor}15`,
                boxShadow: `0 1px 8px rgba(0,0,0,0.3), inset 0 -1px 0 ${phaseColor}08`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.68rem',
                        padding: '3px 12px', letterSpacing: '0.08em',
                        clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                        background: phaseColor + '12', color: phaseColor,
                        border: '1px solid ' + phaseColor + '25',
                        textTransform: 'uppercase',
                    }}>
                        {isPreview ? '📊 PREVIEW' : state.currentPhase}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#665C87', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600 }}>
                        TICK {state.currentTick}/{state.totalTicks}
                    <span style={{
                        fontSize: "0.65rem", fontFamily: "Chakra Petch, sans-serif", fontWeight: 700,
                        padding: "2px 8px",
                        clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                        background: state.tradeCount >= 6 ? "rgba(244,184,206,0.08)" : "rgba(146,180,244,0.06)",
                        border: "1px solid " + (state.tradeCount >= 6 ? "rgba(244,184,206,0.15)" : "rgba(146,180,244,0.08)"),
                        color: state.tradeCount >= 6 ? "#F4B8CE" : "#92B4F4",
                    }}>
                        {state.tradeCount} TRADES
                    </span>
                    </span>
                </div>
                <div style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.25rem',
                    padding: '2px 16px',
                    clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                    background: 'rgba(146,180,244,0.05)', border: '1px solid rgba(146,180,244,0.08)',
                    color: ticksLeft <= 30 ? '#F4B8CE' : '#e0d8f0',
                    boxShadow: ticksLeft <= 30 ? '0 0 12px rgba(244,184,206,0.15)' : 'none',
                    ...(ticksLeft <= 30 ? { animation: 'pulse-glow 1s infinite' } : {}),
                }}>
                    {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                </div>
                <div style={{
                    fontSize: '0.85rem', color: '#92B4F4', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                    textShadow: '0 0 12px rgba(146,180,244,0.2)',
                }}>
                    ${lastPrice.toFixed(2)}
                </div>
            </div>

            {/* ── LEADERBOARD BANNER ── */}
            <LeaderboardBanner
                standings={state.standings} address={state.address}
                startingCapital={state.startingCapital} foggedPlayers={state.foggedPlayers}
                scrambleActive={state.scrambleActive} thickSkinActive={state.thickSkinActive}
                xrayInventories={state.xrayInventories} targetingItemId={state.targetingItemId}
                onSelectTarget={onSelectTarget} onCancelTargeting={onCancelTargeting}
                eliminatedPlayers={state.eliminatedPlayers} playerNames={state.playerNames}
            />

            {/* ── CHART ── */}
            <div className="game__chart-wrap"><CandleChart
                ticks={state.priceTicks} entryPrice={state.entryPrice}
                positionStatus={state.positionStatus}
                equity={state.equity} startingCapital={state.startingCapital}
                currentPhase={state.currentPhase}
                mirrorCursed={state.mirrorCursed}
                shockwaveActive={state.shockwaveActive} blackoutActive={state.blackoutActive}
                timeWarpActive={state.timeWarpActive} frozen={state.frozen}
                thickSkinActive={state.thickSkinActive} activeItemVFX={state.activeItemVFX}
                items={state.inventory.map((id) => {
                    const item = ITEM_NAMES[id];
                    return item ? { id, emoji: item.emoji, name: item.name, desc: item.desc } : { id, emoji: '?', name: 'Unknown' };
                })}
                canUseItems={state.currentPhase !== 'OPEN' && !isPreview}
                onUseItem={onUseItem}
            /></div>

            {/* ── SIDEBAR ── */}
            <div className="game__sidebar" style={{
                display: 'flex', flexDirection: 'column', gap: 5, padding: 6,
                background: 'linear-gradient(180deg, rgba(16,13,28,0.92), rgba(10,9,20,0.88))',
                borderLeft: '1px solid rgba(146,180,244,0.06)',
                overflowY: 'auto', overflowX: 'hidden',
            }}>
                {/* Portfolio */}
                <GameBox label="PORTFOLIO" accent="#92B4F4" accent2="#82c4a0">
                    {buyInMoto > 0 && (
                        <div style={{ fontSize: '0.68rem', color: '#d4b978', fontWeight: 700, marginBottom: 4, fontFamily: "'Chakra Petch', sans-serif" }}>
                            🎯 {buyInMoto} MOTO Wager
                        </div>
                    )}
                    <div style={{
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.4rem',
                        color: pnlColor, marginBottom: 0,
                    }}>
                        {state.muted ? '🔇 ?.?? MOTO' : (buyInMoto > 0 ? motoEquity.toFixed(2) + ' MOTO' : '$' + state.equity.toFixed(2))}
                    </div>
                    {!state.muted && motoUsdValue > 0 && (
                        <div style={{ fontSize: '0.65rem', color: priceStale ? '#e08a9f' : '#665C87', fontWeight: 600, fontFamily: "'Chakra Petch', sans-serif", marginBottom: 2 }}>
                            ≈ ${motoUsdValue.toFixed(2)}{priceStale ? ' (stale)' : ''}
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#8b7fb0', padding: '2px 0' }}>
                        <span>PnL</span>
                        {state.muted ? (
                            <span style={{ color: '#554d73', fontWeight: 700 }}>🔇 ???</span>
                        ) : (
                            <span style={{ color: pnlColor, fontWeight: 700 }}>
                                {buyInMoto > 0
                                    ? `${motoPnl >= 0 ? '+' : ''}${motoPnl.toFixed(2)} MOTO (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`
                                    : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`
                                }
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#8b7fb0', padding: '2px 0' }}>
                        <span>Position</span>
                        <span style={{
                            color: state.positionStatus === 'LONG' ? '#82c4a0' : state.positionStatus === 'SHORT' ? '#F4B8CE' : '#554d73',
                            fontWeight: 700,
                        }}>
                            {state.positionStatus === 'FLAT' ? '⚪ Flat' : state.positionStatus === 'LONG' ? '🟢 Long' : '🔴 Short'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#8b7fb0', padding: '2px 0' }}>
                        <span>Trades</span>
                        <span style={{ fontWeight: 700, color: '#92B4F4' }}>{state.tradeCount}</span>
                    </div>
                </GameBox>

                {/* Trade */}
                <GameBox label="TRADE" accent="#92B4F4" accent2="#F4B8CE">
                    {state.frozen && (
                        <div style={{
                            textAlign: 'center', padding: 6, marginBottom: 4,
                            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                            background: 'rgba(146,180,244,0.05)', border: '1px solid rgba(146,180,244,0.12)',
                            fontSize: '0.72rem', fontWeight: 700, color: '#92B4F4',
                            animation: 'shockwave-pulse 0.5s ease infinite alternate',
                        }}>🧊 FROZEN</div>
                    )}
                    {isPreview ? (
                        <div style={{ textAlign: 'center', padding: '8px 0', color: '#554d73', fontFamily: "'Chakra Petch', sans-serif", fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Trading starts soon! 🎬
                        </div>
                    ) : state.positionStatus === 'FLAT' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                            <button onClick={() => { sound.playLongOpen(); onTrade('OPEN_LONG'); }} style={{
                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.82rem',
                                padding: '9px 6px', border: 'none', color: 'white', cursor: 'pointer',
                                clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                                background: 'linear-gradient(135deg, #3ba55d, #82c4a0)',
                                boxShadow: '0 3px 12px rgba(130,196,160,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
                                transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>🟢 Long</button>
                            <button onClick={() => { sound.playShortOpen(); onTrade('OPEN_SHORT'); }} style={{
                                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.82rem',
                                padding: '9px 6px', border: 'none', color: 'white', cursor: 'pointer',
                                clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                                background: 'linear-gradient(135deg, #c4587a, #e08a9f)',
                                boxShadow: '0 3px 12px rgba(224,138,159,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
                                transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>🔴 Short</button>
                        </div>
                    ) : (
                        <button onClick={() => { sound.playClosePosition(); onTrade('CLOSE'); }} style={{
                            fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.82rem',
                            padding: '9px 6px', border: 'none', color: 'white', cursor: 'pointer',
                            width: '100%',
                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                            background: 'linear-gradient(135deg, rgba(146,180,244,0.5), rgba(146,180,244,0.4))',
                            boxShadow: '0 3px 12px rgba(146,180,244,0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
                            transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.06em',
                        }}>✖ Close Position</button>
                    )}
                    {state.lastTrade && (
                        <div style={{ marginTop: 4, fontSize: '0.68rem', color: '#82c4a0', fontWeight: 600 }}>
                            ✓ {state.lastTrade.action} @ ${state.lastTrade.price.toFixed(2)}
                        </div>
                    )}
                    {state.lastReject && (
                        <div style={{ marginTop: 4, fontSize: '0.68rem', color: '#F4B8CE', fontWeight: 600 }}>
                            ✗ {state.lastReject}
                        </div>
                    )}
                    {state.positionStatus === "FLAT" && !isPreview && state.currentTick >= 90 && state.currentTick < 150 && (
                        <div style={{
                            marginTop: 4, padding: "4px 8px", fontSize: "0.68rem", fontWeight: 700,
                            color: state.currentTick >= 105 ? "#F4B8CE" : "#d4b978",
                            background: state.currentTick >= 105 ? "rgba(244,184,206,0.06)" : "rgba(212,185,120,0.06)",
                            border: "1px solid " + (state.currentTick >= 105 ? "rgba(244,184,206,0.15)" : "rgba(212,185,120,0.15)"),
                            clipPath: "polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)",
                            textAlign: "center",
                            animation: state.currentTick >= 105 ? "pulse-glow 1s infinite" : "none",
                        }}>
                            {state.currentTick >= 105 ? "FLAT PENALTY ACTIVE - Open a position!" : "Flat penalty in " + (105 - state.currentTick) + " ticks - trade soon!"}
                        </div>
                    )}
                </GameBox>

                {/* Items */}
                <GameBox label="ITEMS" accent="#d4b978" accent2="#d4b978">
                    {state.inventory.length === 0 ? (
                        <div style={{ fontSize: '0.68rem', color: '#554d73', textAlign: 'center' }}>
                            {state.currentPhase === 'OPEN' ? 'First drop at 0:15 ⏳' : 'No items yet 🎲'}
                        </div>
                    ) : (
                        state.inventory.map((itemId, i) => {
                            const item = ITEM_NAMES[itemId];
                            if (!item) return null;
                            const tierColors: Record<number, string> = { 1: '#92B4F4', 2: '#92B4F4', 3: '#F4B8CE' };
                            const tc = tierColors[item.tier] ?? '#8b7fb0';
                            return (
                                <div key={itemId + '-' + i} style={{
                                    display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px',
                                    clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
                                    background: tc + '06', border: '1px solid ' + tc + '15', marginBottom: 3,
                                }}>
                                    <span style={{ fontSize: '1.1rem' }}>{item.emoji}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: tc, fontFamily: "'Chakra Petch', sans-serif" }}>{item.name}</div>
                                        <div style={{ fontSize: '0.65rem', color: '#665C87' }}>{item.desc}</div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    {/* Toasts */}
                    {state.toasts.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {state.toasts.map((toast) => (
                                <div key={toast.id} style={{
                                    fontSize: '0.7rem', fontWeight: 600, color: '#92B4F4',
                                    padding: '3px 7px',
                                    clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                                    background: 'rgba(146,180,244,0.04)', border: '1px solid rgba(146,180,244,0.08)',
                                    animation: 'toast-in 0.3s ease-out', cursor: 'pointer',
                                }} onClick={() => onDismissToast?.(toast.id)}>
                                    {toast.text}
                                </div>
                            ))}
                        </div>
                    )}
                    {state.currentPhase === 'OPEN' && state.inventory.length > 0 && (
                        <div style={{ marginTop: 3, fontSize: '0.65rem', color: '#554d73', textAlign: 'center', fontStyle: 'italic' }}>
                            🔒 Hold — items usable from MID phase
                        </div>
                    )}
                    {state.currentPhase !== 'OPEN' && !isPreview && state.inventory.length > 0 && (
                        <div style={{ marginTop: 3, fontSize: '0.65rem', color: '#d4b978', textAlign: 'center', fontWeight: 600 }}>
                            👆 Click item buttons on chart to use
                        </div>
                    )}
                </GameBox>

                {/* Chat */}
                <ChatPanel
                    chatMessages={state.chatMessages} activeTab={state.chatActiveTab}
                    unread={state.chatUnread} inGame={true} address={state.address}
                    whisperTarget={state.chatWhisperTarget} onSendChat={onSendChat}
                    onSetTab={onSetChatTab} onSetWhisperTarget={onSetWhisperTarget}
                    players={state.players}
                />
            </div>

            {/* ── FOOTER ── */}
            <div className="game__footer" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 16px', fontSize: '0.65rem', color: '#665C87',
                background: 'linear-gradient(180deg, rgba(16,13,28,0.85), rgba(10,9,20,0.9))',
                borderTop: '1px solid rgba(146,180,244,0.04)',
                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600,
            }}>
                <span>🎮 Match: {state.matchId ? truncAddr(state.matchId) : '...'}</span>
                <span style={{ color: phaseColor, textShadow: '0 0 6px ' + phaseColor + '30' }}>{state.currentPhase}</span>
                <span>🎁 Items: {state.inventory.length}/2</span>
            </div>
        </div>
    );
}
/* ── Leaderboard Banner ── */
