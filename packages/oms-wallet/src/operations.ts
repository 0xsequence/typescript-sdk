export const WalletOperation = {
  pendingWalletSelectionSelectWallet: 'wallet.pendingWalletSelection.selectWallet',
  pendingWalletSelectionCreateAndSelectWallet:
    'wallet.pendingWalletSelection.createAndSelectWallet',
  startEmailAuth: 'wallet.startEmailAuth',
  completeEmailAuth: 'wallet.completeEmailAuth',
  signInWithOidcIdToken: 'wallet.signInWithOidcIdToken',
  startOidcRedirectAuth: 'wallet.startOidcRedirectAuth',
  completeOidcRedirectAuth: 'wallet.completeOidcRedirectAuth',
  signInWithOidcRedirect: 'wallet.signInWithOidcRedirect',
  signOut: 'wallet.signOut',
  listWallets: 'wallet.listWallets',
  useWallet: 'wallet.useWallet',
  createWallet: 'wallet.createWallet',
  importWallet: 'wallet.importWallet',
  getWalletImportRecipientKey: 'wallet.getWalletImportRecipientKey',
  importEncryptedWallet: 'wallet.importEncryptedWallet',
  getIdToken: 'wallet.getIdToken',
  signMessage: 'wallet.signMessage',
  signSolanaMessage: 'wallet.signSolanaMessage',
  signTypedData: 'wallet.signTypedData',
  isValidMessageSignature: 'wallet.isValidMessageSignature',
  isValidSolanaMessageSignature: 'wallet.isValidSolanaMessageSignature',
  isValidTypedDataSignature: 'wallet.isValidTypedDataSignature',
  sendTransaction: 'wallet.sendTransaction',
  sendSolanaTransfer: 'wallet.sendSolanaTransfer',
  callContract: 'wallet.callContract',
  execute: 'wallet.execute',
  getTransactionStatus: 'wallet.getTransactionStatus',
  inspectRemoteCredential: 'wallet.inspectRemoteCredential',
  authorizeRemoteAccess: 'wallet.authorizeRemoteAccess',
  listAccess: 'wallet.listAccess',
  listAccessPages: 'wallet.listAccessPages',
  getRemoteAccessSession: 'wallet.getRemoteAccessSession',
  getRemoteAccessSessionUsage: 'wallet.getRemoteAccessSessionUsage',
  revokeAccess: 'wallet.revokeAccess',
  transactionStatus: 'wallet.transactionStatus'
} as const;

export type WalletOperation = (typeof WalletOperation)[keyof typeof WalletOperation];

export const IndexerOperation = {
  getBalances: 'indexer.getBalances',
  getSolanaBalances: 'indexer.getSolanaBalances',
  getTransactionHistory: 'indexer.getTransactionHistory'
} as const;

export type IndexerOperation = (typeof IndexerOperation)[keyof typeof IndexerOperation];

export const RemoteAccessOperation = {
  registerCredential: 'remoteAccess.registerCredential',
  prepareTransaction: 'remoteAccess.prepareTransaction',
  executeTransaction: 'remoteAccess.executeTransaction',
  getTransactionStatus: 'remoteAccess.getTransactionStatus',
  revokeCredential: 'remoteAccess.revokeCredential',
  listSessions: 'remoteAccess.listSessions',
  listSessionPages: 'remoteAccess.listSessionPages',
  getSession: 'remoteAccess.getSession',
  getSessionUsage: 'remoteAccess.getSessionUsage'
} as const;

export type RemoteAccessOperation =
  (typeof RemoteAccessOperation)[keyof typeof RemoteAccessOperation];

export type OMSWalletOperation = WalletOperation | IndexerOperation | RemoteAccessOperation;
