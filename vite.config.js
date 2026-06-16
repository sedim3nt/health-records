import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4178,
    proxy: {
      '/api': 'http://127.0.0.1:4179',
      '/health': 'http://127.0.0.1:4179'
    }
  }
});
