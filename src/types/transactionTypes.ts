import {Abi, Address, ContractFunctionName, EncodeFunctionDataParameters, Hex} from "viem";
import type {Network} from "../networks.js";
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
    selection: FeeOptionSelection
    balance?: TokenBalance
    available?: string
    availableRaw?: string
    decimals?: number
}

export interface FeeOptionSelector {
    (feeOptions: FeeOptionWithBalance[]): FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>
}

export namespace FeeOptionSelector {
    export const firstAvailable: FeeOptionSelector = (feeOptions) => feeOptions.find(canPayFeeOption)?.selection
}

export function feeOptionSelection(feeOption: FeeOption): FeeOptionSelection {
    const tokenIdentifier = feeOption.token.tokenID?.trim()
    return {token: tokenIdentifier && tokenIdentifier.length > 0 ? tokenIdentifier : feeOption.token.symbol}
}

function canPayFeeOption(option: FeeOptionWithBalance): boolean {
    if (option.availableRaw === undefined) {
        return false
    }

    try {
        return BigInt(option.availableRaw) >= BigInt(option.feeOption.value)
    } catch {
        return false
    }
}

export type SendTransactionResponse = {
    txnId: string
    status: TransactionStatus
    txnHash?: string
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
