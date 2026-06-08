import {
  getAddress,
  hexToBigInt,
  hexToBytes,
  isAddress,
  isHex,
  numberToHex,
  type Address,
  type Hex,
} from "viem"
import type { Network } from "./networks.js"
import type {
  FeeOptionSelector,
  SendDataTransactionParams,
  SendNativeTransactionParams,
  SendTransactionResponse,
  TransactionMode,
  TransactionStatusPollingOptions,
} from "./types/transactionTypes.js"

export type MaybePromise<T> = T | Promise<T>

export interface WalletEip1193WalletLike {
  walletAddress: Address | undefined
  signMessage(params: { network: Network; message: string }): Promise<string>
  signTypedData(params: {
    network: Network
    typedData: unknown
  }): Promise<string>
  sendTransaction(
    params: SendNativeTransactionParams,
  ): Promise<SendTransactionResponse>
  sendTransaction(
    params: SendDataTransactionParams,
  ): Promise<SendTransactionResponse>
}

export interface WalletEip1193ClientLike {
  wallet: WalletEip1193WalletLike
  supportedNetworks?: readonly Network[]
}

export interface WalletEip1193TransactionOptions {
  mode?: TransactionMode
  selectFeeOption?: FeeOptionSelector
  waitForStatus?: boolean
  statusPolling?: TransactionStatusPollingOptions
}

export interface WalletEip1193TransactionContext {
  chainId: number
  request: WalletEip1193TransactionRequest
}

export interface WalletEip1193TransactionRequest {
  chainId?: Hex | bigint | number | string
  data?: Hex
  from?: Address
  to?: Address
  value?: Hex | bigint | number | string
  [key: string]: unknown
}

export class WalletEip1193ProviderRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = "WalletEip1193ProviderRpcError"
  }
}

export interface WalletEip1193FeeOptionsSelector {
  selectFeeOption(
    feeOptions: Parameters<FeeOptionSelector>[0],
    context: { chainId: number },
  ): ReturnType<FeeOptionSelector>
}

export interface WalletEip1193ProviderCoreOptions {
  createError?: (code: number, message: string, data?: unknown) => Error
  emit?: (event: string, ...args: unknown[]) => void
  getChainId: () => number
  getClient: () => MaybePromise<WalletEip1193ClientLike>
  getNetworks: () => MaybePromise<readonly Network[]>
  isChainConfigured?: (chainId: number) => boolean
  isDisconnected?: () => MaybePromise<boolean>
  requestAccounts?: () => Promise<readonly Address[]>
  setChainId: (chainId: number) => void
  transactionOptions?:
    | WalletEip1193TransactionOptions
    | ((
        context: WalletEip1193TransactionContext,
      ) => MaybePromise<WalletEip1193TransactionOptions | undefined>)
  walletFeeOptions?: WalletEip1193FeeOptionsSelector
}

const supportedTransactionFields = new Set([
  "from",
  "to",
  "value",
  "data",
  "chainId",
])
const ignoredTransactionFields = new Set([
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "type",
  "accessList",
])

export class WalletEip1193ProviderCore {
  constructor(private readonly options: WalletEip1193ProviderCoreOptions) {}

  async request({
    method,
    params,
  }: {
    method: string
    params?: unknown
  }): Promise<unknown> {
    switch (method) {
      case "eth_accounts":
        return this.getAccounts()
      case "eth_requestAccounts":
        return this.requestAccounts()
      case "eth_chainId":
        return numberToHex(this.options.getChainId())
      case "net_version":
        return String(this.options.getChainId())
      case "wallet_switchEthereumChain":
        return this.switchEthereumChain(params)
      case "wallet_getCapabilities":
        return {}
      case "personal_sign":
        return this.signMessage(params)
      case "eth_sign":
      case "eth_signTypedData":
        throw this.unsupportedMethod(method)
      case "eth_signTypedData_v4":
        return this.signTypedData(params)
      case "eth_sendTransaction":
      case "wallet_sendTransaction":
        return this.sendTransaction(params)
      default:
        throw this.unsupportedMethod(method)
    }
  }

  async getAccounts(): Promise<readonly Address[]> {
    if (await this.options.isDisconnected?.()) {
      return []
    }

    const address = (await this.options.getClient()).wallet.walletAddress
    return address && isAddress(address) ? [getAddress(address)] : []
  }

  private async requestAccounts(): Promise<readonly Address[]> {
    if (this.options.requestAccounts) {
      return this.options.requestAccounts()
    }

    const accounts = await this.requireAccounts()
    this.options.emit?.("accountsChanged", accounts)
    return accounts
  }

