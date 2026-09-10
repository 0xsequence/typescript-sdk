import type {
  Ciphersuite as GeneratedCiphersuite,
  FeeOption as GeneratedFeeOption,
  FeeOptionSelection as GeneratedFeeOptionSelection,
  KeyOrigin as GeneratedKeyOrigin,
  TransactionStatusResponse as GeneratedTransactionStatusResponse
} from '../generated/waas.gen.js';
import type {
  FeeOption,
  FeeOptionSelection,
  OidcAuthMode,
  TransactionStatusResponse,
  WalletImportCipherSuite,
  WalletKeyOrigin,
  WalletType as PublicWalletType
} from '../types/waas.js';

import {
  AuthMode as GeneratedAuthMode,
  Ciphersuite as GeneratedCiphersuiteValues,
  KeyOrigin as GeneratedKeyOriginValues,
  NetworkFamily as GeneratedNetworkFamily,
  TransactionMode as GeneratedTransactionMode,
  TransactionStatus as GeneratedTransactionStatus
} from '../generated/waas.gen.js';
import {
  AuthMode,
  TransactionMode,
  TransactionStatus,
  WalletImportCipherSuite as WalletImportCipherSuiteValues,
  WalletKeyOrigin as WalletKeyOriginValues
} from '../types/waas.js';

export function toGeneratedAuthMode(authMode: OidcAuthMode): GeneratedAuthMode {
  switch (authMode) {
    case AuthMode.AuthCode:
      return GeneratedAuthMode.AuthCode;
    case AuthMode.AuthCodePKCE:
      return GeneratedAuthMode.AuthCodePKCE;
  }
}

export function toGeneratedNetworkFamily(walletType: PublicWalletType): GeneratedNetworkFamily {
  switch (walletType) {
    case 'ethereum':
      return GeneratedNetworkFamily.EVM;
    case 'solana':
      return GeneratedNetworkFamily.Solana;
  }
}

export function fromGeneratedNetworkFamily(
  networkFamily: GeneratedNetworkFamily
): PublicWalletType {
  switch (networkFamily) {
    case GeneratedNetworkFamily.EVM:
      return 'ethereum';
    case GeneratedNetworkFamily.Solana:
      return 'solana';
  }
}

export function fromGeneratedWalletKeyOrigin(keyOrigin: GeneratedKeyOrigin): WalletKeyOrigin {
  switch (keyOrigin) {
    case GeneratedKeyOriginValues.Enclave:
      return WalletKeyOriginValues.Enclave;
    case GeneratedKeyOriginValues.Imported:
      return WalletKeyOriginValues.Imported;
  }
}

export function toGeneratedWalletImportCipherSuite(
  cipherSuite: WalletImportCipherSuite
): GeneratedCiphersuite {
  switch (cipherSuite) {
    case WalletImportCipherSuiteValues.X25519Sha256Aes256Gcm:
      return GeneratedCiphersuiteValues.X25519_SHA256_AES_256_GCM;
    case WalletImportCipherSuiteValues.X25519Sha256ChaCha20Poly1305:
      return GeneratedCiphersuiteValues.X25519_SHA256_ChaCha20_Poly1305;
    case WalletImportCipherSuiteValues.P256Sha256Aes256Gcm:
      return GeneratedCiphersuiteValues.P256_SHA256_AES_256_GCM;
    case WalletImportCipherSuiteValues.P256Sha256ChaCha20Poly1305:
      return GeneratedCiphersuiteValues.P256_SHA256_ChaCha20_Poly1305;
  }
}

export function toGeneratedTransactionMode(mode: TransactionMode): GeneratedTransactionMode {
  switch (mode) {
    case TransactionMode.Native:
      return GeneratedTransactionMode.Native;
    case TransactionMode.Relayer:
      return GeneratedTransactionMode.Relayer;
  }
}

export function fromGeneratedTransactionStatus(
  status: GeneratedTransactionStatus
): TransactionStatus {
  switch (status) {
    case GeneratedTransactionStatus.Quoted:
      return 'quoted';
    case GeneratedTransactionStatus.Pending:
      return 'pending';
    case GeneratedTransactionStatus.Executed:
      return 'executed';
    case GeneratedTransactionStatus.Failed:
      return 'failed';
    default:
      return TransactionStatus.Unknown;
  }
}

export function fromGeneratedTransactionStatusResponse(
  response: GeneratedTransactionStatusResponse
): TransactionStatusResponse {
  return {
    status: fromGeneratedTransactionStatus(response.status),
    txnHash: response.txnHash
  };
}

export function fromGeneratedFeeOption(feeOption: GeneratedFeeOption): FeeOption {
  return {
    token: { ...feeOption.token },
    value: feeOption.value,
    displayValue: feeOption.displayValue
  };
}

export function toGeneratedFeeOptionSelection(
  selection: FeeOptionSelection
): GeneratedFeeOptionSelection {
  return { token: selection.token, index: selection.index };
}
