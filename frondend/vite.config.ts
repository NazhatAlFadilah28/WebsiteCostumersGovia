import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    allowedHosts: true,
    proxy: {
      // Meneruskan request /api ke Backend Next.js di folder ../backend/bustix (Port 3000 / 3001)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Pastikan SPA fallback: semua path (termasuk /auth/google/callback) diarahkan ke index.html
  appType: 'spa',
});
