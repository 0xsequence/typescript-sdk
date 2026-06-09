import type {
  FeeOptionSelection,
  FeeOptionWithBalance,
} from "./types/transactionTypes.js"

/**
 * V1 wallet runtime contract shared structurally with Trails.
 *
 * This file intentionally has no React or wagmi dependency. Trails keeps a
 * matching local copy of the tiny discovery/guard surface and interoperates at
 * runtime through Symbol.for(WALLET_RUNTIME_SYMBOL_DESCRIPTION) plus the
 * enumerable string key below. Keep changes to this protocol coordinated.
 */
export const WALLET_RUNTIME_SYMBOL_DESCRIPTION = "wallet.runtime"
export const WALLET_RUNTIME_SYMBOL = Symbol.for(
  WALLET_RUNTIME_SYMBOL_DESCRIPTION,
)
export const WALLET_RUNTIME_KEY = "walletRuntime"

const UNHANDLED_WALLET_FEE_OPTIONS_REQUEST_GRACE_MS = 0
const UNHANDLED_WALLET_FEE_OPTIONS_REQUEST_MESSAGE =
  "Wallet fee-option selection requires a subscribed dapp fee-option controller."

export interface WalletRuntimeV1 {
  version: 1
  walletId?: string
  displayName?: string
  capabilities: {
    feeOptions?: WalletFeeOptionsBridgeV1
  }
}

export interface WalletFeeTokenViewV1 {
  chainId?: number
  contractAddress?: string | null
  decimals?: number
  logoURL?: string
  name?: string
  symbol?: string
}

export interface WalletFeeOptionViewV1 {
  id: string
  balance?: string
  hasEnoughBalanceForFee?: boolean
  token: WalletFeeTokenViewV1
  value?: string
}

export interface WalletFeeOptionRequestV1 {
  chainId: number
  id: string
  options: WalletFeeOptionViewV1[]
}

export interface WalletFeeOptionsBridgeV1 {
  version: 1
  required?: boolean
  subscribe(listener: () => void): () => void
  getSnapshot(): WalletFeeOptionRequestV1 | undefined
  confirm(requestId: string, optionId: string): void
  reject(requestId: string, error?: Error): void
}

interface PendingFeeOptionSelection {
  id: string
  request: WalletFeeOptionRequestV1
  optionsById: Map<string, FeeOptionWithBalance>
  resolve: (selection: FeeOptionSelection | undefined) => void
  reject: (error: Error) => void
  unhandledTimeoutId?: ReturnType<typeof setTimeout>
}

export function createWalletFeeOptionsBridge(): WalletFeeOptionsBridgeV1 & {
  selectFeeOption(
    feeOptions: FeeOptionWithBalance[],
    context: { chainId: number },
  ): Promise<FeeOptionSelection | undefined>
} {
  let pending: PendingFeeOptionSelection | undefined
  let nextId = 0
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  const clearUnhandledTimeout = (
    selection: PendingFeeOptionSelection | undefined,
  ) => {
    if (selection?.unhandledTimeoutId !== undefined) {
      clearTimeout(selection.unhandledTimeoutId)
      selection.unhandledTimeoutId = undefined
    }
  }

  const clearPending = () => {
    clearUnhandledTimeout(pending)
    pending = undefined
    notify()
  }

  const rejectPending = (error: Error) => {
    if (!pending) {
      return
    }

    const selection = pending
    clearPending()
    selection.reject(error)
  }

  const scheduleUnhandledRequestRejection = () => {
    if (
      !pending ||
      listeners.size > 0 ||
      pending.unhandledTimeoutId !== undefined
    ) {
      return
    }

    pending.unhandledTimeoutId = setTimeout(() => {
      if (pending && listeners.size === 0) {
        rejectPending(new Error(UNHANDLED_WALLET_FEE_OPTIONS_REQUEST_MESSAGE))
      }
    }, UNHANDLED_WALLET_FEE_OPTIONS_REQUEST_GRACE_MS)
  }

  const settle = (
    id: string,
    handler: (selection: PendingFeeOptionSelection) => void,
  ) => {
    if (!pending || pending.id !== id) {
      return
    }

    const selection = pending
    clearPending()
    handler(selection)
  }

  return {
    version: 1,
    required: true,
    subscribe(listener: () => void) {
      listeners.add(listener)
      clearUnhandledTimeout(pending)
      return () => {
        listeners.delete(listener)
        scheduleUnhandledRequestRejection()
      }
    },
    getSnapshot() {
      return pending?.request
    },
    async selectFeeOption(
      feeOptions: FeeOptionWithBalance[],
      context: { chainId: number },
    ): Promise<FeeOptionSelection | undefined> {
      if (feeOptions.length === 0) {
        return undefined
      }

      rejectPending(new Error("Fee option selection was superseded."))

      const requestId = `wallet-fee-${++nextId}`
      const optionsById = new Map<string, FeeOptionWithBalance>()
      const options = feeOptions.map((option, index) => {
        const optionId = createFeeOptionId(index)
        optionsById.set(optionId, option)
        return toFeeOptionView(option, optionId, context.chainId)
      })

      return new Promise<FeeOptionSelection | undefined>((resolve, reject) => {
        pending = {
          id: requestId,
          request: {
            id: requestId,
            chainId: context.chainId,
            options,
          },
          optionsById,
          resolve,
          reject,
        }
        notify()
        scheduleUnhandledRequestRejection()
      })
    },
    confirm(id: string, optionId: string) {
      settle(id, (selection) => {
        const option = selection.optionsById.get(optionId)
        if (!option) {
          selection.reject(new Error(`Unknown fee option id: ${optionId}`))
          return
        }

        selection.resolve(toFeeOptionSelection(option))
      })
    },
    reject(id: string, error = new Error("Fee option selection rejected.")) {
      settle(id, (selection) => selection.reject(error))
    },
  }
}

