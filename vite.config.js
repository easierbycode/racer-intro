import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Svelte 5 reads DEV from `esm-env`, normally resolved to a static
    // boolean by export conditions at build time — which would erase dev
    // mode from the bundle entirely. The shim decides at runtime instead,
    // so ?debug=1 turns on Svelte's runtime dev mode on the deployed build.
    // (Compile-time dev extras stay off: vite-plugin-svelte force-disables
    // compilerOptions.dev for production builds.)
    alias: [
      {
        find: /^esm-env$/,
        replacement: fileURLToPath(
          new URL('./src/lib/esm-env-debug.js', import.meta.url)
        ),
      },
    ],
  },
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
