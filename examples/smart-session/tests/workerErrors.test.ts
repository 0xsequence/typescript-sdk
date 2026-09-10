import assert from 'node:assert/strict';

import { OMSWalletRequestError } from '@polygonlabs/oms-wallet';
import { test } from 'vitest';

import { serializeWaasError } from '../worker/errors.ts';

test('serializes the complete public WaaS error details', () => {
  const generatedError = new Error('Transaction failed', {
    cause: 'failed to get fee options'
  });
  generatedError.name = 'TransactionFailed';
  const error = new OMSWalletRequestError({
    code: 'OMS_HTTP_ERROR',
    operation: 'remoteAccess.prepareTransaction',
    message: 'Transaction failed',
    status: 400,
    retryable: false,
    txnId: 'txn-123',
    upstreamError: {
      service: 'waas',
      name: 'TransactionFailed',
      code: 7000,
      message: 'Transaction failed',
      status: 400
    },
    cause: generatedError
  });

  assert.deepEqual(serializeWaasError(error), {
    name: 'OMSWalletRequestError',
    code: 'OMS_HTTP_ERROR',
    operation: 'remoteAccess.prepareTransaction',
    message: 'Transaction failed',
    status: 400,
    retryable: false,
    txnId: 'txn-123',
    cause: 'failed to get fee options',
    upstreamError: {
      service: 'waas',
      name: 'TransactionFailed',
      code: 7000,
      message: 'Transaction failed',
      status: 400
    }
  });
});
