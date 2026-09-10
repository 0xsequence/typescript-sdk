import {
  AuthMode,
  Networks,
  SolanaNetworks,
  RemoteAccessClient,
  WalletImportCipherSuite,
  WalletKeyOrigin,
  WalletType,
  OMSWallet,
  OMSWalletRequestError,
  OMSWalletError,
  OMSWalletSessionError,
  OMSWalletTransactionError,
  OmsRelayOidcProviders,
  TransactionMode,
  TransactionStatus,
  feeOptionSelection,
  findNetworkById,
  findNetworkByName,
  type CompleteOidcIdTokenAuthResult,
  type Network,
  type GetIdTokenParams,
  type OMSWalletSessionAuth,
  type OMSWalletSessionExpiredListener,
  type OMSWalletSessionState,
  type OMSWalletErrorCode,
  type OMSWalletUpstreamError,
  type BalancesResult,
  type AbiArg,
  type GetBalancesParams,
  type GetSolanaBalancesParams,
  type GetTransactionHistoryParams,
  type IndexerNetworkType,
  type OMSWalletParams,
  type OMSWalletIndexerClient,
  type OidcAuthMode,
  type CustomOidcProviderConfig,
  type OmsRelayOidcProvider,
  type SendDataTransactionParams,
  type SendNativeTransactionParams,
  type SendSolanaTransferParams,
  type SendTransactionBase,
  type SendTransactionParams,
  type SendTransactionResponse,
  type SendContractTransactionParams,
  type ContractTokenBalance,
  type NativeTokenBalance,
  type SolanaBalance,
  type SolanaBalancesResult,
  type SolanaFungibleTokenBalance,
  type SolanaNativeBalance,
  type SolanaNetworkError,
  type SolanaVerificationSource,
  type SolanaVerificationStatus,
  type TokenBalance,
  type TokenBalancesPage,
  type TokenContractInfo,
  type TokenMetadata,
  type TransactionHistoryResult,
  type SignInWithOidcIdTokenParams,
  type AuthorizeRemoteAccessParams,
  type CredentialSigner,
  type PreparedRemoteTransaction,
  type EncryptedWalletImportKeyMaterial,
  type RemoteAccessGrant,
  type RemoteAccessSession,
  type SmartSessionGrant,
  type SmartSessionGrantUsage
} from '../src/index';

const configuredOmsWallet = new OMSWallet({
  publishableKey: 'pk_dev_sdbx_project_key'
});

declare const backendCredentialSigner: CredentialSigner;
const remoteAccessClient = new RemoteAccessClient({
  publishableKey: 'pk_dev_sdbx_project_key',
  credentialSigner: backendCredentialSigner
});

if (false) {
  void (async () => {
    const registered = await remoteAccessClient.registerCredential({
      lifetimeSeconds: 604800,
      metadata: {
        appUrl: 'https://admin.example',
        appName: 'Admin example',
        appLogoUrl: '',
        custom: { network: 'amoy' }
      }
    });
    void registered.credentialId;

    const prepared: PreparedRemoteTransaction = await remoteAccessClient.prepareTransaction({
      walletId: 'wallet-id',
      sessionId: 'session-id',
      network: Networks.amoy,
      to: '0x1111111111111111111111111111111111111111',
      value: 1n
    });
    void remoteAccessClient.executeTransaction({
      txnId: prepared.txnId,
      feeOption: prepared.feeOptions[0] ? feeOptionSelection(prepared.feeOptions[0], 0) : undefined
    });
    void remoteAccessClient.getTransactionStatus({ txnId: prepared.txnId });
    void remoteAccessClient.revokeCredential({ credentialId: registered.credentialId });
    const sessions: RemoteAccessSession[] = await remoteAccessClient.listSessions({ pageSize: 10 });
    for await (const page of remoteAccessClient.listSessionPages()) void page.sessions;
    const remoteSession = await remoteAccessClient.getSession({ sessionId: sessions[0].sessionId });
    const remoteUsage: SmartSessionGrantUsage[] = await remoteAccessClient.getSessionUsage({
      sessionId: remoteSession.sessionId,
      network: Networks.amoy
    });
    void remoteUsage;

    // @ts-expect-error remote transactions require an owner-authorized session id.
    void remoteAccessClient.prepareTransaction({
      walletId: 'wallet-id',
      network: Networks.amoy,
      to: '0x1111111111111111111111111111111111111111'
    });
  })();
}

