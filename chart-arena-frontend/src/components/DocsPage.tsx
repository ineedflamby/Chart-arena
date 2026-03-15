/**
 * DocsPage — Full documentation page for Chart Arena.
 *
 * Self-contained React component with all 8 doc sections merged.
 * Matches the cyberpunk angular "MechaFluffyPastelCute" design system.
 *
 * INTEGRATION:
 *   1. Copy this file to src/components/DocsPage.tsx
 *   2. In App.tsx, add state: const [showDocs, setShowDocs] = useState(false);
 *   3. In Footer.tsx, add a "Docs" link: onClick={() => setShowDocs(true)}
 *   4. In App.tsx render: {showDocs && <DocsPage onBack={() => setShowDocs(false)} />}
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import '../styles/docs.css';

interface DocsPageProps {
    onBack: () => void;
}

/* ═══════════════════════════════════════════
   SECTION DATA — all 8 docs merged
   ═══════════════════════════════════════════ */

interface DocSection {
    id: string;
    icon: string;
    title: string;
    color: string;
    subsections: { id: string; title: string; content: string }[];
}

const DOCS: DocSection[] = [
    {
        id: 'overview', icon: '⚡', title: 'Overview', color: '#92B4F4',
        subsections: [
            {
                id: 'what-is', title: 'What is Chart Arena?',
                content: `Chart Arena is a competitive PvP price prediction game built on Bitcoin L1 via OPNet smart contracts. Players bet MOTO tokens, predict BTC price movements over a chosen timeframe, and use strategic power-up items (Mario Kart-style) to sabotage opponents and secure wins.\n\nAll bets are escrowed on-chain. Every match is provably fair. Items add chaos. Skill wins.`
            },
            {
                id: 'tech-stack', title: 'Tech Stack',
                content: `• Smart Contract — AssemblyScript on OPNet (Bitcoin L1)\n• Backend — TypeScript, Node.js, WebSocket, SQLite\n• Frontend — React 18, Vite, TypeScript, @btc-vision/walletconnect\n• Auth — BIP-340 Schnorr signatures via OP_WALLET\n• Infra — Ubuntu VPS, PM2, nginx, Let's Encrypt TLS\n• Token — MOTO (OP-20 on OPNet, 18 decimals)`
            },
            {
                id: 'architecture', title: 'Architecture',
                content: `The system has three layers:\n\n① React Frontend — connects via WebSocket for real-time gameplay. Uses @btc-vision/walletconnect for OP_WALLET transaction signing.\n\n② Node.js Backend — WebSocket server (port 8080) + HTTP API (port 3001). Runs the game engine, matchmaking, settlement, and all game logic. Persists data to SQLite.\n\n③ OPNet Smart Contract — ChartArenaEscrow v4 on Bitcoin L1. Holds player buy-ins in escrow, distributes payouts after operator settlement, and provides emergency refund mechanisms.`
            },
        ]
    },
    {
        id: 'gameplay', icon: '🎮', title: 'Gameplay', color: '#82c4a0',
        subsections: [
            {
                id: 'modes', title: 'Game Modes',
                content: `Classic — The default skill-focused mode. Balanced volatility. Items start at tick 45. Classic Duel has NO Tier 3 items (pure skill).\n\nSurvival (Arena only) — Elimination mode with 2× internal leverage. Players at zero equity are eliminated. Extended to 300 ticks. Payouts go only to survivors.\n\nChaos — Maximum item mayhem. Items drop from tick 20 with T3 available immediately. 1.3× base volatility. The name says it all.`
            },
            {
                id: 'formats', title: 'Formats',
                content: `Duel (1v1) — Two players, winner takes 100% of the net pot. Fast and intense.\n\nArena (5 players) — Five-player free-for-all. Podium payouts: 1st 50% / 2nd 25% / 3rd 12% / 4th 7% / 5th 6%. Everyone gets something.`
            },
            {
                id: 'phases', title: 'Match Phases',
                content: `Every match runs at 1 tick/second through four phases:\n\nOPEN (tick 0–44) — Low volatility ×0.6. Positioning phase. Items not usable yet (except Chaos).\n\nMID (tick 45–164) — Core trading ×1.0. Items become usable. First drops happen.\n\nCRUNCH (tick 165–209) — Rising volatility ×1.5. Higher-tier item drops.\n\nOVERTIME (tick 210–239) — Maximum volatility ×2.0. Final push. Survival extends to tick 300.`
            },
            {
                id: 'trading', title: 'Trading Mechanics',
                content: `Starting state: $5.00 virtual equity, FLAT position.\n\nActions:\n• OPEN_LONG — Bet price goes up\n• OPEN_SHORT — Bet price goes down\n• CLOSE — Realize P&L, return to FLAT\n\nCooldowns: 5s min hold (open→close), 3s before reopening (close→open). During Earthquake: all cooldowns reduced to 1s.\n\nSlippage: 0.1% base on every trade. 0.5% when Frozen.\n\nFlat Penalty: Players staying FLAT too long lose equity. Classic Arena: $0.01/tick after 90s. Duel: $0.015/tick after 60s. Chaos: $0.02/tick after 60s. Survival: no penalty.`
            },
            {
                id: 'scoring', title: 'Scoring & Payouts',
                content: `Rake: 10% of total pot → 50% Treasury, 30% Prize Pool, 20% Jackpot.\n\nDuel: Winner takes 100% of net pot.\n\nArena: 1st 50% / 2nd 25% / 3rd 12% / 4th 7% / 5th 6%.\n\nSurvival: Distributed among survivors only. If 0 survive, last-eliminated takes all.\n\nJackpot: 0.5% chance per match to trigger. Random player wins the entire accumulated jackpot pool.`
            },
        ]
    },
    {
        id: 'items', icon: '🧊', title: 'Items', color: '#F4B8CE',
        subsections: [
            {
                id: 'tier1', title: 'Tier 1 — Trading Powers',
                content: `👻 Ghost Trade (8s) — Zero slippage + hidden position. Trade like a phantom.\n\n🛡 Shield (10s) — Block next attack. 50% reflect. Grants Boost on successful block.\n\n⚡ Scalp (3s) — Auto-trade: detects momentum, opens 3× leveraged position, auto-closes.\n\n📡 Radar (10s) — Reveal all positions, live equity, inventories. Breaks active Ghost Trade.\n\n🚀 Boost (12s) — Next trade ×1.5 returns (gains AND losses). Visible to opponents.`
            },
            {
                id: 'tier2', title: 'Tier 2 — Direct Attacks',
                content: `🧊 Freeze (5s) — Target can't open positions. Close at 5× slippage. FLAT targets bleed 1%/sec.\n\n🪞 Mirror Curse (8s) — Target sees inverted chart. Up appears as down.\n\n🩸 Drain (instant) — Steal 8% of target's equity.\n\n👾 Glitch (6s) — Target's chart freezes (stale data). Can still trade, but blind.\n\n🔄 Swap (instant) — Swap position direction AND entry price with target.`
            },
            {
                id: 'tier3', title: 'Tier 3 — Ultimates',
                content: `☢️ Nuke (instant) — Force-close ALL exposed players. Triggers 3–5% price drop (more victims = bigger drop).\n\n🌑 Blackout (6s) — Everyone else loses ALL UI. You get 2s price preview.\n\n🌋 Earthquake (8s) — Volatility ×5 for 8s. All cooldowns reduced to 1s.\n\n💰 Heist (instant) — Steal 10% equity from #1 ranked player.`
            },
            {
                id: 'drops', title: 'Drop Schedules',
                content: `Items drop at scheduled ticks with escalating tier rates:\n\nClassic Duel — 3 drops, NO T3 (pure skill)\nTick 45: T1 70% / T2 30% | Tick 120: 50/50 | Tick 180: T1 30% / T2 70%\n\nClassic Arena — 4 drops\nT3 escalates from 5% → 50%\n\nChaos Duel — 5 drops, T3 from drop 1\nT3 starts at 10%, reaches 60% by final drop\n\nChaos Arena — 7 drops, maximum chaos\nT3 from 15% → 65%\n\nSurvival Arena — 5 drops\nT3 escalates from 5% → 60%`
            },
        ]
    },
    {
        id: 'progression', icon: '📊', title: 'Progression', color: '#d4b978',
        subsections: [
            {
                id: 'buyin-tiers', title: 'Buy-In Tiers',
                content: `Three progressive stake levels:\n\n🥉 Bronze — 5 MOTO (always unlocked)\n🥈 Silver — 25 MOTO (unlocked after 5 matches)\n🥇 Gold — 100 MOTO (unlocked after 20 matches)\n\nQueue Collapse (auto-adjusts based on online count):\n1–2 players → Bronze Duel Classic only\n3–9 players → All tiers, Duel Classic only\n10–24 players → All tiers, Duel all modes + Arena Classic\n25+ players → Everything open`
            },
            {
                id: 'elo', title: 'ELO Rating System',
                content: `Standard ELO with adaptive K-factor:\n\n• New players (<30 matches): K = 40 (faster calibration)\n• Established players: K = 20 (stable)\n• Default ELO: 1000 | Floor: 100\n\nDuel: simple 1v1 update. Arena/Survival: multi-player pairwise comparison — each player compared against every other, K scaled by opponent count.`
            },
            {
                id: 'seasons', title: 'Seasons (28 days)',
                content: `Competitive seasons run on 28-day cycles.\n\nAt season end:\n1. Snapshot all ELO ratings\n2. Distribute rank bonuses (requires 10+ matches)\n3. Soft-reset ELO (pull 50% toward 1000)\n4. Create next season\n\nRank Bonuses:\n#1 Champion → 5,000 pts\n#2–5 Diamond → 3,000 pts\n#6–15 Platinum → 1,500 pts\n#16–50 Gold → 750 pts\n#51–100 Silver → 300 pts\nParticipated → 100 pts`
            },
            {
                id: 'ranks', title: 'Constellation Ranks',
                content: `15 volume-based cosmetic ranks determined by cumulative USD trading volume:\n\nNewcomers: Newcomer ($0) → Plancton ($50) → Shrimp ($100) → King Shrimp ($500) → Fish ($1K)\n\nDeep Sea: Glizzy Fish ($2.5K) → Baron Of Fish ($5K) → Shark ($10K) → Fine Shark ($25K) → ZkShark ($100K)\n\nApex: Whale ($250K) → Biggy Whale ($500K) → Ancient Whale ($750K) → White Whale ($1M) → Megalodon ($5M)`
            },
            {
                id: 'airdrop', title: 'Airdrop Points',
                content: `Points determine future airdrop allocation.\n\nVolume Points: min(800, 100 × log₁₀(totalVolumeUSD + 1))\nRecalculated after every match. Logarithmic scale rewards early growth.\n\nQuest Points: Awarded on milestone completion — play milestones (1/10/50 matches), win milestones (1/5/25 wins), volume milestones ($100/$1K/$10K), and social quests (Twitter, Discord, referrals).\n\nReferrals: Each player has a unique code. Referred players get 50 bonus points. Referrers earn 5% of referral quest earnings.`
            },
        ]
    },
    {
        id: 'smart-contract', icon: '🔗', title: 'Smart Contract', color: '#cc88ff',
        subsections: [
            {
                id: 'contract-overview', title: 'Overview',
                content: `ChartArenaEscrow v4 — AssemblyScript on OPNet (Bitcoin L1).\n\nDeployed at: opt1sqzzx6ertjlss49zq7me4xmfdwf6xmu4amvn3gp7e\n\nThe contract holds MOTO buy-ins in escrow during matches and distributes payouts after settlement. It uses a credit-balance pattern: payouts are credited internally, players call withdraw() to pull funds.\n\nKey design: Operator model — the backend settles matches, avoiding expensive on-chain game logic. Log hashes provide verifiable audit trails.`
            },
            {
                id: 'entry-points', title: 'Entry Points',
                content: `createMatch(buyIn, mode, format) → matchId\nCreates a match, escrows creator's buy-in via MOTO transferFrom.\n\njoinMatch(matchId) → bool\nJoins an open match, escrows joiner's buy-in. Auto-locks when full.\n\nsettleMatch(matchId, logHash, payouts) → bool [Operator only]\nDistributes net pot to players. Verifies payout sum == pot - rake.\n\ncancelMatch(matchId) → bool [Creator only]\nCancels an OPEN match, refunds all players.\n\ntriggerEmergencyRefund(matchId) → bool [Anyone]\nRefunds a LOCKED match after 50 blocks without settlement.\n\nwithdraw() → bool\nWithdraw accumulated balance (from settlements/refunds/jackpots).\n\ndistributeJackpot(winner) → bool [Operator only]\nDistributes entire jackpot pool to a winner.`
            },
            {
                id: 'settlement-flow', title: 'Settlement Flow',
                content: `1. Game ends → backend computes standings & payouts\n2. Backend verifies on-chain state (match LOCKED, mode/format/buyIn match)\n3. Backend checks payout sum == netPot (pot minus 10% rake)\n4. Backend calls settleMatch(matchId, logHash, payoutMap)\n5. Contract verifies all payout addresses are match participants\n6. Contract credits player balances, splits rake: 50% treasury, 30% prize pool, 20% jackpot\n7. Contract clears player→match mappings\n8. Players call withdraw() anytime to receive MOTO`
            },
            {
                id: 'contract-security', title: 'Security',
                content: `Reentrancy Guard — StoredU256-based lock that persists across cross-contract callbacks. Every state-modifying function acquires and releases the guard.\n\nToken Transfer Safety — Both _pullTokens and _pushTokens check return values. Empty data or explicit false reverts the transaction.\n\nLoop Bounds — All player-iteration loops capped at 5 (max Arena size).\n\nEmergency Refund — 50-block delay safety valve. Anyone can trigger after a locked match goes unsettled. Funds always recoverable.`
            },
        ]
    },
    {
        id: 'protocol', icon: '📡', title: 'Protocol', color: '#38b6ff',
        subsections: [
            {
                id: 'auth-flow', title: 'Authentication',
                content: `1. Connect WebSocket → server sends random 32-byte nonce (60s expiry)\n2. Client signs "ChartArena:auth:<nonce>" via MessageSigner.signMessageAuto()\n3. Server verifies BIP-340 Schnorr signature with x-only pubkey\n4. For OPNet P2OP addresses: pubkey verified against on-chain data (anti-impersonation)\n5. Server issues session token (SHA-256 hashed server-side, 7-day TTL)\n6. Future connections can use token_auth for instant resumption`
            },
            {
                id: 'ws-messages', title: 'WebSocket Messages',
                content: `Client → Server:\nauth, token_auth, queue, leave_queue, trade, use_item, report_match_id, chat_send, set_username, start_twitter_auth, get_profile, get_jackpot, get_quests, claim_quest, get_referral_stats, apply_referral, get_battle_log, get_leaderboard, get_online_count, get_tier_status, get_queue_availability, get_points_summary, get_season_info, get_elo_leaderboard\n\nServer → Client:\nnonce, auth_ok, error, lobby_update, match_created, match_join_ready, lobby_countdown, seed_reveal, game_start, game_reconnect, candle_update, trade_executed, trade_rejected, portfolio_update, item_drop, item_used, phase_change, elimination, game_end, settlement, profile_data, tier_status, queue_availability, online_count, and many more item effect messages`
            },
            {
                id: 'http-api', title: 'HTTP Endpoints',
                content: `GET /health — { status: "ok", uptime } — Health check\n\nGET /api/jackpot — { jackpot: "wei_amount" } — Current jackpot\n\nGET /api/matches/:id — Full match data (settled only, 403 for in-progress)\n\nGET /api/matches/:id/chart — Price tick history for a match\n\nGET /auth/twitter/callback — OAuth 1.0a callback (returns HTML popup)\n\nRate limited: 60 req/min per IP. CORS restricted to ALLOWED_ORIGIN.`
            },
        ]
    },
    {
        id: 'security', icon: '🔒', title: 'Security', color: '#e08a9f',
        subsections: [
            {
                id: 'auth-security', title: 'Auth Security',
                content: `BIP-340 Schnorr — Domain-separated signatures prevent cross-context replay. 60s nonce expiry. Untweaked + tweaked key verification.\n\nP2OP Verification — OPNet addresses verified against on-chain pubkey data via RPC.\n\nSession Tokens — SHA-256 hashed at rest. 7-day TTL. One token per address. Persisted to SQLite for server restart survival.\n\nDEV_MODE Safeguards — Fatal crash if DEV_MODE + mainnet. File-based mnemonic blocked in production. Loud logging on every bypass.`
            },
            {
                id: 'rate-limiting', title: 'Rate Limiting',
                content: `WebSocket: 15 msg/sec per connection. 60s auth timeout. 3s cooldown on expensive queries (leaderboard, profile, quests). 30s heartbeat with auto-terminate.\n\nHTTP: 60 req/min per IP. nginx: 30 req/min on /api/, 10 req/min on WS upgrade.\n\nChat: 1 message/sec, 200 char max, content sanitization.`
            },
            {
                id: 'provable-fairness', title: 'Provable Fairness',
                content: `Price curves generated from HMAC-SHA256(SEED_SECRET, matchSeed). The SEED_SECRET is server-side, persists across restarts, and prevents prediction from on-chain data.\n\nBefore game: SHA-256 commitment hash broadcast.\nAfter game: raw seed revealed for verification.\n\nItem drops use seeded PRNG — deterministic and verifiable post-match.`
            },
            {
                id: 'audit-summary', title: 'Audit Summary',
                content: `4 audit passes identified and fixed 64+ issues:\n\nCritical: Reentrancy guard persistence, P2OP impersonation, file-based mnemonic in prod, ephemeral seed secret.\n\nHigh: Silent token transfer failures, player stuck after settlement, DEV_MODE on mainnet, cross-match trade injection, raw session token storage, zombie WebSocket connections.\n\nMedium: Double-settle race condition, session tokens lost on restart, HTTP rate limiting, WS flood prevention, Drain negative equity bug, duplicated post-settlement logic.`
            },
        ]
    },
    {
        id: 'deployment', icon: '🚀', title: 'Roadmap to Mainnet', color: '#6dd5a0',
        subsections: [
            {
                id: 'current-status', title: 'Current Status — Testnet Live',
                content: `Chart Arena is currently deployed on OPNet testnet at chart-arena.online.\n\n✅ Core game engine — 3 modes, 2 formats, 14 items, full tick-based loop\n✅ On-chain escrow — ChartArenaEscrow v4 deployed on testnet\n✅ BIP-340 wallet auth — Schnorr signatures via OP_WALLET, P2OP verification\n✅ Session resumption — SHA-256 hashed tokens, persisted to SQLite\n✅ Security hardening — 4 audit passes, 64+ issues fixed\n✅ ELO system — Adaptive K-factor, pairwise Arena comparison\n✅ Season system — 28-day cycles with rank bonuses\n✅ Airdrop points engine — Volume + quest points\n✅ Buy-in tiers — Bronze/Silver/Gold with progressive unlocks\n✅ Queue collapse — Auto-adjusts modes by online count\n✅ Rate limiting — WS, HTTP, and nginx layers\n✅ Infrastructure — VPS + PM2 + nginx + TLS`
            },
            {
                id: 'phase1', title: 'Phase 1 — Price Feed & Contract (1-2 weeks)',
                content: `This is the single biggest blocker. MOTO/USD price is currently hardcoded — needs a live DEX feed for real portfolio valuation.\n\n□ Build services/price-feed.ts — Query MotoSwap MOTO/WBTC pool reserves via getReserves() every ~5 seconds\n□ Calculate live price: reserveWBTC / reserveMOTO × BTC_USD\n□ Broadcast MOTO_PRICE to all clients on each update\n□ Add fallback: keep last known price if RPC fails (never reset to 0)\n□ Deploy ChartArenaEscrow v4 on mainnet — fresh contract with mainnet operator/treasury/prizePool addresses\n□ Verify MOTO_TOKEN contract hash on mainnet\n□ Update ESCROW_ADDRESS and MOTO_TOKEN in ecosystem.config.cjs + frontend constants\n□ End-to-end test: createMatch → joinMatch → settleMatch on mainnet contract`
            },
            {
                id: 'phase2', title: 'Phase 2 — Config & Credentials (2-3 days)',
                content: `Switch all environment config from testnet to mainnet. Zero code changes, just ops.\n\n□ Generate fresh OPERATOR_MNEMONIC (24-word BIP-39) — store in secure env, never in git\n□ Generate fresh SEED_SECRET — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\n□ Set DEV_MODE=false in ecosystem.config.cjs\n□ Set NETWORK=mainnet\n□ Set RPC_URL=https://mainnet.opnet.org\n□ Set ALLOWED_ORIGIN=https://chart-arena.online\n□ Update TWITTER_CALLBACK_URL to production domain\n□ Fund operator wallet with BTC for gas + MOTO for initial jackpot seed\n□ Verify mainnet block guard works (DEV_MODE + mainnet = fatal crash)`
            },
            {
                id: 'phase3', title: 'Phase 3 — Frontend Build & Test (3-5 days)',
                content: `Rebuild frontend against mainnet config and do full playtesting.\n\n□ Set VITE_RPC_URL to mainnet RPC\n□ Set VITE_ESCROW to mainnet contract address\n□ Set VITE_MOTO to mainnet token hash\n□ npm run build — fresh production bundle\n□ Playtest: full match flow with real MOTO on mainnet (Bronze tier minimum)\n□ Verify wallet approval flow (MOTO allowance → createMatch → joinMatch)\n□ Verify settlement TX lands on-chain and payouts credit correctly\n□ Test emergency refund after 50 blocks with no settlement\n□ Test session token resumption across browser restart\n□ Test reconnection mid-match (close tab, reopen, verify game_reconnect)`
            },
            {
                id: 'phase4', title: 'Phase 4 — Solo Testing Mode (2-3 days)',
                content: `Currently, testing on mainnet requires a second player. The TESTNET_BOT_FILL flag enables solo testing without reverting to DEV_MODE.\n\n□ Implement TESTNET_BOT_FILL env flag — when true, bots fill remaining slots after a timeout (like DEV_MODE) but all on-chain operations still execute normally\n□ This lets you test real on-chain create → join → settle flow alone\n□ Bots use the operator wallet to sign joinMatch TXs\n□ Disable in production: TESTNET_BOT_FILL must be false when real players are expected\n□ Run full mainnet test cycle: queue → bot joins → game plays → settlement → withdraw`
            },
            {
                id: 'phase5', title: 'Phase 5 — Monitoring & Safety Nets (3-5 days)',
                content: `Production-grade observability before real money is at stake.\n\n□ Health check monitoring — external pinger on /api/health, alert on failure\n□ Settlement watchdog — alert if any match stays LOCKED > 30 blocks without settlement\n□ Balance reconciliation — periodic check that contract balances match expected state\n□ Jackpot monitoring — log and alert on jackpot distributions\n□ Database backup cron — daily SQLite backup to offsite storage\n□ Log rotation — ensure /var/log/chart-arena/ doesn't fill disk\n□ PM2 cluster mode evaluation — assess if single instance handles expected load\n□ Set up UptimeRobot or similar for chart-arena.online availability alerts\n□ Emergency playbook — document steps to pause matchmaking, trigger refunds, rotate operator wallet`
            },
            {
                id: 'phase6', title: 'Phase 6 — Launch Sequence',
                content: `Final pre-launch checklist when everything above is green.\n\n□ Audit trail verified — settlements.jsonl recording correctly on mainnet\n□ Fresh database (or verified migration from testnet — usually fresh is safer)\n□ Queue collapse thresholds reviewed for launch-day player count\n□ Announcement prepared — Twitter, Discord, community channels\n□ Start with Bronze tier only (5 MOTO) for the first 48 hours\n□ Monitor settlement success rate — must be 100% before opening Silver/Gold\n□ Disable TESTNET_BOT_FILL\n□ Watch first 10 matches end-to-end: queue → game → settle → withdraw\n□ Open Silver tier after 48h if stable, Gold after 1 week\n□ 🎮 Chart Arena is live on mainnet`
            },
            {
                id: 'future', title: 'Post-Launch Roadmap',
                content: `Features planned after stable mainnet launch:\n\n• Tournament mode — Bracket-style elimination tournaments with larger prize pools\n• Spectator mode — Watch live matches without playing\n• Replay system — Full match replay with trade-by-trade breakdown\n• Mobile-optimized UI — Dedicated mobile layout with swipe-to-trade\n• Additional token pairs — Support for other OP-20 tokens beyond MOTO\n• On-chain dispute resolution — Two-phase settlement (propose → 10-block dispute window → finalize) for trustless verification\n• Multi-server scaling — Horizontal backend scaling for 1000+ concurrent players\n• Achievement system — Persistent badges and titles (First Blood, Megalodon, etc.)\n• Custom match rooms — Private matches with invite codes`
            },
        ]
    },
];

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */

