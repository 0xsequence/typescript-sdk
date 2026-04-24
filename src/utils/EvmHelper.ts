import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { keccak256, toBytes } from 'viem'
import { ByteUtils } from './byteUtils'

export class EvmHelper {
    static getWalletAddress(privateKeyBytes: Uint8Array): string {
        const account = privateKeyToAccount(
            `0x${ByteUtils.bytesToHex(privateKeyBytes)}`,
        )
        return account.address
    }

    static async signUTF8MessageEIP191(
        privateKeyBytes: Uint8Array,
        message: string,
    ): Promise<string> {
        const account = privateKeyToAccount(
            `0x${ByteUtils.bytesToHex(privateKeyBytes)}`,
        )
        return account.signMessage({ message }) // EIP-191 by default
    }

    static keccak256(data: string): string {
        return keccak256(toBytes(data)) // toBytes handles UTF-8 encoding
    }

    static generatePrivateKey(): Uint8Array {
        // viem's generatePrivateKey returns `0x${string}`
        return ByteUtils.hexToBytes(generatePrivateKey().slice(2))
    }
}