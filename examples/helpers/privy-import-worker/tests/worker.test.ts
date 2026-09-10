import { describe, expect, it, vi } from 'vitest';

import { handleRequest } from '../worker/index';

const localOrigin = 'http://localhost:5173';

describe('Privy import Worker', () => {
  it.each([localOrigin, 'https://0xpolygon.github.io'])(
    'answers CORS preflights for %s',
    async (origin) => {
      const response = await handleRequest(
        new Request('https://worker.example/v1/disposable-wallets/export', {
          method: 'OPTIONS',
          headers: { Origin: origin }
        }),
        testEnv()
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    }
  );

  it('rejects mutation requests from other origins', async () => {
    const response = await handleRequest(
      createRequest({ origin: 'https://attacker.example' }),
      testEnv()
    );

    expect(response.status).toBe(403);
  });

  it('rate limits disposable-wallet creation per client', async () => {
    const response = await handleRequest(createRequest(), testEnv(false));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many test-wallet requests. Try again shortly.'
    });
  });

  it('creates and immediately exports a disposable wallet', async () => {
    const privyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: 'privy-wallet-id',
          address: '0x1111111111111111111111111111111111111111'
        })
      )
      .mockResolvedValueOnce(
        Response.json({ ciphertext: 'ciphertext', encapsulated_key: 'encapsulated-key' })
      );
    const generateSignature = vi.fn(() => 'authorization-signature');

    const response = await handleRequest(createRequest(), testEnv(), {
      fetch: privyFetch,
      generateP256KeyPair: vi.fn(async () => ({
        publicKey: 'authorization-public-key',
        privateKey: 'authorization-private-key'
      })),
      generateAuthorizationSignature: generateSignature
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(localOrigin);
    await expect(response.json()).resolves.toEqual({
      walletId: 'privy-wallet-id',
      address: '0x1111111111111111111111111111111111111111',
      ciphertext: 'ciphertext',
      encapsulatedKey: 'encapsulated-key'
    });
    expect(privyFetch).toHaveBeenCalledTimes(2);
    expect(privyFetch.mock.calls[0]?.[0]).toBe('https://api.privy.io/v1/wallets');
    expect(privyFetch.mock.calls[1]?.[0]).toBe(
      'https://api.privy.io/v1/wallets/privy-wallet-id/export'
    );
    expect(generateSignature).toHaveBeenCalledOnce();
  });
});

function createRequest(options: { origin?: string } = {}): Request {
  return new Request('https://worker.example/v1/disposable-wallets/export', {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': '203.0.113.10',
      'Content-Type': 'application/json',
      Origin: options.origin ?? localOrigin
    },
    body: JSON.stringify({ recipientPublicKey: 'recipient-public-key' })
  });
}

function testEnv(rateLimitSuccess = true): Env {
  return {
    PRIVY_APP_ID: 'privy-app-id',
    PRIVY_APP_SECRET: 'privy-app-secret',
    PRIVY_EXPORT_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: rateLimitSuccess }))
    }
  };
}
