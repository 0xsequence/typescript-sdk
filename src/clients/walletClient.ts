import {
    ContractFunctionName,
    encodeFunctionData,
    Abi,
    Address,
    EncodeFunctionDataParameters} from 'viem'

import {OidcProviderConfig, OmsEnvironment} from "../omsEnvironment.js";
import {createDefaultStorage, SessionStorageManager, StorageManager} from "../storageManager.js";
import {createSignedFetch} from "../signedFetch.js";
import {Constants} from "../utils/constants.js";
import {RequestUtils} from "../utils/requestUtils.js";
import {
    CredentialSigner,
    type CredentialSigningAlgorithm,
    WebCryptoP256CredentialSigner,
} from "../credentialSigner.js";
import {
    buildOidcAuthorizationUrl,
    cleanOidcCallbackUrl,
    decodeOidcState,
    encodeOidcState,
    generateOidcNonce,
    parseOidcCallbackUrl,
    redirectUriFromCurrentUrl,
} from "../utils/oidcRedirect.js";
import {OmsSessionError, OmsTransactionError, OmsWalletSelectionError, toOmsSdkError} from "../errors.js";

import {
    Wallet as Walletclient,
    WalletPublic as WalletPublicclient,
    WalletType,
    TransactionMode,
    TransactionStatus,
    IdentityType,
    AuthMode,
    CommitVerifierRequest,
    CompleteAuthRequest,
    CompleteAuthResponse,
    CreateWalletRequest,
    UseWalletRequest,
    ListAccessRequest,
    ListWalletsRequest,
    RevokeAccessRequest,
    SignMessageRequest,
    SignTypedDataRequest,
    IsValidMessageSignatureRequest,
    IsValidTypedDataSignatureRequest,
    PrepareEthereumTransactionRequest,
    PrepareEthereumContractCallRequest,
    ExecuteRequest,
    TransactionStatusRequest,
    PrepareResponse,
    TransactionStatusResponse,
    AbiArg,
    FeeOption,
    FeeOptionSelection,
    Fetch,
    CredentialInfo,
} from '../generated/waas.gen.js'
import type {Network} from "../networks.js";
import {
    FeeOptionSelector,
    FeeOptionWithBalance,
    SendContractTransactionParams,
    SendDataTransactionParams, SendNativeTransactionParams,
    SendTransactionParams,
    SendTransactionResponse,
    TransactionStatusPollingOptions
} from "../types/transactionTypes.js";
import {
    AccessGrant,
    AccessGrantPage,
    ListAccessParams,
    WalletCredential,
} from "../types/accessGrant.js";
import {IndexerClient, TokenBalance} from "./indexerClient.js";
import {WalletOperation} from "../operations.js";

export type OidcProviderName<Env extends OmsEnvironment = OmsEnvironment> =
    keyof NonNullable<NonNullable<Env['auth']>['oidcProviders']> & string;

export type OidcProviderInput<Env extends OmsEnvironment = OmsEnvironment> =
    OidcProviderName<Env> | OidcProviderConfig;

export interface StartOidcRedirectAuthParams<Env extends OmsEnvironment = OmsEnvironment> {
    provider: OidcProviderInput<Env>;
    redirectUri: string;
    walletType?: WalletType;
    relayRedirectUri?: string;
    authorizeParams?: Record<string, string>;
}

export interface StartOidcRedirectAuthResult {
    url: string;
    state: string;
    challenge: string;
}

export interface CompleteOidcRedirectAuthParams {
    callbackUrl: string;
    cleanUrl?: boolean;
    replaceUrl?: (url: string) => void;
    walletSelection?: WalletSelectionBehavior;
}

export interface CompleteEmailAuthParams {
    code: string;
    walletType?: WalletType;
    walletSelection?: WalletSelectionBehavior;
}

export type WalletSelectionBehavior = "automatic" | "manual";

type AutomaticWalletSelectionParams<T extends {walletSelection?: WalletSelectionBehavior}> =
    Omit<T, "walletSelection"> & {walletSelection?: "automatic"}
type ManualWalletSelectionParams<T extends {walletSelection?: WalletSelectionBehavior}> =
    Omit<T, "walletSelection"> & {walletSelection: "manual"}

export interface OmsWallet {
    id: string;
    type: WalletType;
    address: Address;
    reference?: string;
}

export interface WalletActivationResult {
    walletAddress: Address;
    wallet: OmsWallet;
}

export interface CompleteEmailAuthResult {
    walletAddress: Address;
    wallet: OmsWallet;
    wallets: Array<OmsWallet>;
    credential: WalletCredential;
}

export interface CompleteOidcRedirectAuthResult {
    walletAddress: Address;
    wallet: OmsWallet;
    wallets: Array<OmsWallet>;
    credential: WalletCredential;
}

export interface PendingWalletSelection {
    walletType: WalletType;
    wallets: Array<OmsWallet>;
    credential: WalletCredential;

    selectWallet(params: {walletId: string}): Promise<WalletActivationResult>;
    createAndSelectWallet(params?: {reference?: string}): Promise<WalletActivationResult>;
}

export type OMSClientSessionLoginType = 'email' | 'google-auth' | 'oidc';

export interface OMSClientSessionState {
    walletAddress: Address | undefined;
    expiresAt: string | undefined;
    loginType: OMSClientSessionLoginType | undefined;
    sessionEmail: string | undefined;
}

export interface SignMessageParams {
    network: Network
    message: string
}

export interface SignTypedDataParams {
    network: Network
    typedData: any
}

export interface IsValidMessageSignatureParams {
    network?: Network
    walletAddress?: Address
    walletId?: string
    message: string
    signature: string
}

export interface IsValidTypedDataSignatureParams {
    network?: Network
    walletAddress?: Address
    walletId?: string
    typedData: any
    signature: string
}

export interface SignInWithOidcRedirectParams<Env extends OmsEnvironment = OmsEnvironment> {
    provider: OidcProviderInput<Env>;
    redirectUri?: string;
    walletType?: WalletType;
    walletSelection?: WalletSelectionBehavior;
    relayRedirectUri?: string;
    authorizeParams?: Record<string, string>;
    cleanUrl?: boolean;
    currentUrl?: string;
    assignUrl?: (url: string) => void;
    replaceUrl?: (url: string) => void;
}

interface PendingOidcRedirectAuth {
    verifier: string;
    nonce: string;
    provider: string | null;
    walletType: WalletType;
    signerCredentialId: string;
    signerKeyType: CredentialSigningAlgorithm;
    redirectUri: string;
    issuer: string;
    projectId: string;
}

interface ResolvedOidcProvider {
    name: string | null;
    config: OidcProviderConfig;
}

interface WalletSessionMetadata {
    expiresAt: string;
    loginType?: OMSClientSessionLoginType;
    sessionEmail?: string;
}

interface ActivePendingWalletSelection {
    id: string;
    signerCredentialId: string;
    signerKeyType: CredentialSigningAlgorithm;
    walletType: WalletType;
    metadata: WalletSessionMetadata;
}

