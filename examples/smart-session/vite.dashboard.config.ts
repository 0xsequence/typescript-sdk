import react from '@vitejs/plugin-react';
import { defineConfig, defaultClientConditions } from 'vite';
import { reactAliasesForExample } from '../shared/vite-react-aliases';

export default defineConfig({
  root: 'dashboard',
  base: '/dashboard/',
  cacheDir: '../node_modules/.vite/smart-session-dashboard',
  plugins: [react()],
  resolve: {
    conditions: ['@polygonlabs/source', ...defaultClientConditions],
    alias: reactAliasesForExample(import.meta.url)
  },
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: false
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787'
    }
  }
});
