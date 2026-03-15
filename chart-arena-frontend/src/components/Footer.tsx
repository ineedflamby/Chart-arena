/**
 * Footer Banner — Bottom bar with social links, docs, and disclaimer.
 * Only shown on lobby/non-game screens.
 */

interface FooterProps {
    onOpenDocs?: () => void;
}

const LINK_STYLE: React.CSSProperties = {
    color: '#665C87', fontSize: '0.65rem', textDecoration: 'none',
    fontWeight: 700, letterSpacing: '0.08em', transition: 'color 0.2s',
    fontFamily: "'Chakra Petch', sans-serif", textTransform: 'uppercase',
};

const BTN_LINK_STYLE: React.CSSProperties = {
    ...LINK_STYLE,
    border: 'none', background: 'none', cursor: 'pointer', padding: 0,
};

export function Footer({ onOpenDocs }: FooterProps) {
    return (
        <footer style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 24px',
            background: 'rgba(8,7,16,0.95)',
            borderTop: '1px solid rgba(146,180,244,0.06)',
            fontFamily: "'Chakra Petch', sans-serif",
            flexWrap: 'wrap', gap: 10,
        }}>
            {/* Left — links */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <a href="https://x.com/ChartArena" target="_blank" rel="noopener noreferrer"
                    style={LINK_STYLE}
                    onMouseEnter={e => (e.currentTarget.style.color = '#92B4F4')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#665C87')}
                >𝕏 Twitter</a>

                <span style={{ color: 'rgba(146,180,244,0.15)', fontSize: '0.5rem' }}>│</span>

                <a href="https://github.com/ineedflamby/Chart-arena" target="_blank" rel="noopener noreferrer"
                    style={LINK_STYLE}
                    onMouseEnter={e => (e.currentTarget.style.color = '#92B4F4')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#665C87')}
                >GitHub</a>

                <span style={{ color: 'rgba(146,180,244,0.15)', fontSize: '0.5rem' }}>│</span>

                <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer"
                    style={LINK_STYLE}
                    onMouseEnter={e => (e.currentTarget.style.color = '#92B4F4')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#665C87')}
                >OPNet Docs</a>

                <span style={{ color: 'rgba(146,180,244,0.15)', fontSize: '0.5rem' }}>│</span>

                <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer"
                    style={LINK_STYLE}
                    onMouseEnter={e => (e.currentTarget.style.color = '#d4b978')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#665C87')}
                >MotoSwap</a>

                <span style={{ color: 'rgba(146,180,244,0.15)', fontSize: '0.5rem' }}>│</span>

                <button
                    onClick={onOpenDocs}
                    style={BTN_LINK_STYLE}
                    onMouseEnter={e => (e.currentTarget.style.color = '#EBCCFF')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#665C87')}
                >📄 Docs</button>
            </div>

            {/* Center — branding */}
            <div style={{
                fontSize: '0.6rem', color: '#3d3566', letterSpacing: '0.06em',
                fontWeight: 600,
            }}>
                <span style={{ color: '#4a4668' }}>CHART</span>
                <span style={{ color: '#5a4e3a', margin: '0 2px' }}>⚡</span>
                <span style={{ color: '#4a3d55' }}>ARENA</span>
                <span style={{ margin: '0 6px', color: '#2a2640' }}>·</span>
                <span>Built on OPNet — Bitcoin L1 Smart Contracts</span>
            </div>

            {/* Right — disclaimer */}
            <div style={{
                fontSize: '0.55rem', color: '#2e2a45', maxWidth: 320,
                lineHeight: 1.4, textAlign: 'right',
            }}>
                Testnet only. No real funds at risk. Trading involves risk.
                This is experimental software provided as-is with no warranty.
            </div>
        </footer>
    );
}
