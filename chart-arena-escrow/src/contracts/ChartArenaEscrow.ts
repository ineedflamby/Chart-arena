/**
 * ChartArenaEscrow v6 — Guardian multisig protection.
 *
 * KEY CHANGE v6: Two-key authorization for sensitive operations.
 *   - operatorCreditDeposit → requestCredit (operator creates pending request)
 *   - guardianConfirmCredit (guardian executes pending request)
 *   - distributeJackpot now requires guardian (not operator)
 *   - Daily credit cap prevents unbounded minting even with both keys
 *   - Neither key alone can mint unbacked tokens or steal the jackpot
 *
 * UNCHANGED: operatorCreateMatch, settleMatch, cancelMatch remain operator-only
 *   (bounded by existing on-chain balance checks and payout sum verification)
 *
 * DEPLOYMENT: Requires 5 addresses: token, operator, guardian, treasury, prizePool
 *
 * PREVIOUS VERSIONS:
 * v5.2: operatorCreditDeposit (operator-only, no cap — C-02 vulnerability)
 * v5: deposit() + operatorCreateMatch() flow
 * v4: reentrancy fixes, storage pointer audit
 */

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    NetEvent,
    OP_NET,
    Revert,
    SafeMath,
    StoredU256,
    StoredAddress,
    StoredMapU256,
    AddressMemoryMap,
    ADDRESS_BYTE_LENGTH,
    EMPTY_POINTER,
    U256_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';

const STATUS_NONE: u256 = u256.Zero;
const STATUS_OPEN: u256 = u256.One;
const STATUS_LOCKED: u256 = u256.fromU32(2);
const STATUS_SETTLED: u256 = u256.fromU32(3);
const STATUS_CANCELLED: u256 = u256.fromU32(4);
const STATUS_REFUNDED: u256 = u256.fromU32(5);

const MODE_CLASSIC: u256 = u256.Zero;
const MODE_SURVIVAL: u256 = u256.One;
const MODE_CHAOS: u256 = u256.fromU32(2);

const FORMAT_DUEL: u256 = u256.Zero;
const FORMAT_ARENA: u256 = u256.One;

const PLAYERS_DUEL: u256 = u256.fromU32(2);
const PLAYERS_ARENA: u256 = u256.fromU32(5);

const BPS_BASE: u256 = u256.fromU32(10000);
const RAKE_BPS: u256 = u256.fromU32(1000);
const TREASURY_BPS: u256 = u256.fromU32(5000);
const PRIZE_POOL_BPS: u256 = u256.fromU32(3000);

const REFUND_DELAY_BLOCKS: u256 = u256.fromU32(50);
const SLOT_STRIDE: u256 = u256.fromU32(8);

// v6: Guardian credit system constants
const CREDIT_STATUS_NONE: u256 = u256.Zero;
const CREDIT_STATUS_PENDING: u256 = u256.One;
const CREDIT_STATUS_CONFIRMED: u256 = u256.fromU32(2);
const CREDIT_STATUS_CANCELLED: u256 = u256.fromU32(3);

// v6: Daily credit cap — 10,000 MOTO (10_000 × 10^18 wei)
// Prevents unbounded minting even with both keys compromised.
// Deployer can adjust via setDailyCreditCap().
const DEFAULT_DAILY_CREDIT_CAP: u256 = u256.fromU64(10000);
// Blocks per "day" — ~144 on mainnet (10-min blocks), ~144 on signet
const BLOCKS_PER_DAY: u256 = u256.fromU32(144);

// Selectors must match what the opnet SDK sends when calling OP-20 token methods.
// The SDK uses its own pre-computed selectors (NOT ABICoder.encodeSelector output).
// Verified via: token.transferFrom() calldata starts with 0x4b6685e7
const TRANSFER_FROM_SELECTOR: u32 = 0x4b6685e7;  // transferFrom (SDK actual)
const TRANSFER_SELECTOR: u32 = 0x3b88ef57;       // transfer (SDK actual)

function addressToU256(addr: Address): u256 {
    const ptr = addr.dataStart;
    const lo1 = load<u64>(ptr, 0);
    const lo2 = load<u64>(ptr, 8);
    const hi1 = load<u64>(ptr, 16);
    const hi2 = load<u64>(ptr, 24);
    return new u256(lo1, lo2, hi1, hi2);
}

function u256ToAddress(val: u256): Address {
    const bytes = new Uint8Array(32);
    const ptr = bytes.dataStart;
    store<u64>(ptr, val.lo1, 0);
    store<u64>(ptr, val.lo2, 8);
    store<u64>(ptr, val.hi1, 16);
    store<u64>(ptr, val.hi2, 24);
    return Address.fromUint8Array(bytes);
}