export function DocsPage({ onBack }: DocsPageProps) {
    const [activeSection, setActiveSection] = useState(DOCS[0].id);
    const [activeSubsection, setActiveSubsection] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    const currentDoc = DOCS.find(d => d.id === activeSection) ?? DOCS[0];

    // Filter subsections by search
    const filteredDocs = useMemo(() => {
        if (!searchQuery.trim()) return DOCS;
        const q = searchQuery.toLowerCase();
        return DOCS.map(doc => ({
            ...doc,
            subsections: doc.subsections.filter(
                s => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
            ),
        })).filter(doc => doc.subsections.length > 0);
    }, [searchQuery]);

    // Scroll to top on section change
    useEffect(() => {
        contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        setActiveSubsection(null);
    }, [activeSection]);

    // Scroll to subsection
    useEffect(() => {
        if (activeSubsection) {
            const el = document.getElementById(`doc-${activeSubsection}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [activeSubsection]);

    const navigateTo = (sectionId: string, subId?: string) => {
        setActiveSection(sectionId);
        if (subId) setTimeout(() => setActiveSubsection(subId), 100);
        setSidebarOpen(false);
    };

    return (
        <div style={styles.root} className="docs-page">
            {/* Scanlines */}
            <div style={styles.scanlines} />

            {/* ── HEADER BAR ── */}
            <header style={styles.header}>
                <button onClick={onBack} style={styles.backBtn}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(146,180,244,0.25)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.boxShadow = '0 0 20px rgba(146,180,244,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(146,180,244,0.12)'; e.currentTarget.style.color = '#92B4F4'; e.currentTarget.style.boxShadow = '0 0 12px rgba(146,180,244,0.1)'; }}
                >
                    ← BACK TO ARENA
                </button>
                <div style={styles.headerTitle} className="docs-header-title">
                    <span style={{ color: '#92B4F4' }}>CHART</span>
                    <span style={{ color: '#d4b978', margin: '0 3px' }}>⚡</span>
                    <span style={{ color: '#F4B8CE' }}>ARENA</span>
                    <span style={{ color: '#4a4668', margin: '0 8px' }}>·</span>
                    <span style={{ color: '#a09abc' }}>DOCS</span>
                </div>
                <button onClick={() => setSidebarOpen(o => !o)} style={styles.menuBtn} className="docs-menu-btn">
                    {sidebarOpen ? '✕' : '☰'}
                </button>
            </header>

            <div style={styles.body}>
                {/* ── SIDEBAR ── */}
                <nav style={{
                    ...styles.sidebar,
                }} className={`docs-sidebar${sidebarOpen ? ' open' : ''}`}>
                    {/* Search */}
                    <div style={styles.searchWrap}>
                        <input
                            type="text"
                            placeholder="Search docs..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            style={styles.searchInput}
                            className="docs-search"
                        />
                    </div>

                    <div style={styles.navList}>
                        {(searchQuery ? filteredDocs : DOCS).map(doc => (
                            <div key={doc.id}>
                                <button
                                    onClick={() => navigateTo(doc.id)}
                                    style={{
                                        ...styles.navItem,
                                        ...(activeSection === doc.id ? {
                                            background: 'rgba(146,180,244,0.08)',
                                            borderColor: doc.color + '55',
                                            color: doc.color,
                                        } : {}),
                                    }}
                                    onMouseEnter={e => { if (activeSection !== doc.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                                    onMouseLeave={e => { if (activeSection !== doc.id) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span style={{ fontSize: '1rem' }}>{doc.icon}</span>
                                    <span style={styles.navItemText}>{doc.title}</span>
                                    {activeSection === doc.id && <span style={{
                                        width: 4, height: 4, borderRadius: '50%',
                                        background: doc.color,
                                        boxShadow: `0 0 8px ${doc.color}`,
                                        marginLeft: 'auto',
                                    }} />}
                                </button>
                                {/* Sub-nav when active */}
                                {activeSection === doc.id && (
                                    <div style={styles.subNav}>
                                        {doc.subsections.map(sub => (
                                            <button
                                                key={sub.id}
                                                onClick={() => navigateTo(doc.id, sub.id)}
                                                style={{
                                                    ...styles.subNavItem,
                                                    ...(activeSubsection === sub.id ? {
                                                        color: doc.color,
                                                        borderLeftColor: doc.color,
                                                    } : {}),
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.color = doc.color; }}
                                                onMouseLeave={e => { if (activeSubsection !== sub.id) e.currentTarget.style.color = '#6b6590'; }}
                                            >
                                                {sub.title}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </nav>

                {/* ── CONTENT ── */}
                <main ref={contentRef} style={styles.content} className="docs-content">
                    {/* Section header */}
                    <div style={styles.sectionHeader}>
                        <span style={{ fontSize: '2.2rem' }}>{currentDoc.icon}</span>
                        <h1 style={{ ...styles.sectionTitle, color: currentDoc.color }} className="docs-section-title">
                            {currentDoc.title}
                        </h1>
                        <div style={{ ...styles.sectionLine, background: `linear-gradient(90deg, ${currentDoc.color}40, transparent)` }} />
                    </div>

                    {/* Subsections */}
                    {currentDoc.subsections.map((sub, i) => (
                        <article key={sub.id} id={`doc-${sub.id}`} style={{
                            ...styles.card,
                            animationDelay: `${i * 0.07}s`,
                        }} className="docs-card">
                            {/* Card top accent */}
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                                background: `linear-gradient(90deg, transparent 5%, ${currentDoc.color}66, transparent 95%)`,
                            }} />
                            <h2 style={styles.cardTitle}>
                                <span style={{
                                    width: 5, height: 5, borderRadius: '50%',
                                    background: currentDoc.color,
                                    boxShadow: `0 0 8px ${currentDoc.color}, 0 0 16px ${currentDoc.color}55`,
                                    flexShrink: 0,
                                }} />
                                {sub.title}
                            </h2>
                            <div style={styles.cardContent}>
                                {sub.content.split('\n\n').map((para, pi) => (
                                    <p key={pi} style={styles.paragraph}>
                                        {para.split('\n').map((line, li) => (
                                            <span key={li}>
                                                {renderLine(line, currentDoc.color)}
                                                {li < para.split('\n').length - 1 && <br />}
                                            </span>
                                        ))}
                                    </p>
                                ))}
                            </div>
                        </article>
                    ))}

                    {/* Bottom spacer */}
                    <div style={{ height: 80 }} />
                </main>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════
   TEXT RENDERER — highlights special patterns
   ═══════════════════════════════════════════ */

function renderLine(line: string, accentColor: string): React.ReactNode {
    // Highlight lines starting with • or □ or numbered patterns
    if (line.startsWith('• ') || line.startsWith('□ ')) {
        const bullet = line[0];
        const rest = line.slice(2);
        return <>
            <span style={{ color: accentColor, fontWeight: 700 }}>{bullet} </span>
            {highlightDash(rest, accentColor)}
        </>;
    }
    // Lines starting with emoji (item descriptions)
    if (/^[\u{1F000}-\u{1FFFF}]/u.test(line) || /^[☢️🌑🌋💰👻🛡⚡📡🚀🧊🪞🩸👾🔄]/.test(line)) {
        const dashIdx = line.indexOf(' — ');
        if (dashIdx !== -1) {
            return <>
                <span style={{ fontWeight: 700, color: '#e0d8f0' }}>{line.slice(0, dashIdx)}</span>
                <span style={{ color: accentColor }}> — </span>
                <span style={{ color: '#a09abc' }}>{line.slice(dashIdx + 3)}</span>
            </>;
        }
    }
    // Lines with numbered steps (1. / 2. etc)
    if (/^[①②③④⑤⑥⑦⑧]\s/.test(line) || /^\d+\.\s/.test(line)) {
        const match = line.match(/^([①②③④⑤⑥⑦⑧]|\d+\.)\s(.*)$/);
        if (match) {
            return <>
                <span style={{ color: accentColor, fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif" }}>{match[1]} </span>
                {highlightDash(match[2], accentColor)}
            </>;
        }
    }
    // Highlight labels before —
    return highlightDash(line, accentColor);
}

function highlightDash(text: string, accentColor: string): React.ReactNode {
    const dashIdx = text.indexOf(' — ');
    if (dashIdx !== -1 && dashIdx < 50) {
        return <>
            <span style={{ fontWeight: 700, color: '#e0d8f0' }}>{text.slice(0, dashIdx)}</span>
            <span style={{ color: accentColor + 'aa' }}> — </span>
            <span>{text.slice(dashIdx + 3)}</span>
        </>;
    }
    return <>{text}</>;
}

/* ═══════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════ */

const styles: Record<string, React.CSSProperties> = {
    root: {
        position: 'fixed', inset: 0, zIndex: 200,
        background: '#0b0a14',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'IBM Plex Mono', monospace",
        color: '#a09abc',
    },
    scanlines: {
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999,
        opacity: 0.015,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(146,180,244,0.1) 2px, rgba(146,180,244,0.1) 4px)',
    },
    header: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px',
        background: 'rgba(11,10,20,0.97)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(146,180,244,0.08)',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 16px rgba(0,0,0,0.6)',
        flexShrink: 0,
    },
    headerTitle: {
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '1.1rem',
        letterSpacing: '0.04em',
    },
    backBtn: {
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '0.8rem',
        padding: '8px 22px',
        border: '1.5px solid rgba(146,180,244,0.4)',
        background: 'rgba(146,180,244,0.12)',
        color: '#92B4F4',
        cursor: 'pointer',
        transition: 'all 0.2s',
        clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        boxShadow: '0 0 12px rgba(146,180,244,0.1)',
    },
    menuBtn: {
        display: 'none', // visible on mobile via media query workaround below
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '1.2rem',
        padding: '4px 10px',
        border: '1px solid rgba(146,180,244,0.15)',
        background: 'rgba(146,180,244,0.05)',
        color: '#92B4F4',
        cursor: 'pointer',
    },
    body: {
        display: 'flex', flex: 1, overflow: 'hidden',
    },
    sidebar: {
        width: 260, flexShrink: 0,
        background: 'rgba(14,13,22,0.95)',
        borderRight: '1px solid rgba(146,180,244,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
    },
    sidebarOpen: {},
    searchWrap: {
        padding: '12px 12px 8px',
        borderBottom: '1px solid rgba(146,180,244,0.05)',
    },
    searchInput: {
        width: '100%',
        padding: '7px 10px',
        border: '1px solid rgba(146,180,244,0.1)',
        background: 'rgba(255,255,255,0.015)',
        color: '#e0d8f0',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '0.72rem',
        outline: 'none',
        clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
    },
    navList: {
        flex: 1, overflowY: 'auto', padding: '8px 0',
    },
    navItem: {
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 14px',
        border: 'none', borderLeft: '2px solid transparent',
        background: 'transparent',
        color: '#6b6590',
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '0.78rem',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        textAlign: 'left' as const,
    },
    navItemText: { flex: 1 },
    subNav: {
        paddingLeft: 28, paddingBottom: 4,
    },
    subNavItem: {
        display: 'block', width: '100%',
        padding: '5px 12px',
        border: 'none', borderLeft: '1px solid rgba(146,180,244,0.08)',
        background: 'transparent',
        color: '#6b6590',
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '0.68rem',
        textAlign: 'left' as const,
        lineHeight: 1.5,
    },
    content: {
        flex: 1, overflowY: 'auto', padding: '28px 36px',
        background: 'radial-gradient(ellipse at 20% 0%, rgba(146,180,244,0.02) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(244,184,206,0.015) 0%, transparent 50%)',
    },
    sectionHeader: {
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 28, flexWrap: 'wrap' as const,
    },
    sectionTitle: {
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '1.8rem',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        margin: 0,
    },
    sectionLine: {
        flex: 1, height: 1, minWidth: 40,
    },
    card: {
        position: 'relative' as const,
        background: 'rgba(14,13,22,0.7)',
        border: '1px solid rgba(146,180,244,0.06)',
        padding: '20px 24px',
        marginBottom: 16,
        clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        animation: 'slideUp 0.4s ease-out both',
    },
    cardTitle: {
        fontFamily: "'Chakra Petch', sans-serif",
        fontWeight: 700, fontSize: '0.95rem',
        color: '#e0d8f0',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        margin: '0 0 14px 0',
        display: 'flex', alignItems: 'center', gap: 10,
    },
    cardContent: {
        fontSize: '0.78rem',
        lineHeight: 1.75,
        color: '#a09abc',
    },
    paragraph: {
        margin: '0 0 12px 0',
    },
};

export default DocsPage;
