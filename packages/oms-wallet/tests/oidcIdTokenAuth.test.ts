import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletClient } from '../src/clients/walletClient';
import type { CredentialSigner } from '../src/credentialSigner';
import { AuthMode, WalletType } from '../src/types/waas';
import { MemoryStorageManager } from '../src/storageManager';
import { oidcIdTokenHandleHash } from '../src/utils/oidcIdToken';
import { base64UrlEncodeString } from '../src/utils/oidcRedirect';
import { Constants } from '../src/utils/constants';

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
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WalletClient OIDC ID-token auth', () => {
  it('signs in with an app-provided OIDC ID token and stores session auth metadata', async () => {
    const idToken = fakeJwt({ exp: 1_910_000_100 });
    const expectedHandle = await oidcIdTokenHandleHash(idToken);
    const storage = new MemoryStorageManager();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/CommitVerifier')) {
        expect(body).toEqual({
          identityType: 'oidc',
          authMode: AuthMode.IDToken,
          metadata: {
            iss: 'https://accounts.google.com',
            aud: 'google-client-id',
            exp: '1910000100'
          },
          handle: expectedHandle
        });
        return jsonResponse({
          verifier: 'oidc-verifier-1',
          challenge: 'challenge-1'
        });
      }

      if (url.endsWith('/CompleteAuth')) {
        expect(body).toEqual({
          identityType: 'oidc',
          authMode: AuthMode.IDToken,
          verifier: 'oidc-verifier-1',
          answer: idToken,
          lifetime: 604_800
        });
        return jsonResponse({
          identity: { type: 'oidc', iss: 'https://accounts.google.com', sub: 'google-sub-1' },
          wallets: [
            {
              id: 'wallet-id',
              networkFamily: 'evm',
              keyOrigin: 'enclave',
              address: '0x1111111111111111111111111111111111111111'
            }
          ],
          credential: testCredential(),
          email: 'user@example.com'
        });
      }

      if (url.endsWith('/UseWallet')) {
        expect(body).toEqual({ walletId: 'wallet-id' });
        return jsonResponse({
          wallet: {
            id: 'wallet-id',
            networkFamily: 'evm',
            keyOrigin: 'enclave',
            address: '0x1111111111111111111111111111111111111111'
          }
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletClient({ storage });

    const result = await wallet.signInWithOidcIdToken({
      idToken,
      issuer: 'https://accounts.google.com',
      audience: 'google-client-id'
    });

    expect(result).toMatchObject({
      walletAddress: '0x1111111111111111111111111111111111111111',
      credential: testCredential()
    });
    expect(wallet.session.auth).toEqual({
      type: 'oidc',
      flow: 'id-token',
      issuer: 'https://accounts.google.com',
      provider: 'google',
      providerLabel: 'Google',
      email: 'user@example.com'
    });
    expect(JSON.parse(storage.get(Constants.sessionStorageKey) ?? 'null').auth).toEqual(
      wallet.session.auth
    );
    expect(requestCount(fetchMock, '/CommitVerifier')).toBe(1);
    expect(requestCount(fetchMock, '/CompleteAuth')).toBe(1);
    expect(requestCount(fetchMock, '/UseWallet')).toBe(1);
  });

  it('returns manual wallet selection and preserves custom provider metadata', async () => {
    const idToken = fakeJwt({ exp: '1910000100' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/CommitVerifier')) {
        expect(body.metadata.exp).toBe('1910000100');
        return jsonResponse({
          verifier: 'oidc-verifier-1',
          challenge: 'challenge-1'
        });
      }

      if (url.endsWith('/CompleteAuth')) {
        return jsonResponse({
          identity: { type: 'oidc', iss: 'https://idp.example', sub: 'oidc-sub-1' },
          wallets: [
            {
              id: 'wallet-id',
              networkFamily: 'evm',
              keyOrigin: 'enclave',
              address: '0x2222222222222222222222222222222222222222'
            }
          ],
          credential: testCredential(),
          email: 'custom@example.com'
        });
      }

      if (url.endsWith('/UseWallet')) {
        expect(body).toEqual({ walletId: 'wallet-id' });
        return jsonResponse({
          wallet: {
            id: 'wallet-id',
            networkFamily: 'evm',
            keyOrigin: 'enclave',
            address: '0x2222222222222222222222222222222222222222'
          }
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletClient();
    const selection = await wallet.signInWithOidcIdToken({
      idToken,
      issuer: 'https://idp.example',
      audience: 'custom-client-id',
      provider: 'enterprise',
      providerLabel: 'Enterprise SSO',
      walletSelection: 'manual'
    });

    expect(selection.wallets).toEqual([
      {
        id: 'wallet-id',
        type: WalletType.Ethereum,
        address: '0x2222222222222222222222222222222222222222',
        reference: undefined,
        keyOrigin: 'enclave'
      }
    ]);
    expect(wallet.session.auth).toBeUndefined();

    await selection.selectWallet({ walletId: 'wallet-id' });

    expect(wallet.session.auth).toEqual({
      type: 'oidc',
      flow: 'id-token',
      issuer: 'https://idp.example',
      provider: 'enterprise',
      providerLabel: 'Enterprise SSO',
      email: 'custom@example.com'
    });
  });

  it('rejects invalid ID tokens before sending auth requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wallet = createWalletClient();

    await expect(
      wallet.signInWithOidcIdToken({
        idToken: fakeJwt({ sub: 'missing-exp' }),
        issuer: 'https://accounts.google.com',
        audience: 'google-client-id'
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.signInWithOidcIdToken',
      message: 'OIDC ID token is missing an exp claim'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears pending OIDC redirect state when starting ID-token auth', async () => {
    const redirectAuthStorage = new MemoryStorageManager();
    redirectAuthStorage.set(
      Constants.redirectAuthStorageKey,
      JSON.stringify({ verifier: 'old-verifier' })
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/CommitVerifier')) {
        return jsonResponse({
          verifier: 'oidc-verifier-1',
          challenge: 'challenge-1'
        });
      }
      if (url.endsWith('/CompleteAuth')) {
        return jsonResponse({
          identity: { type: 'oidc', iss: 'https://accounts.google.com', sub: 'google-sub-1' },
          wallets: [
            {
              id: 'wallet-id',
              networkFamily: 'evm',
              keyOrigin: 'enclave',
              address: '0x1111111111111111111111111111111111111111'
            }
          ],
          credential: testCredential()
        });
      }
      if (url.endsWith('/UseWallet')) {
        return jsonResponse({
          wallet: {
            id: 'wallet-id',
            networkFamily: 'evm',
            keyOrigin: 'enclave',
            address: '0x1111111111111111111111111111111111111111'
          }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletClient({ redirectAuthStorage });

    await wallet.signInWithOidcIdToken({
      idToken: fakeJwt({ exp: 1_910_000_100 }),
      issuer: 'https://accounts.google.com',
      audience: 'google-client-id'
    });
    expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
  });

  it('does not persist an ID-token auth result that resolves after sign-out', async () => {
    const storage = new MemoryStorageManager();
    let resolveUseWallet!: (response: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/CommitVerifier')) {
        return jsonResponse({
          verifier: 'oidc-verifier-1',
          challenge: 'challenge-1'
        });
      }

      if (url.endsWith('/CompleteAuth')) {
        return jsonResponse({
          identity: { type: 'oidc', iss: 'https://accounts.google.com', sub: 'google-sub-1' },
          wallets: [
            {
              id: 'wallet-id',
              networkFamily: 'evm',
              keyOrigin: 'enclave',
              address: '0x1111111111111111111111111111111111111111'
            }
          ],
          credential: testCredential()
        });
      }

      if (url.endsWith('/UseWallet')) {
        return new Promise<Response>((resolve) => {
          resolveUseWallet = resolve;
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletClient({ storage });
    const signIn = wallet.signInWithOidcIdToken({
      idToken: fakeJwt({ exp: 1_910_000_100 }),
      issuer: 'https://accounts.google.com',
      audience: 'google-client-id'
    });
    await waitForRequest(fetchMock, '/UseWallet');
    await wallet.signOut();

    resolveUseWallet(
      jsonResponse({
        wallet: {
          id: 'wallet-id',
          networkFamily: 'evm',
          keyOrigin: 'enclave',
          address: '0x1111111111111111111111111111111111111111'
        }
      })
    );

    await expect(signIn).rejects.toMatchObject({
      code: 'OMS_SESSION_MISSING',
      operation: 'wallet.signInWithOidcIdToken',
      message: 'Wallet session changed while auth was in flight'
    });
    expect(wallet.walletAddress).toBeUndefined();
    expect(storage.get(Constants.sessionStorageKey)).toBeNull();
  });
});

function createWalletClient(
  params: {
    storage?: MemoryStorageManager;
    redirectAuthStorage?: MemoryStorageManager;
  } = {}
): WalletClient {
  return new WalletClient({
    publishableKey: 'publishable-key',
    projectId: 'project-id',
    environment: testEnvironment(),
    storage: params.storage ?? new MemoryStorageManager(),
    redirectAuthStorage: params.redirectAuthStorage,
    credentialSigner: new MockSigner()
  });
}

function testEnvironment() {
  return {
    walletApiUrl: 'https://wallet.example',
    indexerGatewayUrl: 'https://indexer.example',
    solanaIndexerGatewayUrl: 'https://solana-indexer.example'
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function requestCount(fetchMock: ReturnType<typeof vi.fn>, endpoint: string): number {
  return fetchMock.mock.calls.filter(([input]) => input.toString().endsWith(endpoint)).length;
}

async function waitForRequest(
  fetchMock: ReturnType<typeof vi.fn>,
  endpoint: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (requestCount(fetchMock, endpoint) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${endpoint}`);
}

function testCredential() {
  return {
    type: 'direct',
    credentialId: '0x' + '11'.repeat(32),
    expiresAt: '2099-01-01T00:00:00Z',
    isCaller: true
  };
}

function fakeJwt(payload: Record<string, unknown>): string {
  return [
    base64UrlEncodeString(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64UrlEncodeString(JSON.stringify(payload)),
    'signature'
  ].join('.');
}
