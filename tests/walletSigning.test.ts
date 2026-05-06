import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {MemoryStorageManager} from "../src/storageManager";

class MockSigner implements CredentialSigner {
    readonly keyType = "webcrypto-secp256r1";

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

describe("WalletClient signing", () => {
    it("signs typed data through the generated wallet client", async () => {
        const typedData = {
            domain: {name: "Test", chainId: 137n},
            types: {Message: [
                {name: "contents", type: "string"},
                {name: "amount", type: "uint256"},
                {name: "ids", type: "uint256[]"},
            ]},
            message: {
                contents: "hello",
                amount: 12345678901234567890n,
                ids: [1n, 2n],
            },
            primaryType: "Message",
        };
        const serializedTypedData = {
            domain: {name: "Test", chainId: "137"},
            types: {Message: [
                {name: "contents", type: "string"},
                {name: "amount", type: "uint256"},
                {name: "ids", type: "uint256[]"},
            ]},
            message: {
                contents: "hello",
                amount: "12345678901234567890",
                ids: ["1", "2"],
            },
            primaryType: "Message",
        };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            expect((init?.headers as Record<string, string>)["X-Access-Key"]).toBe("project-key");
            expect((init?.headers as Record<string, string>).Authorization).toBeDefined();

            if (url.endsWith("/SignTypedData")) {
                expect(body).toEqual({
                    network: "137",
                    walletId: "wallet-id",
                    typedData: serializedTypedData,
                });
                return jsonResponse({signature: "0xsigned"});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletWithSession("0x1111111111111111111111111111111111111111");

        await expect(wallet.signTypedData({network: "polygon", typedData})).resolves.toBe("0xsigned");
    });

    it("validates signatures through the generated wallet public client", async () => {
        const typedData = {
            domain: {name: "Test", chainId: 137n},
            types: {Message: [{name: "contents", type: "string"}, {name: "amount", type: "uint256"}]},
            message: {contents: "hello", amount: 12345678901234567890n},
            primaryType: "Message",
        };
        const serializedTypedData = {
            domain: {name: "Test", chainId: "137"},
            types: {Message: [{name: "contents", type: "string"}, {name: "amount", type: "uint256"}]},
            message: {contents: "hello", amount: "12345678901234567890"},
            primaryType: "Message",
        };
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);
            const headers = init?.headers as Record<string, string>;

            expect(headers["X-Access-Key"]).toBe("project-key");
            expect(headers.Authorization).toBeUndefined();

            if (url.endsWith("/IsValidMessageSignature")) {
                expect(body).toEqual({
                    network: "137",
                    walletId: "wallet-id",
                    message: "hello",
                    signature: "0xmessage",
                });
                return jsonResponse({isValid: true});
            }

            if (url.endsWith("/IsValidTypedDataSignature")) {
                expect(body).toEqual({
                    network: "137",
                    walletAddress: "0x1111111111111111111111111111111111111111",
                    typedData: serializedTypedData,
                    signature: "0xtyped",
                });
                return jsonResponse({isValid: false});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletWithSession("0x1111111111111111111111111111111111111111");

        await expect(wallet.isValidMessageSignature({
            network: "polygon",
            message: "hello",
            signature: "0xmessage",
        })).resolves.toBe(true);

        await expect(wallet.isValidTypedDataSignature({
            network: 137n,
            walletAddress: "0x1111111111111111111111111111111111111111",
            typedData,
            signature: "0xtyped",
        })).resolves.toBe(false);
    });
});

function createWalletWithSession(walletAddress: string): WalletClient {
    const wallet = new WalletClient({
        projectAccessKey: "project-key",
        environment: testEnvironment(),
        storage: new MemoryStorageManager(),
        credentialSigner: new MockSigner(),
    });
    (wallet as any).persistSession("wallet-id", walletAddress);
    return wallet;
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
