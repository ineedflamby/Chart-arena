import { contractService } from './build/services/contract.js';
import { operatorWallet } from './build/services/operator-wallet.js';
import { config } from './build/config.js';
import { getContract, OP_20_ABI } from 'opnet';

operatorWallet.init();
await contractService.init();

// Check what selectors the OP_20_ABI defines
console.log('=== OP_20_ABI entries ===');
for (const entry of OP_20_ABI) {
    console.log(entry.name, ':', entry.type);
}

// Manually compute the SHA256-based selectors OPNet uses
const crypto = await import('crypto');
function opnetSelector(name) {
    const hash = crypto.createHash('sha256').update(name).digest();
    return '0x' + hash.subarray(0, 4).toString('hex');
}

console.log('\n=== Computed selectors ===');
console.log('transfer:', opnetSelector('transfer'));
console.log('transferFrom:', opnetSelector('transferFrom'));
console.log('increaseAllowance:', opnetSelector('increaseAllowance'));
console.log('allowance:', opnetSelector('allowance'));
console.log('balanceOf:', opnetSelector('balanceOf'));

console.log('\n=== Contract uses ===');
console.log('TRANSFER_FROM_SELECTOR:', '0x4b6685e7');
console.log('TRANSFER_SELECTOR:', '0x3b88ef57');

process.exit(0);
