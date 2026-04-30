import type {OidcProviderConfig} from "./omsEnvironment.js";

export interface GoogleOidcProviderParams {
    clientId: string;
    relayRedirectUri?: string;
    scopes?: string[];
    authorizeParams?: Record<string, string>;
}

export function googleOidcProvider(params: GoogleOidcProviderParams): OidcProviderConfig {
    return {
        clientId: params.clientId,
        issuer: 'https://accounts.google.com',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: params.scopes ?? ['openid', 'email', 'profile'],
        relayRedirectUri: params.relayRedirectUri,
        authorizeParams: {
            access_type: 'offline',
            prompt: 'consent',
            ...params.authorizeParams,
        },
    };
}
