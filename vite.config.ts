import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const PORTA_API = process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${PORTA_API}`,
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
