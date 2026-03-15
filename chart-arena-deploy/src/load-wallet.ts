/**
 * Shared wallet loader for deploy scripts.
 * C-02 FIX: Reads OPERATOR_MNEMONIC from env first, wallet.json as fallback.
 *
 * Usage in deploy scripts — replace:
 *   const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
 *   const mnemonic = new Mnemonic(walletInfo.mnemonic, ...);
 *
 * With:
 *   import { loadWalletMnemonic } from './load-wallet.js';
 *   const mnemonic = loadWalletMnemonic(network);
 */
import { existsSync, readFileSync } from 'fs';
import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import type { Network } from '@btc-vision/bitcoin';

export function loadWalletMnemonic(network: Network): Mnemonic {
    let words: string;

    // Priority 1: env var
    const envMnemonic = process.env['OPERATOR_MNEMONIC'];
    if (envMnemonic && envMnemonic.trim().length > 0) {
        words = envMnemonic.trim();
        console.log('✅ Loaded mnemonic from OPERATOR_MNEMONIC env var');
    }
    // Priority 2: wallet.json file
    else if (existsSync('wallet.json')) {
        const raw = JSON.parse(readFileSync('wallet.json', 'utf-8'));
        if (!raw.mnemonic) throw new Error('wallet.json missing "mnemonic" field');
        words = raw.mnemonic;
        console.warn('⚠️  Loaded mnemonic from wallet.json — use OPERATOR_MNEMONIC env var for production');
    }
    else {
        throw new Error(
            'No mnemonic found.\n' +
            'Set OPERATOR_MNEMONIC env var or create wallet.json.\n' +
            'Run: npx ts-node src/generate-wallet.ts'
        );
    }

    return new Mnemonic(words, '', network, MLDSASecurityLevel.LEVEL2);
}

/**
 * Derive the standard wallet roles from a mnemonic.
 * Index 0 = deployer, 1 = operator, 2 = treasury, 3 = prize pool
 */
export function deriveRoles(mnemonic: Mnemonic) {
    return {
        deployer:  mnemonic.deriveOPWallet(AddressTypes.P2TR, 0),
        operator:  mnemonic.deriveOPWallet(AddressTypes.P2TR, 1),
        treasury:  mnemonic.deriveOPWallet(AddressTypes.P2TR, 2),
        prizePool: mnemonic.deriveOPWallet(AddressTypes.P2TR, 3),
    };
}
