import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { config } from './build/config.js';

operatorWallet.init();
await contractService.init();

const player = 'opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066';
const provider = contractService['provider'];

const playerAddr = await provider.getPublicKeyInfo(player, false);
const escrowAddr = await provider.getPublicKeyInfo(config.escrowAddress, true);

console.log('=== Player Address ===');
console.log('toHex:', playerAddr.toHex());
try { console.log('tweakedToHex:', playerAddr.tweakedToHex()); } catch(e) { console.log('tweakedToHex: ERROR', e.message); }
console.log('p2tr:', playerAddr.p2tr(config.network));

console.log('\n=== Escrow Address ===');
console.log('toHex:', escrowAddr.toHex());
try { console.log('tweakedToHex:', escrowAddr.tweakedToHex()); } catch(e) { console.log('tweakedToHex: ERROR', e.message); }

// Now try deposit simulation with the escrow using setSender explicitly
const { getContract, ABIDataTypes, BitcoinAbiTypes } = await import('opnet');
const ABI = [{
    name: 'deposit', type: BitcoinAbiTypes.Function, constant: false,
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
}];

// Method 1: sender via getContract 5th param
console.log('\n=== Method 1: sender via getContract ===');
const e1 = getContract(config.escrowAddress, ABI, provider, config.network, playerAddr);
try {
    const sim = await e1.deposit(5000000000000000000n);
    console.log('Result:', sim.revert ?? 'OK');
} catch(e) { console.log('Error:', e.message.slice(0, 80)); }

// Method 2: getContract without sender, then setSender
console.log('\n=== Method 2: setSender after getContract ===');
const e2 = getContract(config.escrowAddress, ABI, provider, config.network);
e2.setSender(playerAddr);
try {
    const sim = await e2.deposit(5000000000000000000n);
    console.log('Result:', sim.revert ?? 'OK');
} catch(e) { console.log('Error:', e.message.slice(0, 80)); }

process.exit(0);
