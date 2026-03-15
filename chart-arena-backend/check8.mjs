import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { getContract, OP_20_ABI } from 'opnet';
import { config } from './build/config.js';
import { ABICoder } from '@btc-vision/transaction';

operatorWallet.init();
await contractService.init();

// Extract the actual selectors from OP_20_ABI
console.log('=== OP_20_ABI selectors ===');
for (const entry of OP_20_ABI) {
    if (entry.name && entry.type === 'function') {
        console.log(entry.name);
    }
}

// Use ABICoder to see what it computes
const coder = new ABICoder();
const transferFrom = coder.encodeSelector('transferFrom');
const transfer = coder.encodeSelector('transfer');
console.log('\nABICoder transferFrom:', transferFrom);
console.log('ABICoder transfer:', transfer);

// Now try to find the REAL selector by looking at the calldata
// when the SDK makes a transferFrom call
const provider = contractService['provider'];
const playerAddr = await contractService.resolveAddress('opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066');
const token = getContract(config.motoToken, OP_20_ABI, provider, config.network, playerAddr);

// Simulate a transferFrom and capture the calldata
console.log('\nSimulating transferFrom to capture selector...');
try {
    const sim = await token.transferFrom(playerAddr, playerAddr, 1n);
    console.log('transferFrom calldata bytes:', Buffer.from(sim.calldata).toString('hex').slice(0, 16));
    console.log('transferFrom selector (first 4 bytes):', '0x' + Buffer.from(sim.calldata).toString('hex').slice(0, 8));
} catch(e) {
    console.log('transferFrom sim error:', e.message?.slice(0, 80));
}

// Also capture transfer selector
console.log('\nSimulating transfer to capture selector...');
try {
    const sim = await token.transfer(playerAddr, 1n);
    console.log('transfer calldata bytes:', Buffer.from(sim.calldata).toString('hex').slice(0, 16));
    console.log('transfer selector (first 4 bytes):', '0x' + Buffer.from(sim.calldata).toString('hex').slice(0, 8));
} catch(e) {
    console.log('transfer sim error:', e.message?.slice(0, 80));
}

process.exit(0);
