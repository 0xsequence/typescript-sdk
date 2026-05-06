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
    static isAvailable(): boolean {
        try {
            const storage = globalThis.localStorage
            if (!storage) return false
            const key = "__oms_sdk_storage_probe__"
            storage.setItem(key, key)
            storage.removeItem(key)
            return true
        } catch {
            return false
        }
    }

    get(key: string): string | null { return this.storage().getItem(key) }
    set(key: string, value: string): void { this.storage().setItem(key, value) }
    delete(key: string): void { this.storage().removeItem(key) }

    private storage(): Storage {
        if (!globalThis.localStorage) {
            throw new Error("LocalStorageManager requires globalThis.localStorage")
        }
        return globalThis.localStorage
    }
}

export class SessionStorageManager implements StorageManager {
    static isAvailable(): boolean {
        try {
            const storage = globalThis.sessionStorage
            if (!storage) return false
            const key = "__oms_sdk_session_storage_probe__"
            storage.setItem(key, key)
            storage.removeItem(key)
            return true
        } catch {
            return false
        }
    }

    get(key: string): string | null { return this.storage().getItem(key) }
    set(key: string, value: string): void { this.storage().setItem(key, value) }
    delete(key: string): void { this.storage().removeItem(key) }

    private storage(): Storage {
        if (!globalThis.sessionStorage) {
            throw new Error("SessionStorageManager requires globalThis.sessionStorage")
        }
        return globalThis.sessionStorage
    }
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

export function createDefaultStorage(): StorageManager {
    return LocalStorageManager.isAvailable()
        ? new LocalStorageManager()
        : new MemoryStorageManager()
}
