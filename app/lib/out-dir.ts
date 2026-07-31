// Where recordings land, and where the tool CLIs are spawned from.
//
// Resolving these from import.meta.url breaks under the Fresh/Vite
// production build (routes are bundled into _fresh/, so the module URL no
// longer sits a fixed depth under the repo root). Deno.cwd() is the app
// directory in both `deno task dev` and `deno serve _fresh/server.js`, so
// derive from that. RECORDINGS_DIR / REPO_ROOT_DIR override outright.

import { isAbsolute, join, resolve } from '@std/path'

const abs = (p: string) => (isAbsolute(p) ? p : resolve(p))

/** Repo root — the cwd for spawned tool CLIs (app/ → ..). */
export const REPO_ROOT: string = abs(
  Deno.env.get('REPO_ROOT_DIR') ?? join(Deno.cwd(), '..'),
)

/** Recording output directory. */
export const OUT_DIR: string = abs(
  Deno.env.get('RECORDINGS_DIR') ?? join(REPO_ROOT, 'out'),
)