type WalletActivationContext =
    | {kind: "pending"; session: ActivePendingWalletSelection; metadata: WalletSessionMetadata}
    | {kind: "active"; metadata?: WalletSessionMetadata}

interface EmailAuthCompletionParams {
    code: string;
    walletType: WalletType;
    walletSelection: WalletSelectionBehavior;
}

interface ActiveEmailAuthAttempt {
    verifier: string;
    challenge: string;
    completion?: {
        params: EmailAuthCompletionParams;
        promise: Promise<CompleteEmailAuthResult | PendingWalletSelection>;
    };
}

class PendingWalletSelectionImpl implements PendingWalletSelection {
    private readonly availableWalletIds: Set<string>;
    private inFlight = false;

    constructor(
        public readonly walletType: WalletType,
        public readonly wallets: Array<OmsWallet>,
        public readonly credential: WalletCredential,
        private readonly selectWalletAction: (walletId: string) => Promise<WalletActivationResult>,
        private readonly createAndSelectWalletAction: (reference?: string) => Promise<WalletActivationResult>,
    ) {
        this.availableWalletIds = new Set(wallets.map(wallet => wallet.id));
    }

    async selectWallet(params: {walletId: string}): Promise<WalletActivationResult> {
        return this.runExclusive(WalletOperation.pendingWalletSelectionSelectWallet, async () => {
            if (!this.availableWalletIds.has(params.walletId)) {
                throw new OmsWalletSelectionError({
                    code: "OMS_WALLET_SELECTION_UNAVAILABLE",
                    operation: WalletOperation.pendingWalletSelectionSelectWallet,
                    message: "Selected wallet is not one of the available options",
                });
            }
            return this.selectWalletAction(params.walletId);
        });
    }

    async createAndSelectWallet(params: {reference?: string} = {}): Promise<WalletActivationResult> {
        return this.runExclusive(WalletOperation.pendingWalletSelectionCreateAndSelectWallet, () =>
            this.createAndSelectWalletAction(params.reference),
        );
    }

    private async runExclusive<T>(operation: WalletOperation, action: () => Promise<T>): Promise<T> {
        if (this.inFlight) {
            throw new OmsWalletSelectionError({
                code: "OMS_WALLET_SELECTION_IN_FLIGHT",
                operation,
                message: "Pending wallet selection already has an action in flight",
            });
        }

        this.inFlight = true;
        try {
            return await action();
        } catch (error) {
            throw toOmsSdkError(error, operation);
        } finally {
            this.inFlight = false;
        }
    }
}

export class WalletClient<Env extends OmsEnvironment = OmsEnvironment> {
    private readonly client: Walletclient
    private readonly publicClient: WalletPublicclient
    private readonly storage: StorageManager
    private readonly redirectAuthStorage?: StorageManager
    private readonly credentialSigner: CredentialSigner
    private readonly indexerClient: IndexerClient
    private readonly environment: Env
    private readonly projectId: string
    private readonly fastTransactionStatusPollIntervalMs = 400
    private readonly fastTransactionStatusPollCount = 5
    private readonly transactionStatusPollIntervalMs = 2_000
    private readonly transactionStatusPollTimeoutMs = 60_000

    /** The on-chain address of this wallet. Undefined until auth completes or a session is restored. */
    public walletAddress: Address | undefined
    private sessionExpiresAt: string | undefined
    private sessionLoginType: OMSClientSessionLoginType | undefined
    private sessionEmail: string | undefined
    private activePendingWalletSelection: ActivePendingWalletSelection | undefined
    private activeEmailAuthAttempt: ActiveEmailAuthAttempt | undefined
    private nextPendingWalletSelectionId = 1

    private walletId: string

    constructor(params: {
        publicApiKey: string,
        projectId: string,
        environment: Env,
        storage?: StorageManager
        redirectAuthStorage?: StorageManager
        credentialSigner?: CredentialSigner
    }) {
        this.environment = params.environment
        this.storage = params.storage ?? createDefaultStorage()
        this.redirectAuthStorage = params.redirectAuthStorage ?? defaultRedirectAuthStorage()
        this.credentialSigner = params.credentialSigner ?? new WebCryptoP256CredentialSigner()
        this.projectId = params.projectId

        const storedId      = this.storage.get(Constants.walletIdStorageKey)
        const storedAddress = this.storage.get(Constants.walletAddressStorageKey)

        if (storedId && storedAddress) {
            this.walletId      = storedId
            this.walletAddress = storedAddress as Address
            this.sessionExpiresAt = this.storage.get(Constants.sessionExpiresAtStorageKey) ?? undefined
            this.sessionLoginType = parseSessionLoginType(this.storage.get(Constants.sessionLoginTypeStorageKey))
            this.sessionEmail = this.storage.get(Constants.sessionEmailStorageKey) ?? undefined
        } else {
            this.walletId      = ''
            this.walletAddress = undefined
            this.sessionExpiresAt = undefined
            this.sessionLoginType = undefined
            this.sessionEmail = undefined
        }

        const signedFetch = createSignedFetch(params.publicApiKey, this.credentialSigner, this.projectId)
        this.client = new Walletclient(params.environment.walletApiUrl, signedFetch)
        this.publicClient = new WalletPublicclient(
            params.environment.walletApiUrl,
            createAccessKeyFetch(params.publicApiKey),
        )
        this.indexerClient = new IndexerClient({
            publicApiKey: params.publicApiKey,
            environment: params.environment,
        })
    }

    /** Durable metadata for the completed wallet session. */
    get session(): OMSClientSessionState {
        if (!this.walletAddress) {
            return {
                walletAddress: undefined,
                expiresAt: undefined,
                loginType: undefined,
                sessionEmail: undefined,
            }
        }

        return {
            walletAddress: this.walletAddress,
            expiresAt: this.sessionExpiresAt,
            loginType: this.sessionLoginType,
            sessionEmail: this.sessionEmail,
        }
    }

    /**
     * Initiates email-based OTP authentication by sending a one-time code to the given address.
     *
     * After this resolves, show your OTP entry UI and pass the code to `completeEmailAuth`.
     */
    async startEmailAuth(params: {
        email: string
    }): Promise<void> {
        return this.runOperation(WalletOperation.startEmailAuth, async () => {
            await this.clearSession()
            const request: CommitVerifierRequest = {
                identityType: IdentityType.Email,
                authMode: AuthMode.OTP,
                metadata: {},
                handle: params.email,
            }
            const response = await this.client.commitVerifier(request)
            this.activeEmailAuthAttempt = {
                verifier: response.verifier,
                challenge: response.challenge,
            }
        })
    }

