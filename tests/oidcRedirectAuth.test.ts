import {afterEach, describe, expect, it, vi} from "vitest";

import {WalletClient} from "../src/clients/walletClient";
import type {CredentialSigner} from "../src/credentialSigner";
import {defineOmsEnvironment, type OidcProviderConfig, type OmsEnvironment} from "../src/omsEnvironment";
import {googleOidcProvider} from "../src/oidc";
import {MemoryStorageManager} from "../src/storageManager";
import {WalletType} from "../src/generated/waas.gen";
import {Constants} from "../src/utils/constants";
import {
    decodeOidcState,
    encodeOidcState,
    redirectUriFromCurrentUrl,
} from "../src/utils/oidcRedirect";

const expectedDefaultGoogleClientId = "970987756660-0dh5gubqfiugm452raf7mm39qaq639hn.apps.googleusercontent.com";
const expectedDefaultRelayRedirectUri = "https://waas-cf-relay-staging.0xsequence.workers.dev/callback";

class MockSigner implements CredentialSigner {
    readonly signingAlgorithm = "ecdsa-p256-sha256";
    readonly preimages: string[] = [];

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

    async sign(preimage: string): Promise<string> {
        this.preimages.push(preimage);
        return "0x" + "22".repeat(64);
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("WalletClient OIDC redirect auth", () => {
    it("starts a direct OIDC redirect flow", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            expect(url).toBe("https://wallet.example/rpc/Wallet/CommitVerifier");
            expect(body).toMatchObject({
                identityType: "oidc",
                authMode: "auth-code-pkce",
                metadata: {
                    iss: "https://accounts.google.com",
                    aud: "google-client",
                    redirect_uri: expectedDefaultRelayRedirectUri,
                },
            });

            return jsonResponse({
                verifier: "verifier-1",
                challenge: "challenge-1",
                loginHint: "user@example.com",
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const redirectAuthStorage = new MemoryStorageManager();
        const wallet = createWalletClient({redirectAuthStorage});

        const result = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });

        const authorizeUrl = new URL(result.url);
        expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        expect(authorizeUrl.searchParams.get("client_id")).toBe("google-client");
        expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(expectedDefaultRelayRedirectUri);
        expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
        expect(authorizeUrl.searchParams.get("scope")).toBe("openid email profile");
        expect(authorizeUrl.searchParams.get("state")).toBe(result.state);
        expect(authorizeUrl.searchParams.get("code_challenge")).toBe("challenge-1");
        expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorizeUrl.searchParams.get("login_hint")).toBe("user@example.com");

        const state = decodeOidcState(result.state);
        expect(state.scope).toBe("project-id");
        expect(state.redirect_uri).toBe("https://app.example/auth/callback");
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toContain("verifier-1");
    });

    it("starts a relay OIDC redirect flow with final redirect_uri in state", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(init?.body as string);
            expect(body.metadata.redirect_uri).toBe("http://localhost:8090/callback");
            return jsonResponse({
                verifier: "verifier-1",
                challenge: "challenge-1",
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
        });

        const result = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "http://localhost:5173/auth/callback",
            relayRedirectUri: "http://localhost:8090/callback",
        });

        const authorizeUrl = new URL(result.url);
        expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("http://localhost:8090/callback");

