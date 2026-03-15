import { Mnemonic, MLDSASecurityLevel, AddressTypes } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const old = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
const network = networks.opnetTestnet;
const mnemonic = new Mnemonic(old.mnemonic, '', network, MLDSASecurityLevel.LEVEL2);

// deriveOPWallet = matches OP_WALLET extension derivation
const deployer  = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
const operator  = mnemonic.deriveOPWallet(AddressTypes.P2TR, 1);
const treasury  = mnemonic.deriveOPWallet(AddressTypes.P2TR, 2);
const prizePool = mnemonic.deriveOPWallet(AddressTypes.P2TR, 3);

const walletInfo = {
    mnemonic: old.mnemonic,
    taproot: deployer.p2tr,
    segwit: deployer.p2wpkh,
    network: 'testnet',
};
fs.writeFileSync('wallet.json', JSON.stringify(walletInfo, null, 2));

const roles = {
    operator:  { index: 1, taproot: operator.p2tr,  hex: operator.address.toHex() },
    treasury:  { index: 2, taproot: treasury.p2tr,  hex: treasury.address.toHex() },
    prizePool: { index: 3, taproot: prizePool.p2tr, hex: prizePool.address.toHex() },
};
fs.writeFileSync('roles.json', JSON.stringify(roles, null, 2));

console.log('=== TESTNET ADDRESSES (deriveOPWallet - matches OP_WALLET) ===\n');
console.log('Deployer  (index 0):');
console.log('  taproot:', deployer.p2tr, '\n');
console.log('Operator  (index 1):');
console.log('  taproot:', operator.p2tr);
console.log('  hex:    ', operator.address.toHex(), '\n');
console.log('Treasury  (index 2):');
console.log('  taproot:', treasury.p2tr);
console.log('  hex:    ', treasury.address.toHex(), '\n');
console.log('PrizePool (index 3):');
console.log('  taproot:', prizePool.p2tr);
console.log('  hex:    ', prizePool.address.toHex(), '\n');
console.log('Does this match OP_WALLET?');
console.log('Expected: opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066');
console.log('Got:     ', deployer.p2tr);
