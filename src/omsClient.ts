import { WalletClient } from "./clients/walletClient";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment";
import {LocalStorageManager, StorageManager} from "./storageManager";
import {IndexerClient} from "./clients/indexerClient";
import type {CredentialSigner} from "./credentialSigner";

export class OMSClient {
    public readonly wallet: WalletClient;
    public readonly indexer: IndexerClient;

    constructor(params: {
        projectAccessKey: string;
        environment?: OmsEnvironment;
        storage?: StorageManager;
        credentialSigner?: CredentialSigner;
    }) {
        this.wallet = new WalletClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment ?? defaultOmsEnvironment,
            storage: params.storage ?? new LocalStorageManager(),
            credentialSigner: params.credentialSigner
        });

        this.indexer = new IndexerClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment ?? defaultOmsEnvironment
        });
    }
}