    /**
     * Completes the email OTP flow by verifying the code the user received.
     *
     * Must be called after `startEmailAuth`. On success, this activates an
     * existing wallet or creates a new one and returns the wallet address plus
     * the credential added by WaaS.
     */
    async completeEmailAuth(params: ManualWalletSelectionParams<CompleteEmailAuthParams>): Promise<PendingWalletSelection>
    async completeEmailAuth(params: AutomaticWalletSelectionParams<CompleteEmailAuthParams>): Promise<CompleteEmailAuthResult>
    async completeEmailAuth(params: CompleteEmailAuthParams): Promise<CompleteEmailAuthResult | PendingWalletSelection>
    async completeEmailAuth(params: CompleteEmailAuthParams): Promise<CompleteEmailAuthResult | PendingWalletSelection> {
        return this.runOperation(WalletOperation.completeEmailAuth, async () => {
            const completionParams: EmailAuthCompletionParams = {
                code: params.code,
                walletType: params.walletType ?? WalletType.Ethereum,
                walletSelection: params.walletSelection ?? "automatic",
            }
            const attempt = this.currentEmailAuthAttempt(WalletOperation.completeEmailAuth)
            const completion = attempt.completion
            if (completion) {
                if (!sameEmailAuthCompletionParams(completion.params, completionParams)) {
                    throw new OmsSessionError({
                        operation: WalletOperation.completeEmailAuth,
                        message: "Email auth completion is already in flight",
                    })
                }
                return completion.promise
            }

            let promise: Promise<CompleteEmailAuthResult | PendingWalletSelection>
            promise = this.completeEmailAuthAttempt(attempt, completionParams).catch(error => {
                const sdkError = toOmsSdkError(error, WalletOperation.completeEmailAuth)
                if (this.activeEmailAuthAttempt === attempt && attempt.completion?.promise === promise) {
                    if (sdkError.code === "OMS_AUTH_COMMITMENT_CONSUMED") {
                        this.activeEmailAuthAttempt = undefined
                    } else {
                        attempt.completion = undefined
                    }
                }
                throw sdkError
            })
            attempt.completion = {params: completionParams, promise}
            return promise
        })
    }

    /**
     * Starts an OIDC authorization-code PKCE flow and returns the provider URL.
     *
     * Store or navigate to the returned `url`, then call `completeOidcRedirectAuth`
     * after the provider redirects back to your application.
     */
    async startOidcRedirectAuth(
        params: StartOidcRedirectAuthParams<Env>,
    ): Promise<StartOidcRedirectAuthResult> {
        return this.runOperation(WalletOperation.startOidcRedirectAuth, async () => {
            await this.clearSession()
            const redirectAuthStorage = this.requireRedirectAuthStorage()
            const provider = this.resolveOidcProvider(params.provider)
            const oauthRedirectUri = params.relayRedirectUri ?? provider.config.relayRedirectUri ?? params.redirectUri

            const request: CommitVerifierRequest = {
                identityType: IdentityType.OIDC,
                authMode: AuthMode.AuthCodePKCE,
                metadata: {
                    iss: provider.config.issuer,
                    aud: provider.config.clientId,
                    redirect_uri: oauthRedirectUri,
                },
            }
            const response = await this.client.commitVerifier(request)
            const signerCredentialId = await this.credentialSigner.credentialId()
            const nonce = generateOidcNonce()
            const state = encodeOidcState({
                nonce,
                scope: this.projectId,
                ...(oauthRedirectUri !== params.redirectUri ? {redirect_uri: params.redirectUri} : {}),
            })

            this.savePendingOidcRedirectAuth(redirectAuthStorage, {
                verifier: response.verifier,
                nonce,
                provider: provider.name,
                walletType: params.walletType ?? WalletType.Ethereum,
                signerCredentialId,
                signerKeyType: this.credentialSigner.signingAlgorithm,
                redirectUri: params.redirectUri,
                issuer: provider.config.issuer,
                projectId: this.projectId,
            })

            const authorizeParams = {
                ...provider.config.authorizeParams,
                ...params.authorizeParams,
            }
            const url = buildOidcAuthorizationUrl({
                authorizationUrl: provider.config.authorizationUrl,
                clientId: provider.config.clientId,
                redirectUri: oauthRedirectUri,
                scopes: this.resolveOidcScopes(provider.config),
                state,
                challenge: response.challenge,
                authorizeParams,
                loginHint: response.loginHint,
            })

            return {
                url,
                state,
                challenge: response.challenge,
            }
        })
    }

    /**
     * Completes an OIDC authorization-code PKCE redirect flow.
     *
     * This validates the state nonce persisted by `startOidcRedirectAuth`, completes
     * WaaS auth, and activates an existing wallet or creates a new one.
     */
    async completeOidcRedirectAuth(
        params: ManualWalletSelectionParams<CompleteOidcRedirectAuthParams>,
    ): Promise<PendingWalletSelection>
    async completeOidcRedirectAuth(
        params: AutomaticWalletSelectionParams<CompleteOidcRedirectAuthParams>,
    ): Promise<CompleteOidcRedirectAuthResult>
    async completeOidcRedirectAuth(
        params: CompleteOidcRedirectAuthParams,
    ): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection>
    async completeOidcRedirectAuth(
        params: CompleteOidcRedirectAuthParams,
    ): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection> {
        return this.runOperation(WalletOperation.completeOidcRedirectAuth, async () => {
            const redirectAuthStorage = this.requireRedirectAuthStorage()

            try {
                const callback = parseOidcCallbackUrl(params.callbackUrl)
                if (params.cleanUrl) {
                    this.replaceOidcCallbackUrl(params.callbackUrl, params.replaceUrl)
                }

                if (callback.error) {
                    throw new Error(callback.errorDescription || `OIDC provider returned error: ${callback.error}`)
                }
                if (!callback.code || !callback.state) {
                    throw new Error('OIDC callback URL is missing code or state')
                }

                const pending = this.loadPendingOidcRedirectAuth(redirectAuthStorage)
                this.validateOidcState(callback.state, pending)
                await this.validatePendingOidcRedirectSigner(pending, WalletOperation.completeOidcRedirectAuth)

                const request: CompleteAuthRequest = {
                    identityType: IdentityType.OIDC,
                    authMode: AuthMode.AuthCodePKCE,
                    verifier: pending.verifier,
                    answer: callback.code,
                    lifetime: DEFAULT_SESSION_LIFETIME_SECONDS,
                }
                const response = await this.client.completeAuth(request)
                const result = await this.completeWalletAuth(response, pending.walletType, params.walletSelection ?? "automatic")

                if ((params.walletSelection ?? "automatic") === "automatic" && !this.walletAddress) {
                    throw new Error('OIDC auth completed without an active wallet')
                }

                return result
            } finally {
                redirectAuthStorage.delete(Constants.redirectAuthStorageKey)
            }
        })
    }

