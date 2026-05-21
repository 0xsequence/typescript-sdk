import {describe, expect, it} from "vitest";

import {
    Networks,
    OMSClient,
    findNetworkById,
    findNetworkByName,
    supportedNetworks,
} from "../src";

describe("Networks", () => {
    it("exposes the supported network registry", () => {
        expect(supportedNetworks).toEqual([
            Networks.mainnet,
            Networks.sepolia,
            Networks.polygon,
            Networks.amoy,
            Networks.arbitrum,
            Networks.arbitrumSepolia,
            Networks.optimism,
            Networks.optimismSepolia,
            Networks.base,
            Networks.baseSepolia,
            Networks.bsc,
            Networks.bscTestnet,
            Networks.arbitrumNova,
            Networks.avalanche,
            Networks.avalancheTestnet,
            Networks.katana,
        ]);
        expect(Networks.katana).toEqual({
            id: 747474,
            name: "katana",
            nativeTokenSymbol: "ETH",
            explorerUrl: "https://katanascan.com",
            displayName: "Katana",
        });
        expect(supportedNetworks.map(network => network.displayName)).toEqual([
            "Ethereum",
            "Sepolia",
            "Polygon",
            "Polygon Amoy",
            "Arbitrum",
            "Arbitrum Sepolia",
            "Optimism",
            "Optimism Sepolia",
            "Base",
            "Base Sepolia",
            "BSC",
            "BSC Testnet",
            "Arbitrum Nova",
            "Avalanche",
            "Avalanche Testnet",
            "Katana",
        ]);
    });

    it("looks up networks by id or name", () => {
        expect(findNetworkById(43113)).toBe(Networks.avalancheTestnet);
        expect(findNetworkById(421614)).toBe(Networks.arbitrumSepolia);
        expect(findNetworkByName("base-sepolia")).toBe(Networks.baseSepolia);
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
