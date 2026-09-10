import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletClient } from '../src/clients/walletClient';
import type { CredentialSigner } from '../src/credentialSigner';
import type {
  GetRecipientKeyRequest,
  HPKEPayload,
  ImportWalletRequest
} from '../src/generated/waas.gen';
import { Ciphersuite, KeyFormat, NetworkFamily, Waas } from '../src/generated/waas.gen';
import { OMSWallet } from '../src/omsWallet';
import { MemoryStorageManager } from '../src/storageManager';
import { WalletImportCipherSuite } from '../src/types/waas';
import { base64DecodeBytes, base64EncodeBytes } from '../src/utils/base64';
import { sealWalletImportPrivateKey, walletImportPlaintext } from '../src/walletImport';

class MockSigner implements CredentialSigner {
  readonly signingAlgorithm = 'ecdsa-p256-sha256';

  async credentialId(): Promise<string> {
    return `0x04${'11'.repeat(64)}`;
  }

  async nextNonce(): Promise<string> {
    return '42';
  }

  async sign(): Promise<string> {
    return `0x${'22'.repeat(64)}`;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('wallet import', () => {
  it('seals an Ethereum private key with the supported browser HPKE suite', async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits'
    ])) as CryptoKeyPair;
    const publicKey = base64EncodeBytes(
      new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
    );
    const plaintext = walletImportPlaintext({
      type: 'ethereum',
      privateKey: `0x${'01'.repeat(32)}`
    });

    const sealed = await sealWalletImportPrivateKey(publicKey, plaintext);
    const suite = new CipherSuite({
      kem: new DhkemP256HkdfSha256(),
      kdf: new HkdfSha256(),
      aead: new Aes256Gcm()
    });
    const opened = await suite.open(
      {
        recipientKey: keyPair.privateKey,
        enc: base64DecodeBytes(sealed.encapsulatedKey)
      },
      base64DecodeBytes(sealed.ciphertext)
    );

    expect(new Uint8Array(opened)).toEqual(plaintext);
  });

  it('serializes HPKE bytes as base64 strings on the WaaS wire', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(init?.body as string)).toEqual({
        networkFamily: 'evm',
        format: 'private-key',
        keyMaterial: {
          keyId: 'key-1',
          suite: 'p256-sha256-aes256gcm',
          encapsulatedKey: 'AQID',
          ciphertext: 'BAUG'
        }
      });
      return jsonResponse({
        wallet: {
          id: 'wallet-1',
          networkFamily: 'evm',
          keyOrigin: 'imported',
          address: '0x1111111111111111111111111111111111111111'
        }
      });
    });
    const client = new Waas('https://wallet.example', fetchMock);

    await client.importWallet({
      networkFamily: NetworkFamily.EVM,
      format: KeyFormat.PrivateKey,
      keyMaterial: {
        keyId: 'key-1',
        suite: Ciphersuite.P256_SHA256_AES_256_GCM,
        encapsulatedKey: 'AQID',
        ciphertext: 'BAUG'
      } as unknown as HPKEPayload
    });
  });

  it('passes Privy HPKE export material through with the matching recipient-key suite', async () => {
    const wallet = createWalletWithSession();
    const getRecipientKey = vi.fn(async (request: GetRecipientKeyRequest) => {
      expect(request).toEqual({
        purpose: 'wallet-import',
        suite: 'p256-sha256-chacha20poly1305'
      });
      return { keyId: 'key-1', publicKey: 'AQID' };
    });
    const importWallet = vi.fn(async (request: ImportWalletRequest) => {
      expect(request).toEqual({
        networkFamily: 'evm',
        format: 'private-key',
        keyMaterial: {
          keyId: 'key-1',
          suite: 'p256-sha256-chacha20poly1305',
          encapsulatedKey: 'BAUG',
          ciphertext: 'BwgJ'
        },
        reference: 'Privy wallet'
      });
      return {
        wallet: {
          id: 'wallet-imported',
          networkFamily: 'evm',
          keyOrigin: 'imported',
          address: '0x2222222222222222222222222222222222222222'
        }
      };
    });
    (wallet as any).walletImportClient = { getRecipientKey, importWallet };

    const recipient = await wallet.getWalletImportRecipientKey({
      cipherSuite: WalletImportCipherSuite.P256Sha256ChaCha20Poly1305
    });
    const result = await wallet.importEncryptedWallet({
      type: 'ethereum',
      reference: 'Privy wallet',
      keyMaterial: {
        keyId: recipient.keyId,
        cipherSuite: recipient.cipherSuite,
        encapsulatedKey: 'BAUG',
        ciphertext: 'BwgJ'
      }
    });

    expect(recipient).toEqual({
      keyId: 'key-1',
      cipherSuite: WalletImportCipherSuite.P256Sha256ChaCha20Poly1305,
      publicKey: 'AQID'
    });
    expect(result.wallet).toMatchObject({ id: 'wallet-imported', keyOrigin: 'imported' });
    expect(getRecipientKey).toHaveBeenCalledOnce();
    expect(importWallet).toHaveBeenCalledOnce();
  });

  it('temporarily skips attestation only for Development sandbox imports', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('X-Attestation-Nonce')).toBe(false);
      return jsonResponse({ keyId: 'key-1', publicKey: 'AQID' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const oms = new OMSWallet({
      publishableKey: 'pk_dev_sdbx_project_key',
      storage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });
    (oms.wallet as any).persistSession('wallet-id', '0x1111111111111111111111111111111111111111', {
      expiresAt: '2099-01-01T00:00:00Z',
      auth: { type: 'email', email: 'user@example.com' },
      signerCredentialId: `0x04${'11'.repeat(64)}`,
      signerKeyType: 'ecdsa-p256-sha256'
    });

    await expect(
      oms.wallet.getWalletImportRecipientKey({
        cipherSuite: WalletImportCipherSuite.P256Sha256ChaCha20Poly1305
      })
    ).resolves.toMatchObject({ keyId: 'key-1', publicKey: 'AQID' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('activates an imported first wallet during manual wallet selection', async () => {
    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: {
        walletApiUrl: 'https://wallet.example',
        indexerGatewayUrl: 'https://indexer.example',
        solanaIndexerGatewayUrl: 'https://solana-indexer.example'
      },
      storage: new MemoryStorageManager(),
      credentialSigner: new MockSigner(),
      walletImportTrustedPcr0s: ['1'.repeat(96)]
    });
    (wallet as any).activePendingWalletSelection = {
      id: 'pending-1',
      signerCredentialId: `0x04${'11'.repeat(64)}`,
      signerKeyType: 'ecdsa-p256-sha256',
      walletType: 'ethereum',
      metadata: {
        expiresAt: '2099-01-01T00:00:00Z',
        auth: { type: 'email', email: 'user@example.com' },
        signerCredentialId: `0x04${'11'.repeat(64)}`,
        signerKeyType: 'ecdsa-p256-sha256'
      }
    };
    (wallet as any).requestImportWallet = vi.fn(async () => ({
      id: 'wallet-imported',
      type: 'ethereum',
      address: '0x1111111111111111111111111111111111111111',
      keyOrigin: 'imported'
    }));

    await expect(
      wallet.importEncryptedWallet({
        type: 'ethereum',
        keyMaterial: {
          keyId: 'key-1',
          cipherSuite: 'p256-sha256-aes256gcm',
          encapsulatedKey: 'AQID',
          ciphertext: 'BAUG'
        }
      })
    ).resolves.toMatchObject({
      walletAddress: '0x1111111111111111111111111111111111111111',
      wallet: { id: 'wallet-imported', keyOrigin: 'imported' }
    });
  });
});

function createWalletWithSession(): WalletClient {
  const wallet = new WalletClient({
    publishableKey: 'publishable-key',
    projectId: 'project-id',
    environment: {
      walletApiUrl: 'https://wallet.example',
      indexerGatewayUrl: 'https://indexer.example',
      solanaIndexerGatewayUrl: 'https://solana-indexer.example'
    },
    storage: new MemoryStorageManager(),
    credentialSigner: new MockSigner()
  });
  (wallet as any).persistSession('wallet-id', '0x1111111111111111111111111111111111111111', {
    expiresAt: '2099-01-01T00:00:00Z',
    auth: { type: 'email', email: 'user@example.com' },
    signerCredentialId: `0x04${'11'.repeat(64)}`,
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
