import {googleOidcProvider} from "./oidc.js";

export interface OidcProviderConfig {
    clientId: string;
    issuer: string;
    authorizationUrl: string;
    scopes?: string[];
    relayRedirectUri?: string;
    authorizeParams?: Record<string, string>;
}

export interface OmsAuthConfig<
    OidcProviders extends Record<string, OidcProviderConfig> = Record<string, OidcProviderConfig>,
> {
    oidcProviders?: OidcProviders;
}

export interface OmsEnvironment<
    OidcProviders extends Record<string, OidcProviderConfig> = Record<string, OidcProviderConfig>,
> {
    walletApiUrl: string;
    indexerUrlTemplate: string;
    auth?: OmsAuthConfig<OidcProviders>;
}

export const defaultOmsEnvironment = {
    walletApiUrl: "https://d26giflyqapd29.cloudfront.net",
    indexerUrlTemplate: "https://dev-{value}-indexer.sequence.app/rpc/Indexer/",
    auth: {
        oidcProviders: {
            google: googleOidcProvider(),
        },
    },
} satisfies OmsEnvironment;

export function defineOmsEnvironment<const Env extends OmsEnvironment>(environment: Env): Env {
    return environment;
}