    /**
     * Browser convenience wrapper for regular web apps.
     *
     * If the current URL contains an OIDC callback, it completes auth. Otherwise it
     * starts auth and redirects to the provider.
     */
    async signInWithOidcRedirect(params: ManualWalletSelectionParams<SignInWithOidcRedirectParams<Env>>): Promise<PendingWalletSelection | void>
    async signInWithOidcRedirect(params: AutomaticWalletSelectionParams<SignInWithOidcRedirectParams<Env>>): Promise<CompleteOidcRedirectAuthResult | void>
    async signInWithOidcRedirect(params: SignInWithOidcRedirectParams<Env>): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection | void>
    async signInWithOidcRedirect(params: SignInWithOidcRedirectParams<Env>): Promise<CompleteOidcRedirectAuthResult | PendingWalletSelection | void> {
        return this.runOperation(WalletOperation.signInWithOidcRedirect, async () => {
            const currentUrl = params.currentUrl ?? this.browserCurrentUrl()
            const callback = parseOidcCallbackUrl(currentUrl)
            if (callback.code || callback.state || callback.error) {
                return this.completeOidcRedirectAuth({
                    callbackUrl: currentUrl,
                    cleanUrl: params.cleanUrl ?? true,
                    replaceUrl: params.replaceUrl,
                    walletSelection: params.walletSelection,
                })
            }

            const redirectUri = params.redirectUri ?? redirectUriFromCurrentUrl(currentUrl)
            const result = await this.startOidcRedirectAuth({
                provider: params.provider,
                redirectUri,
                walletType: params.walletType,
                relayRedirectUri: params.relayRedirectUri,
                authorizeParams: params.authorizeParams,
            })
            const assignUrl = params.assignUrl ?? this.browserAssignUrl()
            assignUrl(result.url)
        })
    }

    async signOut(): Promise<void> {
        return this.runOperation(WalletOperation.signOut, () => this.clearSession())
    }

    async listWallets(): Promise<Array<OmsWallet>> {
        return this.runOperation(WalletOperation.listWallets, async () => {
            await this.requireWalletSelectionOrActiveSession(WalletOperation.listWallets)
            return this.listAllWallets()
        })
    }

    async useWallet(params: {walletId: string}): Promise<WalletActivationResult> {
        return this.runOperation(WalletOperation.useWallet, async () => {
            const context = await this.walletActivationContext(WalletOperation.useWallet)
            const wallet = await this.requestUseWallet(params.walletId)
            await this.requireWalletActivationContextStillActive(context, WalletOperation.useWallet)
            return this.activateWallet(wallet, context.metadata)
        })
    }

    async createWallet(params: {type?: WalletType; reference?: string} = {}): Promise<WalletActivationResult> {
        return this.runOperation(WalletOperation.createWallet, async () => {
            const context = await this.walletActivationContext(WalletOperation.createWallet)
            const wallet = await this.requestCreateWallet(params.type ?? WalletType.Ethereum, params.reference)
            await this.requireWalletActivationContextStillActive(context, WalletOperation.createWallet)
            return this.activateWallet(wallet, context.metadata)
        })
    }

    private async clearSession(): Promise<void> {
        this.storage.delete(Constants.walletIdStorageKey)
        this.storage.delete(Constants.walletAddressStorageKey)
        this.storage.delete(Constants.sessionExpiresAtStorageKey)
        this.storage.delete(Constants.sessionLoginTypeStorageKey)
        this.storage.delete(Constants.sessionEmailStorageKey)
        this.walletId = ''
        this.walletAddress = undefined
        this.sessionExpiresAt = undefined
        this.sessionLoginType = undefined
        this.sessionEmail = undefined
        this.activePendingWalletSelection = undefined
        this.activeEmailAuthAttempt = undefined
        this.redirectAuthStorage?.delete(Constants.redirectAuthStorageKey)
        await this.credentialSigner.clear?.()
    }

    async signMessage(params: SignMessageParams): Promise<string> {
        return this.runOperation(WalletOperation.signMessage, async () => {
            await this.requireActiveSession(WalletOperation.signMessage)
            const request: SignMessageRequest = {
                network: params.network.id.toString(),
                walletId: this.walletId,
                message: params.message,
            }
            const response = await this.client.signMessage(request)
            return response.signature
        })
    }

    async signTypedData(params: SignTypedDataParams): Promise<string> {
        return this.runOperation(WalletOperation.signTypedData, async () => {
            await this.requireActiveSession(WalletOperation.signTypedData)
            const request: SignTypedDataRequest = {
                network: params.network.id.toString(),
                walletId: this.walletId,
                typedData: normalizeJsonBigInts(params.typedData),
            }
            const response = await this.client.signTypedData(request)
            return response.signature
        })
    }

    async isValidMessageSignature(params: IsValidMessageSignatureParams): Promise<boolean> {
        return this.runOperation(WalletOperation.isValidMessageSignature, async () => {
            const request: IsValidMessageSignatureRequest = {
                network: params.network?.id.toString(),
                walletAddress: params.walletAddress,
                walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
                message: params.message,
                signature: params.signature,
            }
            const response = await this.publicClient.isValidMessageSignature(request)
            return response.isValid
        })
    }

    async isValidTypedDataSignature(params: IsValidTypedDataSignatureParams): Promise<boolean> {
        return this.runOperation(WalletOperation.isValidTypedDataSignature, async () => {
            const request: IsValidTypedDataSignatureRequest = {
                network: params.network?.id.toString(),
                walletAddress: params.walletAddress,
                walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
                typedData: normalizeJsonBigInts(params.typedData),
                signature: params.signature,
            }
            const response = await this.publicClient.isValidTypedDataSignature(request)
            return response.isValid
        })
    }

    async sendTransaction(params: SendNativeTransactionParams): Promise<SendTransactionResponse>
    async sendTransaction(params: SendDataTransactionParams): Promise<SendTransactionResponse>
    async sendTransaction<
        const abi extends Abi | readonly unknown[],
        functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>,
    >(params: SendContractTransactionParams<abi, functionName>): Promise<SendTransactionResponse>
    async sendTransaction(params: SendTransactionParams): Promise<SendTransactionResponse> {
        return this.runOperation(WalletOperation.sendTransaction, async () => {
            await this.requireActiveSession(WalletOperation.sendTransaction)
            const data =
                'abi' in params
                    ? encodeFunctionData(params as EncodeFunctionDataParameters)
                    : params.data

            const request: PrepareEthereumTransactionRequest = {
                network: params.network.id.toString(),
                walletId: this.walletId,
                to: params.to,
                value: (params.value ?? 0n).toString(),
                data,
                mode: params.mode ?? TransactionMode.Relayer,
            }

            const prepared = await this.client.prepareEthereumTransaction(request)
            return this.executePreparedTransaction({
                prepared,
                network: params.network,
                selectFeeOption: params.selectFeeOption,
                waitForStatus: params.waitForStatus,
                statusPolling: params.statusPolling,
            })
        })
    }

    async callContract(params: {
        network: Network
        contractAddress: Address
        method: string
        args?: Array<AbiArg>
        mode?: TransactionMode
        selectFeeOption?: FeeOptionSelector
        waitForStatus?: boolean
        statusPolling?: TransactionStatusPollingOptions
    }): Promise<SendTransactionResponse> {
        return this.runOperation(WalletOperation.callContract, async () => {
            await this.requireActiveSession(WalletOperation.callContract)
            const request: PrepareEthereumContractCallRequest = {
                network: params.network.id.toString(),
                walletId: this.walletId,
                contract: params.contractAddress,
                method: params.method,
                args: params.args,
                mode: params.mode ?? TransactionMode.Relayer,
            }

            const prepared = await this.client.prepareEthereumContractCall(request)
            return this.executePreparedTransaction({
                prepared,
                network: params.network,
                selectFeeOption: params.selectFeeOption,
                waitForStatus: params.waitForStatus,
                statusPolling: params.statusPolling,
            })
        })
    }

