import {
  createConfig,
  createStorage,
  connect,
  disconnect,
  reconnect,
  sendTransaction,
  signMessage,
  signTypedData,
  switchChain,
  type Storage,
} from "@wagmi/core"
import { describe, expect, it, vi } from "vitest"
import { http, type Address, type Chain, type Hex } from "viem"

import {
  getWalletFeeOptionsBridge,
  omsWalletConnector,
  stringToPersonalSignHex,
  type OmsWalletClientLike,
  type WalletFeeOptionsBridge,
} from "../src/index.js"

const polygon = {
  id: 137,
  name: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: ["https://polygon.example"] } },
} as const satisfies Chain

const mainnet = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.example"] } },
} as const satisfies Chain

const networks = [
  {
    id: 137,
    name: "polygon",
    nativeTokenSymbol: "POL",
    explorerUrl: "https://polygonscan.com",
    displayName: "Polygon",
  },
  {
    id: 1,
    name: "mainnet",
    nativeTokenSymbol: "ETH",
    explorerUrl: "https://etherscan.io",
    displayName: "Ethereum",
  },
] as const

describe("omsWalletConnector", () => {
  it("rejects connect when there is no active OMS wallet session", async () => {
    const client = createClient()
    const config = createWagmiConfig(client)

    await expect(
      connect(config, {
        connector: config.connectors[0],
        chainId: polygon.id,
      }),
    ).rejects.toThrow(
      "Authenticate with the OMS SDK before connecting through wagmi.",
    )
  })

  it("signs messages and typed data through the OMS wallet", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)

    await connect(config, { connector: config.connectors[0] })

    await expect(signMessage(config, { message: "hello" })).resolves.toBe(
      "0xsigned-message",
    )
    expect(client.wallet.signMessage).toHaveBeenCalledWith({
      network: networks[0],
      message: "hello",
    })

    await expect(
      signTypedData(config, {
        domain: { name: "OMS", chainId: 137 },
        primaryType: "Mail",
        types: {
          Mail: [{ name: "contents", type: "string" }],
        },
        message: { contents: "hello" },
      }),
    ).resolves.toBe("0xsigned-typed-data")

    expect(client.wallet.signTypedData).toHaveBeenCalledWith({
      network: networks[0],
      typedData: expect.objectContaining({
        domain: { name: "OMS", chainId: 137 },
        primaryType: "Mail",
      }),
    })
  })

  it("sends transactions through the OMS wallet and returns the EVM transaction hash", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)

    await connect(config, { connector: config.connectors[0] })

    await expect(
      sendTransaction(config, {
        to: "0x1111111111111111111111111111111111111111",
        value: 1n,
      }),
    ).resolves.toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )

    expect(client.wallet.sendTransaction).toHaveBeenCalledWith({
      network: networks[0],
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
      data: undefined,
      selectFeeOption: expect.any(Function),
      waitForStatus: true,
    })
  })

  it("does not advertise fee options through wallet_getCapabilities", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()

    await expect(
      provider.request({ method: "wallet_getCapabilities" }),
    ).resolves.toEqual({})
  })

  it("exposes wallet fee options for dapp-owned selection", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]
    const bridge = requireWalletFeeOptionsBridge(connector)
    const snapshots: unknown[] = []
    const unsubscribe = bridge.subscribe(() =>
      snapshots.push(bridge.getSnapshot()),
    )

    const selectionPromise = bridge.selectFeeOption(
      [
        createFeeOptionWithBalance({
          symbol: "USDC",
          contractAddress: "0x2222222222222222222222222222222222222222",
        }),
      ],
      { chainId: polygon.id },
    )

    expect(bridge.getSnapshot()).toMatchObject({
      chainId: polygon.id,
      options: [
        {
          id: expect.any(String),
          token: {
            contractAddress: "0x2222222222222222222222222222222222222222",
            symbol: "USDC",
          },
          hasEnoughBalanceForFee: true,
        },
      ],
    })
    expect(snapshots).toHaveLength(1)

    const snapshot = bridge.getSnapshot()!
    expect(snapshot.options[0]!.id).toBe("fee-option-0")
    expect(snapshot.options[0]!.id).not.toContain("USDC")
    expect(snapshot.options[0]!.id).not.toContain(
      "0x2222222222222222222222222222222222222222",
    )
    bridge.confirm(snapshot.id, snapshot.options[0]!.id)
    await expect(selectionPromise).resolves.toEqual({ token: "USDC" })
    expect(bridge.getSnapshot()).toBeUndefined()

    unsubscribe()
  })

  it("rejects unknown confirmed fee option ids", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]
    const bridge = requireWalletFeeOptionsBridge(connector)
    const unsubscribe = bridge.subscribe(() => undefined)

    const selectionPromise = bridge.selectFeeOption(
      [
        createFeeOptionWithBalance({ symbol: "USDC", availableRaw: "0" }),
        createFeeOptionWithBalance({
          symbol: "POL",
          contractAddress: "0x3333333333333333333333333333333333333333",
          availableRaw: "1000000000000000000",
        }),
      ],
      { chainId: polygon.id },
    )

    bridge.confirm(bridge.getSnapshot()!.id, "missing-option-id")

    await expect(selectionPromise).rejects.toThrow("Unknown fee option id")
    unsubscribe()
  })

  it("keeps a pending fee-option request even when no fee UI is subscribed", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]
    const bridge = requireWalletFeeOptionsBridge(connector)

    const selectionPromise = bridge.selectFeeOption(
      [
        createFeeOptionWithBalance({ symbol: "USDC", availableRaw: "0" }),
        createFeeOptionWithBalance({
          symbol: "POL",
          contractAddress: "0x3333333333333333333333333333333333333333",
          availableRaw: "1000000000000000000",
        }),
      ],
      { chainId: polygon.id },
    )
    const snapshot = bridge.getSnapshot()

    expect(snapshot?.options).toHaveLength(2)
    bridge.confirm(snapshot!.id, snapshot!.options[1]!.id)

    await expect(selectionPromise).resolves.toEqual({ token: "POL" })
  })

  it("rejects non-quantity transaction values at the provider boundary", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()

    await expect(
      provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: client.wallet.walletAddress,
            to: "0x1111111111111111111111111111111111111111",
            value: 1,
          },
        ],
      }),
    ).rejects.toThrow(
      "Transaction value must be a JSON-RPC quantity hex string.",
    )
    expect(client.wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it("uses a transaction request chainId without switching the connector chain", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    await expect(
      sendTransaction(config, {
        chainId: mainnet.id,
        to: "0x1111111111111111111111111111111111111111",
        value: 1n,
      }),
    ).resolves.toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )

    expect(client.wallet.sendTransaction).toHaveBeenCalledWith({
      network: networks[1],
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
      data: undefined,
      selectFeeOption: expect.any(Function),
      waitForStatus: true,
    })
    await expect(connector.getChainId()).resolves.toBe(polygon.id)
  })

  it("resolves transaction options per wagmi transaction request", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const selectFeeOption = vi.fn(async () => ({ token: "USDC" }))
    const transactionOptions = vi.fn(() => ({
      selectFeeOption,
      statusPolling: { timeoutMs: 10_000 },
    }))
    const config = createWagmiConfig(client, { transactionOptions })

    await connect(config, { connector: config.connectors[0] })
    await sendTransaction(config, {
      chainId: mainnet.id,
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
    })

    expect(transactionOptions).toHaveBeenCalledWith({
      chainId: mainnet.id,
      request: expect.objectContaining({
        from: "0x9999999999999999999999999999999999999999",
        to: "0x1111111111111111111111111111111111111111",
        value: "0x1",
      }),
    })
    expect(client.wallet.sendTransaction).toHaveBeenCalledWith({
      network: networks[1],
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
      data: undefined,
      selectFeeOption,
      waitForStatus: true,
      statusPolling: { timeoutMs: 10_000 },
    })
  })

  it("rejects waitForStatus false because wagmi sendTransaction requires a hash", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client, {
      transactionOptions: {
        waitForStatus: false,
      } as never,
    })

    await connect(config, { connector: config.connectors[0] })

    await expect(
      sendTransaction(config, {
        to: "0x1111111111111111111111111111111111111111",
        value: 1n,
      }),
    ).rejects.toThrow("waitForStatus: false is not supported")
    expect(client.wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it("rejects with the OMS response when a sent transaction has no EVM hash", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    client.wallet.sendTransaction = vi.fn(async () => ({
      txnId: "txn-without-hash",
      status: "pending",
    }))
    const config = createWagmiConfig(client)

    await connect(config, { connector: config.connectors[0] })

    await expect(
      sendTransaction(config, {
        to: "0x1111111111111111111111111111111111111111",
        value: 1n,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("OMS transaction id: txn-without-hash"),
      cause: expect.objectContaining({
        code: -32603,
        cause: expect.objectContaining({
          code: -32603,
          data: expect.objectContaining({
            txnId: "txn-without-hash",
          }),
        }),
      }),
    })
  })

  it("ignores wallet-managed transaction fields when sending transactions", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()

    await expect(
      provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: client.wallet.walletAddress,
            to: "0x1111111111111111111111111111111111111111",
            value: "0x1",
            gas: "0x5208",
            gasPrice: "0x1",
            maxFeePerGas: "0x2",
            maxPriorityFeePerGas: "0x1",
            nonce: "0x0",
            type: "0x2",
            accessList: [],
          },
        ],
      }),
    ).resolves.toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )
    expect(client.wallet.sendTransaction).toHaveBeenCalledWith({
      network: networks[0],
      to: "0x1111111111111111111111111111111111111111",
      value: 1n,
      selectFeeOption: expect.any(Function),
      waitForStatus: true,
    })
  })

  it("rejects unknown transaction fields", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()

    await expect(
      provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: client.wallet.walletAddress,
            to: "0x1111111111111111111111111111111111111111",
            customField: "0x1",
          },
        ],
      }),
    ).rejects.toThrow("unsupported fields: customField")
    expect(client.wallet.sendTransaction).not.toHaveBeenCalled()
  })

  it("rejects provider requests for a different account", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()

    await expect(
      provider.request({
        method: "personal_sign",
        params: [
          stringToPersonalSignHex("hello"),
          "0x1111111111111111111111111111111111111111",
        ],
      }),
    ).rejects.toMatchObject({
      code: 4100,
    })
    await expect(
      provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: "0x1111111111111111111111111111111111111111",
            to: "0x2222222222222222222222222222222222222222",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 4100,
    })
  })

  it("switches the OMS network used for signing and transactions", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)

    await connect(config, { connector: config.connectors[0] })
    await switchChain(config, { chainId: mainnet.id })
    await signMessage(config, { message: "hello" })

    expect(client.wallet.signMessage).toHaveBeenLastCalledWith({
      network: networks[1],
      message: "hello",
    })
  })

  it("syncs wagmi state when the provider switches chains directly", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }],
    })

    expect(config.state.connections.get(config.state.current!)?.chainId).toBe(
      mainnet.id,
    )
    await expect(connector.getChainId()).resolves.toBe(mainnet.id)
  })

  it("rejects provider chain switches to OMS-supported chains that are not configured in wagmi", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createConfig({
      chains: [polygon],
      connectors: [omsWalletConnector({ client, networks })],
      transports: {
        [polygon.id]: http(),
      },
    })
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()
    await expect(
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      }),
    ).rejects.toMatchObject({
      code: 4901,
    })

    expect(config.state.connections.get(config.state.current!)?.chainId).toBe(
      polygon.id,
    )
    await expect(connector.getChainId()).resolves.toBe(polygon.id)
  })

  it("defaults to Polygon when it is configured and supported", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createConfig({
      chains: [mainnet, polygon],
      connectors: [omsWalletConnector({ client, networks })],
      transports: {
        [mainnet.id]: http(),
        [polygon.id]: http(),
      },
    })

    await connect(config, { connector: config.connectors[0] })
    await signMessage(config, { message: "hello" })

    expect(config.state.connections.get(config.state.current!)?.chainId).toBe(
      polygon.id,
    )
    expect(client.wallet.signMessage).toHaveBeenCalledWith({
      network: networks[0],
      message: "hello",
    })
  })

  it("uses and validates initialChainId", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client, { initialChainId: mainnet.id })

    await connect(config, { connector: config.connectors[0] })
    await signMessage(config, { message: "hello" })

    expect(client.wallet.signMessage).toHaveBeenCalledWith({
      network: networks[1],
      message: "hello",
    })
  })

  it("rejects initialChainId when OMS does not support it", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const unsupported = {
      id: 10,
      name: "Optimism",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: ["https://optimism.example"] } },
    } as const satisfies Chain
    const config = createConfig({
      chains: [polygon, unsupported],
      connectors: [
        omsWalletConnector({
          client,
          networks,
          initialChainId: unsupported.id,
        }),
      ],
      transports: {
        [polygon.id]: http(),
        [unsupported.id]: http(),
      },
    })

    await expect(config.connectors[0].getChainId()).resolves.toBe(polygon.id)
    const provider = await config.connectors[0].getProvider()
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe(
      "0x89",
    )
    await expect(
      connect(config, { connector: config.connectors[0] }),
    ).rejects.toThrow("OMS does not support chain 10.")
  })

  it("disconnects wagmi without signing out the OMS wallet", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    await disconnect(config)

    expect(client.wallet.signOut).not.toHaveBeenCalled()
    expect(client.wallet.walletAddress).toBe(
      "0x9999999999999999999999999999999999999999",
    )
    await expect(connector.isAuthorized()).resolves.toBe(false)
    await expect(connector.getAccounts()).rejects.toThrow(
      "Connector not connected.",
    )

    await expect(connect(config, { connector })).resolves.toMatchObject({
      accounts: ["0x9999999999999999999999999999999999999999"],
    })
  })

  it("does not reconnect automatically after disconnecting and refreshing", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const storage = createMemoryStorage()
    const config = createWagmiConfig(client, {}, storage)
    const connector = config.connectors[0]

    await connect(config, { connector })
    await disconnect(config)

    const refreshedConfig = createWagmiConfig(client, {}, storage)
    const refreshedConnector = refreshedConfig.connectors[0]
    await expect(refreshedConnector.isAuthorized()).resolves.toBe(false)
    await expect(reconnect(refreshedConfig)).resolves.toEqual([])
    expect(refreshedConfig.state.status).toBe("disconnected")

    await expect(
      connect(refreshedConfig, { connector: refreshedConnector }),
    ).resolves.toMatchObject({
      accounts: ["0x9999999999999999999999999999999999999999"],
    })
    await expect(refreshedConnector.isAuthorized()).resolves.toBe(true)
  })

  it("keeps session expiry disconnect handling after reconnect", async () => {
    const walletAddress = "0x9999999999999999999999999999999999999999"
    const client = createClient({ walletAddress })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    expect(client.sessionExpiredListenerCount()).toBe(1)

    await disconnect(config)
    expect(client.sessionExpiredListenerCount()).toBe(0)

    client.wallet.walletAddress = walletAddress
    await connect(config, { connector })
    expect(client.sessionExpiredListenerCount()).toBe(1)

    client.expireSession()
    expect(config.state.status).toBe("disconnected")
  })

  it("decodes personal_sign hex payloads before passing them to OMS", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const connector = omsWalletConnector({ client, networks })
    const config = createConfig({
      chains: [polygon],
      connectors: [connector],
      transports: { [polygon.id]: http() },
    })
    const [configuredConnector] = config.connectors

    await connect(config, { connector: configuredConnector })
    const provider = await configuredConnector.getProvider()
    await provider.request({
      method: "personal_sign",
      params: [stringToPersonalSignHex("hello"), client.wallet.walletAddress],
    })

    expect(client.wallet.signMessage).toHaveBeenCalledWith({
      network: networks[0],
      message: "hello",
    })
  })

  it("rejects raw byte personal_sign payloads that OMS cannot sign as text", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()
    await expect(
      provider.request({
        method: "personal_sign",
        params: ["0xff", client.wallet.walletAddress],
      }),
    ).rejects.toThrow("Signing raw byte messages is not supported")
    expect(client.wallet.signMessage).not.toHaveBeenCalled()
  })

  it("rejects eth_sign because OMS Wallet does not raw-sign messages", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()
    await expect(
      provider.request({
        method: "eth_sign",
        params: [client.wallet.walletAddress, "0x68656c6c6f"],
      }),
    ).rejects.toMatchObject({ code: 4200 })
    expect(client.wallet.signMessage).not.toHaveBeenCalled()
  })

  it("rejects legacy typed data signing instead of treating it as v4", async () => {
    const client = createClient({
      walletAddress: "0x9999999999999999999999999999999999999999",
    })
    const config = createWagmiConfig(client)
    const connector = config.connectors[0]

    await connect(config, { connector })
    const provider = await connector.getProvider()
    await expect(
      provider.request({
        method: "eth_signTypedData",
        params: [client.wallet.walletAddress, "{}"],
      }),
    ).rejects.toMatchObject({ code: 4200 })
    expect(client.wallet.signTypedData).not.toHaveBeenCalled()
  })
})

