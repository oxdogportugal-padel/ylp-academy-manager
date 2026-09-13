import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Catalyst's Slate deploy app for this project is configured with
  // root_path "./" (repo root) and build_path "dist" — it always runs the
  // build from the repo root and looks for output at repo-root dist/, so
  // this has to land there too rather than at the default client/dist.
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/server': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
