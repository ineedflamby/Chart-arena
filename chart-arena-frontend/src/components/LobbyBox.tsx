import React from 'react';

export function LobbyBox({ label, accent, accent2, children, flex = false }: {
    label: string; accent: string; accent2?: string; children: React.ReactNode; flex?: boolean;
}) {
    const c2 = accent2 || accent;
    return (
        <div style={{
            position: 'relative',
            background: 'linear-gradient(168deg, rgba(22,18,38,0.92) 0%, rgba(12,10,22,0.88) 100%)',
            border: `1px solid ${accent}28`, borderRadius: 0,
            display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(14px)',
            boxShadow: `0 0 1px ${accent}40, 0 2px 8px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 ${accent}12`,
            ...(flex ? { flex: 1, minHeight: 0 } : {}),
            overflow: 'hidden',
        }}>
            {/* Top glow line — thicker & brighter */}
            <div style={{
                height: 3, flexShrink: 0,
                background: `linear-gradient(90deg, transparent 5%, ${accent}80, ${c2}60, transparent 95%)`,
                boxShadow: `0 1px 8px ${accent}30, 0 0 20px ${accent}15`,
            }} />
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 14px 7px', flexShrink: 0,
            }}>
                <div style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: accent, boxShadow: `0 0 8px ${accent}AA, 0 0 16px ${accent}40`,
                }} />
                <span style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                    fontSize: '0.65rem', letterSpacing: 2.5, color: accent,
                    textShadow: `0 0 10px ${accent}40`,
                }}>{label}</span>
                <div style={{
                    flex: 1, height: 1,
                    background: `linear-gradient(90deg, ${accent}30, transparent 80%)`,
                }} />
                <div style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: c2, boxShadow: `0 0 8px ${c2}AA, 0 0 16px ${c2}40`,
                }} />
            </div>
            {/* Body */}
            <div style={{
                padding: '6px 14px 14px',
                ...(flex ? { flex: 1, overflow: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
            }}>
                {children}
            </div>
        </div>
    );
}
