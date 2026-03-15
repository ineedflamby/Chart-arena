/**
 * Twitter OAuth 1.0a — 3-legged sign-in flow.
 *
 * Flow:
 *   1. Backend requests temporary oauth_token from Twitter
 *   2. User is redirected to Twitter to authorize
 *   3. Twitter redirects to callback with oauth_verifier
 *   4. Backend exchanges for access token + screen_name
 *   5. Profile saved, WS message sent to frontend
 */

import { createHmac, randomBytes } from 'crypto';
import { request as httpsRequest } from 'https';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'TwitterAuth';

const TWITTER_REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const TWITTER_AUTHORIZE_URL = 'https://api.twitter.com/oauth/authorize';
const TWITTER_ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';

// ── Pending auth sessions: oauth_token → { secret, playerAddress } ──
const pendingAuth = new Map<string, { secret: string; address: string; createdAt: number }>();

// Clean up stale sessions every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of pendingAuth) {
        if (now - session.createdAt > 10 * 60 * 1000) { // 10 min TTL
            pendingAuth.delete(token);
        }
    }
}, 5 * 60 * 1000);

// ── OAuth 1.0a Signature ──

function percentEncode(str: string): string {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/\*/g, '%2A')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
}

function generateNonce(): string {
    return randomBytes(16).toString('hex');
}

function generateTimestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
}

function buildSignature(
    method: string,
    url: string,
    params: Record<string, string>,
    consumerSecret: string,
    tokenSecret: string = '',
): string {
    // Sort params alphabetically
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');

    // Build base string
    const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;

    // Build signing key
    const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

    // HMAC-SHA1
    const hmac = createHmac('sha1', signingKey);
    hmac.update(baseString);
    return hmac.digest('base64');
}

function buildAuthHeader(oauthParams: Record<string, string>): string {
    const parts = Object.keys(oauthParams)
        .filter(k => k.startsWith('oauth_'))
        .sort()
        .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
        .join(', ');
    return `OAuth ${parts}`;
}

// ── HTTP helpers ──

function postTwitter(url: string, oauthParams: Record<string, string>, body: string = ''): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const authHeader = buildAuthHeader(oauthParams);

        const req = httpsRequest({
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`Twitter API ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function parseQueryString(qs: string): Record<string, string> {
    const params: Record<string, string> = {};
    for (const pair of qs.split('&')) {
        const [key, val] = pair.split('=');
        if (key) params[decodeURIComponent(key)] = decodeURIComponent(val ?? '');
    }
    return params;
}

// ── Public API ──

/**
 * Step 1: Request a temporary token from Twitter and return the authorize URL.
 * Called when user clicks "Connect with X".
 */
export async function startTwitterAuth(playerAddress: string): Promise<string> {
    const callbackUrl = config.twitterCallbackUrl;
    const nonce = generateNonce();
    const timestamp = generateTimestamp();

    // OAuth params for request_token
    const oauthParams: Record<string, string> = {
        oauth_consumer_key: config.twitterApiKey,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_version: '1.0',
        oauth_callback: callbackUrl,
    };

    // Build signature (include oauth_callback in params)
    const allParams = { ...oauthParams };
    const signature = buildSignature('POST', TWITTER_REQUEST_TOKEN_URL, allParams, config.twitterApiSecret);
    oauthParams.oauth_signature = signature;

    logger.info(TAG, `Requesting OAuth token for ${playerAddress}...`);

    const response = await postTwitter(TWITTER_REQUEST_TOKEN_URL, oauthParams);
    const parsed = parseQueryString(response);

    const oauthToken = parsed['oauth_token'];
    const oauthTokenSecret = parsed['oauth_token_secret'];

    if (!oauthToken || !oauthTokenSecret) {
        throw new Error('Twitter did not return oauth_token: ' + response);
    }

    // Store mapping: oauth_token → { secret, address }
    pendingAuth.set(oauthToken, {
        secret: oauthTokenSecret,
        address: playerAddress,
        createdAt: Date.now(),
    });

    logger.info(TAG, `OAuth token obtained for ${playerAddress}, redirecting to Twitter`);

    return `${TWITTER_AUTHORIZE_URL}?oauth_token=${oauthToken}`;
}

/**
 * Step 2: Handle Twitter's callback after user authorizes.
 * Returns { address, screenName, twitterUserId } on success.
 */
export async function handleTwitterCallback(
    oauthToken: string,
    oauthVerifier: string,
): Promise<{ address: string; screenName: string; userId: string } | null> {
    const session = pendingAuth.get(oauthToken);
    if (!session) {
        logger.warn(TAG, `No pending auth session for oauth_token: ${oauthToken}`);
        return null;
    }

    pendingAuth.delete(oauthToken);

    const nonce = generateNonce();
    const timestamp = generateTimestamp();

    // OAuth params for access_token
    const oauthParams: Record<string, string> = {
        oauth_consumer_key: config.twitterApiKey,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_token: oauthToken,
        oauth_version: '1.0',
    };

    // Include oauth_verifier in signature base
    const allParams = { ...oauthParams, oauth_verifier: oauthVerifier };
    const signature = buildSignature(
        'POST', TWITTER_ACCESS_TOKEN_URL, allParams,
        config.twitterApiSecret, session.secret,
    );
    oauthParams.oauth_signature = signature;

    const body = `oauth_verifier=${percentEncode(oauthVerifier)}`;
    const response = await postTwitter(TWITTER_ACCESS_TOKEN_URL, oauthParams, body);
    const parsed = parseQueryString(response);

    const screenName = parsed['screen_name'];
    const userId = parsed['user_id'];

    if (!screenName) {
        logger.error(TAG, `Twitter did not return screen_name: ${response}`);
        return null;
    }

    logger.info(TAG, `Twitter auth success: @${screenName} (${userId}) → ${session.address}`);

    return {
        address: session.address,
        screenName,
        userId: userId ?? '',
    };
}
