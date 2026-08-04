# racer-intro

A recreation of the *Capcom vs. SNK: Millennium Fight 2000* "Expressway, Japan"
stage intro — built with **Svelte 5 + Phaser 4** via
[`5velte-ph4ser`](https://www.npmjs.com/package/5velte-ph4ser).

The sequence: TV-blob mosaic reveal → pseudo-3D night expressway (TIME/LAP
running, truck ahead) → crash fireball → white-out → the burning expressway
set with the tipped trailer and 事故渋滞発生中 gantry, PRESS START blinking.
Click or press space on the stage to replay.

```sh
npm install
npm run dev
```

## Debugging

**Svelte DevTools does not work here, and can't be made to.** The extension
requires Svelte `^4.0.0`: it listens for the `SvelteRegisterComponent` /
`SvelteDOMInsert` events the Svelte 3/4 compiler emitted, and Svelte 5 removed
that protocol entirely ([svelte#11389](https://github.com/sveltejs/svelte/issues/11389)
tracks adding a replacement; still open). It reports "No Svelte app detected"
on any Svelte 5 page. There is no Svelte 5 devtools extension today.

It would show little here anyway — `<Game>`/`<Scene>`/`<Text>` render snippets,
not DOM, so the entire Svelte-rendered tree is `<main>` and `<div class="frame">`.
Everything that actually goes wrong (atlas frame ordering, road projection,
camera FX, phase timing) is Phaser. So debugging goes through `window.__racer`:

| where | how |
| --- | --- |
| live site | [`?debug=1`](https://easierbycode.com/racer-intro/?debug=1) — Svelte's runtime dev mode (readable warnings instead of error-code URLs) + `window.__racer` |
| live site, deeper | [`/debug/`](https://easierbycode.com/racer-intro/debug/) — a second artifact: **unminified, sourcemapped, dev-compiled**. Breakpoints in real `scene.js`/`road.js` source, `__svelte_meta` on elements, no query param needed |
| dev server | `npm run dev`, then **alt-x** — the vite-plugin-svelte inspector; hover an element to see its source, click to open it in your editor |
| dev server | the **Vite DevTools drawer** at the bottom of the page → **Svelte** tab: component tree with live props/state, reactive dependency graph, render profiler ([vite-devtools-svelte](https://github.com/baseballyama/vite-devtools-svelte)) |

```js
__racer.S            // live state: phase, speed, camZ, car, truck, stage, road…
__racer.scene        // the Phaser scene → .game, .cameras, .tweens, .textures
__racer.crash()      // skip the race, jump straight to the fireball
__racer.flash()      // jump straight to the burning stage
__racer.tire(0)      // re-fire the wheel pop-off
__racer.reset()      // restart the whole sequence
```

`crash()` / `flash()` are the time-savers — reach a late phase from the console
instead of sitting through the mosaic and the race on every reload.

The devtools plugin also prints an MCP endpoint on dev-server startup, so
Claude Code can query the component/state data directly:

```sh
claude mcp add --transport http svelte http://localhost:5173/__svelte-devtools/mcp --header x-svelte-devtools-token:<token>
```

Both dev-server tools are registered only when `command === 'serve'`, so
neither deployed artifact contains a byte of them.

Both artifacts are built by `npm run build:all` (order matters: `build` empties
`dist/` first). The debug build is driven by `.env.debug` setting
`NODE_ENV=development`, which is what flips vite's `isProduction` — `--mode`
alone does not, and vite-plugin-svelte force-clears `compilerOptions.dev` for
production builds.

## Recording & social pipeline (Deno)

The repo doubles as its own production line: Deno tools record the intro
(or any browser scene) from headless Chrome, cut it for vertical social,
and publish it.

```sh
deno task record --scene racer-intro     # → out/racer-intro.raw.mp4 (CFR 60, 1280x960)
deno task transcode --input out/racer-intro.raw.mp4   # → 1080x1920 reel + cover.jpg
deno task post --platform instagram --video out/racer-intro.reel.mp4 --caption "..."
deno task post --platform tiktok --video out/racer-intro.reel.mp4
deno task post --platform instagram --check   # credentials only — records and publishes nothing
deno task pipeline --scene racer-intro --post instagram,tiktok --caption "..."
deno task slides --tutorial tools/slides/examples/hello-canvas.json   # typed-code tutorial video
```

- **record** ([tools/record](tools/record)) drives headless Chrome via
  [astral](https://jsr.io/@astral/astral). The default **deterministic**
  mode injects a virtual clock before any page script runs (frozen
  `performance.now`/`rAF`, `preserveDrawingBuffer` forced on), steps the
  game one exact 1/fps tick at a time, reads each finished frame off the
  canvas at native resolution, and encodes the reel in a single pass —
  no dropped frames ever, identical output every run, works for any
  rAF-driven canvas game with zero game-side changes. `--mode screencast`
  keeps the wall-clock CDP capture for pages animated by timers instead of
  rAF. The intro reports its phase on `window.__racerPhase` (see
  `RacerIntro.svelte`), so capture trims to the mosaic wipe and stops a few
  PRESS-START blinks into the stage. Other games register a `SceneSpec` in
  [tools/record/scenes.ts](tools/record/scenes.ts) (or use `--url`/`--duration`
  ad hoc). ffmpeg must be on PATH (`FFMPEG`/`FFPROBE` env override — the
  Windows-ARM64 story); if astral's pinned Chrome download won't run on
  your box, point `RECORD_CHROME` (or `--chrome`) at an installed one.
- **transcode** ([tools/transcode](tools/transcode)) makes the
  Reels/TikTok-ready cut: H.264 high@4.1 + AAC (silence — the ingest
  rejects soundless files), 1080x1920 with a blurred-fill (`--fill pad`
  for bars), `+faststart`, plus a cover JPEG.
- **post** ([tools/social](tools/social)) publishes. Instagram uses the
  official Graph API container flow (env `IG_ACCESS_TOKEN`, `IG_USER_ID`) —
  it only pulls from public URLs, so local files are served through an
  ngrok tunnel automatically (or pass `--video-url` if hosted). TikTok uses
  the Content Posting API (env `TIKTOK_ACCESS_TOKEN`); unaudited apps are
  limited to `SELF_ONLY` visibility, the default. `--dry-run` everywhere.
  `--check` hits the API with nothing but the credentials — it prints the
  account it resolved to (and Instagram's remaining 24h publishing quota),
  which is the quick way to tell a stale token from a broken pipeline. The
  **Check social credentials** workflow runs it against the repo secrets.
- **slides** ([tools/slides](tools/slides)) renders a coding-tutorial
  typing video from a Tutorial JSON (same shape as
  [pablo.gg's GPT-generated reels scripts](https://pablo.gg/en/blog/coding/creating-instagram-reels-coding-tutorials-automatically-with-openais-gpt/))
  through the same recorder — the planned VS Code / Codespaces plugin will
  emit these payloads (timed `steps` mode) at `POST /api/jobs`.

## Control deck (Fresh 2.3 app)

[app/](app) is a Fresh 2.3 app exposing all of the above as an arcade-style
panel — itself built with `5velte-ph4ser` (Svelte 5 + Phaser 4) in
[ui/](ui), bundled into `app/static/ui/`.

```sh
deno task ui:build        # bundle the panel (repo root)
cd app && deno install && deno task dev    # http://localhost:8000
```

Buttons fire `POST /api/jobs`; locally jobs spawn the Deno tools as
subprocesses and stream logs into the panel, with finished files listed
from `out/`. On **Deno Deploy** (no ffmpeg/Chrome there) the same buttons
dispatch the [record workflow](.github/workflows/record.yml) instead — set
`GITHUB_TOKEN` (PAT with `actions:write`), `GITHUB_REPO`, and optionally
`APP_TOKEN` (bearer token required for mutating API calls when set).

**Auto-deploy on push:** create the app once in the
[Deno Deploy](https://console.deno.com) dashboard → link this GitHub repo →
set the app root to `app/` (the Fresh preset is auto-detected) → set the
install command to `deno install && (cd .. && npm ci && npm run build:ui)`.
Every push then builds and deploys — production from `main`, previews from
branches. GitHub Pages deployment of the game itself already runs via
[deploy.yml](.github/workflows/deploy.yml).

## Layout

| file | what it does |
| --- | --- |
| `src/lib/RacerIntro.svelte` | `<Game>`/`<Scene>` setup + the declarative overlay (LAP, PRESS START, replay hint) driven by Svelte state |
| `src/lib/intro/scene.js` | the sequence state machine: mosaic → race → crash → flash → stage, plus replay reset |
| `src/lib/intro/road.js` | OutRun-style segment road renderer (projection, rails, lane dashes, light poles) |
| `src/lib/intro/stage.js` | the burning expressway set (fire wall, wreck, gantry sign, embers, smoke) |
| `src/lib/intro/textures.js` | all placeholder art, generated at runtime — **and the swap points for ripped sheets** |
| `src/lib/intro/constants.js` | every tuning knob: timings, road geometry, speeds, palette |
| `tools/` | Deno CLIs: `record` (headless capture), `transcode` (9:16 cut), `social` (IG/TikTok), `slides` (tutorial videos), `pipeline.ts` (all of it) |
| `app/` | Fresh 2.3 control-deck app (API routes + job runner), deploys to Deno Deploy |
| `ui/` | the 5velte-ph4ser panel the app serves, built to `app/static/ui/` by `deno task ui:build` |

## Assets

`public/assets/` now ships three real atlases, preloaded in
`RacerIntro.svelte` (frame names are double-hex-encoded by the atlas
builder, so everything reads frames sorted by atlas x — `framesByX` in
`textures.js`):

| key | frames | used for |
| --- | --- | --- |
| `car` | 6 steering frames | player car (mirrored via `flipX` for left turns) |
| `car-enemy` | 3 steering frames | the rival that cuts at us before the truck (lane-velocity → frame, `flipX` for left) |
| `car-rpm` | 0 = full, 1 = empty | tach gauge, bottom-right: full under throttle, dips on gear changes, empty after the crash |
| `car-nitrous-spark-l` | 2-frame flicker | exhaust sparks — left-pipe art, `flipX` for the right pipe; gear shifts kick a bigger flash |
| `car-nitrous-smoke-l` | 3-frame puff | exhaust smoke, alternating pipes (`flipX` for the right) |
| `bg-flames` | 8-frame loop | the stage fire wall (5 columns, desynced) + an additive front row |
| `skyline` (image) | 512×64 strip | night skyline band, drawn 2× (also tinted dark red as the stage silhouette). Its baked-in sky color is keyed to transparent at runtime (`keyedSkyline`) and the strip anchors just below the road horizon |
| `ryu` | 25 frames (0–4 = idle) | the left-side fighter on the burning stage, idling with anim-synced silhouette glow |

After the explosion, items get a **directional flame glow** built from
silhouette echoes: additive tint-filled copies of the object stepped toward
the fire, so the glow follows the object's outline exactly and fades
smoothly (`glowEcho` in `stage.js` for the props, the `carEchoes` in
`scene.js` for the crashing car against the fireball).

The transition also runs a **camera move**: a slow push-in on the fireball
through the crash (pan target clamped to the scene bounds), a snap back
behind the full white, then the burning stage settles out of a slight zoom
as the white fades.

## Swapping in more sprites

Everything else is still procedural placeholder art. Matching sheets on
The Spriters Resource:

| key | sheet |
| --- | --- |
| `truck` | Turbo Out Run (Genesis) — [Other Cars](https://www.spriters-resource.com/sega_genesis/turbooutrun/asset/36255/) (tagged Truck) |
| `fireball`, `smoke` | Metal Slug (Neo Geo) — [Explosion SFX](https://www.spriters-resource.com/neo_geo_ngcd/ms/asset/11301/) |

Drop the cropped images into `public/assets/`, then preload them under the
same keys (see the commented `preload` in `RacerIntro.svelte`) — any key
that's already loaded makes `textures.js` skip its placeholder automatically.
For the Metal Slug explosion, load a spritesheet + `scene.anims.create`, and
play it where `scene.js` marks the `spawnFireball` swap point.

Those rips are copyrighted game art — personal / fan use only.

## Tuning

Everything lives in `constants.js`: `T.*` for the phase timings, `ROAD.*`
for geometry/sway, `RACE.*` for speeds and when the truck arrives
(`truckLead` ≈ how long the race lasts, `clockStart` for the TIME readout).
