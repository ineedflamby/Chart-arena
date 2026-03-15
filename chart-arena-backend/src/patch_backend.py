#!/usr/bin/env python3
"""
Backend bug patcher - applies BUG 2,3,4,5,6 to EXISTING backend files.
Safe to run on already-patched files (skips if already applied).
"""

BASE = '/root/chart-arena/chart-arena-backend/src'

def safe_patch(filepath, old, new, label):
    with open(filepath, 'r') as f:
        c = f.read()
    if new.strip()[:60] in c:
        print(f'  SKIP {label} (already applied)')
        return
    if old not in c:
        print(f'  WARN {label} - pattern not found')
        return
    c = c.replace(old, new, 1)
    with open(filepath, 'w') as f:
        f.write(c)
    print(f'  OK   {label}')

print('=== Backend Bug Patcher ===\n')

# ── BUG-2: Queue guard ──
print('BUG-2: Queue guard...')
HANDLERS = BASE + '/ws/handlers.ts'

with open(HANDLERS) as f:
    h = f.read()

if 'Already in an active game' in h:
    print('  SKIP (already applied)')
else:
    # Find the handleQueue function body - look for the tier extraction
    idx = h.find("const tier = msg['tier']")
    if idx > 0:
        # Find the line before it that has "const address ="
        addr_idx = h.rfind('const address = getPlayerAddress(wsId)!;', 0, idx)
        if addr_idx > 0:
            insert_point = h.find('\n', addr_idx) + 1
            guard = """
    // BUG-2: Prevent queuing while in an active game
    const activeGame = getGameByPlayer(address);
    if (activeGame) {
        sendToSocket(ws, ServerMsg.ERROR, { message: 'Already in an active game. Finish or abandon first.' });
        return;
    }

"""
            h = h[:insert_point] + guard + h[insert_point:]
            with open(HANDLERS, 'w') as f:
                f.write(h)
            print('  OK   BUG-2: queue guard')
        else:
            print('  WARN: could not find address line')
    else:
        print('  WARN: could not find tier extraction')

# ── BUG-3+5: Match log + earnings in DEV mode ──
print('BUG-3+5: Match log + earnings...')
MATCHMAKING = BASE + '/services/matchmaking.ts'

with open(MATCHMAKING) as f:
    m = f.read()

# Add MatchLog import if missing
if 'MatchLog' not in m:
    m = m.replace(
        "import { createGame, type GameInstance, removeGame } from '../game/game-loop.js';",
        "import { createGame, type GameInstance, removeGame } from '../game/game-loop.js';\nimport type { MatchLog } from '../game/types.js';"
    )
    with open(MATCHMAKING, 'w') as f:
        f.write(m)
    print('  OK   MatchLog import')
else:
    print('  SKIP MatchLog import (exists)')

# Re-read
with open(MATCHMAKING) as f:
    m = f.read()

# Add storeMatchLog in DEV mode
if 'devLog' in m or 'devMatchLog' in m:
    print('  SKIP match log storage (already applied)')
else:
    # Find "const matchBuyIn = game.match.buyIn.toString();" in the DEV block
    # It appears twice - we want the first one (DEV mode)
    dev_marker = m.find('DEV: Game ended')
    if dev_marker > 0:
        buyin_idx = m.find('const matchBuyIn = game.match.buyIn.toString();', dev_marker)
        if buyin_idx > 0:
            insert = """
            // BUG-3: Store match log in DEV mode
            const _devPlayers: string[] = [];
            for (const [addr] of game.match.players) _devPlayers.push(addr);
            const devLog: MatchLog = {
                matchId: matchId.toString(), seed: game.match.seed.toString(),
                mode: game.match.mode, format: game.match.format,
                buyIn: game.match.buyIn.toString(), players: _devPlayers,
                priceTicks: game.match.priceTicks, trades: game.match.trades,
                events: game.match.events, standings, payouts: [], timestamp: Date.now(),
            };
            db.storeMatchLog(devLog);

"""
            m = m[:buyin_idx] + insert + m[buyin_idx:]
            with open(MATCHMAKING, 'w') as f:
                f.write(m)
            print('  OK   match log storage')
        else:
            print('  WARN: matchBuyIn line not found after DEV marker')
    else:
        print('  WARN: DEV game ended marker not found')

