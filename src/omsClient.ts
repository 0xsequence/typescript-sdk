import { WalletClient } from "./clients/walletClient.js";
import {defaultOmsEnvironment, OmsEnvironment} from "./omsEnvironment.js";
import {createDefaultStorage, StorageManager} from "./storageManager.js";
import {IndexerClient} from "./clients/indexerClient.js";
import type {CredentialSigner} from "./credentialSigner.js";

interface OMSClientBaseParams {
    projectAccessKey: string;
    storage?: StorageManager;
    redirectAuthStorage?: StorageManager;
    credentialSigner?: CredentialSigner;
}

export type OMSClientParams<Env extends OmsEnvironment = OmsEnvironment> =
    OMSClientBaseParams & {environment: Env};

type DefaultOMSClientParams = OMSClientBaseParams & {environment?: undefined};

class OMSClientImpl<Env extends OmsEnvironment = OmsEnvironment> {
    public readonly wallet: WalletClient<Env>;
    public readonly indexer: IndexerClient;

    constructor(params: OMSClientBaseParams & {environment?: Env}) {
        const environment = (params.environment ?? defaultOmsEnvironment) as Env;
        const storage = params.storage ?? createDefaultStorage()

        this.wallet = new WalletClient({
            projectAccessKey: params.projectAccessKey,
            environment,
            storage,
            redirectAuthStorage: params.redirectAuthStorage,
            credentialSigner: params.credentialSigner
        });

        this.indexer = new IndexerClient({
            projectAccessKey: params.projectAccessKey,
            environment
        });
    }

}

export type OMSClient<Env extends OmsEnvironment = OmsEnvironment> = OMSClientImpl<Env>;

interface OMSClientConstructor {
    new(params: DefaultOMSClientParams): OMSClient<typeof defaultOmsEnvironment>;
    new<const Env extends OmsEnvironment>(params: OMSClientParams<Env>): OMSClient<Env>;
    new(params: OMSClientBaseParams & {environment?: OmsEnvironment}): OMSClient;
}

export const OMSClient: OMSClientConstructor = OMSClientImpl as unknown as OMSClientConstructor;