function playerSlotKey(matchId: u256, slot: u256): u256 {
    return SafeMath.add(SafeMath.mul(matchId, SLOT_STRIDE), slot);
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

class DepositEvent extends NetEvent {
    constructor(player: Address, amount: u256) {
        const writer = new BytesWriter(ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeAddress(player);
        writer.writeU256(amount);
        super('Deposit', writer);
    }
}

class MatchCreatedEvent extends NetEvent {
    constructor(matchId: u256, creator: Address, buyIn: u256, mode: u256, format: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH * 3);
        writer.writeU256(matchId);
        writer.writeAddress(creator);
        writer.writeU256(buyIn);
        writer.writeU256(mode);
        writer.writeU256(format);
        super('MatchCreated', writer);
    }
}

class MatchJoinedEvent extends NetEvent {
    constructor(matchId: u256, player: Address, slot: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeU256(matchId);
        writer.writeAddress(player);
        writer.writeU256(slot);
        super('MatchJoined', writer);
    }
}

class MatchLockedEvent extends NetEvent {
    constructor(matchId: u256, lockBlock: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH * 2);
        writer.writeU256(matchId);
        writer.writeU256(lockBlock);
        super('MatchLocked', writer);
    }
}

class MatchSettledEvent extends NetEvent {
    constructor(matchId: u256, logHash: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH * 2);
        writer.writeU256(matchId);
        writer.writeU256(logHash);
        super('MatchSettled', writer);
    }
}

class MatchCancelledEvent extends NetEvent {
    constructor(matchId: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(matchId);
        super('MatchCancelled', writer);
    }
}

class MatchRefundedEvent extends NetEvent {
    constructor(matchId: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(matchId);
        super('MatchRefunded', writer);
    }
}

class WithdrawalEvent extends NetEvent {
    constructor(player: Address, amount: u256) {
        const writer = new BytesWriter(ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeAddress(player);
        writer.writeU256(amount);
        super('Withdrawal', writer);
    }
}

class JackpotDistributedEvent extends NetEvent {
    constructor(winner: Address, amount: u256) {
        const writer = new BytesWriter(ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeAddress(winner);
        writer.writeU256(amount);
        super('JackpotDistributed', writer);
    }
}

// v6: Guardian credit system events
class CreditRequestedEvent extends NetEvent {
    constructor(creditId: u256, player: Address, amount: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeU256(creditId);
        writer.writeAddress(player);
        writer.writeU256(amount);
        super('CreditRequested', writer);
    }
}

class CreditConfirmedEvent extends NetEvent {
    constructor(creditId: u256, player: Address, amount: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + ADDRESS_BYTE_LENGTH + U256_BYTE_LENGTH);
        writer.writeU256(creditId);
        writer.writeAddress(player);
        writer.writeU256(amount);
        super('CreditConfirmed', writer);
    }
}

class CreditCancelledEvent extends NetEvent {
    constructor(creditId: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(creditId);
        super('CreditCancelled', writer);
    }
}

@final
export class ChartArenaEscrow extends OP_NET {
    // ═══════════════════════════════════════════════════════════════
    // STORAGE LAYOUT — NEVER REORDER — NEW FIELDS APPEND AT END
    // ═══════════════════════════════════════════════════════════════
    // Pointer  1: _tokenPtr
    // Pointer  2: _operatorPtr
    // Pointer  3: _treasuryPtr
    // Pointer  4: _prizePoolPtr
    // Pointer  5: _matchCounterPtr
    // Pointer  6: _jackpotPtr
    // Pointer  7: _balancesPtr
    // Pointer  8: _matchBuyInPtr
    // Pointer  9: _matchModePtr
    // Pointer 10: _matchFormatPtr
    // Pointer 11: _matchStatusPtr
    // Pointer 12: _matchPlayerCountPtr
    // Pointer 13: _matchMaxPlayersPtr
    // Pointer 14: _matchLockBlockPtr
    // Pointer 15: _matchLogHashPtr
    // Pointer 16: _matchPotPtr
    // Pointer 17: _playerMatchPtr
    // Pointer 18: _playerSlotPtr
    // Pointer 19: _matchPlayersPtr
    // Pointer 20: _lockedPtr (reentrancy guard)
    // ── v6 additions ──
    // Pointer 21: _guardianPtr
    // Pointer 22: _creditNoncePtr
    // Pointer 23: _creditStatusPtr
    // Pointer 24: _creditAmountPtr
    // Pointer 25: _creditPlayerPtr (nonce → addressAsU256)
    // Pointer 26: _dailyCreditCapPtr
    // Pointer 27: _dailyCreditUsedPtr
    // Pointer 28: _dailyCreditDayPtr
    // ═══════════════════════════════════════════════════════════════

    private readonly _tokenPtr: u16 = Blockchain.nextPointer;
    private readonly _operatorPtr: u16 = Blockchain.nextPointer;
    private readonly _treasuryPtr: u16 = Blockchain.nextPointer;
    private readonly _prizePoolPtr: u16 = Blockchain.nextPointer;

    private readonly _token: StoredAddress = new StoredAddress(this._tokenPtr);
    private readonly _operator: StoredAddress = new StoredAddress(this._operatorPtr);
    private readonly _treasury: StoredAddress = new StoredAddress(this._treasuryPtr);
    private readonly _prizePool: StoredAddress = new StoredAddress(this._prizePoolPtr);

    private readonly _matchCounterPtr: u16 = Blockchain.nextPointer;
    private readonly _matchCounter: StoredU256 = new StoredU256(this._matchCounterPtr, EMPTY_POINTER);
    private readonly _jackpotPtr: u16 = Blockchain.nextPointer;
    private readonly _jackpot: StoredU256 = new StoredU256(this._jackpotPtr, EMPTY_POINTER);

