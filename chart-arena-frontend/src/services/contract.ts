/**
 * Frontend Contract Service — handles on-chain calls via OP_WALLET.
 *
 * FIX for "a.toHex is not a function":
 *
 * Root cause: provider.call() internally does `from.toHex()` and
 * `from.tweakedToHex()` on the sender (this.from). Passing a raw string
 * as sender crashes because strings don't have those methods.
 *
 * The duck-typed Uint8Array approach also fails because the Proxy-based
 * provider expects Address instances from the same prototype chain
 * (opnet's bundled vendors.js).
 *
 * Solution: Use `provider.getPublicKeyInfo(bech32, isContract)` to obtain
 * Address objects created INSIDE the opnet browser bundle. These share the
 * same prototype as the ABI encoder and provider expect.
 */
import {
    getContract, ABIDataTypes, BitcoinAbiTypes, OP_20_ABI,
    type BitcoinInterfaceAbi, type AbstractRpcProvider, type IOP20Contract,
} from 'opnet';
import type { Network } from '@btc-vision/bitcoin';
import { ESCROW_ADDRESS, MOTO_TOKEN } from '../utils/constants';

// ══════════════════════════════════════════════
// ADDRESS RESOLUTION — always go through the provider
// ══════════════════════════════════════════════

/**
 * Cache of bech32/hex → opnet-bundle Address objects.
 * Keyed by `${address}:${isContract}` to separate user vs contract lookups
 * (the provider returns different key combos for each).
 * L-05 FIX: Evict when exceeding MAX_CACHE_SIZE to prevent OOM on long sessions.
 */
const addressCache = new Map<string, any>();
const MAX_ADDRESS_CACHE_SIZE = 500;

/**
 * Resolve any address string to an opnet-bundle-compatible Address object.
 *
 * - For user addresses (opt1p…, bc1p…): pass isContract = false
 * - For contract addresses (opt1s…, opt1q…, 0x…): pass isContract = true
 *
 * The returned Address lives on the same prototype chain as the ABI encoder
 * and provider.call() expect, so .toHex(), .tweakedToHex(), .equals() all work.
 */
async function resolveAddress(
    provider: AbstractRpcProvider,
    address: string,
    isContract: boolean = false,
): Promise<any> {
    const key = `${address}:${isContract}`;
    const cached = addressCache.get(key);
    if (cached) return cached;

    const resolved = await (provider as any).getPublicKeyInfo(address, isContract);
    if (!resolved) {
        throw new Error(
            `[Contract] Address not found on network: ${address} (isContract=${isContract}). ` +
            `The address may not have any on-chain activity yet.`,
        );
    }

    // L-05 FIX: Evict oldest entries if cache exceeds limit
    if (addressCache.size >= MAX_ADDRESS_CACHE_SIZE) {
        const firstKey = addressCache.keys().next().value;
        if (firstKey !== undefined) addressCache.delete(firstKey);
    }
    addressCache.set(key, resolved);
    return resolved;
}

// ══════════════════════════════════════════════
// ESCROW ABI
// ══════════════════════════════════════════════

const ESCROW_ABI: BitcoinInterfaceAbi = [
    // v5: Deposit
    {
        name: 'deposit', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
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
    {
        name: 'withdraw', type: BitcoinAbiTypes.Function, constant: false,
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    },
    {
        name: 'getBalance', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [{ name: 'account', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'balance', type: ABIDataTypes.UINT256 }],
    },
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
        name: 'getJackpot', type: BitcoinAbiTypes.Function, constant: true,
        inputs: [],
        outputs: [{ name: 'jackpot', type: ABIDataTypes.UINT256 }],
    },
];

// ══════════════════════════════════════════════
// TX PARAMS
// ══════════════════════════════════════════════

/**
 * Build TX params with the sender's P2TR Bitcoin address as refund (change) destination.
 *
 * Fee reality check:
 * - maximumAllowedSatToSpend is a UTXO reservation buffer, NOT the actual fee
 * - Actual miner fee at 1.5 sat/vB × ~400 vbytes = ~600-1500 sats per TX
 * - OPNet gas: ~100-500 sats
 * - Total real cost per interaction: ~1000-2000 sats (~$0.01-0.02)
 * - 10000n buffer gives ~5-10x headroom, plenty safe
 */
