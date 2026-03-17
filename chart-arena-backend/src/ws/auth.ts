/**
 * WebSocket Authentication — BIP-340 Schnorr Verification (FIXED).
 *
 * Flow:
 *   1. Server sends nonce on connect
 *   2. Client signs domain-separated message via MessageSigner.signMessageAuto()
 *      → OP_WALLET internally: sha256(utf8(message)) → signSchnorr(hashHex)
 *   3. Server verifies with MessageSigner.verifySignature(pubkey, message, sig)
 *      → internally: sha256(utf8(message)) → verifySchnorr(hash, xOnlyKey, sig)
 *
 * CRITICAL FIX: The old frontend called walletInstance.signMessage(message) which
 * produces a BIP-322 / ECDSA signature (NOT BIP-340 Schnorr). The backend expected
 * BIP-340 → always failed.  The fixed frontend uses MessageSigner.signMessageAuto()
 * which calls OP_WALLET's signSchnorr() under the hood.
 *
 * CRITICAL FIX #2: For taproot addresses, the witness program is the TWEAKED output
 * key. But OP_WALLET's signSchnorr signs with the UNTWEAKED internal key. The old
 * code extracted the tweaked key from the address and verified against it → mismatch.
 * The fix: always use the client-supplied pubkey (the internal/untweaked key) for
 * verification, and try both untweaked + tweaked verification as fallback.
 *
 * Supported address types:
 *   - OPNet P2OP (opt1/opnet1): pubkey sent by client, verified against on-chain data
 *   - Taproot (bc1p/tb1p/bcrt1p): pubkey sent by client (REQUIRED), verified via sig
 *   - SegWit (bc1q/tb1q/bcrt1q): NOT supported (hash-based, can't extract pubkey)
 */
import { randomBytes, createHash } from 'crypto';
import { MessageSigner } from '@btc-vision/transaction';
import { logger } from '../utils/logger.js';
import { contractService } from '../services/contract.js';
import { db } from '../db/database.js';
import { config } from '../config.js';

const TAG = 'Auth';

// ── Session state ──
const pendingNonces = new Map<string, { nonce: string; createdAt: number }>();
const sessions = new Map<string, string>();       // wsId → address
const addressToWsId = new Map<string, string>();   // address → wsId

// ── Token-based session resumption ──
// L-01 FIX: Tokens persisted to SQLite, loaded on startup
// BE-13 FIX: Tokens stored as SHA-256 hashes in both memory and DB.
// Client holds raw token; server never stores raw token at rest.
const tokenToAddress = new Map<string, { address: string; createdAt: number }>(); // hashedToken → {address, createdAt}
const addressToToken = new Map<string, string>();   // address → hashedToken
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;          // L-02 FIX: 24 hours (was 7 days)

/** BE-13: Hash a raw token with SHA-256 before storage/lookup */
function hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * L-01 FIX: Load persisted session tokens from DB on startup.
 * Call this after db.init().
 */
export function initSessionTokens(): void {
    const rows = db.loadAllSessionTokens(TOKEN_TTL_MS);
    for (const row of rows) {
        tokenToAddress.set(row.token, { address: row.address, createdAt: row.createdAt });
        addressToToken.set(row.address, row.token);
    }
    logger.info(TAG, `Loaded ${rows.length} persisted session tokens`);
}

const NONCE_TTL_MS = 60_000;
// UX-1 FIX: 60s timeout — mobile wallet signing can take 30+ seconds
export const AUTH_TIMEOUT_MS = 60_000;

// Domain separation prefix — prevents cross-context signature reuse (BIP-340 §Usage)
const AUTH_DOMAIN = 'ChartArena:auth:';

// ── Address validation ──

const TAPROOT_PREFIXES = ['tb1p', 'bc1p', 'bcrt1p'];
const OPNET_PREFIXES = ['opt1', 'opnet1'];
const ALL_VALID_PREFIXES = [...TAPROOT_PREFIXES, ...OPNET_PREFIXES];

function isTaprootAddress(address: string): boolean {
    return TAPROOT_PREFIXES.some((p) => address.toLowerCase().startsWith(p));
}

function isOpnetAddress(address: string): boolean {
    return OPNET_PREFIXES.some((p) => address.toLowerCase().startsWith(p));
}

