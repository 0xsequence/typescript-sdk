import {OmsEnvironment} from "../omsEnvironment";
import {LocalStorageManager, StorageManager} from "../storageManager";
import {createSignedFetch} from "../signedFetch";
import {Constants} from "../utils/constants";
import {RequestUtils} from "../utils/requestUtils";
import {ByteUtils} from "../utils/byteUtils";
import {EvmHelper} from "../utils/EvmHelper";

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
    SendTransactionRequest,
    CallContractRequest,
    CredentialInfo,
} from '../generated/waas.gen'

export class WalletClient {
    private readonly client: Walletclient
    private readonly storage: StorageManager

    /** The on-chain address of this wallet. Empty until a wallet is created or loaded. */
    public walletAddress: string

    /** The server-side wallet ID used in API calls. Empty until a wallet is created or loaded. */
    public walletId: string

    private readonly sessionPrivateKey: Uint8Array
    private verifier = ''
    private challenge = ''

    constructor(
        projectAccessKey: string,
        environment: OmsEnvironment,
        storage?: StorageManager
    ) {
        this.storage = storage ?? new LocalStorageManager()

        const storedId      = this.storage.get(Constants.walletIdStorageKey)
        const storedAddress = this.storage.get(Constants.walletAddressStorageKey)
        const storedKey     = this.storage.get(Constants.signerStorageKey)

        if (storedId && storedAddress && storedKey) {
            this.walletId      = storedId
            this.walletAddress = storedAddress
            this.sessionPrivateKey = ByteUtils.hexToBytes(storedKey)
        } else {
            this.walletId      = ''
            this.walletAddress = ''
            this.sessionPrivateKey = EvmHelper.generatePrivateKey()
        }

        const signedFetch = createSignedFetch(projectAccessKey, this.sessionPrivateKey)
        this.client = new Walletclient(environment.walletApiUrl, signedFetch)
    }

    /**
     * Initiates email-based OTP authentication by sending a one-time code to the given address.
     *
     * After this resolves, show your OTP entry UI and pass the code to `completeEmailSignIn`.
     */
    async signInWithEmail(email: string): Promise<void> {
        const params: CommitVerifierRequest = {
            identityType: IdentityType.Email,
            authMode: AuthMode.OTP,
            metadata: {},
            handle: email,
        }
        const response = await this.client.commitVerifier(params)
        this.verifier  = response.verifier
        this.challenge = response.challenge
    }

    /**
     * Completes the email OTP flow by verifying the code the user received.
     *
     * Must be called after `signInWithEmail`. On success, call `createWallet`
     * or `useWallet` to activate a wallet.
     */
    async completeEmailSignIn(code: string, walletType: WalletType = WalletType.Ethereum): Promise<void> {
        const answer = await RequestUtils.hashEmailAuthAnswer(this.challenge, code);

        const params: CompleteAuthRequest = {
            identityType: IdentityType.Email,
            authMode: AuthMode.OTP,
            verifier: this.verifier,
            answer,
        }

        let walletUsed = false;
        const response = await this.client.completeAuth(params);

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

    clearSession(): void {
        this.storage.delete(Constants.walletIdStorageKey)
        this.storage.delete(Constants.walletAddressStorageKey)
        this.storage.delete(Constants.signerStorageKey)
    }

    /**
     * Returns the credentials that currently have access to this wallet.
     */
    async listAccess(): Promise<CredentialInfo[]> {
        const params: ListAccessRequest = { walletId: this.walletId }
        const response = await this.client.listAccess(params)
        return response.credentials
    }

    /**
     * Revokes access for a specific credential.
     *
     * Use `listAccess()` first to retrieve the available credential IDs.
     */
    async revokeAccess(targetCredentialId: string): Promise<void> {
        const params: RevokeAccessRequest = { targetCredentialId, walletId: this.walletId }
        await this.client.revokeAccess(params)
    }

    /**
     * Signs an arbitrary message using the wallet's session key.
     *
     * @param network - Network identifier, e.g. `"mainnet"` or `"polygon"`.
     * @param message - The plaintext message to sign.
     * @returns A hex-encoded signature string.
     */
    async signMessage(network: string, message: string): Promise<string> {
        const params: SignMessageRequest = {
            network,
            walletId: this.walletId,
            message,
        }
        const response = await this.client.signMessage(params)
        return response.signature
    }

    /**
     * Sends a native token transfer via the Sequence relayer (no gas tokens required).
     *
     * @param network - Network to submit on, e.g. `"mainnet"` or `"polygon"`.
     * @param to      - Recipient address.
     * @param value   - Amount in the network's smallest denomination (e.g. wei).
     * @returns The transaction hash.
     */
    async sendTransaction(network: string, to: string, value: string): Promise<string> {
        const params: SendTransactionRequest = {
            network,
            walletId: this.walletId,
            to,
            value,
            mode: TransactionMode.Relayer,
        }
        const response = await this.client.sendTransaction(params)
        return response.txHash
    }

    /**
     * Calls a smart contract function.
     *
     * @param params - Full request describing the target contract, method, args, and network.
     * @returns The transaction hash.
     */
    async callContract(params: CallContractRequest): Promise<string> {
        const response = await this.client.callContract(params)
        return response.txHash
    }

    /**
     * Creates a new Ethereum wallet for the authenticated user.
     *
     * The wallet ID, address, and session key are persisted to storage so the
     * session can be restored on future launches.
     */
    private async createWallet(type: WalletType): Promise<void> {
        const params: CreateWalletRequest = { type: type }
        const response = await this.client.createWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address)
    }

    /**
     * Loads an existing wallet by its server-side ID.
     *
     * The wallet ID, address, and session key are persisted to storage.
     */
    private async useWallet(walletId: string): Promise<void> {
        const params: UseWalletRequest = { walletId }
        const response = await this.client.useWallet(params)
        this.persistSession(response.wallet.id, response.wallet.address)
    }

    /** Saves the wallet ID, address, and session key to storage. */
    private persistSession(walletId: string, walletAddress: string): void {
        this.walletId      = walletId
        this.walletAddress = walletAddress
        this.storage.set(Constants.walletIdStorageKey,      walletId)
        this.storage.set(Constants.walletAddressStorageKey, walletAddress)
        this.storage.set(Constants.signerStorageKey,        ByteUtils.bytesToHex(this.sessionPrivateKey))
    }
}