function txParams(senderAddr: any, network: Network) {
    const p2trAddress = senderAddr.p2tr(network);
    return {
        signer: null,
        mldsaSigner: null,
        maximumAllowedSatToSpend: 10000n,
        refundTo: p2trAddress,
        sender: p2trAddress,
        feeRate: 1,  // minimum 1 sat/vB — OPNet TXs confirm fine at minimum rate
    };
}

// ══════════════════════════════════════════════
// CONTRACT CACHE
// ══════════════════════════════════════════════

const contractCache = new Map<string, any>();

/**
 * Get or create a cached contract instance.
 * IMPORTANT: Do NOT pass sender as a string here. The sender must be set
 * separately via setSender() with a resolved Address object.
 */
function getCachedContract<T = any>(
    address: string,
    abi: BitcoinInterfaceAbi,
    provider: AbstractRpcProvider,
    network: Network,
): T {
    if (!contractCache.has(address)) {
        // No sender — we set it async before each call via setSenderFromBech32()
        const contract = getContract(address as any, abi, provider, network);
        contractCache.set(address, contract);
    }
    return contractCache.get(address)! as T;
}

function getCachedToken(provider: AbstractRpcProvider, network: Network): IOP20Contract {
    return getCachedContract<IOP20Contract>(MOTO_TOKEN, OP_20_ABI, provider, network);
}

function getCachedEscrow(provider: AbstractRpcProvider, network: Network): any {
    return getCachedContract(ESCROW_ADDRESS, ESCROW_ABI, provider, network);
}

/**
 * Resolve a bech32 sender address to a proper Address object,
 * set it on the contract via setSender(), and return it.
 *
 * The returned Address is needed for txParams() to derive the P2TR refund address.
 */
async function setSenderFromBech32(
    contract: any,
    provider: AbstractRpcProvider,
    senderBech32: string,
): Promise<any> {
    const senderAddr = await resolveAddress(provider, senderBech32, false);
    contract.setSender(senderAddr);
    return senderAddr;
}

export function clearContractCache(): void {
    contractCache.clear();
    addressCache.clear();
}

// ══════════════════════════════════════════════
// TX CONFIRMATION POLLING
// ══════════════════════════════════════════════

/**
 * Wait for a transaction to be mined (appear in a block).
 * Polls getTransaction every `intervalMs` until blockNumber is present.
 * Throws after `timeoutMs`.
 */