# Re-read
with open(MATCHMAKING) as f:
    m = f.read()

# Fix earnings calculation
if 'pnlRatio' in m:
    print('  SKIP earnings fix (already applied)')
elif 'finalEquity.toFixed(0)' in m:
    old_earn = "const earnings = s.finalEquity.toFixed(0);"
    new_earn = """// BUG-5: earnings in token units
                    const pnlRatio = (s.finalEquity - STARTING_CAPITAL) / STARTING_CAPITAL;
                    const earnings = BigInt(Math.round(pnlRatio * Number(game.match.buyIn))).toString();"""
    m = m.replace(old_earn, new_earn, 1)
    with open(MATCHMAKING, 'w') as f:
        f.write(m)
    print('  OK   earnings fix')
else:
    print('  SKIP earnings (already modified)')

# ── BUG-4: buyIn in GAME_START ──
print('BUG-4: buyIn in GAME_START...')
with open(MATCHMAKING) as f:
    m = f.read()

# DEV GAME_START
if 'buyIn: buyIn.toString(),' in m:
    print('  SKIP (already has buyIn in GAME_START)')
else:
    # Find "startingCapital: STARTING_CAPITAL," followed by "players:" in the dev block
    import re
    
    # Pattern: GAME_START broadcast with startingCapital + players but no buyIn
    pattern = r'(startingCapital: STARTING_CAPITAL,\n)(\s+players: playerAddresses,)'
    
    def add_buyin(match):
        indent = '        '
        return match.group(1) + indent + 'buyIn: buyIn.toString(),\n' + indent + 'mode, format,\n' + match.group(2)
    
    new_m = re.sub(pattern, add_buyin, m)
    if new_m != m:
        with open(MATCHMAKING, 'w') as f:
            f.write(new_m)
        count = new_m.count('buyIn: buyIn.toString(),')
        print(f'  OK   buyIn added to {count} GAME_START broadcast(s)')
    else:
        print('  WARN: could not find GAME_START pattern')

# ── BUG-6: Reconnect snapshot ──
print('BUG-6: Reconnect snapshot...')
GAMELOOP = BASE + '/game/game-loop.ts'

with open(GAMELOOP) as f:
    g = f.read()

if 'buyIn: this.match.buyIn' in g:
    print('  SKIP (already has buyIn in snapshot)')
else:
    old_snap = """            startingCapital: STARTING_CAPITAL,
            players: playerAddresses,
            devMode: config.devMode,"""
    
    new_snap = """            startingCapital: STARTING_CAPITAL,
            buyIn: this.match.buyIn.toString(),
            mode: this.match.mode,
            format: this.match.format,
            players: playerAddresses,
            devMode: config.devMode,"""
    
    if old_snap in g:
        g = g.replace(old_snap, new_snap)
        with open(GAMELOOP, 'w') as f:
            f.write(g)
        print('  OK   snapshot updated')
    else:
        print('  WARN: snapshot pattern not found')

# ── VERIFY ──
print('\n=== Verification ===')
checks = [
    (HANDLERS, 'Already in an active game', 'BUG-2'),
    (MATCHMAKING, 'MatchLog', 'BUG-3 import'),
    (MATCHMAKING, 'devLog', 'BUG-3 storage'),
    (MATCHMAKING, 'buyIn: buyIn.toString()', 'BUG-4'),
    (MATCHMAKING, 'pnlRatio', 'BUG-5'),
    (GAMELOOP, 'buyIn: this.match.buyIn', 'BUG-6'),
]
ok = True
for path, needle, label in checks:
    with open(path) as f:
        found = needle in f.read()
    print(f"  {'OK' if found else 'FAIL'}: {label}")
    if not found: ok = False

print(f"\n{'All good!' if ok else 'Some patches failed.'}")
print('Run: cd /root/chart-arena/chart-arena-backend && npm run build && pm2 restart ca-backend')
