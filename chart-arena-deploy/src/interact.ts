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

    console.log('Deployer:', wallet.p2tr);
    console.log('Escrow contract:', deployInfo.contractAddress);
    console.log('Token contract:', deployInfo.token);
    console.log('');

    // --- Step 1: Read contract state ---
    console.log('--- Reading contract state ---');

    const escrow = getContract(
        deployInfo.contractAddress,
        ESCROW_ABI,
        provider,
        NETWORK,
        wallet.address,
    );

    try {
        const jackpotResult = await escrow.getJackpot();
        console.log('Jackpot:', jackpotResult.properties.jackpot.toString());
    } catch (e) {
        console.log('getJackpot error:', e);
    }

    try {
        const matchInfo = await escrow.getMatchInfo(0n);
        console.log('Match 0 status:', matchInfo.properties.status.toString());
    } catch (e) {
        console.log('getMatchInfo(0) error (expected if no matches):', e);
    }

    console.log('\n--- Contract is responding! ---');
    console.log('Next step: approve tokens + createMatch');
}

main().catch(console.error);
