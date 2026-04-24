import { WalletClient } from "./clients/walletClient";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment";
import {LocalStorageManager, StorageManager} from "./storageManager";
import {IndexerClient} from "./clients/indexerClient";

export class OMSClient {
    public readonly wallet: WalletClient;
    public readonly indexer: IndexerClient;

    constructor(params: {
        projectAccessKey: string;
        environment?: OmsEnvironment;
        storage?: StorageManager;
    }) {
        this.wallet = new WalletClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment ?? defaultOmsEnvironment,
            storage: params.storage ?? new LocalStorageManager()
        });

        this.indexer = new IndexerClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment ?? defaultOmsEnvironment
        });
    }
}