import {
    ContractFunctionName,
    encodeFunctionData,
    Abi,
    Address,
    EncodeFunctionDataParameters} from 'viem'

import {OmsEnvironment} from "../omsEnvironment.js";
import {LocalStorageManager, StorageManager} from "../storageManager.js";
import {createSignedFetch} from "../signedFetch.js";
import {Constants} from "../utils/constants.js";
import {RequestUtils} from "../utils/requestUtils.js";
import {CredentialSigner, WebCryptoP256CredentialSigner} from "../credentialSigner.js";

import {
    Wallet as Walletclient,
    WalletType,
    TransactionMode,
    TransactionStatus,
    IdentityType,
    AuthMode,
    CommitVerifierRequest,
    CompleteAuthRequest,
    CreateWalletRequest,
    UseWalletRequest,
    ListAccessRequest,
    RevokeAccessRequest,
    SignMessageRequest,
    PrepareEthereumTransactionRequest,
    PrepareContractCallRequest,
    ExecuteRequest,
    GetTransactionStatusRequest,
    PrepareResponse,
    TransactionStatusResponse,
    AbiArg,
    FeeOption,
    FeeOptionSelection,
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

export class WalletClient {
    private readonly client: Walletclient
    private readonly storage: StorageManager
    private readonly networks: NetworkBindings
    private readonly credentialSigner: CredentialSigner
    private readonly indexerClient: IndexerClient
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
        environment: OmsEnvironment,
        storage?: StorageManager
        credentialSigner?: CredentialSigner
    }) {
        this.storage = params.storage ?? new LocalStorageManager()
        this.credentialSigner = params.credentialSigner ?? new WebCryptoP256CredentialSigner()

        const storedId      = this.storage.get(Constants.walletIdStorageKey)
        const storedAddress = this.storage.get(Constants.walletAddressStorageKey)

        if (storedId && storedAddress) {
            this.walletId      = storedId
            this.walletAddress = storedAddress as Address
        } else {
            this.walletId      = ''
            this.walletAddress = undefined
        }

        const signedFetch = createSignedFetch(params.projectAccessKey, this.credentialSigner)
        this.client = new Walletclient(params.environment.walletApiUrl, signedFetch)
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

        let walletUsed = false;
        const response = await this.client.completeAuth(request);

        for (const wallet of response.wallets) {
            if (wallet.type === walletType) {
                await this.useWallet(wallet.id);
                walletUsed = true;
            }
        }

        if (!walletUsed) {
            await this.createWallet(walletType);
        }
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

    async signMessage(params: {
        network: Network
        message: string
    }): Promise<string> {
        await this.requireActiveSession()
        const request: SignMessageRequest = {
            network: this.parseWalletNetwork(params.network),
            walletId: this.walletId,
            message: params.message,
        }
        const response = await this.client.signMessage(request)
        return response.signature
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
        const request: PrepareContractCallRequest = {
            network: this.parseWalletNetwork(params.network),
            walletId: this.walletId,
            contract: params.contractAddress,
            method: params.method,
            args: params.args,
            mode: params.mode ?? TransactionMode.Relayer,
        }

        const prepared = await this.client.prepareContractCall(request)
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

    /** Saves wallet metadata. The non-extractable credential key is owned by the signer. */
    private persistSession(walletId: string, walletAddress: string): void {
        this.walletId      = walletId
        this.walletAddress = walletAddress as Address
        this.storage.set(Constants.walletIdStorageKey,      walletId)
        this.storage.set(Constants.walletAddressStorageKey, walletAddress)
        this.storage.delete(Constants.signerStorageKey)
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
            lastStatus = await this.client.getTransactionStatus({txnId: txnId} as GetTransactionStatusRequest)
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
