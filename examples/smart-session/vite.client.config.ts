import react from '@vitejs/plugin-react';
import { defineConfig, defaultClientConditions } from 'vite';
import { reactAliasesForExample } from '../shared/vite-react-aliases';

export default defineConfig({
  root: 'client',
  base: '/',
  cacheDir: '../node_modules/.vite/smart-session-client',
  plugins: [react()],
  resolve: {
    conditions: ['@polygonlabs/source', ...defaultClientConditions],
    alias: reactAliasesForExample(import.meta.url)
  },
  build: {
    outDir: '../dist',
    emptyOutDir: false
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787'
    }
  }
});
