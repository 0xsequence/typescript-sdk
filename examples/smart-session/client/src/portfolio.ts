import { formatUnits } from 'viem';

export function resolveBalanceUsd({
  balance,
  balanceUsd,
  decimals,
  priceOverrideUsd,
  priceUsd
}: {
  balance: string;
  balanceUsd?: string;
  decimals: number;
  priceOverrideUsd?: number;
  priceUsd?: string;
}): number | undefined {
  if (priceOverrideUsd !== undefined) {
    return deriveBalanceUsd(balance, decimals, priceOverrideUsd);
  }

  const indexedBalanceUsd = finiteNumber(balanceUsd);
  if (indexedBalanceUsd !== undefined && indexedBalanceUsd > 0) return indexedBalanceUsd;

  const indexedPriceUsd = finiteNumber(priceUsd);
  if (indexedPriceUsd === undefined || indexedPriceUsd <= 0) return indexedBalanceUsd;

  return deriveBalanceUsd(balance, decimals, indexedPriceUsd) ?? indexedBalanceUsd;
}

function deriveBalanceUsd(balance: string, decimals: number, priceUsd: number): number | undefined {
  const tokenAmount = Number(formatUnits(BigInt(balance), decimals));
  const derivedBalanceUsd = tokenAmount * priceUsd;
  return Number.isFinite(derivedBalanceUsd) ? derivedBalanceUsd : undefined;
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
