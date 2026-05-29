import readline from "node:readline/promises";
import {MemoryStorageManager, Networks, OMSClient} from "@0xsequence/typescript-sdk";

const publishableKey = requiredEnv("OMS_PUBLISHABLE_KEY", process.env.OMS_PUBLISHABLE_KEY);
const projectId = requiredEnv("OMS_PROJECT_ID", process.env.OMS_PROJECT_ID);

async function main() {
    console.log("------------------------------------------------------------");
    console.log(" OmsWallet sign-in flow");
    console.log("------------------------------------------------------------");
    console.log("publishable key :", mask(publishableKey));
    console.log();

    const email = await prompt("Enter your email: ");

    console.log();
    console.log("[setup] creating OmsWallet…");

    const client = new OMSClient({
        publishableKey,
        projectId,
        storage: new MemoryStorageManager(),
    });

    console.log("[setup] ready:", client.wallet.constructor.name);
    console.log();
    console.log(`[step 1] startEmailAuth("${email}")`);

    let t = Date.now();
    try {
        await client.wallet.startEmailAuth({email});

        console.log(`[step 1] ok (${Date.now() - t}ms) — check your inbox`);
    } catch (err) {
        console.error(`[step 1] FAILED (${Date.now() - t}ms):`, err);
        process.exit(1);
    }
    console.log();

    const code = await prompt("Enter the code from your email: ");

    console.log(`[step 2] completeEmailAuth("${mask(code)}")`);
    t = Date.now();

    try {
        const result = await client.wallet.completeEmailAuth({code});

        console.log(`[step 2] ok (${Date.now() - t}ms)`);
        console.log(`[step 2] wallet ${result.walletAddress}`);
        console.log(`[step 2] credential ${result.credential.credentialId}`);
    } catch (err) {
        console.error(`[step 2] FAILED (${Date.now() - t}ms):`, err);
        process.exit(1);
    }

    console.log();
    console.log("✓ sign-in flow complete");

    await client.wallet.signMessage({
        network: Networks.amoy,
        message: "test"
    });
}

function mask(value: string | undefined): string {
    if (!value) return "<missing>";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function requiredEnv(name: string, value: string | undefined): string {
    if (!value) {
        throw new Error(`Missing ${name}. Set it before running pnpm dev:node-example`);
    }
    return value;
}

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
}

main().catch((err) => {
    console.error("unhandled error:", err);
    process.exit(1);
});
