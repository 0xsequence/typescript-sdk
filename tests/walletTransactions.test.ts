import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {TransactionStatus} from "../src/generated/waas.gen";
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

describe("WalletClient transactions", () => {
    it("prepares, enriches fee options, executes, and returns transaction status", async () => {
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

        const wallet = createWalletWithSession(
            storage,
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
            txnHash: "0xtx",
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

        const wallet = createWalletWithSession(
            new MemoryStorageManager(),
            "0x9999999999999999999999999999999999999999",
        );

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

        const wallet = createWalletWithSession(
            new MemoryStorageManager(),
            "0x9999999999999999999999999999999999999999",
        );

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

function createWalletWithSession(storage: MemoryStorageManager, walletAddress: string): WalletClient {
    const wallet = new WalletClient({
        projectAccessKey: "project-key",
        environment: testEnvironment(),
        storage,
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
