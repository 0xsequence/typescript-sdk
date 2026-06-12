import {afterEach, describe, expect, it, vi} from "vitest";

import {
    LocalStorageManager,
    MemoryStorageManager,
    Networks,
    OMSClient,
    OmsRequestError,
    OmsSdkError,
    SessionStorageManager,
    WalletType,
    WebCryptoP256CredentialSigner,
    isOmsSdkError,
    type CredentialSigner,
} from "../src";

class MockSigner implements CredentialSigner {
    readonly signingAlgorithm = "ecdsa-p256-sha256";

    constructor(private credential = "0x04" + "11".repeat(64)) {}

    async credentialId(): Promise<string> {
        return this.credential;
    }

    setCredential(credential: string): void {
        this.credential = credential;
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

describe("public API error contracts", () => {
    it("snapshots WaaS transport failures with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new TypeError("fetch failed");
        }));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.wallet.startEmailAuth({email: "user@example.com"}),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_REQUEST_FAILED",
            "message": "request failed",
            "name": "OmsRequestError",
            "operation": "wallet.startEmailAuth",
            "retryable": true,
            "status": null,
            "txnId": null,
            "upstreamError": {
              "code": -1,
              "message": "request failed",
              "name": "WebrpcRequestFailed",
              "service": "waas",
              "status": null,
            },
          }
        `);
    });

    it("snapshots WaaS domain errors with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({verifier: "verifier-1", challenge: "challenge-1"});
            }
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

        const oms = createOmsClient();
        await oms.wallet.startEmailAuth({email: "user@example.com"});

        await expect(publicError(() =>
            oms.wallet.completeEmailAuth({code: "123456"}),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_AUTH_COMMITMENT_CONSUMED",
            "message": "The authentication commitment has already been used",
            "name": "OmsRequestError",
            "operation": "wallet.completeEmailAuth",
            "retryable": false,
            "status": 400,
            "txnId": null,
            "upstreamError": {
              "code": 7008,
              "message": "The authentication commitment has already been used",
              "name": "CommitmentConsumed",
              "service": "waas",
              "status": 400,
            },
          }
        `);
    });

    it("snapshots WaaS HTTP responses with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response("<html>Bad Gateway</html>", {
                status: 502,
                headers: {"Content-Type": "text/html"},
            }),
        ));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.wallet.startEmailAuth({email: "user@example.com"}),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_HTTP_ERROR",
            "message": "bad response",
            "name": "OmsRequestError",
            "operation": "wallet.startEmailAuth",
            "retryable": true,
            "status": 502,
            "txnId": null,
            "upstreamError": {
              "code": -5,
              "message": "bad response",
              "name": "WebrpcBadResponse",
              "service": "waas",
              "status": 502,
            },
          }
        `);
    });

    it("snapshots email auth completion local state errors", async () => {
        let resolveCompleteAuth: ((response: Response) => void) | undefined;
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({verifier: "verifier-1", challenge: "challenge-1"});
            }
            if (url.endsWith("/CompleteAuth")) {
                return new Promise<Response>(resolve => {
                    resolveCompleteAuth = resolve;
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const errors: Array<{label: string; error: SerializedError}> = [];
        errors.push({
            label: "wallet.completeEmailAuth.noPendingAuth",
            error: await publicError(() => createOmsClient().wallet.completeEmailAuth({code: "123456"})),
        });

        const oms = createOmsClient();
        await oms.wallet.startEmailAuth({email: "user@example.com"});
        const firstCompletion = oms.wallet.completeEmailAuth({code: "123456", walletSelection: "manual"});
        errors.push({
            label: "wallet.completeEmailAuth.inFlightMismatch",
            error: await publicError(() => oms.wallet.completeEmailAuth({code: "654321", walletSelection: "manual"})),
        });

        const resolve = await waitForValue(() => resolveCompleteAuth);
        resolve(jsonResponse(completeAuthResponse()));
        await firstCompletion;

        expect(errors).toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No pending email auth attempt",
                "name": "OmsSessionError",
                "operation": "wallet.completeEmailAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeEmailAuth.noPendingAuth",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "Email auth completion is already in flight",
                "name": "OmsSessionError",
                "operation": "wallet.completeEmailAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeEmailAuth.inFlightMismatch",
            },
          ]
        `);
    });

    it("snapshots pending wallet selection local state errors", async () => {
        let resolveUseWallet: ((response: Response) => void) | undefined;
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({verifier: "verifier-1", challenge: "challenge-1"});
            }
            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse(completeAuthResponse());
            }
            if (url.endsWith("/UseWallet")) {
                return new Promise<Response>(resolve => {
                    resolveUseWallet = resolve;
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const errors: Array<{label: string; error: SerializedError}> = [];

        const unavailableOms = createOmsClient();
        await unavailableOms.wallet.startEmailAuth({email: "user@example.com"});
        const unavailableSelection = await unavailableOms.wallet.completeEmailAuth({
            code: "123456",
            walletSelection: "manual",
        });
        errors.push({
            label: "wallet.pendingWalletSelection.selectWallet.unavailable",
            error: await publicError(() => unavailableSelection.selectWallet({walletId: "wallet-missing"})),
        });

        const staleOms = createOmsClient();
        await staleOms.wallet.startEmailAuth({email: "first@example.com"});
        const staleSelection = await staleOms.wallet.completeEmailAuth({
            code: "111111",
            walletSelection: "manual",
        });
        await staleOms.wallet.startEmailAuth({email: "second@example.com"});
        await staleOms.wallet.completeEmailAuth({
            code: "222222",
            walletSelection: "manual",
        });
        errors.push({
            label: "wallet.pendingWalletSelection.selectWallet.stale",
            error: await publicError(() => staleSelection.selectWallet({walletId: "wallet-1"})),
        });
        errors.push({
            label: "wallet.pendingWalletSelection.createAndSelectWallet.stale",
            error: await publicError(() => staleSelection.createAndSelectWallet({reference: "stale"})),
        });

        const inFlightOms = createOmsClient();
        await inFlightOms.wallet.startEmailAuth({email: "user@example.com"});
        const inFlightSelection = await inFlightOms.wallet.completeEmailAuth({
            code: "123456",
            walletSelection: "manual",
        });
        const firstSelection = inFlightSelection.selectWallet({walletId: "wallet-1"});
        errors.push({
            label: "wallet.pendingWalletSelection.selectWallet.inFlight",
            error: await publicError(() => inFlightSelection.selectWallet({walletId: "wallet-1"})),
        });
        errors.push({
            label: "wallet.pendingWalletSelection.createAndSelectWallet.inFlight",
            error: await publicError(() => inFlightSelection.createAndSelectWallet({reference: "fresh"})),
        });

        const resolve = await waitForValue(() => resolveUseWallet);
        resolve(jsonResponse({wallet: testWallet()}));
        await firstSelection;

        expect(errors).toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_WALLET_SELECTION_UNAVAILABLE",
                "message": "Selected wallet is not one of the available options",
                "name": "OmsWalletSelectionError",
                "operation": "wallet.pendingWalletSelection.selectWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.pendingWalletSelection.selectWallet.unavailable",
            },
            {
              "error": {
                "code": "OMS_WALLET_SELECTION_STALE",
                "message": "Pending wallet selection is no longer active",
                "name": "OmsWalletSelectionError",
                "operation": "wallet.pendingWalletSelection.selectWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.pendingWalletSelection.selectWallet.stale",
            },
            {
              "error": {
                "code": "OMS_WALLET_SELECTION_STALE",
                "message": "Pending wallet selection is no longer active",
                "name": "OmsWalletSelectionError",
                "operation": "wallet.pendingWalletSelection.createAndSelectWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.pendingWalletSelection.createAndSelectWallet.stale",
            },
            {
              "error": {
                "code": "OMS_WALLET_SELECTION_IN_FLIGHT",
                "message": "Pending wallet selection already has an action in flight",
                "name": "OmsWalletSelectionError",
                "operation": "wallet.pendingWalletSelection.selectWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.pendingWalletSelection.selectWallet.inFlight",
            },
            {
              "error": {
                "code": "OMS_WALLET_SELECTION_IN_FLIGHT",
                "message": "Pending wallet selection already has an action in flight",
                "name": "OmsWalletSelectionError",
                "operation": "wallet.pendingWalletSelection.createAndSelectWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.pendingWalletSelection.createAndSelectWallet.inFlight",
            },
          ]
        `);
    });

    it("snapshots SDK-local errors without upstream details", async () => {
        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.wallet.signMessage({network: Networks.polygon, message: "hello"}),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_SESSION_MISSING",
            "message": "No active wallet session",
            "name": "OmsSessionError",
            "operation": "wallet.signMessage",
            "retryable": null,
            "status": null,
            "txnId": null,
            "upstreamError": null,
          }
        `);
    });

    it("snapshots missing-session contracts for protected wallet methods", async () => {
        const oms = createOmsClient();

        await expect(publicErrors([
            ["wallet.listWallets", () => oms.wallet.listWallets()],
            ["wallet.useWallet", () => oms.wallet.useWallet({walletId: "wallet-1"})],
            ["wallet.createWallet", () => oms.wallet.createWallet()],
            ["wallet.getIdToken", () => oms.wallet.getIdToken()],
            ["wallet.signTypedData", () => oms.wallet.signTypedData({
                network: Networks.polygon,
                typedData: {message: "hello"},
            })],
            ["wallet.sendTransaction", () => oms.wallet.sendTransaction({
                network: Networks.polygon,
                to: "0x2222222222222222222222222222222222222222",
                value: 1n,
            })],
            ["wallet.callContract", () => oms.wallet.callContract({
                network: Networks.polygon,
                contractAddress: "0x2222222222222222222222222222222222222222",
                method: "transfer(address,uint256)",
                args: [
                    {type: "address", value: "0x3333333333333333333333333333333333333333"},
                    {type: "uint256", value: "1"},
                ],
            })],
            ["wallet.listAccess", () => oms.wallet.listAccess()],
            ["wallet.listAccessPages", () => iterateAccessPages(oms.wallet.listAccessPages())],
            ["wallet.revokeAccess", () => oms.wallet.revokeAccess({targetCredentialId: "credential-1"})],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No authenticated wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.listWallets",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.listWallets",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.useWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.useWallet",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.createWallet",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.createWallet",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.getIdToken",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.getIdToken",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.signTypedData",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.signTypedData",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.sendTransaction",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.sendTransaction",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.callContract",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.callContract",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.listAccess",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.listAccess",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.listAccessPages",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.listAccessPages",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "No active wallet session",
                "name": "OmsSessionError",
                "operation": "wallet.revokeAccess",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.revokeAccess",
            },
          ]
        `);
    });

    it("snapshots OIDC local error contracts without upstream details", async () => {
        const oms = createOmsClient();
        const omsWithoutRedirectStorage = createOmsClient({redirectAuthStorage: null});

        await expect(publicErrors([
            ["wallet.startOidcRedirectAuth.unknownProvider", () => oms.wallet.startOidcRedirectAuth({
                provider: "github",
                redirectUri: "https://app.example/auth/callback",
            })],
            ["wallet.startOidcRedirectAuth.missingRedirectStorage", () => omsWithoutRedirectStorage.wallet.startOidcRedirectAuth({
                provider: testOidcProvider(),
                redirectUri: "https://app.example/auth/callback",
            })],
            ["wallet.completeOidcRedirectAuth.missingCallbackParams", () => oms.wallet.completeOidcRedirectAuth({
                callbackUrl: "https://app.example/auth/callback",
            })],
            ["wallet.completeOidcRedirectAuth.providerError", () => oms.wallet.completeOidcRedirectAuth({
                callbackUrl: "https://app.example/auth/callback?error=access_denied&error_description=User%20cancelled",
            })],
            ["wallet.completeOidcRedirectAuth.noPendingAuth", () => oms.wallet.completeOidcRedirectAuth({
                callbackUrl: "https://app.example/auth/callback?code=code-1&state=state-1",
            })],
            ["wallet.completeOidcRedirectAuth.cleanUrlWithoutBrowser", () => oms.wallet.completeOidcRedirectAuth({
                callbackUrl: "https://app.example/auth/callback?code=code-1&state=state-1",
                cleanUrl: true,
            })],
            ["wallet.signInWithOidcRedirect.missingCurrentUrl", () => oms.wallet.signInWithOidcRedirect({
                provider: testOidcProvider(),
            })],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "OIDC provider "github" is not configured",
                "name": "OmsValidationError",
                "operation": "wallet.startOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.startOidcRedirectAuth.unknownProvider",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "OIDC redirect auth requires redirectAuthStorage or browser sessionStorage",
                "name": "OmsValidationError",
                "operation": "wallet.startOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.startOidcRedirectAuth.missingRedirectStorage",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "OIDC callback URL is missing code or state",
                "name": "OmsValidationError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.missingCallbackParams",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "User cancelled",
                "name": "OmsValidationError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.providerError",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "No pending OIDC redirect auth found",
                "name": "OmsValidationError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.noPendingAuth",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "cleanUrl requires replaceUrl or browser history support",
                "name": "OmsValidationError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.cleanUrlWithoutBrowser",
            },
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "signInWithOidcRedirect requires currentUrl outside a browser",
                "name": "OmsValidationError",
                "operation": "wallet.signInWithOidcRedirect",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.signInWithOidcRedirect.missingCurrentUrl",
            },
          ]
        `);
    });

    it("snapshots OIDC redirect real-flow local mismatch errors", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({verifier: "verifier-1", challenge: "challenge-1"});
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const errors: Array<{label: string; error: SerializedError}> = [];

        const nonceOms = createOmsClient({redirectAuthStorage: new MemoryStorageManager()});
        await nonceOms.wallet.startOidcRedirectAuth({
            provider: testOidcProvider(),
            redirectUri: "https://app.example/auth/callback",
        });
        errors.push({
            label: "wallet.completeOidcRedirectAuth.nonceMismatch",
            error: await publicError(() => nonceOms.wallet.completeOidcRedirectAuth({
                callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${encodeTestOidcState({
                    nonce: "bad-nonce",
                    scope: "project-id",
                })}`,
            })),
        });

        const signer = new MockSigner();
        const signerOms = createOmsClient({
            credentialSigner: signer,
            redirectAuthStorage: new MemoryStorageManager(),
        });
        const started = await signerOms.wallet.startOidcRedirectAuth({
            provider: testOidcProvider(),
            redirectUri: "https://app.example/auth/callback",
        });
        signer.setCredential("0x04" + "99".repeat(64));
        errors.push({
            label: "wallet.completeOidcRedirectAuth.signerMismatch",
            error: await publicError(() => signerOms.wallet.completeOidcRedirectAuth({
                callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${started.state}`,
            })),
        });

        expect(errors).toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_VALIDATION_ERROR",
                "message": "OIDC state nonce mismatch",
                "name": "OmsValidationError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.nonceMismatch",
            },
            {
              "error": {
                "code": "OMS_SESSION_MISSING",
                "message": "OIDC redirect auth signer mismatch",
                "name": "OmsSessionError",
                "operation": "wallet.completeOidcRedirectAuth",
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "wallet.completeOidcRedirectAuth.signerMismatch",
            },
          ]
        `);
    });

    it("snapshots signInWithOidcRedirect missing assignUrl after real redirect start", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({verifier: "verifier-1", challenge: "challenge-1"});
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.wallet.signInWithOidcRedirect({
                provider: testOidcProvider(),
                currentUrl: "https://app.example/login",
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_VALIDATION_ERROR",
            "message": "signInWithOidcRedirect requires assignUrl outside a browser",
            "name": "OmsValidationError",
            "operation": "wallet.signInWithOidcRedirect",
            "retryable": null,
            "status": null,
            "txnId": null,
            "upstreamError": null,
          }
        `);
    });

    it("snapshots signature validation backend failures with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new TypeError("fetch failed");
        }));

        const oms = createOmsClientWithSession();

        await expect(publicErrors([
            ["wallet.isValidMessageSignature", () => oms.wallet.isValidMessageSignature({
                network: Networks.polygon,
                message: "hello",
                signature: "0xmessage",
            })],
            ["wallet.isValidTypedDataSignature", () => oms.wallet.isValidTypedDataSignature({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
                typedData: {
                    domain: {name: "Test", chainId: 137n},
                    types: {Message: [{name: "contents", type: "string"}]},
                    message: {contents: "hello"},
                    primaryType: "Message",
                },
                signature: "0xtyped",
            })],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "request failed",
                "name": "OmsRequestError",
                "operation": "wallet.isValidMessageSignature",
                "retryable": true,
                "status": null,
                "txnId": null,
                "upstreamError": {
                  "code": -1,
                  "message": "request failed",
                  "name": "WebrpcRequestFailed",
                  "service": "waas",
                  "status": null,
                },
              },
              "label": "wallet.isValidMessageSignature",
            },
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "request failed",
                "name": "OmsRequestError",
                "operation": "wallet.isValidTypedDataSignature",
                "retryable": true,
                "status": null,
                "txnId": null,
                "upstreamError": {
                  "code": -1,
                  "message": "request failed",
                  "name": "WebrpcRequestFailed",
                  "service": "waas",
                  "status": null,
                },
              },
              "label": "wallet.isValidTypedDataSignature",
            },
          ]
        `);
    });

    it("snapshots direct transaction status backend errors with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/TransactionStatus")) {
                return jsonResponse({
                    code: 7308,
                    name: "TransactionNotFound",
                    message: "Transaction not found",
                    status: 404,
                }, 404);
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.wallet.getTransactionStatus({txnId: "txn-missing"}),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_REQUEST_FAILED",
            "message": "Transaction not found",
            "name": "OmsRequestError",
            "operation": "wallet.getTransactionStatus",
            "retryable": false,
            "status": 404,
            "txnId": null,
            "upstreamError": {
              "code": 7308,
              "message": "Transaction not found",
              "name": "TransactionNotFound",
              "service": "waas",
              "status": 404,
            },
          }
        `);
    });

    it("snapshots transaction local validation errors without upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-no-fee-options",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: false,
                    expiresAt: "2099-01-01T00:00:00Z",
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClientWithSession();

        await expect(publicError(() =>
            oms.wallet.sendTransaction({
                network: Networks.polygon,
                to: "0x1111111111111111111111111111111111111111",
                value: 0n,
                waitForStatus: false,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_VALIDATION_ERROR",
            "message": "No fee options available for unsponsored transaction",
            "name": "OmsValidationError",
            "operation": "wallet.sendTransaction",
            "retryable": null,
            "status": null,
            "txnId": null,
            "upstreamError": null,
          }
        `);
    });

    it("snapshots transaction execute failures as unconfirmed writes", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-execute",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: true,
                    expiresAt: "2099-01-01T00:00:00Z",
                });
            }
            if (url.endsWith("/Execute")) {
                throw new TypeError("fetch failed");
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClientWithSession();

        await expect(publicError(() =>
            oms.wallet.sendTransaction({
                network: Networks.polygon,
                to: "0x1111111111111111111111111111111111111111",
                value: 0n,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_TRANSACTION_EXECUTION_UNCONFIRMED",
            "message": "Transaction execution failed before status could be confirmed",
            "name": "OmsTransactionError",
            "operation": "wallet.execute",
            "retryable": false,
            "status": null,
            "txnId": "txn-execute",
            "upstreamError": {
              "code": -1,
              "message": "request failed",
              "name": "WebrpcRequestFailed",
              "service": "waas",
              "status": null,
            },
          }
        `);
    });

    it("snapshots transaction status polling failures with txn and upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-1",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: true,
                    expiresAt: "2099-01-01T00:00:00Z",
                });
            }
            if (url.endsWith("/Execute")) {
                return jsonResponse({status: "pending"});
            }
            if (url.endsWith("/TransactionStatus")) {
                throw new TypeError("fetch failed");
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClientWithSession();

        await expect(publicError(() =>
            oms.wallet.sendTransaction({
                network: Networks.polygon,
                to: "0x1111111111111111111111111111111111111111",
                value: 0n,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_TRANSACTION_STATUS_LOOKUP_FAILED",
            "message": "Transaction was submitted, but status polling failed",
            "name": "OmsTransactionError",
            "operation": "wallet.transactionStatus",
            "retryable": true,
            "status": null,
            "txnId": "txn-1",
            "upstreamError": {
              "code": -1,
              "message": "request failed",
              "name": "WebrpcRequestFailed",
              "service": "waas",
              "status": null,
            },
          }
        `);
    });

    it("snapshots transaction status polling backend errors as retryable", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/PrepareEthereumTransaction")) {
                return jsonResponse({
                    txnId: "txn-404",
                    status: "quoted",
                    feeOptions: [],
                    sponsored: true,
                    expiresAt: "2099-01-01T00:00:00Z",
                });
            }
            if (url.endsWith("/Execute")) {
                return jsonResponse({status: "pending"});
            }
            if (url.endsWith("/TransactionStatus")) {
                return jsonResponse({
                    code: 7308,
                    name: "TransactionNotFound",
                    message: "Transaction not found",
                    status: 404,
                }, 404);
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClientWithSession();

        await expect(publicError(() =>
            oms.wallet.sendTransaction({
                network: Networks.polygon,
                to: "0x1111111111111111111111111111111111111111",
                value: 0n,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_TRANSACTION_STATUS_LOOKUP_FAILED",
            "message": "Transaction was submitted, but status polling failed",
            "name": "OmsTransactionError",
            "operation": "wallet.transactionStatus",
            "retryable": true,
            "status": 404,
            "txnId": "txn-404",
            "upstreamError": {
              "code": 7308,
              "message": "Transaction not found",
              "name": "TransactionNotFound",
              "service": "waas",
              "status": 404,
            },
          }
        `);
    });

    it("snapshots access backend errors with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/ListAccess") || url.endsWith("/RevokeAccess")) {
                return jsonResponse({
                    code: 7207,
                    name: "Unauthorized",
                    message: "Unauthorized",
                    status: 401,
                }, 401);
            }

            throw new Error(`Unexpected request: ${url}`);
        }));

        const oms = createOmsClientWithSession();

        await expect(publicErrors([
            ["wallet.listAccess", () => oms.wallet.listAccess()],
            ["wallet.listAccessPages", () => iterateAccessPages(oms.wallet.listAccessPages())],
            ["wallet.revokeAccess", () => oms.wallet.revokeAccess({targetCredentialId: "credential-1"})],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "Unauthorized",
                "name": "OmsRequestError",
                "operation": "wallet.listAccess",
                "retryable": false,
                "status": 401,
                "txnId": null,
                "upstreamError": {
                  "code": 7207,
                  "message": "Unauthorized",
                  "name": "Unauthorized",
                  "service": "waas",
                  "status": 401,
                },
              },
              "label": "wallet.listAccess",
            },
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "Unauthorized",
                "name": "OmsRequestError",
                "operation": "wallet.listAccessPages",
                "retryable": false,
                "status": 401,
                "txnId": null,
                "upstreamError": {
                  "code": 7207,
                  "message": "Unauthorized",
                  "name": "Unauthorized",
                  "service": "waas",
                  "status": 401,
                },
              },
              "label": "wallet.listAccessPages",
            },
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "Unauthorized",
                "name": "OmsRequestError",
                "operation": "wallet.revokeAccess",
                "retryable": false,
                "status": 401,
                "txnId": null,
                "upstreamError": {
                  "code": 7207,
                  "message": "Unauthorized",
                  "name": "Unauthorized",
                  "service": "waas",
                  "status": 401,
                },
              },
              "label": "wallet.revokeAccess",
            },
          ]
        `);
    });

    it("snapshots indexer backend errors with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            error: "Unavailable",
            code: "INDEXER_UNAVAILABLE",
            message: "Indexer is unavailable",
        }, 503)));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.indexer.getTokenBalances({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
                includeMetadata: false,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_HTTP_ERROR",
            "message": "Indexer is unavailable",
            "name": "OmsRequestError",
            "operation": "indexer.getTokenBalances",
            "retryable": true,
            "status": 503,
            "txnId": null,
            "upstreamError": {
              "code": "INDEXER_UNAVAILABLE",
              "message": "Indexer is unavailable",
              "name": "Unavailable",
              "service": "indexer",
              "status": 503,
            },
          }
        `);
    });

    it("snapshots indexer non-JSON HTTP errors without raw upstream bodies", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            new Response("<html>Bad Gateway</html>", {
                status: 502,
                headers: {"Content-Type": "text/html"},
            }),
        ));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.indexer.getTokenBalances({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
                includeMetadata: false,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_HTTP_ERROR",
            "message": "indexer.getTokenBalances failed with HTTP 502",
            "name": "OmsRequestError",
            "operation": "indexer.getTokenBalances",
            "retryable": true,
            "status": 502,
            "txnId": null,
            "upstreamError": {
              "code": null,
              "message": "indexer.getTokenBalances failed with HTTP 502",
              "name": null,
              "service": "indexer",
              "status": 502,
            },
          }
        `);
    });

    it("snapshots native balance indexer errors with upstream details", async () => {
        let callCount = 0;
        vi.stubGlobal("fetch", vi.fn(async () => {
            callCount += 1;
            if (callCount === 1) {
                return jsonResponse({
                    error: "Unavailable",
                    code: "INDEXER_UNAVAILABLE",
                    message: "Indexer is unavailable",
                }, 503);
            }
            if (callCount === 2) {
                throw new TypeError("fetch failed");
            }
            return new Response("not-json", {status: 200});
        }));

        const oms = createOmsClient();

        await expect(publicErrors([
            ["indexer.getNativeTokenBalance.http", () => oms.indexer.getNativeTokenBalance({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
            })],
            ["indexer.getNativeTokenBalance.transport", () => oms.indexer.getNativeTokenBalance({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
            })],
            ["indexer.getNativeTokenBalance.malformed", () => oms.indexer.getNativeTokenBalance({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
            })],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": "OMS_HTTP_ERROR",
                "message": "Indexer is unavailable",
                "name": "OmsRequestError",
                "operation": "indexer.getNativeTokenBalance",
                "retryable": true,
                "status": 503,
                "txnId": null,
                "upstreamError": {
                  "code": "INDEXER_UNAVAILABLE",
                  "message": "Indexer is unavailable",
                  "name": "Unavailable",
                  "service": "indexer",
                  "status": 503,
                },
              },
              "label": "indexer.getNativeTokenBalance.http",
            },
            {
              "error": {
                "code": "OMS_REQUEST_FAILED",
                "message": "fetch failed",
                "name": "OmsRequestError",
                "operation": "indexer.getNativeTokenBalance",
                "retryable": true,
                "status": null,
                "txnId": null,
                "upstreamError": {
                  "code": null,
                  "message": "fetch failed",
                  "name": "TypeError",
                  "service": "indexer",
                  "status": null,
                },
              },
              "label": "indexer.getNativeTokenBalance.transport",
            },
            {
              "error": {
                "code": "OMS_INVALID_RESPONSE",
                "message": "Invalid JSON response from indexer.getNativeTokenBalance",
                "name": "OmsResponseError",
                "operation": "indexer.getNativeTokenBalance",
                "retryable": null,
                "status": 200,
                "txnId": null,
                "upstreamError": {
                  "code": null,
                  "message": "Invalid JSON response from indexer.getNativeTokenBalance",
                  "name": null,
                  "service": "indexer",
                  "status": 200,
                },
              },
              "label": "indexer.getNativeTokenBalance.malformed",
            },
          ]
        `);
    });

    it("snapshots indexer transport failures with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new TypeError("fetch failed");
        }));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.indexer.getTokenBalances({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
                includeMetadata: false,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_REQUEST_FAILED",
            "message": "fetch failed",
            "name": "OmsRequestError",
            "operation": "indexer.getTokenBalances",
            "retryable": true,
            "status": null,
            "txnId": null,
            "upstreamError": {
              "code": null,
              "message": "fetch failed",
              "name": "TypeError",
              "service": "indexer",
              "status": null,
            },
          }
        `);
    });

    it("snapshots indexer malformed response errors with upstream details", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", {status: 200})));

        const oms = createOmsClient();

        await expect(publicError(() =>
            oms.indexer.getTokenBalances({
                network: Networks.polygon,
                walletAddress: "0x9999999999999999999999999999999999999999",
                includeMetadata: false,
            }),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": "OMS_INVALID_RESPONSE",
            "message": "Invalid JSON response from indexer.getTokenBalances",
            "name": "OmsResponseError",
            "operation": "indexer.getTokenBalances",
            "retryable": null,
            "status": 200,
            "txnId": null,
            "upstreamError": {
              "code": null,
              "message": "Invalid JSON response from indexer.getTokenBalances",
              "name": null,
              "service": "indexer",
              "status": 200,
            },
          }
        `);
    });

    it("snapshots exported storage and signer runtime errors", async () => {
        vi.stubGlobal("localStorage", undefined);
        vi.stubGlobal("sessionStorage", undefined);

        await expect(publicErrors([
            ["LocalStorageManager.get", () => Promise.resolve(new LocalStorageManager().get("key"))],
            ["SessionStorageManager.get", () => Promise.resolve(new SessionStorageManager().get("key"))],
        ])).resolves.toMatchInlineSnapshot(`
          [
            {
              "error": {
                "code": null,
                "message": "LocalStorageManager requires globalThis.localStorage",
                "name": "Error",
                "operation": null,
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "LocalStorageManager.get",
            },
            {
              "error": {
                "code": null,
                "message": "SessionStorageManager requires globalThis.sessionStorage",
                "name": "Error",
                "operation": null,
                "retryable": null,
                "status": null,
                "txnId": null,
                "upstreamError": null,
              },
              "label": "SessionStorageManager.get",
            },
          ]
        `);

        vi.stubGlobal("crypto", undefined);
        await expect(publicError(() =>
            new WebCryptoP256CredentialSigner().credentialId(),
        )).resolves.toMatchInlineSnapshot(`
          {
            "code": null,
            "message": "WebCrypto SubtleCrypto is required for the default OMS credential signer",
            "name": "Error",
            "operation": null,
            "retryable": null,
            "status": null,
            "txnId": null,
            "upstreamError": null,
          }
        `);
    });

    it("snapshots exported error helper and subclass fields", () => {
        const error = new OmsRequestError({
            code: "OMS_HTTP_ERROR",
            operation: "wallet.startEmailAuth",
            message: "bad gateway",
            status: 502,
            retryable: true,
            upstreamError: {
                service: "waas",
                name: "WebrpcBadResponse",
                code: -5,
                message: "bad response",
                status: 502,
            },
        });

        expect(isOmsSdkError(error)).toBe(true);
        expect(isOmsSdkError(new Error("plain"))).toBe(false);
        expect(error).toBeInstanceOf(OmsSdkError);
        expect(serializeError(error)).toMatchInlineSnapshot(`
          {
            "code": "OMS_HTTP_ERROR",
            "message": "bad gateway",
            "name": "OmsRequestError",
            "operation": "wallet.startEmailAuth",
            "retryable": true,
            "status": 502,
            "txnId": null,
            "upstreamError": {
              "code": -5,
              "message": "bad response",
              "name": "WebrpcBadResponse",
              "service": "waas",
              "status": 502,
            },
          }
        `);
    });
});

