import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { getContract, OP_20_ABI } from 'opnet';
import { config } from './build/config.js';

operatorWallet.init();
await contractService.init();

const player = 'opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066';
const playerAddr = await contractService.resolveAddress(player);
const escrowAddr = await contractService.resolveAddress(config.escrowAddress);

const provider = contractService['provider'];
const token = getContract(config.motoToken, OP_20_ABI, provider, config.network, playerAddr);

// Raw allowance result
const allow = await token.allowance(playerAddr, escrowAddr);
console.log('Allowance raw result:', JSON.stringify(allow, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));

// Also try with properties keys
if (allow?.properties) {
    console.log('Properties keys:', Object.keys(allow.properties));
    for (const [k, v] of Object.entries(allow.properties)) {
        console.log('  ', k, '=', typeof v === 'bigint' ? v.toString() : v);
    }
}

// Try a direct approve simulation from backend to see if it would work
console.log('\nSimulating increaseAllowance(escrow, 5 MOTO)...');
try {
    const sim = await token.increaseAllowance(escrowAddr, 5000000000000000000n);
    console.log('Sim revert:', sim.revert);
    console.log('Sim result:', sim.properties);
} catch (e) {
    console.log('Sim error:', e.message);
}

process.exit(0);
