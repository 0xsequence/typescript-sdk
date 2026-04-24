import "dotenv/config";
import { describe, it, expect } from "vitest";
import { MemoryStorageManager } from "../src/storageManager";
import { OMSClient } from "../src";

const { OMS_PROJECT_ACCESS_KEY } = process.env;

describe.skipIf(!OMS_PROJECT_ACCESS_KEY)(
    "OmsWallet email sign-in flow",
    () => {
        it("signs in with email and signs a message", async () => {
            const client = new OMSClient({
                projectAccessKey: OMS_PROJECT_ACCESS_KEY!,
                storage: new MemoryStorageManager(),
            });

            expect(client.wallet).toBeDefined();

            const balances = await client.indexer.getTokenBalances({
                chainId: "amoy",
                walletAddress: "0x4ad84f7014b7b44f723f284a85b1662337971439",
                contractAddress: "0x7a20400bd721dc2b910a0bd5d01b4d3497b949b1",
                includeMetadata: true
            })

            expect(balances.balances.length).toBeGreaterThanOrEqual(1);
        }, 60_000);
    }
);