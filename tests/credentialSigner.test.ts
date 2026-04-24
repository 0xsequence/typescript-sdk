import {afterEach, describe, expect, it, vi} from "vitest";

import {WebCryptoP256CredentialSigner, type CredentialSigner} from "../src/credentialSigner";
import {WalletClient} from "../src/clients/walletClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";
import {createSignedFetch} from "../src/signedFetch";

class MockSigner implements CredentialSigner {
    readonly keyType = "webcrypto-secp256r1";
    clear = vi.fn(async () => {});
    private available: boolean;

    constructor(available = true) {
        this.available = available;
    }

    async credentialId(): Promise<string> {
        return "0x04" + "11".repeat(64);
    }

    async nextNonce(): Promise<string> {
        return "42";
    }

    async sign(preimage: string): Promise<string> {
        expect(preimage).toContain("nonce: 42");
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

describe("WebCryptoP256CredentialSigner", () => {
    it("generates a webcrypto-secp256r1 credential without an extractable private key", async () => {
        const signer = new WebCryptoP256CredentialSigner(`test-${Date.now()}`);

        const credentialId = await signer.credentialId();

        expect(signer.keyType).toBe("webcrypto-secp256r1");
        expect(credentialId).toMatch(/^0x04[0-9a-f]{128}$/);
        expect((signer as any).keyPair.privateKey.extractable).toBe(false);
    });

    it("produces raw P-256 signatures", async () => {
        const signer = new WebCryptoP256CredentialSigner(`test-${Date.now()}`);

        const signature = await signer.sign("POST /rpc/Wallet/CommitVerifier\nnonce: 1\n\n{}");

        expect(signature).toMatch(/^0x[0-9a-f]{128}$/);
    });
});

describe("createSignedFetch", () => {
    it("uses the signer key type in the Authorization header and does not log request data", async () => {
        const fetchMock = vi.fn(async () => new Response("{}"));
        const consoleLog = vi.spyOn(console, "log");
        vi.stubGlobal("fetch", fetchMock);

        const signedFetch = createSignedFetch("project-key", new MockSigner());
        await signedFetch("https://wallet.example/rpc/Wallet/CommitVerifier", {
            method: "POST",
            body: "{}",
        });

        const [, init] = fetchMock.mock.calls[0];
        expect((init?.headers as Record<string, string>).Authorization).toBe(
            `webcrypto-secp256r1 scope="${Constants.scope}",cred="0x04${"11".repeat(64)}",nonce=42,sig="0x${"22".repeat(64)}"`,
        );
        expect(consoleLog).not.toHaveBeenCalled();
    });
});

describe("WalletClient session storage", () => {
    it("persists wallet metadata without storing a raw signer key", () => {
        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                apiRpcUrl: "https://api.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
            storage,
            credentialSigner: new MockSigner(),
        });

        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111");

        expect(storage.get(Constants.walletIdStorageKey)).toBe("wallet-id");
        expect(storage.get(Constants.walletAddressStorageKey)).toBe("0x1111111111111111111111111111111111111111");
        expect(storage.get(Constants.signerStorageKey)).toBeNull();
    });

    it("clears stale wallet metadata when the signer is missing", async () => {
        const storage = new MemoryStorageManager();
        storage.set(Constants.walletIdStorageKey, "wallet-id");
        storage.set(Constants.walletAddressStorageKey, "0x1111111111111111111111111111111111111111");

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                apiRpcUrl: "https://api.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
            storage,
            credentialSigner: new MockSigner(false),
        });

        await expect(wallet.signMessage({network: "polygon", message: "hello"})).rejects.toThrow("No active wallet session");
        expect(storage.get(Constants.walletIdStorageKey)).toBeNull();
        expect(storage.get(Constants.walletAddressStorageKey)).toBeNull();
    });

    it("clears in-memory wallet state and signer state on sign-out", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                apiRpcUrl: "https://api.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
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