async function publicError(action: () => Promise<unknown>): Promise<SerializedError> {
    try {
        await action();
    } catch (error) {
        return serializeError(error);
    }

    throw new Error("Expected public API call to reject");
}

async function publicErrors(
    cases: Array<[label: string, action: () => Promise<unknown>]>,
): Promise<Array<{label: string; error: SerializedError}>> {
    const errors: Array<{label: string; error: SerializedError}> = [];
    for (const [label, action] of cases) {
        errors.push({
            label,
            error: await publicError(action),
        });
    }
    return errors;
}

async function iterateAccessPages(pages: AsyncIterable<unknown>): Promise<void> {
    for await (const _page of pages) {
        return;
    }
}

async function waitForValue<T>(read: () => T | undefined): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const value = read();
        if (value !== undefined) {
            return value;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    throw new Error("Timed out waiting for async test fixture");
}

function serializeError(error: unknown): SerializedError {
    const value = error as {
        name?: unknown
        code?: unknown
        operation?: unknown
        status?: unknown
        retryable?: unknown
        txnId?: unknown
        upstreamError?: unknown
    };
    return {
        name: error instanceof Error ? error.name : stringOrNull(value.name),
        code: stringOrNull(value.code),
        operation: stringOrNull(value.operation),
        message: error instanceof Error ? error.message : String(error),
        status: numberOrNull(value.status),
        retryable: booleanOrNull(value.retryable),
        txnId: stringOrNull(value.txnId),
        upstreamError: serializeUpstreamError(value.upstreamError),
    };
}

