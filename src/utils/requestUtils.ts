export class RequestUtils {
    static buildWalletRequestPreimage(
        endpoint: string,
        nonce: string,
        payload: string,
    ): string {
        return `POST /rpc/Wallet${endpoint}\nnonce: ${nonce}\n\n${payload}`;
    }

    static buildAuthorizationHeader(
        scope: string,
        cred: string,
        nonce: string,
        sig: string,
    ): string {
        return `ethereum-secp256k1 scope="${scope}",cred="${cred}",nonce=${nonce},sig="${sig}"`;
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