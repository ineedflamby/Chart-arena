// @ts-nocheck
import {
    getContract,
    JSONRpcProvider,
    ABIDataTypes,
    BitcoinAbiTypes,
    BitcoinInterfaceAbi,
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
        name: 'getJackpot',
        type: BitcoinAbiTypes.Function,
        constant: true,
        inputs: [],
        outputs: [{ name: 'jackpot', type: ABIDataTypes.UINT256 }],
    },
];

const STATUS_NAMES: Record<string, string> = {
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

    console.log('=== CHECK MATCH STATE ===\n');

    // Check match 1 (first match created)
    try {
        const info = await escrow.getMatchInfo(1n);
        const p = info.properties;
        const statusStr = STATUS_NAMES[p.status.toString()] || p.status.toString();
        console.log('Match #1:');
        console.log('  buyIn:      ', p.buyIn.toString());
        console.log('  mode:       ', p.mode.toString(), p.mode === 0n ? '(CLASSIC)' : '');
        console.log('  format:     ', p.format.toString(), p.format === 0n ? '(DUEL)' : '');
        console.log('  status:     ', statusStr);
        console.log('  playerCount:', p.playerCount.toString());
        console.log('  maxPlayers: ', p.maxPlayers.toString());
        console.log('  lockBlock:  ', p.lockBlock.toString());
        console.log('  pot:        ', p.pot.toString());

        if (p.status === 1n) {
            console.log('\n✅ Match is OPEN — waiting for player 2 to join');
        } else if (p.status === 0n) {
            console.log('\n❌ Match not found — createMatch tx may not be confirmed yet');
        }
    } catch (e: any) {
        console.log('getMatchInfo error:', e.message || e);
    }

    // Check jackpot
    try {
        const jp = await escrow.getJackpot();
        console.log('\nJackpot:', jp.properties.jackpot.toString());
    } catch (e: any) {
        console.log('getJackpot error:', e.message || e);
    }
}

main().catch(console.error);
