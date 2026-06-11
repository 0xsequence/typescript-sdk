// Converted from Swift IndexerClient.

import {HttpClient} from "../httpClient.js";
import {errorMessage, OmsRequestError, OmsResponseError, type OmsUpstreamError} from "../errors.js";
import type {Network} from "../networks.js";
import {IndexerOperation} from "../operations.js";

export interface TokenBalancesPage {
    page: number;
    pageSize: number;
    more: boolean;
}

export interface TokenContractInfo {
    chainId?: number;
    address?: string;
    source?: string;
    name?: string;
    type?: string;
    symbol?: string;
    decimals?: number;
    logoURI?: string;
    deployed?: boolean;
    bytecodeHash?: string;
    extensions?: Record<string, unknown>;
    updatedAt?: string;
    queuedAt?: string | null;
    status?: string;
}

export interface TokenMetadataAsset {
    id?: number;
    collectionId?: number;
    tokenId?: string;
    url?: string;
    metadataField?: string;
    name?: string;
    filesize?: number;
    mimeType?: string;
    width?: number;
    height?: number;
    updatedAt?: string;
}

export interface TokenMetadata {
    chainId?: number;
    contractAddress?: string;
    tokenId?: string;
    source?: string;
    name?: string;
    description?: string;
    image?: string;
    video?: string;
    audio?: string;
    properties?: Record<string, unknown>;
    attributes?: Record<string, unknown>[];
    image_data?: string;
    external_url?: string;
    background_color?: string;
    animation_url?: string;
    decimals?: number;
    updatedAt?: string;
    assets?: TokenMetadataAsset[];
    status?: string;
    queuedAt?: string | null;
    lastFetched?: string;
}

export interface TokenBalance {
    contractType?: string;
    contractAddress?: string;
    accountAddress?: string;
    /** Wire format uses `tokenID`; this field is re-mapped during decoding. */
    tokenId?: string;
    balance?: string;
    balanceUSD?: string;
    priceUSD?: string;
    priceUpdatedAt?: string;
    blockHash?: string;
    blockNumber?: number;
    chainId?: number;
    uniqueCollectibles?: string;
    isSummary?: boolean;
    contractInfo?: TokenContractInfo;
    tokenMetadata?: TokenMetadata;
}

export interface TokenBalancesResult {
    status: number;
    page?: TokenBalancesPage;
    balances: TokenBalance[];
}

interface NativeTokenBalancePayloadRaw {
    balance?: NativeTokenBalanceRaw;
}

interface NativeTokenBalanceRaw {
    accountAddress?: string;
    balance?: string;
    balanceWei?: string;
    chainId?: number;
}

interface TokenBalancesPayloadRaw {
    page?: TokenBalancesPage;
    balances?: TokenBalanceRaw[];
}

interface TokenBalanceRaw {
    contractType?: string;
    contractAddress?: string;
    accountAddress?: string;
    tokenID?: string; // note the wire key
    balance?: string;
    balanceUSD?: string;
    priceUSD?: string;
    priceUpdatedAt?: string;
    blockHash?: string;
    blockNumber?: number;
    chainId?: number;
    uniqueCollectibles?: string;
    isSummary?: boolean;
    contractInfo?: TokenContractInfo;
    tokenMetadata?: TokenMetadataRaw;
}

interface TokenMetadataRaw extends Omit<TokenMetadata, "tokenId" | "assets"> {
    tokenId?: string;
    tokenID?: string;
    assets?: TokenMetadataAssetRaw[];
}

interface TokenMetadataAssetRaw extends Omit<TokenMetadataAsset, "tokenId"> {
    tokenId?: string;
    tokenID?: string;
}

interface RequestPage {
    page: number;
    pageSize: number;
    more: boolean;
}

interface TokenBalancesRequest {
    page: RequestPage;
    contractAddress?: string;
    accountAddress: string;
    includeMetadata: boolean;
}

// Matches the Swift `OmsEnvironment` shape used by IndexerClient.
export interface OmsEnvironment {
    indexerUrlTemplate: string;
}

export class IndexerClient {
    private readonly publishableKey: string;
    private readonly environment: OmsEnvironment;
    private readonly client: HttpClient;

    constructor(params: {
        publishableKey: string,
        environment: OmsEnvironment
    }) {
        this.publishableKey = params.publishableKey;
        this.environment = params.environment;
        this.client = new HttpClient();
    }

    async getTokenBalances(params: {
        network: Network
        contractAddress?: string
        walletAddress: string
        includeMetadata: boolean
        page?: {
            page?: number
            pageSize?: number
        }
    }): Promise<TokenBalancesResult> {
        const request: TokenBalancesRequest = {
            page: {
                page: params.page?.page ?? 0,
                pageSize: params.page?.pageSize ?? 40,
                more: false,
            },
            accountAddress: params.walletAddress,
            includeMetadata: params.includeMetadata,
        };
        if (params.contractAddress) {
            request.contractAddress = params.contractAddress;
        }

        const bodyString = JSON.stringify(request);
        const baseUrl = this.indexerUrl(params.network);

        const response = await this.postJson<TokenBalancesPayloadRaw>(IndexerOperation.getTokenBalances, {
            baseUrl,
            path: "/GetTokenBalances",
            body: bodyString,
            headers: this.defaultHeaders(),
        });

        return {
            status: response.statusCode,
            page: response.payload.page,
            balances: (response.payload.balances ?? []).map(mapTokenBalance),
        };
    }

