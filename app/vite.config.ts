import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' is mandatory: the app is loaded from
// file:///android_asset/public/index.html inside the native WebView container.
// Absolute asset URLs would break the offline cold start.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      // Post-process the emitted index.html: Vite writes
      // <script type="module" crossorigin src="./assets/*.js">, but Chromium
      // refuses to execute module scripts from file:// (opaque origin). The
      // IIFE bundle is fully self-contained, so a classic deferred script works.
      name: 'turnloom-file-url-classic-script',
      enforce: 'post',
      transformIndexHtml(html: string) {
        return html
          .replace(/<script\b[^>]*\btype="module"[^>]*>/gi,
                   (tag: string) => tag.replace(/\s+type="module"/i, '')
                                      .replace(/\s+crossorigin(?:="[^"]*")?/i, '')
                                      .replace(/<script\b/i, '<script defer'))
          .replace(/<link\b([^>]*)\bcrossorigin(?:="[^"]*")?([^>]*)>/gi, '<link$1$2>');
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    // Android WebView loads this from file:///android_asset/public/index.html.
    // Chromium rejects <script type="module"> on file:// (opaque origin), so the
    // bundle must be a self-contained classic script (IIFE), not an ES module.
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
