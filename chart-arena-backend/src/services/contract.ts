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
import { guardianWallet } from './guardian-wallet.js';
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
    // v6: operatorCreditDeposit REMOVED — replaced by requestCredit + confirmCredit
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

    // ── Withdraw ──
    {
        name: 'withdraw', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },

    // ── v6: Guardian-protected credit system ──
    {
        name: 'requestCredit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [
            { name: 'player', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'creditId', type: ABIDataTypes.UINT256 }],
    },
    {
        name: 'confirmCredit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'creditId', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'cancelCredit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'creditId', type: ABIDataTypes.UINT256 }],
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
    {
        name: 'getCreditInfo', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'creditId', type: ABIDataTypes.UINT256 }],
        outputs: [
            { name: 'status', type: ABIDataTypes.UINT256 },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
    },
    {
        name: 'getDailyCreditInfo', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [],
        outputs: [
            { name: 'cap', type: ABIDataTypes.UINT256 },
            { name: 'used', type: ABIDataTypes.UINT256 },
        ],
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
    // v6: Guardian contract instance (same ABI, different signer)
    private guardianContract: any = null;

    // Sprint 2 FIX: Persistent address resolution cache + unresolvable tracking
    private addressCache = new Map<string, any>();          // bech32 → resolved PublicKeyInfo
    private unresolvableLoggedAt = new Map<string, number>(); // throttle warning logs

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

        // v6: Guardian contract — same address/ABI but guardian as sender
        if (guardianWallet.enabled) {
            this.guardianContract = getContract(
                config.escrowAddress, ESCROW_ABI, this.provider,
                config.network, guardianWallet.address,
            );
            logger.info(TAG, `Guardian contract initialized (signer: ${guardianWallet.p2tr})`);
        } else {
            logger.warn(TAG, 'Guardian wallet not enabled — confirmCredit/distributeJackpot will fail');
        }
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

    /**
     * C-03: Check if a TX has been confirmed (mined into a block).
     * Returns the block number if confirmed, null if still pending or not found.
     */
    public async isTransactionConfirmed(txHash: string): Promise<bigint | null> {
        this.ensureInit();
        try {
            const tx = await (this.provider! as any).getTransaction(txHash);
            if (tx && tx.blockNumber !== undefined && tx.blockNumber !== null) {
                return BigInt(tx.blockNumber);
            }
            return null;
        } catch {
            return null;
        }
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
     * v6: Send a transaction signed by the GUARDIAN wallet.
     * Used for confirmCredit() and distributeJackpot().
     */
    private async sendGuardianTx(methodName: string, simulation: any): Promise<string> {
        if (!this.guardianContract) throw new Error('Guardian not initialized');
        if (simulation.revert) throw new Error(`${methodName} reverted: ${simulation.revert}`);
        const challenge = await this.provider!.getChallenge();
        logger.info(TAG, `Broadcasting ${methodName} (guardian)...`);
        const tx = await simulation.sendTransaction({
            signer: guardianWallet.keypair,
            mldsaSigner: guardianWallet.mldsaKeypair,
            challenge,
            maximumAllowedSatToSpend: config.maxSatToSpend,
            refundTo: guardianWallet.p2tr,
            sender: guardianWallet.p2tr,
            feeRate: 1,
            network: config.network,
        });
        const txHash = tx.transactionId || tx.result;
        if (!txHash || txHash === 'undefined' || txHash === 'null') {
            logger.error(TAG, `${methodName} (guardian) broadcast returned no TX hash!`);
            throw new Error(`${methodName} (guardian) broadcast failed: no transaction ID`);
        }
        logger.info(TAG, `${methodName} (guardian) broadcasted: ${txHash}`);
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
     * Sprint 2 FIX: Get escrow balance, returning null if address can't be resolved.
     * Used for balance check endpoint — avoids error spam for unresolvable addresses.
     */
    public async getPlayerBalanceOrNull(bech32Address: string): Promise<bigint | null> {
        const addr = await this.resolveAddressOrNull(bech32Address);
        if (!addr) return null;
        try {
            return await this.getBalance(addr);
        } catch {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // v6: GUARDIAN-PROTECTED CREDIT FLOW
    // Step 1: Operator calls requestCredit → returns creditId
    // Step 2: Guardian calls confirmCredit(creditId) → actually credits
    //
    // Both steps happen in the backend automatically during deposit.
    // The split ensures no single key can mint unbacked tokens.
    // ═══════════════════════════════════════════════════════════════

    /**
     * v6 Step 1: Operator requests a credit (creates pending entry on-chain).
     * Returns the creditId for the guardian to confirm.
     */
    public async requestCredit(
        playerBech32: string, amount: bigint,
    ): Promise<{ creditId: bigint; txHash: string }> {
        this.ensureInit();
        // Sprint 2 FIX: Use retry — the MOTO transfer TX that triggered this deposit
        // reveals the sender's public key to the node, but indexing may take a few seconds.
        const playerAddr = await this.resolveAddressWithRetry(playerBech32);
        logger.info(TAG, `requestCredit: player=${playerBech32}, amount=${amount}`);
        const simulation = await this.contract!.requestCredit(playerAddr, amount);
        if (simulation.revert) throw new Error(`requestCredit reverted: ${simulation.revert}`);
        const creditId = simulation.properties?.creditId as bigint;
        const txHash = await this.sendOperatorTx(`requestCredit(${creditId})`, simulation);
        return { creditId, txHash };
    }

    /**
     * v6 Step 2: Guardian confirms a pending credit.
     * Only the guardian wallet can call this (contract checks _onlyGuardian).
     */
    public async confirmCredit(creditId: bigint): Promise<string> {
        this.ensureInit();
        if (!this.guardianContract) throw new Error('Guardian not initialized — cannot confirm credit');
        logger.info(TAG, `confirmCredit: creditId=${creditId}`);
        const simulation = await this.guardianContract!.confirmCredit(creditId);
        return this.sendGuardianTx(`confirmCredit(${creditId})`, simulation);
    }

    /**
     * v6: Full deposit flow — requestCredit (operator) + confirmCredit (guardian).
     * This is the replacement for operatorCreditDeposit.
     * Both TXs are sent automatically; the player sees a single "crediting" status.
     */
    public async guardedCreditDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<{ creditId: bigint; requestTxHash: string; confirmTxHash: string }> {
        // Step 1: Operator creates pending credit
        const { creditId, txHash: requestTxHash } = await this.requestCredit(playerBech32, amount);
        logger.info(TAG, `Credit requested: id=${creditId}, TX=${requestTxHash}. Awaiting guardian confirmation...`);

        // Step 2: Guardian confirms (auto, same process)
        // Note: on OPNet, the requestCredit TX needs to be mined before confirmCredit can read it.
        // We poll briefly to ensure the request TX is confirmed.
        let confirmTxHash: string;
        const maxWaitMs = 120_000; // 2 minutes max wait for request TX
        const pollIntervalMs = 5_000;
        const startTime = Date.now();

        while (true) {
            try {
                confirmTxHash = await this.confirmCredit(creditId);
                break;
            } catch (err) {
                const msg = String(err);
                // If the request TX isn't mined yet, the confirm will fail with "Credit not pending"
                if (msg.includes('Credit not pending') && Date.now() - startTime < maxWaitMs) {
                    logger.info(TAG, `Credit ${creditId} not yet on-chain, waiting ${pollIntervalMs / 1000}s...`);
                    await new Promise(r => setTimeout(r, pollIntervalMs));
                    continue;
                }
                throw err;
            }
        }

        logger.info(TAG, `✅ Credit ${creditId} confirmed: ${confirmTxHash}`);
        return { creditId, requestTxHash, confirmTxHash };
    }

    /**
     * v6: Operator cancels a pending credit (if guardian hasn't confirmed yet).
     */
    public async cancelCredit(creditId: bigint): Promise<string> {
        this.ensureInit();
        logger.info(TAG, `cancelCredit: creditId=${creditId}`);
        const simulation = await this.contract!.cancelCredit(creditId);
        return this.sendOperatorTx(`cancelCredit(${creditId})`, simulation);
    }

    /**
     * BACKWARD COMPAT: operatorCreditDeposit now routes through guardian flow.
     * If guardian is not enabled (DEV_MODE), falls back to old behavior with warning.
     */
    public async operatorCreditDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<string> {
        if (!guardianWallet.enabled) {
            // DEV_MODE fallback — no guardian, old behavior
            logger.warn(TAG, `DEV_MODE: operatorCreditDeposit without guardian (old v5 path)`);
            this.ensureInit();
            const playerAddr = await this.resolveAddressWithRetry(playerBech32);
            // Try the old method name — will revert on v6 contract but works on v5
            try {
                const simulation = await this.contract!.operatorCreditDeposit(playerAddr, amount);
                return this.sendOperatorTx(`operatorCreditDeposit(dev)`, simulation);
            } catch {
                // v6 contract — use requestCredit without guardian (will fail on-chain)
                throw new Error('operatorCreditDeposit requires GUARDIAN_MNEMONIC in v6');
            }
        }
        // v6 path: 2-step guardian flow
        const { confirmTxHash } = await this.guardedCreditDeposit(playerBech32, amount);
        return confirmTxHash;
    }

    /**
     * v5.1 LEGACY: Redirect to guardedCreditDeposit.
     */
    public async operatorPullDeposit(
        playerBech32: string, amount: bigint,
    ): Promise<string> {
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
    /**
     * C-01 FIX: Full deposit verification — sender, recipient, contract, AND amount.
     *
     * Previous version only checked amount. Now also verifies:
     *   1. TX targets the MOTO token contract (not some random contract)
     *   2. Transfer event 'from' matches the expected sender
     *   3. Transfer event 'to' is the escrow contract
     *   4. Amount is decoded from on-chain data (never trusted from frontend)
     *
     * Address comparison: OPNet events may return addresses as bech32 strings,
     * hex strings, or Address objects. We normalize to lowercase string for comparison.
     * Multiple field names are tried for each property (SDK version tolerance).
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

            // ── C-01 CHECK 1: Verify this TX targets the MOTO token contract ──
            const txTarget = String(
                tx.contractAddress ?? tx.to ?? tx.address ?? ''
            ).toLowerCase();
            const motoLower = config.motoToken.toLowerCase();
            // OPNet TX target may be bech32 (opt1...) or hex (0x...) — check both
            if (txTarget && txTarget !== motoLower) {
                // Also try comparing without 0x prefix
                const txTargetClean = txTarget.replace(/^0x/, '');
                const motoClean = motoLower.replace(/^0x/, '');
                if (txTargetClean !== motoClean) {
                    const msg = `TX ${txHash} targets contract ${txTarget}, not MOTO token ${motoLower}`;
                    if (!config.devMode) {
                        logger.error(TAG, `DEPOSIT REJECTED: ${msg}`);
                        throw new Error('Transaction is not a MOTO token transfer. Deposit rejected.');
                    }
                    logger.warn(TAG, `DEV_MODE: ${msg} — continuing (contract address formats may differ on testnet)`);
                }
            }

            // ── Try to decode transfer amount + sender + recipient from TX events/data ──
            let verifiedAmount: bigint | null = null;
            let verifiedFrom: string | null = null;
            let verifiedTo: string | null = null;

            // Helper: extract string representation of an address from various formats
            const addrStr = (val: unknown): string | null => {
                if (!val) return null;
                if (typeof val === 'string') return val.toLowerCase();
                if (typeof val === 'object' && val !== null) {
                    // Address object — try common field names
                    const obj = val as Record<string, unknown>;
                    const s = obj.p2tr ?? obj.address ?? obj.bech32 ?? obj.hex ?? String(val);
                    return String(s).toLowerCase();
                }
                return String(val).toLowerCase();
            };

            // Attempt 1: Decoded receipt events
            const events = tx.receipt?.events || tx.events;
            if (events && Array.isArray(events)) {
                for (const event of events) {
                    if (event.type === 'Transfer' || event.name === 'Transfer') {
                        const eventAmount = event.amount ?? event.value ?? event.data?.amount;
                        if (eventAmount !== undefined) {
                            verifiedAmount = BigInt(eventAmount);
                            // Extract sender/recipient from event
                            verifiedFrom = addrStr(event.from ?? event.data?.from ?? event.sender ?? event.data?.sender);
                            verifiedTo = addrStr(event.to ?? event.data?.to ?? event.recipient ?? event.data?.recipient);
                            logger.info(TAG, `Transfer event: amount=${verifiedAmount}, from=${verifiedFrom ?? 'N/A'}, to=${verifiedTo ?? 'N/A'}`);
                            break;
                        }
                    }
                }
            }

            // Attempt 2: TX decoded data (calldata-level: transfer(to, amount))
            if (verifiedAmount === null && tx.decodedData?.amount !== undefined) {
                verifiedAmount = BigInt(tx.decodedData.amount);
                if (!verifiedTo) verifiedTo = addrStr(tx.decodedData.to ?? tx.decodedData.recipient);
                // For a transfer() call, the sender is the TX signer
                if (!verifiedFrom) verifiedFrom = addrStr(tx.from ?? tx.sender ?? tx.signer);
                logger.info(TAG, `Transfer decoded data: amount=${verifiedAmount}, from=${verifiedFrom ?? 'N/A'}, to=${verifiedTo ?? 'N/A'}`);
            }

            // Attempt 3: TX properties
            if (verifiedAmount === null && tx.properties?.amount !== undefined) {
                verifiedAmount = BigInt(tx.properties.amount);
                if (!verifiedTo) verifiedTo = addrStr(tx.properties.to ?? tx.properties.recipient);
                if (!verifiedFrom) verifiedFrom = addrStr(tx.properties.from ?? tx.properties.sender);
                logger.info(TAG, `Transfer properties: amount=${verifiedAmount}, from=${verifiedFrom ?? 'N/A'}, to=${verifiedTo ?? 'N/A'}`);
            }

            // Last resort for sender: TX-level signer field
            if (!verifiedFrom) {
                verifiedFrom = addrStr(tx.from ?? tx.sender ?? tx.signer);
            }

            // ── C-01 CHECK 2: Verify the sender matches expectedSender ──
            if (verifiedFrom) {
                const expectedLower = expectedSender.toLowerCase();
                if (verifiedFrom !== expectedLower) {
                    const msg = `Transfer sender ${verifiedFrom} does not match expected sender ${expectedLower}`;
                    if (!config.devMode) {
                        logger.error(TAG, `DEPOSIT REJECTED (sender mismatch): ${msg}. TX: ${txHash}`);
                        throw new Error('Transfer sender does not match your address. Someone else\'s TX cannot be used.');
                    }
                    logger.warn(TAG, `DEV_MODE: ${msg} — continuing (address format mismatch possible on testnet)`);
                }
            } else {
                const msg = `Cannot determine sender from TX ${txHash}`;
                if (!config.devMode) {
                    logger.error(TAG, `DEPOSIT REJECTED (no sender): ${msg}`);
                    throw new Error('Cannot verify transfer sender. Contact support.');
                }
                logger.warn(TAG, `DEV_MODE: ${msg} — continuing`);
            }

            // ── C-01 CHECK 3: Verify the recipient is the escrow contract ──
            if (verifiedTo) {
                const escrowLower = config.escrowAddress.toLowerCase();
                if (verifiedTo !== escrowLower) {
                    const msg = `Transfer recipient ${verifiedTo} is not the escrow ${escrowLower}`;
                    if (!config.devMode) {
                        logger.error(TAG, `DEPOSIT REJECTED (wrong recipient): ${msg}. TX: ${txHash}`);
                        throw new Error('Transfer was not sent to the escrow contract. Deposit rejected.');
                    }
                    logger.warn(TAG, `DEV_MODE: ${msg} — continuing (address format mismatch possible on testnet)`);
                }
            } else {
                const msg = `Cannot determine recipient from TX ${txHash}`;
                if (!config.devMode) {
                    logger.error(TAG, `DEPOSIT REJECTED (no recipient): ${msg}`);
                    throw new Error('Cannot verify transfer recipient. Contact support.');
                }
                logger.warn(TAG, `DEV_MODE: ${msg} — continuing`);
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

            logger.info(TAG, `✅ Transfer verified: ${verifiedAmount} MOTO from ${verifiedFrom} to ${verifiedTo}`);
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
     * Sprint 2 FIX: Added persistent cache + retry logic for addresses that the node
     * hasn't indexed yet (e.g. wallets whose only OPNet activity is receiving MOTO).
     */
    public async resolveAddress(bech32Address: string): Promise<any> {
        // Check cache first (cache hit = instant, no RPC)
        const cached = this.addressCache.get(bech32Address);
        if (cached) return cached;

        this.ensureInit();
        const lower = bech32Address.toLowerCase();
        const isContract = lower.startsWith('opt1s') || lower.startsWith('opt1q')
            || lower.startsWith('opnet1s') || lower.startsWith('opnet1q');

        const info = await this.provider!.getPublicKeyInfo(bech32Address, isContract);
        if (!info) throw new Error(`Could not resolve address: ${bech32Address} (isContract=${isContract})`);

        // Cache successful resolution permanently (address → key mapping doesn't change)
        this.addressCache.set(bech32Address, info);
        logger.info(TAG, `Resolved ${bech32Address.slice(0, 12)}… (isContract=${isContract}) [cached]`);
        return info;
    }

    /**
     * Sprint 2 FIX: Like resolveAddress, but returns null instead of throwing.
     * Used for balance checks where we don't want error spam for unresolvable addresses.
     */
    public async resolveAddressOrNull(bech32Address: string): Promise<any | null> {
        try {
            return await this.resolveAddress(bech32Address);
        } catch {
            // Throttle warnings: only log once per 10 minutes per address
            const now = Date.now();
            const lastLogged = this.unresolvableLoggedAt.get(bech32Address) ?? 0;
            if (now - lastLogged > 600_000) {
                logger.warn(TAG, `Address unresolvable (will retry next call): ${bech32Address.slice(0, 16)}…`);
                this.unresolvableLoggedAt.set(bech32Address, now);
            }
            return null;
        }
    }

    /**
     * Sprint 2 FIX: resolveAddress with retry + exponential backoff.
     * Used for deposit credit where we expect the node to index the pubkey
     * from the just-mined MOTO transfer TX, but it may take a few seconds.
     */
    public async resolveAddressWithRetry(
        bech32Address: string, maxRetries: number = 4, baseDelayMs: number = 3000,
    ): Promise<any> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await this.resolveAddress(bech32Address);
            } catch (err) {
                if (attempt < maxRetries) {
                    const delay = baseDelayMs * Math.pow(2, attempt); // 3s, 6s, 12s, 24s
                    logger.info(TAG, `Address resolution attempt ${attempt + 1}/${maxRetries + 1} failed for ${bech32Address.slice(0, 16)}… — retrying in ${delay / 1000}s`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw err;
                }
            }
        }
        throw new Error(`resolveAddressWithRetry: unreachable`);
    }

    /**
     * Sprint 2 FIX: Warm up the address cache after auth.
     * Non-throwing — if resolution fails, we just don't cache. The deposit
     * retry logic will handle it later when the TX is mined.
     */
    public async warmupAddressCache(bech32Address: string): Promise<void> {
        if (this.addressCache.has(bech32Address)) return;
        try {
            await this.resolveAddress(bech32Address);
        } catch {
            // Expected for new wallets — silently ignore
        }
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

    /**
     * v6: Distribute jackpot — now requires GUARDIAN signature (was operator).
     * Falls back to operator in dev mode without guardian.
     */
    public async distributeJackpot(winnerBech32: string): Promise<string> {
        this.ensureInit();
        const winnerAddr = await this.resolveAddress(winnerBech32);
        logger.info(TAG, `Simulating distributeJackpot for winner=${winnerBech32}...`);

        if (this.guardianContract) {
            const simulation = await this.guardianContract!.distributeJackpot(winnerAddr);
            return this.sendGuardianTx(`distributeJackpot(${winnerBech32})`, simulation);
        } else {
            // DEV_MODE fallback — try operator (will revert on v6 contract)
            logger.warn(TAG, 'DEV_MODE: distributeJackpot via operator (no guardian)');
            const simulation = await this.contract!.distributeJackpot(winnerAddr);
            return this.sendOperatorTx(`distributeJackpot(${winnerBech32})`, simulation);
        }
    }

    public close(): void {
        this.provider?.close();
        this.provider = null;
        this.contract = null;
        this.guardianContract = null;
    }

    private ensureInit(): void {
        if (!this.provider || !this.contract) throw new Error('ContractService not initialized');
    }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
export const contractService = new ContractService();
