import {Fetch} from "./generated/waas.gen";
import {Constants} from "./utils/constants";
import { EvmHelper } from "./utils/EvmHelper";
import {RequestUtils} from "./utils/requestUtils";
import {TimeUtils} from "./utils/timeUtils";

async function buildAuthHeader(endpoint: string, signer: Uint8Array, payload: string): Promise<string> {
    const walletAddress = EvmHelper.getWalletAddress(signer)
    const nonce = TimeUtils.currentTimestampInSecondsString()
    const preimage = RequestUtils.buildWalletRequestPreimage(endpoint, nonce, payload)
    const hashedResult = EvmHelper.keccak256(preimage)
    const signature = await EvmHelper.signUTF8MessageEIP191(signer, hashedResult)
    return RequestUtils.buildAuthorizationHeader(Constants.scope, walletAddress, nonce, signature)
}

export function createSignedFetch(projectAccessKey: string, privateKey: Uint8Array): Fetch {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input as Request).url
        const segments = new URL(url).pathname.split('/')
        const endpoint = '/' + segments[segments.length - 1]

        const body = typeof init?.body === 'string' ? init.body : ''

        const authHeader = await buildAuthHeader(endpoint, privateKey, body)

        const existingHeaders = (init?.headers ?? {}) as Record<string, string>
        const headers: Record<string, string> = {
            ...existingHeaders,
            'X-Access-Key': projectAccessKey,
            'Authorization': authHeader,
            'Origin': 'http://localhost:3000',
        }

        const method = init?.method ?? 'POST'

        console.log('[OMS SDK] →', {
            url,
            method,
            payload: body,
            headers,
        })

        const response = await globalThis.fetch(input, { ...init, headers })

        const responseClone = response.clone()
        let responseBody: string
        try {
            responseBody = await responseClone.text()
        } catch (err) {
            responseBody = `<failed to read body: ${(err as Error).message}>`
        }

        console.log('[OMS SDK] ←', {
            url,
            status: response.status,
            body: responseBody,
        })

        return response
    }
}