import { getAddress, isAddress, type Address } from "viem"
import type { Network } from "./networks.js"
import type {
  SendDataTransactionParams,
  SendNativeTransactionParams,
  SendTransactionResponse,
} from "./types/transactionTypes.js"
import {
  WalletEip1193ProviderCore,
  type WalletEip1193ClientLike,
  type WalletEip1193WalletLike,
} from "./walletEip1193ProviderCore.js"
import {
  attachWalletFeeOptionsRuntime,
  createWalletFeeOptionsBridge,
  type WalletFeeOptionsBridgeV1,
} from "./walletRuntime.js"

const DEFAULT_CHAIN_ID = 137

export interface Eip1193WalletLike extends WalletEip1193WalletLike {
  onSessionExpired?(
    listener: (event: unknown) => void | Promise<void>,
  ): () => void
}

export interface Eip1193ClientLike extends WalletEip1193ClientLike {
  wallet: Eip1193WalletLike
}

export interface Eip1193ProviderOptions {
  client: Eip1193ClientLike
  initialChainId?: number
  networks?: readonly Network[]
  walletId?: string
  name?: string
}

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
  syncAccountsChanged(): void
}

type ProviderListener = (...args: unknown[]) => void
type WalletFeeOptionsBridge = WalletFeeOptionsBridgeV1 & {
  selectFeeOption(
    feeOptions: Parameters<
      NonNullable<SendNativeTransactionParams["selectFeeOption"]>
    >[0],
    context: { chainId: number },
  ): ReturnType<NonNullable<SendNativeTransactionParams["selectFeeOption"]>>
}

class Eip1193ProviderImpl implements Eip1193Provider {
  private currentChainId: number
  private readonly core: WalletEip1193ProviderCore
  private readonly listeners = new Map<string, Set<ProviderListener>>()
  private readonly networks: readonly Network[]

  constructor(
    private readonly options: Eip1193ProviderOptions,
    feeOptionsBridge: WalletFeeOptionsBridge,
  ) {
    this.networks = options.networks ?? options.client.supportedNetworks ?? []
    const initialChainId = resolveInitialChainId(
      this.networks,
      options.initialChainId,
    )
    if (!initialChainId) {
      throw new Error("EIP-1193 provider requires at least one network.")
    }
    this.requireConfiguredNetwork(initialChainId)
    this.currentChainId = initialChainId
    this.core = new WalletEip1193ProviderCore({
      emit: (event, ...args) => this.emit(event, ...args),
      getChainId: () => this.currentChainId,
      getClient: () => this.options.client,
      getNetworks: () => this.networks,
      setChainId: (chainId) => {
        this.currentChainId = chainId
      },
      walletFeeOptions: feeOptionsBridge,
    })

    options.client.wallet.onSessionExpired?.(() => {
      this.emit("accountsChanged", [])
      this.emit("disconnect", { code: 4900, message: "OMS session expired" })
    })
  }

  on(event: string, listener: ProviderListener): void {
    this.listenersFor(event).add(listener)
  }

  off(event: string, listener: ProviderListener): void {
    this.listenersFor(event).delete(listener)
  }

  removeListener(event: string, listener: ProviderListener): void {
    this.off(event, listener)
  }

  syncAccountsChanged(): void {
    const accounts = this.accounts()
    this.emit("accountsChanged", accounts)
    if (!accounts.length) {
      this.emit("disconnect", { code: 4900, message: "OMS disconnected" })
    }
  }

  request(args: { method: string; params?: unknown }): Promise<unknown> {
    return this.core.request(args)
  }

  private accounts(): readonly Address[] {
    const address = this.options.client.wallet.walletAddress
    return address && isAddress(address) ? [getAddress(address)] : []
  }

  private requireConfiguredNetwork(chainId: number): Network {
    const network = this.networks.find((candidate) => candidate.id === chainId)
    if (!network) {
      throw new Error(`OMS does not support chain ${chainId}.`)
    }
    return network
  }

  private listenersFor(event: string): Set<ProviderListener> {
    let listeners = this.listeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(event, listeners)
    }
    return listeners
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listenersFor(event)) {
      listener(...args)
    }
  }
}

export function createEip1193Provider(
  options: Eip1193ProviderOptions,
): Eip1193Provider {
  const feeOptionsBridge = createWalletFeeOptionsBridge()
  const provider = new Eip1193ProviderImpl(options, feeOptionsBridge)

  return attachWalletFeeOptionsRuntime(provider, feeOptionsBridge, {
    displayName: options.name ?? "OMS Wallet",
    walletId: options.walletId ?? "omsWallet",
  })
}

function resolveInitialChainId(
  networks: readonly Network[],
  requestedChainId: number | undefined,
): number | undefined {
  if (requestedChainId !== undefined) {
    return requestedChainId
  }

  return (
    networks.find((network) => network.id === DEFAULT_CHAIN_ID)?.id ??
    networks[0]?.id
  )
}

export type {
  SendDataTransactionParams,
  SendNativeTransactionParams,
  SendTransactionResponse,
}
