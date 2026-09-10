import { afterEach, describe, expect, it, vi } from 'vitest';

import { Networks, OMSWallet, SolanaNetworks } from '../src';
import { parsePublishableKey } from '../src/publishableKey';
import { MemoryStorageManager } from '../src/storageManager';

const walletAddress = '0x9999999999999999999999999999999999999999';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OMSWallet publishable key routing', () => {
  it.each([
    [
      'pk_local_sdbx_project_key',
      'https://sandbox-api.local.polygon-dev.technology',
      '0'.repeat(96)
    ],
    ['pk_local_live_project_key', 'https://api.local.polygon-dev.technology', '0'.repeat(96)],
    ['pk_dev_sdbx_project_key', 'https://sandbox-api.dev.polygon-dev.technology', '0'.repeat(96)],
    ['pk_dev_live_project_key', 'https://api.dev.polygon-dev.technology', '0'.repeat(96)],
    [
      'pk_stg_sdbx_project_key',
      'https://sandbox-api.stg.polygon-dev.technology',
      'e4da1f70f6e781d7196dff36d21e57bb5603ec4bcacefb7061493049292b76b620b0ad23b82e280d6130f67384051e9f'
    ],
    [
      'pk_stg_live_project_key',
      'https://api.stg.polygon-dev.technology',
      'e4da1f70f6e781d7196dff36d21e57bb5603ec4bcacefb7061493049292b76b620b0ad23b82e280d6130f67384051e9f'
    ],
    [
      'pk_sdbx_project_key',
      'https://sandbox-api.polygon.technology',
      '671f22183eed852f4051a50ee54b45153499501538cbd64a277b8ff22a012b37f1905ebfcf7a6be8ce00ec0c8db7bbd2'
    ],
    [
      'pk_live_project_key',
      'https://api.polygon.technology',
      '671f22183eed852f4051a50ee54b45153499501538cbd64a277b8ff22a012b37f1905ebfcf7a6be8ce00ec0c8db7bbd2'
    ]
  ])('derives managed environment configuration from %s', (publishableKey, apiUrl, pcr0) => {
    expect(parsePublishableKey(publishableKey)).toEqual({
      projectId: 'prj_project',
      walletApiUrl: apiUrl,
      indexerGatewayUrl: `${apiUrl}/v1/IndexerGateway/`,
      solanaIndexerGatewayUrl: `${apiUrl}/v1/SolanaIndexerGateway/`,
      walletImportTrustedPcr0s: [pcr0]
    });
  });

  it('uses the derived URLs for WaaS and indexer requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/v1/WaasPublic/IsValidMessageSignature')) {
        return jsonResponse({ isValid: true });
      }

      if (url.endsWith('/v1/IndexerGateway/GetTokenBalancesDetails')) {
        return jsonResponse({
          page: { page: 0, pageSize: 40, more: false },
          nativeBalances: [],
          balances: []
        });
      }

      if (url.endsWith('/v1/SolanaIndexerGateway/GetTokenBalancesDetails')) {
        return jsonResponse({ balances: [], errors: [] });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const oms = new OMSWallet({
      publishableKey: 'pk_stg_live_project_key',
      storage: new MemoryStorageManager()
    });

    await expect(
      oms.wallet.isValidMessageSignature({
        network: Networks.polygon,
        walletAddress,
        message: 'hello',
        signature: '0xsignature'
      })
    ).resolves.toBe(true);
    await expect(
      oms.indexer.getBalances({
        networks: [Networks.polygon],
        walletAddress,
        includeMetadata: false
      })
    ).resolves.toMatchObject({
      status: 200,
      nativeBalances: [],
      balances: []
    });
    await expect(
      oms.indexer.getSolanaBalances({
        networks: [SolanaNetworks.mainnet],
        walletAddress: 'solana-wallet'
      })
    ).resolves.toEqual({ status: 200, balances: [], errors: [] });

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://api.stg.polygon-dev.technology/v1/WaasPublic/IsValidMessageSignature'
    );
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      'https://api.stg.polygon-dev.technology/v1/IndexerGateway/GetTokenBalancesDetails'
    );
    expect(fetchMock.mock.calls[2][0].toString()).toBe(
      'https://api.stg.polygon-dev.technology/v1/SolanaIndexerGateway/GetTokenBalancesDetails'
    );
  });

  it('rejects unsupported publishable key prefixes', () => {
    expect(
      () =>
        new OMSWallet({
          publishableKey: 'pk_test_sdbx_project_key',
          storage: new MemoryStorageManager()
        })
    ).toThrow('Invalid publishableKey.');
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
