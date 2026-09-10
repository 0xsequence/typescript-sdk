declare const networkBrand: unique symbol;

export interface Network {
  readonly id: number;
  readonly name: string;
  readonly nativeTokenSymbol: string;
  readonly explorerUrl: string;
  readonly displayName: string;
  readonly [networkBrand]: true;
}

export const SolanaNetworks = Object.freeze({
  devnet: 'solana:devnet',
  mainnet: 'solana:mainnet'
} as const);

export type SolanaNetwork = (typeof SolanaNetworks)[keyof typeof SolanaNetworks];

interface NetworkDefinition {
  id: number;
  name: string;
  nativeTokenSymbol: string;
  explorerUrl: string;
  displayName: string;
}

function defineNetwork<const Definition extends NetworkDefinition>(
  definition: Definition
): Readonly<Definition> & Network {
  return Object.freeze(definition) as Readonly<Definition> & Network;
}

export const Networks = Object.freeze({
  mainnet: defineNetwork({
    id: 1,
    name: 'mainnet',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
    displayName: 'Ethereum'
  }),
  sepolia: defineNetwork({
    id: 11155111,
    name: 'sepolia',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io',
    displayName: 'Sepolia'
  }),
  polygon: defineNetwork({
    id: 137,
    name: 'polygon',
    nativeTokenSymbol: 'POL',
    explorerUrl: 'https://polygonscan.com',
    displayName: 'Polygon'
  }),
  amoy: defineNetwork({
    id: 80002,
    name: 'amoy',
    nativeTokenSymbol: 'POL',
    explorerUrl: 'https://amoy.polygonscan.com',
    displayName: 'Polygon Amoy'
  }),
  arbitrum: defineNetwork({
    id: 42161,
    name: 'arbitrum',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    displayName: 'Arbitrum'
  }),
  arbitrumSepolia: defineNetwork({
    id: 421614,
    name: 'arbitrum-sepolia',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://sepolia.arbiscan.io',
    displayName: 'Arbitrum Sepolia'
  }),
  optimism: defineNetwork({
    id: 10,
    name: 'optimism',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://optimistic.etherscan.io',
    displayName: 'Optimism'
  }),
  optimismSepolia: defineNetwork({
    id: 11155420,
    name: 'optimism-sepolia',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    displayName: 'Optimism Sepolia'
  }),
  base: defineNetwork({
    id: 8453,
    name: 'base',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://basescan.org',
    displayName: 'Base'
  }),
  baseSepolia: defineNetwork({
    id: 84532,
    name: 'base-sepolia',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
    displayName: 'Base Sepolia'
  }),
  bsc: defineNetwork({
    id: 56,
    name: 'bsc',
    nativeTokenSymbol: 'BNB',
    explorerUrl: 'https://bscscan.com',
    displayName: 'BSC'
  }),
  bscTestnet: defineNetwork({
    id: 97,
    name: 'bsc-testnet',
    nativeTokenSymbol: 'BNB',
    explorerUrl: 'https://testnet.bscscan.com',
    displayName: 'BSC Testnet'
  }),
  arbitrumNova: defineNetwork({
    id: 42170,
    name: 'arbitrum-nova',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://nova.arbiscan.io',
    displayName: 'Arbitrum Nova'
  }),
  avalanche: defineNetwork({
    id: 43114,
    name: 'avalanche',
    nativeTokenSymbol: 'AVAX',
    explorerUrl: 'https://subnets.avax.network/c-chain',
    displayName: 'Avalanche'
  }),
  avalancheTestnet: defineNetwork({
    id: 43113,
    name: 'avalanche-testnet',
    nativeTokenSymbol: 'AVAX',
    explorerUrl: 'https://subnets-test.avax.network/c-chain',
    displayName: 'Avalanche Testnet'
  }),
  katana: defineNetwork({
    id: 747474,
    name: 'katana',
    nativeTokenSymbol: 'ETH',
    explorerUrl: 'https://katanascan.com',
    displayName: 'Katana'
  })
});

const supportedNetworks: readonly Network[] = Object.freeze(Object.values(Networks));
const networksById = new Map(supportedNetworks.map((network) => [network.id, network]));
const networksByName = new Map(
  supportedNetworks.map((network) => [network.name.toLowerCase(), network])
);

export function findNetworkById(chainId: number): Network | undefined {
  return networksById.get(chainId);
}

export function findNetworkByName(name: string): Network | undefined {
  return networksByName.get(name.trim().toLowerCase());
}
