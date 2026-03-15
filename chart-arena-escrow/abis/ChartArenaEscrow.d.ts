import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the deposit function call.
 */
export type Deposit = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the operatorPullDeposit function call.
 */
export type OperatorPullDeposit = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the operatorCreditDeposit function call.
 */
export type OperatorCreditDeposit = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the operatorCreateMatch function call.
 */
export type OperatorCreateMatch = CallResult<
    {
        matchId: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the createMatch function call.
 */
export type CreateMatch = CallResult<
    {
        matchId: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the joinMatch function call.
 */
export type JoinMatch = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the settleMatch function call.
 */
export type SettleMatch = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the cancelMatch function call.
 */
export type CancelMatch = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the triggerEmergencyRefund function call.
 */
export type TriggerEmergencyRefund = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the withdraw function call.
 */
export type Withdraw = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the distributeJackpot function call.
 */
export type DistributeJackpot = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setOperator function call.
 */
export type SetOperator = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setTreasury function call.
 */
export type SetTreasury = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setPrizePool function call.
 */
export type SetPrizePool = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getBalance function call.
 */
export type GetBalance = CallResult<
    {
        balance: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getMatchInfo function call.
 */
export type GetMatchInfo = CallResult<
    {
        buyIn: bigint;
        mode: bigint;
        format: bigint;
        status: bigint;
        playerCount: bigint;
        maxPlayers: bigint;
        lockBlock: bigint;
        pot: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getJackpot function call.
 */
export type GetJackpot = CallResult<
    {
        jackpot: bigint;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// IChartArenaEscrow
// ------------------------------------------------------------------
export interface IChartArenaEscrow extends IOP_NETContract {
    deposit(amount: bigint): Promise<Deposit>;
    operatorPullDeposit(player: Address, amount: bigint): Promise<OperatorPullDeposit>;
    operatorCreditDeposit(player: Address, amount: bigint): Promise<OperatorCreditDeposit>;
    operatorCreateMatch(
        buyIn: bigint,
        mode: bigint,
        format: bigint,
        player1: Address,
        player2: Address,
    ): Promise<OperatorCreateMatch>;
    createMatch(buyIn: bigint, mode: bigint, format: bigint): Promise<CreateMatch>;
    joinMatch(matchId: bigint): Promise<JoinMatch>;
    settleMatch(matchId: bigint, logHash: bigint, payouts: AddressMap<bigint>): Promise<SettleMatch>;
    cancelMatch(matchId: bigint): Promise<CancelMatch>;
    triggerEmergencyRefund(matchId: bigint): Promise<TriggerEmergencyRefund>;
    withdraw(): Promise<Withdraw>;
    distributeJackpot(winner: Address): Promise<DistributeJackpot>;
    setOperator(newOperator: Address): Promise<SetOperator>;
    setTreasury(newTreasury: Address): Promise<SetTreasury>;
    setPrizePool(newPrizePool: Address): Promise<SetPrizePool>;
    getBalance(account: Address): Promise<GetBalance>;
    getMatchInfo(matchId: bigint): Promise<GetMatchInfo>;
    getJackpot(): Promise<GetJackpot>;
}
