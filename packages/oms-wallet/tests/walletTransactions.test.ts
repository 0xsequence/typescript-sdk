import { afterEach, describe, expect, it, vi } from 'vitest';

import { WalletClient } from '../src/clients/walletClient';
import type { CredentialSigner } from '../src/credentialSigner';
import { TransactionMode, TransactionStatus } from '../src/types/waas';
import { Networks, SolanaNetworks } from '../src/networks';
import { MemoryStorageManager } from '../src/storageManager';
import { FeeOptionSelector } from '../src/types/transactionTypes';

class MockSigner implements CredentialSigner {
  readonly signingAlgorithm = 'ecdsa-p256-sha256';

  async credentialId(): Promise<string> {
    return '0x04' + '11'.repeat(64);
  }

  async nextNonce(): Promise<string> {
    return '42';
  }

  async sign(): Promise<string> {
    return '0x' + '22'.repeat(64);
  }

  async hasCredential(): Promise<boolean> {
    return true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WalletClient transactions', () => {
  it('prepares, enriches fee options, executes, and returns transaction status', async () => {
    const storage = new MemoryStorageManager();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareEthereumTransaction')) {
        expect(body).toMatchObject({
          network: '137',
          walletId: 'wallet-id',
          to: '0x1111111111111111111111111111111111111111',
          value: '0',
          mode: 'relayer'
        });
        return jsonResponse({
          txnId: 'txn-1',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '137',
                name: 'Polygon',
                symbol: 'MATIC',
                type: 'native',
                decimals: 18,
                logoURL: ''
              },
              value: '100000000000000000',
              displayValue: '0.1'
            },
            {
              token: {
                network: '137',
                name: 'USD Coin',
                symbol: 'USDC',
                type: 'erc20',
                decimals: 6,
                logoURL: '',
                contractAddress: '0x2222222222222222222222222222222222222222'
              },
              value: '1000000',
              displayValue: '1'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/GetTokenBalancesDetails')) {
        expect(body).toMatchObject({
          chainIds: [137],
          filter: {
            accountAddresses: ['0x9999999999999999999999999999999999999999'],
            contractWhitelist: ['0x2222222222222222222222222222222222222222'],
            omitNativeBalances: false
          },
          omitMetadata: true
        });
        return jsonResponse({
          page: { page: 0, pageSize: 40, more: false },
          nativeBalances: [
            {
              chainId: 137,
              results: [
                {
                  accountAddress: '0x9999999999999999999999999999999999999999',
                  name: 'POL',
                  symbol: 'POL',
                  balance: '1000000000000000000',
                  chainId: 137
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
                  contractAddress: '0x2222222222222222222222222222222222222222',
                  accountAddress: '0x9999999999999999999999999999999999999999',
                  tokenID: '0',
                  balance: '2500000',
                  blockHash: '0xblock',
                  blockNumber: 1,
                  chainId: 137
                }
              ]
            }
          ]
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({
          txnId: 'txn-1',
          feeOption: { token: 'USDC', index: 1 }
        });
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        expect(body).toEqual({ txnId: 'txn-1' });
        return jsonResponse({
          status: 'executed',
          txnHash: '0xtx'
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(storage, '0x9999999999999999999999999999999999999999');

    const response = await wallet.sendTransaction({
      network: Networks.polygon,
      to: '0x1111111111111111111111111111111111111111',
      value: 0n,
      selectFeeOption: (feeOptions) => {
        expect(feeOptions[0].available).toBe('1');
        expect(feeOptions[1].available).toBe('2.5');
        return feeOptions[1].selection;
      }
    });

    expect(response).toEqual({
      txnId: 'txn-1',
      status: TransactionStatus.Executed,
      txnHash: '0xtx',
      statusResolution: 'resolved'
    });
  });

  it('polls callContract automatically and resolves when a transaction hash appears', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareEthereumContractCall')) {
        expect(body).toEqual({
          network: '137',
          walletId: 'wallet-id',
          contract: '0x1111111111111111111111111111111111111111',
          method: 'mint(address,uint256)',
          args: [
            { type: 'address', value: '0x2222222222222222222222222222222222222222' },
            { type: 'uint256', value: '1' }
          ],
          mode: 'relayer'
        });
        return jsonResponse({
          txnId: 'txn-contract',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }
      if (url.endsWith('/Execute')) return jsonResponse({ status: 'pending' });
      if (url.endsWith('/TransactionStatus')) {
        return jsonResponse({ status: 'pending', txnHash: '0xcontract' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.callContract({
        network: Networks.polygon,
        contractAddress: '0x1111111111111111111111111111111111111111',
        method: 'mint(address,uint256)',
        args: [
          { type: 'address', value: '0x2222222222222222222222222222222222222222' },
          { type: 'uint256', value: '1' }
        ]
      })
    ).resolves.toEqual({
      txnId: 'txn-contract',
      status: TransactionStatus.Pending,
      txnHash: '0xcontract',
      statusResolution: 'resolved'
    });
  });

  it('selects the default fee option identifier without balance lookup', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-default-fee',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '137',
                name: 'Polygon',
                symbol: 'POL',
                type: 'native',
                decimals: 18,
                logoURL: '',
                tokenID: 'pol'
              },
              value: '100000000000000000',
              displayValue: '0.1'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/GetTokenBalancesDetails')) {
        throw new Error('default fee selection should not load balances');
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({
          txnId: 'txn-default-fee',
          feeOption: { token: 'pol', index: 0 }
        });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-default-fee',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prepares, executes, and polls a native SOL transfer', async () => {
    const selectFeeOption = vi.fn((options: Parameters<FeeOptionSelector>[0]) => {
      expect(options).toHaveLength(1);
      expect(options[0]).toMatchObject({
        feeOption: {
          value: '5000',
          displayValue: '0.000005',
          token: { network: 'solana:devnet', symbol: 'SOL' }
        },
        selection: { token: 'SOL', index: 0 }
      });
      expect(options[0].availableRaw).toBeUndefined();
      return options[0].selection;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareSolanaTransfer')) {
        expect(body).toEqual({
          network: 'solana:devnet',
          walletId: 'wallet-id',
          asset: 'SOL',
          recipient: { address: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD' },
          amount: '1000000',
          mode: 'native'
        });
        return jsonResponse({
          txnId: 'txn-sol',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: 'solana:devnet',
                name: 'SOL',
                symbol: 'SOL',
                type: 'NATIVE'
              },
              value: '5000',
              displayValue: '0.000005'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({ txnId: 'txn-sol', feeOption: { token: 'SOL', index: 0 } });
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        expect(body).toEqual({ txnId: 'txn-sol' });
        return jsonResponse({ status: 'executed', txnHash: 'solana-signature' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: 'SOL',
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 1_000_000n,
        mode: TransactionMode.Native,
        selectFeeOption
      })
    ).resolves.toEqual({
      txnId: 'txn-sol',
      status: TransactionStatus.Executed,
      txnHash: 'solana-signature',
      statusResolution: 'resolved'
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(selectFeeOption).toHaveBeenCalledOnce();
  });

  it('firstAvailable selects an affordable Solana fee option using indexer balances', async () => {
    const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
    const walletAddress = '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareSolanaTransfer')) {
        return jsonResponse({
          txnId: 'txn-sol-first-available',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: 'solana:devnet',
                name: 'SOL',
                symbol: 'SOL',
                type: 'NATIVE'
              },
              value: '5000',
              displayValue: '0.000005'
            },
            {
              token: {
                network: 'solana:devnet',
                name: 'USD Coin',
                symbol: 'USDC',
                type: 'SPL',
                contractAddress: usdcMint
              },
              value: '10000',
              displayValue: '0.01'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.startsWith('https://solana-indexer.example')) {
        expect(body).toEqual({
          networks: ['solana:devnet'],
          filter: {
            accountAddresses: [walletAddress],
            omitNativeBalances: false,
            contractWhitelist: [usdcMint]
          },
          omitMetadata: true
        });
        return jsonResponse({
          balances: [
            {
              network: 'solana:devnet',
              accountAddress: walletAddress,
              assetType: 'native',
              name: 'Solana',
              symbol: 'SOL',
              decimals: 9,
              balance: '1000',
              formattedBalance: '0.000001',
              verificationStatus: 'unknown',
              verificationSource: 'none'
            },
            {
              network: 'solana:devnet',
              accountAddress: walletAddress,
              assetType: 'fungible-token',
              tokenProgram: 'spl-token',
              mintAddress: usdcMint,
              name: 'USD Coin',
              symbol: 'USDC',
              decimals: 6,
              balance: '20000',
              formattedBalance: '0.02',
              verificationStatus: 'verified',
              verificationSource: 'jupiter'
            }
          ],
          errors: []
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({
          txnId: 'txn-sol-first-available',
          feeOption: { token: 'USDC', index: 1 }
        });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(new MemoryStorageManager(), walletAddress);

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: 'SOL',
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 1_000_000n,
        selectFeeOption: FeeOptionSelector.firstAvailable,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-sol-first-available',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('selects a rent fee option for a relayed SPL-token transfer', async () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const selectFeeOption = vi.fn((options: Parameters<FeeOptionSelector>[0]) => {
      expect(options.map(({ selection }) => selection)).toEqual([
        { token: 'SOL', index: 0 },
        { token: 'USDC', index: 1 }
      ]);
      return options[1].selection;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareSolanaTransfer')) {
        expect(body).toEqual({
          network: 'solana:devnet',
          walletId: 'wallet-id',
          asset: mint,
          recipient: { address: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD' },
          amount: '25',
          mode: 'relayer'
        });
        return jsonResponse({
          txnId: 'txn-spl-rent',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: 'solana:devnet',
                name: 'SOL',
                symbol: 'SOL',
                type: 'NATIVE'
              },
              value: '5000',
              displayValue: '0.000005'
            },
            {
              token: {
                network: 'solana:devnet',
                name: 'USDC',
                symbol: 'USDC',
                type: 'SPL',
                contractAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
              },
              value: '10000',
              displayValue: '0.01'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({
          txnId: 'txn-spl-rent',
          feeOption: { token: 'USDC', index: 1 }
        });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: mint,
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 25n,
        selectFeeOption,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-spl-rent',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(selectFeeOption).toHaveBeenCalledOnce();
  });

  it('prepares an SPL-token transfer using the mint as the asset', async () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareSolanaTransfer')) {
        expect(body).toMatchObject({
          network: 'solana:devnet',
          asset: mint,
          amount: '25',
          mode: 'native'
        });
        return jsonResponse({
          txnId: 'txn-spl',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: 'solana:devnet',
                name: 'SOL',
                symbol: 'SOL',
                type: 'NATIVE'
              },
              value: '2039280',
              displayValue: '0.00203928'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({ txnId: 'txn-spl', feeOption: { token: 'SOL', index: 0 } });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: mint,
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 25n,
        mode: TransactionMode.Native,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-spl',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
  });

  it('executes a sponsored relayed Solana transfer with firstAvailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/PrepareSolanaTransfer')) {
        expect(body).toEqual({
          network: 'solana:devnet',
          walletId: 'wallet-id',
          asset: 'SOL',
          recipient: { address: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD' },
          amount: '1000000',
          mode: 'relayer'
        });
        return jsonResponse({
          txnId: 'txn-sponsored-sol',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({ txnId: 'txn-sponsored-sol' });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: 'SOL',
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 1_000_000n,
        selectFeeOption: FeeOptionSelector.firstAvailable,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-sponsored-sol',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects Solana transfers for an active Ethereum wallet', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: 'SOL',
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 1n
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.sendSolanaTransfer'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves unsupported Solana asset details from WaaS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            code: 7312,
            name: 'UnsupportedAsset',
            message: 'Unsupported asset',
            status: 400
          },
          400
        )
      )
    );
    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '4Nd1mYQbqjVU2aR7cJNPyqW9XjHnBYvWQd7ZxYxvT6uP'
    );

    await expect(
      wallet.sendSolanaTransfer({
        network: SolanaNetworks.devnet,
        asset: 'not-a-mint',
        to: '3gFktQX6vki5M2DzN8Y1ESPUJ4fJ8o6hVQWf8vYvPypD',
        amount: 1n
      })
    ).rejects.toMatchObject({
      code: 'OMS_REQUEST_FAILED',
      operation: 'wallet.sendSolanaTransfer',
      status: 400,
      upstreamError: {
        code: 7312,
        name: 'UnsupportedAsset',
        message: 'Unsupported asset'
      }
    });
  });

  it('lets a custom fee selector acknowledge a sponsored transaction', async () => {
    const selectFeeOption = vi.fn((feeOptions: Parameters<FeeOptionSelector>[0]) => {
      expect(feeOptions).toEqual([]);
      return undefined;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-sponsored',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '137',
                name: 'Polygon',
                symbol: 'POL',
                type: 'native',
                decimals: 18,
                logoURL: '',
                tokenID: 'pol'
              },
              value: '100000000000000000',
              displayValue: '0.1'
            }
          ],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({ txnId: 'txn-sponsored' });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        selectFeeOption,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-sponsored',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
    expect(selectFeeOption).toHaveBeenCalledOnce();
  });

  it('does not execute when sponsored transaction acknowledgement throws', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-cancelled-sponsored',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }
      throw new Error(`Unexpected request: ${input.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        selectFeeOption: async (feeOptions) => {
          expect(feeOptions).toEqual([]);
          throw new Error('Transaction cancelled');
        }
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.sendTransaction',
      message: 'Transaction cancelled'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('firstAvailable selects the first affordable fee option', async () => {
    const usdcAddress = '0x2222222222222222222222222222222222222222';
    const daiAddress = '0x3333333333333333333333333333333333333333';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-first-available',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '137',
                name: 'Dai',
                symbol: 'DAI',
                type: 'erc20',
                decimals: 18,
                logoURL: '',
                contractAddress: daiAddress,
                tokenID: 'dai'
              },
              value: '1000',
              displayValue: '0.000000000000001'
            },
            {
              token: {
                network: '137',
                name: 'USD Coin',
                symbol: 'USDC',
                type: 'erc20',
                decimals: 6,
                logoURL: '',
                contractAddress: usdcAddress,
                tokenID: 'usdc'
              },
              value: '2000',
              displayValue: '0.002'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/GetTokenBalancesDetails')) {
        expect(body.filter.contractWhitelist).toEqual([daiAddress, usdcAddress]);
        return jsonResponse({
          page: { page: 0, pageSize: 40, more: false },
          balances: [
            {
              chainId: 137,
              results: [
                {
                  contractType: 'ERC20',
                  contractAddress: daiAddress,
                  accountAddress: '0x9999999999999999999999999999999999999999',
                  tokenID: '0',
                  balance: '100',
                  blockHash: '0xblock-dai',
                  blockNumber: 1,
                  chainId: 137
                },
                {
                  contractType: 'ERC20',
                  contractAddress: usdcAddress,
                  accountAddress: '0x9999999999999999999999999999999999999999',
                  tokenID: '0',
                  balance: '2000',
                  blockHash: '0xblock-usdc',
                  blockNumber: 1,
                  chainId: 137
                }
              ]
            }
          ]
        });
      }

      if (url.endsWith('/Execute')) {
        expect(body).toEqual({
          txnId: 'txn-first-available',
          feeOption: { token: 'usdc', index: 1 }
        });
        return jsonResponse({ status: 'pending' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        selectFeeOption: FeeOptionSelector.firstAvailable,
        waitForStatus: false
      })
    ).resolves.toEqual({
      txnId: 'txn-first-available',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
  });

  it('firstAvailable requires an affordable fee option', async () => {
    const usdcAddress = '0x2222222222222222222222222222222222222222';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-no-affordable-fee',
          status: 'quoted',
          feeOptions: [
            {
              token: {
                network: '137',
                name: 'USD Coin',
                symbol: 'USDC',
                type: 'erc20',
                decimals: 6,
                logoURL: '',
                contractAddress: usdcAddress,
                tokenID: 'usdc'
              },
              value: '1000',
              displayValue: '0.001'
            }
          ],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/GetTokenBalancesDetails')) {
        return jsonResponse({
          page: { page: 0, pageSize: 40, more: false },
          balances: [
            {
              chainId: 137,
              results: [
                {
                  contractType: 'ERC20',
                  contractAddress: usdcAddress,
                  accountAddress: '0x9999999999999999999999999999999999999999',
                  tokenID: '0',
                  balance: '100',
                  blockHash: '0xblock',
                  blockNumber: 1,
                  chainId: 137
                }
              ]
            }
          ]
        });
      }

      if (url.endsWith('/Execute')) {
        throw new Error('Execute should not run without an affordable fee option');
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        selectFeeOption: FeeOptionSelector.firstAvailable,
        waitForStatus: false
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.sendTransaction',
      message: 'No fee option selected for unsponsored transaction'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires fee options for unsponsored transactions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-no-fee-options',
          status: 'quoted',
          feeOptions: [],
          sponsored: false,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        throw new Error('Execute should not run without fee options');
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        waitForStatus: false
      })
    ).rejects.toMatchObject({
      code: 'OMS_VALIDATION_ERROR',
      operation: 'wallet.sendTransaction',
      message: 'No fee options available for unsponsored transaction'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can skip transaction status polling', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-1',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        throw new Error('status polling should not run');
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    const response = await wallet.sendTransaction({
      network: Networks.polygon,
      to: '0x1111111111111111111111111111111111111111',
      value: 0n,
      waitForStatus: false
    });

    expect(response).toEqual({
      txnId: 'txn-1',
      status: TransactionStatus.Pending,
      statusResolution: 'not-requested'
    });
  });

  it('returns failed transaction status as terminal', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-failed',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        return jsonResponse({ status: 'failed' });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n
      })
    ).resolves.toEqual({
      txnId: 'txn-failed',
      status: TransactionStatus.Failed,
      statusResolution: 'resolved'
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => input.toString().endsWith('/TransactionStatus'))
    ).toHaveLength(1);
  });

  it('returns the latest status when automatic polling reaches its deadline', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-timeout',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }
      if (url.endsWith('/Execute')) return jsonResponse({ status: 'pending' });
      if (url.endsWith('/TransactionStatus')) return jsonResponse({ status: 'pending' });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        statusPolling: { timeoutMs: 0 }
      })
    ).resolves.toEqual({
      txnId: 'txn-timeout',
      status: TransactionStatus.Pending,
      statusResolution: 'timed-out'
    });
  });

  it('keeps unknown statuses unresolved until the polling deadline', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-unknown-timeout',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }
      if (url.endsWith('/Execute')) return jsonResponse({ status: 'pending' });
      if (url.endsWith('/TransactionStatus')) return jsonResponse({ status: 'future-status' });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        statusPolling: { timeoutMs: 0 }
      })
    ).resolves.toEqual({
      txnId: 'txn-unknown-timeout',
      status: TransactionStatus.Unknown,
      statusResolution: 'timed-out'
    });
  });

  it('rejects invalid polling options before execute', async () => {
    const invalidOptions = [
      { timeoutMs: Number.NaN },
      { timeoutMs: -1 },
      { intervalMs: 0 },
      { fastIntervalMs: Number.POSITIVE_INFINITY },
      { fastPollCount: 1.5 }
    ];

    for (const [index, statusPolling] of invalidOptions.entries()) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith('/PrepareEthereumTransaction')) {
          return jsonResponse({
            txnId: `txn-invalid-polling-${index}`,
            status: 'quoted',
            feeOptions: [],
            sponsored: true,
            expiresAt: '2099-01-01T00:00:00Z'
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const wallet = createWalletWithSession(
        new MemoryStorageManager(),
        '0x9999999999999999999999999999999999999999'
      );

      await expect(
        wallet.sendTransaction({
          network: Networks.polygon,
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          statusPolling
        })
      ).rejects.toMatchObject({ code: 'OMS_VALIDATION_ERROR' });
      expect(
        fetchMock.mock.calls.filter(([input]) => input.toString().endsWith('/Execute'))
      ).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it('exposes transaction status lookup by transaction id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = JSON.parse(init?.body as string);

      if (url.endsWith('/TransactionStatus')) {
        expect(body).toEqual({ txnId: 'txn-1' });
        return jsonResponse({
          status: 'executed',
          txnHash: '0xtx'
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = new WalletClient({
      publishableKey: 'publishable-key',
      projectId: 'project-id',
      environment: testEnvironment(),
      storage: new MemoryStorageManager(),
      credentialSigner: new MockSigner()
    });

    await expect(wallet.getTransactionStatus({ txnId: 'txn-1' })).resolves.toEqual({
      status: TransactionStatus.Executed,
      txnHash: '0xtx'
    });
  });

  it('wraps status polling failures with the transaction id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith('/PrepareEthereumTransaction')) {
        return jsonResponse({
          txnId: 'txn-1',
          status: 'quoted',
          feeOptions: [],
          sponsored: true,
          expiresAt: '2099-01-01T00:00:00Z'
        });
      }

      if (url.endsWith('/Execute')) {
        return jsonResponse({ status: 'pending' });
      }

      if (url.endsWith('/TransactionStatus')) {
        throw new Error('status endpoint unavailable');
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const wallet = createWalletWithSession(
      new MemoryStorageManager(),
      '0x9999999999999999999999999999999999999999'
    );

    await expect(
      wallet.sendTransaction({
        network: Networks.polygon,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n
      })
    ).rejects.toMatchObject({
      code: 'OMS_TRANSACTION_STATUS_LOOKUP_FAILED',
      operation: 'wallet.transactionStatus',
      txnId: 'txn-1',
      retryable: true
    });
  });
});

function createWalletWithSession(
  storage: MemoryStorageManager,
  walletAddress: string
): WalletClient {
  const wallet = new WalletClient({
    publishableKey: 'publishable-key',
    projectId: 'project-id',
    environment: testEnvironment(),
    storage,
    credentialSigner: new MockSigner()
  });
  (wallet as any).persistSession('wallet-id', walletAddress, {
    expiresAt: '2099-01-01T00:00:00Z',
    auth: { type: 'email', email: 'user@example.com' },
    signerCredentialId: '0x04' + '11'.repeat(64),
    signerKeyType: 'ecdsa-p256-sha256'
  });
  return wallet;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function testEnvironment() {
  return {
    walletApiUrl: 'https://wallet.example',
    indexerGatewayUrl: 'https://indexer.example',
    solanaIndexerGatewayUrl: 'https://solana-indexer.example'
  };
}
