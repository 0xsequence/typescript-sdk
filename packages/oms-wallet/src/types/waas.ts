export const AuthMode = Object.freeze({
  OTP: 'otp',
  IDToken: 'id-token',
  AuthCode: 'auth-code',
  AuthCodePKCE: 'auth-code-pkce'
} as const);

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];
export type OidcAuthMode = typeof AuthMode.AuthCode | typeof AuthMode.AuthCodePKCE;

export const WalletType = Object.freeze({
  Ethereum: 'ethereum',
  Solana: 'solana'
} as const);

export type WalletType = (typeof WalletType)[keyof typeof WalletType];

export const WalletKeyOrigin = Object.freeze({
  Enclave: 'enclave',
  Imported: 'imported'
} as const);

export type WalletKeyOrigin = (typeof WalletKeyOrigin)[keyof typeof WalletKeyOrigin];

export const WalletImportCipherSuite = Object.freeze({
  X25519Sha256Aes256Gcm: 'x25519-sha256-aes256gcm',
  X25519Sha256ChaCha20Poly1305: 'x25519-sha256-chacha20poly1305',
  P256Sha256Aes256Gcm: 'p256-sha256-aes256gcm',
  P256Sha256ChaCha20Poly1305: 'p256-sha256-chacha20poly1305'
} as const);

export type WalletImportCipherSuite =
  (typeof WalletImportCipherSuite)[keyof typeof WalletImportCipherSuite];

export const TransactionMode = Object.freeze({
  Native: 'native',
  Relayer: 'relayer'
} as const);

export type TransactionMode = (typeof TransactionMode)[keyof typeof TransactionMode];

export const TransactionStatus = Object.freeze({
  Quoted: 'quoted',
  Pending: 'pending',
  Executed: 'executed',
  Failed: 'failed',
  Unknown: 'unknown'
} as const);

export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export interface AbiArg {
  type: string;
  value: unknown;
}

export interface TransactionStatusResponse {
  status: TransactionStatus;
  txnHash?: string;
}

export interface FeeToken {
  network: string;
  name: string;
  symbol: string;
  type: string;
  decimals?: number;
  logoURL?: string;
  contractAddress?: string;
  tokenID?: string;
}

export interface FeeOption {
  token: FeeToken;
  value: string;
  displayValue: string;
}

export interface FeeOptionSelection {
  token: string;
  index?: number;
}
