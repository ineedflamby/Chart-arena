// @ts-nocheck
import {
    getContract,
    JSONRpcProvider,
    ABIDataTypes,
    BitcoinAbiTypes,
    BitcoinInterfaceAbi,
    TransactionParameters,
} from 'opnet';
import {
    Mnemonic,
    AddressTypes,
    MLDSASecurityLevel,
} from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const NETWORK = networks.opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';

const ESCROW_ABI: BitcoinInterfaceAbi = [
    {
        name: 'createMatch',
        type: BitcoinAbiTypes.Function,
        constant: false,
        inputs: [
            { name: 'buyIn', type: ABIDataTypes.UINT256 },
            { name: 'mode', type: ABIDataTypes.UINT256 },
            { name: 'format', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'getMatchInfo',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
        outputs: [
            { name: 'buyIn', type: ABIDataTypes.UINT256 },
            { name: 'mode', type: ABIDataTypes.UINT256 },
            { name: 'format', type: ABIDataTypes.UINT256 },
            { name: 'status', type: ABIDataTypes.UINT256 },
            { name: 'playerCount', type: ABIDataTypes.UINT256 },
            { name: 'maxPlayers', type: ABIDataTypes.UINT256 },
            { name: 'lockBlock', type: ABIDataTypes.UINT256 },
            { name: 'pot', type: ABIDataTypes.UINT256 },
        ],
    },
];

async function main(): Promise<void> {
    const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
    const deployInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));

    const mnemonic = new Mnemonic(walletInfo.mnemonic, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });

    console.log('=== CREATE MATCH ===\n');

    const escrow = getContract(
        deployInfo.contractAddress,
        ESCROW_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    const buyInAmount = 1000000n; // Must match what you approved
    const mode = 0n;              // CLASSIC
    const format = 0n;            // DUEL (2 players)

    console.log('Simulating createMatch...');
    console.log(`  buyIn: ${buyInAmount}, mode: CLASSIC, format: DUEL`);

    try {
        const sim = await escrow.createMatch(buyInAmount, mode, format);

        if (sim.revert) {
            console.log('\nSimulation REVERTED:', sim.revert);
            console.log('Common causes:');
            console.log('  - Approve tx not confirmed yet (wait ~10 min)');
            console.log('  - Insufficient MOTO balance');
            console.log('  - Already in an active match');
            return;
        }

        console.log('Simulation OK!');
        console.log('Estimated gas:', sim.estimatedSatGas?.toString());

        const challenge = await provider.getChallenge();

        const txParams: TransactionParameters = {
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            refundTo: wallet.p2tr,
            maximumAllowedSatToSpend: 50000n,
            feeRate: 10,
            network: NETWORK,
            challenge,
        };

        console.log('\nSending createMatch tx...');
        const tx = await sim.sendTransaction(txParams);
        console.log('TX:', tx.transactionId);
        console.log('\nWait ~10 min, then run:');
        console.log('  node --experimental-vm-modules build/check-match.js');

    } catch (e: any) {
        console.log('createMatch error:', e.message || e);
    }
}

main().catch(console.error);
