import { WalletClient } from "./walletClient";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment";
import {LocalStorageManager, StorageManager} from "./storageManager";
import {CallContractRequest, CredentialInfo} from "./generated/waas.gen";

export class OmsWallet {
    public readonly wallet: WalletClient;

    constructor(params: {
        projectAccessKey: string;
        environment?: OmsEnvironment;
        storage?: StorageManager;
    }) {
        this.wallet = new WalletClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment ?? defaultOmsEnvironment,
            storage: params.storage ?? new LocalStorageManager(),
        });
    }

    async signInWithEmail(email: string): Promise<void> {
        await this.wallet.signInWithEmail(email);
    }

    async completeEmailSignIn(code: string): Promise<void> {
        await this.wallet.completeEmailSignIn(code);
    }

    async signMessage(network: string, message: string): Promise<string> {
        return this.wallet.signMessage(network, message);
    }

    async sendTransaction(network: string, to: string, value: string): Promise<string> {
        return this.wallet.sendTransaction(network, to, value);
    }

    async callContract(params: CallContractRequest): Promise<string> {
        return this.wallet.callContract(params);
    }

    async listAccess(): Promise<CredentialInfo[]> {
        return this.wallet.listAccess();
    }

    async revokeAccess(targetCredentialId: string): Promise<void> {
        await this.wallet.revokeAccess(targetCredentialId);
    }

    async clearSession(): Promise<void> {
        this.wallet.clearSession();
    }
}