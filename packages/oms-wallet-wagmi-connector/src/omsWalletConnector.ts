import { createConnector } from "@wagmi/core"
import { getAddress, numberToHex, SwitchChainError, type Address } from "viem"

import {
  attachWalletFeeOptions,
  createWalletFeeOptionsBridge,
} from "./walletFeeOptions.js"
import { OmsWalletProvider } from "./provider.js"
import type {
  MaybePromise,
  OmsWalletClientLike,
  OmsWalletConnectorParameters,
  OmsWalletNetwork,
} from "./types.js"

omsWalletConnector.type = "omsWallet" as const

const DEFAULT_CHAIN_ID = 137

type OmsWalletConnectorStorageItemMap = Record<
  `${string}.manuallyDisconnected`,
  boolean
>

export function omsWalletConnector(parameters: OmsWalletConnectorParameters) {
  let chainId: number | undefined
  let provider: OmsWalletProvider | undefined
  let unsubscribeSessionExpired: (() => void) | undefined
  let manuallyDisconnected = false
  const connectorId = parameters.id ?? "omsWallet"
  const walletFeeOptions = createWalletFeeOptionsBridge()
  const manuallyDisconnectedStorageKey =
    `${connectorId}.manuallyDisconnected` as keyof OmsWalletConnectorStorageItemMap

  const resolveClient = async (): Promise<OmsWalletClientLike> =>
    typeof parameters.client === "function"
      ? await (parameters.client as () => MaybePromise<OmsWalletClientLike>)()
      : parameters.client

  const configuredNetworks = (
    client?: OmsWalletClientLike,
  ): readonly OmsWalletNetwork[] =>
    parameters.networks ?? client?.supportedNetworks ?? []

  return createConnector<
    OmsWalletProvider,
    Record<string, unknown>,
    OmsWalletConnectorStorageItemMap
  >((config) => {
    const isManuallyDisconnected = async (): Promise<boolean> => {
      const storedValue = await config.storage?.getItem(
        manuallyDisconnectedStorageKey,
        null,
      )
      if (storedValue !== null && storedValue !== undefined) {
        manuallyDisconnected = storedValue
      }
      return manuallyDisconnected
    }
    const setManuallyDisconnected = async (
      nextValue: boolean,
    ): Promise<void> => {
      manuallyDisconnected = nextValue
      if (nextValue) {
        await config.storage?.setItem(manuallyDisconnectedStorageKey, true)
      } else {
        await config.storage?.removeItem(manuallyDisconnectedStorageKey)
      }
    }
    const defaultChainId = () =>
      chainId ??
      (config.chains.some((candidate) => candidate.id === DEFAULT_CHAIN_ID)
        ? DEFAULT_CHAIN_ID
        : config.chains[0].id)
    const setChainId = (nextChainId: number): void => {
      chainId = nextChainId
    }
    const syncChainId = (nextChainId: number): void => {
      setChainId(nextChainId)
      config.emitter.emit("change", { chainId: nextChainId })
    }
    const getNetworks = async () => configuredNetworks(await resolveClient())
    const ensureChainId = async (): Promise<number> => {
      if (chainId === undefined) {
        chainId = resolveInitialChainId(await getNetworks())
      }
      return chainId
    }
    const chainById = (nextChainId: number) =>
      config.chains.find((candidate) => candidate.id === nextChainId)
    const requireConfiguredChain = (nextChainId: number) => {
      const chain = chainById(nextChainId)
      if (!chain) {
        throw new SwitchChainError(
          new Error(`Chain ${nextChainId} is not configured in wagmi.`),
        )
      }
      return chain
    }
    const requireOmsNetwork = (
      nextChainId: number,
      networks: readonly OmsWalletNetwork[],
    ) => {
      if (!networks.some((network) => network.id === nextChainId)) {
        throw new SwitchChainError(
          new Error(`OMS does not support chain ${nextChainId}.`),
        )
      }
    }
    const resolveInitialChainId = (
      networks: readonly OmsWalletNetwork[],
    ): number => {
      if (parameters.initialChainId !== undefined) {
        requireConfiguredChain(parameters.initialChainId)
        requireOmsNetwork(parameters.initialChainId, networks)
        return parameters.initialChainId
      }

      const defaultChain = config.chains.find(
        (candidate) =>
          candidate.id === DEFAULT_CHAIN_ID &&
          networks.some((network) => network.id === candidate.id),
      )
      if (defaultChain) {
        return defaultChain.id
      }

      const firstSupportedChain = config.chains.find((candidate) =>
        networks.some((network) => network.id === candidate.id),
      )
      if (!firstSupportedChain) {
        throw new SwitchChainError(
          new Error("No wagmi chain is supported by OMS."),
        )
      }
      return firstSupportedChain.id
    }

    const accounts = async (): Promise<readonly Address[]> => {
      if (await isManuallyDisconnected()) {
        return []
      }
      const address = (await resolveClient()).wallet.walletAddress
      return address ? [getAddress(address)] : []
    }

    const subscribeSessionExpired = (client: OmsWalletClientLike): void => {
      unsubscribeSessionExpired ??= client.wallet.onSessionExpired?.(() => {
        void setManuallyDisconnected(true)
        config.emitter.emit("disconnect")
        provider?.emit("disconnect")
      })
    }

    const connectWallet = async (
      connectParameters: { isReconnecting?: boolean } = {},
    ): Promise<readonly Address[]> => {
      if (!connectParameters.isReconnecting) {
        await setManuallyDisconnected(false)
      }
      await ensureChainId()
      const client = await resolveClient()
      subscribeSessionExpired(client)
      if (!client.wallet.walletAddress) {
        throw new Error(
          "No active OMS wallet session. Authenticate with the OMS SDK before connecting through wagmi.",
        )
      }

      const nextAccounts = await accounts()
      if (!nextAccounts.length) {
        throw new Error(
          "No active OMS wallet session. Authenticate with the OMS SDK before connecting through wagmi.",
        )
      }
      provider?.emit("accountsChanged", nextAccounts)
      return nextAccounts
    }

    const disconnectWallet = async (): Promise<void> => {
      await setManuallyDisconnected(true)
      provider?.emit("accountsChanged", [])
    }

    const createProvider = (
      getProviderChainId: () => number,
    ): OmsWalletProvider =>
      attachWalletFeeOptions(
        new OmsWalletProvider(
          parameters,
          resolveClient,
          getProviderChainId,
          setChainId,
          syncChainId,
          getNetworks,
          (nextChainId) => Boolean(chainById(nextChainId)),
          connectWallet,
          isManuallyDisconnected,
          walletFeeOptions,
        ),
        walletFeeOptions,
        {
          displayName: parameters.name ?? "OMS Wallet",
          walletId: connectorId,
        },
      )

    const connector = {
      id: connectorId,
      name: parameters.name ?? "OMS Wallet",
      icon: parameters.icon,
      type: omsWalletConnector.type,
      async setup() {
        const client = await resolveClient()
        try {
          chainId = chainId ?? resolveInitialChainId(configuredNetworks(client))
        } catch {
          // `setup` runs outside the user's connect call in wagmi, so defer validation
          // errors until `connect` where consumers can catch them normally.
        }
        void isManuallyDisconnected()
        subscribeSessionExpired(client)
      },
      async connect<withCapabilities extends boolean = false>({
        chainId: requestedChainId,
        isReconnecting,
        withCapabilities,
      }: {
        chainId?: number
        isReconnecting?: boolean
        withCapabilities?: withCapabilities | boolean
      } = {}) {
        const nextAccounts = await connectWallet({ isReconnecting })
        if (requestedChainId && requestedChainId !== chainId) {
          await connector.switchChain({ chainId: requestedChainId })
        }
        const nextChainId = chainId ?? requestedChainId ?? config.chains[0].id
        return {
          accounts: (withCapabilities
            ? nextAccounts.map((address) => ({ address, capabilities: {} }))
            : nextAccounts) as withCapabilities extends true
            ? readonly {
                address: Address
                capabilities: Record<string, unknown>
              }[]
            : readonly Address[],
          chainId: nextChainId,
        }
      },
      async disconnect() {
        unsubscribeSessionExpired?.()
        unsubscribeSessionExpired = undefined
        await disconnectWallet()
      },
      async getAccounts() {
        const nextAccounts = await accounts()
        if (!nextAccounts.length) {
          throw new Error("Connector not connected.")
        }
        return nextAccounts
      },
      async getChainId() {
        return defaultChainId()
      },
      async getProvider({ chainId: scopedChainId }: { chainId?: number } = {}) {
        if (scopedChainId !== undefined && scopedChainId !== defaultChainId()) {
          return createProvider(() => scopedChainId)
        }
        if (!provider) {
          provider = createProvider(defaultChainId)
        }
        return provider
      },
      async isAuthorized() {
        return (
          !(await isManuallyDisconnected()) &&
          Boolean((await resolveClient()).wallet.walletAddress)
        )
      },
      async switchChain({
        chainId: requestedChainId,
      }: {
        chainId: number
        addEthereumChainParameter?: unknown
      }) {
        const chain = requireConfiguredChain(requestedChainId)
        const networks = await getNetworks()
        requireOmsNetwork(requestedChainId, networks)
        syncChainId(requestedChainId)
        provider?.emit("chainChanged", numberToHex(requestedChainId))
        return chain
      },
      onAccountsChanged(nextAccounts: string[]) {
        if (!nextAccounts.length) {
          connector.onDisconnect()
          return
        }
        config.emitter.emit("change", {
          accounts: nextAccounts.map((account) => getAddress(account)),
        })
      },
      onChainChanged(nextChainId: string) {
        const parsedChainId = Number(nextChainId)
        if (!Number.isSafeInteger(parsedChainId) || parsedChainId <= 0) {
          return
        }
        chainId = parsedChainId
        config.emitter.emit("change", { chainId: parsedChainId })
      },
      onDisconnect() {
        manuallyDisconnected = true
        void setManuallyDisconnected(true)
        config.emitter.emit("disconnect")
      },
    }

    return attachWalletFeeOptions(connector, walletFeeOptions, {
      displayName: connector.name,
      walletId: connector.id,
    })
  })
}

export type OmsWalletConnector = ReturnType<typeof omsWalletConnector>
