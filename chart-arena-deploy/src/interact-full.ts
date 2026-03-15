// @ts-nocheck
import {
    getContract,
    JSONRpcProvider,
    OP_20_ABI,
    IOP20Contract,
    TransactionParameters,
    ABIDataTypes,
    BitcoinAbiTypes,
    BitcoinInterfaceAbi,
} from 'opnet';
import {
    Mnemonic,
    AddressTypes,
    MLDSASecurityLevel,
    Address,
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
    {
        name: 'getBalance',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'getJackpot',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'jackpot', type: ABIDataTypes.UINT256 }],
    },
];

async function main(): Promise<void> {
    const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
    const deployInfo = JSON.parse(fs.readFileSync('deployment.json', 'utf-8'));

    const mnemonic = new Mnemonic(walletInfo.mnemonic, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });

    console.log('=== CHART ARENA INTERACTION TEST ===\n');
    console.log('Wallet:  ', wallet.p2tr);
    console.log('Contract:', deployInfo.contractAddress);
    console.log('Token:   ', deployInfo.token);
    console.log('');

    // Decode bech32 contract address → Address object
    // Address.fromString() only takes hex, so we decode the bech32 manually
    // Resolve contract address to proper Address object
    const escrowAddr = await provider.getPublicKeyInfo(deployInfo.contractAddress, true);
    console.log('Escrow address resolved:', escrowAddr.toHex());

    const escrow = getContract(
        deployInfo.contractAddress,
        ESCROW_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    const token = getContract<IOP20Contract>(
        deployInfo.token,
        OP_20_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    // ---- Step 1: Check MOTO balance ----
    console.log('\n--- Step 1: Check MOTO balance ---');
    let motoBalance = 0n;
    try {
        const balResult = await token.balanceOf(wallet.address);
        motoBalance = balResult.properties.balance;
        console.log('MOTO balance (raw):', motoBalance.toString());
        if (motoBalance === 0n) {
            console.log('ERROR: No MOTO. Swap tBTC → MOTO on https://motoswap.org');
            return;
        }
    } catch (e: any) {
        console.log('balanceOf error:', e.message || e);
        return;
    }

    // ---- Step 2: Check contract state ----
    console.log('\n--- Step 2: Check contract state ---');
    try {
        const jackpot = await escrow.getJackpot();
        console.log('Jackpot:', jackpot.properties.jackpot.toString());
    } catch (e: any) {
        console.log('getJackpot error:', e.message || e);
    }

    // ---- Step 3: Approve MOTO for escrow ----
    console.log('\n--- Step 3: Approve MOTO for escrow ---');
    const buyInAmount = 1000000n; // 0.01 MOTO (8 decimals) — small test amount

    console.log('Buy-in amount:', buyInAmount.toString());
    console.log('Approving escrow address:', escrowAddr.toHex());

    try {
        const approveSim = await token.increaseAllowance(
            escrowAddr,  // Address object, not string
            buyInAmount,
        );

        if (approveSim.revert) {
            console.log('Approve simulation REVERTED:', approveSim.revert);
            return;
        }

        console.log('Approve simulation OK');
        console.log('Estimated gas:', approveSim.estimatedSatGas?.toString());

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

        console.log('Sending approve tx...');
        const approveTx = await approveSim.sendTransaction(txParams);
        console.log('Approve TX:', approveTx.transactionId);
        console.log('\nWait ~10 min for confirmation, then run:');
        console.log('  node --experimental-vm-modules build/create-match.js');

    } catch (e: any) {
        console.log('Approve error:', e.message || e);
        console.log('Stack:', e.stack);
        return;
    }
}

main().catch(console.error);
