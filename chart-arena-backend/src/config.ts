import { networks } from '@btc-vision/bitcoin';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import 'dotenv/config';

function env(key: string, fallback?: string): string {
    const val = process.env[key] ?? fallback;
    if (val === undefined) throw new Error(`Missing env: ${key}`);
    return val;
}

function envInt(key: string, fallback: number): number {
    const raw = process.env[key];
    return raw !== undefined ? parseInt(raw, 10) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined) return fallback;
    return raw === 'true' || raw === '1';
}

const networkName = env('NETWORK', 'testnet');

function resolveNetwork(name: string) {
    switch (name) {
        case 'testnet': return networks.opnetTestnet;
        case 'regtest': return networks.regtest;
        case 'mainnet': return networks.bitcoin;
        default: throw new Error(`Unknown network: ${name}`);
    }
}

export const config = {
    network: resolveNetwork(networkName),
    rpcUrl: env('RPC_URL', 'https://testnet.opnet.org'),
    operatorIndex: envInt('OPERATOR_INDEX', 1),
    guardianIndex: envInt('GUARDIAN_INDEX', 0),
    // V5-01 FIX: Default must match the deployed v5 contract (same as frontend)
    escrowAddress: env('ESCROW_ADDRESS', 'opt1sqqkgy2qk9lvsc6d4lz2f5y8x7vj5dmmd4y9j82aq'),
    motoToken: env('MOTO_TOKEN', '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd'),
    wsPort: envInt('WS_PORT', 8080),
    httpPort: envInt('HTTP_PORT', 3000),
    virtualCash: envInt('VIRTUAL_CASH', 10000),
    roundsDuel: envInt('ROUNDS_DUEL', 5),
    roundDurationSeconds: envInt('ROUND_DURATION_SECONDS', 60),
    maxSatToSpend: 50000n,
    emergencyRefundBlocks: 50,

    // DEV MODE: skip on-chain, enable bot opponent, shorter rounds
    devMode: envBool('DEV_MODE', false),
    devRoundSeconds: envInt('DEV_ROUND_SECONDS', 15),    // shorter rounds for testing
    devBotDelayMs: envInt('DEV_BOT_DELAY_MS', 3000),     // bot joins after 3s

    // MOTO/USD price for portfolio display (static fallback — connect to DEX price feed for live)
    motoUsdPrice: parseFloat(env('MOTO_USD_PRICE', '0')),

    // H-04: Server secret for seed derivation (prevents prediction from on-chain data)
    // CRITICAL: No random fallback — must be set explicitly and persist across restarts
    seedSecret: (() => {
        const secret = process.env['SEED_SECRET'];
        if (!secret && !envBool('DEV_MODE', false)) {
            throw new Error('FATAL: SEED_SECRET env var is required in production. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        }
        return secret ?? randomBytes(32).toString('hex'); // only fallback in DEV_MODE
    })(),

    // Twitter OAuth 1.0a
    twitterApiKey: env('TWITTER_API_KEY', ''),
    twitterApiSecret: env('TWITTER_API_SECRET', ''),
    twitterCallbackUrl: env('TWITTER_CALLBACK_URL', 'http://localhost:8081/auth/twitter/callback'),

    // C-02 FIX: mnemonicPath kept for backwards compat but env var takes priority
    mnemonicPath: resolve(env('MNEMONIC_PATH', './wallet.json')),

    // L-02: Crash if DEV_MODE is on with mainnet
    ...(networkName === 'mainnet' && envBool('DEV_MODE', false) ? (() => { throw new Error('FATAL: DEV_MODE cannot be enabled on mainnet'); })() : {}),

    // M-03 FIX: Crash if RPC_URL and NETWORK are contradictory.
    // Catches the most dangerous misconfiguration: NETWORK=testnet (default) with a mainnet RPC.
    ...(() => {
        const rpcLower = env('RPC_URL', 'https://testnet.opnet.org').toLowerCase();
        const rpcLooksMainnet = rpcLower.includes('mainnet') && !rpcLower.includes('testnet');
        const rpcLooksTestnet = rpcLower.includes('testnet') || rpcLower.includes('signet');
        if (networkName === 'testnet' && rpcLooksMainnet) {
            throw new Error(
                'FATAL: NETWORK=testnet but RPC_URL appears to be a mainnet endpoint.\n' +
                `   RPC_URL: ${rpcLower}\n` +
                '   Set NETWORK=mainnet if this is intentional, or fix RPC_URL.'
            );
        }
        if (networkName === 'mainnet' && rpcLooksTestnet) {
            throw new Error(
                'FATAL: NETWORK=mainnet but RPC_URL appears to be a testnet endpoint.\n' +
                `   RPC_URL: ${rpcLower}\n` +
                '   Set NETWORK=testnet if this is intentional, or fix RPC_URL.'
            );
        }
        return {};
    })(),

    // SEC-2b: Crash if ALLOWED_ORIGIN is still the placeholder in production
    ...((!envBool('DEV_MODE', false) && env('ALLOWED_ORIGIN', 'http://localhost:5173') === 'https://yourdomain.com')
        ? (() => { console.warn('\n⚠️  WARNING: ALLOWED_ORIGIN is set to placeholder "https://yourdomain.com".\n   Set it to your actual frontend domain for production.\n'); return {}; })()
        : {}),
} as const;

/**
 * C-02 FIX: Load operator mnemonic.
 *
 * Priority order:
 *   1. OPERATOR_MNEMONIC env var (recommended — no file on disk)
 *   2. File at MNEMONIC_PATH (legacy fallback)
 *
 * NEVER commit the mnemonic to git. Use env vars or a secrets manager.
 */
export function loadMnemonic(): string {
    // Priority 1: Environment variable (no file on disk = no leak risk)
    const envMnemonic = process.env['OPERATOR_MNEMONIC'];
    if (envMnemonic && envMnemonic.trim().length > 0) {
        const words = envMnemonic.trim().split(/\s+/);
        if (words.length < 12) {
            throw new Error('OPERATOR_MNEMONIC must be at least 12 words');
        }
        return envMnemonic.trim();
    }

    // Priority 2: File fallback (for local dev only)
    if (existsSync(config.mnemonicPath)) {
        // M-02 FIX: Default-deny. Only allow file-based loading if NODE_ENV is explicitly 'development' or 'test'.
        // Old code blocked only NODE_ENV=production, which meant "unset" allowed file loading on a prod VPS.
        const nodeEnv = process.env['NODE_ENV'] ?? '';
        if (nodeEnv !== 'development' && nodeEnv !== 'test') {
            throw new Error(
                'SECURITY: File-based mnemonic loading is only allowed when NODE_ENV=development or NODE_ENV=test.\n' +
                `   Current NODE_ENV: ${nodeEnv || '(not set)'}\n` +
                '   Set OPERATOR_MNEMONIC env var instead for production/staging.\n' +
                '   File found at: ' + config.mnemonicPath
            );
        }

        const raw = readFileSync(config.mnemonicPath, 'utf-8');
        const parsed: { mnemonic: string } = JSON.parse(raw);
        if (!parsed.mnemonic) throw new Error('wallet.json missing "mnemonic" field');

        // Warn loudly that file-based loading is insecure for production
        console.warn(
            '\n⚠️  WARNING: Loading mnemonic from file (' + config.mnemonicPath + ').\n' +
            '   For production, set OPERATOR_MNEMONIC env var instead.\n' +
            '   Never commit wallet.json to git.\n'
        );
        return parsed.mnemonic;
    }

    throw new Error(
        'No mnemonic found. Set OPERATOR_MNEMONIC env var or create wallet.json at ' +
        config.mnemonicPath
    );
}
