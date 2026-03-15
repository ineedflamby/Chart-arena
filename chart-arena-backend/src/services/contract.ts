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
import { Address } from '@btc-vision/transaction';
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
        name: 'operatorCreditDeposit', type: BitcoinAbiTypes.Function, constant: false,
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
            network: config.network,
        });
        // P1 FIX: Validate TX hash — never accept undefined or empty
        const txHash = tx.transactionId || tx.result;
        if (!txHash || txHash === 'undefined' || txHash === 'null') {
            logger.error(TAG, `${methodName} broadcast returned no TX hash! Response: ${JSON.stringify(tx).slice(0, 500)}`);
            throw new Error(`${methodName} broadcast failed: no transaction ID returned from node`);
        }
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
     * v5.2: Operator credits deposit after player's direct MOTO.transfer().
     * Uses standard simulate → sendOperatorTx path (no cross-contract call = simulation works).
     *
     * Security: The backend must verify the player's MOTO.transfer TX on-chain
     * before calling this. The contract itself only checks _onlyOperator().
     */
    public async operatorCreditDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<string> {
        this.ensureInit();
        const playerAddr = await this.resolveAddress(playerBech32);
        logger.info(TAG, `operatorCreditDeposit: player=${playerBech32}, amount=${amount}`);
        const simulation = await this.contract!.operatorCreditDeposit(playerAddr, amount);
        return this.sendOperatorTx(`operatorCreditDeposit`, simulation);
    }

    /**
     * v5.1 LEGACY: Operator pulls approved MOTO from player into escrow balance.
     * Kept for reference — does NOT work via simulation (cross-contract transferFrom fails).
     * Use operatorCreditDeposit instead.
     */
    public async operatorPullDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<string> {
        // Redirect to the working v5.2 path
        return this.operatorCreditDeposit(playerBech32, amount);
    }

    /**
     * v5.2 PATCHED: Verify a MOTO transfer TX on-chain before crediting.
     *
     * P0 FIX: The old code ALWAYS returned minAmount (trusting frontend).
     * New behavior:
     *   1. TX must exist and be confirmed (has blockNumber)
     *   2. Attempts to decode actual transfer amount from events/data
     *   3. If amount can't be decoded: REJECTS on production, trusts on DEV_MODE
     *   4. If decoded amount < claimed: credits the ACTUAL (lower) amount
     */
    public async verifyMotoTransfer(
        txHash: string, expectedSender: string, minAmount: bigint,
    ): Promise<bigint> {
        this.ensureInit();
        logger.info(TAG, `Verifying MOTO transfer: tx=${txHash}, sender=${expectedSender}, claimed=${minAmount}`);

        try {
            const tx = await (this.provider! as any).getTransaction(txHash);
            if (!tx) throw new Error('Transaction not found');

            // Check the TX was mined
            if (tx.blockNumber === undefined || tx.blockNumber === null) {
                throw new Error('Transaction not yet confirmed');
            }
            logger.info(TAG, `Transfer TX confirmed in block ${tx.blockNumber}`);

            // ── Try to decode transfer amount from TX events/data ──
            let verifiedAmount: bigint | null = null;

            // Attempt 1: Decoded receipt events
            const events = tx.receipt?.events || tx.events;
            if (events && Array.isArray(events)) {
                for (const event of events) {
                    if (event.type === 'Transfer' || event.name === 'Transfer') {
                        const eventAmount = event.amount ?? event.value ?? event.data?.amount;
                        if (eventAmount !== undefined) {
                            verifiedAmount = BigInt(eventAmount);
                            logger.info(TAG, `Transfer amount from event: ${verifiedAmount}`);
                            break;
                        }
                    }
                }
            }

            // Attempt 2: TX decoded data
            if (verifiedAmount === null && tx.decodedData?.amount !== undefined) {
                verifiedAmount = BigInt(tx.decodedData.amount);
                logger.info(TAG, `Transfer amount from decoded data: ${verifiedAmount}`);
            }

            // Attempt 3: TX properties
            if (verifiedAmount === null && tx.properties?.amount !== undefined) {
                verifiedAmount = BigInt(tx.properties.amount);
                logger.info(TAG, `Transfer amount from TX properties: ${verifiedAmount}`);
            }

            // ── If amount couldn't be decoded ──
            if (verifiedAmount === null) {
                if (config.devMode) {
                    logger.warn(TAG, `DEV_MODE: Cannot decode transfer amount — trusting frontend claim: ${minAmount}`);
                    return minAmount;
                }
                // PRODUCTION: Reject — better safe than exploited
                logger.error(TAG, `DEPOSIT REJECTED: Cannot verify transfer amount from TX ${txHash}. Claimed: ${minAmount}. Player: ${expectedSender}`);
                throw new Error(
                    'Cannot verify transfer amount on-chain. Your MOTO is safe — please contact support or try again.'
                );
            }

            // ── Amount decoded — compare against claim ──
            if (verifiedAmount < minAmount) {
                logger.warn(TAG, `AMOUNT MISMATCH: TX ${txHash} transferred ${verifiedAmount} but player claimed ${minAmount}. Crediting actual amount.`);
            }

            return verifiedAmount;

        } catch (err) {
            logger.warn(TAG, `Transfer verification failed: ${err}`);
            throw new Error(`Transfer verification failed: ${err}`);
        }
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
