import {describe, expect, it} from "vitest";

import {RequestUtils} from "../src/utils/requestUtils";

describe("RequestUtils", () => {
    it("builds wallet auth request vectors", () => {
        const projectId = "project-id";

        expect(RequestUtils.buildWalletRequestPreimage(
            "/CommitVerifier",
            "42",
            projectId,
            "{\"walletId\":\"wallet-id\"}",
        )).toBe(
            "POST /rpc/Wallet/CommitVerifier\n" +
            "nonce: 42\n" +
            `scope: ${projectId}\n\n` +
            "{\"walletId\":\"wallet-id\"}",
        );

        expect(RequestUtils.buildWalletSignatureHeader(
            "ecdsa-p256-sha256",
            projectId,
            `0x04${"11".repeat(64)}`,
            "42",
            `0x${"22".repeat(64)}`,
        )).toBe(
            `alg="ecdsa-p256-sha256", scope="${projectId}", cred="0x04${"11".repeat(64)}", nonce=42, sig="0x${"22".repeat(64)}"`,
        );
    });
});