  private async requireAccounts(): Promise<readonly Address[]> {
    const accounts = await this.getAccounts()
    if (!accounts.length) {
      throw this.rpcError(
        4100,
        "Authenticate with OMS before requesting wallet accounts.",
      )
    }
    return accounts
  }

  private async requireMatchingAccount(
    account: unknown,
    method: string,
  ): Promise<Address> {
    const [activeAccount] = await this.requireAccounts()
    if (account === undefined || account === null) {
      return activeAccount
    }
    if (typeof account !== "string" || !isAddress(account)) {
      throw this.invalidParams(`${method} requires a valid account address.`)
    }

    const requestedAccount = getAddress(account)
    if (requestedAccount !== activeAccount) {
      throw this.rpcError(
        4100,
        `${method} requested ${requestedAccount}, but the active OMS wallet is ${activeAccount}.`,
      )
    }

    return activeAccount
  }

  private async signMessage(params: unknown): Promise<string> {
    const [message, account] = this.paramsAsTuple(params, "personal_sign")
    await this.requireMatchingAccount(account, "personal_sign")
    const client = await this.options.getClient()
    return client.wallet.signMessage({
      network: await this.currentNetwork(),
      message: normalizePersonalSignMessage(message, (message) =>
        this.invalidParams(message),
      ),
    })
  }

  private async signTypedData(params: unknown): Promise<string> {
    const [account, typedData] = this.paramsAsTuple(params, "eth_signTypedData_v4")
    await this.requireMatchingAccount(account, "eth_signTypedData_v4")
    const client = await this.options.getClient()
    return client.wallet.signTypedData({
      network: await this.currentNetwork(),
      typedData: normalizeTypedData(typedData, (message) =>
        this.invalidParams(message),
      ),
    })
  }

  private async sendTransaction(params: unknown): Promise<Hex> {
    const [request] = this.paramsAsTuple(params, "eth_sendTransaction") as [
      WalletEip1193TransactionRequest,
    ]
    if (!request || typeof request !== "object") {
      throw this.invalidParams("eth_sendTransaction requires a transaction object.")
    }
    assertKnownTransactionFields(request, (message) =>
      this.unsupportedMethod(message),
    )
    await this.requireMatchingAccount(request.from, "eth_sendTransaction")
    if (!request.to || !isAddress(request.to)) {
      throw this.unsupportedMethod(
        "eth_sendTransaction without a recipient address; contract deployment is not supported by the current OMS wallet SDK",
      )
    }
    if (request.data !== undefined && !isHex(request.data)) {
      throw this.invalidParams("eth_sendTransaction data must be hex.")
    }

    const transactionChainId =
      request.chainId === undefined
        ? this.options.getChainId()
        : normalizeChainId(request.chainId, (message) =>
            this.invalidParams(message),
          )
    const network = await this.requireNetwork(transactionChainId)
    const transactionOptions = await this.resolveTransactionOptions(
      request,
      transactionChainId,
    )
    if (transactionOptions?.waitForStatus === false) {
      throw this.invalidParams(
        "waitForStatus: false is not supported because EIP-1193 sendTransaction must return an EVM transaction hash.",
      )
    }

    const client = await this.options.getClient()
    const value =
      request.value === undefined
        ? 0n
        : normalizeValue(request.value, (message) => this.invalidParams(message))
    const transactionBase = {
      network,
      to: getAddress(request.to),
      value,
      ...(transactionOptions ?? {}),
      waitForStatus: true,
    } as const
    const response =
      request.data && request.data !== "0x"
        ? await client.wallet.sendTransaction({
            ...transactionBase,
            data: request.data,
          })
        : await client.wallet.sendTransaction(transactionBase)

    if (!response.txnHash || !isHex(response.txnHash)) {
      throw this.rpcError(-32603, missingTransactionHashMessage(response), response)
    }

    return response.txnHash
  }

  private async switchEthereumChain(params: unknown): Promise<null> {
    const [request] = this.paramsAsTuple(params, "wallet_switchEthereumChain") as [
      { chainId?: Hex | bigint | number | string },
    ]
    const chainId = normalizeChainId(request?.chainId, (message) =>
      this.invalidParams(message),
    )
    if (this.options.isChainConfigured?.(chainId) === false) {
      throw this.rpcError(4901, `Chain ${chainId} is not configured in wagmi.`)
    }

    await this.requireNetwork(chainId)
    this.options.setChainId(chainId)
    this.options.emit?.("chainChanged", numberToHex(chainId))
    return null
  }

