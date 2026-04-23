import "dotenv/config";
import readline from "node:readline/promises";
import {MemoryStorageManager} from "../src/storageManager";
import {OMSClient} from "../src";

async function main() {
    const projectAccessKey = required("OMS_PROJECT_ACCESS_KEY");
    const email = required("OMS_TEST_EMAIL");

    console.log("------------------------------------------------------------");
    console.log(" OmsWallet sign-in flow");
    console.log("------------------------------------------------------------");
    console.log("project access key :", mask(projectAccessKey));
    console.log("email              :", email);
    console.log();

    console.log("[setup] creating OmsWallet…");
    const client = new OMSClient({
        projectAccessKey,
        storage: new MemoryStorageManager(),
    });

    console.log("[setup] ready:", client.wallet.constructor.name);
    console.log();

    // --- Step 1 -------------------------------------------------------------
    console.log(`[step 1] signInWithEmail("${email}")`);
    let t = Date.now();
    try {
        await client.wallet.signInWithEmail(email);
        console.log(`[step 1] ok (${Date.now() - t}ms) — check your inbox`);
    } catch (err) {
        console.error(`[step 1] FAILED (${Date.now() - t}ms):`, err);
        process.exit(1);
    }
    console.log();

    // --- Step 2 -------------------------------------------------------------
    const code = process.env.OMS_TEST_CODE ?? (await prompt("Enter the code from your email: "));
    console.log(`[step 2] completeEmailSignIn("${mask(code)}")`);
    t = Date.now();
    try {
        await client.wallet.completeEmailSignIn(code);
        console.log(`[step 2] ok (${Date.now() - t}ms)`);
    } catch (err) {
        console.error(`[step 2] FAILED (${Date.now() - t}ms):`, err);
        process.exit(1);
    }
    console.log();

    console.log("✓ sign-in flow complete");
    // If WalletClient exposes state, dump it here for inspection:
    // console.log("wallet state:", wallet.wallet);

    const signature = await client.wallet.signMessage("amoy", "test");
}

// --- helpers --------------------------------------------------------------

function required(name: string): string {
    const v = process.env[name];
    if (!v) {
        console.error(`Missing required env var: ${name}`);
        console.error("Set it in your .env file or export it before running.");
        process.exit(1);
    }
    return v;
}

function mask(value: string | undefined): string {
    if (!value) return "<missing>";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
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