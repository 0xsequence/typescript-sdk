import type { Address } from 'abitype'
import type { Chain } from 'viem'

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
    CallContractRequest, AbiArg,
} from '../generated/waas.gen'
import {NetworkBindings} from "../utils/networkBindings";
import * as net from "node:net";

export interface AccessGrant {
    credentialId: string
    expiresAt: string
    isCaller: boolean
}

type Networkish = string | bigint | Chain;

export class WalletClient {
    private readonly client: Walletclient
    private readonly storage: StorageManager
    private readonly networks: NetworkBindings

    /** The on-chain address of this wallet. Empty until a wallet is created or loaded. */
    public walletAddress: Address

    private walletId: string
    private readonly sessionPrivateKey: Uint8Array
    private verifier = ''
    private challenge = ''

    constructor(params: {
        projectAccessKey: string,
        environment: OmsEnvironment,
        storage?: StorageManager
    }) {
        this.storage = params.storage ?? new LocalStorageManager()

        const storedId      = this.storage.get(Constants.walletIdStorageKey)
        const storedAddress = this.storage.get(Constants.walletAddressStorageKey)
        const storedKey     = this.storage.get(Constants.signerStorageKey)

        if (storedId && storedAddress && storedKey) {
            this.walletId      = storedId
            this.walletAddress = storedAddress as Address
            this.sessionPrivateKey = ByteUtils.hexToBytes(storedKey)
        } else {
            this.walletId      = ''
            this.walletAddress = '0x00' as Address
            this.sessionPrivateKey = EvmHelper.generatePrivateKey()
        }

        const signedFetch = createSignedFetch(params.projectAccessKey, this.sessionPrivateKey)
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

    signOut(): void {
        this.storage.delete(Constants.walletIdStorageKey)
        this.storage.delete(Constants.walletAddressStorageKey)
        this.storage.delete(Constants.signerStorageKey)
    }

    /**
     * Returns the credentials that currently have access to this wallet.
     */
    async listAccess(): Promise<AccessGrant[]> {
        const params: ListAccessRequest = { walletId: this.walletId }
        const response = await this.client.listAccess(params)

        return response.credentials.map(c => { return {
            credentialId: c.credentialId,
            expiresAt: c.expiresAt,
            isCaller: c.isCaller
        } })
    }

    /**
     * Revokes access for a specific credential.
     *
     * Use `listAccess()` first to retrieve the available credential IDs.
     */
    async revokeAccess(params: {
        targetCredentialId: string
    }): Promise<void> {
        const request: RevokeAccessRequest = {
            targetCredentialId: params.targetCredentialId,
            walletId: this.walletId
        }

        await this.client.revokeAccess(request)
    }

    async signMessage(params: {
        network: Networkish
        message: string
    }): Promise<string> {
        const request: SignMessageRequest = {
            network: this.parseNetwork(params.network),
            walletId: this.walletId,
            message: params.message,
        }
        const response = await this.client.signMessage(request)
        return response.signature
    }

    async sendTransaction(params: {
        network: Networkish
        to: Address
        value: bigint
    }): Promise<string> {
        const request: SendTransactionRequest = {
            network: this.parseNetwork(params.network),
            walletId: this.walletId,
            to: params.to,
            value: params.value.toString(),
            mode: TransactionMode.Relayer,
        }
        const response = await this.client.sendTransaction(request)
        return response.txHash
    }

    /**
     * Calls a smart contract function.
     *
     * @param params - Full request describing the target contract, method, args, and network.
     * @returns The transaction hash.
     */
    async callContract(params: {
        network: Networkish
        contractAddress: Address
        method: string
        args?: Array<AbiArg>
        value?: bigint
        feeCeiling?: bigint
        nonce?: bigint
    }): Promise<string> {
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
        this.walletAddress = walletAddress as Address
        this.storage.set(Constants.walletIdStorageKey,      walletId)
        this.storage.set(Constants.walletAddressStorageKey, walletAddress)
        this.storage.set(Constants.signerStorageKey,        ByteUtils.bytesToHex(this.sessionPrivateKey))
    }

    private parseNetwork(network: Networkish): string {
        if (typeof network === 'string') {
            return network.toLowerCase()
        } else if (typeof network === 'bigint') {
            return this.networks.getChainNameById(network)
        } else {
            return this.networks.getChainNameById(BigInt(network.id))
        }
    }
}