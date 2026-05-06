import {afterEach, describe, expect, it, vi} from "vitest";

import {type CredentialSigner} from "../src/credentialSigner";
import {WalletClient} from "../src/clients/walletClient";
import {MemoryStorageManager} from "../src/storageManager";
import {Constants} from "../src/utils/constants";
import {TransactionStatus} from "../src/generated/waas.gen";
import {OMSClient} from "../src/omsClient";
import {IndexerClient} from "../src/clients/indexerClient";
import {RequestUtils} from "../src/utils/requestUtils";

class MockSigner implements CredentialSigner {
    readonly keyType = "webcrypto-secp256r1";
    clear = vi.fn(async () => {});
    private available: boolean;

    constructor(available = true, private readonly expectedPreimage?: string) {
        this.available = available;
    }

    async credentialId(): Promise<string> {
        return "0x04" + "11".repeat(64);
    }

    async nextNonce(): Promise<string> {
        return "42";
    }

    async sign(preimage: string): Promise<string> {
        if (this.expectedPreimage) {
            expect(preimage).toBe(this.expectedPreimage);
        } else {
            expect(preimage).toContain("nonce: 42");
            expect(preimage).toContain(`scope: ${Constants.defaultWaasAuthScope}`);
        }
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

describe("RequestUtils", () => {
    it("builds wallet auth request vectors", () => {
        expect(RequestUtils.buildWalletRequestPreimage(
            "/CommitVerifier",
            "42",
            Constants.defaultWaasAuthScope,
            "{\"walletId\":\"wallet-id\"}",
        )).toBe(
            "POST /rpc/Wallet/CommitVerifier\n" +
            "nonce: 42\n" +
            `scope: ${Constants.defaultWaasAuthScope}\n\n` +
            "{\"walletId\":\"wallet-id\"}",
        );

        expect(RequestUtils.buildAuthorizationHeader(
            "webcrypto-secp256r1",
            Constants.defaultWaasAuthScope,
            `0x04${"11".repeat(64)}`,
            "42",
            `0x${"22".repeat(64)}`,
        )).toBe(
            `webcrypto-secp256r1 scope="${Constants.defaultWaasAuthScope}",cred="0x04${"11".repeat(64)}",nonce=42,sig="0x${"22".repeat(64)}"`,
        );
    });
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
            environment: {
                walletApiUrl: "https://wallet.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
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

    it("wraps local validation failures separately from request failures", async () => {
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            redirectAuthStorage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: "https://app.example/callback",
        })).rejects.toMatchObject({
            code: "OMS_VALIDATION_ERROR",
            operation: "wallet.completeOidcRedirectAuth",
            message: "OIDC callback URL is missing code or state",
        });
    });

    it("clears in-memory wallet state and signer state on sign-out", async () => {
        const signer = new MockSigner();
        const storage = new MemoryStorageManager();
        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
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

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111");

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

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: {
                walletApiUrl: "https://wallet.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
            },
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });
        (wallet as any).persistSession("wallet-id", "0x1111111111111111111111111111111111111111");

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

            if (url.endsWith("/TransactionStatus")) {
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

    it("can skip transaction status polling", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-1",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: false,
                    expiresAt: "2026-01-01T00:00:00Z",
                });
            }

            if (url.endsWith("/Execute")) {
                return jsonResponse({status: "pending"});
            }

            if (url.endsWith("/TransactionStatus")) {
                throw new Error("status polling should not run");
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
        (wallet as any).persistSession("wallet-id", "0x9999999999999999999999999999999999999999");

        const response = await wallet.sendTransaction({
            network: "polygon",
            to: "0x1111111111111111111111111111111111111111",
            value: 0n,
            waitForStatus: false,
        });

        expect(response).toEqual({
            txnId: "txn-1",
            status: TransactionStatus.Pending,
        });
    });

    it("exposes transaction status lookup by transaction id", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/TransactionStatus")) {
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
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        await expect(wallet.getTransactionStatus({txnId: "txn-1"})).resolves.toEqual({
            status: TransactionStatus.Executed,
            txnHash: "0xtx",
        });
    });

    it("classifies non-JSON wallet HTTP failures as retryable HTTP errors", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad Gateway</html>", {status: 502})));

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        await expect(wallet.startEmailAuth({email: "user@example.com"})).rejects.toMatchObject({
            code: "OMS_HTTP_ERROR",
            operation: "wallet.startEmailAuth",
            status: 502,
            retryable: true,
        });
    });

    it("wraps status polling failures with the transaction id", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-1",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: false,
                    expiresAt: "2026-01-01T00:00:00Z",
                });
            }

            if (url.endsWith("/Execute")) {
                return jsonResponse({status: "pending"});
            }

            if (url.endsWith("/TransactionStatus")) {
                throw new Error("status endpoint unavailable");
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
        (wallet as any).persistSession("wallet-id", "0x9999999999999999999999999999999999999999");

        await expect(wallet.sendTransaction({
            network: "polygon",
            to: "0x1111111111111111111111111111111111111111",
            value: 0n,
        })).rejects.toMatchObject({
            code: "OMS_TRANSACTION_STATUS_LOOKUP_FAILED",
            operation: "wallet.transactionStatus",
            txnId: "txn-1",
            retryable: true,
        });
    });

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

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        apiRpcUrl: "https://api.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
