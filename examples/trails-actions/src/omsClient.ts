import { OMSClient } from '@0xsequence/typescript-sdk'
import { PROJECT_ID, PUBLIC_API_KEY } from './config'

export const oms = new OMSClient({
  publicApiKey: PUBLIC_API_KEY,
  projectId: PROJECT_ID,
})
