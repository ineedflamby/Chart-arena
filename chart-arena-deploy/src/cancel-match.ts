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
        name: 'cancelMatch',
        type: BitcoinAbiTypes.Function,
        constant: false,
        inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'getBalance',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
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
    {
        name: 'withdraw',
        type: BitcoinAbiTypes.Function,
        constant: false,
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
];

const STATUS_NAMES = {
    '0': 'NONE', '1': 'OPEN', '2': 'LOCKED', '3': 'SETTLED', '4': 'CANCELLED', '5': 'REFUNDED',
};

async function main(): Promise<void> {
    const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
    const deployInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));

    const mnemonic = new Mnemonic(walletInfo.mnemonic, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
    const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });

    const escrow = getContract(
        deployInfo.contractAddress,
        ESCROW_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    const matchId = 1n;

    // Step 1: Check match state before cancel
    console.log('=== CANCEL MATCH TEST ===\n');
    try {
        const info = await escrow.getMatchInfo(matchId);
        const s = info.properties.status.toString();
        console.log(`Match #${matchId} status: ${STATUS_NAMES[s] || s}`);
        if (s !== '1') {
            console.log('Match is not OPEN — cannot cancel.');
            return;
        }
    } catch (e) {
        console.log('getMatchInfo error:', e.message || e);
        return;
    }

    // Step 2: Check escrow internal balance before cancel
    try {
        const bal = await escrow.getBalance(wallet.address);
        console.log('Internal balance before cancel:', bal.properties.balance.toString());
    } catch (e) {
        console.log('getBalance error:', e.message || e);
    }

    // Step 3: Simulate cancelMatch
    console.log('\nSimulating cancelMatch...');
    try {
        const sim = await escrow.cancelMatch(matchId);

        if (sim.revert) {
            console.log('cancelMatch simulation REVERTED:', sim.revert);
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

        console.log('Sending cancelMatch tx...');
        const tx = await sim.sendTransaction(txParams);
        console.log('TX:', tx.transactionId);
        console.log('\nWait ~10 min for confirmation, then run:');
        console.log('  node --experimental-vm-modules build/withdraw.js');

    } catch (e) {
        console.log('cancelMatch error:', e.message || e);
    }
}

main().catch(console.error);