export function createWalletRuntimeV1({
  feeOptions,
  displayName = "Wallet",
  walletId,
}: {
  feeOptions?: WalletFeeOptionsBridgeV1
  displayName?: string
  walletId?: string
} = {}): WalletRuntimeV1 {
  return {
    version: 1,
    walletId,
    displayName,
    capabilities: {
      feeOptions,
    },
  }
}

export function attachWalletRuntime<T extends object>(
  target: T,
  runtime: WalletRuntimeV1,
): T {
  Object.defineProperties(target, {
    [WALLET_RUNTIME_SYMBOL]: {
      value: runtime,
      configurable: false,
      enumerable: false,
      writable: false,
    },
    [WALLET_RUNTIME_KEY]: {
      value: runtime,
      configurable: false,
      enumerable: true,
      writable: false,
    },
  })
  return target
}

export function attachWalletFeeOptionsRuntime<T extends object>(
  target: T,
  walletFeeOptions: WalletFeeOptionsBridgeV1,
  options: { displayName?: string; walletId?: string } = {},
): T {
  return attachWalletRuntime(
    target,
    createWalletRuntimeV1({
      ...options,
      feeOptions: walletFeeOptions,
    }),
  )
}

export function getWalletRuntime(target: unknown): WalletRuntimeV1 | undefined {
  if (typeof target !== "object" || target === null) {
    return undefined
  }

  const record = target as Record<PropertyKey, unknown>
  const runtime = record[WALLET_RUNTIME_SYMBOL] ?? record[WALLET_RUNTIME_KEY]

  return isWalletRuntimeV1(runtime) ? runtime : undefined
}

export function getWalletFeeOptionsBridge(
  target: unknown,
): WalletFeeOptionsBridgeV1 | undefined {
  return getWalletRuntime(target)?.capabilities.feeOptions
}

export function isWalletRuntimeV1(value: unknown): value is WalletRuntimeV1 {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const runtime = value as WalletRuntimeV1
  return (
    runtime.version === 1 &&
    typeof runtime.capabilities === "object" &&
    runtime.capabilities !== null &&
    (runtime.capabilities.feeOptions === undefined ||
      isWalletFeeOptionsBridgeV1(runtime.capabilities.feeOptions))
  )
}

export function isWalletFeeOptionsBridgeV1(
  value: unknown,
): value is WalletFeeOptionsBridgeV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as WalletFeeOptionsBridgeV1).version === 1 &&
    typeof (value as WalletFeeOptionsBridgeV1).subscribe === "function" &&
    typeof (value as WalletFeeOptionsBridgeV1).getSnapshot === "function" &&
    typeof (value as WalletFeeOptionsBridgeV1).confirm === "function" &&
    typeof (value as WalletFeeOptionsBridgeV1).reject === "function"
  )
}

function toFeeOptionView(
  option: FeeOptionWithBalance,
  id: string,
  chainId: number,
): WalletFeeOptionViewV1 {
  const { feeOption, availableRaw, decimals } = option
  const view: WalletFeeOptionViewV1 = {
    id,
    value: feeOption.value,
    token: {
      chainId,
      contractAddress: normalizeNativeTokenAddress(
        feeOption.token.contractAddress,
      ),
      decimals: feeOption.token.decimals ?? decimals,
      logoURL: feeOption.token.logoURL,
      name: feeOption.token.name,
      symbol: feeOption.token.symbol,
    },
  }

  if (availableRaw !== undefined) {
    view.balance = availableRaw
    view.hasEnoughBalanceForFee = canPayFeeOption(option)
  }

  return view
}

function createFeeOptionId(index: number): string {
  return `fee-option-${index}`
}

function toFeeOptionSelection(option: FeeOptionWithBalance | undefined) {
  return option ? { token: option.feeOption.token.symbol } : undefined
}

function canPayFeeOption(option: FeeOptionWithBalance): boolean {
  try {
    return (
      option.availableRaw !== undefined &&
      BigInt(option.availableRaw) >= BigInt(option.feeOption.value)
    )
  } catch {
    return false
  }
}

function normalizeNativeTokenAddress(address: string | null | undefined) {
  if (!address) {
    return null
  }

  const normalizedAddress = address.toLowerCase()
  return normalizedAddress === "0x0000000000000000000000000000000000000000"
    ? null
    : normalizedAddress
}
