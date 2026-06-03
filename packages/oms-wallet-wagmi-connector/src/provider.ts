import {
    getAddress,
    hexToBigInt,
    hexToBytes,
    isAddress,
    isHex,
    numberToHex,
    stringToHex,
    type Address,
    type Hex,
} from "viem";

import type {
    MaybePromise,
    OmsWalletClientLike,
    OmsWalletConnectorParameters,
    OmsWalletNetwork,
    OmsWalletProviderTransactionRequest,
    OmsWalletTransactionOptions,
} from "./types.js";

const providerEvents = ["accountsChanged", "chainChanged", "connect", "disconnect", "message"] as const;

type ProviderEvent = typeof providerEvents[number];
type ProviderListener = (...args: unknown[]) => void;

export class OmsWalletProviderRpcError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly data?: unknown,
    ) {
        super(message);
        this.name = "OmsWalletProviderRpcError";
    }
}

export class OmsWalletProvider {
    private readonly listeners = new Map<ProviderEvent, Set<ProviderListener>>();

    constructor(
        private readonly params: OmsWalletConnectorParameters,
        private readonly getClient: () => MaybePromise<OmsWalletClientLike>,
        private readonly getChainId: () => number,
        private readonly setChainId: (chainId: number) => void,
        private readonly syncChainId: (chainId: number) => void,
        private readonly getNetworks: () => MaybePromise<readonly OmsWalletNetwork[]>,
        private readonly connectWallet: (parameters?: {chainId?: number; isReconnecting?: boolean}) => Promise<readonly Address[]>,
        private readonly isDisconnected: () => MaybePromise<boolean>,
    ) {}

    on(event: ProviderEvent, listener: ProviderListener): this {
        this.listenersFor(event).add(listener);
        return this;
    }

    removeListener(event: ProviderEvent, listener: ProviderListener): this {
        this.listenersFor(event).delete(listener);
        return this;
    }

    emit(event: ProviderEvent, ...args: unknown[]): void {
        for (const listener of this.listenersFor(event)) {
            listener(...args);
        }
    }

    async request({method, params}: {method: string; params?: unknown}): Promise<unknown> {
        switch (method) {
            case "eth_chainId":
                return numberToHex(this.getChainId());
            case "net_version":
                return String(this.getChainId());
            case "eth_accounts":
                return this.accounts();
            case "eth_requestAccounts":
                return this.connectWallet({chainId: this.getChainId()});
            case "personal_sign":
                return this.signMessage(params);
            case "eth_sign":
                throw unsupportedMethod(method);
            case "eth_signTypedData":
                throw unsupportedMethod(method);
            case "eth_signTypedData_v4":
                return this.signTypedData(params);
            case "eth_sendTransaction":
            case "wallet_sendTransaction":
                return this.sendTransaction(params);
            case "wallet_switchEthereumChain":
                return this.switchEthereumChain(params);
            case "wallet_getCapabilities":
                return {};
            default:
                throw unsupportedMethod(method);
        }
    }

    private async accounts(): Promise<readonly Address[]> {
        if (await this.isDisconnected()) {
            return [];
        }
        const address = (await this.getClient()).wallet.walletAddress;
        return address ? [getAddress(address)] : [];
    }

    private async requireAccount(): Promise<Address> {
        const [account] = await this.accounts();
        if (!account) {
            throw new OmsWalletProviderRpcError(4100, "No active OMS wallet session.");
        }
        return account;
    }

    private async signMessage(params: unknown): Promise<string> {
        const [message, account] = paramsAsTuple(params, "personal_sign");
        await this.requireMatchingAccount(account, "personal_sign");
        const client = await this.getClient();
        return client.wallet.signMessage({
            network: await this.currentNetwork(),
            message: normalizeMessage(message),
        });
    }

    private async signTypedData(params: unknown): Promise<string> {
        const [account, typedData] = paramsAsTuple(params, "eth_signTypedData_v4");
        await this.requireMatchingAccount(account, "eth_signTypedData_v4");
        const client = await this.getClient();
        return client.wallet.signTypedData({
            network: await this.currentNetwork(),
            typedData: normalizeTypedData(typedData),
        });
    }

    private async sendTransaction(params: unknown): Promise<Hex> {
        const [request] = paramsAsTuple(params, "eth_sendTransaction") as [OmsWalletProviderTransactionRequest];
        if (!request || typeof request !== "object") {
            throw invalidParams("eth_sendTransaction requires a transaction object.");
        }
        assertKnownTransactionFields(request);
        await this.requireMatchingAccount(request.from, "eth_sendTransaction");
        if (!request.to || !isAddress(request.to)) {
            throw unsupportedMethod("eth_sendTransaction without a recipient address; contract deployment is not supported by the current OMS wallet SDK");
        }

        const client = await this.getClient();
        const transactionChainId = request.chainId === undefined
            ? this.getChainId()
            : normalizeChainId(request.chainId);
        const network = await this.requireNetwork(transactionChainId);
        const transactionOptions = await this.resolveTransactionOptions(request, transactionChainId);
        if ((transactionOptions as {waitForStatus?: unknown} | undefined)?.waitForStatus === false) {
            throw invalidParams("waitForStatus: false is not supported by the OMS Wallet wagmi connector because wagmi sendTransaction must return an EVM transaction hash.");
        }
        const transactionBase = {
            network,
            to: getAddress(request.to),
            ...transactionOptions,
            waitForStatus: true,
        } as const;
        const value = request.value === undefined ? 0n : normalizeValue(request.value);
        const response = request.data === undefined
            ? await client.wallet.sendTransaction({
                ...transactionBase,
                value,
            })
            : await client.wallet.sendTransaction({
                ...transactionBase,
                value,
                data: request.data,
            });

        if (!response.txnHash || !isHex(response.txnHash)) {
            throw new OmsWalletProviderRpcError(
                -32603,
                missingTransactionHashMessage(response),
                response,
            );
        }

        return response.txnHash;
    }

