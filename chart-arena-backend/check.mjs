import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { getContract, OP_20_ABI } from 'opnet';
import { config } from './build/config.js';

operatorWallet.init();
await contractService.init();

const player = 'opt1pjcp92sygntgcdzta97cwckuvhxvzpzlel7g8ht8vmyejc2slqz5sgyf066';
const playerAddr = await contractService.resolveAddress(player);
const escrowAddr = await contractService.resolveAddress(config.escrowAddress);
console.log('Player resolved:', !!playerAddr);
console.log('Escrow resolved:', !!escrowAddr);

const provider = contractService['provider'];
const token = getContract(config.motoToken, OP_20_ABI, provider, config.network, playerAddr);

const bal = await token.balanceOf(playerAddr);
console.log('MOTO balance:', bal?.properties?.balance?.toString());

const allow = await token.allowance(playerAddr, escrowAddr);
console.log('Allowance for escrow:', allow?.properties?.allowance?.toString());

process.exit(0);
