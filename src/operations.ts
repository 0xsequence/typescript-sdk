export const WalletOperation = {
    pendingWalletSelectionSelectWallet: "wallet.pendingWalletSelection.selectWallet",
    pendingWalletSelectionCreateAndSelectWallet: "wallet.pendingWalletSelection.createAndSelectWallet",
    startEmailAuth: "wallet.startEmailAuth",
    completeEmailAuth: "wallet.completeEmailAuth",
    startOidcRedirectAuth: "wallet.startOidcRedirectAuth",
    completeOidcRedirectAuth: "wallet.completeOidcRedirectAuth",
    signInWithOidcRedirect: "wallet.signInWithOidcRedirect",
    signOut: "wallet.signOut",
    listWallets: "wallet.listWallets",
    useWallet: "wallet.useWallet",
    createWallet: "wallet.createWallet",
    signMessage: "wallet.signMessage",
    signTypedData: "wallet.signTypedData",
    isValidMessageSignature: "wallet.isValidMessageSignature",
    isValidTypedDataSignature: "wallet.isValidTypedDataSignature",
    sendTransaction: "wallet.sendTransaction",
    callContract: "wallet.callContract",
    getTransactionStatus: "wallet.getTransactionStatus",
    listAccess: "wallet.listAccess",
    listAccessPages: "wallet.listAccessPages",
    revokeAccess: "wallet.revokeAccess",
    transactionStatus: "wallet.transactionStatus",
} as const

export type WalletOperation = typeof WalletOperation[keyof typeof WalletOperation]

export const IndexerOperation = {
    getTokenBalances: "indexer.getTokenBalances",
    getNativeTokenBalance: "indexer.getNativeTokenBalance",
} as const

export type IndexerOperation = typeof IndexerOperation[keyof typeof IndexerOperation]

export type OmsSdkOperation = WalletOperation | IndexerOperation
