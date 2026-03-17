/**
 * Generate a GUARDIAN wallet for Chart Arena v6.
 *
 * Usage:
 *   npx tsc && node build/generate-guardian.js
 *
 * This generates a NEW mnemonic, derives the guardian address,
 * and adds the guardian entry to roles.json.
 *
 * SAVE THE MNEMONIC OUTPUT — you need it for GUARDIAN_MNEMONIC env var.
 */
import {
    Mnemonic,
    MLDSASecurityLevel,
    AddressTypes,
} from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const NETWORK = networks.opnetTestnet;
const GUARDIAN_INDEX = 0;

async function main(): Promise<void> {
    console.log('=== Generating Guardian Wallet ===\n');

    // Generate a fresh mnemonic (24 words)
    const mnemonic = Mnemonic.generate(undefined, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, GUARDIAN_INDEX);

    const words = (mnemonic as any).words?.join(' ') ?? (mnemonic as any).phrase ?? String(mnemonic);

    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│  GUARDIAN MNEMONIC — SAVE THIS SECURELY            │');
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│  ${words}`);
    console.log('├─────────────────────────────────────────────────────┤');
    console.log('│  DO NOT store on the same machine as the operator  │');
    console.log('│  DO NOT commit to git                              │');
    console.log('│  DO NOT share with anyone                          │');
    console.log('└─────────────────────────────────────────────────────┘\n');

    console.log(`Guardian address (taproot): ${wallet.p2tr}`);

    // Convert taproot to hex for roles.json
    // We need the public key hash — extract from the address object
    const pubkeyHex = '0x' + Array.from(wallet.publicKey).map(b => b.toString(16).padStart(2, '0')).join('');

    console.log(`Guardian pubkey (hex):      ${pubkeyHex}`);
    console.log(`Guardian index:             ${GUARDIAN_INDEX}\n`);

    // Update roles.json
    const rolesPath = 'roles.json';
    let roles: Record<string, unknown> = {};
    if (fs.existsSync(rolesPath)) {
        roles = JSON.parse(fs.readFileSync(rolesPath, 'utf-8'));
    }

    // For the contract calldata, we need the address as a 32-byte hex (same format as other roles)
    // The address.toHex() or similar method gives us the right format
    const addressObj = wallet.address;
    let hexAddress: string;
    try {
        hexAddress = (addressObj as any).toHex?.() ?? (addressObj as any).toString?.() ?? pubkeyHex;
        if (!hexAddress.startsWith('0x')) hexAddress = '0x' + hexAddress;
    } catch {
        // Fallback: use pubkey hash
        hexAddress = pubkeyHex;
    }

    (roles as any).guardian = {
        index: GUARDIAN_INDEX,
        taproot: wallet.p2tr,
        hex: hexAddress,
    };

    fs.writeFileSync(rolesPath, JSON.stringify(roles, null, 2));
    console.log(`Updated ${rolesPath} with guardian entry.\n`);

    console.log('=== NEXT STEPS ===');
    console.log('1. Fund this address with tBTC for gas:');
    console.log(`   ${wallet.p2tr}`);
    console.log('   Get tBTC from: https://faucet.opnet.org\n');
    console.log('2. Add to your backend .env:');
    console.log(`   GUARDIAN_MNEMONIC=${words}`);
    console.log(`   GUARDIAN_INDEX=${GUARDIAN_INDEX}\n`);
    console.log('3. Deploy v6 contract:');
    console.log('   npx tsc && node build/deploy-v6.js\n');
}

main().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
});
