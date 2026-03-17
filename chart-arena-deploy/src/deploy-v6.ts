import {
    BinaryWriter,
    IDeploymentParameters,
    TransactionFactory,
    Mnemonic,
    MLDSASecurityLevel,
    AddressTypes,
    Address,
} from '@btc-vision/transaction';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import * as fs from 'fs';

const NETWORK = networks.opnetTestnet;
const RPC_URL = 'https://testnet.opnet.org';
const WASM_PATH = '../chart-arena-escrow/build/ChartArenaEscrow.wasm';

// MOTO token on testnet
const TOKEN_ADDRESS = '0xfd4473840751d58d9f8b73bdd57d6c5260453d5518bd7cd02d0a4cf3df9bf4dd';

// Load role addresses from roles.json
const roles = JSON.parse(fs.readFileSync('roles.json', 'utf-8'));
const OPERATOR_ADDRESS   = roles.operator.hex;
const GUARDIAN_ADDRESS    = roles.guardian.hex;   // v6 NEW
const TREASURY_ADDRESS   = roles.treasury.hex;
const PRIZE_POOL_ADDRESS = roles.prizePool.hex;

async function main(): Promise<void> {
    const walletInfo = JSON.parse(fs.readFileSync('wallet.json', 'utf-8'));
    const mnemonic = new Mnemonic(walletInfo.mnemonic, '', NETWORK, MLDSASecurityLevel.LEVEL2);
    const wallet = mnemonic.deriveOPWallet(AddressTypes.P2TR, 0);

    console.log('Deployer address:', wallet.p2tr);

    const provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });
    const factory = new TransactionFactory();

    const utxos = await provider.utxoManager.getUTXOs({ address: wallet.p2tr });
    if (utxos.length === 0) {
        console.error('ERROR: No UTXOs. Fund your wallet first.');
        console.error('Address:', wallet.p2tr);
        return;
    }
    console.log(`Found ${utxos.length} UTXOs`);

    const bytecode = new Uint8Array(fs.readFileSync(WASM_PATH));
    console.log(`WASM bytecode: ${bytecode.length} bytes`);
    if (bytecode.length === 0) {
        console.error('ERROR: WASM file is empty.');
        return;
    }

    // v6: 5 calldata params — token, operator, GUARDIAN, treasury, prizePool
    const calldata = new BinaryWriter();
    calldata.writeAddress(Address.fromString(TOKEN_ADDRESS));
    calldata.writeAddress(Address.fromString(OPERATOR_ADDRESS));
    calldata.writeAddress(Address.fromString(GUARDIAN_ADDRESS));   // v6 NEW
    calldata.writeAddress(Address.fromString(TREASURY_ADDRESS));
    calldata.writeAddress(Address.fromString(PRIZE_POOL_ADDRESS));

    console.log('\nv6 Deployment parameters:');
    console.log('  Token:      ', TOKEN_ADDRESS);
    console.log('  Operator:   ', OPERATOR_ADDRESS);
    console.log('  Guardian:   ', GUARDIAN_ADDRESS, '  ← NEW');
    console.log('  Treasury:   ', TREASURY_ADDRESS);
    console.log('  Prize Pool: ', PRIZE_POOL_ADDRESS, '\n');

    const challenge = await provider.getChallenge();

    const deploymentParams: IDeploymentParameters = {
        from: wallet.p2tr,
        utxos,
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network: NETWORK,
        feeRate: 10,
        priorityFee: 0n,
        gasSatFee: 10_000n,
        bytecode,
        calldata: calldata.getBuffer(),
        challenge,
        linkMLDSAPublicKeyToAddress: true,
        revealMLDSAPublicKey: true,
    };

    console.log('Signing deployment transaction...');
    const deployment = await factory.signDeployment(deploymentParams);

    console.log(`\n=== DEPLOYMENT RESULT ===`);
    console.log(`Contract address: ${deployment.contractAddress}\n`);

    console.log('Broadcasting funding transaction...');
    const fundingResult = await provider.sendRawTransaction(deployment.transaction[0], false);
    console.log('Funding TX:', fundingResult.result);

    console.log('Broadcasting reveal transaction...');
    const revealResult = await provider.sendRawTransaction(deployment.transaction[1], false);
    console.log('Reveal TX: ', revealResult.result);

    console.log('\n=== v6 DEPLOYMENT SUBMITTED ===');
    console.log('Contract:', deployment.contractAddress, '\n');

    const deployInfo = {
        contractAddress: deployment.contractAddress,
        fundingTx: fundingResult.result,
        revealTx: revealResult.result,
        network: 'testnet',
        version: 'v6-guardian',
        token: TOKEN_ADDRESS,
        operator: OPERATOR_ADDRESS,
        guardian: GUARDIAN_ADDRESS,
        treasury: TREASURY_ADDRESS,
        prizePool: PRIZE_POOL_ADDRESS,
        deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync('deployment-v6.json', JSON.stringify(deployInfo, null, 2));
    console.log('Deployment info saved to deployment-v6.json');

    provider.close();
}

main().catch((err) => {
    console.error('Deployment failed:', err);
    process.exit(1);
});
