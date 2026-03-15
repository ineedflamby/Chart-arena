#!/usr/bin/env python3
import os, re

BASE = os.path.expanduser('~/chart-arena')
ok, fail = [], []

def patch(path, desc, old, new):
    f = os.path.join(BASE, path)
    if not os.path.exists(f): fail.append(f"MISSING: {path}"); return
    c = open(f).read()
    if c.count(old) != 1: fail.append(f"NOMATCH({c.count(old)}): {desc}"); return
    open(f,'w').write(c.replace(old, new))
    ok.append(desc)

# UX-16: MechaLobby escrow via WS
patch('chart-arena-frontend/src/components/MechaLobby.tsx', 'UX-16a: gameWS import',
    "import { LobbyBox } from './LobbyBox';",
    "import { LobbyBox } from './LobbyBox';\nimport { gameWS } from '../services/ws';")

patch('chart-arena-frontend/src/components/MechaLobby.tsx', 'UX-16b: WS escrow balance',
    """    // Fetch escrow balance
    useEffect(() => {
        if (!walletProvider || !walletNetwork || !walletAddress) { setEscrowBalance(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const { getEscrowBalance } = await import('../services/contract');
                const bal = await getEscrowBalance(walletProvider, walletNetwork, walletAddress);
                if (!cancelled) setEscrowBalance(bal.toString());
            } catch (err) {
                console.warn('[Balance] Failed to read escrow balance:', err);
                if (!cancelled) setEscrowBalance('0');
            }
        })();
        return () => { cancelled = true; };
    }, [walletProvider, walletNetwork, walletAddress]);""",
    """    // UX-16 FIX: Escrow balance via WebSocket (instant, no 10-min block wait)
    useEffect(() => {
        if (!walletAddress) { setEscrowBalance(null); return; }
        gameWS.send('get_escrow_balance');
        const unsub = gameWS.on('escrow_balance', (msg: any) => {
            if (msg.balance !== undefined) setEscrowBalance(msg.balance);
        });
        const iv = setInterval(() => gameWS.send('get_escrow_balance'), 30_000);
        return () => { unsub(); clearInterval(iv); };
    }, [walletAddress]);""")

# UX-29: Flat penalty warning
patch('chart-arena-frontend/src/components/GameScreen.tsx', 'UX-29: Flat penalty warning',
    """                    {state.lastReject && (
                        <div style={{ marginTop: 4, fontSize: '0.68rem', color: '#F4B8CE', fontWeight: 600 }}>
                            ✗ {state.lastReject}
                        </div>
                    )}
                </GameBox>""",
    """                    {state.lastReject && (
                        <div style={{ marginTop: 4, fontSize: '0.68rem', color: '#F4B8CE', fontWeight: 600 }}>
                            ✗ {state.lastReject}
                        </div>
                    )}
                    {state.positionStatus === 'FLAT' && !isPreview && state.currentTick >= 35 && state.currentTick < 60 && (
                        <div style={{
                            marginTop: 4, padding: '4px 8px', fontSize: '0.68rem', fontWeight: 700,
                            color: state.currentTick >= 45 ? '#F4B8CE' : '#d4b978',
                            background: state.currentTick >= 45 ? 'rgba(244,184,206,0.06)' : 'rgba(212,185,120,0.06)',
                            border: '1px solid ' + (state.currentTick >= 45 ? 'rgba(244,184,206,0.15)' : 'rgba(212,185,120,0.15)'),
                            clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                            textAlign: 'center',
                            animation: state.currentTick >= 45 ? 'pulse-glow 1s infinite' : 'none',
                        }}>
                            {state.currentTick >= 45
                                ? '\u{1F4C9} FLAT PENALTY ACTIVE \u2014 Open a position!'
                                : '\u26A0\uFE0F Flat penalty in ' + (60 - state.currentTick) + ' ticks \u2014 trade soon!'}
                        </div>
                    )}
                </GameBox>""")

# UX-30: Trade count in header
patch('chart-arena-frontend/src/components/GameScreen.tsx', 'UX-30: Trade count in header',
    """                    <span style={{ fontSize: '0.7rem', color: '#665C87', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600 }}>
                        TICK {state.currentTick}/{state.totalTicks}
                    </span>""",
    """                    <span style={{ fontSize: '0.7rem', color: '#665C87', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600 }}>
                        TICK {state.currentTick}/{state.totalTicks}
                    </span>
                    <span style={{
                        fontSize: '0.65rem', fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                        padding: '2px 8px',
                        clipPath: 'polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%)',
                        background: state.tradeCount >= 6 ? 'rgba(244,184,206,0.08)' : 'rgba(146,180,244,0.06)',
                        border: '1px solid ' + (state.tradeCount >= 6 ? 'rgba(244,184,206,0.15)' : 'rgba(146,180,244,0.08)'),
                        color: state.tradeCount >= 6 ? '#F4B8CE' : '#92B4F4',
                    }}>
                        {'\u{1F4CA}'} {state.tradeCount} TRADES
                    </span>""")

# UX-33: Settlement text
patch('chart-arena-frontend/src/components/Results.tsx', 'UX-33: Settlement text',
    """            {/* Settlement */}
            <div style={{ fontSize: '0.8rem', color: '#554d73', animation: 'slide-up 1s ease-out' }}>
                {status === 'settled' && txHash && <span>✅ TX: {truncAddr(txHash)}</span>}
                {status === 'failed' && <span style={{ color: '#F4B8CE' }}>❌ Settlement failed</span>}
                {!status && <span>⏳ Settling...</span>}
            </div>""",
    """            {/* UX-33: Human-readable settlement */}
            <div style={{ fontSize: '0.8rem', color: '#554d73', animation: 'slide-up 1s ease-out' }}>
                {status === 'settled' && txHash && <span style={{ color: '#82c4a0' }}>{'\u2705'} Results confirmed! Balance updated.</span>}
                {status === 'failed' && <span style={{ color: '#F4B8CE' }}>{'\u274C'} Settlement failed — funds are safe, retrying...</span>}
                {!status && <span>{'\u23F3'} Recording results on Bitcoin...</span>}
            </div>""")

# UX-54: Dead files
print("\n\U0001F5D1  Removing dead files...")
for f in ['chart-arena-backend/check.mjs','chart-arena-backend/check2.mjs','chart-arena-backend/check3.mjs',
    'chart-arena-backend/check4.mjs','chart-arena-backend/check5.mjs','chart-arena-backend/check6.mjs',
    'chart-arena-backend/check7.mjs','chart-arena-backend/check8.mjs',
    'chart-arena-backend/src/INTEGRATION_GUIDE.ts','chart-arena-backend/src/simulate.ts',
    'chart-arena-backend/src/simulate-quests.ts','chart-arena-backend/stress-test.ts',
    'chart-arena-backend/src/patch_backend.py',
    'chart-arena-frontend/ChartVFX.tsx','chart-arena-frontend/sound.ts']:
    p = os.path.join(BASE, f)
    if os.path.exists(p): os.remove(p); ok.append(f"Removed {f}")

print("\n" + "="*50)
print(f"OK: {len(ok)}")
for x in ok: print(f"  \u2705 {x}")
if fail:
    print(f"\nFAILED: {len(fail)}")
    for x in fail: print(f"  \u274C {x}")
print("\nNext: cd chart-arena-frontend && rm -rf node_modules/.vite && npx vite build && pm2 restart ca-frontend")
