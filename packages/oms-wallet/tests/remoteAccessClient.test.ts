import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemoteAccessClient } from '../src/clients/remoteAccessClient';
import type { CredentialSigner } from '../src/credentialSigner';
import { Networks } from '../src/networks';
import { feeOptionSelection } from '../src/types/transactionTypes';
import { TransactionStatus } from '../src/types/waas';

class MockSigner implements CredentialSigner {
  readonly signingAlgorithm = 'ecdsa-p256k-eip191';

  async credentialId(): Promise<string> {
    return '0x1111111111111111111111111111111111111111';
  }

  async nextNonce(): Promise<string> {
    return '42';
  }

  async sign(): Promise<string> {
    return `0x${'22'.repeat(65)}`;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RemoteAccessClient', () => {
  it('registers its signed credential with remote-application metadata', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toContain('/RegisterCredential');
      expect(JSON.parse(init?.body as string)).toEqual({
        lifetime: 604800,
        metadata: {
          appUrl: 'https://admin.example',
          appName: 'Example admin',
          appLogoUrl: 'https://admin.example/logo.svg',
          custom: { environment: 'demo' }
        }
      });
      expect(new Headers(init?.headers).get('Api-Key')).toBe('pk_dev_sdbx_project_key');
      expect(new Headers(init?.headers).get('OMS-Wallet-Signature')).toContain(
        '0x1111111111111111111111111111111111111111'
      );
      return jsonResponse({ credentialId: `0x${'33'.repeat(32)}` });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(
      client.registerCredential({
        lifetimeSeconds: 604800,
        metadata: {
          appUrl: 'https://admin.example',
          appName: 'Example admin',
          appLogoUrl: 'https://admin.example/logo.svg',
          custom: { environment: 'demo' }
        }
      })
    ).resolves.toEqual({
      credentialId: `0x${'33'.repeat(32)}`
    });
  });

  it('prepares and executes a session transaction, then reads its status', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareEthereumTransaction')) {
        expect(body).toEqual({
          network: '80002',
          walletId: 'wallet-1',
          sessionId: 'session-1',
          to: '0x2222222222222222222222222222222222222222',
          value: '10000000000000000',
          mode: 'relayer'
        });
        return jsonResponse({
          txnId: 'txn-1',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '80002',
                name: 'Polygon',
                symbol: 'POL',
                type: 'native'
              },
              value: '1',
              displayValue: '0.000000000000000001'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({ txnId: 'txn-1', feeOption: { token: 'POL', index: 0 } });
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        expect(body).toEqual({ txnId: 'txn-1' });
        return jsonResponse({ status: 'executed', txnHash: '0xabc' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const prepared = await client.prepareTransaction({
      walletId: 'wallet-1',
      sessionId: 'session-1',
      network: Networks.amoy,
      to: '0x2222222222222222222222222222222222222222',
      value: 10_000_000_000_000_000n
    });
    expect(prepared).toMatchObject({
      txnId: 'txn-1',
      status: TransactionStatus.Quoted,
      sponsored: false
    });

    await expect(
      client.executeTransaction({
        txnId: prepared.txnId,
        feeOption: feeOptionSelection(prepared.feeOptions[0], 0)
      })
    ).resolves.toEqual({ status: TransactionStatus.Pending });
    await expect(client.getTransactionStatus({ txnId: prepared.txnId })).resolves.toEqual({
      status: TransactionStatus.Executed,
      txnHash: '0xabc'
    });
  });

  it('revokes a registered credential by its WaaS credential id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toContain('/RevokeCredential');
      expect(JSON.parse(init?.body as string)).toEqual({
        credentialId: `0x${'33'.repeat(32)}`
      });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createClient().revokeCredential({ credentialId: `0x${'33'.repeat(32)}` })
    ).resolves.toBeUndefined();
  });

  it('lists, reads, and reports usage for its authorized sessions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/ListSessions')) {
        if (!body.page?.cursor) {
          expect(body).toEqual({ page: { limit: 1 } });
          return jsonResponse({
            sessions: [testSession('session-1')],
            page: { cursor: 'next' }
          });
        }
        expect(body).toEqual({ page: { limit: 1, cursor: 'next' } });
        return jsonResponse({ sessions: [testSession('session-2')] });
      }

      if (url.endsWith('/GetSessionUsage')) {
        expect(body).toEqual({ sessionId: 'session-1', network: '80002' });
        return jsonResponse({
          entries: [{ grant: testSession('session-1').grants.entries[0], used: '25' }]
        });
      }

      if (url.endsWith('/GetSession')) {
        expect(body).toEqual({ sessionId: 'session-1' });
        return jsonResponse({ session: testSession('session-1') });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(client.listSessions({ pageSize: 1 })).resolves.toHaveLength(2);
    await expect(client.getSession({ sessionId: 'session-1' })).resolves.toEqual({
      sessionId: 'session-1',
      walletId: 'wallet-1',
      signerAddress: '0x1111111111111111111111111111111111111111',
      grants: [
        {
          kind: 'nativeTransfer',
          to: '0x2222222222222222222222222222222222222222',
          limit: 100n
        }
      ],
      chainId: 80002,
      expiresAt: '2099-01-01T00:00:00Z'
    });
    await expect(
      client.getSessionUsage({ sessionId: 'session-1', network: Networks.amoy })
    ).resolves.toEqual([
      {
        grant: {
          kind: 'nativeTransfer',
          to: '0x2222222222222222222222222222222222222222',
          limit: 100n
        },
        used: 25n
      }
    ]);
  });

  it('maps invalid transaction input to a public validation error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createClient().prepareTransaction({
        walletId: 'wallet-1',
        sessionId: 'session-1',
        network: Networks.amoy,
        to: '0x2222222222222222222222222222222222222222',
        value: -1n
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'remoteAccess.prepareTransaction'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps malformed session payloads to a public response error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ session: { ...testSession('session-1'), chainId: '8.2' } }))
    );

    await expect(createClient().getSession({ sessionId: 'session-1' })).rejects.toMatchObject({
      code: 'OMS_INVALID_RESPONSE',
      operation: 'remoteAccess.getSession'
    });
  });
});

function createClient(): RemoteAccessClient {
  return new RemoteAccessClient({
    publishableKey: 'pk_dev_sdbx_project_key',
    credentialSigner: new MockSigner()
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function testSession(sessionId: string) {
  return {
    sessionId,
    walletId: 'wallet-1',
    signerAddress: '0x1111111111111111111111111111111111111111',
    grants: {
      entries: [
        {
          kind: 'nativeTransfer',
          nativeTransfer: {
            to: '0x2222222222222222222222222222222222222222',
            limit: '100'
          }
        }
      ]
    },
    chainId: '80002',
    expiresAt: '2099-01-01T00:00:00Z'
  };
}
