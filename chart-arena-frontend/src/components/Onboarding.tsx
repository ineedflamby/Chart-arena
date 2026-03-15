import { useState } from 'react';

export function Onboarding({ address, error, onSetUsername, onConnectX }: {
    address: string | null;
    error: string | null;
    onSetUsername: (username: string, twitterHandle?: string) => void;
    onConnectX: () => void;
}) {
    const [input, setInput] = useState("");
    const [validationMsg, setValidationMsg] = useState<string | null>(null);

    const validateUsername = (val: string) => {
        if (val.length === 0) { setValidationMsg(null); return; }
        if (val.length < 3) { setValidationMsg("Too short (min 3)"); return; }
        if (val.length > 16) { setValidationMsg("Too long (max 16)"); return; }
        if (!/^[a-zA-Z0-9_]+$/.test(val)) { setValidationMsg("Letters, numbers, _ only"); return; }
        setValidationMsg(null);
    };

    const handleSubmit = () => { onSetUsername(input.trim()); };
    const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleSubmit(); };

    const handleSkip = () => {
        const suffix = address ? address.slice(-4) : Math.random().toString(36).slice(2, 6);
        onSetUsername('Trader_' + suffix);
    };

    return (
        <div className="onboarding">
            {/* Scanline overlay */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02,
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
                animation: 'scanDrift 20s linear infinite',
            }} />
            <div className="onboarding__card">
                <div className="onboarding__hero">
                    <span className="onboarding__icon">⚡</span>
                    <h1 style={{
                        fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '1.8rem',
                        margin: '8px 0 0', letterSpacing: '0.03em',
                    }}>
                        <span style={{ color: '#92B4F4' }}>CHART</span>
                        <span style={{ color: '#d4b978', margin: '0 4px', filter: 'drop-shadow(0 0 4px rgba(212,185,120,0.3))' }}>⚡</span>
                        <span style={{ color: '#F4B8CE' }}>ARENA</span>
                    </h1>
                    <p className="onboarding__sub">
                        Pick a name so players know who they're up against.
                    </p>
                </div>

                <div className="onboarding__form">
                    <div className="onboarding__input-wrap">
                        <input
                            className="onboarding__input"
                            type="text"
                            placeholder="Enter callsign..."
                            value={input}
                            onChange={(e) => { setInput(e.target.value); validateUsername(e.target.value); }}
                            onKeyDown={handleKeyDown}
                            maxLength={16}
                            autoFocus
                        />
                        {input.length > 0 && !validationMsg && (
                            <span className="onboarding__input-ok">✓</span>
                        )}
                    </div>
                    {validationMsg && <div className="onboarding__validation">{validationMsg}</div>}
                    {error && <div className="onboarding__error">{error}</div>}

                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="onboarding__submit" onClick={handleSubmit}
                            disabled={!input.trim() || !!validationMsg}
                        >⚔️ Set Callsign</button>
                    </div>

                    {/* Skip — auto-generate a temp name */}
                    <div style={{
                        textAlign: 'center', marginTop: 2,
                    }}>
                        <button onClick={handleSkip} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#6b5b95', fontSize: '0.75rem', fontFamily: "'IBM Plex Mono', monospace",
                            fontWeight: 500, padding: '4px 8px',
                            transition: 'color 0.2s',
                        }}>
                            Skip for now →
                        </button>
                        <div style={{
                            fontSize: '0.62rem', color: '#4a4668', marginTop: 2,
                            fontFamily: "'IBM Plex Mono', monospace",
                        }}>
                            You can skip and play as a guest
                        </div>
                    </div>

                    <div className="onboarding__divider">or</div>

                    <button className="onboarding__x-btn" onClick={onConnectX}>
                        <span style={{ fontSize: "1.1rem" }}>𝕏</span>
                        Connect with X
                    </button>
                    <div style={{
                        textAlign: 'center', fontSize: '0.65rem', color: '#554d73',
                        marginTop: -2, fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                        Import your X username · Earn bonus points
                    </div>
                </div>

                <div className="onboarding__footer">
                    {address && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#82c4a0', boxShadow: '0 0 6px #82c4a0' }} />
                            {address.slice(0, 10)}...{address.slice(-6)}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
