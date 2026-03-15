import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

async function main(): Promise<void> {
    const deployInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));
    const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: networks.opnetTestnet });
    console.log('Checking contract:', deployInfo.contractAddress);
    try {
        const code = await provider.getCode(deployInfo.contractAddress, true) as Uint8Array;
        if (code && code.length > 0) {
            console.log('\n✅ CONTRACT VERIFIED');
            console.log('   Bytecode size:', code.length, 'bytes');
            console.log('   Address:', deployInfo.contractAddress);
        } else {
            console.log('❌ No bytecode yet. Wait a few more minutes and retry.');
        }
    } catch (err) {
        console.log('❌ Not found yet. May still be pending (testnet blocks take ~10 min).');
        console.log('   Error:', err);
    }
}
main().catch(console.error);
