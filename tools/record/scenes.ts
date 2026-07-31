// Scene registry — a "scene" is anything a headless browser can load and
// watch: this repo's racer intro today, other games (or generated tutorial
// slide decks — see tools/slides) tomorrow. Everything the recorder needs to
// know about a target lives in this spec, so adding a game means adding an
// entry (or passing --url/--duration for one-offs), not touching recorder
// code.

export interface SceneSpec {
  name: string
  /** Page to load. Overridable per-run with --url. */
  url: string
  /** Browser viewport for the capture. */
  width: number
  height: number
  /**
   * JS expression evaluated in the page. Capture frames are kept starting
   * ~150ms before this first turns truthy — everything earlier (page load,
   * font wait, Phaser boot) is dropped. Omit to keep from navigation.
   */
  startWhen?: string
  /**
   * JS expression evaluated in the page. When truthy the recording enters
   * its tail: `tailMs` more of footage, then stop. Omit for fixed-length
   * recordings via `durationMs`.
   */
  stopWhen?: string
  /** Extra footage after stopWhen fires (e.g. PRESS START blinking). */
  tailMs?: number
  /** Fixed recording length when there is no stopWhen. */
  durationMs?: number
  /** Safety cap — recording never runs longer than this. */
  maxMs: number
}

/**
 * The racer intro reports its phase on `window.__racerPhase`
 * (see src/lib/RacerIntro.svelte): boot → mosaic → race → crash → flash →
 * stage. Capture starts at the mosaic wipe and ends after ~4s of the
 * burning-expressway stage, enough for a few PRESS START blinks.
 *
 * 1280x960 viewport: Phaser FIT-scales the 640x480 canvas to exactly 2x
 * with image-rendering: pixelated, so the capture is crisp doubled pixels
 * and the transcode step downscales instead of blowing up 1x art.
 */
export const SCENES: Record<string, SceneSpec> = {
  'racer-intro': {
    name: 'racer-intro',
    url: Deno.env.get('RACER_URL') ?? 'http://localhost:5173/',
    width: 1280,
    height: 960,
    startWhen: '!!window.__racerPhase',
    stopWhen: 'window.__racerPhase === "stage"',
    tailMs: 4000,
    maxMs: 45_000,
  },
}

/** Resolve a named scene, or build an ad-hoc spec for --url one-offs. */
export function resolveScene(opts: {
  scene?: string
  url?: string
  width?: number
  height?: number
  durationMs?: number
}): SceneSpec {
  if (opts.scene) {
    const spec = SCENES[opts.scene]
    if (!spec) {
      throw new Error(
        `unknown scene "${opts.scene}" — known: ${Object.keys(SCENES).join(', ')}`,
      )
    }
    return { ...spec, url: opts.url ?? spec.url }
  }
  if (!opts.url) throw new Error('pass --scene <name> or --url <page>')
  return {
    name: 'ad-hoc',
    url: opts.url,
    width: opts.width ?? 1280,
    height: opts.height ?? 960,
    durationMs: opts.durationMs ?? 15_000,
    maxMs: Math.max(opts.durationMs ?? 15_000, 15_000) + 5_000,
  }
}
