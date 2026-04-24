import { WalletClient } from "./clients/walletClient.js";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment.js";
import {LocalStorageManager, StorageManager} from "./storageManager.js";
import {IndexerClient} from "./clients/indexerClient.js";
import type {CredentialSigner} from "./credentialSigner.js";

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