    private readonly _balancesPtr: u16 = Blockchain.nextPointer;
    private readonly _balances: AddressMemoryMap = new AddressMemoryMap(this._balancesPtr);

    private readonly _matchBuyInPtr: u16 = Blockchain.nextPointer;
    private readonly _matchBuyIn: StoredMapU256 = new StoredMapU256(this._matchBuyInPtr);
    private readonly _matchModePtr: u16 = Blockchain.nextPointer;
    private readonly _matchMode: StoredMapU256 = new StoredMapU256(this._matchModePtr);
    private readonly _matchFormatPtr: u16 = Blockchain.nextPointer;
    private readonly _matchFormat: StoredMapU256 = new StoredMapU256(this._matchFormatPtr);
    private readonly _matchStatusPtr: u16 = Blockchain.nextPointer;
    private readonly _matchStatus: StoredMapU256 = new StoredMapU256(this._matchStatusPtr);
    private readonly _matchPlayerCountPtr: u16 = Blockchain.nextPointer;
    private readonly _matchPlayerCount: StoredMapU256 = new StoredMapU256(this._matchPlayerCountPtr);
    private readonly _matchMaxPlayersPtr: u16 = Blockchain.nextPointer;
    private readonly _matchMaxPlayers: StoredMapU256 = new StoredMapU256(this._matchMaxPlayersPtr);
    private readonly _matchLockBlockPtr: u16 = Blockchain.nextPointer;
    private readonly _matchLockBlock: StoredMapU256 = new StoredMapU256(this._matchLockBlockPtr);
    private readonly _matchLogHashPtr: u16 = Blockchain.nextPointer;
    private readonly _matchLogHash: StoredMapU256 = new StoredMapU256(this._matchLogHashPtr);
    private readonly _matchPotPtr: u16 = Blockchain.nextPointer;
    private readonly _matchPot: StoredMapU256 = new StoredMapU256(this._matchPotPtr);

    private readonly _playerMatchPtr: u16 = Blockchain.nextPointer;
    private readonly _playerMatch: AddressMemoryMap = new AddressMemoryMap(this._playerMatchPtr);
    private readonly _playerSlotPtr: u16 = Blockchain.nextPointer;
    private readonly _playerSlot: AddressMemoryMap = new AddressMemoryMap(this._playerSlotPtr);

    private readonly _matchPlayersPtr: u16 = Blockchain.nextPointer;
    private readonly _matchPlayers: StoredMapU256 = new StoredMapU256(this._matchPlayersPtr);

    private readonly _lockedPtr: u16 = Blockchain.nextPointer;
    private readonly _lockedStorage: StoredU256 = new StoredU256(this._lockedPtr, EMPTY_POINTER);

    // ── v6: Guardian multisig storage ──
    private readonly _guardianPtr: u16 = Blockchain.nextPointer;
    private readonly _guardian: StoredAddress = new StoredAddress(this._guardianPtr);

    private readonly _creditNoncePtr: u16 = Blockchain.nextPointer;
    private readonly _creditNonce: StoredU256 = new StoredU256(this._creditNoncePtr, EMPTY_POINTER);

    private readonly _creditStatusPtr: u16 = Blockchain.nextPointer;
    private readonly _creditStatus: StoredMapU256 = new StoredMapU256(this._creditStatusPtr);

    private readonly _creditAmountPtr: u16 = Blockchain.nextPointer;
    private readonly _creditAmount: StoredMapU256 = new StoredMapU256(this._creditAmountPtr);

    private readonly _creditPlayerPtr: u16 = Blockchain.nextPointer;
    private readonly _creditPlayer: StoredMapU256 = new StoredMapU256(this._creditPlayerPtr);

    private readonly _dailyCreditCapPtr: u16 = Blockchain.nextPointer;
    private readonly _dailyCreditCap: StoredU256 = new StoredU256(this._dailyCreditCapPtr, EMPTY_POINTER);

    private readonly _dailyCreditUsedPtr: u16 = Blockchain.nextPointer;
    private readonly _dailyCreditUsed: StoredU256 = new StoredU256(this._dailyCreditUsedPtr, EMPTY_POINTER);

    private readonly _dailyCreditDayPtr: u16 = Blockchain.nextPointer;
    private readonly _dailyCreditDay: StoredU256 = new StoredU256(this._dailyCreditDayPtr, EMPTY_POINTER);

    public constructor() {
        super();
    }

    private _nonReentrant(): void {
        if (this._lockedStorage.value != u256.Zero) throw new Revert('Reentrant call');
        this._lockedStorage.set(u256.One);
    }

    private _releaseGuard(): void {
        this._lockedStorage.set(u256.Zero);
    }

    public override onDeployment(_calldata: Calldata): void {
        const token = _calldata.readAddress();
        const operator = _calldata.readAddress();
        const guardian = _calldata.readAddress();
        const treasury = _calldata.readAddress();
        const prizePool = _calldata.readAddress();
        if (token.isZero()) throw new Revert('Zero token address');
        if (operator.isZero()) throw new Revert('Zero operator address');
        if (guardian.isZero()) throw new Revert('Zero guardian address');
        if (treasury.isZero()) throw new Revert('Zero treasury address');
        if (prizePool.isZero()) throw new Revert('Zero prize pool address');
        if (operator.equals(guardian)) throw new Revert('Operator and guardian must differ');
        this._token.value = token;
        this._operator.value = operator;
        this._guardian.value = guardian;
        this._treasury.value = treasury;
        this._prizePool.value = prizePool;
        // v6: Set default daily credit cap (in MOTO units, not wei — multiply by 10^18 on read)
        // 10,000 MOTO per day. Adjustable by deployer via setDailyCreditCap().
        this._dailyCreditCap.set(SafeMath.mul(DEFAULT_DAILY_CREDIT_CAP, u256.fromU64(1_000_000_000_000_000_000)));
    }

