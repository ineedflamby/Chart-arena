import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: networks.opnetTestnet });
const wallet = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));

async function main(): Promise<void> {
    console.log('Address:', wallet.taproot);
    const balance = await provider.getBalance(wallet.taproot);
    console.log(`Balance: ${balance} sats (${Number(balance) / 1e8} tBTC)`);
    const utxos = await provider.utxoManager.getUTXOs({ address: wallet.taproot });
    console.log(`UTXOs: ${utxos.length}`);
}
main().catch(console.error);
