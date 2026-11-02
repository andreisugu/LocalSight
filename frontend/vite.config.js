import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute base: the mock build is served from a repo subpath
  // (e.g. https://<user>.github.io/LocalSight/). A relative './' base would
  // break deep links handled by the history router.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  // The engine worker is created with `{ type: 'module' }` and imports the ONNX runtime
  // dynamically, on the first engine start. An IIFE worker cannot code-split (its dynamic
  // imports are inlined back into the worker chunk), so it must be built as ES modules.
  worker: {
    format: 'es'
  },
  server: {
    port: 5173,
    open: false,
    host: true
  }
});
