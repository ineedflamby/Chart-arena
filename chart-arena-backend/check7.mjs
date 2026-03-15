import { ABICoder } from '@btc-vision/transaction';

const coder = new ABICoder();
console.log('=== Correct OPNet selectors (ABICoder.encodeSelector) ===');
console.log('transfer:', coder.encodeSelector('transfer'));
console.log('transferFrom:', coder.encodeSelector('transferFrom'));
console.log('balanceOf:', coder.encodeSelector('balanceOf'));
console.log('allowance:', coder.encodeSelector('allowance'));
console.log('increaseAllowance:', coder.encodeSelector('increaseAllowance'));
console.log('deposit:', coder.encodeSelector('deposit'));

console.log('\n=== Contract hardcoded (WRONG?) ===');
console.log('TRANSFER_FROM_SELECTOR:', '0x4b6685e7');
console.log('TRANSFER_SELECTOR:', '0x3b88ef57');

process.exit(0);
