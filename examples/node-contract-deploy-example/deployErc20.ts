import {randomBytes} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import readline from "node:readline/promises";
import {fileURLToPath} from "node:url";
import {MemoryStorageManager, Networks, OMSClient} from "@0xsequence/typescript-sdk";
import {config as loadDotenv} from "dotenv";
import solc from "solc";
import {encodeDeployData, getContractAddress, isAddress, parseAbi} from "viem";
import type {Abi, Address, Hex} from "viem";

const exampleDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({path: join(exampleDir, ".env.local"), quiet: true});
loadDotenv({path: join(exampleDir, ".env"), quiet: true});

const publishableKey = requiredEnv("OMS_PUBLISHABLE_KEY", process.env.OMS_PUBLISHABLE_KEY);
const projectId = requiredEnv("OMS_PROJECT_ID", process.env.OMS_PROJECT_ID);
const defaultDeployerAddress = "0xce0042B868300000d44A59004Da54A005ffdcf9f" as const satisfies Address;
const deployerAddress = optionalAddress("DEPLOYER_ADDRESS", process.env.DEPLOYER_ADDRESS) ?? defaultDeployerAddress;

const deployerAbi = parseAbi([
    "function deploy(bytes initCode, bytes32 salt) returns (address payable createdContract)",
]);

type TokenConfig = {
    name: string
    symbol: string
    decimals: number
}

const defaultTokenConfig: TokenConfig = {
    name: "WalletKit Dollar",
    symbol: "WKUSD",
    decimals: 6,
};

async function main() {
    console.log("------------------------------------------------------------");
    console.log(" OMS wallet ERC-20 deploy example");
    console.log("------------------------------------------------------------");
    console.log("network          :", `${Networks.amoy.displayName} (${Networks.amoy.id})`);
    console.log("publishable key   :", mask(publishableKey));
    console.log("deployer address :", deployerAddress);
    console.log();

    const client = new OMSClient({
        publishableKey,
        projectId,
        storage: new MemoryStorageManager(),
    });

    const email = await prompt("Enter your email: ");

    console.log();
    console.log(`[auth] startEmailAuth("${email}")`);
    await client.wallet.startEmailAuth({email});

    const code = await prompt("Enter the code from your email: ");

    console.log(`[auth] completeEmailAuth("${mask(code)}")`);
    const authResult = await client.wallet.completeEmailAuth({code});
    console.log(`[auth] logged in as ${authResult.walletAddress}`);
    console.log();

    const tokenConfig = await promptTokenConfig();
    const compiled = compilePublicMintErc20();
    const initCode = encodeDeployData({
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args: [tokenConfig.name, tokenConfig.symbol, tokenConfig.decimals],
    });
    const salt = parseSalt(process.env.DEPLOY_SALT);
    const contractAddress = getContractAddress({
        opcode: "CREATE2",
        from: deployerAddress,
        salt,
        bytecode: initCode,
    });

    console.log("[token] name        :", tokenConfig.name);
    console.log("[token] symbol      :", tokenConfig.symbol);
    console.log("[token] decimals    :", tokenConfig.decimals);
    console.log("[compile] contract    : PublicMintERC20");
    console.log("[compile] bytecode    :", `${(compiled.bytecode.length - 2) / 2} bytes`);
    console.log("[deploy] salt         :", salt);
    console.log("[deploy] contract     :", contractAddress);
    console.log("[deploy] init code    :", `${(initCode.length - 2) / 2} bytes`);
    console.log();

    const tx = await client.wallet.sendTransaction({
        network: Networks.amoy,
        to: deployerAddress,
        abi: deployerAbi,
        functionName: "deploy",
        args: [initCode, salt],
        statusPolling: {
            timeoutMs: 120_000,
            intervalMs: 2_000,
        },
    });

    const artifactPath = writeDeployArtifact({
        tokenConfig,
        walletAddress: authResult.walletAddress,
        deployerAddress,
        contractAddress,
        salt,
        initCode,
        tx,
    });

    console.log("[deploy] status :", tx.status);
    console.log("[deploy] txn id :", tx.txnId);
    console.log("[deploy] tx hash:", tx.txnHash ?? "<pending>");
    console.log("[deploy] contract:", contractAddress);
    console.log("[deploy] contract explorer:", `${Networks.amoy.explorerUrl}/address/${contractAddress}`);
    if (tx.txnHash) {
        console.log("[deploy] tx explorer:", `${Networks.amoy.explorerUrl}/tx/${tx.txnHash}`);
    }
    console.log("[deploy] artifact:", artifactPath);
}

type SolcOutput = {
    contracts?: Record<string, Record<string, {
        abi: Abi
        evm?: {
            bytecode?: {
                object?: string
            }
        }
    }>>
    errors?: Array<{
        severity: "error" | "warning" | "info"
        formattedMessage: string
    }>
}

