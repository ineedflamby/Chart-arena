import { Mnemonic, MLDSASecurityLevel } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const network = networks.regtest;
const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
const mnemonic = new Mnemonic(walletInfo.mnemonic, '', network, MLDSASecurityLevel.LEVEL2);

// Index 0 = deployer (already exists)
const deployer = mnemonic.derive(0);
const operator = mnemonic.derive(1);
const treasury = mnemonic.derive(2);
const prizePool = mnemonic.derive(3);

console.log('=== CHART ARENA ROLE ADDRESSES ===\n');
console.log('Deployer  (index 0):');
console.log(`  taproot: ${deployer.p2tr}`);
console.log(`  hex:     ${deployer.address.toHex()}\n`);
console.log('Operator  (index 1):');
console.log(`  taproot: ${operator.p2tr}`);
console.log(`  hex:     ${operator.address.toHex()}\n`);
console.log('Treasury  (index 2):');
console.log(`  taproot: ${treasury.p2tr}`);
console.log(`  hex:     ${treasury.address.toHex()}\n`);
console.log('PrizePool (index 3):');
console.log(`  taproot: ${prizePool.p2tr}`);
console.log(`  hex:     ${prizePool.address.toHex()}\n`);

// Save to file
const roles = {
    operator:  { index: 1, taproot: operator.p2tr,  hex: operator.address.toHex() },
    treasury:  { index: 2, taproot: treasury.p2tr,  hex: treasury.address.toHex() },
    prizePool: { index: 3, taproot: prizePool.p2tr, hex: prizePool.address.toHex() },
};
fs.writeFileSync('roles.json', JSON.stringify(roles, null, 2));
console.log('Saved to roles.json');
console.log('\nPaste these into deploy.ts:');
console.log(`const OPERATOR_ADDRESS = '${operator.address.toHex()}';`);
console.log(`const TREASURY_ADDRESS = '${treasury.address.toHex()}';`);
console.log(`const PRIZE_POOL_ADDRESS = '${prizePool.address.toHex()}';`);