function isValidAddress(address: string): boolean {
    if (!address || address.length < 10 || address.length > 128) return false;
    return ALL_VALID_PREFIXES.some((p) => address.toLowerCase().startsWith(p));
}

// ── Hex utilities ──

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) throw new Error('Invalid hex');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth message construction ──

/**
 * Build the auth message string.
 * MessageSigner.verifySignature() hashes this with SHA-256 internally,
 * matching what MessageSigner.signMessageAuto() does on the frontend.
 */
function buildAuthMessage(nonce: string): string {
    return AUTH_DOMAIN + nonce;
}

// ── Core verification ──

/**
 * Verify a BIP-340 Schnorr signature using OPNet's MessageSigner.
 *
 * MessageSigner.verifySignature() internally:
 *   1. UTF-8 encodes the message string
 *   2. SHA-256 hashes it
 *   3. Calls backend.verifySchnorr(hash, toXOnly(pubkey), sig)
 *
 * This matches what MessageSigner.signMessageAuto() does on the frontend
 * (via OP_WALLET's signSchnorr).
 *
 * @param pubkey   32-byte x-only public key (untweaked internal key from wallet)
 * @param message  Raw auth message string (not pre-hashed)
 * @param sigRaw   Signature as hex (128 chars) or base64
 */
function verifySchnorrSignature(pubkey: Uint8Array, message: string, sigRaw: string): boolean {
    try {
        let sigBytes: Uint8Array;
        if (/^[0-9a-fA-F]{128}$/.test(sigRaw)) {
            sigBytes = hexToBytes(sigRaw);
        } else {
            // OP_WALLET may return base64
            try {
                sigBytes = Uint8Array.from(Buffer.from(sigRaw, 'base64'));
                if (sigBytes.length !== 64) {
                    logger.warn(TAG, `Decoded sig is ${sigBytes.length} bytes, expected 64`);
                    return false;
                }
            } catch {
                logger.warn(TAG, `Signature is neither valid hex nor base64 (len=${sigRaw.length})`);
                return false;
            }
        }

        // PRIMARY: Verify with untweaked key (standard signSchnorr path)
        const valid = MessageSigner.verifySignature(pubkey, message, sigBytes);
        if (valid) {
            logger.info(TAG, `Schnorr signature verified (untweaked key)`);
            return true;
        }

        // FALLBACK: Try tweaked verification in case wallet signed with tweaked key
        // (some wallet versions may use tweaked Schnorr for message signing)
        try {
            const tweakedValid = MessageSigner.tweakAndVerifySignature(pubkey, message, sigBytes);
            if (tweakedValid) {
                logger.info(TAG, `Schnorr signature verified (tweaked key)`);
                return true;
            }
        } catch (tweakErr) {
            // tweakAndVerifySignature may throw if ECC backend doesn't support it
            logger.warn(TAG, `Tweaked verification threw (non-fatal):`, tweakErr);
        }

        logger.warn(TAG, `Schnorr verification failed — both untweaked and tweaked paths returned false`);
        logger.warn(TAG, `  pubkey: ${bytesToHex(pubkey)}`);
        logger.warn(TAG, `  sig:    ${sigRaw.slice(0, 32)}...`);
        logger.warn(TAG, `  msg:    ${message}`);
        return false;
    } catch (err) {
        logger.error(TAG, 'Schnorr verification threw', err);
        return false;
    }
}

// ── Public API ──

export function generateNonce(wsId: string): string {
    const nonce = randomBytes(32).toString('hex');
    pendingNonces.set(wsId, { nonce, createdAt: Date.now() });
    return nonce;
}

/**
 * Authenticate a WebSocket connection.
 *
 * @param wsId      WebSocket connection ID
 * @param address   Claimed wallet address (taproot or OPNet P2OP)
 * @param signature 64-byte BIP-340 Schnorr signature as hex (128 chars)
 * @param pubkey    32-byte x-only pubkey as hex — REQUIRED for all address types
 */
// ── Session creation helper (shared by signature auth and token auth) ──

// NEW-5 FIX: Callback for when a session is replaced (e.g., second tab opens)
let _onSessionReplaced: ((oldWsId: string) => void) | null = null;
export function setOnSessionReplaced(handler: (oldWsId: string) => void): void {
    _onSessionReplaced = handler;
}

