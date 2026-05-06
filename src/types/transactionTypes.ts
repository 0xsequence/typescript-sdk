import {Abi, Address, Chain, ContractFunctionName, EncodeFunctionDataParameters, Hex} from "viem";
import {Network} from "./evmTypes.js";
import type {
    FeeOption,
    FeeOptionSelection,
    TransactionMode,
    TransactionStatus,
} from "../generated/waas.gen.js";
import type {TokenBalance} from "../clients/indexerClient.js";

export type {
    FeeOption,
    FeeOptionSelection,
    TransactionMode,
    TransactionStatus,
};

export type FeeOptionWithBalance = {
    feeOption: FeeOption
    balance?: TokenBalance
    available?: string
    availableRaw?: string
    decimals?: number
}

export type FeeOptionSelector = (
    feeOptions: FeeOptionWithBalance[]
) => FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>

export type SendTransactionResponse = {
    txnId: string
    status: TransactionStatus
    txHash?: string
}

export type TransactionStatusPollingOptions = {
    timeoutMs?: number
    intervalMs?: number
    fastIntervalMs?: number
    fastPollCount?: number
}

export type SendTransactionBase = {
    network: Network
    to: Address
    value?: bigint
    mode?: TransactionMode
    selectFeeOption?: FeeOptionSelector
    waitForStatus?: boolean
    statusPolling?: TransactionStatusPollingOptions
}

export type SendNativeTransactionParams = SendTransactionBase & {
    value: bigint
    data?: never
    abi?: never
}

export type SendDataTransactionParams = SendTransactionBase & {
    data: Hex
    abi?: never
}

export type SendContractTransactionParams<
    abi extends Abi | readonly unknown[] = Abi,
    functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>,
> = SendTransactionBase &
    EncodeFunctionDataParameters<abi, functionName> & {
    data?: never
}

export type SendTransactionParams =
    | SendNativeTransactionParams
    | SendDataTransactionParams
    | SendContractTransactionParams
