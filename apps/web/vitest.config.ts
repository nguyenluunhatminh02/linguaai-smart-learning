import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = { '@': path.resolve(__dirname, './src') };
const coverage = {
  provider: 'v8' as const,
  reporter: ['text', 'json', 'html'],
  exclude: ['node_modules/', 'src/test/', '**/*.d.ts'],
};

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            'src/app/api/**/*.{test,spec}.{ts,tsx}',
            'src/middleware.spec.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          include: [
            'src/app/api/**/*.{test,spec}.{ts,tsx}',
            'src/middleware.spec.ts',
          ],
        },
      },
    ],
    coverage,
  },
});
