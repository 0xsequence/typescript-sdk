import assert from 'node:assert/strict';

import type { OMSWallet } from '@polygonlabs/oms-wallet';
import { test } from 'vitest';

import {
  getPolygonUsdtBalance,
  POLYGON_USDT,
  trailsAutoConvertErrorMessage
} from '../client/src/trailsAutoConvert.ts';
import { resolveBalanceUsd } from '../client/src/portfolio.ts';

test('fetches and totals only Polygon USDT for the active wallet', async () => {
  let request: unknown;
  const wallet = {
    indexer: {
      getBalances: async (params: unknown) => {
        request = params;
        return {
          balances: [
            {
              contractType: 'ERC20',
              chainId: 137,
              contractAddress: POLYGON_USDT,
              balance: '1200000'
            },
            {
              contractType: 'ERC20',
              chainId: 8453,
              contractAddress: POLYGON_USDT,
              balance: '9000000'
            },
            {
              contractType: 'ERC20',
              chainId: 137,
              contractAddress: '0x1111111111111111111111111111111111111111',
              balance: '8000000'
            }
          ]
        };
      }
    }
  } as unknown as OMSWallet;

  const walletAddress = '0x2222222222222222222222222222222222222222';
  await expectAmount(getPolygonUsdtBalance(wallet, walletAddress), 1200000n);
  assert.deepEqual(request, {
    walletAddress,
    networks: [
      {
        id: 137,
        name: 'polygon',
        nativeTokenSymbol: 'POL',
        explorerUrl: 'https://polygonscan.com',
        displayName: 'Polygon'
      }
    ],
    contractAddresses: [POLYGON_USDT],
    includeMetadata: false,
    omitPrices: true
  });
});

test('surfaces the useful Trails API cause', () => {
  assert.equal(
    trailsAutoConvertErrorMessage(
      Object.assign(new Error('endpoint error'), {
        cause: 'estimated fees exceed the provided amount'
      })
    ),
    'estimated fees exceed the provided amount'
  );
});

test('explains when Trails route costs exceed the available USDT', () => {
  assert.equal(
    trailsAutoConvertErrorMessage(
      Object.assign(new Error('endpoint error'), {
        cause:
          'GetIntentsQuote failed: insufficient origin amount: estimated provider + trails + execution fees exceed the provided amount (origin=70000, trailsFee=0, gasAndBridgeFee=89053, providerSpendOverage=350, adjusted=-19403)'
      })
    ),
    'The Polygon USDT balance is too small to cover this Trails route. Available: 0.07 USDT. Estimated route costs: 0.089403 USDT (0.019403 USDT more than the available balance), before any Base USDC output. Add more USDT, then enable the one-time conversion again.'
  );
});

test('derives a token USD balance when the indexed aggregate is zero', () => {
  assert.equal(
    resolveBalanceUsd({
      balance: '278802',
      balanceUsd: '0',
      decimals: 6,
      priceUsd: '0.9998'
    }),
    0.2787462396
  );
});

test('uses an explicit price override when an indexed stablecoin price is wrong', () => {
  assert.equal(
    resolveBalanceUsd({
      balance: '278802',
      balanceUsd: '0.000111',
      decimals: 6,
      priceOverrideUsd: 1,
      priceUsd: '0.0004'
    }),
    0.278802
  );
});

async function expectAmount(actual: Promise<bigint>, expected: bigint): Promise<void> {
  assert.equal(await actual, expected);
}
