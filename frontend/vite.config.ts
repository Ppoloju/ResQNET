import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on the LAN IP so real phones on the same Wi-Fi can open the app
    // Dev proxy: the app calls same-origin /api; in dev Vite forwards to the
    // backend (Docker compose or local `npm run dev -w backend`). Production
    // nginx does the same job (docker/frontend.Dockerfile).
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
