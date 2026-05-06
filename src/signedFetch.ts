import {Fetch} from "./generated/waas.gen.js";
import {Constants} from "./utils/constants.js";
import {RequestUtils} from "./utils/requestUtils.js";
import type {CredentialSigner} from "./credentialSigner.js";

async function buildAuthHeader(
    endpoint: string,
    signer: CredentialSigner,
    payload: string,
    waasAuthScope: string,
): Promise<string> {
    const credentialId = await signer.credentialId()
    const nonce = await signer.nextNonce()
    const preimage = RequestUtils.buildWalletRequestPreimage(endpoint, nonce, waasAuthScope, payload)
    const signature = await signer.sign(preimage)
    return RequestUtils.buildAuthorizationHeader(signer.keyType, waasAuthScope, credentialId, nonce, signature)
}

export function createSignedFetch(
    projectAccessKey: string,
    signer: CredentialSigner,
    waasAuthScope: string = Constants.defaultWaasAuthScope,
): Fetch {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input as Request).url
        const segments = new URL(url).pathname.split('/')
        const endpoint = '/' + segments[segments.length - 1]

        const body = typeof init?.body === 'string' ? init.body : ''

        const authHeader = await buildAuthHeader(endpoint, signer, body, waasAuthScope)

        const existingHeaders = (init?.headers ?? {}) as Record<string, string>
        const headers: Record<string, string> = {
            ...existingHeaders,
            'X-Access-Key': projectAccessKey,
            'Authorization': authHeader,
        }

        return globalThis.fetch(input, { ...init, headers })
    }
}
