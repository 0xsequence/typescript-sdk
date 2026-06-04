import { OMSClient } from '@0xsequence/typescript-sdk'
import { PROJECT_ID, PUBLISHABLE_KEY } from './config'

export const TEST_SESSION_LIFETIME_SECONDS = 604_800

export const oms = new OMSClient({
  publishableKey: PUBLISHABLE_KEY,
  projectId: PROJECT_ID,
})
