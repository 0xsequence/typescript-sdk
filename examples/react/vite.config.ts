import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { reactAliasesForExample } from '../shared/vite-react-aliases';
import { privyWalletExportPlugin } from './privy-wallet-export-plugin';

const exampleRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, exampleRoot, '');

  return {
    base: process.env.GITHUB_PAGES === 'true' ? '/oms-wallet-typescript-sdk/react-example/' : '/',
    plugins: [
      react(),
      privyWalletExportPlugin({
        appId: environment.PRIVY_APP_ID,
        appSecret: environment.PRIVY_APP_SECRET,
        authorizationPrivateKey: environment.PRIVY_AUTHORIZATION_PRIVATE_KEY
      })
    ],
    resolve: {
      conditions: ['@polygonlabs/source', ...defaultClientConditions],
      alias: reactAliasesForExample(import.meta.url)
    },
    server: {
      port: 5173,
      strictPort: true
    }
  };
});
