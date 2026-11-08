import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes into a *subdirectory* of the existing public/ tree.
// The legacy client at / must stay untouched (Android WebView + 172 tests).
export default defineConfig({
  plugins: [react()],
  // Absolute asset URLs so the entry works at /option-a/index.html.
  base: '/option-a/',
  build: {
    outDir: '../public/option-a',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    // No sourcemaps: keeps the server's CSP ('self', no eval) trivially satisfied.
    sourcemap: false,
  },
});
