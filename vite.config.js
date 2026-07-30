import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  // Relative asset URLs so the build works both at the domain root and under
  // the GitHub Pages project path (easierbycode.com/racer-intro/). Phaser's
  // loader already resolves 'assets/*' against the document URL, so the two
  // stay consistent.
  base: './',
  // 5velte-ph4ser ships raw .svelte.ts source (no build output), and the dep
  // pre-bundler compiles those without stripping TypeScript first. Excluding it
  // routes the package through the normal transform pipeline instead.
  optimizeDeps: {
    exclude: ['5velte-ph4ser'],
  },
  server: {
    watch: {
      /*
       * Dropping sprites into public/assets kills the dev server on Windows:
       * chokidar calls fs.watch() on each new file as it appears, and a file
       * still being written is locked, so watch() throws EBUSY — a fatal
       * watcher error. Polling uses fs.watchFile (stat-based) instead, which
       * never touches the lock. awaitWriteFinish then holds the reload until
       * the file stops growing, so we don't reload on a half-written atlas.
       */
      usePolling: true,
      interval: 300,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    },
  },
})
