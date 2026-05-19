// Converted from Swift IndexerClient.

import {HttpClient} from "../httpClient.js";
import {errorMessage, OmsRequestError, OmsResponseError} from "../errors.js";
import type {Network} from "../networks.js";

export interface TokenBalancesPage {
    page: number;
    pageSize: number;
    more: boolean;
}

export interface TokenBalance {
    contractType?: string;
    contractAddress?: string;
    accountAddress?: string;
    /** Wire format uses `tokenID`; this field is re-mapped during decoding. */
    tokenId?: string;
    balance?: string;
    blockHash?: string;
    blockNumber?: number;
    chainId?: number;
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
    blockHash?: string;
    blockNumber?: number;
    chainId?: number;
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
    private readonly publicApiKey: string;
    private readonly environment: OmsEnvironment;
    private readonly client: HttpClient;

    constructor(params: {
        publicApiKey: string,
        environment: OmsEnvironment
    }) {
        this.publicApiKey = params.publicApiKey;
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

        const response = await this.postJson<TokenBalancesPayloadRaw>("indexer.getTokenBalances", {
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
        const response = await this.postJson<NativeTokenBalancePayloadRaw>("indexer.getNativeTokenBalance", {
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
        operation: string,
        args: Parameters<HttpClient["postJson"]>[0],
    ): Promise<{statusCode: number, payload: T}> {
        let response;
        try {
            response = await this.client.postJson(args);
        } catch (error) {
            throw new OmsRequestError({
                operation,
                retryable: true,
                cause: error,
                message: errorMessage(error),
            });
        }

        let payload: T;
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const errorPayload = parseJsonOrText(response.body);
            throw new OmsRequestError({
                code: "OMS_HTTP_ERROR",
                operation,
                status: response.statusCode,
                retryable: response.statusCode >= 500,
                cause: errorPayload,
                message: responseErrorMessage(errorPayload, operation, response.statusCode),
            });
        }

        try {
            payload = JSON.parse(response.body) as T;
        } catch (error) {
            throw new OmsResponseError({
                operation,
                status: response.statusCode,
                cause: error,
                message: `Invalid JSON response from ${operation}`,
            });
        }

        return {statusCode: response.statusCode, payload};
    }

    private indexerUrl(network: Network): string {
        return this.environment.indexerUrlTemplate.replace("{value}", network.name);
    }

    private defaultHeaders(): Record<string, string> {
        return {
            "X-Access-Key": this.publicApiKey,
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
        blockHash: raw.blockHash,
        blockNumber: raw.blockNumber,
        chainId: raw.chainId,
    };
}

function responseErrorMessage(payload: unknown, operation: string, status: number): string {
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
