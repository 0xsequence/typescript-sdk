import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { config } from 'dotenv'

config({ path: new URL('../../.env', import.meta.url).pathname })

const demoProjectAccessKey = process.env.OMS_PROJECT_ACCESS_KEY ?? 'AQAAAAAAAAK2JvvZhWqZ51riasWBftkrVXE'
const googleClientId = process.env.OMS_GOOGLE_CLIENT_ID ?? ''
const oidcRelayRedirectUri = process.env.OMS_OIDC_RELAY_REDIRECT_URI ?? ''

export default defineConfig({
  plugins: [react()],
  define: {
    __OMS_PROJECT_ACCESS_KEY__: JSON.stringify(demoProjectAccessKey),
    __OMS_GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId),
    __OMS_OIDC_RELAY_REDIRECT_URI__: JSON.stringify(oidcRelayRedirectUri),
  },
})