function createSession(wsId: string, address: string): void {
    const existingWsId = addressToWsId.get(address);
    if (existingWsId && existingWsId !== wsId) {
        if (_onSessionReplaced) _onSessionReplaced(existingWsId);
        sessions.delete(existingWsId);
        addressToWsId.delete(address);
        logger.info(TAG, `Replaced existing session for ${address}`);
    }
    pendingNonces.delete(wsId);
    sessions.set(wsId, address);
    addressToWsId.set(address, wsId);
}

/**
 * Generate a session token after successful auth.
 * The frontend stores this and uses it to resume sessions without re-signing.
 */
export function generateSessionToken(address: string): string {
    // Revoke previous token for this address
    const oldHash = addressToToken.get(address);
    if (oldHash) {
        tokenToAddress.delete(oldHash);
        db.deleteSessionToken(oldHash);
    }

    const rawToken = randomBytes(32).toString('hex');
    const hashed = hashToken(rawToken);
    const createdAt = Date.now();
    // BE-13: Store HASH in maps and DB, return RAW to client
    tokenToAddress.set(hashed, { address, createdAt });
    addressToToken.set(address, hashed);
    db.storeSessionToken(hashed, address, createdAt);
    return rawToken; // client gets raw, server only stores hash
}

/**
 * Resume a session using a previously issued token (no wallet signing needed).
 * Returns the address if valid, null otherwise.
 */
export function authenticateWithToken(wsId: string, token: string): string | null {
    // BE-13: Hash the client's raw token to find it in our hash-keyed map
    const hashed = hashToken(token);
    const entry = tokenToAddress.get(hashed);
    if (!entry) {
        logger.warn(TAG, `Invalid session token for ${wsId}`);
        return null;
    }
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
        logger.warn(TAG, `Expired session token for ${entry.address}`);
        tokenToAddress.delete(hashed);
        addressToToken.delete(entry.address);
        db.deleteSessionToken(hashed);
        return null;
    }
    // Valid token — create session
    createSession(wsId, entry.address);
    logger.info(TAG, `Token-resumed session for ${entry.address}`);
    return entry.address;
}

