import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig(({ mode }) => {
  /*
   * `vite build --mode debug` loads .env.debug (NODE_ENV=development), which
   * flips vite's isProduction — that, not --mode by itself, is what lets
   * vite-plugin-svelte compile with dev:true instead of force-clearing it.
   * The result lands in dist/debug/ and deploys alongside the production site
   * at /racer-intro/debug/: same game, unminified, sourcemapped, dev-compiled.
   */
  const DEBUG = mode === 'debug'

  return {
    plugins: [
      svelte({
        // The inspector plugin is apply:'serve', so it is stripped from every
        // build and needs no DEBUG gating. alt-x over an element opens its
        // source; no toggle button, which would sit on top of the canvas.
        inspector: { showToggleButton: 'never' },
        ...(DEBUG && {
          // Dev output carries a filename per component. Without rootDir the
          // compiler bakes in absolute paths, which would ship the CI
          // checkout path inside the deployed debug bundle.
          compilerOptions: {
            rootDir: fileURLToPath(new URL('.', import.meta.url)),
          },
        }),
      }),
    ],
    resolve: {
      // Svelte 5 reads DEV from `esm-env`, normally resolved to a static
      // boolean by export conditions at build time — which would erase dev
      // mode from the production bundle entirely. The shim decides at runtime
      // instead, so ?debug=1 turns on Svelte's runtime dev mode (and the
      // window.__racer handle) on the ordinary build. Compile-time dev extras
      // still need the dev-compiled artifact above.
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
    // stay consistent — and the same holds one level down at /debug/.
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
    ...(DEBUG && {
      build: {
        outDir: 'dist/debug',
        // NODE_ENV=development disables cssMinify but NOT the JS minifier, and
        // readable source on the deployed page is the point of this artifact.
        minify: false,
        sourcemap: true,
      },
    }),
  }
})
