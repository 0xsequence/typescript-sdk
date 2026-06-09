import {
  WALLET_RUNTIME_KEY,
  WALLET_RUNTIME_SYMBOL,
  WALLET_RUNTIME_SYMBOL_DESCRIPTION,
  attachWalletFeeOptionsRuntime,
  createWalletFeeOptionsBridge,
  getWalletFeeOptionsBridge,
  getWalletRuntime,
  isWalletFeeOptionsBridgeV1,
  isWalletRuntimeV1,
  type WalletFeeOptionRequestV1,
  type WalletFeeOptionsBridgeV1,
  type WalletFeeOptionViewV1,
  type WalletFeeTokenViewV1,
  type WalletRuntimeV1,
} from "@0xsequence/typescript-sdk"

export {
  WALLET_RUNTIME_KEY,
  WALLET_RUNTIME_SYMBOL,
  WALLET_RUNTIME_SYMBOL_DESCRIPTION,
  createWalletFeeOptionsBridge,
  getWalletFeeOptionsBridge,
  getWalletRuntime,
  isWalletFeeOptionsBridgeV1,
  isWalletRuntimeV1,
  type WalletFeeOptionRequestV1,
  type WalletFeeOptionsBridgeV1,
  type WalletFeeOptionViewV1,
  type WalletFeeTokenViewV1,
  type WalletRuntimeV1,
}

export type WalletFeeOptionsBridge = ReturnType<
  typeof createWalletFeeOptionsBridge
>

export function attachWalletFeeOptions<T extends object>(
  target: T,
  walletFeeOptions: WalletFeeOptionsBridge,
  options: { displayName?: string; walletId?: string } = {},
): T {
  return attachWalletFeeOptionsRuntime(target, walletFeeOptions, {
    displayName: "OMS Wallet",
    walletId: "omsWallet",
    ...options,
  })
}
