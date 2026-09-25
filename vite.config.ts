import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/lens-lab/
export default defineConfig({
  base: '/lens-lab/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
  },
});
