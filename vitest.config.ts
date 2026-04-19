import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Sibling worktrees check out parallel branches into .worktrees/**;
    // without this exclude, vitest globs into them from the main repo
    // and runs duplicate copies of the same test against shared DB
    // fixtures — producing spurious failures. Node defaults already
    // exclude node_modules/dist/.git, but not this.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.next/**',
      '**/.worktrees/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
