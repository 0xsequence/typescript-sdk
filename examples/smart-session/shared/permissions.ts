import type { SmartSessionGrant } from '@polygonlabs/oms-wallet';
import { getAddress, isAddress } from 'viem';

import type { RecipientScope } from './api.js';
import type { SmartSessionAsset } from './networks.js';

export const MAX_SMART_SESSION_GRANTS = 127;

export function validateRecipientScope(
  scope: RecipientScope,
  assetKind: SmartSessionAsset['kind']
): RecipientScope {
  if (scope?.mode === 'any') {
    if (assetKind === 'native') throw new Error('Native transfers require one specific receiver');
    return { mode: 'any' };
  }
  if (scope?.mode !== 'specific' || !Array.isArray(scope.recipients)) {
    throw new Error('Choose specific receivers or any receiver');
  }
  if (scope.recipients.length === 0) throw new Error('Add at least one receiver');
  if (scope.recipients.length > MAX_SMART_SESSION_GRANTS) {
    throw new Error(`A smart session supports at most ${MAX_SMART_SESSION_GRANTS} grants`);
  }
  if (assetKind === 'native' && scope.recipients.length !== 1) {
    throw new Error('Native transfers support exactly one receiver');
  }

  const recipients = scope.recipients.map((recipient, index) => {
    if (!isAddress(recipient)) throw new Error(`Receiver ${index + 1} is not a valid address`);
    return getAddress(recipient);
  });
  if (new Set(recipients.map((recipient) => recipient.toLowerCase())).size !== recipients.length) {
    throw new Error('Each receiver must be unique');
  }
  return { mode: 'specific', recipients };
}

export function createSmartSessionGrants(
  asset: SmartSessionAsset,
  recipientScope: RecipientScope,
  allowance: bigint
): SmartSessionGrant[] {
  const scope = validateRecipientScope(recipientScope, asset.kind);
  if (asset.kind === 'native') {
    if (scope.mode !== 'specific') throw new Error('Native transfers require a receiver');
    return [{ kind: 'nativeTransfer', to: scope.recipients[0] as `0x${string}`, limit: allowance }];
  }
  if (scope.mode === 'any') {
    return [
      {
        kind: 'erc20Transfer',
        token: asset.tokenAddress,
        limit: allowance,
        cumulative: true
      }
    ];
  }
  return scope.recipients.map((recipient) => ({
    kind: 'erc20Transfer',
    token: asset.tokenAddress,
    to: recipient as `0x${string}`,
    limit: allowance,
    cumulative: true
  }));
}
