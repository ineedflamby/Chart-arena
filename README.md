# Chart Arena

Competitive PvP trading game on Bitcoin L1 via OPNet. Players bet MOTO tokens, trade a live price chart in real-time, and the best P&L wins the pot.

## Stack

- **Smart Contract** - AssemblyScript / `btc-runtime` / OPNet L1
- **Backend** - TypeScript / Node.js / WebSocket (`ws`) / SQLite
- **Frontend** - React 19 / Vite / OPNet WalletConnect
- **Deploy** - PM2 / nginx / Ubuntu VPS

## Repo Structure

```
chart-arena/
|-- chart-arena-backend/          # Game server, matchmaking, settlement
|   |-- src/
|       |-- game/                 # Game loop, items, trading engine
|       |-- services/             # Matchmaking, ELO, chart engine, points, seasons
|       |-- ws/                   # WebSocket handler
|       |-- db/                   # SQLite schema & queries
|
|-- chart-arena-frontend/         # React SPA
|   |-- src/
|       |-- components/           # Game screen, lobby, chart, chat, onboarding
|       |-- hooks/                # React hooks
|       |-- services/             # OPNet wallet integration
|
|-- chart-arena-escrow/           # On-chain escrow contract (AssemblyScript)
|   |-- src/contracts/
|       |-- ChartArenaEscrow.ts
|
|-- chart-arena-deploy/           # Contract deployment scripts
|
|-- ecosystem.config.cjs          # PM2 config (create from setup script)
|-- nginx-chart-arena.conf        # nginx reverse proxy config
|-- setup-production.js           # Generates env config & validates setup
|-- MAINNET_CHECKLIST.md          # Pre-launch checklist
```

---

## Game Mechanics

### Match Flow

Every match follows the same timeline: **15s preview** (read-only chart, no trades) then **GO**.

The price chart always starts at $100.00. Each player starts with **$5.00 virtual equity**. You go long, go short, or stay flat. Best equity at the end wins the pot.

### Phases

Matches are **240 ticks** (4 minutes), split into 4 phases with escalating volatility:

| Phase | Ticks | Volatility | What happens |
|-------|-------|------------|--------------|
| **OPEN** | 0-44 | 0.6x | Low vol, feel out the chart |
| **MID** | 45-164 | 1.0x | Normal trading, items drop |
| **CRUNCH** | 165-209 | 1.5x | Things get spicy |
| **OVERTIME** | 210-239 | 2.0x | Maximum chaos, flat penalty escalates |

Survival mode extends to **300 ticks** (5 min) with OVERTIME running from tick 210-299.

### Trading Rules

- **Slippage**: 0.1% base on every open/close
- **Open-to-close cooldown**: 5s minimum hold time
- **Close-to-open cooldown**: 3s before reopening
- **Flat penalty**: If you sit flat too long, equity bleeds. Escalating: 1x base for 0-10s overtime, 2x for 10-20s, 3x for 20-40s, 5x beyond that

Flat penalty thresholds vary by mode:

- Classic Arena: 90s flat = penalty starts ($0.01/tick)
- Classic Duel: 60s flat ($0.015/tick)
- Chaos: 60s flat ($0.02/tick)
- Survival: no flat penalty

### Game Modes

**Classic** - Standard trading match. Pure chart skill.

**Survival** - 2x internal leverage, 5-minute matches. Players can get liquidated (equity hits 0 = eliminated). Extended OVERTIME. Payouts split by survivor count (last man standing gets 100%, 2 survivors get 65/35, etc).

**Chaos** - 1.3x base volatility multiplier. Items drop earlier and more often. T3 ultimates available from the first drop. Full chaos.

### Formats