    async getTransactionStatus(params: {
        txnId: string
    }): Promise<TransactionStatusResponse> {
        return this.runOperation(WalletOperation.getTransactionStatus, () =>
            this.client.transactionStatus({txnId: params.txnId} as TransactionStatusRequest),
        )
    }

    async listAccess(params: ListAccessParams = {}): Promise<AccessGrant[]> {
        return this.runOperation(WalletOperation.listAccess, async () => {
            const grants: AccessGrant[] = []
            for await (const page of this.listAccessPagesUnchecked(params, WalletOperation.listAccess)) {
                grants.push(...page.grants)
            }
            return grants
        })
    }

    async *listAccessPages(params: ListAccessParams = {}): AsyncIterable<AccessGrantPage> {
        try {
            yield* this.listAccessPagesUnchecked(params, WalletOperation.listAccessPages)
        } catch (error) {
            throw toOmsSdkError(error, WalletOperation.listAccessPages)
        }
    }

    async revokeAccess(params: {
        targetCredentialId: string
    }): Promise<void> {
        return this.runOperation(WalletOperation.revokeAccess, async () => {
            await this.requireActiveSession(WalletOperation.revokeAccess)
            const request: RevokeAccessRequest = {
                targetCredentialId: params.targetCredentialId,
                walletId: this.walletId
            }

            await this.client.revokeAccess(request)
        })
    }

    /**
     * Creates a new wallet of the requested type for the authenticated user.
     *
     * The wallet ID and address are persisted to storage so the session can be
     * restored when the configured credential signer is also available.
     */
    private async requestCreateWallet(
        type: WalletType,
        reference?: string,
    ): Promise<OmsWallet> {
        const params: CreateWalletRequest = { type, reference }
        const response = await this.client.createWallet(params)
        return this.toOmsWallet(response.wallet)
    }

    /**
     * Loads an existing wallet by its server-side ID.
     *
     * The wallet ID and address are persisted to storage.
     */
    private async requestUseWallet(walletId: string): Promise<OmsWallet> {
        const params: UseWalletRequest = { walletId }
        const response = await this.client.useWallet(params)
        return this.toOmsWallet(response.wallet)
    }

    private activateWallet(wallet: OmsWallet, metadata?: WalletSessionMetadata): WalletActivationResult {
        this.persistSession(wallet.id, wallet.address, metadata)
        this.activePendingWalletSelection = undefined
        return {walletAddress: wallet.address, wallet}
    }

    private async completeWalletAuth(
        response: CompleteAuthResponse,
        walletType: WalletType,
        walletSelection: WalletSelectionBehavior,
        emailAuthAttempt?: ActiveEmailAuthAttempt,
    ): Promise<CompleteEmailAuthResult | PendingWalletSelection> {
        this.activePendingWalletSelection = undefined

        const metadata = this.sessionMetadataFromAuthResponse(response)
        const wallets = await this.listAllWalletsFromAuthResponse(response)
        const credential = this.toWalletCredential(response.credential)
        const candidateWallets = wallets.filter(wallet => wallet.type === walletType)
        const operation = WalletOperation.completeEmailAuth
        const requireCurrentEmailAuth = () => {
            if (emailAuthAttempt) {
                this.requireActiveEmailAuthAttempt(emailAuthAttempt, operation)
            }
        }

        requireCurrentEmailAuth()

        if (walletSelection === "manual") {
            const selection = await this.createPendingWalletSelection({
                walletType,
                wallets: candidateWallets,
                credential,
                metadata,
            }, requireCurrentEmailAuth)
            this.clearEmailAuthAttempt(emailAuthAttempt)
            return selection
        }

        const wallet = candidateWallets[0]
        const selectedWallet = wallet
            ? await this.requestUseWallet(wallet.id)
            : await this.requestCreateWallet(walletType)
        requireCurrentEmailAuth()
        const activated = this.activateWallet(selectedWallet, metadata)
        this.clearEmailAuthAttempt(emailAuthAttempt)
        const resultWallets = wallet ? wallets : [...wallets, activated.wallet]

        return {
            walletAddress: activated.walletAddress,
            wallet: activated.wallet,
            wallets: resultWallets,
            credential,
        }
    }

