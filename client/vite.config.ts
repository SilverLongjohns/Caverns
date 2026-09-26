import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: `ws://localhost:${process.env.CAVERNS_SERVER_PORT ?? '3001'}`,
        ws: true,
      },
    },
  },
});
