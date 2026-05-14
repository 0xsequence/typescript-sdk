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

describe("WalletClient errors", () => {
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

    it("maps consumed auth commitments to a specific SDK error code", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    code: 7008,
                    name: "CommitmentConsumed",
                    message: "The authentication commitment has already been used",
                    status: 400,
                }, 400);
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const wallet = new WalletClient({
            projectAccessKey: "project-key",
            environment: testEnvironment(),
            storage: new MemoryStorageManager(),
            credentialSigner: new MockSigner(),
        });

        await expect(wallet.completeEmailAuth({code: "123456"})).rejects.toMatchObject({
            code: "OMS_AUTH_COMMITMENT_CONSUMED",
            operation: "wallet.completeEmailAuth",
            status: 400,
            retryable: false,
        });
    });
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json"},
    });
}

function testEnvironment() {
    return {
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
    };
}
