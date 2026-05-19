import {afterEach, describe, expect, it, vi} from "vitest";

import {IndexerClient} from "../src/clients/indexerClient";
import {Networks} from "../src/networks";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("IndexerClient", () => {
    it("omits contractAddress when querying balances across contracts", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            page: {page: 1, pageSize: 25, more: false},
            balances: [{
                contractType: "ERC20",
                contractAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
                accountAddress: "0x9999999999999999999999999999999999999999",
                tokenID: "0",
                balance: "141799",
                balanceUSD: "0.141799",
                priceUSD: "1",
                chainId: 137,
                contractInfo: {
                    name: "USDC",
                    symbol: "USDC",
                    decimals: 6,
                },
            }],
        }), {status: 200}));
        vi.stubGlobal("fetch", fetchMock);

        const indexer = new IndexerClient({
            publicApiKey: "public-api-key",
            environment: testEnvironment(),
        });

        await expect(indexer.getTokenBalances({
            network: Networks.polygon,
            walletAddress: "0x9999999999999999999999999999999999999999",
            includeMetadata: true,
            page: {page: 1, pageSize: 25},
        })).resolves.toMatchObject({
            status: 200,
            page: {page: 1, pageSize: 25, more: false},
            balances: [{
                tokenId: "0",
                balance: "141799",
                balanceUSD: "0.141799",
                priceUSD: "1",
                contractInfo: {
                    symbol: "USDC",
                    decimals: 6,
                },
            }],
        });

        expect(fetchMock.mock.calls[0][0].toString()).toBe("https://indexer.example/polygon/GetTokenBalances");
        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
            page: {page: 1, pageSize: 25, more: false},
            accountAddress: "0x9999999999999999999999999999999999999999",
            includeMetadata: true,
        });
    });

    it("wraps invalid JSON responses in typed SDK errors", async () => {
        const fetchMock = vi.fn(async () => new Response("not-json", {status: 200}));
        vi.stubGlobal("fetch", fetchMock);

        const indexer = new IndexerClient({
            publicApiKey: "public-api-key",
            environment: testEnvironment(),
        });

        await expect(indexer.getTokenBalances({
            network: Networks.polygon,
            contractAddress: "0x2222222222222222222222222222222222222222",
            walletAddress: "0x9999999999999999999999999999999999999999",
            includeMetadata: false,
        })).rejects.toMatchObject({
            code: "OMS_INVALID_RESPONSE",
            operation: "indexer.getTokenBalances",
            status: 200,
        });
        expect(fetchMock.mock.calls[0][0].toString()).toBe("https://indexer.example/polygon/GetTokenBalances");
    });

    it("wraps non-JSON HTTP responses as retryable HTTP errors", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", {status: 502})));

        const indexer = new IndexerClient({
            publicApiKey: "public-api-key",
            environment: testEnvironment(),
        });

        await expect(indexer.getTokenBalances({
            network: Networks.polygon,
            contractAddress: "0x2222222222222222222222222222222222222222",
            walletAddress: "0x9999999999999999999999999999999999999999",
            includeMetadata: false,
        })).rejects.toMatchObject({
            code: "OMS_HTTP_ERROR",
            operation: "indexer.getTokenBalances",
            status: 502,
            retryable: true,
        });
    });
});

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        apiRpcUrl: "https://api.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
