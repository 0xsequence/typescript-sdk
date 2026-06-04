import type { Address, Hex, Quantity } from "viem";
import type {
    FeeOptionSelection,
    FeeOptionWithBalance,
    Network,
    SendTransactionResponse,
    TransactionMode,
    TransactionStatusPollingOptions,
} from "@0xsequence/typescript-sdk";

export type OmsWalletNetwork = Network;

export type OmsWalletTransactionStatusPollingOptions = TransactionStatusPollingOptions;

export type OmsWalletFeeOptionSelector = (
    feeOptions: FeeOptionWithBalance[]
) => FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>;

export interface OmsWalletTransactionOptions {
    mode?: TransactionMode
    selectFeeOption?: OmsWalletFeeOptionSelector
    waitForStatus?: true
    statusPolling?: OmsWalletTransactionStatusPollingOptions
}

export interface OmsWalletSendNativeTransactionParams extends OmsWalletTransactionOptions {
    network: OmsWalletNetwork
    to: Address
    value: bigint
    data?: never
}

export interface OmsWalletSendDataTransactionParams extends OmsWalletTransactionOptions {
    network: OmsWalletNetwork
    to: Address
    value?: bigint
    data: Hex
}

export type OmsWalletSendTransactionParams =
    | OmsWalletSendNativeTransactionParams
    | OmsWalletSendDataTransactionParams;

export type OmsWalletSendTransactionResponse = SendTransactionResponse;

export interface OmsWalletLike {
    walletAddress: Address | undefined

    signMessage(params: {network: OmsWalletNetwork; message: string}): Promise<string>
    signTypedData(params: {network: OmsWalletNetwork; typedData: unknown}): Promise<string>
    sendTransaction(params: OmsWalletSendNativeTransactionParams): Promise<OmsWalletSendTransactionResponse>
    sendTransaction(params: OmsWalletSendDataTransactionParams): Promise<OmsWalletSendTransactionResponse>
    onSessionExpired?(listener: (event: unknown) => void | Promise<void>): () => void
}

export interface OmsWalletClientLike {
    wallet: OmsWalletLike
    supportedNetworks?: readonly OmsWalletNetwork[]
}

export type MaybePromise<T> = T | Promise<T>;

export interface OmsWalletTransactionContext {
    chainId: number
    request: OmsWalletProviderTransactionRequest
}

export interface OmsWalletProviderTransactionRequest {
    from?: Address
    to?: Address
    value?: Quantity
    data?: Hex
    chainId?: Hex | bigint | number | string
    [key: string]: unknown
}

export interface OmsWalletConnectorParameters {
    client: OmsWalletClientLike | (() => MaybePromise<OmsWalletClientLike>)
    id?: string
    name?: string
    icon?: string
    initialChainId?: number
    networks?: readonly OmsWalletNetwork[]
    transactionOptions?:
        | OmsWalletTransactionOptions
        | ((context: OmsWalletTransactionContext) => MaybePromise<OmsWalletTransactionOptions | undefined>)
}
