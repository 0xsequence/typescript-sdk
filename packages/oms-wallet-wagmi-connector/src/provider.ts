import { stringToHex, type Address, type Hex } from "viem"
import {
  WalletEip1193ProviderCore,
  WalletEip1193ProviderRpcError,
  type WalletEip1193TransactionOptions,
  type WalletEip1193TransactionRequest,
} from "@0xsequence/typescript-sdk"

import type { WalletFeeOptionsBridge } from "./walletFeeOptions.js"
import type {
  MaybePromise,
  OmsWalletClientLike,
  OmsWalletConnectorParameters,
  OmsWalletNetwork,
} from "./types.js"

const providerEvents = [
  "accountsChanged",
  "chainChanged",
  "connect",
  "disconnect",
  "message",
] as const

type ProviderEvent = (typeof providerEvents)[number]
type ProviderListener = (...args: unknown[]) => void

export class OmsWalletProviderRpcError extends WalletEip1193ProviderRpcError {
  constructor(
    code: number,
    message: string,
    data?: unknown,
  ) {
    super(code, message, data)
    this.name = "OmsWalletProviderRpcError"
  }
}

export class OmsWalletProvider {
  private readonly core: WalletEip1193ProviderCore
  private readonly listeners = new Map<ProviderEvent, Set<ProviderListener>>()

  constructor(
    private readonly params: OmsWalletConnectorParameters,
    getClient: () => MaybePromise<OmsWalletClientLike>,
    getChainId: () => number,
    _setChainId: (chainId: number) => void,
    syncChainId: (chainId: number) => void,
    getNetworks: () => MaybePromise<readonly OmsWalletNetwork[]>,
    isChainConfigured: (chainId: number) => boolean,
    connectWallet: (parameters?: {
      isReconnecting?: boolean
    }) => Promise<readonly Address[]>,
    isDisconnected: () => MaybePromise<boolean>,
    walletFeeOptions?: WalletFeeOptionsBridge,
  ) {
    this.core = new WalletEip1193ProviderCore({
      createError: (code, message, data) =>
        new OmsWalletProviderRpcError(code, message, data),
      emit: (event, ...args) => {
        this.emit(event as ProviderEvent, ...args)
      },
      getChainId,
      getClient,
      getNetworks,
      isChainConfigured,
      isDisconnected,
      requestAccounts: connectWallet,
      setChainId: syncChainId,
      transactionOptions: ({ chainId, request }) =>
        this.resolveTransactionOptions(request, chainId),
      walletFeeOptions,
    })
  }

  on(event: ProviderEvent, listener: ProviderListener): this {
    this.listenersFor(event).add(listener)
    return this
  }

  off(event: ProviderEvent, listener: ProviderListener): this {
    this.listenersFor(event).delete(listener)
    return this
  }

  removeListener(event: ProviderEvent, listener: ProviderListener): this {
    return this.off(event, listener)
  }

  emit(event: ProviderEvent, ...args: unknown[]): void {
    for (const listener of this.listenersFor(event)) {
      listener(...args)
    }
  }

  request(args: { method: string; params?: unknown }): Promise<unknown> {
    return this.core.request(args)
  }

  private async resolveTransactionOptions(
    request: WalletEip1193TransactionRequest,
    chainId: number,
  ): Promise<WalletEip1193TransactionOptions | undefined> {
    const options = this.params.transactionOptions
    const resolvedOptions =
      typeof options === "function"
        ? await options({
            chainId,
            request: request as never,
          })
        : options

    return resolvedOptions as WalletEip1193TransactionOptions | undefined
  }

  private listenersFor(event: ProviderEvent): Set<ProviderListener> {
    let listeners = this.listeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(event, listeners)
    }
    return listeners
  }
}

export function stringToPersonalSignHex(message: string): Hex {
  return stringToHex(message)
}
