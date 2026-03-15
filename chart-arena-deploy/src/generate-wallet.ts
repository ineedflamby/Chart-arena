import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const network = networks.regtest;

// Generate new 24-word mnemonic
const mnemonic = Mnemonic.generate(
    undefined,               // 24 words
    '',                      // no passphrase
    network,
    MLDSASecurityLevel.LEVEL2
);

// Derive wallet (Unisat/OPWallet compatible derivation)
const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

const walletInfo = {
    mnemonic: mnemonic.phrase,
    taproot: wallet.p2tr,
    segwit: wallet.p2wpkh,
    network: 'regtest',
};

console.log('=== CHART ARENA DEPLOYMENT WALLET ===');
console.log('');
console.log('Mnemonic (SAVE THIS SECURELY):');
console.log(walletInfo.mnemonic);
console.log('');
console.log('Taproot address (for funding):');
console.log(walletInfo.taproot);
console.log('');
console.log('SegWit address:');
console.log(walletInfo.segwit);
console.log('');

// Save to file (gitignore this!)
fs.writeFileSync('wallet.json', JSON.stringify(walletInfo, null, 2));
console.log('Saved to wallet.json — ADD THIS TO .gitignore!');