export async function authenticate(
    wsId: string,
    address: string,
    signature?: string,
    pubkey?: string,
): Promise<boolean> {
    // 1. Check pending nonce
    const pending = pendingNonces.get(wsId);
    if (!pending) {
        logger.warn(TAG, `No pending nonce for ${wsId}`);
        return false;
    }

    // 2. Check nonce expiry
    if (Date.now() - pending.createdAt > NONCE_TTL_MS) {
        logger.warn(TAG, `Nonce expired for ${wsId}`);
        pendingNonces.delete(wsId);
        return false;
    }

    // 3. Validate address format
    if (!isValidAddress(address)) {
        logger.warn(TAG, `Invalid address format: ${address}`);
        return false;
    }

    // DEV_MODE: skip all crypto, just create session
    // SECURITY: This bypass is ONLY allowed in DEV_MODE AND NOT on mainnet
    // V5-08 FIX: Use config.devMode (centralized) instead of raw process.env
    if (config.devMode) {
        // config.ts already crashes if DEV_MODE + mainnet, but double-check
        if (process.env.NETWORK === 'mainnet') {
            logger.error(TAG, 'CRITICAL: DEV_MODE auth bypass BLOCKED on mainnet! Rejecting auth.');
            return false;
        }
        logger.warn(TAG, '⚠️  DEV_MODE: auto-auth (NO SIGNATURE VERIFICATION) — ' + address);
        createSession(wsId, address);
        return true;
    }

    // 4. Require signature
    if (!signature) {
        logger.warn(TAG, `Missing signature from ${address}`);
        return false;
    }

    // 5. Require and validate the x-only public key
    //    FIX: Always use the client-supplied pubkey. For taproot addresses, the
    //    address contains the TWEAKED output key, but the wallet signs with the
    //    UNTWEAKED internal key. We need the internal key for verification.
    if (!pubkey || typeof pubkey !== 'string') {
        logger.warn(TAG, `Missing pubkey from ${address} — pubkey is required for all address types`);
        return false;
    }

    let xOnlyPubkey: Uint8Array;
    try {
        xOnlyPubkey = hexToBytes(pubkey);
        if (xOnlyPubkey.length !== 32) {
            logger.warn(TAG, `Invalid pubkey length ${xOnlyPubkey.length} (expected 32 bytes): ${address}`);
            return false;
        }
    } catch {
        logger.warn(TAG, `Invalid pubkey hex from ${address}`);
        return false;
    }

    if (isTaprootAddress(address) || isOpnetAddress(address)) {
        // H-01 FIX: Three-tier pubkey verification:
        //   1. On-chain canonical pubkey (highest trust)
        //   2. DB-stored first-seen pubkey (prevents impersonation of known addresses)
        //   3. New address: accept + pin in DB (first write wins)
        const clientPubkeyHex = bytesToHex(xOnlyPubkey);

        try {
            const canonicalHex = await contractService.getCanonicalPubkey(address);
            if (canonicalHex) {
                // On-chain pubkey exists — must match
                if (clientPubkeyHex !== canonicalHex) {
                    logger.warn(TAG, `IMPERSONATION BLOCKED: client pubkey does not match on-chain pubkey for ${address}`);
                    return false;
                }
                logger.info(TAG, `Pubkey verified on-chain for ${address}`);
                // Update DB with on-chain verified key (authoritative source)
                db.updateKnownPubkey(address, canonicalHex, 'onchain_verified');
            } else {
                // No on-chain history — check DB for first-seen pubkey
                const knownPubkey = db.getKnownPubkey(address);
                if (knownPubkey) {
                    // We've seen this address before — must use the same pubkey
                    if (clientPubkeyHex !== knownPubkey) {
                        logger.warn(TAG, `IMPERSONATION BLOCKED: client pubkey does not match first-seen pubkey for ${address}`);
                        logger.warn(TAG, `  Known: ${knownPubkey.slice(0, 16)}… Client: ${clientPubkeyHex.slice(0, 16)}…`);
                        return false;
                    }
                    logger.info(TAG, `Pubkey verified (DB first-seen match) for ${address}`);
                } else {
                    // Brand new address — accept and pin
                    logger.info(TAG, `New address ${address} — pinning client pubkey in DB`);
                    // Note: will be pinned AFTER signature verification succeeds (below)
                }
            }
        } catch (err) {
            if (isTaprootAddress(address)) {
                // Taproot: on-chain lookup failure is non-fatal — fall back to DB check
                const knownPubkey = db.getKnownPubkey(address);
                if (knownPubkey && clientPubkeyHex !== knownPubkey) {
                    logger.warn(TAG, `IMPERSONATION BLOCKED (taproot, DB check): pubkey mismatch for ${address}`);
                    return false;
                }
                logger.info(TAG, `Taproot pubkey lookup failed, DB ${knownPubkey ? 'match OK' : 'no record (new)'}: ${err}`);
            } else {
                // OPNet: pubkey lookup failure blocks auth
                logger.error(TAG, `Pubkey verification failed for OPNet address: ${address}`, err);
                return false;
            }
        }
    } else {
        logger.warn(TAG, `Unsupported address type for auth: ${address}. Use a taproot (bc1p/tb1p) or OPNet (opt1) address.`);
        return false;
    }

    // 6. Build the message and verify the BIP-340 Schnorr signature
    const message = buildAuthMessage(pending.nonce);
    const valid = verifySchnorrSignature(xOnlyPubkey, message, signature);

    if (!valid) {
        logger.warn(TAG, `BIP-340 signature verification FAILED for ${address}`);
        return false;
    }
    logger.info(TAG, `BIP-340 signature verified for ${address}`);

    // H-01: Pin pubkey in DB after successful signature verification
    // INSERT OR IGNORE — first successful auth wins
    const clientPubkeyHex = bytesToHex(xOnlyPubkey);
    const isNew = db.setKnownPubkey(address, clientPubkeyHex);
    if (isNew) {
        logger.info(TAG, `Pinned first-seen pubkey for ${address}`);
    }

    // 7. Create session
    createSession(wsId, address);
    logger.info(TAG, `Authenticated: ${address}`);
    return true;
}

export function getPlayerAddress(wsId: string): string | undefined { return sessions.get(wsId); }

export function removeSession(wsId: string): void {
    const address = sessions.get(wsId);
    if (address) addressToWsId.delete(address);
    pendingNonces.delete(wsId);
    sessions.delete(wsId);
}

export function isAuthenticated(wsId: string): boolean { return sessions.has(wsId); }

/**
 * Exported for testing: build the message that clients must sign.
 * Clients use MessageSigner.signMessageAuto("ChartArena:auth:" + nonce) to sign.
 */
export { buildAuthMessage, AUTH_DOMAIN };