const customOidcProvider: CustomOidcProviderConfig = {
  clientId: 'custom-client',
  issuer: 'https://issuer.example',
  authorizationUrl: 'https://issuer.example/oauth/authorize',
  providerRedirectUri: 'https://app.example/auth/callback'
};
void customOidcProvider;

// @ts-expect-error custom OIDC redirect providers require providerRedirectUri.
const customOidcProviderWithoutRedirectUri: CustomOidcProviderConfig = {
  clientId: 'custom-client',
  issuer: 'https://issuer.example',
  authorizationUrl: 'https://issuer.example/oauth/authorize'
};
void customOidcProviderWithoutRedirectUri;

const defaultGoogleProvider = OmsRelayOidcProviders.google;
// @ts-expect-error SDK default Google config is read-only.
defaultGoogleProvider.clientId = 'google-client';
// @ts-expect-error OMS relay provider values do not expose editable scopes.
defaultGoogleProvider.scopes.push('admin');
const relayProvider: 'google' = defaultGoogleProvider.provider;
void relayProvider;

// @ts-expect-error OMS relay provider values cannot be fabricated structurally.
const fabricatedRelayProvider: OmsRelayOidcProvider = { provider: 'google' };
void fabricatedRelayProvider;

// @ts-expect-error the normalized base error cannot be constructed directly.
new OMSWalletError({ code: 'OMS_VALIDATION_ERROR', message: 'invalid' });

