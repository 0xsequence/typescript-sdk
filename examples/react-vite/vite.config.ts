import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { config } from 'dotenv'

config({ path: new URL('../../.env', import.meta.url).pathname })

const demoProjectAccessKey = process.env.OMS_PROJECT_ACCESS_KEY ?? 'AQAAAAAAAAK2JvvZhWqZ51riasWBftkrVXE'

export default defineConfig({
  plugins: [react()],
  define: {
    __OMS_PROJECT_ACCESS_KEY__: JSON.stringify(demoProjectAccessKey),
  },
})
