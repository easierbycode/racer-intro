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

## Layout

| file | what it does |
| --- | --- |
| `src/lib/RacerIntro.svelte` | `<Game>`/`<Scene>` setup + the declarative overlay (LAP, PRESS START, replay hint) driven by Svelte state |
| `src/lib/intro/scene.js` | the sequence state machine: mosaic → race → crash → flash → stage, plus replay reset |
| `src/lib/intro/road.js` | OutRun-style segment road renderer (projection, rails, lane dashes, light poles) |
| `src/lib/intro/stage.js` | the burning expressway set (fire wall, wreck, gantry sign, embers, smoke) |
| `src/lib/intro/textures.js` | all placeholder art, generated at runtime — **and the swap points for ripped sheets** |
| `src/lib/intro/constants.js` | every tuning knob: timings, road geometry, speeds, palette |

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