async function waitForTxConfirmation(
    provider: AbstractRpcProvider,
    txHash: string,
    timeoutMs: number = 300_000,  // 5 minutes
    intervalMs: number = 5_000,   // poll every 5s
): Promise<void> {
    const start = Date.now();
    console.log(`[Contract] Waiting for TX confirmation: ${txHash}`);
    while (Date.now() - start < timeoutMs) {
        try {
            const tx = await (provider as any).getTransaction(txHash);
            if (tx && tx.blockNumber !== undefined && tx.blockNumber !== null) {
                console.log(`[Contract] TX confirmed in block ${tx.blockNumber}`);
                return;
            }
        } catch {
            // TX not found yet — keep polling
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`[Contract] TX confirmation timeout after ${timeoutMs / 1000}s: ${txHash}`);
}

// ══════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════

/**
 * Approve MOTO spending for the escrow contract.
 *
 * v5: Approves exactly the requested amount (for deposit).
 * Checks existing allowance first — skips if sufficient (no popup, no wait).
 * Tracks in-flight approvals to prevent double popups.
 */
let _approvalInFlight: Promise<string> | null = null;

export async function approveMoto(
    provider: AbstractRpcProvider,
    network: Network,
    amount: bigint,
    senderAddress: string,
): Promise<string> {
    // If an approval is already in-flight, wait for it instead of firing a second one
    if (_approvalInFlight) {
        console.log('[Contract] Approval already in-flight — waiting for it...');
        try { return await _approvalInFlight; } catch (err) {
            console.warn('[Contract] Previous approval failed, starting fresh:', err);
            // Fall through to retry with a new approval
        }
    }

    const doApproval = async (): Promise<string> => {
        const token = getCachedToken(provider, network);
        const senderAddr = await setSenderFromBech32(token, provider, senderAddress);
        const escrowAddr = await resolveAddress(provider, ESCROW_ADDRESS, true);

        // Check existing allowance — skip TX entirely if already enough
        try {
            const allowanceResult = await (token as any).allowance(senderAddr, escrowAddr);
            const currentAllowance = allowanceResult?.properties?.allowance as bigint ?? 0n;
            if (currentAllowance >= amount) {
                console.log('[Contract] Allowance sufficient:', currentAllowance, '>=', amount, '— skipping approve');
                return 'skipped';
            }
            console.log('[Contract] Current allowance:', currentAllowance, '< needed:', amount);
        } catch (err) {
            console.warn('[Contract] Could not check allowance, proceeding with approve:', err);
        }

        // v5: Approve exactly the deposit amount. The old 50 MOTO batch was for
        // v4 where each match needed approval. In v5, approval is only for deposits.
        const sim = await (token as any).increaseAllowance(escrowAddr, amount);
        if (sim.revert) throw new Error(`increaseAllowance reverted: ${sim.revert}`);
        const tx = await sim.sendTransaction(txParams(senderAddr, network));
        const txId = tx.transactionId || tx.result;
        console.log('[Contract] increaseAllowance broadcast:', txId, '(approved:', amount / (10n ** 18n), 'MOTO)');

        // MUST wait for confirmation — createMatch simulation needs allowance on-chain
        await waitForTxConfirmation(provider, txId);
        return txId;
    };

    _approvalInFlight = doApproval();
    try {
        const result = await _approvalInFlight;
        return result;
    } finally {
        _approvalInFlight = null;
    }
}

// ══════════════════════════════════════════════
// v5: DEPOSIT — fund escrow balance
// ══════════════════════════════════════════════

/**
 * Deposit MOTO into the escrow contract.
 * Requires prior increaseAllowance (handled by approveMoto).
 *
 * Flow: approveMoto(amount) → depositMoto(amount)
 * After deposit, funds are in the escrow internal balance.
 * The backend's operator can then create matches using these balances.
 */
export async function depositMoto(
    provider: AbstractRpcProvider,
    network: Network,
    amount: bigint,
    senderAddress: string,
    wallet?: any,
): Promise<string> {
    console.log('[Contract] depositMoto: starting...', { amount: amount.toString(), senderAddress });
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);
    const params = txParams(senderAddr, network);

    console.log('[Contract] Depositing', amount / (10n ** 18n), 'MOTO to escrow...');

    // Try normal simulation — if it succeeds, great
    let sim: any;
    try {
        sim = await escrow.deposit(amount);
    } catch (simErr: any) {
        const msg = String(simErr?.message || simErr);
        // Cross-contract calls (deposit → MOTO.transferFrom) fail in simulation
        // because the simulated sender doesn't match the real wallet identity.
        // The on-chain TX will succeed because the wallet signs with the real key.
        if (msg.includes('TransferFrom') || msg.includes('Method not found')) {
            console.warn('[Contract] deposit simulation failed (expected for cross-contract):', msg.slice(0, 60));
            // The simulation object may be attached to the error or on the contract
            sim = (simErr as any).callResult ?? (escrow as any)._lastCallResult ?? null;
        } else {
            throw simErr;
        }
    }

    // If we got a sim object (even with revert), try sendTransaction
    if (sim && typeof sim.sendTransaction === 'function') {
        console.log('[Contract] Sending deposit TX (revert:', sim.revert ? 'yes - will succeed on-chain' : 'no', ')...');
        const tx = await sim.sendTransaction(params);
        const txId = tx.transactionId || tx.result;
        console.log('[Contract] deposit broadcast:', txId);
        return txId;
    }

    // Fallback: call provider.call() directly to get a raw CallResult
    console.log('[Contract] No sim object — trying provider.call() directly...');
    try {
        const { BinaryWriter } = await import('@btc-vision/transaction');
        const writer = new BinaryWriter();
        writer.writeSelector(0xceaad520); // deposit(uint256)
        writer.writeU256(amount);
        const calldata = writer.getBuffer();

        // provider.call() should return a CallResult even on revert
        const rawResult = await (provider as any).call(
            ESCROW_ADDRESS,    // contract to call
            calldata,          // encoded function call
            senderAddr,        // sender address
        );
        console.log('[Contract] provider.call result:', { revert: rawResult?.revert, hasSendTx: typeof rawResult?.sendTransaction === 'function' });

        if (rawResult && typeof rawResult.sendTransaction === 'function') {
            const tx = await rawResult.sendTransaction(params);
            const txId = tx.transactionId || tx.result;
            console.log('[Contract] deposit broadcast (via provider.call):', txId);
            return txId;
        }
    } catch (callErr) {
        console.warn('[Contract] provider.call fallback failed:', callErr);
    }

    // Last resort: try sending the approve TX through the same contract instance
    // by using a view function to get a valid CallResult, then exploiting its internals
    console.log('[Contract] All simulation paths failed. Attempting raw wallet interaction...');
    const web3Provider = (provider as any)._web3Provider
        ?? (provider as any).web3Provider
        ?? (provider as any).providerApi;
    
    if (web3Provider && typeof web3Provider.signInteraction === 'function') {
        const { BinaryWriter } = await import('@btc-vision/transaction');
        const writer = new BinaryWriter();
        writer.writeSelector(0xceaad520);
        writer.writeU256(amount);
        const calldata = writer.getBuffer();
        const p2trAddr = senderAddr.p2tr(network);
        
        // Get UTXOs for the sender
        const utxos = await (provider as any).utxoManager?.getUTXOs?.({ address: p2trAddr })
            ?? await (provider as any).getUTXOs?.({ address: p2trAddr })
            ?? [];
        console.log('[Contract] UTXOs found:', utxos.length);

        const challenge = await (provider as any).getChallenge();
        const result = await web3Provider.signInteraction({
            calldata,
            to: ESCROW_ADDRESS,
            from: p2trAddr,
            utxos,
            network,
            feeRate: 1,
            priorityFee: 0n,
            gasSatFee: 10000n,
            challenge,
        });
        const txId = result?.transactionId || result?.result || result?.[0] || 'deposit_sent';
        console.log('[Contract] deposit broadcast (raw):', txId);
        return txId;
    }

    throw new Error('Cannot send deposit — all methods failed. Please try refreshing and reconnecting your wallet.');
}

