// Deterministic offline rendering — the architecture from the encoding
// notes: instead of screencasting wall-clock playback (where every frame
// the machine drops during the crash fireball is baked in forever), freeze
// the page's clock, step it one exact 1/fps tick at a time, and read each
// finished frame off the canvas. Capture speed becomes irrelevant to output
// smoothness, and the same run always produces the same file.
//
// The page needs NO instrumentation: a script injected before any page
// code runs (Page.addScriptToEvaluateOnNewDocument) takes over
// performance.now / Date.now / requestAnimationFrame, so Phaser's own
// rAF-driven TimeStep — and any other rAF game loop — advances only when
// the recorder says so. The same script wraps getContext to force
// preserveDrawingBuffer on WebGL canvases so toDataURL reads real pixels.

import { launch } from '@astral/astral'
import { decodeBase64 } from '@std/encoding/base64'
import { ensureDir } from '@std/fs'
import { join } from '@std/path'
import type { SceneSpec } from './scenes.ts'

export interface DeterministicOptions {
  outDir: string
  /** Output frame rate — every rendered frame is exactly 1/fps apart. */
  fps?: number
  keepFrames?: boolean
  chromePath?: string
  chromeArgs?: string[]
}

export interface DeterministicResult {
  framesDir: string
  frameCount: number
  fps: number
  width: number
  height: number
}

/**
 * Runs before every page script. `__cmgStep()` advances the virtual clock
 * one tick and fires the queued rAF callbacks; `__cmgFrame()` returns the
 * game canvas as a PNG data URL. Timers (setTimeout) stay on real time on
 * purpose — pages use them for load fallbacks (e.g. the font wait in this
 * repo's main.js), and games animate off rAF timestamps, not timers.
 */
const injection = (fps: number) => `(() => {
  const TICK = 1000 / ${fps};
  let vnow = 0;
  const epoch = Date.now();
  let rafQ = [];
  let rafId = 1;
  performance.now = () => vnow;
  Date.now = () => epoch + vnow;
  window.requestAnimationFrame = (cb) => {
    const id = rafId++;
    rafQ.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    rafQ = rafQ.filter((e) => e.id !== id);
  };
  const getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return getCtx.call(this, type, attrs);
  };
  window.__cmgStep = () => {
    vnow += TICK;
    const q = rafQ;
    rafQ = [];
    for (const e of q) {
      try { e.cb(vnow); } catch (err) { console.error(err); }
    }
    return vnow;
  };
  window.__cmgFrame = () => {
    const c = document.querySelector('canvas');
    return c ? c.toDataURL('image/png') : null;
  };
})();`

export async function recordDeterministic(
  spec: SceneSpec,
  opts: DeterministicOptions,
): Promise<DeterministicResult> {
  const fps = opts.fps ?? 30
  const framesDir = join(opts.outDir, `${spec.name}.frames`)
  await ensureDir(framesDir)

  const ci = Deno.env.get('CI') != null
  const browser = await launch({
    headless: true,
    args: [
      `--window-size=${spec.width},${spec.height}`,
      '--force-device-scale-factor=1',
      ...(ci ? ['--no-sandbox'] : []),
      ...(opts.chromeArgs ?? []),
    ],
    ...(opts.chromePath ? { path: opts.chromePath } : {}),
  })

  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: spec.width, height: spec.height })

    const celestial = page.unsafelyGetCelestialBindings()
    await celestial.Page.addScriptToEvaluateOnNewDocument({
      source: injection(fps),
    })

    await page.goto(spec.url, { waitUntil: 'load' })
    // A headless browser happily renders frame 0 in the fallback font —
    // wait for the real faces before the first step.
    await page.evaluate('document.fonts.ready.then(() => true)')

    const maxTicks = Math.ceil((spec.maxMs / 1000) * fps)
    const tailTicks = Math.ceil(((spec.tailMs ?? 0) / 1000) * fps)
    const wantedTicks = spec.durationMs
      ? Math.ceil((spec.durationMs / 1000) * fps)
      : Number.POSITIVE_INFINITY

    // Phase 1 — step (without saving) until the scene says it started.
    // Games boot across several rAF ticks, so stepping is what gets the
    // page from "loaded" to "playing" at all.
    let tick = 0
    if (spec.startWhen) {
      while (tick < maxTicks) {
        if (await page.evaluate(spec.startWhen)) break
        await page.evaluate('window.__cmgStep()')
        tick++
      }
      if (tick >= maxTicks) {
        throw new Error(
          `scene "${spec.name}": startWhen never became true within ${spec.maxMs}ms of stepped time (${spec.startWhen})`,
        )
      }
    }

    // Phase 2 — step + save until stopWhen (then the tail), duration, or cap.
    let saved = 0
    let tailLeft = -1
    let width = 0
    let height = 0
    const writes: Promise<void>[] = []
    while (tick < maxTicks && saved < wantedTicks && tailLeft !== 0) {
      await page.evaluate('window.__cmgStep()')
      tick++
      const dataUrl = await page.evaluate('window.__cmgFrame()') as string | null
      if (!dataUrl) {
        throw new Error(`scene "${spec.name}": no canvas on the page to capture`)
      }
      const png = decodeBase64(dataUrl.slice('data:image/png;base64,'.length))
      if (saved === 0) {
        // Sniff dimensions from the PNG header (IHDR at fixed offsets).
        const dv = new DataView(png.buffer, png.byteOffset)
        width = dv.getUint32(16)
        height = dv.getUint32(20)
      }
      writes.push(
        Deno.writeFile(
          join(framesDir, `${String(saved).padStart(5, '0')}.png`),
          png,
        ),
      )
      saved++
      if (tailLeft > 0) tailLeft--
      else if (tailLeft < 0 && spec.stopWhen && await page.evaluate(spec.stopWhen)) {
        tailLeft = tailTicks
      }
    }
    await Promise.all(writes)

    if (saved < 2) {
      throw new Error(`scene "${spec.name}": only ${saved} frame(s) captured`)
    }
    return { framesDir, frameCount: saved, fps, width, height }
  } finally {
    await browser.close().catch(() => {})
  }
}
