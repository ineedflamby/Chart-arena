import { Mnemonic, AddressTypes, MLDSASecurityLevel } from '@btc-vision/transaction';
import type { Address } from '@btc-vision/transaction';
import { config, loadMnemonic } from '../config.js';
import { logger } from '../utils/logger.js';

const TAG = 'OperatorWallet';

interface DerivedWallet {
    readonly p2tr: string;
    readonly address: Address;
    readonly keypair: unknown;
    readonly mldsaKeypair: unknown;
    readonly publicKey: Uint8Array;
}

class OperatorWalletService {
    private wallet: DerivedWallet | null = null;
    private mnemonic: Mnemonic | null = null;

    public init(): void {
        const words = loadMnemonic();
        this.mnemonic = new Mnemonic(words, '', config.network, MLDSASecurityLevel.LEVEL2);
        const derived = this.mnemonic.deriveOPWallet(AddressTypes.P2TR, config.operatorIndex);
        this.wallet = {
            p2tr: derived.p2tr,
            address: derived.address,
            keypair: derived.keypair,
            mldsaKeypair: derived.mldsaKeypair,
            publicKey: derived.publicKey,
        };
        logger.info(TAG, `Operator wallet ready: ${this.wallet.p2tr}`);
    }

    public get p2tr(): string { this.ensureInit(); return this.wallet!.p2tr; }
    public get address(): Address { this.ensureInit(); return this.wallet!.address; }
    public get keypair(): unknown { this.ensureInit(); return this.wallet!.keypair; }
    public get mldsaKeypair(): unknown { this.ensureInit(); return this.wallet!.mldsaKeypair; }
    public get publicKey(): Uint8Array { this.ensureInit(); return this.wallet!.publicKey; }

    public deriveTestWallet(index: number): DerivedWallet {
        if (!this.mnemonic) throw new Error('Wallet not initialized');
        const derived = this.mnemonic.deriveOPWallet(AddressTypes.P2TR, index);
        return {
            p2tr: derived.p2tr, address: derived.address,
            keypair: derived.keypair, mldsaKeypair: derived.mldsaKeypair,
            publicKey: derived.publicKey,
        };
    }

    private ensureInit(): void {
        if (!this.wallet) throw new Error('OperatorWallet not initialized — call init() first');
    }
}

export const operatorWallet = new OperatorWalletService();
