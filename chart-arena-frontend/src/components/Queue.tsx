import { useState, useEffect } from 'react';

export function Queue({ position, needed, onCancel, queueMessage }: { position: number; needed: number; onCancel: () => void; queueMessage?: string | null }) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => { const iv = setInterval(() => setElapsed(t => t + 1), 1000); return () => clearInterval(iv); }, []);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    return (
        <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '40px 24px', gap: 24, fontFamily: "'Chakra Petch', sans-serif",
            background: '#0b0a14',
            backgroundImage: 'radial-gradient(ellipse at 30% 20%, rgba(146,180,244,0.05) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(244,184,206,0.03) 0%, transparent 50%)',
        }}>
            {/* Scanlines */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999, opacity: 0.02,
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
                animation: 'scanDrift 20s linear infinite',
            }} />
            <div className="onchain-spinner" style={{ width: 64, height: 64 }} />
            <h2 style={{
                fontWeight: 700, fontSize: '1.6rem', letterSpacing: '0.06em',
                color: '#d4b978', textShadow: '0 0 20px rgba(212,185,120,0.2)',
                textTransform: 'uppercase',
            }}>Searching for Opponent...</h2>

            <div style={{
                padding: '14px 32px', textAlign: 'center',
                background: 'rgba(212,185,120,0.04)',
                border: '1.5px solid rgba(212,185,120,0.25)',
                clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
                animation: 'queuePulse 2.5s infinite',
            }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a09abc' }}>
                    Player {position} of {needed}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#6b6590', marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
                    Queue: {fmt(elapsed)}
                </div>
            </div>

            {/* P1: Show backend search feedback */}
            {queueMessage && (
                <div style={{
                    padding: '8px 20px', textAlign: 'center',
                    fontSize: '0.75rem', color: '#92B4F4', fontWeight: 600,
                    background: 'rgba(146,180,244,0.04)', border: '1px solid rgba(146,180,244,0.12)',
                    clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
                    maxWidth: 380,
                }}>
                    {queueMessage}
                </div>
            )}

            <button onClick={onCancel} style={{
                padding: '10px 32px', cursor: 'pointer',
                border: '1.5px solid rgba(224,138,159,0.3)', background: 'rgba(224,138,159,0.06)',
                fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: '0.8rem', color: '#e08a9f',
                transition: 'all 0.2s', textTransform: 'uppercase', letterSpacing: '0.06em',
                clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
            }}>Cancel</button>
        </div>
    );
}


