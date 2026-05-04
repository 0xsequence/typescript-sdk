// Converted from Swift IndexerClient.

import {HttpClient} from "../httpClient.js";
import {NetworkBindings} from "../utils/networkBindings.js";
import {errorMessage, OmsRequestError, OmsResponseError} from "../errors.js";

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
    contractAddress: string;
    accountAddress: string;
    includeMetadata: boolean;
}

// Matches the Swift `OmsEnvironment` shape used by IndexerClient.
export interface OmsEnvironment {
    indexerUrlTemplate: string;
}

export class IndexerClient {
    private readonly projectAccessKey: string;
    private readonly environment: OmsEnvironment;
    private readonly client: HttpClient;
    private readonly networks: NetworkBindings;

    constructor(params: {
        projectAccessKey: string,
        environment: OmsEnvironment
    }) {
        this.projectAccessKey = params.projectAccessKey;
        this.environment = params.environment;
        this.client = new HttpClient();
        this.networks = new NetworkBindings();
    }

    async getTokenBalances(params: {
        chainId: string
        contractAddress: string
        walletAddress: string
        includeMetadata: boolean
    }): Promise<TokenBalancesResult> {
        const request: TokenBalancesRequest = {
            page: { page: 0, pageSize: 40, more: false },
            contractAddress: params.contractAddress,
            accountAddress: params.walletAddress,
            includeMetadata: params.includeMetadata,
        };

        const bodyString = JSON.stringify(request);
        const baseUrl = this.indexerUrl(params.chainId);

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
        chainId: string
        walletAddress: string
    }): Promise<TokenBalance | undefined> {
        const response = await this.postJson<NativeTokenBalancePayloadRaw>("indexer.getNativeTokenBalance", {
            baseUrl: this.indexerUrl(params.chainId),
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

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new OmsRequestError({
                code: "OMS_HTTP_ERROR",
                operation,
                status: response.statusCode,
                retryable: response.statusCode >= 500,
                cause: payload,
                message: responseErrorMessage(payload, operation, response.statusCode),
            });
        }

        return {statusCode: response.statusCode, payload};
    }

    private indexerUrl(chainId: string): string {
        return this.environment.indexerUrlTemplate.replace("{value}", this.indexerNetworkValue(chainId));
    }

    private indexerNetworkValue(chainId: string): string {
        const normalized = chainId.toLowerCase();
        if (/^\d+$/.test(normalized)) {
            return this.networks.findChainNameById(BigInt(normalized)) ?? normalized;
        }
        return normalized;
    }

    private defaultHeaders(): Record<string, string> {
        return {
            "X-Access-Key": this.projectAccessKey,
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
