import {afterEach, describe, expect, it, vi} from "vitest";

import {IndexerClient} from "../src/clients/indexerClient";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("IndexerClient errors", () => {
    it("wraps invalid JSON responses in typed SDK errors", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", {status: 200})));

        const indexer = new IndexerClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
        });

        await expect(indexer.getTokenBalances({
            chainId: "137",
            contractAddress: "0x2222222222222222222222222222222222222222",
            walletAddress: "0x9999999999999999999999999999999999999999",
            includeMetadata: false,
        })).rejects.toMatchObject({
            code: "OMS_INVALID_RESPONSE",
            operation: "indexer.getTokenBalances",
            status: 200,
        });
    });

    it("wraps non-JSON HTTP responses as retryable HTTP errors", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", {status: 502})));

        const indexer = new IndexerClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
        });

        await expect(indexer.getTokenBalances({
            chainId: "137",
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
