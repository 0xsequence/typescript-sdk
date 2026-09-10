import { parsePublishableKey } from './publishableKey.js';

export interface OMSWalletEnvironment {
  walletApiUrl: string;
  indexerGatewayUrl: string;
  solanaIndexerGatewayUrl: string;
}

export function environmentFromPublishableKey(publishableKey: string): OMSWalletEnvironment {
  const parsedKey = parsePublishableKey(publishableKey);
  return {
    walletApiUrl: parsedKey.walletApiUrl,
    indexerGatewayUrl: parsedKey.indexerGatewayUrl,
    solanaIndexerGatewayUrl: parsedKey.solanaIndexerGatewayUrl
  };
}
