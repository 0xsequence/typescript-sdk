import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexerClient } from '../src/clients/indexerClient';
import { Networks, SolanaNetworks } from '../src/networks';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IndexerClient', () => {
  it('requests balances through IndexerGateway and flattens grouped chain results', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: { page: 1, pageSize: 25, more: false },
            nativeBalances: [
              {
                chainId: 137,
                results: [
                  {
                    accountAddress: '0x9999999999999999999999999999999999999999',
                    chainId: 137,
                    name: 'POL',
                    symbol: 'POL',
                    balance: '1000000000000000000',
                    balanceUSD: '0.20',
                    priceUSD: '0.20'
                  }
                ]
              }
            ],
            balances: [
              {
                chainId: 137,
                results: [
                  {
                    contractType: 'ERC20',
                    contractAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
                    accountAddress: '0x9999999999999999999999999999999999999999',
                    tokenID: '0',
                    balance: '141799',
                    balanceUSD: '0.141799',
                    priceUSD: '1',
                    blockHash: '0xblock',
                    blockNumber: 123,
                    chainId: 137,
                    contractInfo: {
                      chainId: 137,
                      address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
                      source: 'TOKEN_DIRECTORY_SEQUENCE_GITHUB',
                      name: 'USDC',
                      type: 'ERC20',
                      symbol: 'USDC',
                      decimals: 6,
                      deployed: true,
                      bytecodeHash: '0xbytecode',
                      extensions: {},
                      updatedAt: '2026-01-01T00:00:00Z',
                      queuedAt: null,
                      status: 'AVAILABLE'
                    },
                    tokenMetadata: {
                      tokenId: '0',
                      source: 'metadata',
                      name: 'USD Coin',
                      attributes: [],
                      image_data: 'raw-image-data',
                      external_url: 'https://example.com/usdc',
                      status: 'AVAILABLE',
                      queuedAt: null
                    }
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    const result = await indexer.getBalances({
      networks: [Networks.polygon],
      walletAddress: '0x9999999999999999999999999999999999999999',
      includeMetadata: true,
      contractAddresses: ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'],
      page: {
        page: 1,
        column: 'blockNumber',
        after: 'cursor',
        sort: [{ column: 'blockNumber', order: 'DESC' }],
        pageSize: 25
      }
    });
    expect(result).toMatchObject({
      status: 200,
      page: { page: 1, pageSize: 25, more: false },
      nativeBalances: [
        {
          contractType: 'NATIVE',
          symbol: 'POL',
          balance: '1000000000000000000',
          balanceUSD: '0.20',
          priceUSD: '0.20'
        }
      ],
      balances: [
        {
          tokenId: '0',
          balance: '141799',
          balanceUSD: '0.141799',
          priceUSD: '1',
          contractInfo: {
            symbol: 'USDC',
            decimals: 6
          },
          tokenMetadata: {
            imageData: 'raw-image-data',
            externalUrl: 'https://example.com/usdc'
          }
        }
      ]
    });
    expect(result.balances[0].contractInfo?.queuedAt).toBeUndefined();
    expect(result.balances[0].tokenMetadata?.queuedAt).toBeUndefined();

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://indexer.example/GetTokenBalancesDetails'
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'Api-Key': 'publishable-key',
      Webrpc: 'webrpc@v0.31.2;gen-typescript@v0.23.1;sequence-indexer@v0.4.0'
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      chainIds: [137],
      filter: {
        accountAddresses: ['0x9999999999999999999999999999999999999999'],
        contractWhitelist: ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'],
        omitNativeBalances: false
      },
      omitMetadata: false,
      page: {
        page: 1,
        column: 'blockNumber',
        after: 'cursor',
        sort: [{ column: 'blockNumber', order: 'DESC' }],
        pageSize: 25
      }
    });
  });

  it('defaults balance queries to mainnets when networks are omitted', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: { page: 0, pageSize: 40, more: false },
            nativeBalances: [],
            balances: []
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await indexer.getBalances({
      walletAddress: '0x9999999999999999999999999999999999999999'
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      networkType: 'MAINNETS',
      filter: {
        accountAddresses: ['0x9999999999999999999999999999999999999999'],
        omitNativeBalances: false
      },
      omitMetadata: false,
      page: { page: 0, pageSize: 40 }
    });
  });

  it('requests Solana balances through SolanaIndexerGateway and normalizes metadata', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            balances: [
              {
                network: 'solana:mainnet',
                accountAddress: 'solana-wallet',
                assetType: 'native',
                tokenProgram: null,
                mintAddress: null,
                name: 'Solana',
                symbol: 'SOL',
                decimals: 9,
                balance: '4679287',
                formattedBalance: '0.004679287',
                imageUrl: null,
                metadataUri: null,
                verificationStatus: 'unknown',
                verificationSource: 'none',
                priceUSD: '105.00',
                balanceUSD: '0.49'
              },
              {
                network: 'solana:mainnet',
                accountAddress: 'solana-wallet',
                assetType: 'fungible-token',
                tokenProgram: 'spl-token',
                mintAddress: 'usdc-mint',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6,
                balance: '4208117429',
                formattedBalance: '4208.117429',
                imageUrl: 'https://example.com/usdc.png',
                metadataUri: '',
                verificationStatus: 'verified',
                verificationSource: 'jupiter',
                priceUSD: '0.9999',
                balanceUSD: '4208.05'
              }
            ],
            errors: [{ network: 'solana:devnet', reason: 'RPC unavailable' }]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    const result = await indexer.getSolanaBalances({
      walletAddress: 'solana-wallet',
      networks: [SolanaNetworks.mainnet, SolanaNetworks.devnet],
      includeMetadata: false,
      omitNativeBalances: false,
      mintAddresses: ['usdc-mint'],
      excludedMintAddresses: ['spam-mint']
    });

    expect(result).toEqual({
      status: 200,
      balances: [
        {
          network: SolanaNetworks.mainnet,
          accountAddress: 'solana-wallet',
          assetType: 'native',
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
          balance: '4679287',
          formattedBalance: '0.004679287',
          verificationStatus: 'unknown',
          verificationSource: 'none',
          priceUSD: '105.00',
          balanceUSD: '0.49'
        },
        {
          network: SolanaNetworks.mainnet,
          accountAddress: 'solana-wallet',
          assetType: 'fungible-token',
          tokenProgram: 'spl-token',
          mintAddress: 'usdc-mint',
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          balance: '4208117429',
          formattedBalance: '4208.117429',
          imageUrl: 'https://example.com/usdc.png',
          verificationStatus: 'verified',
          verificationSource: 'jupiter',
          priceUSD: '0.9999',
          balanceUSD: '4208.05'
        }
      ],
      errors: [{ network: SolanaNetworks.devnet, reason: 'RPC unavailable' }]
    });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://solana-indexer.example/GetTokenBalancesDetails'
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'Api-Key': 'publishable-key',
      Webrpc: 'webrpc@v0.31.2;gen-typescript@v0.23.1;solana-indexer-gateway@v1'
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      networks: [SolanaNetworks.mainnet, SolanaNetworks.devnet],
      filter: {
        accountAddresses: ['solana-wallet'],
        omitNativeBalances: false,
        contractWhitelist: ['usdc-mint'],
        contractBlacklist: ['spam-mint']
      },
      omitMetadata: true
    });
  });

  it('defaults Solana balance queries to the SDK-supported networks', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ balances: [], errors: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await indexer.getSolanaBalances({ walletAddress: 'solana-wallet' });

    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      networks: [SolanaNetworks.mainnet, SolanaNetworks.devnet],
      filter: { accountAddresses: ['solana-wallet'] },
      omitMetadata: false
    });
  });

  it('rejects Solana balance responses for unsupported networks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              balances: [
                {
                  network: 'solana:testnet',
                  accountAddress: 'solana-wallet',
                  assetType: 'native',
                  name: 'Solana',
                  symbol: 'SOL',
                  decimals: 9,
                  balance: '0',
                  formattedBalance: '0',
                  verificationStatus: 'unknown',
                  verificationSource: 'none'
                }
              ],
              errors: []
            }),
            { status: 200 }
          )
      )
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getSolanaBalances({ walletAddress: 'solana-wallet' })
    ).rejects.toMatchObject({
      code: 'OMS_INVALID_RESPONSE',
      operation: 'indexer.getSolanaBalances',
      status: 200
    });
  });

  it('requests transaction history through IndexerGateway', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: { page: 0, pageSize: 1, more: true },
            transactions: [
              {
                chainId: 1,
                results: [
                  {
                    txnHash: '0xabc',
                    blockNumber: 123,
                    blockHash: '0xdef',
                    chainId: 1,
                    metaTxnID: 'meta-1',
                    transfers: [
                      {
                        transferType: 'RECEIVE',
                        contractAddress: '0x0000000000000000000000000000000000000000',
                        contractType: 'NATIVE',
                        from: '0x1111111111111111111111111111111111111111',
                        to: '0x9999999999999999999999999999999999999999',
                        tokenIDs: ['0'],
                        amounts: ['1'],
                        logIndex: 0
                      }
                    ],
                    timestamp: '2026-06-17T00:00:00Z'
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getTransactionHistory({
        networks: [Networks.mainnet],
        walletAddress: '0x9999999999999999999999999999999999999999',
        includeMetadata: true,
        page: { pageSize: 1 }
      })
    ).resolves.toMatchObject({
      status: 200,
      page: { page: 0, pageSize: 1, more: true },
      transactions: [
        {
          txnHash: '0xabc',
          metaTxnId: 'meta-1',
          transfers: [
            {
              tokenIds: ['0'],
              amounts: ['1']
            }
          ]
        }
      ]
    });

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://indexer.example/GetTransactionHistory'
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      chainIds: [1],
      filter: {
        accountAddresses: ['0x9999999999999999999999999999999999999999']
      },
      includeMetadata: true,
      page: { pageSize: 1, page: 0 }
    });
  });

  it('normalizes nullable transaction metadata with an empty transfer list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              transactions: [
                {
                  chainId: 137,
                  results: [
                    {
                      txnHash: '0xtxn',
                      blockNumber: 1,
                      blockHash: '',
                      chainId: 137,
                      metaTxnID: null,
                      transfers: [],
                      timestamp: '2026-01-01T00:00:00Z'
                    }
                  ]
                }
              ]
            }),
            { status: 200 }
          )
      )
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    const result = await indexer.getTransactionHistory({ walletAddress: '0xwallet' });
    expect(result.transactions[0]).toMatchObject({
      txnHash: '0xtxn',
      transfers: []
    });
    expect(result.transactions[0].metaTxnId).toBeUndefined();
  });

  it('rejects transactions missing the required transfer list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              transactions: [
                {
                  chainId: 137,
                  results: [
                    {
                      txnHash: '0xtxn',
                      blockNumber: 1,
                      blockHash: '0xblock',
                      chainId: 137,
                      timestamp: '2026-01-01T00:00:00Z'
                    }
                  ]
                }
              ]
            }),
            { status: 200 }
          )
      )
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getTransactionHistory({ walletAddress: '0xwallet' })
    ).rejects.toMatchObject({
      code: 'OMS_INVALID_RESPONSE',
      operation: 'indexer.getTransactionHistory',
      status: 200
    });
  });

  it('does not set a synthetic Origin when the runtime already has one', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            page: { page: 0, pageSize: 40, more: false },
            nativeBalances: [],
            balances: []
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { origin: 'http://app.example' });

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await indexer.getBalances({
      walletAddress: '0x9999999999999999999999999999999999999999'
    });

    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty('Origin');
  });

  it('preserves WebRPC gateway error causes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'WebrpcEndpoint',
              code: 0,
              msg: 'endpoint error',
              cause: 'InvalidCredentials 1003: omsx-api: invalid credentials, requestId: req_123',
              status: 400
            }),
            { status: 400 }
          )
      )
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getBalances({
        walletAddress: '0x9999999999999999999999999999999999999999'
      })
    ).rejects.toMatchObject({
      code: 'OMS_HTTP_ERROR',
      message: 'InvalidCredentials 1003: omsx-api: invalid credentials, requestId: req_123',
      operation: 'indexer.getBalances',
      status: 400,
      upstreamError: {
        name: 'WebrpcEndpoint',
        code: 0,
        message: 'InvalidCredentials 1003: omsx-api: invalid credentials, requestId: req_123',
        service: 'indexer',
        status: 400
      }
    });
  });

  it('wraps invalid JSON responses in typed SDK errors', async () => {
    const fetchMock = vi.fn(async () => new Response('not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getBalances({
        networks: [Networks.polygon],
        contractAddresses: ['0x2222222222222222222222222222222222222222'],
        walletAddress: '0x9999999999999999999999999999999999999999',
        includeMetadata: false
      })
    ).rejects.toMatchObject({
      code: 'OMS_INVALID_RESPONSE',
      operation: 'indexer.getBalances',
      status: 200
    });
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'https://indexer.example/GetTokenBalancesDetails'
    );
  });

  it('rejects balance objects missing evidence-backed core fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              nativeBalances: [],
              balances: [
                {
                  chainId: 137,
                  results: [
                    {
                      contractType: 'ERC20',
                      contractAddress: '0xtoken',
                      accountAddress: '0xwallet',
                      tokenID: '0',
                      balance: '1',
                      blockNumber: 1,
                      chainId: 137
                    }
                  ]
                }
              ]
            }),
            { status: 200 }
          )
      )
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(indexer.getBalances({ walletAddress: '0xwallet' })).rejects.toMatchObject({
      code: 'OMS_INVALID_RESPONSE',
      operation: 'indexer.getBalances',
      status: 200
    });
  });

  it('wraps non-JSON HTTP responses as retryable HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))
    );

    const indexer = new IndexerClient({
      publishableKey: 'publishable-key',
      environment: testEnvironment()
    });

    await expect(
      indexer.getBalances({
        networks: [Networks.polygon],
        contractAddresses: ['0x2222222222222222222222222222222222222222'],
        walletAddress: '0x9999999999999999999999999999999999999999',
        includeMetadata: false
      })
    ).rejects.toMatchObject({
      code: 'OMS_HTTP_ERROR',
      operation: 'indexer.getBalances',
      status: 502,
      retryable: true
    });
  });
});

function testEnvironment() {
  return {
    walletApiUrl: 'https://wallet.example',
    apiRpcUrl: 'https://api.example',
    indexerGatewayUrl: 'https://indexer.example',
    solanaIndexerGatewayUrl: 'https://solana-indexer.example'
  };
}
