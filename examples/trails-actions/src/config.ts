export const PUBLIC_API_KEY = requiredEnv('VITE_OMS_PUBLIC_API_KEY', import.meta.env.VITE_OMS_PUBLIC_API_KEY)
export const PROJECT_ID = requiredEnv('VITE_OMS_PROJECT_ID', import.meta.env.VITE_OMS_PROJECT_ID)

function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy examples/trails-actions/.env.example to examples/trails-actions/.env.local and set it.`)
  }
  return value
}