if (false) {
  const wallet = configuredOmsWallet.wallet;
  void wallet.startEmailAuth({ email: 'user@example.com', sessionLifetimeSeconds: 120 });
  // @ts-expect-error Email session lifetime is selected before sending the OTP.
  void wallet.completeEmailAuth({ code: '123456', sessionLifetimeSeconds: 120 });
  void wallet.startOidcRedirectAuth({
    provider: OmsRelayOidcProviders.google,
    omsRelayReturnUri: 'https://app.example/auth/callback'
  });
  void wallet.startOidcRedirectAuth({
    provider: OmsRelayOidcProviders.apple,
    omsRelayReturnUri: 'https://app.example/auth/callback'
  });
  void wallet.startOidcRedirectAuth({ provider: customOidcProvider });
  // @ts-expect-error custom providers do not accept omsRelayReturnUri.
  void wallet.startOidcRedirectAuth({
    provider: customOidcProvider,
    omsRelayReturnUri: 'https://app.example/auth/callback'
  });

  void (async () => {
    const manualAuth = await wallet.completeEmailAuth({
      code: '123456',
      walletSelection: 'manual'
    });
    void manualAuth.walletType;
    void manualAuth.wallets;
    void manualAuth.selectWallet({ walletId: manualAuth.wallets[0].id });
    void manualAuth.createAndSelectWallet({ reference: 'main' });
    // @ts-expect-error manual auth wallet lists are readonly snapshots.
    manualAuth.wallets.push(manualAuth.wallets[0]);
    // @ts-expect-error manual auth wallet metadata is readonly.
    manualAuth.wallets[0].id = 'wallet-id';
    // @ts-expect-error manual auth credential metadata is readonly.
    manualAuth.credential.expiresAt = '2099-01-01T00:00:00Z';
    // @ts-expect-error manual auth does not activate a wallet.
    void manualAuth.walletAddress;

    const activatedAuth = await wallet.completeEmailAuth({ code: '123456' });
    void activatedAuth.walletAddress;
    void activatedAuth.wallets;
    // @ts-expect-error completed auth wallet lists are readonly snapshots.
    activatedAuth.wallets.push(activatedAuth.wallet);
    // @ts-expect-error completed auth wallet metadata is readonly.
    activatedAuth.wallet.id = 'wallet-id';
    // @ts-expect-error completed auth credential metadata is readonly.
    activatedAuth.credential.expiresAt = '2099-01-01T00:00:00Z';

    const manualOidcIdTokenAuth = await wallet.signInWithOidcIdToken({
      idToken: 'jwt',
      issuer: 'https://accounts.google.com',
      audience: 'google-client-id',
      walletSelection: 'manual'
    });
    void manualOidcIdTokenAuth.walletType;
    // @ts-expect-error manual ID-token auth does not activate a wallet.
    void manualOidcIdTokenAuth.walletAddress;

    const activatedOidcIdTokenAuth = await wallet.signInWithOidcIdToken({
      idToken: 'jwt',
      issuer: 'https://accounts.google.com',
      audience: 'google-client-id'
    });
    void activatedOidcIdTokenAuth.walletAddress;

    const solanaWallet = await wallet.createWallet({ type: WalletType.Solana });
    const origin: WalletKeyOrigin = solanaWallet.wallet.keyOrigin;
    void origin;
    if (solanaWallet.wallet.type === WalletType.Solana) {
      const address: string = solanaWallet.wallet.address;
      void address;
      void wallet.isValidSolanaMessageSignature({
        walletAddress: address,
        message: 'Sign in to Example',
        signature: 'solana-signature'
      });
    }
    void wallet.signSolanaMessage({ message: 'Sign in to Example' });
    const solanaTransfer: SendSolanaTransferParams = {
      network: SolanaNetworks.devnet,
      asset: 'SOL',
      to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
      amount: 1_000_000n,
      mode: TransactionMode.Relayer
    };
    void wallet.sendSolanaTransfer(solanaTransfer);

    const authorization = await wallet.authorizeRemoteAccess({
      credentialId: 'credential-id',
      network: Networks.polygon,
      grants: [
        {
          kind: 'nativeTransfer',
          to: '0x1111111111111111111111111111111111111111',
          limit: 1n
        }
      ],
      expiresAt: '2099-01-01T00:00:00Z'
    });
    void authorization.walletId;
    void authorization.sessionId;
    void wallet.revokeAccess({
      credentialId: 'credential-id',
      sessionId: authorization.sessionId
    });
    const ownerSession = await wallet.getRemoteAccessSession({
      sessionId: authorization.sessionId
    });
    void wallet.getRemoteAccessSessionUsage({
      sessionId: ownerSession.sessionId,
      network: Networks.polygon
    });

    const imported = await configuredOmsWallet.wallet.importWallet({
      type: WalletType.Ethereum,
      privateKey: `0x${'01'.repeat(32)}`,
      reference: 'imported'
    });
    const importedOrigin: WalletKeyOrigin = imported.wallet.keyOrigin;
    void importedOrigin;
    const recipient = await configuredOmsWallet.wallet.getWalletImportRecipientKey({
      cipherSuite: WalletImportCipherSuite.P256Sha256Aes256Gcm
    });
    const encryptedKey: EncryptedWalletImportKeyMaterial = {
      keyId: recipient.keyId,
      cipherSuite: recipient.cipherSuite,
      encapsulatedKey: 'base64',
      ciphertext: 'base64'
    };
    void configuredOmsWallet.wallet.importEncryptedWallet({
      type: WalletType.Solana,
      keyMaterial: encryptedKey
    });
    // @ts-expect-error privateKey is required for the high-level import method.
    void configuredOmsWallet.wallet.importWallet({ type: WalletType.Ethereum });
  });
}

const smartSessionGrant: SmartSessionGrant = {
  kind: 'erc20Transfer',
  token: '0x2222222222222222222222222222222222222222',
  limit: 1n
};
void smartSessionGrant;

const authorizeRemoteAccess: AuthorizeRemoteAccessParams = {
  credentialId: 'credential-id',
  network: Networks.polygon,
  grants: [smartSessionGrant],
  expiresAt: '2099-01-01T00:00:00Z'
};
void authorizeRemoteAccess;

declare const remoteAccess: RemoteAccessGrant;
const remoteSessionId: string = remoteAccess.sessionId;
void remoteSessionId;