        const state = decodeOidcState(result.state);
        expect(state.redirect_uri).toBe("http://localhost:5173/auth/callback");
    });

    it("uses provider relay defaults and project ID in headers and state", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const headers = init?.headers as Record<string, string>;
            expect(headers["OMS-Wallet-Signature"]).toContain('scope="proj_custom"');
            expect(headers.Authorization).toBeUndefined();
            const body = JSON.parse(init?.body as string);
            expect(body.metadata.redirect_uri).toBe("https://relay.example/callback");
            return jsonResponse({
                verifier: "verifier-1",
                challenge: "challenge-1",
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const signer = new MockSigner();
        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
            credentialSigner: signer,
            projectId: "proj_custom",
            environment: defineOmsEnvironment({
                walletApiUrl: "https://wallet.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
                auth: {
                    oidcProviders: {
                        google: googleOidcProvider({
                            clientId: "google-client",
                            relayRedirectUri: "https://relay.example/callback",
                        }),
                    },
                },
            }),
        });

        const result = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });

        const authorizeUrl = new URL(result.url);
        expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("https://relay.example/callback");

        const state = decodeOidcState(result.state);
        expect(state.scope).toBe("proj_custom");
        expect(state.redirect_uri).toBe("https://app.example/auth/callback");
        expect(signer.preimages).toHaveLength(1);
    });

    it("supports direct provider config objects", async () => {
        const provider: OidcProviderConfig = {
            clientId: "custom-client",
            issuer: "https://issuer.example",
            authorizationUrl: "https://issuer.example/oauth/authorize",
            scopes: ["openid", "profile"],
        };
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(init?.body as string);
            expect(body.metadata).toEqual({
                iss: "https://issuer.example",
                aud: "custom-client",
                redirect_uri: "https://app.example/callback",
            });
            return jsonResponse({
                verifier: "verifier-1",
                challenge: "challenge-1",
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
        });

        const result = await wallet.startOidcRedirectAuth({
            provider,
            redirectUri: "https://app.example/callback",
        });

        const authorizeUrl = new URL(result.url);
        expect(authorizeUrl.origin + authorizeUrl.pathname).toBe("https://issuer.example/oauth/authorize");
        expect(authorizeUrl.searchParams.get("client_id")).toBe("custom-client");
        expect(authorizeUrl.searchParams.get("scope")).toBe("openid profile");
    });

    it("uses Google provider defaults", () => {
        expect(googleOidcProvider()).toMatchObject({
            clientId: expectedDefaultGoogleClientId,
            relayRedirectUri: expectedDefaultRelayRedirectUri,
            issuer: "https://accounts.google.com",
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            scopes: ["openid", "email", "profile"],
        });
    });

    it("merges provider and method authorize params with method params taking precedence", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            verifier: "verifier-1",
            challenge: "challenge-1",
        })));
        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
            environment: defineOmsEnvironment({
                walletApiUrl: "https://wallet.example",
                indexerUrlTemplate: "https://indexer.example/{value}",
                auth: {
                    oidcProviders: {
                        custom: {
                            clientId: "custom-client",
                            issuer: "https://issuer.example",
                            authorizationUrl: "https://issuer.example/oauth/authorize",
                            authorizeParams: {
                                access_type: "offline",
                                prompt: "consent",
                            },
                        },
                    },
                },
            }),
        });

        const result = await wallet.startOidcRedirectAuth({
            provider: "custom",
            redirectUri: "https://app.example/callback",
            authorizeParams: {
                prompt: "select_account",
                audience: "wallet",
            },
        });

        const authorizeUrl = new URL(result.url);
        expect(authorizeUrl.searchParams.get("access_type")).toBe("offline");
        expect(authorizeUrl.searchParams.get("prompt")).toBe("select_account");
        expect(authorizeUrl.searchParams.get("audience")).toBe("wallet");
    });

    it("completes an OIDC callback, activates a wallet, cleans the URL, and clears pending state", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }

            if (url.endsWith("/CompleteAuth")) {
                expect(body).toEqual({
                    identityType: "oidc",
                    authMode: "auth-code-pkce",
                    verifier: "verifier-1",
                    answer: "auth-code",
                    lifetime: 604_800,
                });
                return jsonResponse({
                    identity: {type: "oidc", iss: "https://accounts.google.com", sub: "user-1"},
                    wallets: [{
                        id: "wallet-id",
                        type: WalletType.Ethereum,
                        address: "0x1111111111111111111111111111111111111111",
                    }],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet")) {
                expect(body).toEqual({walletId: "wallet-id"});
                return jsonResponse({
                    wallet: {
                        id: "wallet-id",
                        type: WalletType.Ethereum,
                        address: "0x1111111111111111111111111111111111111111",
                    },
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({redirectAuthStorage});
        const started = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });
        const replaceUrl = vi.fn();

        const completed = await wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${started.state}&scope=openid&prompt=consent`,
            cleanUrl: true,
            replaceUrl,
        });

        expect(completed.walletAddress).toBe("0x1111111111111111111111111111111111111111");
        expect(completed.credential).toEqual(testCredential());
        expect(wallet.walletAddress).toBe("0x1111111111111111111111111111111111111111");
        expect(wallet.session).toEqual({
            walletAddress: "0x1111111111111111111111111111111111111111",
            expiresAt: "2026-01-01T00:00:00Z",
            loginType: "google-auth",
            sessionEmail: undefined,
        });
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
        expect(replaceUrl).toHaveBeenCalledWith("https://app.example/auth/callback");
    });

    it("can complete an OIDC callback with a pending wallet selection", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const otherType = "future-wallet" as WalletType;
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }

            if (url.endsWith("/CompleteAuth")) {
                expect(body).toEqual({
                    identityType: "oidc",
                    authMode: "auth-code-pkce",
                    verifier: "verifier-1",
                    answer: "auth-code",
                    lifetime: 604_800,
                });
                return jsonResponse({
                    identity: {type: "oidc", iss: "https://accounts.google.com", sub: "user-1"},
                    wallets: [
                        {
                            id: "wallet-id",
                            type: WalletType.Ethereum,
                            address: "0x1111111111111111111111111111111111111111",
                        },
                        {
                            id: "wallet-other",
                            type: otherType,
                            address: "0x2222222222222222222222222222222222222222",
                        },
                    ],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/UseWallet") || url.endsWith("/CreateWallet")) {
                throw new Error("OIDC manual auth should not activate a wallet");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({redirectAuthStorage});
        const started = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });

        const selection = await wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${started.state}`,
            walletSelection: "manual",
        });

        expect(selection).toMatchObject({
            walletType: WalletType.Ethereum,
            wallets: [{
                id: "wallet-id",
                type: WalletType.Ethereum,
                address: "0x1111111111111111111111111111111111111111",
            }],
            credential: testCredential(),
        });
        expect(selection.selectWallet).toEqual(expect.any(Function));
        expect(selection.createAndSelectWallet).toEqual(expect.any(Function));
        expect(wallet.walletAddress).toBeUndefined();
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
    });

    it("rejects OIDC callbacks when the signer changed after starting redirect auth", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }

            if (url.endsWith("/CompleteAuth")) {
                throw new Error("CompleteAuth should not be called after signer mismatch");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const signer = new MockSigner();
        const wallet = createWalletClient({redirectAuthStorage, credentialSigner: signer});
        const started = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });
        signer.setCredential("0x04" + "99".repeat(64));

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${started.state}`,
        })).rejects.toMatchObject({
            code: "OMS_SESSION_MISSING",
            message: "OIDC redirect auth signer mismatch",
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
    });

    it("cleans the callback URL when OIDC completion fails", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();

            if (url.endsWith("/CommitVerifier")) {
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }

            if (url.endsWith("/CompleteAuth")) {
                throw new Error("network failed");
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({redirectAuthStorage});
        const started = await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });
        const replaceUrl = vi.fn();

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${started.state}`,
            cleanUrl: true,
            replaceUrl,
        })).rejects.toThrow("request failed");

        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
        expect(replaceUrl).toHaveBeenCalledWith("https://app.example/auth/callback");
    });

    it("rejects nonce mismatches and clears pending state", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const fetchMock = vi.fn(async () => jsonResponse({
            verifier: "verifier-1",
            challenge: "challenge-1",
        }));
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({redirectAuthStorage});
        await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });
        const badState = encodeOidcState({
            nonce: "bad-nonce",
            scope: "project-id",
        });

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${badState}`,
        })).rejects.toThrow("OIDC state nonce mismatch");
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses browser sessionStorage as the default transient redirect auth storage", async () => {
        const sessionStore = new Map<string, string>();
        vi.stubGlobal("sessionStorage", {
            getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => sessionStore.set(key, value)),
            removeItem: vi.fn((key: string) => sessionStore.delete(key)),
        });
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            verifier: "verifier-1",
            challenge: "challenge-1",
        })));

        const wallet = createWalletClient();
        await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });

        expect(sessionStore.get(Constants.redirectAuthStorageKey)).toContain("verifier-1");
    });

    it("throws clearly when transient redirect auth storage is unavailable", async () => {
        const wallet = createWalletClient();

        await expect(wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        })).rejects.toThrow("OIDC redirect auth requires redirectAuthStorage or browser sessionStorage");
    });

    it("surfaces OIDC provider callback errors and clears pending state", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            verifier: "verifier-1",
            challenge: "challenge-1",
        })));

        const wallet = createWalletClient({redirectAuthStorage});
        await wallet.startOidcRedirectAuth({
            provider: "google",
            redirectUri: "https://app.example/auth/callback",
        });

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: "https://app.example/auth/callback?error=access_denied&error_description=User%20cancelled",
        })).rejects.toThrow("User cancelled");
        expect(redirectAuthStorage.get(Constants.redirectAuthStorageKey)).toBeNull();
    });

    it("rejects callbacks without pending auth", async () => {
        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
        });
        const state = encodeOidcState({
            nonce: "nonce-1",
            scope: "project-id",
        });

        await expect(wallet.completeOidcRedirectAuth({
            callbackUrl: `https://app.example/auth/callback?code=auth-code&state=${state}`,
        })).rejects.toThrow("No pending OIDC redirect auth found");
    });

    it("starts and completes auth through the one-call browser convenience method", async () => {
        const redirectAuthStorage = new MemoryStorageManager();
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = JSON.parse(init?.body as string);

            if (url.endsWith("/CommitVerifier")) {
                expect(body.metadata.redirect_uri).toBe(expectedDefaultRelayRedirectUri);
                return jsonResponse({
                    verifier: "verifier-1",
                    challenge: "challenge-1",
                });
            }

            if (url.endsWith("/CompleteAuth")) {
                return jsonResponse({
                    identity: {type: "oidc", sub: "user-1"},
                    wallets: [],
                    credential: testCredential(),
                });
            }

            if (url.endsWith("/CreateWallet")) {
                return jsonResponse({
                    wallet: {
                        id: "wallet-id",
                        type: WalletType.Ethereum,
                        address: "0x2222222222222222222222222222222222222222",
                    },
                });
            }

            throw new Error(`Unexpected request: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        const wallet = createWalletClient({redirectAuthStorage});
        const assignUrl = vi.fn();
        await wallet.signInWithOidcRedirect({
            provider: "google",
            currentUrl: "https://app.example/login?from=home#section",
            assignUrl,
        });

        const assignedUrl = new URL(assignUrl.mock.calls[0][0]);
        expect(assignedUrl.searchParams.get("redirect_uri")).toBe(expectedDefaultRelayRedirectUri);
        expect(redirectUriFromCurrentUrl("https://app.example/login?from=home#section")).toBe("https://app.example/login");

        const replaceUrl = vi.fn();
        const completed = await wallet.signInWithOidcRedirect({
            provider: "google",
            currentUrl: `https://app.example/login?code=auth-code&state=${assignedUrl.searchParams.get("state")}`,
            replaceUrl,
        });

        expect(completed).toMatchObject({
            walletAddress: "0x2222222222222222222222222222222222222222",
            credential: testCredential(),
        });
        expect(wallet.walletAddress).toBe("0x2222222222222222222222222222222222222222");
        expect(replaceUrl).toHaveBeenCalledWith("https://app.example/login");
    });

    it("rejects unknown configured provider names", async () => {
        const wallet = createWalletClient({
            redirectAuthStorage: new MemoryStorageManager(),
        });

        await expect(wallet.startOidcRedirectAuth({
            provider: "github" as any,
            redirectUri: "https://app.example/auth/callback",
        })).rejects.toThrow('OIDC provider "github" is not configured');
    });

});

function createWalletClient<Env extends OmsEnvironment = ReturnType<typeof testEnvironment>>(params: {
    redirectAuthStorage?: MemoryStorageManager;
    environment?: Env;
    credentialSigner?: CredentialSigner;
    projectId?: string;
} = {}): WalletClient<Env> {
    const environment = params.environment ?? testEnvironment() as Env;
    return new WalletClient<Env>({
        publicApiKey: "public-api-key",
        projectId: params.projectId ?? "project-id",
        environment,
        storage: new MemoryStorageManager(),
        redirectAuthStorage: params.redirectAuthStorage,
        credentialSigner: params.credentialSigner ?? new MockSigner(),
    });
}

function testEnvironment() {
    return defineOmsEnvironment({
        walletApiUrl: "https://wallet.example",
        indexerUrlTemplate: "https://indexer.example/{value}",
        auth: {
            oidcProviders: {
                google: googleOidcProvider({clientId: "google-client"}),
            },
        },
    });
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {"Content-Type": "application/json"},
    });
}

function testCredential() {
    return {
        credentialId: "0x" + "11".repeat(32),
        expiresAt: "2026-01-01T00:00:00Z",
        isCaller: true,
    };
}
