import { OMSWalletValidationError } from './errors.js';

interface PublishableKeyRoute {
  prefix: string;
  apiUrl: string;
  walletImportTrustedPcr0s: ReadonlyArray<string>;
}

// Staging and Production measurements come from the corresponding WaaS GitHub releases. During
// rotation, publish an SDK that trusts both the current and replacement measurements before the
// replacement enclave is deployed, then remove the retired measurement in a later SDK release.
const debugWalletImportPcr0s = ['0'.repeat(96)];
const stagingWalletImportPcr0s = [
  'e4da1f70f6e781d7196dff36d21e57bb5603ec4bcacefb7061493049292b76b620b0ad23b82e280d6130f67384051e9f'
];
const productionWalletImportPcr0s = [
  '671f22183eed852f4051a50ee54b45153499501538cbd64a277b8ff22a012b37f1905ebfcf7a6be8ce00ec0c8db7bbd2'
];

const publishableKeyRoutes: PublishableKeyRoute[] = [
  {
    prefix: 'pk_local_sdbx_',
    apiUrl: 'https://sandbox-api.local.polygon-dev.technology',
    walletImportTrustedPcr0s: debugWalletImportPcr0s
  },
  {
    prefix: 'pk_local_live_',
    apiUrl: 'https://api.local.polygon-dev.technology',
    walletImportTrustedPcr0s: debugWalletImportPcr0s
  },
  {
    prefix: 'pk_dev_sdbx_',
    apiUrl: 'https://sandbox-api.dev.polygon-dev.technology',
    walletImportTrustedPcr0s: debugWalletImportPcr0s
  },
  {
    prefix: 'pk_dev_live_',
    apiUrl: 'https://api.dev.polygon-dev.technology',
    walletImportTrustedPcr0s: debugWalletImportPcr0s
  },
  {
    prefix: 'pk_stg_sdbx_',
    apiUrl: 'https://sandbox-api.stg.polygon-dev.technology',
    walletImportTrustedPcr0s: stagingWalletImportPcr0s
  },
  {
    prefix: 'pk_stg_live_',
    apiUrl: 'https://api.stg.polygon-dev.technology',
    walletImportTrustedPcr0s: stagingWalletImportPcr0s
  },
  {
    prefix: 'pk_sdbx_',
    apiUrl: 'https://sandbox-api.polygon.technology',
    walletImportTrustedPcr0s: productionWalletImportPcr0s
  },
  {
    prefix: 'pk_live_',
    apiUrl: 'https://api.polygon.technology',
    walletImportTrustedPcr0s: productionWalletImportPcr0s
  }
];

export interface ParsedPublishableKey {
  projectId: string;
  walletApiUrl: string;
  indexerGatewayUrl: string;
  solanaIndexerGatewayUrl: string;
  walletImportTrustedPcr0s: ReadonlyArray<string>;
}

export function parsePublishableKey(publishableKey: string): ParsedPublishableKey {
  const route = publishableKeyRoutes.find(({ prefix }) => publishableKey.startsWith(prefix));
  if (!route) {
    throw invalidPublishableKey();
  }

  const keyParts = publishableKey.slice(route.prefix.length).split('_');
  if (keyParts.length !== 2 || keyParts.some((part) => part.length === 0)) {
    throw invalidPublishableKey();
  }

  return {
    projectId: `prj_${keyParts[0]}`,
    walletApiUrl: route.apiUrl,
    indexerGatewayUrl: `${route.apiUrl}/v1/IndexerGateway/`,
    solanaIndexerGatewayUrl: `${route.apiUrl}/v1/SolanaIndexerGateway/`,
    walletImportTrustedPcr0s: route.walletImportTrustedPcr0s
  };
}

function invalidPublishableKey(): OMSWalletValidationError {
  return new OMSWalletValidationError({
    message: 'Invalid publishableKey.'
  });
}
