import {afterEach, describe, expect, it, vi} from "vitest";

import type {CredentialSigner} from "../src/credentialSigner";
import {createSignedFetch} from "../src/signedFetch";

class RecordingSigner implements CredentialSigner {
    readonly signingAlgorithm = "ecdsa-p256-sha256";
    readonly preimages: string[] = [];

    async credentialId(): Promise<string> {
        return `0x04${"11".repeat(64)}`;
    }

    async nextNonce(): Promise<string> {
        return "42";
    }

    async sign(preimage: string): Promise<string> {
        this.preimages.push(preimage);
        return `0x${"22".repeat(64)}`;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("wallet request signing", () => {
    it("signs wallet RPC requests with the canonical preimage and signature header", async () => {
        const body = "{\"walletId\":\"wallet-id\"}";
        const signer = new RecordingSigner();
        const fetchMock = vi.fn(async () => new Response("{}", {status: 200}));
        vi.stubGlobal("fetch", fetchMock);

        const signedFetch = createSignedFetch("publishable-key", signer, "project-id");
        await signedFetch("https://wallet.example/rpc/Wallet/CommitVerifier", {
            method: "POST",
            body,
        });

        expect(signer.preimages).toEqual([
            "POST /rpc/Wallet/CommitVerifier\n" +
            "nonce: 42\n" +
            "scope: project-id\n\n" +
            body,
        ]);

        const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
        expect(headers).toMatchObject({
            "X-Access-Key": "publishable-key",
            "OMS-Wallet-Signature": `alg="ecdsa-p256-sha256", scope="project-id", cred="0x04${"11".repeat(64)}", nonce=42, sig="0x${"22".repeat(64)}"`,
        });
    });
});
