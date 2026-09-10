import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      main: './worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-08-11',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          OMS_PUBLISHABLE_KEY: 'pk_dev_sdbx_testproject_testkey',
          WALLET_ORIGIN: 'https://wallet.smart-session.example',
          DASHBOARD_ORIGIN: 'https://dashboard.smart-session.example',
          TEST_MIGRATIONS: await readD1Migrations(new URL('./migrations', import.meta.url).pathname)
        }
      }
    })
  ],
  ssr: {
    resolve: {
      conditions: ['@polygonlabs/source']
    }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
}));
