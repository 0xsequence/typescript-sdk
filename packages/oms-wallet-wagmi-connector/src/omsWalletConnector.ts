import type { Address } from 'viem';

import { createConnector } from '@wagmi/core';
import { getAddress, isAddress, numberToHex, SwitchChainError } from 'viem';

import { Networks } from '@polygonlabs/oms-wallet';

import type {
  MaybePromise,
  OMSWalletLike,
  OMSWalletConnectorParameters,
  OMSWalletNetwork
} from './types.js';

import { OMSWalletProvider, OMSWalletProviderRpcError } from './provider.js';

omsWalletConnector.type = 'omsWallet' as const;

const supportedNetworks = Object.values(Networks);

type OMSWalletConnectorStorageItemMap = Record<`${string}.manuallyDisconnected`, boolean>;

export function omsWalletConnector(parameters: OMSWalletConnectorParameters) {
  let chainId: number | undefined;
  let provider: OMSWalletProvider | undefined;
  let unsubscribeSessionExpired: (() => void) | undefined;
  let manuallyDisconnected = false;
  let manuallyDisconnectedVersion = 0;
  const connectorId = parameters.id ?? 'omsWallet';
  const manuallyDisconnectedStorageKey =
    `${connectorId}.manuallyDisconnected` as keyof OMSWalletConnectorStorageItemMap;

  const resolveOmsWallet = async (): Promise<OMSWalletLike> =>
    typeof parameters.omsWallet === 'function'
      ? await (parameters.omsWallet as () => MaybePromise<OMSWalletLike>)()
      : parameters.omsWallet;

  const configuredNetworks = (): readonly OMSWalletNetwork[] =>
    parameters.networks ?? supportedNetworks;

  return createConnector<
    OMSWalletProvider,
    Record<string, unknown>,
    OMSWalletConnectorStorageItemMap
  >((config) => {
    const isManuallyDisconnected = async (): Promise<boolean> => {
      const readVersion = manuallyDisconnectedVersion;
      const storedValue = await config.storage?.getItem(manuallyDisconnectedStorageKey, null);
      if (
        readVersion === manuallyDisconnectedVersion &&
        storedValue !== null &&
        storedValue !== undefined
      ) {
        manuallyDisconnected = storedValue;
      }
      return manuallyDisconnected;
    };
    const setManuallyDisconnected = async (nextValue: boolean): Promise<void> => {
      manuallyDisconnectedVersion += 1;
      manuallyDisconnected = nextValue;
      if (nextValue) {
        await config.storage?.setItem(manuallyDisconnectedStorageKey, true);
      } else {
        await config.storage?.removeItem(manuallyDisconnectedStorageKey);
      }
    };
    const defaultChainId = () => chainId ?? config.chains[0].id;
    const syncChainId = (nextChainId: number): void => {
      chainId = nextChainId;
      config.emitter.emit('change', { chainId: nextChainId });
    };
    const getNetworks = async () => configuredNetworks();
    const ensureChainId = async (): Promise<number> => {
      if (chainId === undefined) {
        chainId = resolveInitialChainId(await getNetworks());
      }
      return chainId;
    };
    const chainById = (nextChainId: number) =>
      config.chains.find((candidate) => candidate.id === nextChainId);
    const requireConfiguredChain = (nextChainId: number) => {
      const chain = chainById(nextChainId);
      if (!chain) {
        throw new SwitchChainError(new Error(`Chain ${nextChainId} is not configured in wagmi.`));
      }
      return chain;
    };
    const requireOmsNetwork = (nextChainId: number, networks: readonly OMSWalletNetwork[]) => {
      if (!networks.some((network) => network.id === nextChainId)) {
        throw new SwitchChainError(new Error(`OMS does not support chain ${nextChainId}.`));
      }
    };
    const resolveInitialChainId = (networks: readonly OMSWalletNetwork[]): number => {
      if (parameters.initialChainId !== undefined) {
        requireConfiguredChain(parameters.initialChainId);
        requireOmsNetwork(parameters.initialChainId, networks);
        return parameters.initialChainId;
      }

      const firstSupportedChain = config.chains.find((candidate) =>
        networks.some((network) => network.id === candidate.id)
      );
      if (!firstSupportedChain) {
        throw new SwitchChainError(new Error('No wagmi chain is supported by OMS.'));
      }
      return firstSupportedChain.id;
    };

    const accounts = async (): Promise<readonly Address[]> => {
      if (await isManuallyDisconnected()) {
        return [];
      }
      const address = (await resolveOmsWallet()).wallet.walletAddress;
      if (!address) {
        return [];
      }
      if (!isAddress(address)) {
        throw new OMSWalletProviderRpcError(
          4100,
          'The active OMS wallet is not an Ethereum wallet.'
        );
      }
      return [getAddress(address)];
    };

    const subscribeSessionExpired = (omsWallet: OMSWalletLike): void => {
      unsubscribeSessionExpired ??= omsWallet.wallet.onSessionExpired?.(() => {
        void setManuallyDisconnected(true);
        config.emitter.emit('disconnect');
        provider?.emit('disconnect');
      });
    };

    const connectWallet = async (
      connectParameters: { isReconnecting?: boolean } = {}
    ): Promise<readonly Address[]> => {
      if (!connectParameters.isReconnecting) {
        await setManuallyDisconnected(false);
      }
      await ensureChainId();
      const omsWallet = await resolveOmsWallet();
      subscribeSessionExpired(omsWallet);
      if (!omsWallet.wallet.walletAddress) {
        throw new OMSWalletProviderRpcError(
          4100,
          'No active OMS Wallet session. Authenticate with the OMS Wallet SDK before connecting through wagmi.'
        );
      }

      const nextAccounts = await accounts();
      if (!nextAccounts.length) {
        throw new OMSWalletProviderRpcError(
          4100,
          'No active OMS Wallet session. Authenticate with the OMS Wallet SDK before connecting through wagmi.'
        );
      }
      provider?.emit('accountsChanged', nextAccounts);
      return nextAccounts;
    };

    const disconnectWallet = async (): Promise<void> => {
      await setManuallyDisconnected(true);
      provider?.emit('accountsChanged', []);
    };

    const createProvider = (getProviderChainId: () => number): OMSWalletProvider =>
      new OMSWalletProvider(
        parameters,
        resolveOmsWallet,
        getProviderChainId,
        syncChainId,
        getNetworks,
        (nextChainId) => Boolean(chainById(nextChainId)),
        connectWallet,
        isManuallyDisconnected
      );

    const connector = {
      id: connectorId,
      name: parameters.name ?? 'OMS Wallet',
      icon: parameters.icon,
      type: omsWalletConnector.type,
      async setup() {
        const omsWallet = await resolveOmsWallet();
        try {
          chainId = chainId ?? resolveInitialChainId(configuredNetworks());
        } catch {
          // `setup` runs outside the user's connect call in wagmi, so defer validation
          // errors until `connect` where consumers can catch them normally.
        }
        void isManuallyDisconnected();
        subscribeSessionExpired(omsWallet);
      },
      async connect<withCapabilities extends boolean = false>({
        chainId: requestedChainId,
        isReconnecting,
        withCapabilities
      }: {
        chainId?: number;
        isReconnecting?: boolean;
        withCapabilities?: withCapabilities | boolean;
      } = {}) {
        const nextAccounts = await connectWallet({ isReconnecting });
        if (requestedChainId && requestedChainId !== chainId) {
          await connector.switchChain({ chainId: requestedChainId });
        }
        const nextChainId = chainId ?? requestedChainId ?? config.chains[0].id;
        return {
          accounts: (withCapabilities
            ? nextAccounts.map((address) => ({ address, capabilities: {} }))
            : nextAccounts) as withCapabilities extends true
            ? readonly { address: Address; capabilities: Record<string, unknown> }[]
            : readonly Address[],
          chainId: nextChainId
        };
      },
      async disconnect() {
        unsubscribeSessionExpired?.();
        unsubscribeSessionExpired = undefined;
        await disconnectWallet();
      },
      async getAccounts() {
        const nextAccounts = await accounts();
        if (!nextAccounts.length) {
          throw new Error('Connector not connected.');
        }
        return nextAccounts;
      },
      async getChainId() {
        return defaultChainId();
      },
      async getProvider({ chainId: scopedChainId }: { chainId?: number } = {}) {
        if (scopedChainId !== undefined && scopedChainId !== defaultChainId()) {
          return createProvider(() => scopedChainId);
        }
        if (!provider) {
          provider = createProvider(defaultChainId);
        }
        return provider;
      },
      async isAuthorized() {
        return (
          !(await isManuallyDisconnected()) &&
          Boolean((await resolveOmsWallet()).wallet.walletAddress)
        );
      },
      async switchChain({
        chainId: requestedChainId
      }: {
        chainId: number;
        addEthereumChainParameter?: unknown;
      }) {
        const chain = requireConfiguredChain(requestedChainId);
        const networks = await getNetworks();
        requireOmsNetwork(requestedChainId, networks);
        syncChainId(requestedChainId);
        provider?.emit('chainChanged', numberToHex(requestedChainId));
        return chain;
      },
      onAccountsChanged(nextAccounts: string[]) {
        if (!nextAccounts.length) {
          connector.onDisconnect();
          return;
        }
        config.emitter.emit('change', {
          accounts: nextAccounts.map((account) => getAddress(account))
        });
      },
      onChainChanged(nextChainId: string) {
        const parsedChainId = Number(nextChainId);
        if (!Number.isSafeInteger(parsedChainId) || parsedChainId <= 0) {
          return;
        }
        chainId = parsedChainId;
        config.emitter.emit('change', { chainId: parsedChainId });
      },
      onDisconnect() {
        manuallyDisconnected = true;
        void setManuallyDisconnected(true);
        config.emitter.emit('disconnect');
      }
    };

    return connector;
  });
}

export type OMSWalletConnector = ReturnType<typeof omsWalletConnector>;
