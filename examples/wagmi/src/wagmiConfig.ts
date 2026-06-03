import { supportedNetworks } from '@0xsequence/typescript-sdk'
import { omsWalletConnector } from '@0xsequence/oms-wallet-wagmi-connector'
import { wagmiAdapter } from '@0xtrails/adapter-wagmi'
import { createConfig, http } from 'wagmi'
import {
  arbitrum,
  arbitrumNova,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  katana,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from 'wagmi/chains'
import { metaMask } from 'wagmi/connectors'
import { selectFeeOptionWithAppUi } from './feeOptionSelectionBridge'
import { oms } from './omsClient'

export const omsWalletChains = [
  mainnet,
  sepolia,
  polygon,
  polygonAmoy,
  arbitrum,
  arbitrumSepolia,
  optimism,
  optimismSepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  arbitrumNova,
  avalanche,
  avalancheFuji,
  katana,
] as const

export const omsWalletNetworks = supportedNetworks
export const defaultChain = polygonAmoy

export const wagmiConfig = createConfig({
  chains: omsWalletChains,
  connectors: [
    omsWalletConnector({
      client: oms,
      networks: omsWalletNetworks,
      initialChainId: defaultChain.id,
      transactionOptions: {
        selectFeeOption: selectFeeOptionWithAppUi,
      },
    }),
    metaMask({
      dapp: {
        name: 'OMS Wallet Wagmi Example',
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [polygon.id]: http(),
    [polygonAmoy.id]: http(),
    [arbitrum.id]: http(),
    [arbitrumSepolia.id]: http(),
    [optimism.id]: http(),
    [optimismSepolia.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [bsc.id]: http(),
    [bscTestnet.id]: http(),
    [arbitrumNova.id]: http(),
    [avalanche.id]: http(),
    [avalancheFuji.id]: http(),
    [katana.id]: http(),
  },
})

export const trailsAdapters = [wagmiAdapter({ wagmiConfig })]

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
