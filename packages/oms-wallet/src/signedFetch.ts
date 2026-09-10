import type { CredentialSigner } from './credentialSigner.js';

import { RequestUtils } from './utils/requestUtils.js';

type Fetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

async function buildWalletSignatureHeader(
  endpoint: string,
  signer: CredentialSigner,
  payload: string,
  projectId: string
): Promise<string> {
  const credentialId = await signer.credentialId();
  const nonce = await signer.nextNonce();
  const preimage = RequestUtils.buildWalletRequestPreimage(endpoint, nonce, projectId, payload);
  const signature = await signer.sign(preimage);
  return RequestUtils.buildWalletSignatureHeader(
    signer.signingAlgorithm,
    projectId,
    credentialId,
    nonce,
    signature
  );
}

export function createSignedFetch(
  publishableKey: string,
  signer: CredentialSigner,
  projectId: string
): Fetch {
  return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const segments = new URL(url).pathname.split('/');
    const endpoint = '/' + segments[segments.length - 1];

    const body = typeof init?.body === 'string' ? init.body : '';

    const signatureHeader = await buildWalletSignatureHeader(endpoint, signer, body, projectId);

    const headers: Record<string, string> = {};
    if (init?.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init?.headers)) {
      Object.assign(headers, Object.fromEntries(init.headers));
    } else if (init?.headers) {
      Object.assign(headers, init.headers);
    }
    headers['Api-Key'] = publishableKey;
    headers['OMS-Wallet-Signature'] = signatureHeader;

    return globalThis.fetch(input, { ...init, headers });
  };
}
