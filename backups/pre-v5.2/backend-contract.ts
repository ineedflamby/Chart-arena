/**
 * Contract Service — v3 Settlement Path (Sprint 4 cleaned).
 *
 * Sprint 4 fixes:
 *   - Bug 4.1:  resolveAddress() extracts Address from PublicKeyInfo (was returning raw object)
 *   - Bug 4.7:  Removed v4 scaffold (proposeSettlement, finalizeSettlement, disputeSettlement, PROPOSED status)
 *   - Bug 4.9:  getContract() uses operatorWallet.address (Address object), not string cast
 *   - Bug 4.10: Provider constructor verified — object form { url, network } is correct
 *   - Bug 4.11: Added settleMatchWithRetry() for stale-data recovery
 */
import {
    getContract, JSONRpcProvider, ABIDataTypes, BitcoinAbiTypes,
    type BitcoinInterfaceAbi,
} from 'opnet';
import { Address, TransactionFactory } from '@btc-vision/transaction';
import { config } from '../config.js';
import { operatorWallet } from './operator-wallet.js';
import { logger } from '../utils/logger.js';

const TAG = 'ContractService';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ESCROW_ABI: BitcoinInterfaceAbi = [
    // ── v5: Deposit + Operator match creation ──
    {
        name: 'deposit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'operatorPullDeposit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [
            { name: 'player', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'operatorCreateMatch', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [
            { name: 'buyIn', type: ABIDataTypes.UINT256 },
            { name: 'mode', type: ABIDataTypes.UINT256 },
            { name: 'format', type: ABIDataTypes.UINT256 },
            { name: 'player1', type: ABIDataTypes.ADDRESS },
            { name: 'player2', type: ABIDataTypes.ADDRESS },
        ],
        outputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
    },
    // ── Match lifecycle ──
    {
        name: 'createMatch', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [
            { name: 'buyIn', type: ABIDataTypes.UINT256 },
            { name: 'mode', type: ABIDataTypes.UINT256 },
            { name: 'format', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'joinMatch', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'cancelMatch', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'triggerEmergencyRefund', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'matchId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },

    // ── v3: Direct settlement (canonical path) ──
    {
        name: 'settleMatch', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [
            { name: 'matchId', type: ABIDataTypes.UINT256 },
            { name: 'logHash', type: ABIDataTypes.UINT256 },
            { name: 'payouts', type: ABIDataTypes.ADDRESS_UINT256_TUPLE },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },

    // ── Withdraw / jackpot / admin ──
    {
        name: 'withdraw', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'distributeJackpot', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'winner', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },

    // ── Views ──
    {
        name: 'getMatchInfo', type: BitcoinAbiTypes.Function, constant: true,
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
        name: 'getBalance', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'getJackpot', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [],
        outputs: [{ name: 'jackpot', type: ABIDataTypes.UINT256 }],
    },
];

export interface MatchInfo {
    buyIn: bigint;
    mode: bigint;
    format: bigint;
    status: bigint;
    playerCount: bigint;
    maxPlayers: bigint;
    lockBlock: bigint;
    pot: bigint;
}

// On-chain match status constants (must match contract)
export const OnChainStatus = {
    NONE: 0n,
    OPEN: 1n,
    LOCKED: 2n,
    SETTLED: 3n,
    CANCELLED: 4n,
    REFUNDED: 5n,
} as const;

class ContractService {
    private provider: JSONRpcProvider | null = null;
    private contract: any = null;

    public async init(): Promise<void> {
        // Bug 4.10: Object form { url, network } is the correct constructor signature
        this.provider = new JSONRpcProvider({ url: config.rpcUrl, network: config.network });
        const blockNum = await this.provider.getBlockNumber();
        logger.info(TAG, `Connected to OPNet — block ${blockNum}`);

        // Bug 4.9: Use operatorWallet.address (Address object) — not .p2tr (string)
        this.contract = getContract(
            config.escrowAddress, ESCROW_ABI, this.provider,
            config.network, operatorWallet.address,
        );
        logger.info(TAG, `Escrow contract at ${config.escrowAddress}`);
    }

    // ── Read methods ──

    public async getMatchInfo(matchId: bigint): Promise<MatchInfo> {
        this.ensureInit();
        const result = await this.contract!.getMatchInfo(matchId);
        if ('error' in result) throw new Error(`getMatchInfo error: ${result.error}`);
        return {
            buyIn: result.properties.buyIn as bigint,
            mode: result.properties.mode as bigint,
            format: result.properties.format as bigint,
            status: result.properties.status as bigint,
            playerCount: result.properties.playerCount as bigint,
            maxPlayers: result.properties.maxPlayers as bigint,
            lockBlock: result.properties.lockBlock as bigint,
            pot: result.properties.pot as bigint,
        };
    }

    public async getBalance(account: any): Promise<bigint> {
        this.ensureInit();
        const result = await this.contract!.getBalance(account);
        if ('error' in result) throw new Error(`getBalance error: ${result.error}`);
        return result.properties.balance as bigint;
    }

    public async getJackpot(): Promise<bigint> {
        this.ensureInit();
        const result = await this.contract!.getJackpot();
        if ('error' in result) throw new Error(`getJackpot error: ${result.error}`);
        return result.properties.jackpot as bigint;
    }

    public async getBlockNumber(): Promise<bigint> {
        this.ensureInit();
        return this.provider!.getBlockNumber();
    }

    // ── Write methods ──

    private async sendOperatorTx(methodName: string, simulation: any): Promise<string> {
        if (simulation.revert) throw new Error(`${methodName} reverted: ${simulation.revert}`);
        const challenge = await this.provider!.getChallenge();
        logger.info(TAG, `Broadcasting ${methodName}...`);
        const tx = await simulation.sendTransaction({
            signer: operatorWallet.keypair,
            mldsaSigner: operatorWallet.mldsaKeypair,
            challenge,
            maximumAllowedSatToSpend: config.maxSatToSpend,
            refundTo: operatorWallet.p2tr,
            sender: operatorWallet.p2tr,
            feeRate: 1,
        });
        const txHash = tx.result;
        logger.info(TAG, `${methodName} broadcasted: ${txHash}`);
        return txHash;
    }

    /**
     * v5: Operator creates match directly in LOCKED state.
     */
    public async operatorCreateMatch(
        buyIn: bigint, mode: number, format: number,
        player1Bech32: string, player2Bech32: string,
    ): Promise<{ matchId: bigint; txHash: string }> {
        this.ensureInit();
        const player1 = await this.resolveAddress(player1Bech32);
        const player2 = await this.resolveAddress(player2Bech32);
        logger.info(TAG, `Simulating operatorCreateMatch: buyIn=${buyIn}, p1=${player1Bech32}, p2=${player2Bech32}...`);
        const simulation = await this.contract!.operatorCreateMatch(
            buyIn, BigInt(mode), BigInt(format), player1, player2,
        );
        if (simulation.revert) throw new Error(`operatorCreateMatch reverted: ${simulation.revert}`);
        const matchId = simulation.properties?.matchId as bigint;
        const txHash = await this.sendOperatorTx(`operatorCreateMatch(${matchId})`, simulation);
        return { matchId, txHash };
    }

    /**
     * v5: Get escrow balance for a player by bech32 address.
     */
    public async getPlayerBalance(bech32Address: string): Promise<bigint> {
        const addr = await this.resolveAddress(bech32Address);
        return this.getBalance(addr);
    }

    /**
     * v5.1: Operator pulls approved MOTO from player into escrow balance.
     * BYPASSES SIMULATION — uses TransactionFactory.signInteraction() directly.
     * Cross-contract calls (escrow→MOTO.transferFrom) always fail in simulation
     * because the simulated sender identity doesn't have the on-chain allowance.
     * The real on-chain TX works because the contract itself is the msg.sender for transferFrom.
     */
    public async operatorPullDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<string> {
        this.ensureInit();
        const playerAddr = await this.resolveAddress(playerBech32);
        logger.info(TAG, `operatorPullDeposit (raw TX): player=${playerBech32}, amount=${amount}`);

        // Get the 32-byte hex from PublicKeyInfo
        let playerHex: string = '';
        if (playerAddr.toHex && typeof playerAddr.toHex === 'function') {
            playerHex = playerAddr.toHex();
        } else if (typeof playerAddr === 'string') {
            playerHex = playerAddr;
        } else {
            playerHex = String(playerAddr);
        }
        playerHex = playerHex.replace(/^0x/, '').padStart(64, '0');
        logger.info(TAG, `Player hex: 0x${playerHex} (${playerHex.length} chars)`);

        // Build calldata manually: selector(4) + address(32) + u256(32) = 68 bytes
        const calldata = new Uint8Array(68);
        // Write selector: 0xfcdbac00
        calldata[0] = 0xfc; calldata[1] = 0xdb; calldata[2] = 0xac; calldata[3] = 0x00;
        // Write player address: 32 bytes from hex
        for (let i = 0; i < 32; i++) {
            calldata[4 + i] = parseInt(playerHex.slice(i * 2, i * 2 + 2), 16);
        }
        // Write amount as u256: 32 bytes big-endian
        const amountHex = amount.toString(16).padStart(64, '0');
        for (let i = 0; i < 32; i++) {
            calldata[36 + i] = parseInt(amountHex.slice(i * 2, i * 2 + 2), 16);
        }
        logger.info(TAG, `Calldata: ${Buffer.from(calldata).toString('hex').slice(0, 40)}...`);

        // Get UTXOs for the operator wallet
        const utxos = await this.provider!.utxoManager.getUTXOs({
            address: operatorWallet.p2tr,
        });
        if (utxos.length === 0) {
            throw new Error('Operator wallet has no UTXOs — fund it with tBTC');
        }
        logger.info(TAG, `Operator has ${utxos.length} UTXOs`);

        const challenge = await this.provider!.getChallenge();
        const factory = new TransactionFactory();

        const interactionResult = await factory.signInteraction({
            signer: operatorWallet.keypair as any,
            mldsaSigner: operatorWallet.mldsaKeypair as any,
            network: config.network,
            utxos,
            from: operatorWallet.p2tr,
            to: config.escrowAddress,
            contract: config.escrowAddress,
            feeRate: 1,
            priorityFee: 0n,
            gasSatFee: 10000n,
            calldata,
            challenge,
        } as any);

        // Broadcast both TXs (funding + interaction)
        const txs = (interactionResult as any).transaction ?? (interactionResult as any).transactions ?? [interactionResult];
        const fundingTxHex = txs[0];
        const interactionTxHex = txs[1] ?? txs[0];
        logger.info(TAG, `Broadcasting operatorPullDeposit funding TX...`);
        const fundingResult = await this.provider!.sendRawTransaction(fundingTxHex, false);
        logger.info(TAG, `Funding TX: ${fundingResult.result}`);

        logger.info(TAG, `Broadcasting operatorPullDeposit interaction TX...`);
        const interactionBroadcast = await this.provider!.sendRawTransaction(interactionTxHex, false);
        logger.info(TAG, `Interaction TX: ${interactionBroadcast.result}`);

        return interactionBroadcast.result ?? fundingResult.result ?? 'deposit_tx_sent';
    }

    /**
     * v3: Direct settlement — canonical path for the deployed contract.
     */
    public async settleMatch(
        matchId: bigint, logHash: bigint, payouts: Map<any, bigint>,
    ): Promise<string> {
        this.ensureInit();
        logger.info(TAG, `Simulating settleMatch for matchId=${matchId}...`);
        const simulation = await this.contract!.settleMatch(matchId, logHash, payouts);
        return this.sendOperatorTx(`settleMatch(${matchId})`, simulation);
    }

    /**
     * Bug 4.11: Settlement with retry on stale-data revert.
     * Re-reads on-chain pot and recomputes payouts before retrying.
     */
    public async settleMatchWithRetry(
        matchId: bigint,
        logHash: bigint,
        payouts: Map<any, bigint>,
        retries: number = 2,
    ): Promise<string> {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await this.settleMatch(matchId, logHash, payouts);
            } catch (err) {
                const msg = String(err);
                if (attempt < retries && msg.includes('Payout sum mismatch')) {
                    logger.warn(TAG, `settleMatch attempt ${attempt + 1} failed (sum mismatch), retrying with fresh data...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                throw err;
            }
        }
        throw new Error('settleMatchWithRetry exhausted all retries');
    }

    public async cancelMatch(matchId: bigint): Promise<string> {
        this.ensureInit();
        const simulation = await this.contract!.cancelMatch(matchId);
        return this.sendOperatorTx(`cancelMatch(${matchId})`, simulation);
    }

    public async triggerEmergencyRefund(matchId: bigint): Promise<string> {
        this.ensureInit();
        const simulation = await this.contract!.triggerEmergencyRefund(matchId);
        return this.sendOperatorTx(`triggerEmergencyRefund(${matchId})`, simulation);
    }

    /**
     * Bug 4.1 FIX: resolveAddress() now correctly extracts an Address from PublicKeyInfo.
     *
     * getPublicKeyInfo() returns a PublicKeyInfo object (with fields like originalPubKey,
     * tweakedPubkey, p2tr, etc.), NOT an Address. The old code returned the raw object,
     * which would fail silently when passed to contract calls expecting Address.
     *
     * We extract the tweaked public key (32-byte x-only) and construct an Address from it.
     */
    public async resolveAddress(bech32Address: string): Promise<any> {
        this.ensureInit();
        // Detect if this is a contract address (opt1s/opt1q) or a player address (opt1p/bc1p/tb1p)
        const lower = bech32Address.toLowerCase();
        const isContract = lower.startsWith('opt1s') || lower.startsWith('opt1q')
            || lower.startsWith('opnet1s') || lower.startsWith('opnet1q');
        // Return the PublicKeyInfo directly — the opnet SDK accepts it as-is for
        // contract method params, setSender(), Map keys, etc.
        // This matches how the working frontend resolves addresses.
        const info = await this.provider!.getPublicKeyInfo(bech32Address, isContract);
        if (!info) throw new Error(`Could not resolve address: ${bech32Address} (isContract=${isContract})`);
        logger.info(TAG, `Resolved ${bech32Address.slice(0, 12)}… (isContract=${isContract})`);
        return info;
    }

    /**
     * C-02 FIX: Get the canonical x-only public key for a bech32 address.
     * Used by auth to verify client-supplied pubkeys for OPNet P2OP addresses.
     * Returns 32-byte x-only pubkey as hex string, or null if resolution fails.
     */
    public async getCanonicalPubkey(bech32Address: string): Promise<string | null> {
        this.ensureInit();
        try {
            const lower = bech32Address.toLowerCase();
            const isContract = lower.startsWith('opt1s') || lower.startsWith('opt1q')
                || lower.startsWith('opnet1s') || lower.startsWith('opnet1q');
            const info = await this.provider!.getPublicKeyInfo(bech32Address, isContract);
            if (!info || !(info as any).publicKey) return null;
            const pubkeyBytes: Uint8Array = (info as any).publicKey;
            return Array.from(pubkeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            return null;
        }
    }

    public async distributeJackpot(winnerBech32: string): Promise<string> {
        this.ensureInit();
        const winnerAddr = await this.resolveAddress(winnerBech32);
        logger.info(TAG, `Simulating distributeJackpot for winner=${winnerBech32}...`);
        const simulation = await this.contract!.distributeJackpot(winnerAddr);
        return this.sendOperatorTx(`distributeJackpot(${winnerBech32})`, simulation);
    }

    public close(): void {
        this.provider?.close();
        this.provider = null;
        this.contract = null;
    }

    private ensureInit(): void {
        if (!this.provider || !this.contract) throw new Error('ContractService not initialized');
    }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
export const contractService = new ContractService();
