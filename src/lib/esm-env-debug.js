/*
 * Aliased in place of the `esm-env` package (see vite.config.js).
 *
 * Svelte 5 reads its DEV flag from `esm-env`, which is normally pinned to a
 * static boolean by export conditions at build time — dev mode simply doesn't
 * exist in a production bundle. Routing the package here keeps every dev code
 * path in the bundle and defers the decision to page load: `?debug=1` flips
 * the deployed build into Svelte dev mode (runtime warnings, dev metadata,
 * DevTools support). The vite dev server stays in dev mode unconditionally.
 */
const debugParam =
  new URLSearchParams(globalThis.location?.search ?? '').get('debug') === '1'

export const DEV = import.meta.env.DEV || debugParam
export const BROWSER = true
export const NODE = false

if (debugParam) console.info('[racer-intro] Svelte dev mode: ON (?debug=1)')
