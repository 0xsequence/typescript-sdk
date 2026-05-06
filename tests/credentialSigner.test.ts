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
