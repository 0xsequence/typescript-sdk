import type {CredentialKeyType} from "../credentialSigner.js";

export class RequestUtils {
    static buildWalletRequestPreimage(
        endpoint: string,
        nonce: string,
        scope: string,
        payload: string,
    ): string {
        return `POST /rpc/Wallet${endpoint}\nnonce: ${nonce}\nscope: ${scope}\n\n${payload}`;
    }

    static buildAuthorizationHeader(
        keyType: CredentialKeyType,
        scope: string,
        cred: string,
        nonce: string,
        sig: string,
    ): string {
        return `${keyType} scope="${scope}",cred="${cred}",nonce=${nonce},sig="${sig}"`;
    }

    static async hashEmailAuthAnswer(challenge: string, code: string): Promise<string> {
        const encoded = new TextEncoder().encode(challenge + code)
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
        const bytes = new Uint8Array(hashBuffer)
        return btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')
    }
}