const defaultClient = new OMSWallet({
  publishableKey: 'pk_dev_sdbx_project_key'
});
// @ts-expect-error publishableKey is required.
new OMSWallet({});
// @ts-expect-error projectId is not a constructor parameter.
new OMSWallet({ publishableKey: 'pk_dev_sdbx_project_key', projectId: 'project-id' });
// @ts-expect-error projectAccessKey initializer name is not supported.
new OMSWallet({ projectAccessKey: 'pk_dev_sdbx_project_key' });
// @ts-expect-error publicApiKey initializer name is not supported.
new OMSWallet({ publicApiKey: 'pk_dev_sdbx_project_key' });
// @ts-expect-error authorizationScope initializer name is not supported.
new OMSWallet({ publishableKey: 'pk_dev_sdbx_project_key', authorizationScope: 'project-id' });
new OMSWallet({
  publishableKey: 'pk_dev_sdbx_project_key',
  // @ts-expect-error session expiry is subscribed through wallet.onSessionExpired, not constructor params.
  onSessionExpired: () => {}
});
const session: OMSWalletSessionState = defaultClient.wallet.session;
// @ts-expect-error sessions are owned by the wallet sub-client.
void defaultClient.session;
const omsWalletParams: OMSWalletParams = { publishableKey: 'pk_dev_sdbx_project_key' };
void omsWalletParams;
const oidcAuthMode: OidcAuthMode = AuthMode.AuthCodePKCE;
void oidcAuthMode;
const unsubscribeSessionExpired: () => void = defaultClient.wallet.onSessionExpired(
  ({ session }) => {
    void session.auth?.email;
    // @ts-expect-error expired session snapshots are readonly.
    session.auth = undefined;
  }
);
const sessionExpiredListener: OMSWalletSessionExpiredListener = ({ expiredAt }) => {
  void expiredAt;
};
void defaultClient.wallet.onSessionExpired(sessionExpiredListener);
// @ts-expect-error walletAddress is readonly SDK state.
defaultClient.wallet.walletAddress = '0x9999999999999999999999999999999999999999';
const idTokenParams: GetIdTokenParams = { ttlSeconds: 300, customClaims: { role: 'admin' } };
const idToken: Promise<string> = defaultClient.wallet.getIdToken(idTokenParams);
const oidcIdTokenParams: SignInWithOidcIdTokenParams = {
  idToken: 'jwt',
  issuer: 'https://accounts.google.com',
  audience: 'google-client-id',
  provider: 'google',
  providerLabel: 'Google'
};
const oidcIdTokenResult: Promise<CompleteOidcIdTokenAuthResult> =
  defaultClient.wallet.signInWithOidcIdToken({
    idToken: 'jwt',
    issuer: 'https://accounts.google.com',
    audience: 'google-client-id'
  });
