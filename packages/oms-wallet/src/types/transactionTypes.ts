import type { Abi, Address, ContractFunctionName, EncodeFunctionDataParameters, Hex } from 'viem';

import type { TokenBalance } from '../clients/indexerClient.js';
import type { Network, SolanaNetwork } from '../networks.js';
import type { FeeOption, FeeOptionSelection, TransactionMode, TransactionStatus } from './waas.js';

export type FeeOptionWithBalance = {
  feeOption: FeeOption;
  selection: FeeOptionSelection;
  balance?: TokenBalance;
  available?: string;
  availableRaw?: string;
  decimals?: number;
};

export interface FeeOptionSelector {
  /**
   * Sponsored transactions pass an empty array. Resolving acknowledges the free fee;
   * throw or reject to stop execution.
   */
  (
    feeOptions: FeeOptionWithBalance[]
  ): FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>;
}

// Intentional: merges a `firstAvailable` static onto the FeeOptionSelector function-type name
// (public API). Kept until a non-breaking refactor; see the type+const alternative in review notes.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace FeeOptionSelector {
  export const firstAvailable: FeeOptionSelector = (feeOptions) =>
    feeOptions.find(canPayFeeOption)?.selection;
}

export function feeOptionSelection(feeOption: FeeOption, index?: number): FeeOptionSelection {
  const tokenIdentifier = feeOption.token.tokenID?.trim();
  return {
    token: tokenIdentifier && tokenIdentifier.length > 0 ? tokenIdentifier : feeOption.token.symbol,
    ...(index === undefined ? {} : { index })
  };
}

function canPayFeeOption(option: FeeOptionWithBalance): boolean {
  if (option.availableRaw === undefined) {
    return false;
  }

  try {
    return BigInt(option.availableRaw) >= BigInt(option.feeOption.value);
  } catch {
    return false;
  }
}

export type SendTransactionResponse = {
  txnId: string;
  status: TransactionStatus;
  txnHash?: string;
  statusResolution: 'not-requested' | 'resolved' | 'timed-out';
};

export type TransactionStatusPollingOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  fastIntervalMs?: number;
  fastPollCount?: number;
};

export type SendTransactionBase = {
  network: Network;
  to: Address;
  value?: bigint;
  mode?: TransactionMode;
  selectFeeOption?: FeeOptionSelector;
  waitForStatus?: boolean;
  statusPolling?: TransactionStatusPollingOptions;
};

export type SendNativeTransactionParams = SendTransactionBase & {
  value: bigint;
  data?: never;
  abi?: never;
};

export type SendDataTransactionParams = SendTransactionBase & {
  data: Hex;
  abi?: never;
};

export type SendContractTransactionParams<
  abi extends Abi | readonly unknown[] = Abi,
  functionName extends ContractFunctionName<abi> | undefined = ContractFunctionName<abi>
> = SendTransactionBase &
  EncodeFunctionDataParameters<abi, functionName> & {
    data?: never;
  };

export type SendTransactionParams =
  SendNativeTransactionParams | SendDataTransactionParams | SendContractTransactionParams;

export type SendSolanaTransferParams = {
  network: SolanaNetwork;
  asset: string;
  to: string;
  amount: bigint;
  mode?: TransactionMode;
  selectFeeOption?: FeeOptionSelector;
  waitForStatus?: boolean;
  statusPolling?: TransactionStatusPollingOptions;
};
