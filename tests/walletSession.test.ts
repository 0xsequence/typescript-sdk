import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {OMSClient} from "../src/omsClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";

class MockSigner implements CredentialSigner {
    readonly keyType = "webcrypto-secp256r1";
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
    });

    it("clears in-memory wallet state and signer state on sign-out", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage,
            credentialSigner: signer,
        });

        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111");
        await wallet.signOut();

        expect(wallet.walletAddress).toBeUndefined();
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(signer.clear).toHaveBeenCalledOnce();
    });
});

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
