import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Builds the 5velte-ph4ser control panel into the Fresh app's static dir,
// where routes/index.tsx loads it as /ui/panel.js (+ /ui/panel.css). Fixed
// file names (no hashes) so the Fresh route can reference them statically;
// cache busting isn't worth the coupling for an internal tool.
export default defineConfig({
  plugins: [svelte()],
  base: '/ui/',
  // Same reason as the game's vite config: 5velte-ph4ser ships raw
  // .svelte.ts source, which the dep pre-bundler can't compile.
  optimizeDeps: {
    exclude: ['5velte-ph4ser'],
  },
  build: {
    outDir: fileURLToPath(new URL('../app/static/ui', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./main.js', import.meta.url)),
      output: {
        entryFileNames: 'panel.js',
        chunkFileNames: 'panel-[name].js',
        assetFileNames: 'panel.[ext]',
      },
    },
  },
})