function createWagmiConfig(
  client: OmsWalletClientLike,
  options: Partial<Parameters<typeof omsWalletConnector>[0]> = {},
  storage?: Storage | null,
) {
  return createConfig({
    chains: [polygon, mainnet],
    connectors: [omsWalletConnector({ client, networks, ...options })],
    storage,
    transports: {
      [polygon.id]: http(),
      [mainnet.id]: http(),
    },
  })
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return createStorage({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      },
    },
  })
}

function requireWalletFeeOptionsBridge(
  target: unknown,
): WalletFeeOptionsBridge {
  const bridge = getWalletFeeOptionsBridge(target) as
    | WalletFeeOptionsBridge
    | undefined
  if (!bridge) {
    throw new Error("Expected wallet fee options bridge")
  }
  return bridge
}

function createFeeOptionWithBalance({
  availableRaw = "1000000",
  contractAddress = "0x2222222222222222222222222222222222222222",
  symbol = "USDC",
}: {
  availableRaw?: string
  contractAddress?: string | null
  symbol?: string
} = {}): Parameters<WalletFeeOptionsBridge["selectFeeOption"]>[0][number] {
  return {
    availableRaw,
    decimals: 6,
    feeOption: {
      token: {
        network: 137,
        symbol,
        name: symbol,
        contractAddress,
        decimals: 6,
      },
      value: "1000",
    },
  }
}

