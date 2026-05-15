import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {OMSClient} from "../src/omsClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";
import {WalletType} from "../src/generated/waas.gen";

class MockSigner implements CredentialSigner {
    readonly signingAlgorithm = "ecdsa-p256-sha256";
    clear = vi.fn(async () => {});

    constructor(private readonly available = true) {}

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
        return this.available;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("WalletClient session storage", () => {
    it("falls back to memory storage when localStorage is unavailable", () => {
        vi.stubGlobal("localStorage", undefined);

        const client = new OMSClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            credentialSigner: new MockSigner(),
        });

        expect(client.wallet.walletAddress).toBeUndefined();
    });

    it("clears stale wallet metadata when the signer is missing", async () => {
        const storage = new MemoryStorageManager();
        storage.set(Constants.walletIdStorageKey, "wallet-id");
        storage.set(Constants.walletAddressStorageKey, "0x1111111111111111111111111111111111111111");
        storage.set(Constants.sessionExpiresAtStorageKey, "2026-01-01T00:00:00Z");
        storage.set(Constants.sessionLoginTypeStorageKey, "email");
        storage.set(Constants.sessionEmailStorageKey, "user@example.com");

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(false),
        });

        await expect(wallet.signMessage({network: "polygon", message: "hello"})).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            operation: "wallet.signMessage",
            message: "No active wallet session",
        });
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(storage.get(Constants.walletAddressStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionExpiresAtStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionLoginTypeStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionEmailStorageKey)).toBeNull();
    });

    it("clears in-memory wallet state and signer state on sign-out", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const redirectAuthStorage = new MemoryStorageManager();
        redirectAuthStorage.set(Constants.redirectAuthStorageKey, JSON.stringify({verifier: "old-verifier"}));
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            redirectAuthStorage,
            credentialSigner: signer,
        });

        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111", {
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });
        (wallet as any).verifier = "old-verifier";
        (wallet as any).challenge = "old-challenge";
        await wallet.signOut();

        expect(wallet.walletAddress).toBeUndefined();
        expect((wallet as any).verifier).toBe("");
        expect((wallet as any).challenge).toBe("");
        expect(wallet.session).toEqual({
            walletAddress: undefined,
            expiresAt: undefined,
            loginType: undefined,
            sessionEmail: undefined,
        });
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionExpiresAtStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionLoginTypeStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionEmailStorageKey)).toBeNull();
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
        expect(signer.clear).toHaveBeenCalledOnce();
    });

    it("clears an existing session before starting email auth", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const redirectAuthStorage = new MemoryStorageManager();
        storage.set(Constants.walletIdStorageKey, "wallet-id");
        storage.set(Constants.walletAddressStorageKey, "0x1111111111111111111111111111111111111111");
        storage.set(Constants.sessionExpiresAtStorageKey, "2026-01-01T00:00:00Z");
        storage.set(Constants.sessionLoginTypeStorageKey, "email");
        storage.set(Constants.sessionEmailStorageKey, "old@example.com");
        redirectAuthStorage.set(Constants.redirectAuthStorageKey, JSON.stringify({verifier: "old-verifier"}));

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            redirectAuthStorage,
            credentialSigner: signer,
        });

        await wallet.startEmailAuth({email: "new@example.com"});

        expect(wallet.walletAddress).toBeUndefined();
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(storage.get(Constants.walletAddressStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionExpiresAtStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionLoginTypeStorageKey)).toBeNull();
        expect(storage.get(Constants.sessionEmailStorageKey)).toBeNull();
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
        expect(signer.clear).toHaveBeenCalledOnce();
    });

    it("restores completed wallet session metadata from storage", () => {
        const storage = new MemoryStorageManager();
        storage.set(Constants.walletIdStorageKey, "wallet-id");
        storage.set(Constants.walletAddressStorageKey, "0x1111111111111111111111111111111111111111");
        storage.set(Constants.sessionExpiresAtStorageKey, "2026-01-01T00:00:00Z");
        storage.set(Constants.sessionLoginTypeStorageKey, "google-auth");
        storage.set(Constants.sessionEmailStorageKey, "user@example.com");

        const client = new OMSClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });

        expect(client.wallet.session).toEqual({
            walletAddress: "0x1111111111111111111111111111111111111111",
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "google-auth",
            sessionEmail: "user@example.com",
        });
    });

    it("requests a one-week auth lifetime and stores completed email session metadata", async () => {
        const storage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                expect(body).toMatchObject({
                    identityType: "email",
                    authMode: "otp",
                    verifier: "verifier-1",
                    lifetime: 604_800,
                });
                expect(body.answer).toEqual(expect.any(String));
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [{
                        id: "wallet-id",
                        type: WalletType.Ethereum,
                        address: "0x1111111111111111111111111111111111111111",
                    }],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({
                    wallet: {
                        id: "wallet-id",
                        type: WalletType.Ethereum,
                        address: "0x1111111111111111111111111111111111111111",
                    },
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        (wallet as any).verifier = "verifier-1";
        (wallet as any).challenge = "challenge-1";

        const result = await wallet.completeEmailAuth({code: "123456"});

        expect(result).toMatchObject({
            walletAddress: "0x1111111111111111111111111111111111111111",
            wallet: {
                id: "wallet-id",
                type: WalletType.Ethereum,
                address: "0x1111111111111111111111111111111111111111",
            },
            wallets: [{
                id: "wallet-id",
                type: WalletType.Ethereum,
                address: "0x1111111111111111111111111111111111111111",
            }],
            credential: testCredential(),
        });
        expect(wallet.session).toEqual({
            walletAddress: "0x1111111111111111111111111111111111111111",
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });
        expect(storage.get(Constants.sessionExpiresAtStorageKey)).toBe("2026-01-01T00:00:00Z");
        expect(storage.get(Constants.sessionLoginTypeStorageKey)).toBe("email");
        expect(storage.get(Constants.sessionEmailStorageKey)).toBe("user@example.com");
    });

    it("loads remaining auth wallet pages before creating a wallet", async () => {
        const requestedType = "future-wallet" as WalletType;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    wallets: [testWallet("wallet-1", WalletType.Ethereum, "11")],
                    page: {cursor: "cursor-2"},
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/ListWallets")) {
                expect(body).toEqual({page: {cursor: "cursor-2"}});
                return jsonResponse({
                    wallets: [testWallet("wallet-2", requestedType, "22")],
                    page: {},
                });
            }

            if (url.endsWith("/UseWallet")) {
                expect(body).toEqual({walletId: "wallet-2"});
                return jsonResponse({wallet: testWallet("wallet-2", requestedType, "22")});
            }

            if (url.endsWith("/CreateWallet")) {
                throw new Error("CreateWallet should not be called");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        (wallet as any).verifier = "verifier-1";
        (wallet as any).challenge = "challenge-1";

        const result = await wallet.completeEmailAuth({code: "123456", walletType: requestedType});

        expect(result.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(result.wallets).toEqual([
            testWallet("wallet-1", WalletType.Ethereum, "11"),
            testWallet("wallet-2", requestedType, "22"),
        ]);
    });

    it("returns all wallets without activating when autoActivate is false", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [testWallet("wallet-1", WalletType.Ethereum, "11")],
                    page: {cursor: "cursor-2"},
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/ListWallets")) {
                expect(body).toEqual({page: {cursor: "cursor-2"}});
                return jsonResponse({
                    wallets: [testWallet("wallet-2", WalletType.Ethereum, "22")],
                    page: {},
                });
            }

            if (url.endsWith("/UseWallet")) {
                expect(body).toEqual({walletId: "wallet-2"});
                return jsonResponse({wallet: testWallet("wallet-2", WalletType.Ethereum, "22")});
            }

            if (url.endsWith("/CreateWallet")) {
                throw new Error("CreateWallet should not be called");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        (wallet as any).verifier = "verifier-1";
        (wallet as any).challenge = "challenge-1";

        const result = await wallet.completeEmailAuth({code: "123456", autoActivate: false});

        expect(result).toEqual({
            wallets: [
                testWallet("wallet-1", WalletType.Ethereum, "11"),
                testWallet("wallet-2", WalletType.Ethereum, "22"),
            ],
            credential: testCredential(),
        });
        expect(wallet.walletAddress).toBeUndefined();

        const activated = await wallet.useWallet({walletId: "wallet-2"});

        expect(activated.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(wallet.session).toEqual({
            walletAddress: "0x2222222222222222222222222222222222222222",
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });
        expect(storage.get(Constants.sessionEmailStorageKey)).toBe("user@example.com");
    });

    it("can explicitly create and activate a new wallet", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CreateWallet")) {
                expect(body).toEqual({
                    type: WalletType.Ethereum,
                    reference: "fresh",
                });
                return jsonResponse({wallet: testWallet("wallet-new", WalletType.Ethereum, "33", "fresh")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        const result = await wallet.createWallet({type: WalletType.Ethereum, reference: "fresh"});

        expect(result).toEqual({
            walletAddress: "0x3333333333333333333333333333333333333333",
            wallet: testWallet("wallet-new", WalletType.Ethereum, "33", "fresh"),
        });
        expect(wallet.walletAddress).toBe("0x3333333333333333333333333333333333333333");
    });
});

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

function testCredential() {
    return {
        credentialId: "0x" + "11".repeat(32),
        expiresAt: "2026-01-01T00:00:00Z",
        isCaller: true,
    };
}

function testWallet(id: string, type: WalletType, seed: string, reference?: string) {
    return {
        id,
        type,
        address: "0x" + seed.repeat(20),
        ...(reference ? {reference} : {}),
    };
}