function serializeUpstreamError(error: unknown): SerializedUpstreamError | null {
    if (!error || typeof error !== "object") {
        return null;
    }

    const value = error as {
        service?: unknown
        name?: unknown
        code?: unknown
        message?: unknown
        status?: unknown
    };
    return {
        service: stringOrNull(value.service),
        name: stringOrNull(value.name),
        code: numberOrStringOrNull(value.code),
        message: stringOrNull(value.message),
        status: numberOrNull(value.status),
    };
}

function createOmsClient(params: {
    credentialSigner?: CredentialSigner
    redirectAuthStorage?: MemoryStorageManager | null
} = {}): OMSClient {
    const clientParams: ConstructorParameters<typeof OMSClient>[0] = {
        publishableKey: "publishable-key",
        projectId: "project-id",
        storage: new MemoryStorageManager(),
        credentialSigner: params.credentialSigner ?? new MockSigner(),
        environment: {
            walletApiUrl: "https://wallet.example",
            indexerUrlTemplate: "https://indexer.example/{value}",
        },
    };

    if (params.redirectAuthStorage !== null) {
        clientParams.redirectAuthStorage = params.redirectAuthStorage ?? new MemoryStorageManager();
    }

    return new OMSClient(clientParams);
}

function createOmsClientWithSession(): OMSClient {
    const oms = createOmsClient();
    (oms.wallet as any).persistSession(
        "wallet-id",
        "0x9999999999999999999999999999999999999999",
    );
    return oms;
}

