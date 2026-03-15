/**
 * Chart Arena — OPNet-compliant Vite configuration.
 *
 * CRITICAL rules (from OPNet setup-guidelines):
 *   1. nodePolyfills MUST come BEFORE react() in plugin order
 *   2. crypto-browserify override is REQUIRED for wallet signing
 *   3. undici alias is REQUIRED — opnet uses it internally for fetch
 *   4. dedupe noble/scure — multiple copies break signature verification
 *   5. crypto-browserify MUST be excluded from optimizeDeps (circular deps)
 *
 * NOTE on Address bug: The "a.toHex is not a function" crash was NOT a Vite
 * bundling issue. It was caused by passing raw strings as sender to contracts.
 * provider.call() does `from.toHex()` on the sender, so it must be a proper
 * Address object. The fix is in contract.ts (use provider.getPublicKeyInfo()).
 */
import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
    base: '/',
    plugins: [
        // ── Node.js polyfills — MUST come before react() ──
        nodePolyfills({
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
            overrides: {
                crypto: 'crypto-browserify', // REQUIRED for wallet signing
            },
        }),
        react(),
    ],

    server: { port: 5173, host: true },

    resolve: {
        alias: {
            global: 'global',
            // Browser shim for Node.js fetch — REQUIRED for opnet RPC calls
            undici: resolve(__dirname, 'node_modules/opnet/src/fetch/fetch-browser.js'),
        },
        // Resolve order matters for hybrid CJS/ESM packages
        mainFields: ['module', 'main', 'browser'],
        // Dedupe prevents multiple copies of shared crypto deps (breaks signatures)
        dedupe: [
            '@btc-vision/transaction',
            '@btc-vision/bitcoin',
            '@btc-vision/walletconnect',
            'opnet',
            '@noble/curves',
            '@noble/hashes',
            '@scure/base',
            '@scure/bip32',
            'buffer',
            'react',
            'react-dom',
        ],
    },

    build: {
        commonjsOptions: {
            strictRequires: true,
            transformMixedEsModules: true,
        },
        rollupOptions: {
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'js/[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.names?.[0] ?? '';
                    const ext = name.split('.').pop() ?? '';
                    if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) return 'images/[name][extname]';
                    if (/woff2?|eot|ttf|otf/i.test(ext)) return 'fonts/[name][extname]';
                    if (/css/i.test(ext)) return 'css/[name][extname]';
                    return 'assets/[name][extname]';
                },
                // Manual chunk splitting for optimal loading
                manualChunks(id) {
                    // crypto-browserify has circular deps — never split
                    if (id.includes('crypto-browserify') || id.includes('randombytes')) {
                        return undefined;
                    }
                    if (id.includes('node_modules')) {
                        if (id.includes('@noble/curves')) return 'noble-curves';
                        if (id.includes('@noble/hashes')) return 'noble-hashes';
                        if (id.includes('@scure/')) return 'scure';
                        // All btc-vision packages + opnet share ONE chunk to keep
                        // Address class on a single prototype chain.
                        if (id.includes('@btc-vision/transaction')) return 'opnet';
                        if (id.includes('@btc-vision/bitcoin')) return 'opnet';
                        if (id.includes('node_modules/opnet')) return 'opnet';
                        if (id.includes('@btc-vision/walletconnect')) return 'btc-walletconnect';
                        if (id.includes('react-dom')) return 'react-dom';
                        if (id.includes('react')) return 'react';
                    }
                    return undefined;
                },
            },
            external: [
                // Node.js-only modules that must not be bundled for browser
                'fs', 'path', 'os', 'net', 'tls', 'http', 'https',
                'child_process', 'worker_threads', 'cluster',
            ],
        },
    },

    optimizeDeps: {
        // crypto-browserify has circular deps — must NOT be pre-bundled
        exclude: ['crypto-browserify'],
        include: [
            'buffer', 'react', 'react-dom',
            // Force pre-bundle together so Address class is shared
            'opnet',
            '@btc-vision/transaction',
            '@btc-vision/bitcoin',
        ],
    },
});
