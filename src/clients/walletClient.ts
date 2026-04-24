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
    IdentityType,
    AuthMode,
    CommitVerifierRequest,
    CompleteAuthRequest,
    CreateWalletRequest,
    UseWalletRequest,
    ListAccessRequest,
    RevokeAccessRequest,
    SignMessageRequest,
    CallContractRequest, AbiArg,
} from '../generated/waas.gen.js'
import {NetworkBindings} from "../utils/networkBindings.js";
import {Network} from "../types/evmTypes.js";
import {
    SendContractTransactionParams,
    SendDataTransactionParams, SendNativeTransactionParams,
    SendTransactionParams
} from "../types/transactionTypes.js";
import {AccessGrant} from "../types/accessGrant.js";

export class WalletClient {
    private readonly client: Walletclient
    private readonly storage: StorageManager
    private readonly networks: NetworkBindings
    private readonly credentialSigner: CredentialSigner

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
        this.networks = new NetworkBindings()
    }

    /**
     * Initiates email-based OTP authentication by sending a one-time code to the given address.
     *
     * After this resolves, show your OTP entry UI and pass the code to `completeEmailSignIn`.
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
     * Must be called after `signInWithEmail`. On success, call `createWallet`
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
            network: this.parseNetwork(params.network),
            walletId: this.walletId,
            message: params.message,
        }
        const response = await this.client.signMessage(request)
        return response.signature
    }

    async sendTransaction(params: SendNativeTransactionParams): Promise<string>
    async sendTransaction(params: SendDataTransactionParams): Promise<string>
    async sendTransaction<
        const abi extends Abi | readonly unknown[],
        functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>,
    >(params: SendContractTransactionParams<abi, functionName>): Promise<string>
    async sendTransaction(params: SendTransactionParams): Promise<string> {
        await this.requireActiveSession()
        const data =
            'abi' in params
                ? encodeFunctionData(params as EncodeFunctionDataParameters)
                : params.data

        const response = await this.client.sendTransaction({
            network: this.parseNetwork(params.network),
            walletId: this.walletId,
            to: params.to,
            value: (params.value ?? 0n).toString(),
            data,
            feeCeiling: params.feeCeiling?.toString(),
            nonce: params.nonce?.toString(),
            mode: TransactionMode.Relayer,
        })

        return response.txHash
    }

    async callContract(params: {
        network: Network
        contractAddress: Address
        method: string
        args?: Array<AbiArg>
        value?: bigint
        feeCeiling?: bigint
        nonce?: bigint
    }): Promise<string> {
        await this.requireActiveSession()
        const request: CallContractRequest = {
            network: this.parseNetwork(params.network),
            walletId: this.walletId,
            contractAddress: params.contractAddress,
            method: params.method,
            args: params.args,
            value: params.value?.toString(),
            feeCeiling: params.feeCeiling?.toString(),
            nonce: params.nonce?.toString(),
            mode: TransactionMode.Relayer,
        }

        const response = await this.client.callContract(request)
        return response.txHash
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

    private async requireActiveSession(): Promise<void> {
        if (!this.walletId) {
            throw new Error('No active wallet session')
        }

        if (this.credentialSigner.hasCredential && !(await this.credentialSigner.hasCredential())) {
            await this.clearSession()
            throw new Error('No active wallet session')
        }
    }

    private parseNetwork(network: Network): string {
        if (typeof network === 'string') {
            return network.toLowerCase()
        } else if (typeof network === 'bigint') {
            return this.networks.getChainNameById(network)
        } else {
            return this.networks.getChainNameById(BigInt(network.id))
        }
    }
}
