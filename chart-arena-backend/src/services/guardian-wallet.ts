/**
 * Guardian Wallet Service — C-02 FIX
 *
 * Second signer for sensitive operations (credit deposits, jackpot distribution).
 * Must be a DIFFERENT mnemonic/key from the operator wallet.
 *
 * SETUP:
 *   1. Generate a new mnemonic: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *      Then use the opnet CLI to derive a mnemonic, or generate via OP_WALLET.
 *   2. Set GUARDIAN_MNEMONIC env var (separate from OPERATOR_MNEMONIC)
 *   3. Set GUARDIAN_INDEX env var (default: 0) — derivation path index
 *   4. Fund the guardian address with tBTC for gas
 *
 * SECURITY:
 *   - Keep on a different machine or hardware wallet if possible
 *   - Never store both mnemonics in the same file or env
 *   - The guardian only signs confirmCredit() and distributeJackpot()
 *   - The backend auto-confirms credits after verifying the MOTO transfer
 *   - For maximum security, run the guardian as a separate process
 */
import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import type { Address } from '@btc-vision/transaction';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'GuardianWallet';

interface DerivedWallet {
    readonly p2tr: string;
    readonly address: Address;
    readonly keypair: unknown;
    readonly mldsaKeypair: unknown;
    readonly publicKey: Uint8Array;
}

class GuardianWalletService {
    private wallet: DerivedWallet | null = null;
    private _enabled: boolean = false;

    /**
     * Initialize the guardian wallet.
     * If GUARDIAN_MNEMONIC is not set, guardian features are disabled
     * (contract calls requiring guardian will fail — intentional for dev mode).
     */
    public init(): void {
        const envMnemonic = process.env['GUARDIAN_MNEMONIC'];
        if (!envMnemonic || envMnemonic.trim().length === 0) {
            if (config.devMode) {
                logger.warn(TAG, 'DEV_MODE: GUARDIAN_MNEMONIC not set — guardian features disabled');
                this._enabled = false;
                return;
            }
            throw new Error(
                'FATAL: GUARDIAN_MNEMONIC env var is required in production.\n' +
                '   Generate a separate mnemonic for the guardian wallet.\n' +
                '   This MUST be different from OPERATOR_MNEMONIC.'
            );
        }

        const words = envMnemonic.trim();
        if (words.split(/\s+/).length < 12) {
            throw new Error('GUARDIAN_MNEMONIC must be at least 12 words');
        }

        const guardianIndex = parseInt(process.env['GUARDIAN_INDEX'] ?? '0', 10);
        const mnemonic = new Mnemonic(words, '', config.network, MLDSASecurityLevel.LEVEL2);
        const derived = mnemonic.deriveOPWallet(AddressTypes.P2TR, guardianIndex);

        this.wallet = {
            p2tr: derived.p2tr,
            address: derived.address,
            keypair: derived.keypair,
            mldsaKeypair: derived.mldsaKeypair,
            publicKey: derived.publicKey,
        };
        this._enabled = true;
        logger.info(TAG, `Guardian wallet ready: ${this.wallet.p2tr}`);
    }

    public get enabled(): boolean { return this._enabled; }
    public get p2tr(): string { this.ensureInit(); return this.wallet!.p2tr; }
    public get address(): Address { this.ensureInit(); return this.wallet!.address; }
    public get keypair(): unknown { this.ensureInit(); return this.wallet!.keypair; }
    public get mldsaKeypair(): unknown { this.ensureInit(); return this.wallet!.mldsaKeypair; }

    private ensureInit(): void {
        if (!this._enabled || !this.wallet) {
            throw new Error('GuardianWallet not initialized — set GUARDIAN_MNEMONIC env var');
        }
    }
}

export const guardianWallet = new GuardianWalletService();