  private async currentNetwork(): Promise<Network> {
    return this.requireNetwork(this.options.getChainId())
  }

  private async requireNetwork(chainId: number): Promise<Network> {
    const network = (await this.options.getNetworks()).find(
      (candidate) => candidate.id === chainId,
    )
    if (!network) {
      throw this.rpcError(4901, `OMS does not support chain ${chainId}.`)
    }
    return network
  }

  private async resolveTransactionOptions(
    request: WalletEip1193TransactionRequest,
    chainId: number,
  ): Promise<WalletEip1193TransactionOptions | undefined> {
    const options = this.options.transactionOptions
    const resolvedOptions =
      typeof options === "function"
        ? await options({ chainId, request })
        : options

    const walletFeeOptions = this.options.walletFeeOptions
    if (!walletFeeOptions || resolvedOptions?.selectFeeOption) {
      return resolvedOptions
    }

    return {
      ...(resolvedOptions ?? {}),
      selectFeeOption: (feeOptions) =>
        walletFeeOptions.selectFeeOption(feeOptions, { chainId }),
    }
  }

  private paramsAsTuple(params: unknown, method: string): unknown[] {
    if (!Array.isArray(params)) {
      throw this.invalidParams(`${method} requires positional parameters.`)
    }
    return params
  }

  private rpcError(code: number, message: string, data?: unknown): Error {
    return this.options.createError?.(code, message, data) ??
      new WalletEip1193ProviderRpcError(code, message, data)
  }

  private invalidParams(message: string): Error {
    return this.rpcError(-32602, message)
  }

  private unsupportedMethod(method: string): Error {
    return this.rpcError(4200, `Unsupported OMS provider method: ${method}.`)
  }
}

function assertKnownTransactionFields(
  request: WalletEip1193TransactionRequest,
  createUnsupportedError: (message: string) => Error,
): void {
  const unsupportedFields = Object.keys(request).filter(
    (field) =>
      !supportedTransactionFields.has(field) &&
      !ignoredTransactionFields.has(field) &&
      request[field] !== undefined,
  )
  if (unsupportedFields.length > 0) {
    throw createUnsupportedError(
      `eth_sendTransaction with unsupported fields: ${unsupportedFields.join(", ")}`,
    )
  }
}

function normalizePersonalSignMessage(
  message: unknown,
  createInvalidParamsError: (message: string) => Error,
): string {
  if (typeof message !== "string") {
    throw createInvalidParamsError("Signing message must be a string.")
  }

  if (!isHex(message)) {
    return message
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(message))
  } catch {
    throw createInvalidParamsError(
      "Signing raw byte messages is not supported by OMS Wallet; pass a UTF-8 string message.",
    )
  }
}

function normalizeTypedData(
  typedData: unknown,
  createInvalidParamsError: (message: string) => Error,
): unknown {
  if (typeof typedData !== "string") {
    return typedData
  }

  try {
    return JSON.parse(typedData)
  } catch {
    throw createInvalidParamsError("Typed data must be JSON when passed as a string.")
  }
}

function normalizeValue(
  value: unknown,
  createInvalidParamsError: (message: string) => Error,
): bigint {
  if (typeof value === "string" && isQuantity(value)) {
    return hexToBigInt(value)
  }

  throw createInvalidParamsError(
    "Transaction value must be a JSON-RPC quantity hex string.",
  )
}

function isQuantity(value: unknown): value is Hex {
  return (
    typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value)
  )
}

function missingTransactionHashMessage(response: { txnId?: unknown }): string {
  const suffix =
    typeof response.txnId === "string"
      ? ` OMS transaction id: ${response.txnId}.`
      : ""
  return `OMS transaction did not produce the EVM transaction hash required by EIP-1193 sendTransaction.${suffix}`
}

function normalizeChainId(
  chainId: Hex | bigint | number | string | undefined,
  createInvalidParamsError: (message: string) => Error,
): number {
  let normalized: number
  if (typeof chainId === "number") {
    normalized = chainId
  } else if (typeof chainId === "bigint") {
    normalized = Number(chainId)
  } else if (typeof chainId === "string" && isHex(chainId)) {
    normalized = Number(hexToBigInt(chainId))
  } else if (typeof chainId === "string") {
    normalized = Number(chainId)
  } else {
    throw createInvalidParamsError("Chain ID is required.")
  }

  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw createInvalidParamsError("Chain ID must be a positive safe integer.")
  }
  return normalized
}
