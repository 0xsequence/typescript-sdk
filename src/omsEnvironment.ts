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
    waasAuthScope?: string;
    oidcProviders?: OidcProviders;
}

export interface OmsEnvironment<
    OidcProviders extends Record<string, OidcProviderConfig> = Record<string, OidcProviderConfig>,
> {
    walletApiUrl: string;
    apiRpcUrl: string;
    indexerUrlTemplate: string;
    auth?: OmsAuthConfig<OidcProviders>;
}

export const defaultOmsEnvironment: OmsEnvironment = {
    walletApiUrl: "https://d1sctl7y41hot5.cloudfront.net",
    apiRpcUrl: "https://dev-api.sequence.app/rpc/API",
    indexerUrlTemplate: "https://dev-{value}-indexer.sequence.app/rpc/Indexer/",
};

export function defineOmsEnvironment<const Env extends OmsEnvironment>(environment: Env): Env {
    return environment;
}
