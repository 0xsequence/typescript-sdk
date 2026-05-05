import type {OidcProviderConfig} from "./omsEnvironment.js";

export interface GoogleOidcProviderParams {
    clientId?: string;
    relayRedirectUri?: string;
    scopes?: string[];
    authorizeParams?: Record<string, string>;
}

export const defaultGoogleClientId = "359787419277-klf59ug1lqhvtn5a31480jfo26ofhq9t.apps.googleusercontent.com";
export const defaultRelayRedirectUri = "https://waas-cf-relay-staging.0xsequence.workers.dev/callback";

export function googleOidcProvider(params: GoogleOidcProviderParams = {}): OidcProviderConfig {
    return {
        clientId: params.clientId || defaultGoogleClientId,
        issuer: 'https://accounts.google.com',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        scopes: params.scopes ?? ['openid', 'email', 'profile'],
        relayRedirectUri: params.relayRedirectUri || defaultRelayRedirectUri,
        authorizeParams: {
            access_type: 'offline',
            prompt: 'consent',
            ...params.authorizeParams,
        },
    };
}
