import { Buffer } from 'node:buffer';
import {
  generateAuthorizationSignature,
  generateP256KeyPair,
  type WalletApiRequestSignatureInput
} from '@privy-io/node';

const allowedOrigins = new Set(['http://localhost:5173', 'https://0xpolygon.github.io']);
const createAndExportPath = '/v1/disposable-wallets/export';
const healthPath = '/health';
const maxRequestBodyBytes = 16_384;

interface CreateAndExportRequest {
  recipientPublicKey: string;
}

interface PrivyWallet {
  id: string;
  address: string;
}

interface PrivyEncryptedWallet {
  ciphertext: string;
  encapsulated_key: string;
}

interface Dependencies {
  fetch: typeof fetch;
  generateAuthorizationSignature: typeof generateAuthorizationSignature;
  generateP256KeyPair: typeof generateP256KeyPair;
}

const defaultDependencies: Dependencies = {
  fetch: (input, init) => fetch(input, init),
  generateAuthorizationSignature,
  generateP256KeyPair
};

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: Dependencies = defaultDependencies
): Promise<Response> {
  const url = new URL(request.url);
  const origin = allowedOrigin(request);

  if (request.method === 'OPTIONS') {
    return origin
      ? new Response(null, { status: 204, headers: corsHeaders(origin) })
      : jsonResponse({ error: 'Origin is not allowed.' }, 403);
  }

  if (url.pathname === healthPath && request.method === 'GET') {
    return jsonResponse({ ready: true }, 200, origin);
  }

  if (url.pathname !== createAndExportPath || request.method !== 'POST') {
    return jsonResponse({ error: 'Not found.' }, 404, origin);
  }

  if (!origin) {
    return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  }

  const clientAddress = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateLimit = await env.PRIVY_EXPORT_RATE_LIMITER.limit({
    key: `${origin}:${clientAddress}`
  });
  if (!rateLimit.success) {
    return jsonResponse(
      { error: 'Too many test-wallet requests. Try again shortly.' },
      429,
      origin
    );
  }

  try {
    const { recipientPublicKey } = parseCreateAndExportRequest(await readJsonBody(request));
    const authorizationKey = await dependencies.generateP256KeyPair();
    const wallet = await createPrivyWallet(env, authorizationKey.publicKey, dependencies.fetch);
    const encryptedWallet = await exportPrivyWallet(
      env,
      wallet.id,
      recipientPublicKey,
      authorizationKey.privateKey,
      dependencies
    );

    console.log(
      JSON.stringify({
        event: 'privy_test_wallet_exported',
        requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
        origin
      })
    );

    return jsonResponse(
      {
        walletId: wallet.id,
        address: wallet.address,
        ciphertext: encryptedWallet.ciphertext,
        encapsulatedKey: encryptedWallet.encapsulated_key
      },
      200,
      origin
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'privy_test_wallet_export_failed',
        requestId: request.headers.get('cf-ray') ?? crypto.randomUUID(),
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    );
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unable to export a test wallet.' },
      400,
      origin
    );
  }
}

const worker: ExportedHandler<Env> = {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};

export default worker;

async function createPrivyWallet(
  env: Env,
  authorizationPublicKey: string,
  privyFetch: typeof fetch
): Promise<PrivyWallet> {
  const response = await privyFetch('https://api.privy.io/v1/wallets', {
    method: 'POST',
    headers: privyHeaders(env),
    body: JSON.stringify({
      chain_type: 'ethereum',
      display_name: 'OMS wallet import demo',
      owner: { public_key: authorizationPublicKey }
    })
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Privy wallet creation failed with status ${response.status}.`);
  }
  if (!isRecord(body)) throw new Error('Privy returned an invalid wallet.');

  return {
    id: requiredString(body, 'id'),
    address: requiredString(body, 'address')
  };
}

async function exportPrivyWallet(
  env: Env,
  walletId: string,
  recipientPublicKey: string,
  authorizationPrivateKey: string,
  dependencies: Dependencies
): Promise<PrivyEncryptedWallet> {
  const url = `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/export`;
  const body = {
    encryption_type: 'HPKE',
    recipient_public_key: recipientPublicKey
  };
  const requestExpiry = String(Date.now() + 5 * 60 * 1_000);
  const signatureInput: WalletApiRequestSignatureInput = {
    version: 1,
    method: 'POST',
    url,
    body,
    headers: {
      'privy-app-id': env.PRIVY_APP_ID,
      'privy-request-expiry': requestExpiry
    }
  };
  const headers = privyHeaders(env);
  headers['privy-authorization-signature'] = dependencies.generateAuthorizationSignature({
    authorizationPrivateKey,
    input: signatureInput
  });
  headers['privy-request-expiry'] = requestExpiry;

  const response = await dependencies.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const responseBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Privy wallet export failed with status ${response.status}.`);
  }
  if (!isRecord(responseBody)) throw new Error('Privy returned an invalid encrypted wallet.');

  return {
    ciphertext: requiredString(responseBody, 'ciphertext'),
    encapsulated_key: requiredString(responseBody, 'encapsulated_key')
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Request body must be valid JSON.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxRequestBodyBytes) {
      await reader.cancel();
      throw new Error('Request body is too large.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function parseCreateAndExportRequest(value: unknown): CreateAndExportRequest {
  if (!isRecord(value)) throw new Error('Request body must be an object.');
  const recipientPublicKey = requiredString(value, 'recipientPublicKey');
  if (recipientPublicKey.length > 512) throw new Error('Recipient public key is too long.');
  return { recipientPublicKey };
}

function allowedOrigin(request: Request): string | undefined {
  const origin = request.headers.get('Origin');
  return origin && allowedOrigins.has(origin) ? origin : undefined;
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Max-Age': '300',
    Vary: 'Origin'
  });
}

function jsonResponse(value: unknown, status: number, origin?: string): Response {
  const headers = origin ? corsHeaders(origin) : new Headers();
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json');
  return Response.json(value, { status, headers });
}

function privyHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/json',
    'privy-app-id': env.PRIVY_APP_ID
  };
}

function requiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`Privy response is missing ${field}.`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
