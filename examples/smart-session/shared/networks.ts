import { Networks } from '@polygonlabs/oms-wallet';

import type { Address } from 'viem';

export type SmartSessionNetworkId = 'polygon-amoy' | 'polygon' | 'base' | 'base-sepolia';
export type SmartSessionAssetId = 'pol' | 'eth' | 'usdc' | 'usdt';

export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
export const POLYGON_AMOY_USDC = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' as Address;

export const SMART_SESSION_ASSETS = {
  pol: {
    id: 'pol',
    symbol: 'POL',
    name: 'POL',
    decimals: 18,
    kind: 'native',
    defaultAllowance: '0.01',
    defaultTransferAmount: '0.001'
  },
  eth: {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    kind: 'native',
    defaultAllowance: '0.001',
    defaultTransferAmount: '0.0001'
  },
  usdc: {
    id: 'usdc',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    kind: 'erc20',
    defaultAllowance: '10',
    defaultTransferAmount: '1'
  },
  usdt: {
    id: 'usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    kind: 'erc20',
    defaultAllowance: '10',
    defaultTransferAmount: '1'
  }
} as const;

const SMART_SESSION_TOKEN_ADDRESSES: Partial<
  Record<SmartSessionNetworkId, Partial<Record<SmartSessionAssetId, Address>>>
> = {
  'polygon-amoy': {
    usdc: POLYGON_AMOY_USDC
  },
  polygon: {
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  },
  base: {
    usdc: BASE_USDC
  },
  'base-sepolia': {
    usdc: BASE_SEPOLIA_USDC
  }
};

export const SMART_SESSION_NETWORKS = {
  'polygon-amoy': {
    id: 'polygon-amoy',
    name: 'Polygon Amoy',
    shortName: 'Amoy',
    explorerName: 'PolygonScan',
    network: Networks.amoy,
    assetIds: ['pol', 'usdc']
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    shortName: 'Polygon',
    explorerName: 'PolygonScan',
    network: Networks.polygon,
    assetIds: ['pol', 'usdc', 'usdt']
  },
  base: {
    id: 'base',
    name: 'Base',
    shortName: 'Base',
    explorerName: 'BaseScan',
    network: Networks.base,
    assetIds: ['eth', 'usdc']
  },
  'base-sepolia': {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    explorerName: 'BaseScan',
    network: Networks.baseSepolia,
    assetIds: ['eth', 'usdc']
  }
} as const;

type SmartSessionAssetDefinition = (typeof SMART_SESSION_ASSETS)[SmartSessionAssetId];
export type SmartSessionAsset =
  | Extract<SmartSessionAssetDefinition, { kind: 'native' }>
  | (Extract<SmartSessionAssetDefinition, { kind: 'erc20' }> & { tokenAddress: Address });
export type SmartSessionNetwork = (typeof SMART_SESSION_NETWORKS)[SmartSessionNetworkId];

export function getSmartSessionNetwork(id: SmartSessionNetworkId): SmartSessionNetwork {
  return SMART_SESSION_NETWORKS[id];
}

export function getSmartSessionAsset(
  networkId: SmartSessionNetworkId,
  assetId: SmartSessionAssetId
): SmartSessionAsset {
  const network = getSmartSessionNetwork(networkId);
  if (!(network.assetIds as ReadonlyArray<SmartSessionAssetId>).includes(assetId)) {
    throw new Error(`${assetId} is not available on ${network.name}`);
  }
  const asset = SMART_SESSION_ASSETS[assetId] as SmartSessionAssetDefinition;
  if (asset.kind === 'native') return asset;

  const tokenAddress = SMART_SESSION_TOKEN_ADDRESSES[networkId]?.[assetId];
  if (!tokenAddress) throw new Error(`${assetId} has no contract configured on ${network.name}`);
  return { ...asset, tokenAddress };
}

export function isSmartSessionNetworkId(value: string): value is SmartSessionNetworkId {
  return Object.hasOwn(SMART_SESSION_NETWORKS, value);
}

export function isSmartSessionAssetId(value: string): value is SmartSessionAssetId {
  return Object.hasOwn(SMART_SESSION_ASSETS, value);
}
