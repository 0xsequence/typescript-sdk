import {Chain, ContractFunctionName, EncodeFunctionDataParameters, Hex} from "viem";
import type {Abi, Address} from "abitype";
import {Network} from "./evmTypes.js";

export type SendTransactionBase = {
    network: Network
    to: Address
    value?: bigint
    feeCeiling?: bigint
    nonce?: bigint
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
