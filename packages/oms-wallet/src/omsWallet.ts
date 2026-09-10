import type { OMSWalletIndexerClient } from './clients/indexerClient.js';
import type { CredentialSigner } from './credentialSigner.js';
import type { StorageManager } from './storageManager.js';
import type { OMSWalletClient } from './wallet.js';

import { IndexerClient } from './clients/indexerClient.js';
import { WalletClient } from './clients/walletClient.js';
import { environmentFromPublishableKey } from './omsEnvironment.js';
import { parsePublishableKey } from './publishableKey.js';
import { createDefaultStorage } from './storageManager.js';

export interface OMSWalletParams {
  publishableKey: string;
  storage?: StorageManager;
  redirectAuthStorage?: StorageManager;
  credentialSigner?: CredentialSigner;
}

export class OMSWallet {
  public readonly wallet: OMSWalletClient;
  public readonly indexer: OMSWalletIndexerClient;

  constructor(params: OMSWalletParams) {
    const parsedKey = parsePublishableKey(params.publishableKey);
    const environment = environmentFromPublishableKey(params.publishableKey);
    const storage = params.storage ?? createDefaultStorage();

    this.wallet = new WalletClient({
      publishableKey: params.publishableKey,
      projectId: parsedKey.projectId,
      environment,
      storage,
      redirectAuthStorage: params.redirectAuthStorage,
      credentialSigner: params.credentialSigner,
      walletImportTrustedPcr0s: parsedKey.walletImportTrustedPcr0s,
      walletImportAttestationMode: parsedKey.walletImportAttestationMode
    });

    this.indexer = new IndexerClient({
      publishableKey: params.publishableKey,
      environment
    });
  }
}
