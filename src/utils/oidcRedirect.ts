export interface OidcStatePayload {
    nonce: string;
    scope: string;
    redirect_uri?: string;
}

export interface OidcCallbackParams {
    code: string | null;
    state: string | null;
    error: string | null;
    errorDescription: string | null;
}

export interface BuildOidcAuthorizationUrlParams {
    authorizationUrl: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    challenge: string;
    authorizeParams?: Record<string, string>;
    loginHint?: string;
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlEncodeString(value: string): string {
    return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

export function base64UrlDecodeString(value: string): string {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

export function generateOidcNonce(): string {
    const bytes = new Uint8Array(32);
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('OIDC redirect auth requires crypto.getRandomValues');
    }
    globalThis.crypto.getRandomValues(bytes);
    return base64UrlEncodeBytes(bytes);
}

export function encodeOidcState(payload: OidcStatePayload): string {
    return base64UrlEncodeString(JSON.stringify(payload));
}

export function decodeOidcState(state: string): OidcStatePayload {
    const decoded = JSON.parse(base64UrlDecodeString(state)) as Partial<OidcStatePayload>;
    if (typeof decoded.nonce !== 'string' || typeof decoded.scope !== 'string') {
        throw new Error('OIDC state payload is invalid');
    }
    if (decoded.redirect_uri !== undefined && typeof decoded.redirect_uri !== 'string') {
        throw new Error('OIDC state redirect_uri is invalid');
    }
    return {
        nonce: decoded.nonce,
        scope: decoded.scope,
        redirect_uri: decoded.redirect_uri,
    };
}

export function buildOidcAuthorizationUrl(params: BuildOidcAuthorizationUrlParams): string {
    const url = new URL(params.authorizationUrl);
    const mergedAuthorizeParams = params.authorizeParams ?? {};
    for (const [key, value] of Object.entries(mergedAuthorizeParams)) {
        url.searchParams.set(key, value);
    }
    if (params.loginHint) {
        url.searchParams.set('login_hint', params.loginHint);
    }

    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return url.toString();
}

export function parseOidcCallbackUrl(callbackUrl: string): OidcCallbackParams {
    const url = new URL(callbackUrl);
    return {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error'),
        errorDescription: url.searchParams.get('error_description'),
    };
}

export function cleanOidcCallbackUrl(callbackUrl: string): string {
    const url = new URL(callbackUrl);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('scope');
    url.searchParams.delete('authuser');
    url.searchParams.delete('prompt');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    return url.toString();
}

export function redirectUriFromCurrentUrl(currentUrl: string): string {
    const url = new URL(currentUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
}