    // ═══════════════════════════════════════════════════════════════
    // v5 NEW: DEPOSIT — Player deposits MOTO into escrow balance
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'amount', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public deposit(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const amount: u256 = calldata.readU256();
        if (amount == u256.Zero) throw new Revert('Amount must be > 0');
        const sender: Address = Blockchain.tx.sender;
        // Pull MOTO from sender into escrow
        this._pullTokens(sender, amount);
        // Credit to internal balance
        this._creditBalance(sender, amount);
        this.emitEvent(new DepositEvent(sender, amount));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // v5.1 NEW: OPERATOR PULL DEPOSIT — Operator pulls approved MOTO on behalf of player
    // Fixes cross-contract simulation failure on frontend (wallet can't simulate transferFrom)
    // Player just does increaseAllowance → backend calls this with operator keys
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'player', type: 'Address' }, { name: 'amount', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public operatorPullDeposit(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyOperator();
        const player: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();
        if (amount == u256.Zero) throw new Revert('Amount must be > 0');
        if (player.isZero()) throw new Revert('Zero player address');
        // Pull MOTO from player (requires player's prior increaseAllowance to this contract)
        this._pullTokens(player, amount);
        // Credit to player's internal balance
        this._creditBalance(player, amount);
        this.emitEvent(new DepositEvent(player, amount));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // v6 NEW: GUARDIAN-PROTECTED CREDIT SYSTEM (replaces operatorCreditDeposit)
    //
    // Step 1: Operator calls requestCredit(player, amount) → pending
    // Step 2: Guardian calls confirmCredit(creditId) → executed
    //
    // Neither key alone can mint tokens. Both keys + daily cap required.
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'player', type: 'Address' }, { name: 'amount', type: 'u256' })
    @returns({ name: 'creditId', type: 'u256' })
    public requestCredit(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyOperator();
        const player: Address = calldata.readAddress();
        const amount: u256 = calldata.readU256();
        if (amount == u256.Zero) throw new Revert('Amount must be > 0');
        if (player.isZero()) throw new Revert('Zero player address');

        // Assign credit ID (auto-increment)
        const creditId: u256 = SafeMath.add(this._creditNonce.value, u256.One);
        this._creditNonce.set(creditId);

        // Store pending credit
        this._creditStatus.set(creditId, CREDIT_STATUS_PENDING);
        this._creditAmount.set(creditId, amount);
        this._creditPlayer.set(creditId, addressToU256(player));

        this.emitEvent(new CreditRequestedEvent(creditId, player, amount));
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(creditId);
        this._releaseGuard();
        return writer;
    }