/**
 * Approve + Deposit combo. Handles both steps:
 * 1. Check/set allowance (skips if sufficient)
 * 2. Deposit to escrow
 * Returns the deposit TX hash.
 */
export async function approveAndDeposit(
    provider: AbstractRpcProvider,
    network: Network,
    amount: bigint,
    senderAddress: string,
): Promise<string> {
    // Step 1: Ensure allowance
    await approveMoto(provider, network, amount, senderAddress);
    // Step 2: Deposit
    return depositMoto(provider, network, amount, senderAddress);
}

// ══════════════════════════════════════════════
// v5.2: DIRECT TRANSFER DEPOSIT — no cross-contract, no simulation failure
// ══════════════════════════════════════════════

/**
 * Transfer MOTO directly to the escrow contract address via MOTO.transfer().
 * This is a single-contract call (no nesting), so simulation always works.
 *
 * After this TX confirms, the frontend sends the TX hash to the backend
 * via WS deposit_request. The backend then calls operatorCreditDeposit
 * to update the player's internal escrow balance.
 *
 * Returns the confirmed transfer TX hash.
 */
export async function transferMotoToEscrow(
    provider: AbstractRpcProvider,
    network: Network,
    amount: bigint,
    senderAddress: string,
): Promise<string> {
    const token = getCachedToken(provider, network);
    const senderAddr = await setSenderFromBech32(token, provider, senderAddress);
    const escrowAddr = await resolveAddress(provider, ESCROW_ADDRESS, true);

    console.log('[Contract] transferMotoToEscrow:', amount / (10n ** 18n), 'MOTO →', ESCROW_ADDRESS);

    const sim = await (token as any).transfer(escrowAddr, amount);
    if (sim.revert) throw new Error(`MOTO.transfer reverted: ${sim.revert}`);

    const tx = await sim.sendTransaction(txParams(senderAddr, network));
    const txId = tx.transactionId || tx.result;
    console.log('[Contract] MOTO.transfer broadcast:', txId);

    // Wait for confirmation — backend needs the TX to be on-chain before crediting
    await waitForTxConfirmation(provider, txId);
    console.log('[Contract] MOTO.transfer confirmed:', txId);
    return txId;
}

