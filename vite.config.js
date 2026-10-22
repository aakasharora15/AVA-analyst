import { defineConfig } from 'vite';

// Single-page app: Vite's dev and preview servers fall back to index.html,
// so deep links such as /pricing survive a refresh.
export default defineConfig({
  appType: 'spa',
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
