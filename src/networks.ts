export interface Network {
    readonly id: number
    readonly name: string
    readonly nativeTokenSymbol: string
    readonly explorerUrl: string
    readonly displayName: string
}

export const Networks = {
    mainnet: {
        id: 1,
        name: 'mainnet',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://etherscan.io',
        displayName: 'Ethereum',
    },
    sepolia: {
        id: 11155111,
        name: 'sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.etherscan.io',
        displayName: 'Sepolia',
    },
    polygon: {
        id: 137,
        name: 'polygon',
        nativeTokenSymbol: 'POL',
        explorerUrl: 'https://polygonscan.com',
        displayName: 'Polygon',
    },
    amoy: {
        id: 80002,
        name: 'amoy',
        nativeTokenSymbol: 'POL',
        explorerUrl: 'https://amoy.polygonscan.com',
        displayName: 'Polygon Amoy',
    },
    arbitrum: {
        id: 42161,
        name: 'arbitrum',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://arbiscan.io',
        displayName: 'Arbitrum',
    },
    arbitrumSepolia: {
        id: 421614,
        name: 'arbitrum-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.arbiscan.io',
        displayName: 'Arbitrum Sepolia',
    },
    optimism: {
        id: 10,
        name: 'optimism',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://optimistic.etherscan.io',
        displayName: 'Optimism',
    },
    optimismSepolia: {
        id: 11155420,
        name: 'optimism-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia-optimism.etherscan.io',
        displayName: 'Optimism Sepolia',
    },
    base: {
        id: 8453,
        name: 'base',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://basescan.org',
        displayName: 'Base',
    },
    baseSepolia: {
        id: 84532,
        name: 'base-sepolia',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://sepolia.basescan.org',
        displayName: 'Base Sepolia',
    },
    bsc: {
        id: 56,
        name: 'bsc',
        nativeTokenSymbol: 'BNB',
        explorerUrl: 'https://bscscan.com',
        displayName: 'BSC',
    },
    bscTestnet: {
        id: 97,
        name: 'bsc-testnet',
        nativeTokenSymbol: 'BNB',
        explorerUrl: 'https://testnet.bscscan.com',
        displayName: 'BSC Testnet',
    },
    arbitrumNova: {
        id: 42170,
        name: 'arbitrum-nova',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://nova.arbiscan.io',
        displayName: 'Arbitrum Nova',
    },
    avalanche: {
        id: 43114,
        name: 'avalanche',
        nativeTokenSymbol: 'AVAX',
        explorerUrl: 'https://subnets.avax.network/c-chain',
        displayName: 'Avalanche',
    },
    avalancheTestnet: {
        id: 43113,
        name: 'avalanche-testnet',
        nativeTokenSymbol: 'AVAX',
        explorerUrl: 'https://subnets-test.avax.network/c-chain',
        displayName: 'Avalanche Testnet',
    },
    katana: {
        id: 747474,
        name: 'katana',
        nativeTokenSymbol: 'ETH',
        explorerUrl: 'https://katanascan.com',
        displayName: 'Katana',
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
