export interface OmsEnvironment {
    walletApiUrl: string;
    apiRpcUrl: string;
    indexerUrlTemplate: string;
}

export const defaultOmsEnvironment: OmsEnvironment = {
    walletApiUrl: "https://d1sctl7y41hot5.cloudfront.net",
    apiRpcUrl: "https://dev-api.sequence.app/rpc/API",
    indexerUrlTemplate: "https://dev-{value}-indexer.sequence.app/rpc/Indexer/",
};