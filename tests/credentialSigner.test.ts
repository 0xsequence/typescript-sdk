import {afterEach, describe, expect, it, vi} from "vitest";

import {WebCryptoP256CredentialSigner, type CredentialSigner} from "../src/credentialSigner";
import {WalletClient} from "../src/clients/walletClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";
import {createSignedFetch} from "../src/signedFetch";
import {TransactionStatus} from "../src/generated/waas.gen";

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

    it("uses faster status polling for the first five polls", () => {
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                apiRpcUrl: "https://api.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        expect((wallet as any).transactionStatusPollDelayMs(1)).toBe(400);
        expect((wallet as any).transactionStatusPollDelayMs(4)).toBe(400);
        expect((wallet as any).transactionStatusPollDelayMs(5)).toBe(2_000);
        expect((wallet as any).transactionStatusPollDelayMs(6)).toBe(2_000);
    });

    it("prepares, enriches fee options, executes, and returns transaction status", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/PrepareEthereumTransaction")) {
                expect(body).toMatchObject({
                    network: "137",
                    walletId: "wallet-id",
                    to: "0x1111111111111111111111111111111111111111",
                    value: "0",
                    mode: "relayer",
                });
                return jsonResponse({
                    txnId: "txn-1",
                    status: "quoted",
                    feeOptions: [
                        {
                            token: {
                                network: "137",
                                name: "Polygon",
                                symbol: "MATIC",
                                type: "native",
                                decimals: 18,
                                logoURL: "",
                            },
                            value: "100000000000000000",
                            displayValue: "0.1",
                        },
                        {
                            token: {
                                network: "137",
                                name: "USD Coin",
                                symbol: "USDC",
                                type: "erc20",
                                decimals: 6,
                                logoURL: "",
                                contractAddress: "0x2222222222222222222222222222222222222222",
                            },
                            value: "1000000",
                            displayValue: "1",
                        },
                    ],
                    sponsored: false,
                    expiresAt: "2026-01-01T00:00:00Z",
                });
            }

            if (url.endsWith("/GetNativeTokenBalance")) {
                expect(body).toEqual({
                    accountAddress: "0x9999999999999999999999999999999999999999",
                });
                return jsonResponse({
                    balance: {
                        accountAddress: "0x9999999999999999999999999999999999999999",
                        balanceWei: "1000000000000000000",
                        chainId: 137,
                    },
                });
            }

            if (url.endsWith("/GetTokenBalances")) {
                expect(body).toMatchObject({
                    contractAddress: "0x2222222222222222222222222222222222222222",
                    accountAddress: "0x9999999999999999999999999999999999999999",
                    includeMetadata: false,
                });
                return jsonResponse({
                    page: {page: 0, pageSize: 40, more: false},
                    balances: [{
                        contractType: "ERC20",
                        contractAddress: "0x2222222222222222222222222222222222222222",
                        accountAddress: "0x9999999999999999999999999999999999999999",
                        tokenID: null,
                        balance: "2500000",
                        chainId: 137,
                    }],
                });
            }

            if (url.endsWith("/Execute")) {
                expect(body).toEqual({
                    txnId: "txn-1",
                    feeOption: {token: "USDC"},
                });
                return jsonResponse({status: "pending"});
            }

            if (url.endsWith("/GetTransactionStatus")) {
                expect(body).toEqual({txnId: "txn-1"});
                return jsonResponse({
                    status: "executed",
                    txnHash: "0xtx",
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

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
        (wallet as any).persistSession(
            "wallet-id",
            "0x9999999999999999999999999999999999999999",
        );

        const response = await wallet.sendTransaction({
            network: "polygon",
            to: "0x1111111111111111111111111111111111111111",
            value: 0n,
            selectFeeOption: (feeOptions) => {
                expect(feeOptions[0].available).toBe("1");
                expect(feeOptions[1].available).toBe("2.5");
                return {token: feeOptions[1].feeOption.token.symbol};
            },
        });

        expect(response).toEqual({
            txnId: "txn-1",
            status: TransactionStatus.Executed,
            txHash: "0xtx",
        });
    });
});

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}
