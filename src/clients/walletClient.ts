import {
    ContractFunctionName,
    encodeFunctionData,
    Abi,
    Address,
    EncodeFunctionDataParameters} from 'viem'

import {OidcProviderConfig, OmsEnvironment} from "../omsEnvironment.js";
import {LocalStorageManager, SessionStorageManager, StorageManager} from "../storageManager.js";
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
} from '../generated/waas.gen.js'
import {NetworkBindings} from "../utils/networkBindings.js";
import {Network} from "../types/evmTypes.js";
import {
    FeeOptionSelector,
    FeeOptionWithBalance,
    SendContractTransactionParams,
    SendDataTransactionParams, SendNativeTransactionParams,
    SendTransactionParams,
    SendTransactionResponse
} from "../types/transactionTypes.js";
import {AccessGrant} from "../types/accessGrant.js";
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
}

export interface CompleteOidcRedirectAuthResult {
    walletAddress: Address;
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
    waasAuthScope: string;
}

interface ResolvedOidcProvider {
    name: string | null;
    config: OidcProviderConfig;
}

export class WalletClient<Env extends OmsEnvironment = OmsEnvironment> {
    private readonly client: Walletclient
    private readonly publicClient: WalletPublicclient
    private readonly storage: StorageManager
    private readonly redirectAuthStorage?: StorageManager
    private readonly networks: NetworkBindings
    private readonly credentialSigner: CredentialSigner
    private readonly indexerClient: IndexerClient
    private readonly environment: Env
    private readonly waasAuthScope: string
    private readonly fastTransactionStatusPollIntervalMs = 400
    private readonly fastTransactionStatusPollCount = 5
    private readonly transactionStatusPollIntervalMs = 2_000
    private readonly transactionStatusPollTimeoutMs = 60_000

    /** The on-chain address of this wallet. Undefined until a wallet is created or loaded. */
    public walletAddress: Address | undefined

    private walletId: string
    private verifier = ''
    private challenge = ''

    constructor(params: {
        projectAccessKey: string,
        environment: Env,
        storage?: StorageManager
        redirectAuthStorage?: StorageManager
        credentialSigner?: CredentialSigner
    }) {
        this.environment = params.environment
        this.storage = params.storage ?? new LocalStorageManager()
        this.redirectAuthStorage = params.redirectAuthStorage ?? defaultRedirectAuthStorage()
        this.credentialSigner = params.credentialSigner ?? new WebCryptoP256CredentialSigner()
        this.waasAuthScope = params.environment.auth?.waasAuthScope ?? Constants.defaultWaasAuthScope

        const storedId      = this.storage.get(Constants.walletIdStorageKey)
        const storedAddress = this.storage.get(Constants.walletAddressStorageKey)

        if (storedId && storedAddress) {
            this.walletId      = storedId
            this.walletAddress = storedAddress as Address
        } else {
            this.walletId      = ''
            this.walletAddress = undefined
        }

        const signedFetch = createSignedFetch(params.projectAccessKey, this.credentialSigner, this.waasAuthScope)
        this.client = new Walletclient(params.environment.walletApiUrl, signedFetch)
        this.publicClient = new WalletPublicclient(
            params.environment.walletApiUrl,
            createAccessKeyFetch(params.projectAccessKey),
        )
        this.indexerClient = new IndexerClient({
            projectAccessKey: params.projectAccessKey,
            environment: params.environment,
        })
        this.networks = new NetworkBindings()
    }

    /**
     * Initiates email-based OTP authentication by sending a one-time code to the given address.
     *
     * After this resolves, show your OTP entry UI and pass the code to `completeEmailAuth`.
     */
    async startEmailAuth(params: {
        email: string
    }): Promise<void> {
        const request: CommitVerifierRequest = {
            identityType: IdentityType.Email,
            authMode: AuthMode.OTP,
            metadata: {},
            handle: params.email,
        }
        const response = await this.client.commitVerifier(request)
        this.verifier  = response.verifier
        this.challenge = response.challenge
    }