void defaultClient.wallet.signInWithOidcIdToken(oidcIdTokenParams);
const sessionAuth: OMSWalletSessionAuth | undefined = defaultClient.wallet.session.auth;
// @ts-expect-error session snapshots are readonly.
session.auth = undefined;
if (session.auth) {
  // @ts-expect-error session auth metadata is readonly.
  session.auth.email = 'mutated@example.com';
}
const polygonNetwork: Network = Networks.polygon;
const polygonDisplayName: string = Networks.polygon.displayName;
const amoyNetwork: Network | undefined = findNetworkById(80002);
const baseNetwork: Network | undefined = findNetworkByName('base');
const allNetworks: readonly Network[] = Object.values(Networks);
// @ts-expect-error Network is closed to SDK-defined values.
const unsupportedNetwork: Network = {
  id: 999,
  name: 'unsupported',
  nativeTokenSymbol: 'TEST',
  explorerUrl: 'https://example.com',
  displayName: 'Unsupported'
};
const tokenContractInfo: TokenContractInfo = {
  chainId: 137,
  address: '0xtoken',
  source: 'token-directory',
  name: 'USD Coin',
  type: 'ERC20',
  symbol: 'USDC',
  decimals: 6,
  deployed: true,
  bytecodeHash: '0xhash',
  extensions: {},
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'AVAILABLE'
};
const tokenMetadata: TokenMetadata = {
  tokenId: '0',
  source: 'metadata',
  name: 'USDC',
  attributes: [],
  status: 'AVAILABLE'
};
const contractTokenBalance: ContractTokenBalance = {
  contractType: 'ERC20',
  contractAddress: '0xtoken',
  accountAddress: '0xwallet',
  tokenId: '0',
  balance: '141799',
  chainId: Networks.polygon.id,
  blockHash: '0xblock',
  blockNumber: 1,
  contractInfo: tokenContractInfo,
  tokenMetadata,
  balanceUSD: '0.141799',
  priceUSD: '1'
};
const nativeTokenBalance: NativeTokenBalance = {
  contractType: 'NATIVE',
  accountAddress: '0xwallet',
  balance: '1000000000000000000',
  chainId: Networks.polygon.id,
  name: 'POL',
  symbol: 'POL'
};
const tokenBalance: TokenBalance = contractTokenBalance;
const tokenBalancesPage: TokenBalancesPage = { page: 0, pageSize: 40, more: false };
const tokenBalancesResult: BalancesResult = {
  status: 200,
  page: tokenBalancesPage,
  nativeBalances: [nativeTokenBalance],
  balances: [contractTokenBalance]
};
const solanaFungibleTokenBalance: SolanaFungibleTokenBalance = {
  network: SolanaNetworks.mainnet,
  accountAddress: 'solana-wallet',
  assetType: 'fungible-token',
  tokenProgram: 'spl-token',
  mintAddress: 'usdc-mint',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  balance: '1000000',
  formattedBalance: '1',
  verificationStatus: 'verified',
  verificationSource: 'jupiter'
};
const solanaNativeBalance: SolanaNativeBalance = {
  network: SolanaNetworks.devnet,
  accountAddress: 'solana-wallet',
  assetType: 'native',
  name: 'Solana',
  symbol: 'SOL',
  decimals: 9,
  balance: '1000000000',
  formattedBalance: '1',
  verificationStatus: 'unknown',
  verificationSource: 'none'
};
const solanaBalance: SolanaBalance = solanaFungibleTokenBalance;
const solanaNetworkError: SolanaNetworkError = {
  network: SolanaNetworks.devnet,
  reason: 'RPC unavailable'
};
const solanaBalancesResult: SolanaBalancesResult = {
  status: 200,
  balances: [solanaNativeBalance, solanaBalance],
  errors: [solanaNetworkError]
};
const solanaVerificationStatus: SolanaVerificationStatus = 'unknown';
const solanaVerificationSource: SolanaVerificationSource = 'none';
const indexerNetworkType: IndexerNetworkType = 'MAINNETS';
const transactionHistoryResult: TransactionHistoryResult = {
  status: 200,
  page: tokenBalancesPage,
  transactions: []
};
const upstreamError: OMSWalletUpstreamError = {
  service: 'waas',
  name: 'CommitmentConsumed',
  code: 7008,
  message: 'The authentication commitment has already been used',
  status: 400
};
const sdkError = undefined as unknown as OMSWalletError;
const maybeUpstreamError: OMSWalletUpstreamError | undefined = sdkError.upstreamError;
const transactionExecutionCode: OMSWalletErrorCode = 'OMS_TRANSACTION_EXECUTION_UNCONFIRMED';
const storageCode: OMSWalletErrorCode = 'OMS_STORAGE_ERROR';
new OMSWalletSessionError({ message: 'expired', code: 'OMS_SESSION_EXPIRED' });
new OMSWalletRequestError({ message: 'failed', code: 'OMS_REQUEST_FAILED' });
new OMSWalletTransactionError({ message: 'unknown', code: 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED' });
// @ts-expect-error session errors cannot carry transaction codes.
new OMSWalletSessionError({ message: 'wrong', code: 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED' });
// @ts-expect-error request errors cannot carry session codes.
new OMSWalletRequestError({ message: 'wrong', code: 'OMS_SESSION_MISSING' });
// @ts-expect-error transaction errors cannot carry validation codes.
new OMSWalletTransactionError({ message: 'wrong', code: 'OMS_VALIDATION_ERROR' });
void session;
void unsubscribeSessionExpired;
void sessionAuth;
void polygonNetwork;
void amoyNetwork;
void baseNetwork;
void allNetworks;
void unsupportedNetwork;
void tokenContractInfo;
void tokenMetadata;
void tokenBalancesResult;
void solanaBalancesResult;
void solanaVerificationStatus;
void solanaVerificationSource;
void indexerNetworkType;
void transactionHistoryResult;
void upstreamError;
void maybeUpstreamError;
void transactionExecutionCode;
void storageCode;
// @ts-expect-error network helpers are package exports, not OMSWallet properties.
void defaultClient.supportedNetworks;
// @ts-expect-error findNetworkById accepts numeric chain IDs only.
findNetworkById('80002');
void defaultClient.indexer.getBalances({
  networks: [Networks.polygon],
  contractAddresses: ['0x2222222222222222222222222222222222222222'],
  walletAddress: '0x9999999999999999999999999999999999999999',
  includeMetadata: false
});
void defaultClient.indexer.getBalances({
  networks: [Networks.polygon],
  walletAddress: '0x9999999999999999999999999999999999999999',
  includeMetadata: true,
  page: { page: 1, pageSize: 25 }
});
void defaultClient.indexer.getBalances({
  // @ts-expect-error Indexer public methods accept Network objects, not numeric chain IDs.
  networks: [137],
  contractAddresses: ['0x2222222222222222222222222222222222222222'],
  walletAddress: '0x9999999999999999999999999999999999999999',
  includeMetadata: false
});
void defaultClient.indexer.getBalances({
  // @ts-expect-error chainId is not a public indexer parameter.
  chainId: 137,
  contractAddresses: ['0x2222222222222222222222222222222222222222'],
  walletAddress: '0x9999999999999999999999999999999999999999',
  includeMetadata: false
});
const getBalancesParams: GetBalancesParams = {
  walletAddress: '0x9999999999999999999999999999999999999999',
  networkType: 'TESTNETS'
};
void defaultClient.indexer.getBalances(getBalancesParams);
const getSolanaBalancesParams: GetSolanaBalancesParams = {
  walletAddress: 'solana-wallet',
  networks: [SolanaNetworks.mainnet, SolanaNetworks.devnet],
  includeMetadata: true,
  mintAddresses: ['usdc-mint']
};
void defaultClient.indexer.getSolanaBalances(getSolanaBalancesParams);
void defaultClient.indexer.getSolanaBalances({
  walletAddress: 'solana-wallet',
  // @ts-expect-error Solana indexer queries use the SDK-supported Solana networks.
  networks: ['solana:testnet']
});
const indexerClient: OMSWalletIndexerClient = defaultClient.indexer;
void indexerClient;
const transactionHistoryParams: GetTransactionHistoryParams = {
  walletAddress: '0x9999999999999999999999999999999999999999',
  networks: [Networks.polygon],
  includeMetadata: true
};
void defaultClient.indexer.getTransactionHistory(transactionHistoryParams);
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.google,
  omsRelayReturnUri: 'https://app.example/auth/callback'
});
// @ts-expect-error OMS relay provider authorization parameters are fixed by the SDK.
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.google,
  authorizeParams: { prompt: 'select_account' }
});
void (async () => {
  const redirectStart = await defaultClient.wallet.startOidcRedirectAuth({
    provider: OmsRelayOidcProviders.google,
    omsRelayReturnUri: 'https://app.example/auth/callback'
  });
  const authorizationUrl: string = redirectStart.authorizationUrl;
  void authorizationUrl;
  // @ts-expect-error redirect start result uses authorizationUrl, not url.
  void redirectStart.url;
  // @ts-expect-error redirect state is carried only in authorizationUrl.
  void redirectStart.state;
  // @ts-expect-error redirect challenge is carried only in authorizationUrl.
  void redirectStart.challenge;
});
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.google
});
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.apple,
  omsRelayReturnUri: 'https://app.example/auth/callback'
});
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.google,
  // @ts-expect-error redirectUri was replaced by omsRelayReturnUri for SDK relayed providers.
  redirectUri: 'https://app.example/auth/callback'
});
void defaultClient.wallet.startOidcRedirectAuth({
  provider: OmsRelayOidcProviders.google,
  // @ts-expect-error relayRedirectUri was replaced by providerRedirectUri on provider config.
  relayRedirectUri: 'https://relay.example/callback'
});
void defaultClient.wallet.completeOidcRedirectAuth();
void defaultClient.wallet.completeOidcRedirectAuth({
  walletSelection: 'manual',
  sessionLifetimeSeconds: 120
});
void defaultClient.wallet.signInWithOidcIdToken({
  idToken: 'jwt',
  issuer: 'https://accounts.google.com',
  audience: 'google-client-id'
});
void defaultClient.wallet.signInWithOidcIdToken({
  idToken: 'jwt',
  issuer: 'https://idp.example',
  audience: 'custom-client-id',
  provider: 'enterprise',
  providerLabel: 'Enterprise SSO',
  walletSelection: 'manual',
  sessionLifetimeSeconds: 120
});
// @ts-expect-error ID-token sign-in requires an ID token.
void defaultClient.wallet.signInWithOidcIdToken({
  issuer: 'https://accounts.google.com',
  audience: 'google-client-id'
});
// @ts-expect-error ID-token sign-in requires an issuer.
void defaultClient.wallet.signInWithOidcIdToken({
  idToken: 'jwt',
  audience: 'google-client-id'
});
// @ts-expect-error ID-token sign-in requires an audience.
void defaultClient.wallet.signInWithOidcIdToken({
  idToken: 'jwt',
  issuer: 'https://accounts.google.com'
});
void defaultClient.wallet.signInWithOidcRedirect({
  provider: OmsRelayOidcProviders.google
});
void defaultClient.wallet.signInWithOidcRedirect({
  provider: OmsRelayOidcProviders.apple
});
void defaultClient.wallet.signInWithOidcRedirect({
  provider: OmsRelayOidcProviders.google,
  walletSelection: 'manual',
  sessionLifetimeSeconds: 120
});
// @ts-expect-error provider is required when starting redirect sign-in.
void defaultClient.wallet.signInWithOidcRedirect();
// @ts-expect-error provider is required when starting redirect with an omsRelayReturnUri override.
void defaultClient.wallet.signInWithOidcRedirect({
  omsRelayReturnUri: 'https://app.example/auth/callback'
});
// @ts-expect-error provider is required when starting redirect with assignUrl.
void defaultClient.wallet.signInWithOidcRedirect({
  currentUrl: 'https://app.example/login',
  assignUrl: (url: string) => {
    void url;
  }
});