function compilePublicMintErc20(): {abi: Abi; bytecode: Hex} {
    const sourcePath = join(exampleDir, "contracts", "PublicMintERC20.sol");
    const source = readFileSync(sourcePath, "utf8");

    const input = {
        language: "Solidity",
        sources: {
            "PublicMintERC20.sol": {
                content: source,
            },
        },
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                "*": {
                    "*": ["abi", "evm.bytecode.object"],
                },
            },
        },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
    const errors = output.errors ?? [];
    const fatalErrors = errors.filter(error => error.severity === "error");
    for (const error of errors.filter(error => error.severity !== "error")) {
        console.warn(error.formattedMessage);
    }

    if (fatalErrors.length > 0) {
        throw new Error(fatalErrors.map(error => error.formattedMessage).join("\n"));
    }

    const contract = output.contracts?.["PublicMintERC20.sol"]?.PublicMintERC20;
    const bytecodeObject = contract?.evm?.bytecode?.object;
    if (!contract || !bytecodeObject) {
        throw new Error("Solidity compilation did not produce PublicMintERC20 bytecode");
    }

    return {
        abi: contract.abi,
        bytecode: `0x${bytecodeObject}`,
    };
}

function parseSalt(value: string | undefined): Hex {
    if (!value) {
        return `0x${randomBytes(32).toString("hex")}`;
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error("DEPLOY_SALT must be a 32-byte hex string");
    }

    return value as Hex;
}

function parseDecimals(value: string): number {
    const decimals = Number.parseInt(value, 10);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new Error("Token decimals must be an integer between 0 and 255");
    }
    return decimals;
}

async function promptTokenConfig(): Promise<TokenConfig> {
    console.log("[token] configure ERC-20 metadata");
    const name = await promptWithDefault("Token name", defaultTokenConfig.name);
    const symbol = (await promptWithDefault("Token symbol", defaultTokenConfig.symbol)).toUpperCase();
    const decimals = parseDecimals(
        await promptWithDefault("Token decimals", defaultTokenConfig.decimals.toString()),
    );
    console.log();

    return {name, symbol, decimals};
}

async function promptWithDefault(question: string, defaultValue: string): Promise<string> {
    const answer = await prompt(`${question} [${defaultValue}]: `);
    return answer || defaultValue;
}

function writeDeployArtifact(params: {
    tokenConfig: TokenConfig
    walletAddress: Address
    deployerAddress: Address
    contractAddress: Address
    salt: Hex
    initCode: Hex
    tx: {txnId: string; status: string; txnHash?: string}
}): string {
    const artifactsDir = join(exampleDir, "artifacts");
    mkdirSync(artifactsDir, {recursive: true});

    const deployedAt = new Date().toISOString();
    const timestamp = deployedAt.replace(/[:.]/g, "-");
    const tokenSlug = slugify(params.tokenConfig.name);
    const artifactPath = join(artifactsDir, `${timestamp}-${tokenSlug}.txt`);
    const lines = [
        `timestamp: ${deployedAt}`,
        `network: ${Networks.amoy.displayName} (${Networks.amoy.id})`,
        `tokenName: ${params.tokenConfig.name}`,
        `tokenSymbol: ${params.tokenConfig.symbol}`,
        `tokenDecimals: ${params.tokenConfig.decimals}`,
        `walletAddress: ${params.walletAddress}`,
        `deployerAddress: ${params.deployerAddress}`,
        `contractAddress: ${params.contractAddress}`,
        `contractExplorerUrl: ${Networks.amoy.explorerUrl}/address/${params.contractAddress}`,
        `salt: ${params.salt}`,
        `initCodeBytes: ${(params.initCode.length - 2) / 2}`,
        `txnId: ${params.tx.txnId}`,
        `status: ${params.tx.status}`,
        `txnHash: ${params.tx.txnHash ?? ""}`,
        `txExplorerUrl: ${params.tx.txnHash ? `${Networks.amoy.explorerUrl}/tx/${params.tx.txnHash}` : ""}`,
    ];

    writeFileSync(artifactPath, `${lines.join("\n")}\n`, "utf8");
    return artifactPath;
}

function slugify(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "token";
}

function requiredEnv(name: string, value: string | undefined): string {
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function requiredAddress(name: string, value: string | undefined): Address {
    const address = requiredEnv(name, value);
    if (!isAddress(address)) {
        throw new Error(`${name} must be an EVM address`);
    }
    return address;
}

function optionalAddress(name: string, value: string | undefined): Address | undefined {
    if (!value) {
        return undefined;
    }
    if (!isAddress(value)) {
        throw new Error(`${name} must be an EVM address`);
    }
    return value;
}

function mask(value: string | undefined): string {
    if (!value) return "<missing>";
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
}

main().catch(error => {
    console.error("unhandled error:", error);
    process.exit(1);
});
