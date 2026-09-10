import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletClient } from '../src/clients/walletClient';
import type { CredentialSigner } from '../src/credentialSigner';
import { Networks } from '../src/networks';
import { MemoryStorageManager } from '../src/storageManager';
import { WalletType } from '../src/types/waas';

class MockSigner implements CredentialSigner {
  readonly signingAlgorithm = 'ecdsa-p256-sha256';

  async credentialId(): Promise<string> {
    return '0x04' + '11'.repeat(64);
  }

  async nextNonce(): Promise<string> {
    return '42';
  }

  async sign(): Promise<string> {
    return '0x' + '22'.repeat(64);
  }

  async hasCredential(): Promise<boolean> {
    return true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WalletClient access management', () => {
  it('lists all wallet access pages as a flattened grant array', async () => {
    const requests: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/ListAccess')) {
        requests.push(body);
        if (requests.length === 1) {
          return jsonResponse({
            credentials: [testCredential('11')],
            page: { cursor: 'cursor-2' }
          });
        }
        return jsonResponse({
          credentials: [testCredential('22', false)],
          page: {}
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();

    await expect(wallet.listAccess({ pageSize: 2 })).resolves.toEqual([
      testCredential('11'),
      testCredential('22', false)
    ]);
    expect(requests).toEqual([
      { walletId: 'wallet-id', page: { limit: 2 } },
      { walletId: 'wallet-id', page: { limit: 2, cursor: 'cursor-2' } }
    ]);
  });

  it('yields wallet access pages for paginated callers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/ListAccess')) {
        return jsonResponse({
          credentials: [testCredential()],
          page: {}
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    const pages = [];
    for await (const page of wallet.listAccessPages({ pageSize: 25 })) {
      pages.push(page);
    }

    expect(pages).toEqual([{ grants: [testCredential()] }]);
  });

  it('maps remote session access entries and filters them by type', async () => {
    const requests: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/ListAccess')) {
        requests.push(JSON.parse(init?.body as string));
        return jsonResponse({
          credentials: [
            {
              credentialId: '0x' + '44'.repeat(32),
              type: 'remote',
              sessionId: 'sess_01',
              metadata: {
                appUrl: 'https://app.example',
                appName: 'Example App',
                appLogoUrl: 'https://app.example/logo.png',
                custom: { environment: 'test' }
              },
              grants: {
                entries: [
                  {
                    kind: 'nativeTransfer',
                    nativeTransfer: {
                      to: '0x1111111111111111111111111111111111111111',
                      limit: '1000000000000000000'
                    }
                  },
                  {
                    kind: 'erc20Transfer',
                    erc20Transfer: {
                      token: '0x2222222222222222222222222222222222222222',
                      to: null,
                      limit: '42',
                      cumulative: true
                    }
                  }
                ]
              },
              expiresAt: '2099-01-01T00:00:00Z',
              isCaller: false
            }
          ],
          page: {}
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();

    await expect(wallet.listAccess({ type: 'remote' })).resolves.toEqual([
      {
        type: 'remote',
        credentialId: '0x' + '44'.repeat(32),
        sessionId: 'sess_01',
        metadata: {
          appUrl: 'https://app.example',
          appName: 'Example App',
          appLogoUrl: 'https://app.example/logo.png',
          custom: { environment: 'test' }
        },
        grants: [
          {
            kind: 'nativeTransfer',
            to: '0x1111111111111111111111111111111111111111',
            limit: 1000000000000000000n
          },
          {
            kind: 'erc20Transfer',
            token: '0x2222222222222222222222222222222222222222',
            limit: 42n,
            cumulative: true
          }
        ],
        expiresAt: '2099-01-01T00:00:00Z',
        isCaller: false
      }
    ]);
    expect(requests).toEqual([{ walletId: 'wallet-id', type: 'remote' }]);
  });

  it('inspects and authorizes a remote credential for the active wallet', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);
      requests.push({ url, body });
      if (url.endsWith('/InspectCredential')) {
        return jsonResponse({
          metadata: {
            appUrl: 'https://app.example',
            appName: 'Example App',
            appLogoUrl: 'https://app.example/logo.png',
            custom: { environment: 'test' }
          }
        });
      }
      if (url.endsWith('/AuthorizeRemoteAccess')) {
        return jsonResponse({ sessionId: 'sess_01', expiry: '2099-01-01T00:00:00Z' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();

    await expect(
      wallet.inspectRemoteCredential({ credentialId: 'credential-id' })
    ).resolves.toEqual({
      appUrl: 'https://app.example',
      appName: 'Example App',
      appLogoUrl: 'https://app.example/logo.png',
      custom: { environment: 'test' }
    });
    await expect(
      wallet.authorizeRemoteAccess({
        credentialId: 'credential-id',
        network: Networks.polygon,
        grants: [
          {
            kind: 'erc20Transfer',
            token: '0x2222222222222222222222222222222222222222',
            limit: 42n,
            cumulative: true
          }
        ],
        expiresAt: '2099-01-01T00:00:00Z'
      })
    ).resolves.toEqual({
      walletId: 'wallet-id',
      sessionId: 'sess_01',
      expiresAt: '2099-01-01T00:00:00Z'
    });
    expect(requests).toEqual([
      {
        url: 'https://wallet.example/v1/WaasPublic/InspectCredential',
        body: { scope: 'project-id', credentialId: 'credential-id' }
      },
      {
        url: 'https://wallet.example/v1/Waas/AuthorizeRemoteAccess',
        body: {
          credentialId: 'credential-id',
          walletId: 'wallet-id',
          grants: {
            entries: [
              {
                kind: 'erc20Transfer',
                erc20Transfer: {
                  token: '0x2222222222222222222222222222222222222222',
                  limit: '42',
                  cumulative: true
                }
              }
            ]
          },
          expiry: '2099-01-01T00:00:00Z',
          chainId: '137'
        }
      }
    ]);
  });

  it('creates, activates, and signs a message with a Solana wallet', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/CreateWallet')) {
        expect(JSON.parse(init?.body as string)).toEqual({ networkFamily: 'solana' });
        return jsonResponse({
          wallet: {
            id: 'solana-wallet-id',
            networkFamily: 'solana',
            keyOrigin: 'enclave',
            address: '9xQeWvG816bUx9EPjHmaT23yvVMuZwHngkQF5JC9YjCy'
          }
        });
      }
      if (url.endsWith('/SignMessage')) {
        expect(JSON.parse(init?.body as string)).toEqual({
          network: '',
          walletId: 'solana-wallet-id',
          message: 'hello solana'
        });
        return jsonResponse({ signature: 'solana-signature' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();

    await expect(wallet.createWallet({ type: WalletType.Solana })).resolves.toEqual({
      walletAddress: '9xQeWvG816bUx9EPjHmaT23yvVMuZwHngkQF5JC9YjCy',
      wallet: {
        id: 'solana-wallet-id',
        type: 'solana',
        address: '9xQeWvG816bUx9EPjHmaT23yvVMuZwHngkQF5JC9YjCy',
        keyOrigin: 'enclave'
      }
    });
    await expect(wallet.signSolanaMessage({ message: 'hello solana' })).resolves.toBe(
      'solana-signature'
    );
    await expect(
      wallet.signMessage({ network: Networks.polygon, message: 'hello ethereum' })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.signMessage'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads an active wallet remote session and its grant usage', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);
      if (url.endsWith('/GetSessionUsage')) {
        expect(body).toEqual({ sessionId: 'session-1', network: '80002' });
        return jsonResponse({
          entries: [
            {
              grant: {
                kind: 'nativeTransfer',
                nativeTransfer: {
                  to: '0x2222222222222222222222222222222222222222',
                  limit: '100'
                }
              },
              used: '25'
            }
          ]
        });
      }
      if (url.endsWith('/GetSession')) {
        expect(body).toEqual({ sessionId: 'session-1' });
        return jsonResponse({
          session: {
            sessionId: 'session-1',
            walletId: 'wallet-id',
            signerAddress: '0x1111111111111111111111111111111111111111',
            grants: { entries: [] },
            chainId: '80002',
            expiresAt: '2099-01-01T00:00:00Z'
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    await expect(wallet.getRemoteAccessSession({ sessionId: 'session-1' })).resolves.toMatchObject({
      sessionId: 'session-1',
      walletId: 'wallet-id',
      chainId: 80002
    });
    await expect(
      wallet.getRemoteAccessSessionUsage({ sessionId: 'session-1', network: Networks.amoy })
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

  it('rejects Solana message signing for an active Ethereum wallet', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    await expect(wallet.signSolanaMessage({ message: 'hello solana' })).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.signSolanaMessage'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a remote authorization result after the active wallet session changes', async () => {
    let resolveAuthorize!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/AuthorizeRemoteAccess')) {
        return new Promise<Response>((resolve) => {
          resolveAuthorize = resolve;
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    const authorization = wallet.authorizeRemoteAccess({
      credentialId: 'credential-id',
      network: Networks.polygon,
      grants: [
        {
          kind: 'nativeTransfer',
          to: '0x1111111111111111111111111111111111111111',
          limit: 1n
        }
      ],
      expiresAt: '2099-01-01T00:00:00Z'
    });

    await waitForRequest(fetchMock, '/AuthorizeRemoteAccess');
    await wallet.signOut();
    resolveAuthorize(jsonResponse({ sessionId: 'sess_01', expiry: '2099-01-01T00:00:00Z' }));

    await expect(authorization).rejects.toMatchObject({
      code: 'OMS_SESSION_MISSING',
      operation: 'wallet.authorizeRemoteAccess'
    });
  });

  it('revokes one remote session for a credential', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/RevokeAccess')) {
        expect(JSON.parse(init?.body as string)).toEqual({
          targetCredentialId: 'credential-id',
          walletId: 'wallet-id',
          sessionId: 'sess_01'
        });
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    await expect(
      wallet.revokeAccess({ credentialId: 'credential-id', sessionId: 'sess_01' })
    ).resolves.toBeUndefined();
  });

  it('rejects access page iteration when the active session changes mid-page', async () => {
    let resolveSecondPage!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/ListAccess')) {
        if (requestCount(fetchMock, '/ListAccess') === 1) {
          return jsonResponse({
            credentials: [testCredential('11')],
            page: { cursor: 'cursor-2' }
          });
        }

        return new Promise<Response>((resolve) => {
          resolveSecondPage = resolve;
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession();
    const iterator = wallet.listAccessPages({ pageSize: 25 })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { grants: [testCredential('11')] }
    });

    const secondPage = iterator.next();
    await waitForRequest(fetchMock, '/ListAccess', 2);
    await wallet.signOut();
    resolveSecondPage(
      jsonResponse({
        credentials: [testCredential('22')],
        page: {}
      })
    );

    await expect(secondPage).rejects.toMatchObject({
      code: 'OMS_SESSION_MISSING',
      operation: 'wallet.listAccessPages'
    });
  });
});

function createWalletWithSession(): WalletClient {
  const wallet = new WalletClient({
    publishableKey: 'publishable-key',
    projectId: 'project-id',
    environment: testEnvironment(),
    storage: new MemoryStorageManager(),
    credentialSigner: new MockSigner()
  });
  (wallet as any).persistSession('wallet-id', '0x1111111111111111111111111111111111111111', {
    expiresAt: '2099-01-01T00:00:00Z',
    auth: { type: 'email', email: 'user@example.com' },
    signerCredentialId: '0x04' + '11'.repeat(64),
    signerKeyType: 'ecdsa-p256-sha256'
  });
  return wallet;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function testCredential(seed = '11', isCaller = true) {
  return {
    type: 'direct',
    credentialId: '0x' + seed.repeat(32),
    expiresAt: '2099-01-01T00:00:00Z',
    isCaller
  };
}

function testEnvironment() {
  return {
    walletApiUrl: 'https://wallet.example',
    indexerGatewayUrl: 'https://indexer.example',
    solanaIndexerGatewayUrl: 'https://solana-indexer.example'
  };
}

function requestCount(fetchMock: ReturnType<typeof vi.fn>, endpoint: string): number {
  return fetchMock.mock.calls.filter(([input]) => input.toString().endsWith(endpoint)).length;
}

async function waitForRequest(
  fetchMock: ReturnType<typeof vi.fn>,
  endpoint: string,
  count = 1
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (requestCount(fetchMock, endpoint) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${endpoint}`);
}
