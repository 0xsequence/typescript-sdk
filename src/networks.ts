export interface Network {
    readonly id: number
    readonly name: string
    readonly nativeTokenSymbol: string
    readonly explorerUrl: string
}

export const Networks = {
    mainnet: {
        id: 1,
        name: 'mainnet',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://etherscan.io',
    },
    sepolia: {
        id: 11155111,
        name: 'sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.etherscan.io',
    },
    polygon: {
        id: 137,
        name: 'polygon',
        nativeTokenSymbol: 'POL',
        explorerUrl: 'https://polygonscan.com',
    },
    amoy: {
        id: 80002,
        name: 'amoy',
        nativeTokenSymbol: 'POL',
        explorerUrl: 'https://amoy.polygonscan.com',
    },
    arbitrum: {
        id: 42161,
        name: 'arbitrum',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://arbiscan.io',
    },
    arbitrumSepolia: {
        id: 421614,
        name: 'arbitrum-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.arbiscan.io',
    },
    optimism: {
        id: 10,
        name: 'optimism',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://optimistic.etherscan.io',
    },
    optimismSepolia: {
        id: 11155420,
        name: 'optimism-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia-optimism.etherscan.io',
    },
    base: {
        id: 8453,
        name: 'base',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://basescan.org',
    },
    baseSepolia: {
        id: 84532,
        name: 'base-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.basescan.org',
    },
    bsc: {
        id: 56,
        name: 'bsc',
        nativeTokenSymbol: 'BNB',
        explorerUrl: 'https://bscscan.com',
    },
    bscTestnet: {
        id: 97,
        name: 'bsc-testnet',
        nativeTokenSymbol: 'BNB',
        explorerUrl: 'https://testnet.bscscan.com',
    },
    arbitrumNova: {
        id: 42170,
        name: 'arbitrum-nova',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://nova.arbiscan.io',
    },
    avalanche: {
        id: 43114,
        name: 'avalanche',
        nativeTokenSymbol: 'AVAX',
        explorerUrl: 'https://subnets.avax.network/c-chain',
    },
    avalancheTestnet: {
        id: 43113,
        name: 'avalanche-testnet',
        nativeTokenSymbol: 'AVAX',
        explorerUrl: 'https://subnets-test.avax.network/c-chain',
    },
    katana: {
        id: 747474,
        name: 'katana',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://katanascan.com',
    },
} as const satisfies Record<string, Network>;

export const supportedNetworks: readonly Network[] = Object.freeze(Object.values(Networks));

const networksById = new Map(supportedNetworks.map(network => [network.id, network]));
const networksByName = new Map(supportedNetworks.map(network => [network.name.toLowerCase(), network]));

export function findNetworkById(chainId: number): Network | undefined {
    return networksById.get(chainId);
}

export function findNetworkByName(name: string): Network | undefined {
    return networksByName.get(name.trim().toLowerCase());
}