    /**
     * Completes the email OTP flow by verifying the code the user received.
     *
     * Must be called after `startEmailAuth`. On success, call `createWallet`
     * or `useWallet` to activate a wallet.
     */
    async completeEmailAuth(params: {
        code: string
        walletType?: WalletType
    }): Promise<void> {
        const walletType = params.walletType ?? WalletType.Ethereum;
        const answer = await RequestUtils.hashEmailAuthAnswer(this.challenge, params.code);

        const request: CompleteAuthRequest = {
            identityType: IdentityType.Email,
            authMode: AuthMode.OTP,
            verifier: this.verifier,
            answer,
        }

        const response = await this.client.completeAuth(request);
        await this.activateWalletFromAuthResponse(response, walletType);
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
            scope: this.waasAuthScope,
            ...(oauthRedirectUri !== params.redirectUri ? {redirect_uri: params.redirectUri} : {}),
        })

        this.savePendingOidcRedirectAuth(redirectAuthStorage, {
            verifier: response.verifier,
            nonce,
            provider: provider.name,
            walletType: params.walletType ?? WalletType.Ethereum,
            redirectUri: params.redirectUri,
            issuer: provider.config.issuer,
            waasAuthScope: this.waasAuthScope,
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
    }

    /**
     * Completes an OIDC authorization-code PKCE redirect flow.
     *
     * This validates the state nonce persisted by `startOidcRedirectAuth`, completes
     * WaaS auth, and activates an existing wallet or creates a new one.
     */
    async completeOidcRedirectAuth(
        params: CompleteOidcRedirectAuthParams,
    ): Promise<CompleteOidcRedirectAuthResult> {
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
            }
            const response = await this.client.completeAuth(request)
            await this.activateWalletFromAuthResponse(response, pending.walletType)

            if (!this.walletAddress) {
                throw new Error('OIDC auth completed without an active wallet')
            }

            return {walletAddress: this.walletAddress}
        } finally {
            redirectAuthStorage.delete(Constants.redirectAuthStorageKey)
        }
    }

    /**
     * Browser convenience wrapper for regular web apps.
     *
     * If the current URL contains an OIDC callback, it completes auth. Otherwise it
     * starts auth and redirects to the provider.
     */
    async signInWithOidcRedirect(params: SignInWithOidcRedirectParams<Env>): Promise<void> {
        const currentUrl = params.currentUrl ?? this.browserCurrentUrl()
        const callback = parseOidcCallbackUrl(currentUrl)
        if (callback.code || callback.state || callback.error) {
            await this.completeOidcRedirectAuth({
                callbackUrl: currentUrl,
                cleanUrl: params.cleanUrl ?? true,
                replaceUrl: params.replaceUrl,
            })
            return
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
    }

    async signOut(): Promise<void> {
        await this.clearSession()
    }

    private async clearSession(): Promise<void> {
        this.storage.delete(Constants.walletIdStorageKey)
        this.storage.delete(Constants.walletAddressStorageKey)
        this.storage.delete(Constants.signerStorageKey)
        this.walletId = ''
        this.walletAddress = undefined
        await this.credentialSigner.clear?.()
    }

    async signMessage(params: SignMessageParams): Promise<string> {
        await this.requireActiveSession()
        const request: SignMessageRequest = {
            network: this.parseWalletNetwork(params.network),
            walletId: this.walletId,
            message: params.message,
        }
        const response = await this.client.signMessage(request)
        return response.signature
    }

    async signTypedData(params: SignTypedDataParams): Promise<string> {
        await this.requireActiveSession()
        const request: SignTypedDataRequest = {
            network: this.parseWalletNetwork(params.network),
            walletId: this.walletId,
            typedData: params.typedData,
        }
        const response = await this.client.signTypedData(request)
        return response.signature
    }

    async isValidMessageSignature(params: IsValidMessageSignatureParams): Promise<boolean> {
        const request: IsValidMessageSignatureRequest = {
            network: params.network === undefined ? undefined : this.parseWalletNetwork(params.network),
            walletAddress: params.walletAddress,
            walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
            message: params.message,
            signature: params.signature,
        }
        const response = await this.publicClient.isValidMessageSignature(request)
        return response.isValid
    }

    async isValidTypedDataSignature(params: IsValidTypedDataSignatureParams): Promise<boolean> {
        const request: IsValidTypedDataSignatureRequest = {
            network: params.network === undefined ? undefined : this.parseWalletNetwork(params.network),
            walletAddress: params.walletAddress,
            walletId: params.walletId ?? (params.walletAddress ? undefined : this.activeWalletId()),
            typedData: params.typedData,
            signature: params.signature,
        }
        const response = await this.publicClient.isValidTypedDataSignature(request)
        return response.isValid
    }

    async sendTransaction(params: SendNativeTransactionParams): Promise<SendTransactionResponse>
    async sendTransaction(params: SendDataTransactionParams): Promise<SendTransactionResponse>
    async sendTransaction<
        const abi extends Abi | readonly unknown[],
        functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>,
    >(params: SendContractTransactionParams<abi, functionName>): Promise<SendTransactionResponse>
    async sendTransaction(params: SendTransactionParams): Promise<SendTransactionResponse> {
        await this.requireActiveSession()
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
        })
    }

    async callContract(params: {
        network: Network
        contractAddress: Address
        method: string
        args?: Array<AbiArg>
        mode?: TransactionMode
        selectFeeOption?: FeeOptionSelector
    }): Promise<SendTransactionResponse> {
        await this.requireActiveSession()
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
        })
    }

    async listAccess(): Promise<AccessGrant[]> {
        await this.requireActiveSession()
        const params: ListAccessRequest = { walletId: this.walletId }
        const response = await this.client.listAccess(params)

        return response.credentials.map(c => { return {
            credentialId: c.credentialId,
            expiresAt: c.expiresAt,
            isCaller: c.isCaller
        } })
    }

    async revokeAccess(params: {
        targetCredentialId: string
    }): Promise<void> {
        await this.requireActiveSession()
        const request: RevokeAccessRequest = {
            targetCredentialId: params.targetCredentialId,
            walletId: this.walletId
        }

        await this.client.revokeAccess(request)
    }

    /**
     * Creates a new Ethereum wallet for the authenticated user.
     *
     * The wallet ID and address are persisted to storage so the session can be
     * restored when the configured credential signer is also available.
     */
    private async createWallet(type: WalletType): Promise<void> {
        const params: CreateWalletRequest = { type: type }
        const response = await this.client.createWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address)
    }

    /**
     * Loads an existing wallet by its server-side ID.
     *
     * The wallet ID and address are persisted to storage.
     */
    private async useWallet(walletId: string): Promise<void> {
        const params: UseWalletRequest = { walletId }
        const response = await this.client.useWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address)
    }

    private async activateWalletFromAuthResponse(
        response: CompleteAuthResponse,
        walletType: WalletType,
    ): Promise<void> {
        for (const wallet of response.wallets) {
            if (wallet.type === walletType) {
                await this.useWallet(wallet.id)
                return
            }
        }

        await this.createWallet(walletType)
    }

    /** Saves wallet metadata. The non-extractable credential key is owned by the signer. */
    private persistSession(walletId: string, walletAddress: string): void {
        this.walletId      = walletId
        this.walletAddress = walletAddress as Address
        this.storage.set(Constants.walletIdStorageKey,      walletId)
        this.storage.set(Constants.walletAddressStorageKey, walletAddress)
        this.storage.delete(Constants.signerStorageKey)
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
                typeof parsed.waasAuthScope !== 'string'
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
                waasAuthScope: parsed.waasAuthScope,
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
        if (state.scope !== pending.waasAuthScope) {
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
        const status = await this.waitForTransactionStatus(params.prepared.txnId, executed.status)

        return {
            txnId: params.prepared.txnId,
            status: status.status,
            txHash: status.txnHash,
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
    ): Promise<TransactionStatusResponse> {
        const deadline = Date.now() + this.transactionStatusPollTimeoutMs
        let lastStatus: TransactionStatusResponse = {status: fallbackStatus}
        let completedPolls = 0

        do {
            lastStatus = await this.client.transactionStatus({txnId: txnId} as TransactionStatusRequest)
            completedPolls += 1
            if (lastStatus.status === TransactionStatus.Executed || lastStatus.txnHash) {
                return lastStatus
            }
            const pollDelayMs = this.transactionStatusPollDelayMs(completedPolls)
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

    private transactionStatusPollDelayMs(completedPolls: number): number {
        return completedPolls < this.fastTransactionStatusPollCount
            ? this.fastTransactionStatusPollIntervalMs
            : this.transactionStatusPollIntervalMs
    }

    private async requireActiveSession(): Promise<void> {
        if (!this.walletId) {
            throw new Error('No active wallet session')
        }

        if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
            await this.clearSession()
            throw new Error('No active wallet session')
        }
    }

    private activeWalletId(): string | undefined {
        return this.walletId || undefined
    }

    private parseWalletNetwork(network: Network): string {
        if (typeof network === 'string') {
            const normalized = network.toLowerCase()
            return this.networks.getChainIdByName(normalized)?.toString() ?? normalized
        } else if (typeof network === 'bigint') {
            return network.toString()
        } else {
            return BigInt(network.id).toString()
        }
    }

    private parseIndexerNetwork(network: Network): string {
        if (typeof network === 'string') {
            const normalized = network.toLowerCase()
            if (/^\d+$/.test(normalized)) {
                return this.networks.findChainNameById(BigInt(normalized)) ?? normalized
            }
            return normalized
        } else if (typeof network === 'bigint') {
            return this.networks.findChainNameById(network) ?? network.toString()
        } else {
            const chainId = BigInt(network.id)
            return this.networks.findChainNameById(chainId) ?? chainId.toString()
        }
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
}

function defaultRedirectAuthStorage(): StorageManager | undefined {
    return typeof sessionStorage === 'undefined'
        ? undefined
        : new SessionStorageManager()
}

function createAccessKeyFetch(projectAccessKey: string): Fetch {
    return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const existingHeaders = (init?.headers ?? {}) as Record<string, string>
        const headers: Record<string, string> = {
            ...existingHeaders,
            'X-Access-Key': projectAccessKey,
        }

        return globalThis.fetch(input, {...init, headers})
    }
}

function isWalletType(value: unknown): value is WalletType {
    return typeof value === 'string' && Object.values(WalletType).includes(value as WalletType)
}
