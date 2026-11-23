import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5180),
    strictPort: false,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://localhost:4010',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5180,
  },
});
