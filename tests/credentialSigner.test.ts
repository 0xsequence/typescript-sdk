import {describe, expect, it} from "vitest";

import {Constants} from "../src/utils/constants";
import {RequestUtils} from "../src/utils/requestUtils";

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

        expect(RequestUtils.buildWalletSignatureHeader(
            "ecdsa-p256-sha256",
            Constants.defaultWaasAuthScope,
            `0x04${"11".repeat(64)}`,
            "42",
            `0x${"22".repeat(64)}`,
        )).toBe(
            `alg="ecdsa-p256-sha256", scope="${Constants.defaultWaasAuthScope}", cred="0x04${"11".repeat(64)}", nonce=42, sig="0x${"22".repeat(64)}"`,
        );
    });
});
