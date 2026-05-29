import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {MemoryStorageManager} from "../src/storageManager";

class MockSigner implements CredentialSigner {
    readonly signingAlgorithm = "ecdsa-p256-sha256";

    async credentialId(): Promise<string> {
        return "0x04" + "11".repeat(64);
    }

    async nextNonce(): Promise<string> {
        return "42";
    }

    async sign(): Promise<string> {
        return "0x" + "22".repeat(64);
    }

    async hasCredential(): Promise<boolean> {
        return true;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("WalletClient access management", () => {
    it("lists all wallet access pages as a flattened grant array", async () => {
        const requests: unknown[] = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/ListAccess")) {
                requests.push(body);
                if (requests.length === 1) {
                    return jsonResponse({
                        credentials: [testCredential("11")],
                        page: {cursor: "cursor-2"},
                    });
                }
                return jsonResponse({
                    credentials: [testCredential("22", false)],
                    page: {},
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletWithSession();

        await expect(wallet.listAccess({pageSize: 2})).resolves.toEqual([
            testCredential("11"),
            testCredential("22", false),
        ]);
        expect(requests).toEqual([
            {walletId: "wallet-id", page: {limit: 2}},
            {walletId: "wallet-id", page: {limit: 2, cursor: "cursor-2"}},
        ]);
    });

    it("yields wallet access pages for paginated callers", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/ListAccess")) {
                return jsonResponse({
                    credentials: [testCredential()],
                    page: {},
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletWithSession();
        const pages = [];
        for await (const page of wallet.listAccessPages({pageSize: 25})) {
            pages.push(page);
        }

        expect(pages).toEqual([{grants: [testCredential()]}]);
    });
});

function createWalletWithSession(): WalletClient {
    const wallet = new WalletClient({
        publishableKey: "publishable-key",
        projectId: "project-id",
        environment: testEnvironment(),
        storage: new MemoryStorageManager(),
        credentialSigner: new MockSigner(),
    });
    (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111");
    return wallet;
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

function testCredential(seed = "11", isCaller = true) {
    return {
        credentialId: "0x" + seed.repeat(32),
        expiresAt: "2026-01-01T00:00:00Z",
        isCaller,
    };
}

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