    private async completeEmailAuthAttempt(
        attempt: ActiveEmailAuthAttempt,
        params: EmailAuthCompletionParams,
    ): Promise<CompleteEmailAuthResult | PendingWalletSelection> {
        this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth)
        const answer = await RequestUtils.hashEmailAuthAnswer(attempt.challenge, params.code)
        this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth)

        const request: CompleteAuthRequest = {
            identityType: IdentityType.Email,
            authMode: AuthMode.OTP,
            verifier: attempt.verifier,
            answer,
            lifetime: DEFAULT_SESSION_LIFETIME_SECONDS,
        }
        const response = await this.client.completeAuth(request)
        this.requireActiveEmailAuthAttempt(attempt, WalletOperation.completeEmailAuth)
        return this.completeWalletAuth(response, params.walletType, params.walletSelection, attempt)
    }

    private async *listAccessPagesUnchecked(
        params: ListAccessParams,
        operation: WalletOperation,
    ): AsyncIterable<AccessGrantPage> {
        await this.requireActiveSession(operation)

        let cursor: string | undefined
        do {
            const page = this.buildListAccessPage(params.pageSize, cursor)
            const request: ListAccessRequest = page
                ? { walletId: this.walletId, page }
                : { walletId: this.walletId }
            const response = await this.client.listAccess(request)

            cursor = response.page?.cursor || undefined
            yield {
                grants: response.credentials.map(c => this.toWalletCredential(c)),
            }
        } while (cursor)
    }

    private buildListAccessPage(pageSize: number | undefined, cursor: string | undefined): ListAccessRequest["page"] | undefined {
        if (pageSize === undefined && cursor === undefined) {
            return undefined
        }

        return {
            limit: pageSize,
            cursor,
        }
    }

    private async listAllWallets(): Promise<Array<OmsWallet>> {
        const wallets: Array<OmsWallet> = []
        let cursor: string | undefined
        do {
            const page = cursor ? {cursor} : undefined
            const request: ListWalletsRequest = page ? {page} : {}
            const response = await this.client.listWallets(request)
            wallets.push(...response.wallets.map(wallet => this.toOmsWallet(wallet)))
            cursor = response.page?.cursor || undefined
        } while (cursor)
        return wallets
    }

    private async listAllWalletsFromAuthResponse(response: CompleteAuthResponse): Promise<Array<OmsWallet>> {
        const wallets = response.wallets.map(wallet => this.toOmsWallet(wallet))
        let cursor = response.page?.cursor || undefined
        while (cursor) {
            const nextPage = await this.client.listWallets({page: {cursor}})
            wallets.push(...nextPage.wallets.map(wallet => this.toOmsWallet(wallet)))
            cursor = nextPage.page?.cursor || undefined
        }
        return wallets
    }

    private toOmsWallet(wallet: {id: string; type: WalletType; address: string; reference?: string}): OmsWallet {
        return {
            id: wallet.id,
            type: wallet.type,
            address: wallet.address as Address,
            reference: wallet.reference,
        }
    }

    private toWalletCredential(credential: CredentialInfo): WalletCredential {
        return {
            credentialId: credential.credentialId,
            expiresAt: credential.expiresAt,
            isCaller: credential.isCaller,
        }
    }

    /** Saves wallet metadata. The non-extractable credential key is owned by the signer. */
    private persistSession(walletId: string, walletAddress: string, metadata?: WalletSessionMetadata): void {
        this.walletId      = walletId
        this.walletAddress = walletAddress as Address
        this.storage.set(Constants.walletIdStorageKey,      walletId)
        this.storage.set(Constants.walletAddressStorageKey, walletAddress)

        this.sessionExpiresAt = metadata?.expiresAt
        this.sessionLoginType = metadata?.loginType
        this.sessionEmail = metadata?.sessionEmail

        this.setOptionalStorageValue(Constants.sessionExpiresAtStorageKey, this.sessionExpiresAt)
        this.setOptionalStorageValue(Constants.sessionLoginTypeStorageKey, this.sessionLoginType)
        this.setOptionalStorageValue(Constants.sessionEmailStorageKey, this.sessionEmail)
    }

    private currentSessionMetadata(): WalletSessionMetadata | undefined {
        if (!this.sessionExpiresAt) return undefined
        return {
            expiresAt: this.sessionExpiresAt,
            loginType: this.sessionLoginType,
            sessionEmail: this.sessionEmail,
        }
    }

    private async walletActivationContext(operation: WalletOperation): Promise<WalletActivationContext> {
        const pendingSelection = this.activePendingWalletSelection
        if (pendingSelection) {
            await this.requireActivePendingWalletSelection(pendingSelection, operation)
            return {
                kind: "pending",
                session: pendingSelection,
                metadata: pendingSelection.metadata,
            }
        }

        if (!this.walletId) {
            throw new OmsSessionError({
                operation,
                message: 'No authenticated wallet session',
            })
        }

        await this.requireActiveSession(operation)
        return {kind: "active", metadata: this.currentSessionMetadata()}
    }

    private async requireWalletActivationContextStillActive(
        context: WalletActivationContext,
        operation: WalletOperation,
    ): Promise<void> {
        if (context.kind === "pending") {
            await this.requireActivePendingWalletSelection(context.session, operation)
        }
    }

    private async requireWalletSelectionOrActiveSession(operation: WalletOperation): Promise<void> {
        if (this.activePendingWalletSelection) {
            await this.requireActivePendingWalletSelection(this.activePendingWalletSelection, operation)
            return
        }

        if (this.walletId) {
            await this.requireActiveSession(operation)
            return
        }

        throw new OmsSessionError({
            operation,
            message: 'No authenticated wallet session',
        })
    }

    private currentEmailAuthAttempt(operation: WalletOperation): ActiveEmailAuthAttempt {
        if (!this.activeEmailAuthAttempt) {
            throw new OmsSessionError({
                operation,
                message: "No pending email auth attempt",
            })
        }

        return this.activeEmailAuthAttempt
    }

    private requireActiveEmailAuthAttempt(
        attempt: ActiveEmailAuthAttempt,
        operation: WalletOperation,
    ): void {
        if (this.activeEmailAuthAttempt !== attempt) {
            throw new OmsSessionError({
                operation,
                message: "Email auth attempt is no longer active",
            })
        }
    }

    private clearEmailAuthAttempt(attempt: ActiveEmailAuthAttempt | undefined): void {
        if (attempt && this.activeEmailAuthAttempt === attempt) {
            this.activeEmailAuthAttempt = undefined
        }
    }

    private async createPendingWalletSelection(params: {
        walletType: WalletType;
        wallets: Array<OmsWallet>;
        credential: WalletCredential;
        metadata: WalletSessionMetadata;
    }, beforeCommit?: () => void): Promise<PendingWalletSelection> {
        const signerCredentialId = await this.credentialSigner.credentialId()
        beforeCommit?.()
        const selectionSession: ActivePendingWalletSelection = {
            id: `pending-${this.nextPendingWalletSelectionId++}`,
            signerCredentialId,
            signerKeyType: this.credentialSigner.signingAlgorithm,
            walletType: params.walletType,
            metadata: params.metadata,
        }
        this.activePendingWalletSelection = selectionSession

        const wallets = params.wallets.map(wallet => ({...wallet}))
        const credential = {...params.credential}

        return new PendingWalletSelectionImpl(
            params.walletType,
            wallets,
            credential,
            async walletId => {
                const operation = WalletOperation.pendingWalletSelectionSelectWallet
                await this.requireActivePendingWalletSelection(selectionSession, operation)
                const wallet = await this.requestUseWallet(walletId)
                await this.requireActivePendingWalletSelection(selectionSession, operation)
                return this.activateWallet(wallet, selectionSession.metadata)
            },
            async reference => {
                const operation = WalletOperation.pendingWalletSelectionCreateAndSelectWallet
                await this.requireActivePendingWalletSelection(selectionSession, operation)
                const wallet = await this.requestCreateWallet(selectionSession.walletType, reference)
                await this.requireActivePendingWalletSelection(selectionSession, operation)
                return this.activateWallet(wallet, selectionSession.metadata)
            },
        )
    }

    private async requireActivePendingWalletSelection(
        selectionSession: ActivePendingWalletSelection,
        operation: WalletOperation,
    ): Promise<void> {
        if (this.activePendingWalletSelection?.id !== selectionSession.id) {
            throw new OmsWalletSelectionError({
                code: "OMS_WALLET_SELECTION_STALE",
                operation,
                message: "Pending wallet selection is no longer active",
            })
        }

        if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
            this.activePendingWalletSelection = undefined
            throw new OmsSessionError({
                operation,
                message: 'No active credential',
            })
        }

        const signerCredentialId = await this.credentialSigner.credentialId()
        if (
            normalizeCredentialId(signerCredentialId) !== normalizeCredentialId(selectionSession.signerCredentialId) ||
            this.credentialSigner.signingAlgorithm !== selectionSession.signerKeyType
        ) {
            throw new OmsWalletSelectionError({
                code: "OMS_WALLET_SELECTION_STALE",
                operation,
                message: "Pending wallet selection is no longer active",
            })
        }
    }

    private sessionMetadataFromAuthResponse(response: CompleteAuthResponse): WalletSessionMetadata {
        return {
            expiresAt: response.credential.expiresAt,
            loginType: this.sessionLoginTypeFromAuthResponse(response),
            sessionEmail: response.email,
        }
    }

    private sessionLoginTypeFromAuthResponse(response: CompleteAuthResponse): OMSClientSessionLoginType | undefined {
        switch (response.identity.type) {
            case IdentityType.Email:
                return 'email'
            case IdentityType.OIDC:
                return response.identity.iss === GOOGLE_ISSUER ? 'google-auth' : 'oidc'
            default:
                return undefined
        }
    }

    private setOptionalStorageValue(key: string, value: string | undefined): void {
        if (value) {
            this.storage.set(key, value)
        } else {
            this.storage.delete(key)
        }
    }

    private resolveOidcProvider(provider: OidcProviderInput<Env>): ResolvedOidcProvider {
        if (typeof provider !== 'string') {
            return {name: null, config: provider}
        }

        const providers = this.environment.auth?.oidcProviders as Record<string, OidcProviderConfig> | undefined
        const config = providers?.[provider]
        if (!config) {
            throw new Error(`OIDC provider "${provider}" is not configured`)
        }
        return {name: provider, config}
    }

    private resolveOidcScopes(provider: OidcProviderConfig): string[] {
        return provider.scopes?.length ? provider.scopes : ['openid', 'email', 'profile']
    }

    private requireRedirectAuthStorage(): StorageManager {
        if (!this.redirectAuthStorage) {
            throw new Error('OIDC redirect auth requires redirectAuthStorage or browser sessionStorage')
        }
        return this.redirectAuthStorage
    }

    private savePendingOidcRedirectAuth(
        storage: StorageManager,
        pending: PendingOidcRedirectAuth,
    ): void {
        storage.set(Constants.redirectAuthStorageKey, JSON.stringify(pending))
    }

    private loadPendingOidcRedirectAuth(storage: StorageManager): PendingOidcRedirectAuth {
        const stored = storage.get(Constants.redirectAuthStorageKey)
        if (!stored) {
            throw new Error('No pending OIDC redirect auth found')
        }

        try {
            const parsed = JSON.parse(stored) as Partial<PendingOidcRedirectAuth>
            if (
                typeof parsed.verifier !== 'string' ||
                typeof parsed.nonce !== 'string' ||
                typeof parsed.signerCredentialId !== 'string' ||
                typeof parsed.signerKeyType !== 'string' ||
                typeof parsed.redirectUri !== 'string' ||
                typeof parsed.issuer !== 'string' ||
                typeof parsed.projectId !== 'string'
            ) {
                throw new Error('Pending OIDC redirect auth is invalid')
            }

            return {
                verifier: parsed.verifier,
                nonce: parsed.nonce,
                provider: typeof parsed.provider === 'string' ? parsed.provider : null,
                walletType: isWalletType(parsed.walletType) ? parsed.walletType : WalletType.Ethereum,
                signerCredentialId: parsed.signerCredentialId,
                signerKeyType: parsed.signerKeyType as CredentialSigningAlgorithm,
                redirectUri: parsed.redirectUri,
                issuer: parsed.issuer,
                projectId: parsed.projectId,
            }
        } catch (error) {
            throw error instanceof Error ? error : new Error('Pending OIDC redirect auth is invalid')
        }
    }

    private validateOidcState(encodedState: string, pending: PendingOidcRedirectAuth): void {
        const state = decodeOidcState(encodedState)
        if (state.nonce !== pending.nonce) {
            throw new Error('OIDC state nonce mismatch')
        }
        if (state.scope !== pending.projectId) {
            throw new Error('OIDC state scope mismatch')
        }
        if (state.redirect_uri !== undefined && state.redirect_uri !== pending.redirectUri) {
            throw new Error('OIDC state redirect_uri mismatch')
        }
    }

    private async validatePendingOidcRedirectSigner(
        pending: PendingOidcRedirectAuth,
        operation: WalletOperation,
    ): Promise<void> {
        if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
            throw new OmsSessionError({
                operation,
                message: 'No active credential',
            })
        }

        const signerCredentialId = await this.credentialSigner.credentialId()
        if (
            normalizeCredentialId(signerCredentialId) !== normalizeCredentialId(pending.signerCredentialId) ||
            this.credentialSigner.signingAlgorithm !== pending.signerKeyType
        ) {
            throw new OmsSessionError({
                operation,
                message: 'OIDC redirect auth signer mismatch',
            })
        }
    }

    private replaceOidcCallbackUrl(callbackUrl: string, replaceUrl?: (url: string) => void): void {
        const cleanUrl = cleanOidcCallbackUrl(callbackUrl)
        if (replaceUrl) {
            replaceUrl(cleanUrl)
            return
        }

        if (typeof window === 'undefined' || !window.history?.replaceState) {
            throw new Error('cleanUrl requires replaceUrl or browser history support')
        }

        window.history.replaceState({}, '', cleanUrl)
    }

    private browserCurrentUrl(): string {
        if (typeof window === 'undefined') {
            throw new Error('signInWithOidcRedirect requires currentUrl outside a browser')
        }
        return window.location.href
    }

    private browserAssignUrl(): (url: string) => void {
        if (typeof window === 'undefined') {
            throw new Error('signInWithOidcRedirect requires assignUrl outside a browser')
        }
        return (url: string) => window.location.assign(url)
    }

    private async executePreparedTransaction(params: {
        prepared: PrepareResponse
        network: Network
        selectFeeOption?: FeeOptionSelector
        waitForStatus?: boolean
        statusPolling?: TransactionStatusPollingOptions
    }): Promise<SendTransactionResponse> {
        const feeOption = await this.selectFeeOption({
            feeOptions: params.prepared.feeOptions,
            sponsored: params.prepared.sponsored,
            network: params.network,
            selectFeeOption: params.selectFeeOption,
        })
        const request: ExecuteRequest = {txnId: params.prepared.txnId}
        if (feeOption) {
            request.feeOption = feeOption
        }

        const executed = await this.client.execute(request)
        if (params.waitForStatus === false) {
            return {
                txnId: params.prepared.txnId,
                status: executed.status,
            }
        }

        let status: TransactionStatusResponse
        try {
            status = await this.waitForTransactionStatus(
                params.prepared.txnId,
                executed.status,
                params.statusPolling,
            )
        } catch (error) {
            throw new OmsTransactionError({
                operation: WalletOperation.transactionStatus,
                txnId: params.prepared.txnId,
                retryable: true,
                cause: error,
                message: "Transaction was submitted, but status polling failed",
            })
        }

        return {
            txnId: params.prepared.txnId,
            status: status.status,
            txnHash: status.txnHash,
        }
    }

    private async selectFeeOption(params: {
        feeOptions: FeeOption[]
        sponsored: boolean
        network: Network
        selectFeeOption?: FeeOptionSelector
    }): Promise<FeeOptionSelection | undefined> {
        if (params.feeOptions.length === 0) {
            return undefined
        }

        if (!params.selectFeeOption) {
            return this.defaultFeeOptionSelection(params.feeOptions, params.sponsored)
        }

        return params.selectFeeOption(
            await this.enrichFeeOptionsWithBalances(params.network, params.feeOptions),
        )
    }

    private async enrichFeeOptionsWithBalances(
        network: Network,
        feeOptions: FeeOption[],
    ): Promise<FeeOptionWithBalance[]> {
        const walletAddress = this.walletAddress
        if (!walletAddress) {
            throw new Error('No active wallet session')
        }

        const nativeBalance = feeOptions.some(option => this.isNativeToken(option))
            ? await this.loadNativeTokenBalance(network, walletAddress)
            : undefined

        const contractAddresses = Array.from(new Set(
            feeOptions
                .map(option => this.normalizeAddress(option.token.contractAddress))
                .filter((address): address is string => Boolean(address)),
        ))
        const tokenBalances = new Map<string, TokenBalance | undefined>(
            await Promise.all(contractAddresses.map(async contractAddress => [
                contractAddress,
                await this.loadTokenBalanceOrZero(network, contractAddress, walletAddress),
            ] as const)),
        )

        return feeOptions.map(feeOption => {
            const balance = this.isNativeToken(feeOption)
                ? nativeBalance
                : tokenBalances.get(this.normalizeAddress(feeOption.token.contractAddress) ?? '')
            const decimals = this.balanceDecimals(feeOption)

            return {
                feeOption,
                balance,
                available: this.formatTokenAmount(balance?.balance, decimals),
                availableRaw: balance?.balance,
                decimals,
            }
        })
    }

    private async loadNativeTokenBalance(
        network: Network,
        walletAddress: Address,
    ): Promise<TokenBalance | undefined> {
        return this.indexerClient.getNativeTokenBalance({
            network,
            walletAddress,
        }).catch(() => undefined)
    }

    private async loadTokenBalanceOrZero(
        network: Network,
        contractAddress: string,
        walletAddress: Address,
    ): Promise<TokenBalance | undefined> {
        return this.indexerClient.getTokenBalances({
            network,
            contractAddress,
            walletAddress,
            includeMetadata: false,
        }).then(result => result.balances.find(balance =>
            this.normalizeAddress(balance.contractAddress) === contractAddress,
        ) ?? {
            contractType: 'ERC20',
            contractAddress,
            accountAddress: walletAddress,
            tokenId: undefined,
            balance: '0',
            blockHash: undefined,
            blockNumber: undefined,
            chainId: network.id,
        }).catch(() => undefined)
    }

    private defaultFeeOptionSelection(
        feeOptions: FeeOption[],
        sponsored: boolean,
    ): FeeOptionSelection | undefined {
        return sponsored ? undefined : feeOptions[0] ? {token: feeOptions[0].token.symbol} : undefined
    }

    private async waitForTransactionStatus(
        txnId: string,
        fallbackStatus: TransactionStatus,
        options: TransactionStatusPollingOptions = {},
    ): Promise<TransactionStatusResponse> {
        const timeoutMs = options.timeoutMs ?? this.transactionStatusPollTimeoutMs
        const deadline = Date.now() + timeoutMs
        let lastStatus: TransactionStatusResponse = {status: fallbackStatus}
        let completedPolls = 0

        do {
            lastStatus = await this.client.transactionStatus({txnId: txnId} as TransactionStatusRequest)
            completedPolls += 1
            if (lastStatus.status === TransactionStatus.Executed || lastStatus.txnHash) {
                return lastStatus
            }
            const pollDelayMs = this.transactionStatusPollDelayMs(completedPolls, options)
            if (pollDelayMs <= 0) {
                return lastStatus
            }
            const remainingMs = deadline - Date.now()
            if (remainingMs <= 0) {
                return lastStatus
            }
            await this.delay(Math.min(pollDelayMs, remainingMs))
        } while (true)
    }

    private transactionStatusPollDelayMs(
        completedPolls: number,
        options: TransactionStatusPollingOptions = {},
    ): number {
        const fastPollCount = options.fastPollCount ?? this.fastTransactionStatusPollCount
        return completedPolls < fastPollCount
            ? options.fastIntervalMs ?? this.fastTransactionStatusPollIntervalMs
            : options.intervalMs ?? this.transactionStatusPollIntervalMs
    }

    private async requireActiveSession(operation: WalletOperation): Promise<void> {
        if (!this.walletId) {
            throw new OmsSessionError({
                operation,
                message: 'No active wallet session',
            })
        }

        if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
            await this.clearSession()
            throw new OmsSessionError({
                operation,
                message: 'No active wallet session',
            })
        }
    }

    private activeWalletId(): string | undefined {
        return this.walletId || undefined
    }

    private isNativeToken(feeOption: FeeOption): boolean {
        return feeOption.token.type.toLowerCase() === 'native' ||
            (!feeOption.token.contractAddress && !feeOption.token.tokenID)
    }

    private balanceDecimals(feeOption: FeeOption): number | undefined {
        return feeOption.token.decimals ?? (this.isNativeToken(feeOption) ? 18 : undefined)
    }

    private normalizeAddress(address: string | undefined): string | undefined {
        return address?.trim().toLowerCase() || undefined
    }

    private formatTokenAmount(value: string | undefined, decimals: number | undefined): string | undefined {
        if (value === undefined || decimals === undefined) {
            return value
        }

        try {
            const raw = BigInt(value)
            const divisor = 10n ** BigInt(decimals)
            const whole = raw / divisor
            const fraction = (raw % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
            return fraction ? `${whole}.${fraction}` : whole.toString()
        } catch {
            return value
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private async runOperation<T>(operation: WalletOperation, action: () => Promise<T>): Promise<T> {
        try {
            return await action()
        } catch (error) {
            throw toOmsSdkError(error, operation)
        }
    }
}

function defaultRedirectAuthStorage(): StorageManager | undefined {
    return SessionStorageManager.isAvailable()
        ? new SessionStorageManager()
        : undefined
}

function createAccessKeyFetch(publicApiKey: string): Fetch {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const existingHeaders = (init?.headers ?? {}) as Record<string, string>
        const headers: Record<string, string> = {
            ...existingHeaders,
            'X-Access-Key': publicApiKey,
        }

        return globalThis.fetch(input, {...init, headers})
    }
}

function isWalletType(value: unknown): value is WalletType {
    return typeof value === 'string' && Object.values(WalletType).includes(value as WalletType)
}

function sameEmailAuthCompletionParams(
    left: EmailAuthCompletionParams,
    right: EmailAuthCompletionParams,
): boolean {
    return left.code === right.code &&
        left.walletType === right.walletType &&
        left.walletSelection === right.walletSelection
}

function normalizeCredentialId(value: string): string {
    return value.trim().toLowerCase()
}

function parseSessionLoginType(value: string | null): OMSClientSessionLoginType | undefined {
    return value === 'email' || value === 'google-auth' || value === 'oidc'
        ? value
        : undefined
}

function normalizeJsonBigInts<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, nestedValue) => {
        return typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
    })) as T
}

const DEFAULT_SESSION_LIFETIME_SECONDS = 604_800
const GOOGLE_ISSUER = 'https://accounts.google.com'
