import { useState, useEffect, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { MessageSigner } from '@btc-vision/transaction';
import { useGame, type ChatChannel } from './hooks/useGame';
import { gameWS } from './services/ws';
import { sound } from './services/sound';
import { Header } from './components/Header';
import { Onboarding } from './components/Onboarding';
import { MechaLobby } from './components/MechaLobby';
import { Queue } from './components/Queue';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';
import { ChatPanel } from './components/ChatPanel';
import { ProfilePage } from './components/ProfilePage';
import { Footer } from './components/Footer';
import { truncAddr } from './utils/constants';
import { clearContractCache, setWalletContext } from './services/contract';
import { BlockProgress } from './components/BlockProgress';

const DEFAULT_BUY_IN = '5000000000000000000';

/** Convert Uint8Array to hex string */
function u8aToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function App() {
    const wallet = useWalletConnect();
    const { state, authenticate, resumeSession, joinQueue, leaveQueue, trade, useItem, selectTarget, cancelTargeting, dismissToast, requestProfile, closeProfile, setProfileTab, claimQuest, applyReferral, requestLeaderboard, clearOnchainAction, setOnchainError, backToLobby, playAgain, sendChatMessage, setChatTab, setChatWhisperTarget, setUsername, startTwitterAuth } = useGame();
    const [countdown, setCountdown] = useState<number | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const authAttemptedNonce = useRef<string | null>(null);
    const tokenAuthAttempted = useRef(false);
    // FE-11 FIX: Dark mode only — removed non-functional toggle
    const darkMode = true;

    // ── v5: No player on-chain actions during matchmaking ──
    // Backend creates matches via operator wallet. Players only need to:
    // 1. Deposit MOTO to escrow (one-time, from profile page)
    // 2. Queue for a match (backend handles the rest)
    // The old on-chain match flow (approve → createMatch → joinMatch) is gone.

    // Inject wallet context for console recovery helpers (window.__ca)
    useEffect(() => {
        const provider = (wallet as any).provider;
        const network = (wallet as any).network;
        if (wallet.walletAddress && provider && network) {
            setWalletContext(provider, network, wallet.walletAddress);
            console.log('[Debug] Wallet context injected for __ca helpers');
        }
    }, [wallet.walletAddress, state.connected, state.authenticated]);

    // Reset token auth tracking on disconnect
    useEffect(() => {
        if (!state.connected) { tokenAuthAttempted.current = false; authAttemptedNonce.current = null; }
    }, [state.connected]);

    useEffect(() => {
        if (!state.connected || state.authenticated || !state.nonce) return;

        // 1. Try token-based resume first (no wallet signing needed)
        if (!tokenAuthAttempted.current) {
            tokenAuthAttempted.current = true;
            try {
                const token = localStorage.getItem('ca-session-token');
                if (token) {
                    console.log('[Auth] Attempting token-based session resume...');
                    const unsub = gameWS.on('error', (msg) => {
                        const message = msg['message'] as string;
                        if (message === 'Token expired' || message === 'Missing token') {
                            try { localStorage.removeItem('ca-session-token'); } catch {}
                            unsub();
                            if (wallet.walletAddress && state.nonce && authAttemptedNonce.current !== state.nonce) {
                                authAttemptedNonce.current = state.nonce;
                                doWalletSign();
                            }
                        }
                    });
                    gameWS.send('token_auth', { token });
                    return;
                }
            } catch {}
        }

        // 2. Fall back to wallet signing
        if (!wallet.walletAddress || authAttemptedNonce.current === state.nonce) return;
        authAttemptedNonce.current = state.nonce;
        doWalletSign();

        async function doWalletSign() {
            try {
                // ── Extract x-only public key for auth verification ──
                // Try multiple sources: React state → walletInstance → window.opnet
                // wallet.publicKey may be null if React state hasn't updated yet
                let pubkey: string | undefined;
                try {
                    // Source 1: React walletconnect state
                    pubkey = wallet.publicKey ?? undefined;
                    // Source 2: walletInstance direct property
                    if (!pubkey) {
                        const inst = (wallet as any).walletInstance;
                        if (inst && typeof inst.getPublicKey === 'function') {
                            pubkey = await inst.getPublicKey();
                        }
                    }
                    // Source 3: window.opnet directly
                    if (!pubkey && typeof window !== 'undefined' && (window as any).opnet) {
                        const opnet = (window as any).opnet;
                        if (typeof opnet.getPublicKey === 'function') {
                            pubkey = await opnet.getPublicKey();
                        }
                    }
                    if (typeof pubkey === 'string') {
                        if (pubkey.startsWith('0x')) pubkey = pubkey.slice(2);
                        // If 33-byte compressed pubkey (02/03 prefix), strip to 32-byte x-only
                        if (pubkey.length === 66 && (pubkey.startsWith('02') || pubkey.startsWith('03'))) {
                            pubkey = pubkey.slice(2);
                        }
                    } else { pubkey = undefined; }
                } catch { pubkey = undefined; }

                if (!pubkey) {
                    console.error('[Auth] Could not retrieve public key from wallet');
                    return;
                }
                console.log('[Auth] Got pubkey:', pubkey.slice(0, 16) + '...');

                const AUTH_DOMAIN = 'ChartArena:auth:';
                const message = AUTH_DOMAIN + state.nonce;

                console.log('[Auth] Requesting wallet Schnorr signature via MessageSigner...');
                const signed = await MessageSigner.signMessageAuto(message);
                // signed.signature = 64-byte Uint8Array (BIP-340 Schnorr)
                // signed.message   = 32-byte Uint8Array (SHA-256 of message)

                const signatureHex = u8aToHex(signed.signature);
                if (!signatureHex || signatureHex.length !== 128) {
                    console.error('[Auth] Invalid signature length:', signatureHex?.length);
                    return;
                }

                console.log('[Auth] Schnorr signature obtained, authenticating...');
                authenticate(wallet.walletAddress!, signatureHex, state.nonce!, pubkey);
            } catch (err) {
                console.error('[Auth] Wallet signing failed:', err);
            }
        }
    }, [wallet.walletAddress, state.connected, state.authenticated, state.nonce, authenticate, resumeSession]);

    // Countdown: when preview starts, show 5-4-3-2-1-GO then transition
    useEffect(() => {
        if (state.screen === 'preview' && countdown === null) {
            setCountdown(5);
        }
    }, [state.screen, countdown]);

    useEffect(() => {
        if (countdown === null || countdown < 0) return;
        if (countdown === 0) {
            // Show "GO!" briefly then clear
            sound.playGo();
            const t = setTimeout(() => setCountdown(null), 800);
            return () => clearTimeout(t);
        }
        sound.playCountdownTick();
        const t = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown]);

    // Reset countdown on new match
    useEffect(() => {
        if (state.screen === 'lobby') setCountdown(null);
    }, [state.screen]);

    // Network switch detection — clear contract cache + warn user
    const lastNetworkRef = useRef<string | null>(null);
    useEffect(() => {
        const network = (wallet as any).network?.toString?.() ?? null;
        if (lastNetworkRef.current && network && lastNetworkRef.current !== network) {
            clearContractCache();
            console.warn('[App] Network switched from', lastNetworkRef.current, 'to', network);
        }
        lastNetworkRef.current = network;
    }, [(wallet as any).network]);

    // Parse ?ref= from URL and auto-apply referral after auth
    const [pendingRef] = useState<string | null>(() => {
        try {
            const url = new URL(window.location.href);
            const ref = url.searchParams.get('ref');
            if (ref) {
                // Clean the URL without reload
                url.searchParams.delete('ref');
                window.history.replaceState({}, '', url.pathname + url.search);
            }
            return ref;
        } catch { return null; }
    });

    useEffect(() => {
        if (pendingRef && state.authenticated && state.address) {
            applyReferral(pendingRef);
        }
    }, [pendingRef, state.authenticated, state.address, applyReferral]);

    const isPlaying = state.screen === 'playing' || state.screen === 'preview';


    return (
        <div className="app">
            {/* Universal header */}
            {state.screen !== 'onboarding' && (
                <Header wallet={wallet} connected={state.connected}
                    onProfile={requestProfile}
                    tierEmoji={state.profile?.tierEmoji ?? '❔'}
                    tierColor={state.profile?.tierColor ?? '#666'}
                    username={state.username}
                    onlineCount={state.onlineCount} />
            )}
            {state.screen !== 'onboarding' && <div style={{ height: 44 }} />}

            {/* P2: Reconnecting banner when WS drops */}
            {!state.connected && state.screen !== 'onboarding' && (
                <div style={{
                    position: 'fixed', top: 44, left: 0, right: 0, zIndex: 9998,
                    padding: '8px 16px', textAlign: 'center',
                    background: 'rgba(224,138,159,0.12)', borderBottom: '1px solid rgba(224,138,159,0.25)',
                    backdropFilter: 'blur(8px)',
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                    color: '#e08a9f', letterSpacing: '0.04em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#e08a9f', animation: 'pulse 1.5s infinite',
                    }} />
                    Connection lost — reconnecting...
                </div>
            )}

            {/* Countdown overlay */}
            {countdown !== null && countdown >= 0 && (
                <div className="countdown-overlay">
                    {countdown > 0 ? (
                        <div key={countdown} className="countdown-number">{countdown}</div>
                    ) : (
                        <div className="countdown-go">GO! 🚀</div>
                    )}
                    <div className="countdown-label">
                        {countdown > 0 ? 'Get ready to trade...' : ''}
                    </div>
                </div>
            )}

            {/* Profile overlay */}
            {state.profileOpen && (
                <ProfilePage
                    state={state} wallet={wallet} darkMode={true}
                    closeProfile={closeProfile} setProfileTab={setProfileTab}
                    claimQuest={claimQuest} applyReferral={applyReferral}
                />
            )}

            {state.screen === 'onboarding' && (
                <Onboarding
                    address={state.address}
                    error={state.usernameError}
                    onSetUsername={setUsername}
                    onConnectX={startTwitterAuth}
                />
            )}

            {state.screen === 'lobby' && (
                <MechaLobby
                    authenticated={state.authenticated}
                    connected={state.connected}
                    walletConnected={!!wallet.walletAddress}
                    onPlay={(mode, format, tier) => joinQueue(tier ?? 0, mode, format)}
                    onConnect={wallet.openConnectModal}
                    onProfile={requestProfile}
                    onRefreshLeaderboard={requestLeaderboard}
                    jackpotAmount={state.jackpotAmount}
                    onlineCount={state.onlineCount}
                    winnerTicker={state.winnerTicker}
                    leaderboard={state.leaderboard}
                    referralData={state.referralData}
                    referralApplyMsg={state.referralApplyMsg}
                    onApplyReferral={applyReferral}
                    chatMessages={state.chatMessages}
                    onSendChat={sendChatMessage}
                    username={state.username}
                    address={state.address}
                    walletAddress={wallet.walletAddress ?? null}
                    tierEmoji={state.profile?.tierEmoji ?? '🦠'}
                    tierName={state.profile?.tierName ?? 'Plancton'}
                    profile={state.profile}
                    totalPoints={state.totalPoints}
                    walletBalance={(wallet as any).walletBalance ?? null}
                    walletProvider={(wallet as any).provider ?? null}
                    walletNetwork={(wallet as any).network ?? null}
                />
            )}

            {state.screen === 'queue' && (
                <Queue position={state.queuePosition} needed={state.queueNeeded} onCancel={leaveQueue} queueMessage={state.queueMessage} />
            )}
            {/* Waiting for on-chain transaction */}
            {state.screen === 'waiting_onchain' && (
                <div className="waiting-onchain">
                    {/* Scanlines */}
                    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)', animation: 'scanDrift 20s linear infinite' }} />
                    <div className="onchain-spinner" />
                    <h2 style={{
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.6rem',
                        color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{state.devMode ? 'Starting Match' : 'Creating Match On-Chain'}</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', maxWidth: 380, lineHeight: 1.6 }}>
                        {state.devMode
                            ? 'DEV MODE — waiting for game to start...'
                            : 'Match found! Creating on-chain escrow. This takes about one Bitcoin block (~10 min on testnet).'}
                    </p>
                    {state.onchainError && (
                        <div style={{
                            padding: '8px 16px',
                            background: 'rgba(224,138,159,0.05)', border: '1px solid rgba(224,138,159,0.15)',
                            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                            fontSize: '0.78rem', color: '#e08a9f', maxWidth: 400,
                        }}>❌ {state.onchainError}</div>
                    )}
                    <div style={{
                        display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4,
                    }}>
                        {state.players.map((addr, i) => (
                            <div key={addr} className={`player-card ${addr === state.address ? 'player-card--you' : ''}`}>
                                <span style={{ fontSize: '1.2rem' }}>{i === 0 ? '👑' : '🎮'}</span>
                                <span style={{
                                    fontFamily: 'var(--font-display)', fontWeight: 600,
                                    fontSize: '0.75rem', color: 'var(--text-secondary)',
                                }}>{addr === state.address ? '✨ YOU' : (state.playerNames[addr] || truncAddr(addr))}</span>
                            </div>
                        ))}
                    </div>
                    {state.blockProgress ? (
                        <BlockProgress
                            label={state.blockProgress.confirmed ? 'Block confirmed!' : 'Waiting for block confirmation...'}
                            startBlock={state.blockProgress.startBlock}
                            currentBlock={state.blockProgress.currentBlock}
                            elapsed={state.blockProgress.elapsed}
                            autoTimer={false}
                        />
                    ) : (
                        <BlockProgress
                            label={state.onchainAction ? 'Wallet confirmation pending...' : 'Creating match on-chain...'}
                            autoTimer={true}
                        />
                    )}
                </div>
            )}

            {/* Lobby countdown — 15s Duel / 20s Arena */}
            {state.screen === 'lobby_countdown' && (
                <div className="lobby-countdown">
                    {/* Scanlines */}
                    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)', animation: 'scanDrift 20s linear infinite' }} />
                    <div style={{ fontSize: '2.5rem', marginBottom: 4 }}>⚔️</div>
                    <h2 style={{
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.6rem',
                        color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>Match Starting</h2>
                    <div className="lobby-countdown__ring">
                        <div className="lobby-countdown__timer" key={state.lobbySecondsLeft}>
                            {state.lobbySecondsLeft}
                        </div>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        All players connected. Get ready!
                    </p>
                    <div style={{
                        display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
                    }}>
                        {state.players.map((addr, i) => (
                            <div key={addr} className={`player-card ${addr === state.address ? 'player-card--you' : ''}`}>
                                <span style={{ fontSize: '1rem' }}>
                                    {i === 0 ? '👑' : ['🎮', '🕹️', '🎲', '🃏'][i % 4]}
                                </span>
                                <span style={{
                                    fontFamily: 'var(--font-body)', fontWeight: 600,
                                    fontSize: '0.72rem', color: 'var(--text-secondary)',
                                }}>{addr === state.address ? '✨ YOU' : (state.playerNames[addr] || truncAddr(addr))}</span>
                                <span style={{
                                    width: 8, height: 8, borderRadius: '50%', background: '#82c4a0',
                                    boxShadow: '0 0 6px rgba(130,196,160,0.5)',
                                }} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Seed reveal — 5s display of match seed */}
            {state.screen === 'seed_reveal' && (
                <div className="seed-reveal">
                    {/* Scanlines */}
                    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)', animation: 'scanDrift 20s linear infinite' }} />
                    <div style={{ fontSize: '3rem' }}>🎲</div>
                    <h2 style={{
                        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.6rem',
                        color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>Seed Revealed</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', maxWidth: 380, lineHeight: 1.6 }}>
                        This seed determines the entire price chart.
                        Anyone can verify the chart was fair.
                    </p>
                    <div className="seed-reveal__hash">
                        {state.seed ?? '...'}
                    </div>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: '0.78rem', color: 'var(--blue)',
                        fontFamily: 'var(--font-display)', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                        <span style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: 'var(--blue)', animation: 'pulse 1.5s infinite',
                        }} />
                        Preview starting soon...
                    </div>
                </div>
            )}

            {/* Preview + Playing */}
            {isPlaying && (
                <GameScreen
                    state={state}
                    onTrade={trade}
                    onUseItem={useItem}
                    onSelectTarget={selectTarget}
                    onCancelTargeting={cancelTargeting}
                    onDismissToast={dismissToast}
                    onSendChat={sendChatMessage}
                    onSetChatTab={setChatTab}
                    onSetWhisperTarget={setChatWhisperTarget}
                    isPreview={state.screen === 'preview'}
                />
            )}

            {state.screen === 'results' && (
                <Results
                    standings={state.finalStandings}
                    address={wallet.walletAddress}
                    txHash={state.settlementTx}
                    status={state.settlementStatus}
                    tradeCount={state.tradeCount}
                    matchDuration={state.currentTick}
                    matchBuyIn={state.matchBuyIn}
                    startingCapital={state.startingCapital}
                    motoUsdPrice={state.motoUsdPrice}
                    onBackToMenu={backToLobby}
                    onPlayAgain={playAgain}
                />
            )}

            {/* Global floating chat */}
            {!isPlaying && state.authenticated && (
                <>
                    <button
                        className="global-chat-toggle"
                        onClick={() => setChatOpen((o) => !o)}
                    >
                        💬
                        {(() => {
                            const total = Object.values(state.chatUnread).reduce((a, b) => a + b, 0);
                            return total > 0 ? <span className="global-chat-badge">{total}</span> : null;
                        })()}
                    </button>
                    {chatOpen && (
                        <div className="global-chat-panel">
                            <div className="global-chat-header">
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>💬 Chat</span>
                                <button onClick={() => setChatOpen(false)} style={{
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    fontSize: '1rem', color: 'var(--text-muted)', padding: '2px 6px',
                                }}>✕</button>
                            </div>
                            <ChatPanel
                                chatMessages={state.chatMessages}
                                activeTab={state.chatActiveTab}
                                unread={state.chatUnread}
                                inGame={false}
                                address={state.address}
                                whisperTarget={state.chatWhisperTarget}
                                onSendChat={sendChatMessage}
                                onSetTab={setChatTab}
                                onSetWhisperTarget={setChatWhisperTarget}
                                players={state.players}
                            />
                        </div>
                    )}
                </>
            )}
            {/* Global toasts — shown on lobby/queue screens for backend errors */}
            {!isPlaying && state.toasts.length > 0 && (
                <div style={{
                    position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999,
                    pointerEvents: 'auto',
                }}>
                    {state.toasts.map((toast) => (
                        <div key={toast.id} style={{
                            background: 'rgba(244,184,206,0.15)', border: '1px solid rgba(244,184,206,0.3)',
                            color: '#F4B8CE', padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600,
                            fontFamily: "'Chakra Petch', sans-serif",
                            clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                            animation: 'toast-in 0.3s ease-out', cursor: 'pointer',
                            backdropFilter: 'blur(8px)',
                        }} onClick={() => dismissToast(toast.id)}>
                            {toast.text}
                        </div>
                    ))}
                </div>
            )}

            {/* Footer banner — shown on lobby/non-game screens */}
            {!isPlaying && state.screen !== 'onboarding' && state.screen !== 'waiting_onchain' && (
                <Footer />
            )}
        </div>
    );
}
