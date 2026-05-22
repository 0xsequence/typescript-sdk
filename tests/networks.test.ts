import {describe, expect, it} from "vitest";

import {
    OMSClient,
    findNetworkById,
    findNetworkByName,
    supportedNetworks,
} from "../src";

describe("Networks", () => {
    it("exposes the supported network registry", () => {
        expect(supportedNetworks).toEqual([
            {id: 1, name: "mainnet", nativeTokenSymbol: "ETH", explorerUrl: "https://etherscan.io", displayName: "Ethereum"},
            {id: 11155111, name: "sepolia", nativeTokenSymbol: "ETH", explorerUrl: "https://sepolia.etherscan.io", displayName: "Sepolia"},
            {id: 137, name: "polygon", nativeTokenSymbol: "POL", explorerUrl: "https://polygonscan.com", displayName: "Polygon"},
            {id: 80002, name: "amoy", nativeTokenSymbol: "POL", explorerUrl: "https://amoy.polygonscan.com", displayName: "Polygon Amoy"},
            {id: 42161, name: "arbitrum", nativeTokenSymbol: "ETH", explorerUrl: "https://arbiscan.io", displayName: "Arbitrum"},
            {id: 421614, name: "arbitrum-sepolia", nativeTokenSymbol: "ETH", explorerUrl: "https://sepolia.arbiscan.io", displayName: "Arbitrum Sepolia"},
            {id: 10, name: "optimism", nativeTokenSymbol: "ETH", explorerUrl: "https://optimistic.etherscan.io", displayName: "Optimism"},
            {id: 11155420, name: "optimism-sepolia", nativeTokenSymbol: "ETH", explorerUrl: "https://sepolia-optimism.etherscan.io", displayName: "Optimism Sepolia"},
            {id: 8453, name: "base", nativeTokenSymbol: "ETH", explorerUrl: "https://basescan.org", displayName: "Base"},
            {id: 84532, name: "base-sepolia", nativeTokenSymbol: "ETH", explorerUrl: "https://sepolia.basescan.org", displayName: "Base Sepolia"},
            {id: 56, name: "bsc", nativeTokenSymbol: "BNB", explorerUrl: "https://bscscan.com", displayName: "BSC"},
            {id: 97, name: "bsc-testnet", nativeTokenSymbol: "BNB", explorerUrl: "https://testnet.bscscan.com", displayName: "BSC Testnet"},
            {id: 42170, name: "arbitrum-nova", nativeTokenSymbol: "ETH", explorerUrl: "https://nova.arbiscan.io", displayName: "Arbitrum Nova"},
            {id: 43114, name: "avalanche", nativeTokenSymbol: "AVAX", explorerUrl: "https://subnets.avax.network/c-chain", displayName: "Avalanche"},
            {id: 43113, name: "avalanche-testnet", nativeTokenSymbol: "AVAX", explorerUrl: "https://subnets-test.avax.network/c-chain", displayName: "Avalanche Testnet"},
            {id: 747474, name: "katana", nativeTokenSymbol: "ETH", explorerUrl: "https://katanascan.com", displayName: "Katana"},
        ]);
    });

    it("looks up networks by id or name", () => {
        expect(findNetworkById(43113)).toMatchObject({
            id: 43113,
            name: "avalanche-testnet",
            displayName: "Avalanche Testnet",
        });
        expect(findNetworkById(421614)).toMatchObject({
            id: 421614,
            name: "arbitrum-sepolia",
            displayName: "Arbitrum Sepolia",
        });
        expect(findNetworkByName("  BASE-SEPOLIA ")).toMatchObject({
            id: 84532,
            name: "base-sepolia",
            displayName: "Base Sepolia",
        });
        expect(findNetworkByName("Ethereum")).toBeUndefined();
    });

    it("is available from OMSClient", () => {
        const oms = new OMSClient({
            publicApiKey: "public-api-key",
            projectId: "project-id",
        });

        expect(oms.supportedNetworks).toBe(supportedNetworks);
    });
});