interface TestOmsWalletClient extends OmsWalletClientLike {
  wallet: OmsWalletClientLike["wallet"] & {
    signOut: ReturnType<typeof vi.fn>
    signMessage: ReturnType<typeof vi.fn>
    signTypedData: ReturnType<typeof vi.fn>
    sendTransaction: ReturnType<typeof vi.fn>
    onSessionExpired: ReturnType<typeof vi.fn>
  }
  expireSession(): void
  sessionExpiredListenerCount(): number
}

function createClient(
  params: { walletAddress?: Address } = {},
): TestOmsWalletClient {
  const sessionExpiredListeners = new Set<
    Parameters<
      NonNullable<OmsWalletClientLike["wallet"]["onSessionExpired"]>
    >[0]
  >()
  const wallet = {
    walletAddress: params.walletAddress,
    signOut: vi.fn(async () => {
      wallet.walletAddress = undefined
    }),
    signMessage: vi.fn(async () => "0xsigned-message"),
    signTypedData: vi.fn(async () => "0xsigned-typed-data"),
    sendTransaction: vi.fn(async () => ({
      txnId: "txn-1",
      status: "executed",
      txnHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
    })),
    onSessionExpired: vi.fn(
      (
        listener: Parameters<
          NonNullable<OmsWalletClientLike["wallet"]["onSessionExpired"]>
        >[0],
      ) => {
        sessionExpiredListeners.add(listener)
        return () => {
          sessionExpiredListeners.delete(listener)
        }
      },
    ),
  }

  return {
    wallet,
    supportedNetworks: networks,
    expireSession() {
      for (const listener of sessionExpiredListeners) {
        void listener({ expiredAt: new Date().toISOString() })
      }
    },
    sessionExpiredListenerCount() {
      return sessionExpiredListeners.size
    },
  }
}
