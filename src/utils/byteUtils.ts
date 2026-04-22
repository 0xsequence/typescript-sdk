export class ByteUtils {
    static hexToBytes(hex: string): Uint8Array {
        const h = hex.startsWith('0x') ? hex.slice(2) : hex
        const bytes = new Uint8Array(h.length / 2)
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
        }
        return bytes
    }

    static bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    }
}