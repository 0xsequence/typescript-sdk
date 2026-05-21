import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {Networks} from "../src/networks";
import {OMSClient} from "../src/omsClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";
import {RequestUtils} from "../src/utils/requestUtils";
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

function seedEmailAuthAttempt(
    wallet: WalletClient,
    verifier = "verifier-1",
    challenge = "challenge-1",
): void {
    (wallet as any).activeEmailAuthAttempt = {verifier, challenge};
}

function activeEmailAuthAttempt(wallet: WalletClient): unknown {
    return (wallet as any).activeEmailAuthAttempt;
}

describe("WalletClient session storage", () => {
    it("falls back to memory storage when localStorage is unavailable", () => {
        vi.stubGlobal("localStorage", undefined);

        const client = new OMSClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(false),
        });

        await expect(wallet.signMessage({network: Networks.polygon, message: "hello"})).rejects.toMatchObject({
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
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
        seedEmailAuthAttempt(wallet, "old-verifier", "old-challenge");
        await wallet.signOut();

        expect(wallet.walletAddress).toBeUndefined();
        expect(activeEmailAuthAttempt(wallet)).toBeUndefined();
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);

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

    it("deduplicates concurrent email auth completion for the same auth attempt", async () => {
        const completeAuth = deferred<Response>();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                return completeAuth.promise;
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({wallet: testWallet("wallet-id", WalletType.Ethereum, "11")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer").mockResolvedValue("answer");

        const first = wallet.completeEmailAuth({code: "123456"});
        const second = wallet.completeEmailAuth({code: "123456"});
        await waitForRequest(fetchMock, "/CompleteAuth");

        expect(requestCount(fetchMock, "/CompleteAuth")).toBe(1);
        completeAuth.resolve(jsonResponse({
            identity: {type: "email", sub: "user-1"},
            email: "user@example.com",
            wallets: [testWallet("wallet-id", WalletType.Ethereum, "11")],
            credential: testCredential(),
        }));

        await expect(first).resolves.toMatchObject({
            wallet: {id: "wallet-id"},
        });
        await expect(second).resolves.toMatchObject({
            wallet: {id: "wallet-id"},
        });
        expect(requestCount(fetchMock, "/UseWallet")).toBe(1);
    });

    it("does not persist stale automatic email auth after a newer email auth starts", async () => {
        const completeAuth = deferred<Response>();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                return completeAuth.promise;
            }

            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-2",
                    challenge: "challenge-2",
                });
            }

            if (url.endsWith("/UseWallet")) {
                throw new Error("UseWallet should not be called for stale auth");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer").mockResolvedValue("old-answer");

        const staleCompletion = wallet.completeEmailAuth({code: "111111"});
        await waitForRequest(fetchMock, "/CompleteAuth");
        await wallet.startEmailAuth({email: "new@example.com"});
        completeAuth.resolve(jsonResponse({
            identity: {type: "email", sub: "user-1"},
            email: "old@example.com",
            wallets: [testWallet("wallet-old", WalletType.Ethereum, "44")],
            credential: testCredential(),
        }));

        await expect(staleCompletion).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            operation: "wallet.completeEmailAuth",
            message: "Email auth attempt is no longer active",
        });
        expect(wallet.walletAddress).toBeUndefined();
        expect(activeEmailAuthAttempt(wallet)).toMatchObject({
            verifier: "verifier-2",
            challenge: "challenge-2",
        });
        expect(requestCount(fetchMock, "/UseWallet")).toBe(0);
    });

    it("allows email auth completion retry after a failed completion request", async () => {
        let completeAuthCalls = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                completeAuthCalls += 1;
                if (completeAuthCalls === 1) {
                    throw new Error("temporary CompleteAuth failure");
                }

                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [testWallet("wallet-id", WalletType.Ethereum, "11")],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({wallet: testWallet("wallet-id", WalletType.Ethereum, "11")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer").mockResolvedValue("answer");

        await expect(wallet.completeEmailAuth({code: "123456"})).rejects.toMatchObject({
            operation: "wallet.completeEmailAuth",
        });
        await expect(wallet.completeEmailAuth({code: "123456"})).resolves.toMatchObject({
            wallet: {id: "wallet-id"},
        });
        expect(requestCount(fetchMock, "/CompleteAuth")).toBe(2);
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);

        const result = await wallet.completeEmailAuth({code: "123456", walletType: requestedType});

        expect(result.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(result.wallets).toEqual([
            testWallet("wallet-1", WalletType.Ethereum, "11"),
            testWallet("wallet-2", requestedType, "22"),
        ]);
    });

    it("returns a pending wallet selection with filtered wallets when wallet selection is manual", async () => {
        const otherType = "future-wallet" as WalletType;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [
                        testWallet("wallet-1", WalletType.Ethereum, "11"),
                        testWallet("wallet-other", otherType, "33"),
                    ],
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);

        const result = await wallet.completeEmailAuth({code: "123456", walletSelection: "manual"});

        expect(result).toMatchObject({
            walletType: WalletType.Ethereum,
            wallets: [
                testWallet("wallet-1", WalletType.Ethereum, "11"),
                testWallet("wallet-2", WalletType.Ethereum, "22"),
            ],
            credential: testCredential(),
        });
        expect(result.selectWallet).toEqual(expect.any(Function));
        expect(result.createAndSelectWallet).toEqual(expect.any(Function));
        expect(wallet.walletAddress).toBeUndefined();

        await expect(result.selectWallet({walletId: "wallet-other"})).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_UNAVAILABLE",
            operation: "wallet.pendingWalletSelection.selectWallet",
        });
        expect(requestCount(fetchMock, "/UseWallet")).toBe(0);

        const activated = await result.selectWallet({walletId: "wallet-2"});

        expect(activated.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(wallet.session).toEqual({
            walletAddress: "0x2222222222222222222222222222222222222222",
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });
        expect(storage.get(Constants.sessionEmailStorageKey)).toBe("user@example.com");
    });

    it("pending create uses the requested wallet type", async () => {
        const requestedType = "future-wallet" as WalletType;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/CreateWallet")) {
                expect(body).toEqual({
                    type: requestedType,
                    reference: "fresh",
                });
                return jsonResponse({wallet: testWallet("wallet-new", requestedType, "33", "fresh")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);

        const selection = await wallet.completeEmailAuth({
            code: "123456",
            walletType: requestedType,
            walletSelection: "manual",
        });

        const result = await selection.createAndSelectWallet({reference: "fresh"});

        expect(result).toEqual({
            walletAddress: "0x3333333333333333333333333333333333333333",
            wallet: testWallet("wallet-new", requestedType, "33", "fresh"),
        });
        expect(wallet.walletAddress).toBe("0x3333333333333333333333333333333333333333");
    });

    it("stale pending wallet selections fail before network after newer manual auth", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: body.answer === "first" ? "first@example.com" : "second@example.com",
                    wallets: [testWallet(body.answer === "first" ? "wallet-first" : "wallet-second", WalletType.Ethereum, body.answer === "first" ? "11" : "22")],
                    credential: testCredential(),
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer")
            .mockResolvedValueOnce("first")
            .mockResolvedValueOnce("second");

        const staleSelection = await wallet.completeEmailAuth({
            code: "111111",
            walletSelection: "manual",
        });
        seedEmailAuthAttempt(wallet, "verifier-2", "challenge-2");
        await wallet.completeEmailAuth({
            code: "222222",
            walletSelection: "manual",
        });
        const requestCountBeforeStaleSelection = fetchMock.mock.calls.length;

        await expect(staleSelection.selectWallet({walletId: "wallet-first"})).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_STALE",
        });
        await expect(staleSelection.createAndSelectWallet({reference: "stale"})).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_STALE",
        });
        expect(fetchMock.mock.calls.length).toBe(requestCountBeforeStaleSelection);
        expect(wallet.walletAddress).toBeUndefined();
    });

    it("stale pending wallet selections fail before network after newer automatic auth", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: body.answer === "first" ? "first@example.com" : "second@example.com",
                    wallets: [testWallet(body.answer === "first" ? "wallet-first" : "wallet-second", WalletType.Ethereum, body.answer === "first" ? "11" : "22")],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({wallet: testWallet("wallet-second", WalletType.Ethereum, "22")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer")
            .mockResolvedValueOnce("first")
            .mockResolvedValueOnce("second");

        const staleSelection = await wallet.completeEmailAuth({
            code: "111111",
            walletSelection: "manual",
        });
        seedEmailAuthAttempt(wallet, "verifier-2", "challenge-2");
        await wallet.completeEmailAuth({code: "222222"});
        const requestCountBeforeStaleSelection = fetchMock.mock.calls.length;

        await expect(staleSelection.createAndSelectWallet({reference: "stale"})).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_STALE",
        });
        expect(fetchMock.mock.calls.length).toBe(requestCountBeforeStaleSelection);
        expect(wallet.walletAddress).toBe("0x2222222222222222222222222222222222222222");
    });

    it("reused pending wallet selections fail before network after success", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [testWallet("wallet-1", WalletType.Ethereum, "11")],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({wallet: testWallet("wallet-1", WalletType.Ethereum, "11")});
            }

            if (url.endsWith("/CreateWallet")) {
                throw new Error("CreateWallet should not be called");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);

        const selection = await wallet.completeEmailAuth({code: "123456", walletSelection: "manual"});
        await selection.selectWallet({walletId: "wallet-1"});
        const requestCountAfterSelection = fetchMock.mock.calls.length;

        await expect(selection.createAndSelectWallet({reference: "again"})).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_STALE",
        });
        expect(fetchMock.mock.calls.length).toBe(requestCountAfterSelection);
    });

    it("concurrent pending create calls send only one create wallet request", async () => {
        let resolveCreate!: (response: Response) => void;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/CreateWallet")) {
                expect(body).toEqual({type: WalletType.Ethereum, reference: "fresh"});
                return new Promise<Response>(resolve => {
                    resolveCreate = resolve;
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        const selection = await wallet.completeEmailAuth({code: "123456", walletSelection: "manual"});

        const firstCreate = selection.createAndSelectWallet({reference: "fresh"});
        const secondCreate = selection.createAndSelectWallet({reference: "fresh"});

        await expect(secondCreate).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_IN_FLIGHT",
        });
        expect(requestCount(fetchMock, "/CreateWallet")).toBe(1);

        resolveCreate(jsonResponse({wallet: testWallet("wallet-new", WalletType.Ethereum, "33", "fresh")}));
        await expect(firstCreate).resolves.toMatchObject({
            wallet: {id: "wallet-new"},
        });
        expect(requestCount(fetchMock, "/CreateWallet")).toBe(1);
    });

    it("failed pending create can be retried when the selection was not consumed", async () => {
        let createAttempts = 0;
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/CreateWallet")) {
                createAttempts += 1;
                if (createAttempts === 1) {
                    throw new Error("network failed");
                }
                return jsonResponse({wallet: testWallet("wallet-new", WalletType.Ethereum, "33", "fresh")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        const selection = await wallet.completeEmailAuth({code: "123456", walletSelection: "manual"});

        await expect(selection.createAndSelectWallet({reference: "fresh"})).rejects.toMatchObject({
            code: "OMS_REQUEST_FAILED",
        });

        await expect(selection.createAndSelectWallet({reference: "fresh"})).resolves.toMatchObject({
            wallet: {id: "wallet-new"},
        });
        expect(requestCount(fetchMock, "/CreateWallet")).toBe(2);
    });

    it("pending create invalidated while in flight does not persist the stale result", async () => {
        let resolveCreate!: (response: Response) => void;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: body.answer === "first" ? "first@example.com" : "second@example.com",
                    wallets: body.answer === "first"
                        ? []
                        : [testWallet("wallet-second", WalletType.Ethereum, "22")],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/CreateWallet")) {
                return new Promise<Response>(resolve => {
                    resolveCreate = resolve;
                });
            }

            if (url.endsWith("/UseWallet")) {
                return jsonResponse({wallet: testWallet("wallet-second", WalletType.Ethereum, "22")});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        vi.spyOn(RequestUtils, "hashEmailAuthAnswer")
            .mockResolvedValueOnce("first")
            .mockResolvedValueOnce("second");
        const selection = await wallet.completeEmailAuth({code: "111111", walletSelection: "manual"});

        const staleCreate = selection.createAndSelectWallet({reference: "stale"});
        seedEmailAuthAttempt(wallet, "verifier-2", "challenge-2");
        await wallet.completeEmailAuth({code: "222222"});
        resolveCreate(jsonResponse({wallet: testWallet("wallet-stale", WalletType.Ethereum, "44", "stale")}));

        await expect(staleCreate).rejects.toMatchObject({
            code: "OMS_WALLET_SELECTION_STALE",
        });
        expect(wallet.walletAddress).toBe("0x2222222222222222222222222222222222222222");
    });

    it("public wallet activation methods reject while manual selection is pending", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "email", sub: "user-1"},
                    email: "user@example.com",
                    wallets: [testWallet("wallet-1", WalletType.Ethereum, "11")],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/ListWallets")) {
                return jsonResponse({wallets: [testWallet("wallet-1", WalletType.Ethereum, "11")], page: {}});
            }

            if (url.endsWith("/UseWallet") || url.endsWith("/CreateWallet")) {
                throw new Error(
                    "Public activation methods should not be used while manual wallet selection is pending; complete selection through PendingWalletSelection",
                );
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        seedEmailAuthAttempt(wallet);
        await wallet.completeEmailAuth({code: "111111", walletSelection: "manual"});

        await expect(wallet.listWallets()).resolves.toEqual([testWallet("wallet-1", WalletType.Ethereum, "11")]);
        await expect(wallet.useWallet({walletId: "wallet-1"})).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            operation: "wallet.useWallet",
            message: "No active wallet session",
        });
        await expect(wallet.createWallet({type: WalletType.Ethereum, reference: "fresh"})).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            operation: "wallet.createWallet",
            message: "No active wallet session",
        });
        expect(requestCount(fetchMock, "/UseWallet")).toBe(0);
        expect(requestCount(fetchMock, "/CreateWallet")).toBe(0);
    });

    it("public wallet activation methods require an active session", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            throw new Error(`Unexpected request: ${input.toString()}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        await expect(wallet.listWallets()).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            message: "No authenticated wallet session",
        });
        await expect(wallet.useWallet({walletId: "wallet-1"})).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            message: "No active wallet session",
        });
        await expect(wallet.createWallet({type: WalletType.Ethereum, reference: "fresh"})).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            message: "No active wallet session",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("active wallet switch invalidated while in flight by sign-out does not persist the stale result", async () => {
        const storage = new MemoryStorageManager();
        let resolveUse!: (response: Response) => void;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/UseWallet")) {
                expect(body).toEqual({walletId: "wallet-2"});
                return new Promise<Response>(resolve => {
                    resolveUse = resolve;
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        (wallet as any).persistSession("wallet-1", "0x1111111111111111111111111111111111111111", {
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });

        const staleUse = wallet.useWallet({walletId: "wallet-2"});
        await waitForRequest(fetchMock, "/UseWallet");
        await wallet.signOut();
        resolveUse(jsonResponse({wallet: testWallet("wallet-2", WalletType.Ethereum, "22")}));

        await expect(staleUse).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            operation: "wallet.useWallet",
            message: "No active wallet session",
        });
        expect(wallet.walletAddress).toBeUndefined();
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(storage.get(Constants.walletAddressStorageKey)).toBeNull();
    });

    it("can switch to an existing wallet from an active session", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/UseWallet")) {
                expect(body).toEqual({walletId: "wallet-2"});
                return jsonResponse({wallet: testWallet("wallet-2", WalletType.Ethereum, "22")});
            }

            if (url.endsWith("/SignMessage")) {
                expect(body).toEqual({
                    network: Networks.polygon.id.toString(),
                    walletId: "wallet-2",
                    message: "hello",
                });
                return jsonResponse({signature: "0xsigned"});
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage,
            credentialSigner: new MockSigner(),
        });
        (wallet as any).persistSession("wallet-1", "0x1111111111111111111111111111111111111111", {
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
        });

        const result = await wallet.useWallet({walletId: "wallet-2"});

        expect(result).toEqual({
            walletAddress: "0x2222222222222222222222222222222222222222",
            wallet: testWallet("wallet-2", WalletType.Ethereum, "22"),
        });
        expect(wallet.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(storage.get(Constants.walletIdStorageKey)).toBe("wallet-2");
        expect(storage.get(Constants.walletAddressStorageKey)).toBe("0x2222222222222222222222222222222222222222");
        expect(requestCount(fetchMock, "/UseWallet")).toBe(1);

        await expect(wallet.signMessage({network: Networks.polygon, message: "hello"})).resolves.toBe("0xsigned");
        expect(requestCount(fetchMock, "/SignMessage")).toBe(1);
    });

    it("can explicitly create and activate a new wallet from an active session", async () => {
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
            publicApiKey: "public-api-key",
            projectId: "project-id",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111", {
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "email",
            sessionEmail: "user@example.com",
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

function requestCount(fetchMock: ReturnType<typeof vi.fn>, endpoint: string): number {
    return fetchMock.mock.calls.filter(([input]) => input.toString().endsWith(endpoint)).length;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {promise, resolve, reject};
}

async function waitForRequest(fetchMock: ReturnType<typeof vi.fn>, endpoint: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (requestCount(fetchMock, endpoint) > 0) {
            return;
        }
        await Promise.resolve();
    }
    throw new Error(`Expected ${endpoint} request`);
}
