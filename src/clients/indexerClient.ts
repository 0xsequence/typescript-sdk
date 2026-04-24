// Converted from Swift IndexerClient.

import {HttpClient} from "../httpClient";

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

    constructor(params: {
        projectAccessKey: string,
        environment: OmsEnvironment
    }) {
        this.projectAccessKey = params.projectAccessKey;
        this.environment = params.environment;
        this.client = new HttpClient();
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

        const response = await this.client.postJson({
            baseUrl,
            path: "/GetTokenBalances",
            body: bodyString,
            headers: this.defaultHeaders(),
        });

        const payload = JSON.parse(response.body) as TokenBalancesPayloadRaw;

        return {
            status: response.statusCode,
            page: payload.page,
            balances: (payload.balances ?? []).map(mapTokenBalance),
        };
    }

    private indexerUrl(chainId: string): string {
        return this.environment.indexerUrlTemplate.replace("{value}", chainId);
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