const abiArg: AbiArg = { type: 'uint256', value: '1' };
void abiArg;
const sendBase: SendTransactionBase = {
  network: Networks.polygon,
  to: '0x1111111111111111111111111111111111111111'
};
void sendBase;
const nativeSend: SendNativeTransactionParams = {
  network: Networks.polygon,
  to: '0x1111111111111111111111111111111111111111',
  value: 1n
};
const dataSend: SendDataTransactionParams = {
  network: Networks.polygon,
  to: '0x1111111111111111111111111111111111111111',
  data: '0x'
};
const contractSend: SendContractTransactionParams = {
  network: Networks.polygon,
  to: '0x1111111111111111111111111111111111111111',
  abi: [],
  functionName: undefined
};
const generalSend: SendTransactionParams = nativeSend;
const sendResponse: SendTransactionResponse = {
  txnId: 'txn-id',
  status: TransactionStatus.Pending,
  statusResolution: 'not-requested'
};
// @ts-expect-error statusResolution is required on transaction responses.
const unresolvedSendResponse: SendTransactionResponse = {
  txnId: 'txn-id',
  status: TransactionStatus.Pending
};
void nativeSend;
void dataSend;
void contractSend;
void generalSend;
void sendResponse;
void unresolvedSendResponse;
new OMSWallet({
  publishableKey: 'pk_dev_sdbx_project_key',
  // @ts-expect-error environment URL overrides are not constructor parameters.
  environment: {
    walletApiUrl: 'https://wallet.example',
    indexerGatewayUrl: 'https://indexer.example'
  }
});
new OMSWallet({
  publishableKey: 'pk_dev_sdbx_project_key',
  // @ts-expect-error OIDC registries are not constructor parameters.
  auth: {}
});

function createClient(params: { publishableKey: string }) {
  return new OMSWallet(params);
}

void createClient({
  publishableKey: 'pk_dev_sdbx_project_key'
});
