import { OMSWallet } from '@polygonlabs/oms-wallet';
import { PUBLISHABLE_KEY } from './config';

export const TEST_SESSION_LIFETIME_SECONDS = 604_800;

export const omsWallet = new OMSWallet({
  publishableKey: PUBLISHABLE_KEY
});
