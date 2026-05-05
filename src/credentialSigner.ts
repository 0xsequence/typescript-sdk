import {keccak256, toBytes, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {ByteUtils} from "./utils/byteUtils.js";

export type CredentialKeyType = "ethereum-secp256k1" | "webcrypto-secp256r1";

export interface CredentialSigner {
    readonly keyType: CredentialKeyType;
    credentialId(): Promise<string>;
    nextNonce(): Promise<string>;
    sign(preimage: string): Promise<string>;
    hasCredential?(): Promise<boolean>;
    clear?(): Promise<void>;
}

interface StoredWebCryptoCredential {
    id: string;
    keyType: "webcrypto-secp256r1";
    credentialId: string;
    keyPair: CryptoKeyPair;
    nonce: string;
}

const credentialDbName = "oms-wallet-sdk";
const credentialStoreName = "credentials";
const defaultWebCryptoCredentialId = "default-webcrypto-p256";

export class WebCryptoP256CredentialSigner implements CredentialSigner {
    readonly keyType = "webcrypto-secp256r1";

    private keyPair?: CryptoKeyPair;
    private credential?: string;
    private nonce = 0n;
    private initialized?: Promise<void>;

    constructor(private readonly id = defaultWebCryptoCredentialId) {}

    async credentialId(): Promise<string> {
        await this.ensureInitialized();
        return this.credential!;
    }

    async nextNonce(): Promise<string> {
        await this.ensureInitialized();

        const db = await openCredentialDb();
        if (!db) {
            this.nonce = nextNonceValue(this.nonce);
            return this.nonce.toString();
        }

        try {
            const tx = db.transaction(credentialStoreName, "readwrite");
            const txDone = idbTransactionToPromise(tx);
            const store = tx.objectStore(credentialStoreName);
            const stored = await idbRequestToPromise<StoredWebCryptoCredential | undefined>(store.get(this.id));
            const nonce = nextNonceValue(parseNonce(stored?.nonce ?? this.nonce.toString()));
            this.nonce = nonce;

            await idbRequestToPromise(store.put(this.toRecord()));
            await txDone;
            return nonce.toString();
        } finally {
            db.close();
        }
    }

    async sign(preimage: string): Promise<string> {
        await this.ensureInitialized();
        const signature = await crypto.subtle.sign(
            {name: "ECDSA", hash: "SHA-256"},
            this.keyPair!.privateKey,
            new TextEncoder().encode(preimage),
        );
        return `0x${ByteUtils.bytesToHex(new Uint8Array(signature))}`;
    }

    async hasCredential(): Promise<boolean> {
        if (this.keyPair) return true;

        const db = await openCredentialDb();
        if (!db) return false;

        try {
            const stored = await idbRequestToPromise<StoredWebCryptoCredential | undefined>(
                db.transaction(credentialStoreName, "readonly").objectStore(credentialStoreName).get(this.id),
            );
            return isUsableStoredCredential(stored);
        } finally {
            db.close();
        }
    }

    async clear(): Promise<void> {
        this.keyPair = undefined;
        this.credential = undefined;
        this.nonce = 0n;
        this.initialized = undefined;

        const db = await openCredentialDb();
        if (!db) return;

        try {
            const tx = db.transaction(credentialStoreName, "readwrite");
            const txDone = idbTransactionToPromise(tx);
            tx.objectStore(credentialStoreName).delete(this.id);
            await txDone;
        } finally {
            db.close();
        }
    }

    private async ensureInitialized(): Promise<void> {
        this.initialized ??= this.loadOrCreate();
        await this.initialized;
    }

    private async loadOrCreate(): Promise<void> {
        assertWebCryptoSupport();

        const stored = await this.load();
        if (stored) {
            this.keyPair = stored.keyPair;
            this.credential = stored.credentialId;
            this.nonce = parseNonce(stored.nonce);
            return;
        }

        this.keyPair = await crypto.subtle.generateKey(
            {name: "ECDSA", namedCurve: "P-256"},
            false,
            ["sign", "verify"],
        ) as CryptoKeyPair;

        const publicKey = await crypto.subtle.exportKey("raw", this.keyPair.publicKey);
        this.credential = `0x${ByteUtils.bytesToHex(new Uint8Array(publicKey))}`;
        this.nonce = 0n;
        await this.persist();
    }

    private async load(): Promise<StoredWebCryptoCredential | null> {
        const db = await openCredentialDb();
        if (!db) return null;

        try {
            const stored = await idbRequestToPromise<StoredWebCryptoCredential | undefined>(
                db.transaction(credentialStoreName, "readonly").objectStore(credentialStoreName).get(this.id),
            );
            return isUsableStoredCredential(stored) ? stored : null;
        } finally {
            db.close();
        }
    }

    private async persist(): Promise<void> {
        const db = await openCredentialDb();
        if (!db) return;

        try {
            const tx = db.transaction(credentialStoreName, "readwrite");
            const txDone = idbTransactionToPromise(tx);
            await idbRequestToPromise(tx.objectStore(credentialStoreName).put(this.toRecord()));
            await txDone;
        } finally {
            db.close();
        }
    }

    private toRecord(): StoredWebCryptoCredential {
        if (!this.keyPair || !this.credential) {
            throw new Error("WebCrypto credential signer is not initialized");
        }

        return {
            id: this.id,
            keyType: this.keyType,
            credentialId: this.credential,
            keyPair: this.keyPair,
            nonce: this.nonce.toString(),
        };
    }
}

export class EthereumPrivateKeyCredentialSigner implements CredentialSigner {
    readonly keyType = "ethereum-secp256k1";
    private nonce = 0n;

    constructor(private readonly privateKey: Uint8Array) {}

    async credentialId(): Promise<string> {
        return privateKeyToAccount(privateKeyBytesToHex(this.privateKey)).address;
    }

    async nextNonce(): Promise<string> {
        this.nonce = nextNonceValue(this.nonce);
        return this.nonce.toString();
    }

    async sign(preimage: string): Promise<string> {
        const digest = keccak256(toBytes(preimage));
        return privateKeyToAccount(privateKeyBytesToHex(this.privateKey)).signMessage({message: digest});
    }
}

function privateKeyBytesToHex(privateKey: Uint8Array): Hex {
    return `0x${ByteUtils.bytesToHex(privateKey)}` as Hex;
}

function assertWebCryptoSupport(): void {
    if (!globalThis.crypto?.subtle) {
        throw new Error("WebCrypto SubtleCrypto is required for the default OMS credential signer");
    }
}

function isUsableStoredCredential(stored: StoredWebCryptoCredential | undefined): stored is StoredWebCryptoCredential {
    return Boolean(
        stored
        && stored.keyType === "webcrypto-secp256r1"
        && stored.credentialId.startsWith("0x04")
        && stored.keyPair?.privateKey
        && stored.keyPair.privateKey.extractable === false,
    );
}

function nextNonceValue(previous: bigint): bigint {
    const now = BigInt(Date.now());
    return now > previous ? now : previous + 1n;
}

function parseNonce(value: string): bigint {
    try {
        return BigInt(value);
    } catch {
        return 0n;
    }
}

async function openCredentialDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;

    const request = indexedDB.open(credentialDbName, 1);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(credentialStoreName)) {
            db.createObjectStore(credentialStoreName, {keyPath: "id"});
        }
    };
    return idbRequestToPromise(request);
}

function idbRequestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbTransactionToPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}
