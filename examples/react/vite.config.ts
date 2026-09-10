import { fileURLToPath } from 'node:url';
import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';
import { reactAliasesForExample } from '../shared/vite-react-aliases';

const exampleRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  return {
    base: process.env.GITHUB_PAGES === 'true' ? '/oms-wallet-typescript-sdk/react-example/' : '/',
    plugins: [react()],
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
