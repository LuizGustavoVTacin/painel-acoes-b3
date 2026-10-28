import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // O Vite não carrega o .env em process.env; lemos a mesma PORT usada pelo Express.
  const env = loadEnv(mode, process.cwd(), '');
  const portaApi = env.PORT?.trim() || '3000';

  return {
    plugins: [react()],
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        // changeOrigin faz o Host chegar como 127.0.0.1, aceito pela proteção de host local.
        '/api': { target: `http://127.0.0.1:${portaApi}`, changeOrigin: true },
      },
    },
    test: {
      setupFiles: ['./vitest.setup.ts'],
      restoreMocks: true,
      unstubGlobals: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'cliente',
            include: ['src/client/**/*.test.{ts,tsx}'],
            environment: 'jsdom',
          },
        },
        {
          extends: true,
          test: { name: 'servidor', include: ['src/server/**/*.test.ts'], environment: 'node' },
        },
      ],
    },
  };
});