    private async switchEthereumChain(params: unknown): Promise<null> {
        const [request] = paramsAsTuple(params, "wallet_switchEthereumChain") as [{chainId?: Hex | number | string}];
        const chainId = normalizeChainId(request?.chainId);
        await this.requireNetwork(chainId);
        this.setChainId(chainId);
        this.syncChainId(chainId);
        this.emit("chainChanged", numberToHex(chainId));
        return null;
    }

    private async currentNetwork(): Promise<OmsWalletNetwork> {
        return this.requireNetwork(this.getChainId());
    }

    private async requireNetwork(chainId: number): Promise<OmsWalletNetwork> {
        const network = (await this.getNetworks()).find(candidate => candidate.id === chainId);
        if (!network) {
            throw new OmsWalletProviderRpcError(4901, `OMS does not support chain ${chainId}.`);
        }
        return network;
    }

    private async resolveTransactionOptions(
        request: OmsWalletProviderTransactionRequest,
        chainId: number,
    ): Promise<OmsWalletTransactionOptions | undefined> {
        const options = this.params.transactionOptions;
        if (typeof options === "function") {
            return options({chainId, request});
        }
        return options;
    }

    private listenersFor(event: ProviderEvent): Set<ProviderListener> {
        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }
        return listeners;
    }

    private async requireMatchingAccount(account: unknown, method: string): Promise<Address> {
        const activeAccount = await this.requireAccount();
        if (account === undefined || account === null) {
            return activeAccount;
        }
        if (typeof account !== "string" || !isAddress(account)) {
            throw invalidParams(`${method} requires a valid account address.`);
        }

        const requestedAccount = getAddress(account);
        if (requestedAccount !== activeAccount) {
            throw new OmsWalletProviderRpcError(
                4100,
                `${method} requested ${requestedAccount}, but the active OMS wallet is ${activeAccount}.`,
            );
        }

        return activeAccount;
    }
}

const supportedTransactionFields = new Set(["from", "to", "value", "data", "chainId"]);
const ignoredTransactionFields = new Set([
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "type",
    "accessList",
]);

function paramsAsTuple(params: unknown, method: string): unknown[] {
    if (!Array.isArray(params)) {
        throw invalidParams(`${method} requires positional parameters.`);
    }
    return params;
}

function assertKnownTransactionFields(request: OmsWalletProviderTransactionRequest): void {
    const unsupportedFields = Object.keys(request).filter(field =>
        !supportedTransactionFields.has(field) &&
        !ignoredTransactionFields.has(field) &&
        request[field] !== undefined
    );
    if (unsupportedFields.length > 0) {
        throw unsupportedMethod(`eth_sendTransaction with unsupported fields: ${unsupportedFields.join(", ")}`);
    }
}

function normalizeMessage(message: unknown): string {
    if (typeof message !== "string") {
        throw invalidParams("Signing message must be a string.");
    }
    if (!isHex(message)) {
        return message;
    }

    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(hexToBytes(message));
    } catch {
        throw invalidParams("Signing raw byte messages is not supported by OMS Wallet; pass a UTF-8 string message.");
    }
}

function normalizeTypedData(typedData: unknown): unknown {
    if (typeof typedData !== "string") {
        return typedData;
    }
    try {
        return JSON.parse(typedData);
    } catch {
        throw invalidParams("Typed data must be JSON when passed as a string.");
    }
}

function normalizeValue(value: unknown): bigint {
    if (!isQuantity(value)) {
        throw invalidParams("Transaction value must be a JSON-RPC quantity hex string.");
    }
    return hexToBigInt(value);
}

function missingTransactionHashMessage(response: {txnId?: unknown}): string {
    const suffix = typeof response.txnId === "string"
        ? ` OMS transaction id: ${response.txnId}.`
        : "";
    return `OMS transaction did not produce the EVM transaction hash required by wagmi sendTransaction.${suffix}`;
}

function isQuantity(value: unknown): value is Hex {
    return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value);
}

function normalizeChainId(chainId: Hex | bigint | number | string | undefined): number {
    let normalized: number;
    if (typeof chainId === "number") {
        normalized = chainId;
    } else if (typeof chainId === "bigint") {
        normalized = Number(chainId);
    } else if (typeof chainId === "string" && isHex(chainId)) {
        normalized = Number(hexToBigInt(chainId));
    } else if (typeof chainId === "string") {
        normalized = Number(chainId);
    } else {
        throw invalidParams("Chain ID is required.");
    }

    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw invalidParams("Chain ID must be a positive safe integer.");
    }
    return normalized;
}

function invalidParams(message: string): OmsWalletProviderRpcError {
    return new OmsWalletProviderRpcError(-32602, message);
}

function unsupportedMethod(method: string): OmsWalletProviderRpcError {
    return new OmsWalletProviderRpcError(4200, `Unsupported OMS provider method: ${method}.`);
}

export function stringToPersonalSignHex(message: string): Hex {
    return stringToHex(message);
}