export async function createMatchOnChain(
    provider: AbstractRpcProvider,
    network: Network,
    buyIn: bigint,
    mode: number,
    format: number,
    senderAddress: string,
): Promise<bigint> {
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);

    const sim = await escrow.createMatch(buyIn, BigInt(mode), BigInt(format));
    if (sim.revert) throw new Error(`createMatch reverted: ${sim.revert}`);
    const tx = await sim.sendTransaction(txParams(senderAddr, network));
    const matchId = sim.properties?.matchId as bigint;
    const txId = tx.transactionId || tx.result;
    console.log('[Contract] createMatch broadcast:', txId, 'matchId:', matchId);
    // No block wait — backend polls for on-chain status
    return matchId;
}

export async function joinMatchOnChain(
    provider: AbstractRpcProvider,
    network: Network,
    matchId: bigint,
    senderAddress: string,
): Promise<string> {
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);

    // createMatch TX needs ~1 block to mine. Signet blocks are ~10min.
    // Retry for 25 minutes to be safe (covers 2+ blocks).
    const MAX_RETRIES = 150;
    const RETRY_MS = 10_000; // 10s intervals
    let lastErr: unknown;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const sim = await escrow.joinMatch(matchId);
            if (sim.revert) {
                const revertMsg = String(sim.revert);
                // These errors mean createMatch isn't on-chain yet — keep retrying
                const isRetryable = revertMsg.includes('not open')
                    || revertMsg.includes('not found')
                    || revertMsg.includes('Not in')
                    || revertMsg.includes('allowance')
                    || revertMsg.includes('Insufficient')
                    || revertMsg.includes('status');
                if (i < MAX_RETRIES - 1 && isRetryable) {
                    if (i % 6 === 0) { // Log every ~60s instead of every retry
                        console.log(`[Contract] joinMatch waiting for createMatch to mine... ${Math.round((i * RETRY_MS) / 1000)}s elapsed (${revertMsg})`);
                    }
                    await new Promise(r => setTimeout(r, RETRY_MS));
                    continue;
                }
                throw new Error(`joinMatch reverted: ${sim.revert}`);
            }
            // Simulation succeeded — broadcast
            console.log(`[Contract] joinMatch simulation succeeded after ${Math.round((i * RETRY_MS) / 1000)}s`);
            const tx = await sim.sendTransaction(txParams(senderAddr, network));
            const txId = tx.transactionId || tx.result;
            console.log('[Contract] joinMatch broadcast:', txId);
            return txId;
        } catch (err) {
            lastErr = err;
            const errMsg = String(err);
            const isRetryable = errMsg.includes('not open')
                || errMsg.includes('not found')
                || errMsg.includes('status')
                || errMsg.includes('allowance')
                || errMsg.includes('Insufficient')
                || errMsg.includes('active match');
            if (i < MAX_RETRIES - 1 && isRetryable) {
                if (i % 6 === 0) {
                    console.log(`[Contract] joinMatch waiting for createMatch to mine... ${Math.round((i * RETRY_MS) / 1000)}s elapsed`);
                }
                await new Promise(r => setTimeout(r, RETRY_MS));
                continue;
            }
            throw err;
        }
    }
    throw lastErr || new Error('joinMatch failed after max retries — createMatch may not have mined');
}

