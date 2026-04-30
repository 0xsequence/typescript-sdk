import { WalletClient } from "./clients/walletClient.js";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment.js";
import {LocalStorageManager, StorageManager} from "./storageManager.js";
import {IndexerClient} from "./clients/indexerClient.js";
import type {CredentialSigner} from "./credentialSigner.js";

export class OMSClient<Env extends OmsEnvironment = OmsEnvironment> {
    public readonly wallet: WalletClient<Env>;
    public readonly indexer: IndexerClient;

    constructor(params: {
        projectAccessKey: string;
        environment?: Env;
        storage?: StorageManager;
        redirectAuthStorage?: StorageManager;
        credentialSigner?: CredentialSigner;
    }) {
        const environment = params.environment ?? defaultOmsEnvironment as Env;
        this.wallet = new WalletClient({
            projectAccessKey: params.projectAccessKey,
            environment,
            storage: params.storage ?? new LocalStorageManager(),
            redirectAuthStorage: params.redirectAuthStorage,
            credentialSigner: params.credentialSigner
        });

        this.indexer = new IndexerClient({
            projectAccessKey: params.projectAccessKey,
            environment
        });
    }
}
