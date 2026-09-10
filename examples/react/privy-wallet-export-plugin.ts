import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  generateP256KeyPair,
  generateAuthorizationSignature,
  type WalletApiRequestSignatureInput
} from '@privy-io/node';
import type { Plugin } from 'vite';

const PRIVY_EXPORT_PATH = '/api/privy-wallet-export';
const PRIVY_CREATE_PATH = '/api/privy-wallets';
const PRIVY_STATUS_PATH = '/api/privy-wallet-export/status';
const MAX_REQUEST_BODY_BYTES = 16_384;

interface PrivyWalletExportPluginOptions {
  appId?: string;
  appSecret?: string;
  authorizationPrivateKey?: string;
}

interface PrivyWalletExportRequest {
  walletId: string;
  recipientPublicKey: string;
}

interface PrivyWalletExportResponse {
  ciphertext: string;
  encapsulated_key: string;
}

interface PrivyWalletCreateResponse {
  id: string;
  address: string;
}

export function privyWalletExportPlugin(options: PrivyWalletExportPluginOptions): Plugin {
  const appId = options.appId?.trim();
  const appSecret = options.appSecret?.trim();
  const authorizationPrivateKey = options.authorizationPrivateKey?.trim();
  const configured = Boolean(appId && appSecret);
  const disposableWalletKeys = new Map<string, string>();

  return {
    name: 'oms-privy-wallet-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

        if (pathname === PRIVY_STATUS_PATH) {
          if (request.method !== 'GET') {
            writeJson(response, 405, { error: 'Method not allowed.' });
            return;
          }

          writeJson(response, 200, { configured });
          return;
        }

        if (pathname === PRIVY_CREATE_PATH) {
          if (request.method !== 'POST') {
            writeJson(response, 405, { error: 'Method not allowed.' });
            return;
          }

          if (!isLocalBrowserRequest(request)) {
            writeJson(response, 403, { error: 'Privy wallet creation is limited to localhost.' });
            return;
          }

          if (!appId || !appSecret) {
            writeJson(response, 503, {
              error: 'Set PRIVY_APP_ID and PRIVY_APP_SECRET in examples/react/.env.local.'
            });
            return;
          }

          try {
            const keyPair = await generateP256KeyPair();
            const privyResponse = await fetch('https://api.privy.io/v1/wallets', {
              method: 'POST',
              headers: privyHeaders(appId, appSecret),
              body: JSON.stringify({
                chain_type: 'ethereum',
                display_name: 'OMS wallet import demo',
                owner: { public_key: keyPair.publicKey }
              })
            });
            const responseBody: unknown = await privyResponse.json().catch(() => null);

            if (!privyResponse.ok) {
              writeJson(response, privyResponse.status, {
                error: describePrivyError(responseBody, privyResponse.status, false)
              });
              return;
            }

            const wallet = parsePrivyWalletCreateResponse(responseBody);
            disposableWalletKeys.set(wallet.id, keyPair.privateKey);
            writeJson(response, 200, { walletId: wallet.id, address: wallet.address });
          } catch (error) {
            writeJson(response, 400, {
              error: error instanceof Error ? error.message : 'Unable to create a Privy wallet.'
            });
          }
          return;
        }

        if (pathname !== PRIVY_EXPORT_PATH) {
          next();
          return;
        }

        if (request.method !== 'POST') {
          writeJson(response, 405, { error: 'Method not allowed.' });
          return;
        }

        if (!isLocalBrowserRequest(request)) {
          writeJson(response, 403, { error: 'Privy wallet export is limited to localhost.' });
          return;
        }

        if (!appId || !appSecret) {
          writeJson(response, 503, {
            error: 'Set PRIVY_APP_ID and PRIVY_APP_SECRET in examples/react/.env.local.'
          });
          return;
        }

        try {
          const body = await readJsonBody(request);
          const { walletId, recipientPublicKey } = parseWalletExportRequest(body);
          const privyUrl = `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/export`;
          const privyBody = {
            encryption_type: 'HPKE',
            recipient_public_key: recipientPublicKey
          };
          const headers = privyHeaders(appId, appSecret);
          const walletAuthorizationPrivateKey =
            disposableWalletKeys.get(walletId) ?? authorizationPrivateKey;

          if (walletAuthorizationPrivateKey) {
            const requestExpiry = String(Date.now() + 5 * 60 * 1_000);
            const signatureInput: WalletApiRequestSignatureInput = {
              version: 1,
              method: 'POST',
              url: privyUrl,
              body: privyBody,
              headers: {
                'privy-app-id': appId,
                'privy-request-expiry': requestExpiry
              }
            };
            headers['privy-authorization-signature'] = generateAuthorizationSignature({
              authorizationPrivateKey: walletAuthorizationPrivateKey,
              input: signatureInput
            });
            headers['privy-request-expiry'] = requestExpiry;
          }

          const privyResponse = await fetch(privyUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(privyBody)
          });
          const responseBody: unknown = await privyResponse.json().catch(() => null);

          if (!privyResponse.ok) {
            writeJson(response, privyResponse.status, {
              error: describePrivyError(
                responseBody,
                privyResponse.status,
                Boolean(walletAuthorizationPrivateKey)
              )
            });
            return;
          }

          const encryptedWallet = parsePrivyWalletExportResponse(responseBody);
          writeJson(response, 200, {
            ciphertext: encryptedWallet.ciphertext,
            encapsulatedKey: encryptedWallet.encapsulated_key
          });
        } catch (error) {
          writeJson(response, 400, {
            error: error instanceof Error ? error.message : 'Unable to export the Privy wallet.'
          });
        }
      });
    }
  };
}

function isLocalBrowserRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).hostname === 'localhost';
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function parseWalletExportRequest(value: unknown): PrivyWalletExportRequest {
  if (!isRecord(value)) throw new Error('Request body must be an object.');

  const walletId = readRequiredString(value, 'walletId');
  const recipientPublicKey = readRequiredString(value, 'recipientPublicKey');
  return { walletId, recipientPublicKey };
}

function parsePrivyWalletExportResponse(value: unknown): PrivyWalletExportResponse {
  if (!isRecord(value)) throw new Error('Privy returned an invalid wallet export response.');

  return {
    ciphertext: readRequiredString(value, 'ciphertext'),
    encapsulated_key: readRequiredString(value, 'encapsulated_key')
  };
}

function parsePrivyWalletCreateResponse(value: unknown): PrivyWalletCreateResponse {
  if (!isRecord(value)) throw new Error('Privy returned an invalid wallet creation response.');

  return {
    id: readRequiredString(value, 'id'),
    address: readRequiredString(value, 'address')
  };
}

function privyHeaders(appId: string, appSecret: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
    'Content-Type': 'application/json',
    'privy-app-id': appId
  };
}

function describePrivyError(
  value: unknown,
  status: number,
  hasAuthorizationPrivateKey: boolean
): string {
  if (isRecord(value)) {
    const message = value.message ?? value.error;
    if (typeof message === 'string' && message.trim()) {
      if (!hasAuthorizationPrivateKey && message.includes('privy-authorization-signature')) {
        return `${message} Set PRIVY_AUTHORIZATION_PRIVATE_KEY for an owner-controlled wallet.`;
      }
      return message;
    }
  }

  return `Privy rejected the wallet export request with status ${status}.`;
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const result = value[field];
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return result.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