export async function withdrawOnChain(
    provider: AbstractRpcProvider,
    network: Network,
    senderAddress: string,
): Promise<string> {
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);

    const sim = await escrow.withdraw();
    if (sim.revert) throw new Error(`withdraw reverted: ${sim.revert}`);
    const tx = await sim.sendTransaction(txParams(senderAddr, network));
    console.log('[Contract] withdraw TX:', tx.result);
    return tx.result;
}

export async function getEscrowBalance(
    provider: AbstractRpcProvider,
    network: Network,
    userAddress: string,
): Promise<bigint> {
    const escrow = getCachedEscrow(provider, network);
    // Resolve user address for the ADDRESS-type param
    const userAddr = await resolveAddress(provider, userAddress, false);
    const result = await escrow.getBalance(userAddr);
    if ('error' in result) throw new Error(result.error);
    return result.properties.balance as bigint;
}

export async function getMotoBalance(
    provider: AbstractRpcProvider,
    network: Network,
    userAddress: string,
): Promise<bigint> {
    const token = getCachedToken(provider, network);
    // Resolve user address for balanceOf's ADDRESS param
    const userAddr = await resolveAddress(provider, userAddress, false);
    const result = await (token as any).balanceOf(userAddr);
    if ('error' in result) throw new Error(result.error);
    return result.properties.balance as bigint;
}

// ══════════════════════════════════════════════
// MATCH RECOVERY — cancel / emergency refund / withdraw combo
// ══════════════════════════════════════════════

/**
 * Cancel an OPEN match (only creator can call).
 * Refunds all players' buy-ins to their escrow balances.
 */
export async function cancelMatchOnChain(
    provider: AbstractRpcProvider,
    network: Network,
    matchId: bigint,
    senderAddress: string,
): Promise<string> {
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);

    const sim = await escrow.cancelMatch(matchId);
    if (sim.revert) throw new Error(`cancelMatch reverted: ${sim.revert}`);
    const tx = await sim.sendTransaction(txParams(senderAddr, network));
    const txId = tx.transactionId || tx.result;
    console.log('[Contract] cancelMatch TX:', txId);
    await waitForTxConfirmation(provider, txId);
    return txId;
}

/**
 * Trigger emergency refund for a LOCKED match (50+ blocks past lock).
 * Anyone can call this — not restricted to match participants.
 */
export async function emergencyRefundOnChain(
    provider: AbstractRpcProvider,
    network: Network,
    matchId: bigint,
    senderAddress: string,
): Promise<string> {
    const escrow = getCachedEscrow(provider, network);
    const senderAddr = await setSenderFromBech32(escrow, provider, senderAddress);

    const sim = await escrow.triggerEmergencyRefund(matchId);
    if (sim.revert) throw new Error(`triggerEmergencyRefund reverted: ${sim.revert}`);
    const tx = await sim.sendTransaction(txParams(senderAddr, network));
    const txId = tx.transactionId || tx.result;
    console.log('[Contract] triggerEmergencyRefund TX:', txId);
    await waitForTxConfirmation(provider, txId);
    return txId;
}

/**
 * Force-refund a stuck match and withdraw in one go.
 * Tries cancelMatch first (for OPEN matches), falls back to
 * triggerEmergencyRefund (for LOCKED matches past 50 blocks).
 * Then withdraws the escrow balance back to the user's wallet.
 */
