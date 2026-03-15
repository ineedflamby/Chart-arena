// @ts-nocheck
import {
    getContract,
    JSONRpcProvider,
    OP_20_ABI,
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
        name: 'getBalance',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'withdraw',
        type: BitcoinAbiTypes.Function,
        constant: false,
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
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

const STATUS_NAMES = {
    '0': 'NONE', '1': 'OPEN', '2': 'LOCKED', '3': 'SETTLED', '4': 'CANCELLED', '5': 'REFUNDED',
};

async function main(): Promise<void> {
    const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
    const deployInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));

    const mnemonic = new Mnemonic(walletInfo.mnemonic, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);
    const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });

    const token = getContract(deployInfo.token, OP_20_ABI, provider, NETWORK, wallet.address);
    const escrow = getContract(
        deployInfo.contractAddress,
        ESCROW_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    console.log('=== WITHDRAW TEST ===\n');

    // Step 1: Check match status (should be CANCELLED after cancel-match.js)
    try {
        const info = await escrow.getMatchInfo(1n);
        const s = info.properties.status.toString();
        console.log(`Match #1 status: ${STATUS_NAMES[s] || s}`);
    } catch (e) {
        console.log('getMatchInfo error:', e.message || e);
    }

    // Step 2: Check internal balance (should have buy-in credited from cancel)
    let internalBal = 0n;
    try {
        const bal = await escrow.getBalance(wallet.address);
        internalBal = bal.properties.balance;
        console.log('Internal escrow balance:', internalBal.toString());
        if (internalBal === 0n) {
            console.log('No balance to withdraw. cancelMatch may not be confirmed yet.');
            return;
        }
    } catch (e) {
        console.log('getBalance error:', e.message || e);
        return;
    }

    // Step 3: Check MOTO balance before withdraw
    try {
        const motoBefore = await token.balanceOf(wallet.address);
        console.log('MOTO balance before withdraw:', motoBefore.properties.balance.toString());
    } catch (e) {
        console.log('MOTO balance error:', e.message || e);
    }

    // Step 4: Simulate withdraw
    console.log('\nSimulating withdraw...');
    try {
        const sim = await escrow.withdraw();

        if (sim.revert) {
            console.log('withdraw simulation REVERTED:', sim.revert);
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

        console.log('Sending withdraw tx...');
        const tx = await sim.sendTransaction(txParams);
        console.log('TX:', tx.transactionId);
        console.log('\nWait ~10 min, then check MOTO balance in OP_WALLET.');
        console.log('Your buy-in should be returned!');

    } catch (e) {
        console.log('withdraw error:', e.message || e);
    }
}

main().catch(console.error);
