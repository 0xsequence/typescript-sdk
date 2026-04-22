import {ethers} from "ethers";
import {ByteUtils} from "./byteUtils";

export class EvmHelper {
    static getWalletAddress(privateKeyBytes: Uint8Array): string {
        return new ethers.Wallet('0x' + ByteUtils.bytesToHex(privateKeyBytes)).address
    }

    static async signUTF8MessageEIP191(privateKeyBytes: Uint8Array, message: string): Promise<string> {
        return new ethers.Wallet('0x' + ByteUtils.bytesToHex(privateKeyBytes)).signMessage(message)
    }

    static keccak256(data: string): string {
        return ethers.keccak256(ethers.toUtf8Bytes(data));
    }

    static generatePrivateKey(): Uint8Array {
        return ByteUtils.hexToBytes(ethers.Wallet.createRandom().privateKey.slice(2));
    }
}