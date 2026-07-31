import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8642',
      '/sso': 'http://localhost:8642',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
