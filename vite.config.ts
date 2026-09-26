import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/lens-lab/
export default defineConfig({
  base: '/lens-lab/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // the 3D engine changes far less often than the app: its own long-cached chunk
        manualChunks: (id) => (/node_modules\/(three|postprocessing)\//.test(id) ? 'engine' : undefined),
      },
    },
  },
  server: {
    host: true,
  },
});
