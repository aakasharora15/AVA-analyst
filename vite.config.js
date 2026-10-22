import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// Single-page app: Vite's dev and preview servers fall back to index.html,
// so deep links such as /pricing survive a refresh.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const data = env.VITE_AVA_DATA === 'live' ? 'live' : 'mock';
  return {
    appType: 'spa',
    server: {
      host: true,
      // Local API (uvicorn ava_server.app:app --port 8000) when running live.
      proxy: data === 'live' && !env.VITE_API_URL ? { '/api': 'http://localhost:8000' } : undefined,
    },
    preview: { host: true },
    resolve: {
      alias: { 'ava:repo': fileURLToPath(new URL(`./src/data/repo.${data}.js`, import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.js'],
    },
  };
});
