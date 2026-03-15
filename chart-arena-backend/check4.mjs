import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { config } from './build/config.js';
import { Address } from '@btc-vision/transaction';

operatorWallet.init();
await contractService.init();

const player = 'opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066';
const provider = contractService['provider'];

// Get raw PublicKeyInfo
const info = await provider.getPublicKeyInfo(player, false);
console.log('=== PublicKeyInfo fields ===');
console.log('originalPubKey:', info.originalPubKey ?? 'MISSING');
console.log('tweakedPubkey:', info.tweakedPubkey ?? 'MISSING');
console.log('mldsaHashedPublicKey:', info.mldsaHashedPublicKey ?? 'MISSING');
console.log('p2tr:', info.p2tr ?? 'MISSING');
console.log('p2op:', info.p2op ?? 'MISSING');

// Try constructing Address with both params
if (info.mldsaHashedPublicKey && info.originalPubKey) {
    const mldsaHex = info.mldsaHashedPublicKey.startsWith('0x') ? info.mldsaHashedPublicKey : '0x' + info.mldsaHashedPublicKey;
    const legacyHex = info.originalPubKey.startsWith('0x') ? info.originalPubKey : '0x' + info.originalPubKey;
    const addr = Address.fromString(mldsaHex, legacyHex);
    console.log('\n=== Address.fromString(mldsa, legacy) ===');
    console.log('toHex:', addr.toHex());
    console.log('tweakedToHex:', addr.tweakedToHex());
} else {
    console.log('\nCannot construct full Address - missing fields');
}

// Try with just one param (old broken code)
if (info.tweakedPubkey) {
    try {
        const hex = info.tweakedPubkey.startsWith('0x') ? info.tweakedPubkey : '0x' + info.tweakedPubkey;
        const addrOneParam = Address.fromString(hex);
        console.log('\n=== Address.fromString(tweaked) [old code] ===');
        console.log('toHex:', addrOneParam.toHex());
    } catch(e) { console.log('One-param failed:', e.message); }
}

process.exit(0);