- **Duel** - 1v1. 15s lobby timer.
- **Arena** - Up to 5 players. 20s lobby timer. Anti-focus protection (same player can't be targeted twice in 15s).

### Buy-in Tiers

| Tier | Entry | Unlock |
|------|-------|--------|
| Bronze | 5 MOTO | Default |
| Silver | 25 MOTO | Progressive |
| Gold | 100 MOTO | Progressive |

**Rake**: 10% of the pot. Duel payout is winner-takes-all. Arena splits 50/25/12/7/6 across 5 places.

---

## Item System

14 items across 3 tiers. Items drop on scheduled ticks during the match. Each player can hold **max 2 items** (oldest gets replaced). **8s cooldown** between activations.

Items are usable from tick 45 (MID phase) in Classic/Survival, or tick 20 in Chaos.

### Tier 1 -- Trading Powers

| Item | Emoji | Duration | Target | Effect |
|------|-------|----------|--------|--------|
| **Ghost Trade** | :ghost: | 8s | Self | Zero slippage + hidden position. Opponents can't see your trades. |
| **Shield** | :shield: | 10s | Self | Blocks next incoming attack. 50% chance to reflect it back. Grants a 3s Boost on successful block. |
| **Scalp** | :zap: | 3s | Self | Auto-trade: detects momentum, opens 3x leveraged position, auto-closes in 3s. |
| **Radar** | :satellite: | 10s | Self | Reveals all positions, live equity, and inventories. Breaks active Ghost Trade on all opponents. |
| **Boost** | :rocket: | 12s | Self | Next trade gets x1.5 returns (gains AND losses). Visible to opponents. |

### Tier 2 -- Direct Attacks

| Item | Emoji | Duration | Target | Effect |
|------|-------|----------|--------|--------|
| **Freeze** | :ice_cube: | 5s | Opponent | Target can't open positions. Can close but at 5x slippage. If flat while frozen, bleeds 1% equity/sec. |
| **Mirror Curse** | :mirror: | 8s | Opponent | Target sees an inverted chart for 8s. |
| **Drain** | :drop_of_blood: | Instant | Opponent | Steal 8% of target's equity (min $0.10). |
| **Glitch** | :space_invader: | 6s | Opponent | Target's chart freezes -- stale data for 6s. |
| **Swap** | :arrows_counterclockwise: | Instant | Opponent | Swap your position direction AND entry price with target. Both must be in a position (fizzles if either is flat). |

### Tier 3 -- Ultimates

| Item | Emoji | Duration | Target | Effect |
|------|-------|----------|--------|--------|
| **Nuke** | :radioactive: | Instant | Global | Force-close ALL players with open positions. Price drops 3-5% (more victims = bigger drop, capped at 5%). |
| **Blackout** | :new_moon: | 6s | Global | Everyone else loses ALL UI for 6s. Activator gets a 2s price preview. |
| **Earthquake** | :volcano: | 8s | Global | Volatility x5 for 8s. All trade cooldowns reduced to 1s. Pure chaos. |
| **Heist** | :moneybag: | Instant | Global | Steal 10% equity from the #1 ranked player (or #2 if you are #1). |

### Drop Schedules

Item drops are timed per mode/format. Later drops have higher T3 rates:

**Classic Duel** - 3 drops (ticks 45, 120, 180). NO T3 items. Pure skill.

**Classic Arena** - 4 drops. T3 escalates from 5% to 50%.

**Survival Arena** - 5 drops. T3 escalates from 5% to 60%.

**Chaos Duel** - 5 drops starting at tick 20. T3 from drop 1 (10% -> 60%).

**Chaos Arena** - 7 drops starting at tick 20. T3 escalates from 15% to 65%.

### Rubber Banding

In Chaos mode, players ranked 4th-5th get a 20% chance for their dropped item to upgrade one tier. Helps underdogs.

### Shield Mechanics

When an opponent-targeted item hits a shielded player:
1. Shield is consumed
2. 50% chance the item reflects back onto the attacker
3. Defender gets a free 3s Boost

Reflected Drain steals equity FROM the attacker and gives it to the shield holder.

---

## Other Systems

- **Airdrop Points Engine** - 4 pillars: Engagement, Skill, Volume, Community. Logarithmic volume scaling.
- **Quests & Referrals** - Daily/weekly quests, referral codes with bonus points
- **Chat** - Public, announcement, whisper, and game room channels
- **Battle Log** - Match history per player

---

## Settlement

Two-phase on-chain settlement via the escrow contract:

1. **Propose** - Backend submits match result to the contract
2. **Dispute window** - 10 Bitcoin blocks (~100 min) for disputes
3. **Finalize** - After the window, payouts are released

Chart seed is revealed to all players after the match for provable fairness verification. The seed + deterministic PRNG (mulberry32) means the entire chart + item drops can be independently verified.

---

## Setup

### 1. Install deps

```bash
cd chart-arena-backend && npm install
cd ../chart-arena-frontend && npm install
cd ../chart-arena-escrow && npm install
cd ../chart-arena-deploy && npm install
```

### 2. Configure environment

```bash
node setup-production.js
```

This generates a `SEED_SECRET` and prints the env block for `ecosystem.config.cjs`. Create the config file at the project root with the output.

Key env vars:

- `NETWORK` - `testnet` or `mainnet`
- `RPC_URL` - OPNet RPC endpoint
- `OPERATOR_MNEMONIC` - Operator wallet mnemonic
- `SEED_SECRET` - Secret for provable fairness RNG
- `ESCROW_ADDRESS` - Deployed escrow contract address
- `DEV_MODE` - `true` for local dev, `false` for production
- `ALLOWED_ORIGIN` - CORS origin for the frontend

### 3. Build and run

```bash
# Backend
cd chart-arena-backend
npm run build
# outputs to ./build (not ./dist)

# Frontend
cd chart-arena-frontend
npm run build
# outputs to ./dist

# Start everything
cd ..
pm2 start ecosystem.config.cjs
```

### 4. Deploy contract (if needed)

```bash
cd chart-arena-deploy
npm run build && npm start
```

## Deploy Workflow (VPS)

1. Upload changed files via WinSCP (no full zips)
2. `cd /root/chart-arena/chart-arena-backend && npm run build`
3. `cd /root/chart-arena && pm2 delete all && pm2 start ecosystem.config.cjs`

Backend `outDir` is `./build`, not `./dist`.

## Auth Flow

1. Player connects OPNet wallet via WalletConnect
2. Backend sends a nonce challenge
3. Player signs the nonce with their wallet key
4. Backend verifies signature against on-chain P2OP pubkey
5. Session token issued and persisted in SQLite

## Design

MechaFluffyPastelCute -- dark base (`#0d0b1a`), mecha panel frames, pastel accents (Sky, Mauve, Rose, Lime, Gold), scanline overlays, glassmorphism.
