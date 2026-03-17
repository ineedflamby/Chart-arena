import { config } from './config.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { operatorWallet } from './services/operator-wallet.js';
import { guardianWallet } from './services/guardian-wallet.js';
import { contractService } from './services/contract.js';
import { db } from './db/database.js';
import { startWSServer, setMessageHandler, setDisconnectHandler, sendToPlayer, broadcastToAll, getAuthenticatedCount } from './ws/server.js';
import { handleMessage } from './ws/handlers.js';
import { getGame } from './game/game-loop.js';
import { logger } from './utils/logger.js';
import { handleTwitterCallback } from './services/twitter-auth.js';
import { ServerMsg } from './utils/constants.js';
import { loadSettledMatches, reconcilePendingSettlements, startSettlementConfirmationPoller } from './services/settlement.js';
import { startDailyCron, stopDailyCron } from './services/daily-reset.js';
import { startSettlementWatchdog } from './services/matchmaking.js';
import { initSessionTokens } from './ws/auth.js';

const TAG = 'Main';

/** Generates a simple HTML page for the Twitter OAuth callback popup */
function callbackPage(title: string, message: string, success: boolean): string {
    const color = success ? '#43e97b' : '#ff6b8a';
    const emoji = success ? '✅' : '❌';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chart Arena — ${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Nunito',system-ui,sans-serif;background:linear-gradient(135deg,#faf5ff,#f0e6ff);display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:24px;padding:40px;text-align:center;box-shadow:0 20px 60px rgba(176,136,249,0.15);max-width:380px;border:1.5px solid rgba(176,136,249,0.1)}
h1{font-size:1.6rem;color:#2d1b69;margin:12px 0 8px}p{color:#6b5b95;font-size:0.9rem;line-height:1.5}
.emoji{font-size:3rem}.status{display:inline-block;padding:4px 16px;border-radius:20px;font-size:0.75rem;font-weight:700;margin-top:16px;color:${color};background:${color}15;border:1.5px solid ${color}30}
</style></head><body><div class="card">
<div class="emoji">${emoji}</div><h1>${title}</h1><p>${message}</p>
<div class="status">${success ? 'SUCCESS' : 'FAILED'}</div>
${success ? '<script>setTimeout(()=>window.close(),2000)</script>' : ''}
</div></body></html>`;
}

async function main(): Promise<void> {
    logger.info(TAG, '=== Chart Arena Backend ===');
    logger.info(TAG, `Network: ${config.rpcUrl}`);
    if (config.devMode) {
        logger.warn(TAG, '⚠️  DEV_MODE ENABLED — no on-chain txs, bot opponent, shorter rounds');
        logger.info(TAG, `   Rounds: ${config.roundsDuel} × ${config.devRoundSeconds}s = ${config.roundsDuel * config.devRoundSeconds}s total`);
    }

    db.init();
    loadSettledMatches();
    initSessionTokens();  // L-01: Load persisted session tokens from DB
    operatorWallet.init();
    guardianWallet.init();
    await contractService.init();

    try {
        const jackpot = await contractService.getJackpot();
        logger.info(TAG, `Contract verified — jackpot: ${jackpot}`);
    } catch (err) {
        logger.error(TAG, 'Failed to read contract — check address and RPC', err);
        if (!config.devMode) process.exit(1);
        logger.warn(TAG, 'DEV_MODE: Continuing despite contract read failure');
    }

    // H-02 FIX: Reconcile pending settlements against on-chain state (requires contractService)
    try {
        await reconcilePendingSettlements();
    } catch (err) {
        logger.error(TAG, 'Settlement reconciliation failed — continuing', err);
    }

    // C-03 FIX: Start background poller to confirm pending off-chain payouts
    startSettlementConfirmationPoller();

    // V5-05 FIX: Log operator wallet address and remind to keep funded
    logger.info(TAG, `Operator wallet: ${operatorWallet.p2tr}`);
    if (guardianWallet.enabled) {
        logger.info(TAG, `Guardian wallet: ${guardianWallet.p2tr}`);
    }
    if (!config.devMode) {
        logger.info(TAG, '━━━ IMPORTANT: Both wallets must have tBTC for gas ━━━');
        logger.info(TAG, `Operator: ${operatorWallet.p2tr}`);
        if (guardianWallet.enabled) {
            logger.info(TAG, `Guardian: ${guardianWallet.p2tr}`);
        }
        logger.info(TAG, `Max sat per TX: ${config.maxSatToSpend}`);
    }

    setMessageHandler(handleMessage);
    setDisconnectHandler((address, matchId) => {
        const game = getGame(BigInt(matchId));
        if (game) game.markDisconnected(address);
    });
    startWSServer();

    // Start daily cron (season checks, Sunday decay)
    startDailyCron();

    // H-04 FIX: Start settlement retry watchdog (retries failed settlements before refund deadline)
    startSettlementWatchdog();

    // P2 FIX: Operator wallet balance monitoring
    if (!config.devMode) {
        const LOW_BALANCE_SATS = 50000;
        const checkBalance = async () => {
            try {
                // Simple check: try to get block number. If this fails, RPC is down.
                const blockNum = await contractService.getBlockNumber();
                logger.debug(TAG, `Operator health check OK — block ${blockNum}`);
            } catch (err) {
                logger.error(TAG, `🚨 RPC health check FAILED — operator TXs may not work: ${err}`);
            }
        };
        setTimeout(checkBalance, 30_000);
        setInterval(checkBalance, 10 * 60 * 1000); // every 10 min
    }

    // Broadcast online count every 15 seconds to all connected clients
    setInterval(() => {
        broadcastToAll(ServerMsg.ONLINE_COUNT, { count: getAuthenticatedCount() });
    }, 15_000);

    // HIGH-2 FIX: Use config.httpPort (was hardcoded to wsPort + 1, ignoring HTTP_PORT env var)
    const httpPort = config.httpPort;
    // SEC-3 FIX: Simple IP-based rate limiter for HTTP API (60 requests/min per IP)
    const httpRateLimit = new Map<string, { count: number; windowStart: number }>();
    const HTTP_RATE_LIMIT = 60;
    const HTTP_RATE_WINDOW_MS = 60_000;

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const ALLOWED_ORIGIN = process.env['ALLOWED_ORIGIN'] ?? 'http://localhost:5173';
        res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        // SEC-3: Rate limit check
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const rl = httpRateLimit.get(clientIp);
        if (rl && now - rl.windowStart < HTTP_RATE_WINDOW_MS) {
            rl.count++;
            if (rl.count > HTTP_RATE_LIMIT) {
                res.writeHead(429);
                res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
                return;
            }
        } else {
            httpRateLimit.set(clientIp, { count: 1, windowStart: now });
        }

        const url = req.url ?? '';

        // GET /api/matches/:matchId
        const matchRoute = url.match(/^\/api\/matches\/(\d+)$/);
        if (matchRoute) {
            const matchId = BigInt(matchRoute[1]);
            const game = getGame(matchId);
            // H-02 FIX: Only serve finished matches (from DB), not live ones
            if (game && game.match.status !== 'settled' && game.match.status !== 'error') {
                res.writeHead(403); res.end(JSON.stringify({ error: 'Match in progress' })); return;
            }
            if (!game) { res.writeHead(404); res.end(JSON.stringify({ error: 'Match not found' })); return; }
            const m = game.match;
            const players: string[] = [];
            for (const [addr] of m.players) players.push(addr);
            res.writeHead(200);
            res.end(JSON.stringify({
                matchId: m.matchId.toString(), seed: m.seed.toString(),
                mode: m.mode, format: m.format, buyIn: m.buyIn.toString(),
                status: m.status, currentTick: m.currentTick, currentPhase: m.currentPhase,
                players, trades: m.trades, events: m.events,
                standings: game.getStandings(),
            }));
            return;
        }

        // GET /api/matches/:matchId/chart
        const chartRoute = url.match(/^\/api\/matches\/(\d+)\/chart$/);
        if (chartRoute) {
            const matchId = BigInt(chartRoute[1]);
            const game = getGame(matchId);
            // H-02 FIX: Only serve finished matches (from DB), not live ones
            if (game && game.match.status !== 'settled' && game.match.status !== 'error') {
                res.writeHead(403); res.end(JSON.stringify({ error: 'Match in progress' })); return;
            }
            if (!game) { res.writeHead(404); res.end(JSON.stringify({ error: 'Match not found' })); return; }
            res.writeHead(200);
            res.end(JSON.stringify({ priceTicks: game.match.priceTicks }));
            return;
        }

        // L-06: Health check endpoint
        if (url === "/health" || url === "/api/health") {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
            return;
        }
        // GET /api/jackpot
        if (url === '/api/jackpot') {
            try {
                const jackpot = config.devMode
                    ? '50000000000000000000'  // 50 MOTO in dev
                    : (await contractService.getJackpot()).toString();
                res.writeHead(200);
                res.end(JSON.stringify({ jackpot }));
            } catch (err) {
                logger.error(TAG, 'Failed to read jackpot from chain', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to read jackpot' }));
            }
            return;
        }

        // GET /auth/twitter/callback?oauth_token=X&oauth_verifier=Y
        if (url.startsWith('/auth/twitter/callback')) {
            res.setHeader('Content-Type', 'text/html');
            const params = new URL(url, `http://localhost`).searchParams;
            const oauthToken = params.get('oauth_token');
            const oauthVerifier = params.get('oauth_verifier');

            if (!oauthToken || !oauthVerifier) {
                res.writeHead(400);
                res.end(callbackPage('Auth failed', 'Missing parameters from Twitter.', false));
                return;
            }

            try {
                const result = await handleTwitterCallback(oauthToken, oauthVerifier);
                if (!result) {
                    res.writeHead(400);
                    res.end(callbackPage('Auth failed', 'Session expired — try again.', false));
                    return;
                }

                // Save profile: username = twitter screen_name
                const ok = db.setProfile(result.address, result.screenName, result.screenName);
                if (!ok) {
                    // Username might be taken — add numbers
                    const fallback = result.screenName + '_' + Math.floor(Math.random() * 999);
                    db.setProfile(result.address, fallback, result.screenName);
                    result.screenName = fallback;
                }

                // Notify the player's WS connection
                sendToPlayer(result.address, ServerMsg.PROFILE_READY, {
                    address: result.address,
                    displayName: result.screenName,
                    twitterHandle: result.screenName,
                });

                logger.info('TwitterCallback', `Saved profile for ${result.address}: @${result.screenName}`);
                res.writeHead(200);
                res.end(callbackPage('Connected!', `Welcome @${result.screenName}! You can close this window.`, true));
            } catch (err) {
                logger.error('TwitterCallback', 'Callback failed', err);
                res.writeHead(500);
                res.end(callbackPage('Auth failed', 'Something went wrong — try again.', false));
            }
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    });
    httpServer.listen(httpPort, () => {
        logger.info(TAG, `HTTP API listening on port ${httpPort}`);
    });

    // SEC-3: Clean up stale rate limit entries every 2 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, rl] of httpRateLimit) {
            if (now - rl.windowStart > HTTP_RATE_WINDOW_MS * 2) httpRateLimit.delete(ip);
        }
    }, 120_000);

    logger.info(TAG, 'Backend ready. Waiting for players...');

    const shutdown = (): void => {
        logger.info(TAG, 'Shutting down...');
        stopDailyCron();
        // MED-3 FIX: Close HTTP server gracefully (drains active connections)
        httpServer.close(() => logger.info(TAG, 'HTTP server closed'));
        contractService.close();
        db.close();
        // Give in-flight requests 3s to finish
        setTimeout(() => process.exit(0), 3000);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // PROD-03 FIX: Catch unhandled promise rejections and uncaught exceptions
    process.on('unhandledRejection', (err) => {
        logger.error(TAG, 'Unhandled promise rejection', err);
    });
    process.on('uncaughtException', (err) => {
        logger.error(TAG, 'Uncaught exception — shutting down', err);
        shutdown();
    });
}

main().catch((err) => {
    logger.error(TAG, 'Fatal startup error', err);
    process.exit(1);
});
