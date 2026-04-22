export interface StorageManager {
    get(key: string): string | null
    set(key: string, value: string): void
    delete(key: string): void
}

/**
 * Browser implementation backed by localStorage.
 * For Node.js or React Native, supply your own StorageManager to OmsWalletSdk.
 */
export class LocalStorageManager implements StorageManager {
    get(key: string): string | null { return localStorage.getItem(key) }
    set(key: string, value: string): void { localStorage.setItem(key, value) }
    delete(key: string): void { localStorage.removeItem(key) }
}

export class MemoryStorageManager implements StorageManager {
    private store = new Map<string, string>();

    get(key: string): string | null {
        return this.store.get(key) ?? null;
    }
    set(key: string, value: string): void {
        this.store.set(key, value);
    }
    delete(key: string): void {
        this.store.delete(key);
    }
}