    async getNativeTokenBalance(params: {
        network: Network
        walletAddress: string
    }): Promise<TokenBalance | undefined> {
        const response = await this.postJson<NativeTokenBalancePayloadRaw>(IndexerOperation.getNativeTokenBalance, {
            baseUrl: this.indexerUrl(params.network),
            path: "/GetNativeTokenBalance",
            body: JSON.stringify({ accountAddress: params.walletAddress }),
            headers: this.defaultHeaders(),
        });

        if (!response.payload.balance) {
            return undefined;
        }

        return {
            contractType: "NATIVE",
            contractAddress: undefined,
            accountAddress: response.payload.balance.accountAddress,
            tokenId: undefined,
            balance: response.payload.balance.balance ?? response.payload.balance.balanceWei,
            blockHash: undefined,
            blockNumber: undefined,
            chainId: response.payload.balance.chainId,
        };
    }

    private async postJson<T>(
        operation: IndexerOperation,
        args: Parameters<HttpClient["postJson"]>[0],
    ): Promise<{statusCode: number, payload: T}> {
        let response;
        try {
            response = await this.client.postJson(args);
        } catch (error) {
            throw new OmsRequestError({
                operation,
                retryable: true,
                upstreamError: indexerRequestFailure(error),
                cause: error,
                message: errorMessage(error),
            });
        }

        let payload: T;
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const errorPayload = parseJsonOrText(response.body);
            const message = responseErrorMessage(errorPayload, operation, response.statusCode);
            throw new OmsRequestError({
                code: "OMS_HTTP_ERROR",
                operation,
                status: response.statusCode,
                retryable: response.statusCode >= 500,
                upstreamError: indexerResponseError(errorPayload, response.statusCode, message),
                cause: errorPayload,
                message,
            });
        }

        try {
            payload = JSON.parse(response.body) as T;
        } catch (error) {
            const message = `Invalid JSON response from ${operation}`;
            throw new OmsResponseError({
                operation,
                status: response.statusCode,
                upstreamError: {
                    service: "indexer",
                    status: response.statusCode,
                    message,
                },
                cause: error,
                message,
            });
        }

        return {statusCode: response.statusCode, payload};
    }

    private indexerUrl(network: Network): string {
        return this.environment.indexerUrlTemplate.replace("{value}", network.name);
    }

    private defaultHeaders(): Record<string, string> {
        return {
            "X-Access-Key": this.publishableKey,
            Accept: "application/json",
        };
    }
}

/** Re-maps the wire key `tokenID` onto the camelCase `tokenId` field. */
function mapTokenBalance(raw: TokenBalanceRaw): TokenBalance {
    return {
        contractType: raw.contractType,
        contractAddress: raw.contractAddress,
        accountAddress: raw.accountAddress,
        tokenId: raw.tokenID,
        balance: raw.balance,
        balanceUSD: raw.balanceUSD,
        priceUSD: raw.priceUSD,
        priceUpdatedAt: raw.priceUpdatedAt,
        blockHash: raw.blockHash,
        blockNumber: raw.blockNumber,
        chainId: raw.chainId,
        uniqueCollectibles: raw.uniqueCollectibles,
        isSummary: raw.isSummary,
        contractInfo: raw.contractInfo,
        tokenMetadata: raw.tokenMetadata ? mapTokenMetadata(raw.tokenMetadata) : undefined,
    };
}

function mapTokenMetadata(raw: TokenMetadataRaw): TokenMetadata {
    const {tokenID, assets, ...metadata} = raw;
    return {
        ...metadata,
        tokenId: raw.tokenId ?? tokenID,
        assets: assets?.map(asset => {
            const {tokenID: assetTokenID, ...metadataAsset} = asset;
            return {
                ...metadataAsset,
                tokenId: asset.tokenId ?? assetTokenID,
            };
        }),
    };
}

function responseErrorMessage(payload: unknown, operation: IndexerOperation, status: number): string {
    if (payload && typeof payload === "object" && "message" in payload) {
        const message = (payload as {message?: unknown}).message;
        if (typeof message === "string" && message) {
            return message;
        }
    }
    return `${operation} failed with HTTP ${status}`;
}

function parseJsonOrText(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

function indexerRequestFailure(error: unknown): OmsUpstreamError {
    const status = numberField(error, "status");
    return {
        service: "indexer",
        name: error instanceof Error ? error.name : stringField(error, "name"),
        code: numberOrStringField(error, "code"),
        message: errorMessage(error),
        status,
    };
}

function indexerResponseError(payload: unknown, status: number, fallbackMessage: string): OmsUpstreamError {
    return {
        service: "indexer",
        name: stringField(payload, "name") ?? stringField(payload, "error"),
        code: numberOrStringField(payload, "code"),
        message: stringField(payload, "message") ?? fallbackMessage,
        status,
    };
}

function stringField(source: unknown, key: string): string | undefined {
    const value = objectField(source, key);
    return typeof value === "string" ? value : undefined;
}

function numberField(source: unknown, key: string): number | undefined {
    const value = objectField(source, key);
    return typeof value === "number" ? value : undefined;
}

function numberOrStringField(source: unknown, key: string): number | string | undefined {
    const value = objectField(source, key);
    return typeof value === "number" || typeof value === "string" ? value : undefined;
}

function objectField(source: unknown, key: string): unknown {
    return source && typeof source === "object"
        ? (source as Record<string, unknown>)[key]
        : undefined;
}
