import {Fetch} from "./generated/waas.gen.js";
import {RequestUtils} from "./utils/requestUtils.js";
import type {CredentialSigner} from "./credentialSigner.js";

async function buildWalletSignatureHeader(
    endpoint: string,
    signer: CredentialSigner,
    payload: string,
    projectId: string,
): Promise<string> {
    const credentialId = await signer.credentialId()
    const nonce = await signer.nextNonce()
    const preimage = RequestUtils.buildWalletRequestPreimage(endpoint, nonce, projectId, payload)
    const signature = await signer.sign(preimage)
    return RequestUtils.buildWalletSignatureHeader(signer.signingAlgorithm, projectId, credentialId, nonce, signature)
}

export function createSignedFetch(
    publicApiKey: string,
    signer: CredentialSigner,
    projectId: string,
): Fetch {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input as Request).url
        const segments = new URL(url).pathname.split('/')
        const endpoint = '/' + segments[segments.length - 1]

        const body = typeof init?.body === 'string' ? init.body : ''

        const signatureHeader = await buildWalletSignatureHeader(endpoint, signer, body, projectId)

        const existingHeaders = (init?.headers ?? {}) as Record<string, string>
        const headers: Record<string, string> = {
            ...existingHeaders,
            'X-Access-Key': publicApiKey,
            'OMS-Wallet-Signature': signatureHeader,
        }

        return globalThis.fetch(input, { ...init, headers })
    }
}