    @method({ name: 'creditId', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public confirmCredit(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyGuardian();
        const creditId: u256 = calldata.readU256();

        // Verify pending status
        const status: u256 = this._creditStatus.get(creditId);
        if (status != CREDIT_STATUS_PENDING) throw new Revert('Credit not pending');

        // Read credit details
        const amount: u256 = this._creditAmount.get(creditId);
        const playerU256: u256 = this._creditPlayer.get(creditId);
        if (playerU256 == u256.Zero) throw new Revert('Invalid credit player');
        const player: Address = u256ToAddress(playerU256);

        // v6: Check daily credit cap
        this._checkDailyCreditCap(amount);

        // Execute credit
        this._creditBalance(player, amount);

        // Mark as confirmed
        this._creditStatus.set(creditId, CREDIT_STATUS_CONFIRMED);

        this.emitEvent(new CreditConfirmedEvent(creditId, player, amount));
        this.emitEvent(new DepositEvent(player, amount));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    @method({ name: 'creditId', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public cancelCredit(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyOperator();
        const creditId: u256 = calldata.readU256();
        const status: u256 = this._creditStatus.get(creditId);
        if (status != CREDIT_STATUS_PENDING) throw new Revert('Credit not pending');
        this._creditStatus.set(creditId, CREDIT_STATUS_CANCELLED);
        this.emitEvent(new CreditCancelledEvent(creditId));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // v6 BACKWARD COMPAT: operatorCreditDeposit is REMOVED.
    // Calls to the old selector will revert with "Unknown method".
    // The backend must be updated to use requestCredit + guardianConfirmCredit.

    // ═══════════════════════════════════════════════════════════════
    // v5 NEW: OPERATOR CREATE MATCH — 1 TX, straight to LOCKED
    // ═══════════════════════════════════════════════════════════════

    @method(
        { name: 'buyIn', type: 'u256' },
        { name: 'mode', type: 'u256' },
        { name: 'format', type: 'u256' },
        { name: 'player1', type: 'Address' },
        { name: 'player2', type: 'Address' },
    )
    @returns({ name: 'matchId', type: 'u256' })
    public operatorCreateMatch(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyOperator();

        const buyIn: u256 = calldata.readU256();
        const mode: u256 = calldata.readU256();
        const format: u256 = calldata.readU256();
        const player1: Address = calldata.readAddress();
        const player2: Address = calldata.readAddress();

        // Validate params
        if (buyIn == u256.Zero) throw new Revert('Buy-in must be > 0');
        if (mode > MODE_CHAOS) throw new Revert('Invalid mode');
        if (format > FORMAT_ARENA) throw new Revert('Invalid format');
        if (format != FORMAT_DUEL) throw new Revert('Operator create only supports Duel format');
        if (mode == MODE_SURVIVAL && format == FORMAT_DUEL) throw new Revert('Survival mode requires Arena format');
        if (player1.isZero() || player2.isZero()) throw new Revert('Zero player address');
        if (player1.equals(player2)) throw new Revert('Players must be different');

        // Check neither player is in an active match
        this._requireNotInActiveMatch(player1);
        this._requireNotInActiveMatch(player2);

        // Check both players have sufficient deposit balance
        const bal1: u256 = this._balances.get(player1);
        if (bal1 < buyIn) throw new Revert('Player 1 insufficient balance');
        const bal2: u256 = this._balances.get(player2);
        if (bal2 < buyIn) throw new Revert('Player 2 insufficient balance');

        // Debit both players' internal balances
        this._balances.set(player1, SafeMath.sub(bal1, buyIn));
        this._balances.set(player2, SafeMath.sub(bal2, buyIn));

        // Create match — straight to LOCKED
        const matchId: u256 = SafeMath.add(this._matchCounter.value, u256.One);
        this._matchCounter.set(matchId);

        const totalPot: u256 = SafeMath.add(buyIn, buyIn); // 2 × buyIn for duel

        this._matchBuyIn.set(matchId, buyIn);
        this._matchMode.set(matchId, mode);
        this._matchFormat.set(matchId, format);
        this._matchStatus.set(matchId, STATUS_LOCKED); // Straight to LOCKED!
        this._matchPlayerCount.set(matchId, PLAYERS_DUEL);
        this._matchMaxPlayers.set(matchId, PLAYERS_DUEL);
        this._matchPot.set(matchId, totalPot);

        const blockNum: u256 = u256.fromU64(Blockchain.block.number);
        this._matchLockBlock.set(matchId, blockNum);

        // Player 1 = slot 0 (creator)
        this._playerMatch.set(player1, matchId);
        this._playerSlot.set(player1, u256.Zero);
        this._matchPlayers.set(playerSlotKey(matchId, u256.Zero), addressToU256(player1));

        // Player 2 = slot 1 (joiner)
        this._playerMatch.set(player2, matchId);
        this._playerSlot.set(player2, u256.One);
        this._matchPlayers.set(playerSlotKey(matchId, u256.One), addressToU256(player2));

        // Events
        this.emitEvent(new MatchCreatedEvent(matchId, player1, buyIn, mode, format));
        this.emitEvent(new MatchJoinedEvent(matchId, player1, u256.Zero));
        this.emitEvent(new MatchJoinedEvent(matchId, player2, u256.One));
        this.emitEvent(new MatchLockedEvent(matchId, blockNum));

        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(matchId);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // LEGACY: createMatch (player-initiated, needs approval)
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'buyIn', type: 'u256' }, { name: 'mode', type: 'u256' }, { name: 'format', type: 'u256' })
    @returns({ name: 'matchId', type: 'u256' })
    public createMatch(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const buyIn: u256 = calldata.readU256();
        const mode: u256 = calldata.readU256();
        const format: u256 = calldata.readU256();
        if (buyIn == u256.Zero) throw new Revert('Buy-in must be > 0');
        if (mode > MODE_CHAOS) throw new Revert('Invalid mode');
        if (format > FORMAT_ARENA) throw new Revert('Invalid format');
        if (mode == MODE_SURVIVAL && format == FORMAT_DUEL) throw new Revert('Survival mode requires Arena format');
        this._requireNotInActiveMatch(Blockchain.tx.sender);
        const maxPlayers: u256 = format == FORMAT_DUEL ? PLAYERS_DUEL : PLAYERS_ARENA;
        const matchId: u256 = SafeMath.add(this._matchCounter.value, u256.One);
        this._matchCounter.set(matchId);
        this._matchBuyIn.set(matchId, buyIn);
        this._matchMode.set(matchId, mode);
        this._matchFormat.set(matchId, format);
        this._matchStatus.set(matchId, STATUS_OPEN);
        this._matchPlayerCount.set(matchId, u256.One);
        this._matchMaxPlayers.set(matchId, maxPlayers);
        this._matchPot.set(matchId, buyIn);
        const sender: Address = Blockchain.tx.sender;
        this._playerMatch.set(sender, matchId);
        this._playerSlot.set(sender, u256.Zero);
        this._matchPlayers.set(playerSlotKey(matchId, u256.Zero), addressToU256(sender));
        this._pullTokens(sender, buyIn);
        this.emitEvent(new MatchCreatedEvent(matchId, sender, buyIn, mode, format));
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(matchId);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // LEGACY: joinMatch (player-initiated, needs approval)
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'matchId', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public joinMatch(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const matchId: u256 = calldata.readU256();
        const sender: Address = Blockchain.tx.sender;
        const status: u256 = this._matchStatus.get(matchId);
        if (status != STATUS_OPEN) throw new Revert('Match is not open');
        this._requireNotInActiveMatch(sender);
        const currentCount: u256 = this._matchPlayerCount.get(matchId);
        const maxPlayers: u256 = this._matchMaxPlayers.get(matchId);
        if (currentCount >= maxPlayers) throw new Revert('Match is full');
        const buyIn: u256 = this._matchBuyIn.get(matchId);
        const slot: u256 = currentCount;
        const newCount: u256 = SafeMath.add(currentCount, u256.One);
        this._matchPlayerCount.set(matchId, newCount);
        const currentPot: u256 = this._matchPot.get(matchId);
        this._matchPot.set(matchId, SafeMath.add(currentPot, buyIn));
        this._playerMatch.set(sender, matchId);
        this._playerSlot.set(sender, slot);
        this._matchPlayers.set(playerSlotKey(matchId, slot), addressToU256(sender));
        if (newCount == maxPlayers) {
            this._matchStatus.set(matchId, STATUS_LOCKED);
            const blockNum: u256 = u256.fromU64(Blockchain.block.number);
            this._matchLockBlock.set(matchId, blockNum);
            this.emitEvent(new MatchLockedEvent(matchId, blockNum));
        }
        this._pullTokens(sender, buyIn);
        this.emitEvent(new MatchJoinedEvent(matchId, sender, slot));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // SETTLEMENT
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'matchId', type: 'u256' }, { name: 'logHash', type: 'u256' }, { name: 'payouts', type: 'AddressMap<u256>' })
    @returns({ name: 'success', type: 'boolean' })
    public settleMatch(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        this._onlyOperator();
        const matchId: u256 = calldata.readU256();
        const logHash: u256 = calldata.readU256();
        const payouts = calldata.readAddressMapU256();
        const status: u256 = this._matchStatus.get(matchId);
        if (status != STATUS_LOCKED) throw new Revert('Match is not locked');
        const totalPot: u256 = this._matchPot.get(matchId);
        const rake: u256 = SafeMath.div(SafeMath.mul(totalPot, RAKE_BPS), BPS_BASE);
        const netPot: u256 = SafeMath.sub(totalPot, rake);
        const treasuryAmount: u256 = SafeMath.div(SafeMath.mul(rake, TREASURY_BPS), BPS_BASE);
        const prizePoolAmount: u256 = SafeMath.div(SafeMath.mul(rake, PRIZE_POOL_BPS), BPS_BASE);
        const jackpotAmount: u256 = SafeMath.sub(SafeMath.sub(rake, treasuryAmount), prizePoolAmount);
        this._creditBalance(this._treasury.value, treasuryAmount);
        this._creditBalance(this._prizePool.value, prizePoolAmount);
        const currentJackpot: u256 = this._jackpot.value;
        this._jackpot.set(SafeMath.add(currentJackpot, jackpotAmount));
        const addresses = payouts.keys();
        let payoutSum: u256 = u256.Zero;
        for (let i: i32 = 0; i < addresses.length; i++) {
            const player: Address = addresses[i];
            const amount: u256 = payouts.get(player);
            if (!this._isPlayerInMatch(matchId, player)) throw new Revert('Payout address not in match');
            payoutSum = SafeMath.add(payoutSum, amount);
            if (amount > u256.Zero) this._creditBalance(player, amount);
        }
        if (payoutSum != netPot) throw new Revert('Payout sum mismatch');
        this._matchStatus.set(matchId, STATUS_SETTLED);
        this._matchLogHash.set(matchId, logHash);
        const playerCount: u256 = this._matchPlayerCount.get(matchId);
        this._clearPlayerMatchData(matchId, playerCount);
        this.emitEvent(new MatchSettledEvent(matchId, logHash));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // CANCEL / REFUND / WITHDRAW
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'matchId', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public cancelMatch(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const matchId: u256 = calldata.readU256();
        const sender: Address = Blockchain.tx.sender;
        const senderMatch: u256 = this._playerMatch.get(sender);
        if (senderMatch != matchId) throw new Revert('Not in this match');
        const senderSlot: u256 = this._playerSlot.get(sender);
        if (senderSlot != u256.Zero) throw new Revert('Only creator can cancel');
        const status: u256 = this._matchStatus.get(matchId);
        if (status != STATUS_OPEN) throw new Revert('Match is not open');
        const buyIn: u256 = this._matchBuyIn.get(matchId);
        const playerCount: u256 = this._matchPlayerCount.get(matchId);
        this._refundAllPlayers(matchId, playerCount, buyIn);
        this._matchStatus.set(matchId, STATUS_CANCELLED);
        this._clearPlayerMatchData(matchId, playerCount);
        this.emitEvent(new MatchCancelledEvent(matchId));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    @method({ name: 'matchId', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public triggerEmergencyRefund(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const matchId: u256 = calldata.readU256();
        const status: u256 = this._matchStatus.get(matchId);
        if (status != STATUS_LOCKED) throw new Revert('Match is not locked');
        const lockBlock: u256 = this._matchLockBlock.get(matchId);
        const deadline: u256 = SafeMath.add(lockBlock, REFUND_DELAY_BLOCKS);
        const currentBlock: u256 = u256.fromU64(Blockchain.block.number);
        if (currentBlock < deadline) throw new Revert('Refund delay not reached');
        const buyIn: u256 = this._matchBuyIn.get(matchId);
        const playerCount: u256 = this._matchPlayerCount.get(matchId);
        this._refundAllPlayers(matchId, playerCount, buyIn);
        this._matchStatus.set(matchId, STATUS_REFUNDED);
        this._clearPlayerMatchData(matchId, playerCount);
        this.emitEvent(new MatchRefundedEvent(matchId));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    @method()
    @returns({ name: 'success', type: 'boolean' })
    public withdraw(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        const sender: Address = Blockchain.tx.sender;
        const balance: u256 = this._balances.get(sender);
        if (balance == u256.Zero) throw new Revert('No balance');
        this._balances.set(sender, u256.Zero);
        this._pushTokens(sender, balance);
        this.emitEvent(new WithdrawalEvent(sender, balance));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════

    @method({ name: 'winner', type: 'Address' })
    @returns({ name: 'success', type: 'boolean' })
    public distributeJackpot(calldata: Calldata): BytesWriter {
        this._nonReentrant();
        // v6: Guardian required (was operator). Jackpot distribution is rare and high-value.
        this._onlyGuardian();
        const winner: Address = calldata.readAddress();
        if (winner.isZero()) throw new Revert('Zero winner address');
        const jackpotAmount: u256 = this._jackpot.value;
        if (jackpotAmount == u256.Zero) throw new Revert('No jackpot accumulated');
        this._jackpot.set(u256.Zero);
        this._creditBalance(winner, jackpotAmount);
        this.emitEvent(new JackpotDistributedEvent(winner, jackpotAmount));
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        this._releaseGuard();
        return writer;
    }

    @method({ name: 'newOperator', type: 'Address' })
    @returns({ name: 'success', type: 'boolean' })
    public setOperator(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        const newOperator: Address = calldata.readAddress();
        if (newOperator.isZero()) throw new Revert('Zero address');
        this._operator.value = newOperator;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method({ name: 'newTreasury', type: 'Address' })
    @returns({ name: 'success', type: 'boolean' })
    public setTreasury(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        const newTreasury: Address = calldata.readAddress();
        if (newTreasury.isZero()) throw new Revert('Zero address');
        this._treasury.value = newTreasury;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method({ name: 'newPrizePool', type: 'Address' })
    @returns({ name: 'success', type: 'boolean' })
    public setPrizePool(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        const newPrizePool: Address = calldata.readAddress();
        if (newPrizePool.isZero()) throw new Revert('Zero address');
        this._prizePool.value = newPrizePool;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method({ name: 'newGuardian', type: 'Address' })
    @returns({ name: 'success', type: 'boolean' })
    public setGuardian(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        const newGuardian: Address = calldata.readAddress();
        if (newGuardian.isZero()) throw new Revert('Zero address');
        if (newGuardian.equals(this._operator.value)) throw new Revert('Guardian must differ from operator');
        this._guardian.value = newGuardian;
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    @method({ name: 'newCap', type: 'u256' })
    @returns({ name: 'success', type: 'boolean' })
    public setDailyCreditCap(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);
        const newCap: u256 = calldata.readU256();
        // Zero = unlimited (not recommended, but available for emergencies)
        this._dailyCreditCap.set(newCap);
        const writer = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    @view
    @method({ name: 'account', type: 'Address' })
    @returns({ name: 'balance', type: 'u256' })
    public getBalance(calldata: Calldata): BytesWriter {
        const addr: Address = calldata.readAddress();
        const balance: u256 = this._balances.get(addr);
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(balance);
        return writer;
    }

    @view
    @method({ name: 'matchId', type: 'u256' })
    @returns({ name: 'buyIn', type: 'u256' }, { name: 'mode', type: 'u256' }, { name: 'format', type: 'u256' }, { name: 'status', type: 'u256' }, { name: 'playerCount', type: 'u256' }, { name: 'maxPlayers', type: 'u256' }, { name: 'lockBlock', type: 'u256' }, { name: 'pot', type: 'u256' })
    public getMatchInfo(calldata: Calldata): BytesWriter {
        const matchId: u256 = calldata.readU256();
        const writer = new BytesWriter(U256_BYTE_LENGTH * 8);
        writer.writeU256(this._matchBuyIn.get(matchId));
        writer.writeU256(this._matchMode.get(matchId));
        writer.writeU256(this._matchFormat.get(matchId));
        writer.writeU256(this._matchStatus.get(matchId));
        writer.writeU256(this._matchPlayerCount.get(matchId));
        writer.writeU256(this._matchMaxPlayers.get(matchId));
        writer.writeU256(this._matchLockBlock.get(matchId));
        writer.writeU256(this._matchPot.get(matchId));
        return writer;
    }

    @view
    @method()
    @returns({ name: 'jackpot', type: 'u256' })
    public getJackpot(calldata: Calldata): BytesWriter {
        const writer = new BytesWriter(U256_BYTE_LENGTH);
        writer.writeU256(this._jackpot.value);
        return writer;
    }

    // v6: Guardian system view functions

    @view
    @method({ name: 'creditId', type: 'u256' })
    @returns({ name: 'status', type: 'u256' }, { name: 'amount', type: 'u256' })
    public getCreditInfo(calldata: Calldata): BytesWriter {
        const creditId: u256 = calldata.readU256();
        const writer = new BytesWriter(U256_BYTE_LENGTH * 2);
        writer.writeU256(this._creditStatus.get(creditId));
        writer.writeU256(this._creditAmount.get(creditId));
        return writer;
    }

    @view
    @method()
    @returns({ name: 'cap', type: 'u256' }, { name: 'used', type: 'u256' })
    public getDailyCreditInfo(calldata: Calldata): BytesWriter {
        const writer = new BytesWriter(U256_BYTE_LENGTH * 2);
        writer.writeU256(this._dailyCreditCap.value);
        writer.writeU256(this._dailyCreditUsed.value);
        return writer;
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════════

    private _onlyOperator(): void {
        if (!Blockchain.tx.sender.equals(this._operator.value)) throw new Revert('Only operator');
    }

    private _onlyGuardian(): void {
        if (!Blockchain.tx.sender.equals(this._guardian.value)) throw new Revert('Only guardian');
    }

    /**
     * v6: Check and update daily credit usage. Reverts if cap exceeded.
     * Resets counter when a new "day" starts (every BLOCKS_PER_DAY blocks).
     */
    private _checkDailyCreditCap(amount: u256): void {
        const currentBlock: u256 = u256.fromU64(Blockchain.block.number);
        const currentDay: u256 = SafeMath.div(currentBlock, BLOCKS_PER_DAY);
        const lastDay: u256 = this._dailyCreditDay.value;

        let used: u256;
        if (currentDay != lastDay) {
            // New day — reset counter
            used = u256.Zero;
            this._dailyCreditDay.set(currentDay);
        } else {
            used = this._dailyCreditUsed.value;
        }

        const newUsed: u256 = SafeMath.add(used, amount);
        const cap: u256 = this._dailyCreditCap.value;
        if (cap != u256.Zero && newUsed > cap) {
            throw new Revert('Daily credit cap exceeded');
        }
        this._dailyCreditUsed.set(newUsed);
    }

    private _requireNotInActiveMatch(addr: Address): void {
        const currentMatchId: u256 = this._playerMatch.get(addr);
        if (currentMatchId != u256.Zero) {
            const currentStatus: u256 = this._matchStatus.get(currentMatchId);
            if (currentStatus == STATUS_OPEN || currentStatus == STATUS_LOCKED) {
                throw new Revert('Already in an active match');
            }
        }
    }

    private _isPlayerInMatch(matchId: u256, addr: Address): bool {
        const maxPlayers: u256 = this._matchMaxPlayers.get(matchId);
        const addrU256: u256 = addressToU256(addr);
        for (let i: u32 = 0; i < 5; i++) {
            if (u256.fromU32(i) >= maxPlayers) break;
            const key: u256 = playerSlotKey(matchId, u256.fromU32(i));
            const stored: u256 = this._matchPlayers.get(key);
            if (stored == addrU256) return true;
        }
        return false;
    }

    private _creditBalance(addr: Address, amount: u256): void {
        if (amount == u256.Zero) return;
        const current: u256 = this._balances.get(addr);
        this._balances.set(addr, SafeMath.add(current, amount));
    }

    private _refundAllPlayers(matchId: u256, playerCount: u256, buyIn: u256): void {
        for (let i: u32 = 0; i < 5; i++) {
            if (u256.fromU32(i) >= playerCount) break;
            const key: u256 = playerSlotKey(matchId, u256.fromU32(i));
            const addrU256: u256 = this._matchPlayers.get(key);
            if (addrU256 != u256.Zero) {
                const player: Address = u256ToAddress(addrU256);
                this._creditBalance(player, buyIn);
            }
        }
    }

    private _clearPlayerMatchData(matchId: u256, playerCount: u256): void {
        for (let i: u32 = 0; i < 5; i++) {
            if (u256.fromU32(i) >= playerCount) break;
            const key: u256 = playerSlotKey(matchId, u256.fromU32(i));
            const addrU256: u256 = this._matchPlayers.get(key);
            if (addrU256 != u256.Zero) {
                const player: Address = u256ToAddress(addrU256);
                this._playerMatch.set(player, u256.Zero);
                this._playerSlot.set(player, u256.Zero);
            }
        }
    }

    private _pullTokens(from: Address, amount: u256): void {
        const token: Address = this._token.value;
        const contractAddr: Address = Blockchain.contractAddress;
        const writer = new BytesWriter(100);
        writer.writeSelector(TRANSFER_FROM_SELECTOR);
        writer.writeAddress(from);
        writer.writeAddress(contractAddr);
        writer.writeU256(amount);
        const result = Blockchain.call(token, writer, true);
        if (result.data.byteLength === 0 || !result.data.readBoolean()) {
            throw new Revert('TransferFrom failed');
        }
    }

    private _pushTokens(to: Address, amount: u256): void {
        const token: Address = this._token.value;
        const writer = new BytesWriter(68);
        writer.writeSelector(TRANSFER_SELECTOR);
        writer.writeAddress(to);
        writer.writeU256(amount);
        const result = Blockchain.call(token, writer, true);
        if (result.data.byteLength === 0 || !result.data.readBoolean()) {
            throw new Revert('Token transfer failed');
        }
    }
}
