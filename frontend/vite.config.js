import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute base: the mock build is served from a repo subpath
  // (e.g. https://<user>.github.io/LocalSight/). A relative './' base would
  // break deep links handled by the history router.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    host: true
  }
});
