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
import {CredentialSigner, WebCryptoP256CredentialSigner} from "../credentialSigner.js";
import {
    buildOidcAuthorizationUrl,
    cleanOidcCallbackUrl,
    decodeOidcState,
    encodeOidcState,
    generateOidcNonce,
    parseOidcCallbackUrl,
    redirectUriFromCurrentUrl,
} from "../utils/oidcRedirect.js";
import {OmsSessionError, OmsTransactionError, toOmsSdkError} from "../errors.js";

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
    autoActivate?: boolean;
}

export interface CompleteEmailAuthParams {
    code: string;
    walletType?: WalletType;
    autoActivate?: boolean;
}

type AutoActivateParams<T extends {autoActivate?: boolean}> = Omit<T, "autoActivate"> & {autoActivate?: true}
type ManualActivateParams<T extends {autoActivate?: boolean}> = Omit<T, "autoActivate"> & {autoActivate: false}

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

export interface CompleteAuthWalletSelectionResult {
    wallets: Array<OmsWallet>;
    credential: WalletCredential;
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
    autoActivate?: boolean;
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
    private pendingSessionMetadata: WalletSessionMetadata | undefined

    private walletId: string
    private verifier = ''
    private challenge = ''

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
        return this.runOperation("wallet.startEmailAuth", async () => {
            await this.clearSession()
            const request: CommitVerifierRequest = {
                identityType: IdentityType.Email,
                authMode: AuthMode.OTP,
                metadata: {},
                handle: params.email,
            }
            const response = await this.client.commitVerifier(request)
            this.verifier  = response.verifier
            this.challenge = response.challenge
        })
    }

    /**
     * Completes the email OTP flow by verifying the code the user received.
     *
     * Must be called after `startEmailAuth`. On success, this activates an
     * existing wallet or creates a new one and returns the wallet address plus
     * the credential added by WaaS.
     */
    async completeEmailAuth(params: ManualActivateParams<CompleteEmailAuthParams>): Promise<CompleteAuthWalletSelectionResult>
    async completeEmailAuth(params: AutoActivateParams<CompleteEmailAuthParams>): Promise<CompleteEmailAuthResult>
    async completeEmailAuth(params: CompleteEmailAuthParams): Promise<CompleteEmailAuthResult | CompleteAuthWalletSelectionResult>
    async completeEmailAuth(params: CompleteEmailAuthParams): Promise<CompleteEmailAuthResult | CompleteAuthWalletSelectionResult> {
        return this.runOperation("wallet.completeEmailAuth", async () => {
            const walletType = params.walletType ?? WalletType.Ethereum;
            const answer = await RequestUtils.hashEmailAuthAnswer(this.challenge, params.code);

            const request: CompleteAuthRequest = {
                identityType: IdentityType.Email,
                authMode: AuthMode.OTP,
                verifier: this.verifier,
                answer,
                lifetime: DEFAULT_SESSION_LIFETIME_SECONDS,
            }
            const response = await this.client.completeAuth(request)
            return this.completeWalletAuth(response, walletType, params.autoActivate ?? true)
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
        return this.runOperation("wallet.startOidcRedirectAuth", async () => {
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
        params: ManualActivateParams<CompleteOidcRedirectAuthParams>,
    ): Promise<CompleteAuthWalletSelectionResult>
    async completeOidcRedirectAuth(
        params: AutoActivateParams<CompleteOidcRedirectAuthParams>,
    ): Promise<CompleteOidcRedirectAuthResult>
    async completeOidcRedirectAuth(
        params: CompleteOidcRedirectAuthParams,
    ): Promise<CompleteOidcRedirectAuthResult | CompleteAuthWalletSelectionResult>
    async completeOidcRedirectAuth(
        params: CompleteOidcRedirectAuthParams,
    ): Promise<CompleteOidcRedirectAuthResult | CompleteAuthWalletSelectionResult> {
        return this.runOperation("wallet.completeOidcRedirectAuth", async () => {
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

                const request: CompleteAuthRequest = {
                    identityType: IdentityType.OIDC,
                    authMode: AuthMode.AuthCodePKCE,
                    verifier: pending.verifier,
                    answer: callback.code,
                    lifetime: DEFAULT_SESSION_LIFETIME_SECONDS,
                }
                const response = await this.client.completeAuth(request)
                const result = await this.completeWalletAuth(response, pending.walletType, params.autoActivate ?? true)

                if ((params.autoActivate ?? true) && !this.walletAddress) {
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
    async signInWithOidcRedirect(params: ManualActivateParams<SignInWithOidcRedirectParams<Env>>): Promise<CompleteAuthWalletSelectionResult | void>
    async signInWithOidcRedirect(params: AutoActivateParams<SignInWithOidcRedirectParams<Env>>): Promise<CompleteOidcRedirectAuthResult | void>
    async signInWithOidcRedirect(params: SignInWithOidcRedirectParams<Env>): Promise<CompleteOidcRedirectAuthResult | CompleteAuthWalletSelectionResult | void>
    async signInWithOidcRedirect(params: SignInWithOidcRedirectParams<Env>): Promise<CompleteOidcRedirectAuthResult | CompleteAuthWalletSelectionResult | void> {
        return this.runOperation("wallet.signInWithOidcRedirect", async () => {
            const currentUrl = params.currentUrl ?? this.browserCurrentUrl()
            const callback = parseOidcCallbackUrl(currentUrl)
            if (callback.code || callback.state || callback.error) {
                return this.completeOidcRedirectAuth({
                    callbackUrl: currentUrl,
                    cleanUrl: params.cleanUrl ?? true,
                    replaceUrl: params.replaceUrl,
                    autoActivate: params.autoActivate,
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
        return this.runOperation("wallet.signOut", () => this.clearSession())
    }

    async listWallets(): Promise<Array<OmsWallet>> {
        return this.runOperation("wallet.listWallets", () => this.listAllWallets())
    }

    async useWallet(params: {walletId: string}): Promise<WalletActivationResult> {
        return this.runOperation("wallet.useWallet", () =>
            this.useWalletUnchecked(params.walletId, this.sessionMetadataForActivation()),
        )
    }

    async createWallet(params: {type?: WalletType; reference?: string} = {}): Promise<WalletActivationResult> {
        return this.runOperation("wallet.createWallet", () =>
            this.createWalletUnchecked(
                params.type ?? WalletType.Ethereum,
                this.sessionMetadataForActivation(),
                params.reference,
            ),
        )
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
        this.pendingSessionMetadata = undefined
        this.verifier = ''
        this.challenge = ''
        this.redirectAuthStorage?.delete(Constants.redirectAuthStorageKey)
        await this.credentialSigner.clear?.()
    }

    async signMessage(params: SignMessageParams): Promise<string> {
        return this.runOperation("wallet.signMessage", async () => {
            await this.requireActiveSession("wallet.signMessage")
            const request: SignMessageRequest = {
                network: this.parseWalletNetwork(params.network),
                walletId: this.walletId,
                message: params.message,
            }
            const response = await this.client.signMessage(request)
            return response.signature
        })
    }

    async signTypedData(params: SignTypedDataParams): Promise<string> {
        return this.runOperation("wallet.signTypedData", async () => {
            await this.requireActiveSession("wallet.signTypedData")
            const request: SignTypedDataRequest = {
                network: this.parseWalletNetwork(params.network),
                walletId: this.walletId,
                typedData: normalizeJsonBigInts(params.typedData),
            }
            const response = await this.client.signTypedData(request)
            return response.signature
        })
    }

    async isValidMessageSignature(params: IsValidMessageSignatureParams): Promise<boolean> {
        return this.runOperation("wallet.isValidMessageSignature", async () => {
            const request: IsValidMessageSignatureRequest = {
                network: params.network === undefined ? undefined : this.parseWalletNetwork(params.network),
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
        return this.runOperation("wallet.isValidTypedDataSignature", async () => {
            const request: IsValidTypedDataSignatureRequest = {
                network: params.network === undefined ? undefined : this.parseWalletNetwork(params.network),
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
        return this.runOperation("wallet.sendTransaction", async () => {
            await this.requireActiveSession("wallet.sendTransaction")
            const data =
                'abi' in params
                    ? encodeFunctionData(params as EncodeFunctionDataParameters)
                    : params.data

            const request: PrepareEthereumTransactionRequest = {
                network: this.parseWalletNetwork(params.network),
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
        return this.runOperation("wallet.callContract", async () => {
            await this.requireActiveSession("wallet.callContract")
            const request: PrepareEthereumContractCallRequest = {
                network: this.parseWalletNetwork(params.network),
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
        return this.runOperation("wallet.getTransactionStatus", () =>
            this.client.transactionStatus({txnId: params.txnId} as TransactionStatusRequest),
        )
    }

    async listAccess(params: ListAccessParams = {}): Promise<AccessGrant[]> {
        return this.runOperation("wallet.listAccess", async () => {
            const grants: AccessGrant[] = []
            for await (const page of this.listAccessPagesUnchecked(params, "wallet.listAccess")) {
                grants.push(...page.grants)
            }
            return grants
        })
    }

    async *listAccessPages(params: ListAccessParams = {}): AsyncIterable<AccessGrantPage> {
        try {
            yield* this.listAccessPagesUnchecked(params, "wallet.listAccessPages")
        } catch (error) {
            throw toOmsSdkError(error, "wallet.listAccessPages")
        }
    }

    async revokeAccess(params: {
        targetCredentialId: string
    }): Promise<void> {
        return this.runOperation("wallet.revokeAccess", async () => {
            await this.requireActiveSession("wallet.revokeAccess")
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
    private async createWalletUnchecked(
        type: WalletType,
        metadata?: WalletSessionMetadata,
        reference?: string,
    ): Promise<WalletActivationResult> {
        const params: CreateWalletRequest = { type, reference }
        const response = await this.client.createWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address, metadata)
        this.pendingSessionMetadata = undefined
        const wallet = this.toOmsWallet(response.wallet)
        return {walletAddress: wallet.address, wallet}
    }

    /**
     * Loads an existing wallet by its server-side ID.
     *
     * The wallet ID and address are persisted to storage.
     */
    private async useWalletUnchecked(walletId: string, metadata?: WalletSessionMetadata): Promise<WalletActivationResult> {
        const params: UseWalletRequest = { walletId }
        const response = await this.client.useWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address, metadata)
        this.pendingSessionMetadata = undefined
        const wallet = this.toOmsWallet(response.wallet)
        return {walletAddress: wallet.address, wallet}
    }

    private async completeWalletAuth(
        response: CompleteAuthResponse,
        walletType: WalletType,
        autoActivate: boolean,
    ): Promise<CompleteEmailAuthResult | CompleteAuthWalletSelectionResult> {
        const metadata = this.sessionMetadataFromAuthResponse(response)
        const wallets = await this.listAllWalletsFromAuthResponse(response)
        const credential = this.toWalletCredential(response.credential)

        if (!autoActivate) {
            this.pendingSessionMetadata = metadata
            return {wallets, credential}
        }

        const wallet = wallets.find(candidate => candidate.type === walletType)
        const activated = wallet
            ? await this.useWalletUnchecked(wallet.id, metadata)
            : await this.createWalletUnchecked(walletType, metadata)
        const resultWallets = wallet ? wallets : [...wallets, activated.wallet]

        return {
            walletAddress: activated.walletAddress,
            wallet: activated.wallet,
            wallets: resultWallets,
            credential,
        }
    }

    private async *listAccessPagesUnchecked(
        params: ListAccessParams,
        operation: string,
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

    private sessionMetadataForActivation(): WalletSessionMetadata | undefined {
        if (this.pendingSessionMetadata) {
            return this.pendingSessionMetadata
        }
        if (!this.sessionExpiresAt) {
            return undefined
        }
        return {
            expiresAt: this.sessionExpiresAt,
            loginType: this.sessionLoginType,
            sessionEmail: this.sessionEmail,
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
                operation: "wallet.transactionStatus",
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
            chainId: this.parseIndexerNetwork(network),
            walletAddress,
        }).catch(() => undefined)
    }

    private async loadTokenBalanceOrZero(
        network: Network,
        contractAddress: string,
        walletAddress: Address,
    ): Promise<TokenBalance | undefined> {
        return this.indexerClient.getTokenBalances({
            chainId: this.parseIndexerNetwork(network),
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
            chainId: Number(this.parseWalletNetwork(network)),
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

    private async requireActiveSession(operation: string): Promise<void> {
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

    private parseWalletNetwork(network: Network): string {
        return network.id.toString()
    }

    private parseIndexerNetwork(network: Network): string {
        return network.name
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

    private async runOperation<T>(operation: string, action: () => Promise<T>): Promise<T> {
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
