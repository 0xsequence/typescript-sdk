import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletClient } from '../src/clients/walletClient';
import type { CredentialSigner } from '../src/credentialSigner';
import { toOMSWalletError } from '../src/errors';
import { AddressAlreadyImportedError } from '../src/generated/waas.gen';
import { MemoryStorageManager } from '../src/storageManager';

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

describe('WalletClient errors', () => {
  it('wraps local validation failures separately from request failures', async () => {
    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: testEnvironment(),
      storage: new MemoryStorageManager(),
      redirectAuthStorage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });

    await expect(
      wallet.completeOidcRedirectAuth({
        callbackUrl: 'https://app.example/callback'
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.completeOidcRedirectAuth',
      message: 'OIDC callback URL is missing code or state'
    });
  });

  it('classifies non-JSON wallet HTTP failures as retryable HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
    );

    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: testEnvironment(),
      storage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });

    await expect(wallet.startEmailAuth({ email: 'user@example.com' })).rejects.toMatchObject({
      code: 'OMS_HTTP_ERROR',
      operation: 'wallet.startEmailAuth',
      status: 502,
      retryable: true
    });
  });

  it('maps consumed auth commitments to a specific SDK error code', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/CompleteAuth')) {
        return jsonResponse(
          {
            code: 7008,
            name: 'CommitmentConsumed',
            message: 'The authentication commitment has already been used',
            status: 400
          },
          400
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: testEnvironment(),
      storage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });
    seedEmailAuthAttempt(wallet);

    await expect(wallet.completeEmailAuth({ code: '123456' })).rejects.toMatchObject({
      code: 'OMS_AUTH_COMMITMENT_CONSUMED',
      operation: 'wallet.completeEmailAuth',
      status: 400,
      retryable: false
    });
    await expect(wallet.completeEmailAuth({ code: '123456' })).rejects.toMatchObject({
      code: 'OMS_SESSION_MISSING',
      operation: 'wallet.completeEmailAuth',
      message: 'No pending email auth attempt'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('validates requested session lifetimes before auth requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: testEnvironment(),
      storage: new MemoryStorageManager(),
      redirectAuthStorage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });

    await expect(
      wallet.startEmailAuth({
        email: 'user@example.com',
        sessionLifetimeSeconds: 0
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.startEmailAuth'
    });
    await expect(
      wallet.startOidcRedirectAuth({
        provider: {
          clientId: 'google-client',
          issuer: 'https://accounts.google.com',
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          providerRedirectUri: 'https://app.example/callback'
        },
        sessionLifetimeSeconds: 1.5
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.startOidcRedirectAuth'
    });
    await expect(
      wallet.signInWithOidcIdToken({
        idToken: 'invalid-token',
        issuer: 'https://accounts.google.com',
        audience: 'google-client',
        sessionLifetimeSeconds: 2_592_001
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.signInWithOidcIdToken',
      message:
        'wallet.signInWithOidcIdToken requires sessionLifetimeSeconds to be an integer between 1 and 2592000'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps wallet-import failures to stable public error codes', () => {
    const duplicate = AddressAlreadyImportedError.new({
      code: 7313,
      name: 'AddressAlreadyImported',
      message: 'address already imported',
      status: 400
    });
    expect(toOMSWalletError(duplicate, 'wallet.importWallet')).toMatchObject({
      code: 'OMS_WALLET_ADDRESS_ALREADY_IMPORTED',
      operation: 'wallet.importWallet',
      status: 409,
      retryable: false
    });

    const attestationError = new Error('untrusted attestation');
    attestationError.name = 'OMSWalletAttestationVerificationError';
    expect(toOMSWalletError(attestationError, 'wallet.getWalletImportRecipientKey')).toMatchObject({
      code: 'OMS_ATTESTATION_VERIFICATION_FAILED',
      operation: 'wallet.getWalletImportRecipientKey',
      retryable: false
    });
  });
});

function seedEmailAuthAttempt(wallet: WalletClient): void {
  (wallet as any).activeEmailAuthAttempt = {
    verifier: 'verifier-1',
    challenge: 'challenge-1',
    sessionLifetimeSeconds: 604_800
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function testEnvironment() {
  return {
    walletApiUrl: 'https://wallet.example',
    indexerGatewayUrl: 'https://indexer.example',
    solanaIndexerGatewayUrl: 'https://solana-indexer.example'
  };
}