function testOidcProvider() {
    return {
        clientId: "client-id",
        issuer: "https://issuer.example",
        authorizationUrl: "https://issuer.example/oauth/authorize",
    };
}

function completeAuthResponse() {
    return {
        identity: {type: "email", sub: "user@example.com"},
        wallets: [testWallet()],
        credential: testCredential(),
        email: "user@example.com",
    };
}

function testWallet(id = "wallet-1", addressByte = "11") {
    return {
        id,
        type: WalletType.Ethereum,
        address: `0x${addressByte.repeat(20)}`,
    };
}

function testCredential() {
    return {
        credentialId: "0x04" + "11".repeat(64),
        expiresAt: "2099-01-01T00:00:00Z",
        isCaller: true,
    };
}

function encodeTestOidcState(payload: {nonce: string; scope: string; redirect_uri?: string}): string {
    let binary = "";
    for (const byte of new TextEncoder().encode(JSON.stringify(payload))) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json"},
    });
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function numberOrStringOrNull(value: unknown): number | string | null {
    return typeof value === "number" || typeof value === "string" ? value : null;
}

interface SerializedError {
    name: string | null
    code: string | null
    operation: string | null
    message: string
    status: number | null
    retryable: boolean | null
    txnId: string | null
    upstreamError: SerializedUpstreamError | null
}

interface SerializedUpstreamError {
    service: string | null
    name: string | null
    code: number | string | null
    message: string | null
    status: number | null
}
