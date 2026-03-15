import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { getContract, ABIDataTypes, BitcoinAbiTypes } from 'opnet';
import { config } from './build/config.js';

operatorWallet.init();
await contractService.init();

const player = 'opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066';
const playerAddr = await contractService.resolveAddress(player);

const ESCROW_ABI = [{
    name: 'deposit', type: BitcoinAbiTypes.Function, constant: false,
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
}];

const provider = contractService['provider'];
const escrow = getContract(config.escrowAddress, ESCROW_ABI, provider, config.network, playerAddr);

console.log('Simulating deposit(5 MOTO) from backend...');
try {
    const sim = await escrow.deposit(5000000000000000000n);
    console.log('Revert:', sim.revert);
    console.log('Properties:', JSON.stringify(sim.properties, (k,v) => typeof v === 'bigint' ? v.toString() : v));
    console.log('Events:', sim.events?.length ?? 0);
    if (!sim.revert) {
        console.log('SUCCESS - deposit simulation passed from backend');
    }
} catch (e) {
    console.log('THREW:', e.message);
}

process.exit(0);
