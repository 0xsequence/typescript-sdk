import { OMSClient } from '@0xsequence/typescript-sdk'
import { PROJECT_ID, PUBLISHABLE_KEY } from './config'

export const oms = new OMSClient({
  publishableKey: PUBLISHABLE_KEY,
  projectId: PROJECT_ID,
})