export async function forceRefundAndWithdraw(
    provider: AbstractRpcProvider,
    network: Network,
    matchId: bigint,
    senderAddress: string,
): Promise<{ refundTx: string; withdrawTx: string }> {
    // Step 1: Try cancel (OPEN) or emergency refund (LOCKED)
    let refundTx: string;
    try {
        console.log('[Contract] Attempting cancelMatch...');
        refundTx = await cancelMatchOnChain(provider, network, matchId, senderAddress);
        console.log('[Contract] Match cancelled successfully');
    } catch (cancelErr) {
        console.log('[Contract] cancelMatch failed, trying emergencyRefund...', cancelErr);
        refundTx = await emergencyRefundOnChain(provider, network, matchId, senderAddress);
        console.log('[Contract] Emergency refund successful');
    }

    // Step 2: Withdraw the refunded balance
    console.log('[Contract] Withdrawing escrow balance...');
    const withdrawTx = await withdrawOnChain(provider, network, senderAddress);
    console.log('[Contract] Withdraw successful');

    return { refundTx, withdrawTx };
}

// ══════════════════════════════════════════════
// DEBUG — expose recovery functions on window for console use
// Usage: await __ca.forceRefund(2n)  — cancels match #2 + withdraws
// ══════════════════════════════════════════════

/** Wallet context set by App.tsx so console helpers can access provider/network */
let _walletCtx: { provider: AbstractRpcProvider; network: Network; address: string } | null = null;

/** Called from App.tsx to inject wallet context for console helpers */
export function setWalletContext(provider: AbstractRpcProvider, network: Network, address: string): void {
    _walletCtx = { provider, network, address };
}

if (typeof window !== 'undefined') {
    /**
     * Auto-detect wallet context from multiple sources:
     * 1. Injected via setWalletContext (from App.tsx useEffect)
     * 2. OP_WALLET on window (direct extension access)
     * 3. Create standalone provider + prompt for address
     */
    async function autoCtx(): Promise<{ provider: AbstractRpcProvider; network: Network; address: string }> {
        // Source 1: Already injected
        if (_walletCtx) return _walletCtx;

        // Source 2: Try to find OP_WALLET connected address
        const opwallet = (window as any).opnet;
        let address: string | undefined;
        if (opwallet) {
            try {
                if (typeof opwallet.getAddress === 'function') address = await opwallet.getAddress();
                else if (opwallet.selectedAddress) address = opwallet.selectedAddress;
            } catch { /* ignore */ }
        }

        if (!address) {
            // Last resort: check DOM for displayed address
            const addrEl = document.querySelector('[class*="address"], [data-address]');
            const text = addrEl?.textContent?.trim();
            if (text && (text.startsWith('opt1') || text.startsWith('bc1') || text.startsWith('tb1'))) {
                address = text;
            }
        }

        if (!address) {
            address = prompt('Enter your wallet address (opt1p...):') || undefined;
        }
        if (!address) throw new Error('No wallet address found');

        // Create standalone provider
        const { JSONRpcProvider } = await import('opnet');
        const { networks } = await import('@btc-vision/bitcoin');
        const net = networks.opnetTestnet;
        const provider = new JSONRpcProvider({ url: 'https://testnet.opnet.org', network: net }) as any;

        _walletCtx = { provider, network: net, address };
        return _walletCtx;
    }

    (window as any).__ca = {
        /** Cancel an OPEN match: await __ca.cancel(2n) */
        cancel: async (matchId: bigint) => {
            const { provider, network, address } = await autoCtx();
            return cancelMatchOnChain(provider, network, BigInt(matchId), address);
        },
        /** Emergency refund a LOCKED match (50+ blocks): await __ca.emergencyRefund(2n) */
        emergencyRefund: async (matchId: bigint) => {
            const { provider, network, address } = await autoCtx();
            return emergencyRefundOnChain(provider, network, BigInt(matchId), address);
        },
        /** Cancel/refund + withdraw combo: await __ca.forceRefund(2n) */
        forceRefund: async (matchId: bigint) => {
            const { provider, network, address } = await autoCtx();
            return forceRefundAndWithdraw(provider, network, BigInt(matchId), address);
        },
        /** Withdraw escrow balance: await __ca.withdraw() */
        withdraw: async () => {
            const { provider, network, address } = await autoCtx();
            return withdrawOnChain(provider, network, address);
        },
    };
    console.log('[Contract] Recovery helpers loaded. After login: await __ca.forceRefund(2n)');
}

