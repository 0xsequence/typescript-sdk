import type { Address, Hex, Quantity } from 'viem';

import type {
  FeeOptionSelection,
  FeeOptionWithBalance,
  Network,
  SendTransactionResponse,
  TransactionMode,
  TransactionStatusPollingOptions
} from '@polygonlabs/oms-wallet';

export type OMSWalletNetwork = Network;

export type OMSWalletTransactionStatusPollingOptions = TransactionStatusPollingOptions;

export type OMSWalletFeeOptionSelector = (
  feeOptions: FeeOptionWithBalance[]
) => FeeOptionSelection | undefined | Promise<FeeOptionSelection | undefined>;

export interface OMSWalletTransactionOptions {
  mode?: TransactionMode;
  selectFeeOption?: OMSWalletFeeOptionSelector;
  waitForStatus?: true;
  statusPolling?: OMSWalletTransactionStatusPollingOptions;
}

export interface OMSWalletSendNativeTransactionParams extends OMSWalletTransactionOptions {
  network: OMSWalletNetwork;
  to: Address;
  value: bigint;
  data?: never;
}

export interface OMSWalletSendDataTransactionParams extends OMSWalletTransactionOptions {
  network: OMSWalletNetwork;
  to: Address;
  value?: bigint;
  data: Hex;
}

export type OMSWalletSendTransactionParams =
  OMSWalletSendNativeTransactionParams | OMSWalletSendDataTransactionParams;

export type OMSWalletSendTransactionResponse = SendTransactionResponse;

export interface WalletLike {
  walletAddress: string | undefined;

  signMessage(params: { network: OMSWalletNetwork; message: string }): Promise<string>;
  signTypedData(params: { network: OMSWalletNetwork; typedData: unknown }): Promise<string>;
  sendTransaction(
    params: OMSWalletSendNativeTransactionParams
  ): Promise<OMSWalletSendTransactionResponse>;
  sendTransaction(
    params: OMSWalletSendDataTransactionParams
  ): Promise<OMSWalletSendTransactionResponse>;
  onSessionExpired?(listener: (event: unknown) => void | Promise<void>): () => void;
}

export interface OMSWalletLike {
  wallet: WalletLike;
}

export type MaybePromise<T> = T | Promise<T>;

export interface OMSWalletTransactionContext {
  chainId: number;
  request: OMSWalletProviderTransactionRequest;
}

export interface OMSWalletProviderTransactionRequest {
  from?: Address;
  to?: Address;
  value?: Quantity;
  data?: Hex;
  chainId?: Hex | bigint | number | string;
  [key: string]: unknown;
}

export interface OMSWalletConnectorParameters {
  omsWallet: OMSWalletLike | (() => MaybePromise<OMSWalletLike>);
  id?: string;
  name?: string;
  icon?: string;
  initialChainId?: number;
  networks?: readonly OMSWalletNetwork[];
  transactionOptions?:
    | OMSWalletTransactionOptions
    | ((
        context: OMSWalletTransactionContext
      ) => MaybePromise<OMSWalletTransactionOptions | undefined>);
}
