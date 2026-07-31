// Headless-Chrome scene recorder built on astral + raw CDP screencast.
//
// The flow: open a blank page, start Page.startScreencast BEFORE navigating
// so nothing is missed, then let the SceneSpec's predicates decide which
// frames matter — capture runs from navigation, and frames before
// `startWhen` first turns truthy are discarded afterwards. Chrome only
// emits screencast frames when the compositor produces one, so a static
// loading screen costs almost nothing.

import { launch } from '@astral/astral'
import { decodeBase64 } from '@std/encoding/base64'
import { ensureDir } from '@std/fs'
import { join } from '@std/path'
import { type CapturedFrame, muxFrames } from './mux.ts'
import type { SceneSpec } from './scenes.ts'

export interface RecordOptions {
  outDir: string
  /** Screencast image format. jpeg@95 is visually clean for pixel art. */
  format?: 'jpeg' | 'png'
  quality?: number
  /** Keep the frame dump next to the mp4 instead of deleting it. */
  keepFrames?: boolean
  /** Use an installed Chrome instead of astral's pinned download. */
  chromePath?: string
  /** Extra Chromium switches (e.g. --no-sandbox in CI). */
  chromeArgs?: string[]
}

export interface RecordResult {
  rawVideo: string
  metaFile: string
  frameCount: number
  durationS: number
  avgFps: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function recordScene(
  spec: SceneSpec,
  opts: RecordOptions,
): Promise<RecordResult> {
  const format = opts.format ?? 'jpeg'
  const framesDir = join(opts.outDir, `${spec.name}.frames`)
  await ensureDir(framesDir)

  // CI runners (notably ubuntu-24.04's AppArmor userns restriction) crash
  // Chrome-for-Testing's sandbox; --no-sandbox is the accepted fix there.
  const ci = Deno.env.get('CI') != null
  const args = [
    `--window-size=${spec.width},${spec.height}`,
    '--force-device-scale-factor=1',
    ...(ci ? ['--no-sandbox'] : []),
    ...(opts.chromeArgs ?? []),
  ]

  const browser = await launch({
    headless: true,
    args,
    ...(opts.chromePath ? { path: opts.chromePath } : {}),
  })

  const frames: CapturedFrame[] = []
  const writes: Promise<void>[] = []

  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: spec.width, height: spec.height })

    const celestial = page.unsafelyGetCelestialBindings()
    celestial.addEventListener('Page.screencastFrame', (e) => {
      // deno-lint-ignore no-explicit-any
      const { data, metadata, sessionId } = (e as CustomEvent<any>).detail
      // Ack immediately — Chrome stalls the stream after a few unacked
      // frames.
      celestial.Page.screencastFrameAck({ sessionId }).catch(() => {})
      const file = `frame-${String(frames.length).padStart(6, '0')}.${format}`
      // metadata.timestamp is optional in CDP; frames without one inherit
      // the wall clock, which shares an epoch with Chrome's stamps.
      const timestamp = metadata?.timestamp ?? Date.now() / 1000
      frames.push({ file, timestamp })
      writes.push(Deno.writeFile(join(framesDir, file), decodeBase64(data)))
    })

    await celestial.Page.startScreencast({
      format,
      ...(format === 'jpeg' ? { quality: opts.quality ?? 95 } : {}),
      maxWidth: spec.width,
      maxHeight: spec.height,
      everyNthFrame: 1,
    })

    // astral's page.goto waits inside a fixed 10s deadline — 'load' keeps
    // us clear of dev servers whose HMR websocket never goes idle.
    await page.goto(spec.url, { waitUntil: 'load' })

    const t0 = Date.now()
    const deadline = t0 + spec.maxMs
    const poll = async (expr: string): Promise<boolean> => {
      while (Date.now() < deadline) {
        // page.waitForFunction has a hard 10s timeout and busy-loops, so
        // roll our own paced poll against the same maxMs budget.
        if (await page.evaluate(expr)) return true
        await sleep(100)
      }
      return false
    }

    // Trim point: everything captured before the scene says it started
    // (minus a small margin so the first real frame survives clock skew)
    // gets dropped below.
    let captureFrom = 0
    if (spec.startWhen) {
      if (!(await poll(spec.startWhen))) {
        throw new Error(
          `scene "${spec.name}": startWhen never became true within ${spec.maxMs}ms — is the page instrumented? (${spec.startWhen})`,
        )
      }
      captureFrom = Date.now() / 1000 - 0.15
    }

    if (spec.stopWhen) {
      if (!(await poll(spec.stopWhen))) {
        console.warn(
          `scene "${spec.name}": stopWhen never fired — keeping the full ${spec.maxMs}ms capture`,
        )
      } else if (spec.tailMs) {
        await sleep(Math.min(spec.tailMs, deadline - Date.now()))
      }
    } else {
      const wanted = spec.durationMs ?? spec.maxMs
      const elapsed = Date.now() - (spec.startWhen ? captureFrom * 1000 : t0)
      await sleep(Math.max(0, Math.min(wanted - elapsed, deadline - Date.now())))
    }

    await celestial.Page.stopScreencast()
    // Give in-flight screencastFrame events a beat to land before closing.
    await sleep(200)
    await Promise.all(writes)

    const kept = frames.filter((f) => f.timestamp >= captureFrom)
    if (kept.length < 2) {
      throw new Error(
        `scene "${spec.name}": ${frames.length} frames captured, ${kept.length} after trimming — nothing to encode`,
      )
    }

    const rawVideo = join(opts.outDir, `${spec.name}.raw.mp4`)
    await muxFrames({ framesDir, frames: kept, output: rawVideo })

    const durationS = kept[kept.length - 1].timestamp - kept[0].timestamp
    const meta = {
      scene: spec.name,
      url: spec.url,
      capturedAt: new Date().toISOString(),
      viewport: { width: spec.width, height: spec.height },
      frames: kept.length,
      trimmed: frames.length - kept.length,
      durationS: Number(durationS.toFixed(3)),
      avgFps: Number((kept.length / Math.max(durationS, 0.001)).toFixed(1)),
    }
    const metaFile = join(opts.outDir, `${spec.name}.meta.json`)
    await Deno.writeTextFile(metaFile, JSON.stringify(meta, null, 2) + '\n')

    if (!opts.keepFrames) {
      await Deno.remove(framesDir, { recursive: true })
    }

    return {
      rawVideo,
      metaFile,
      frameCount: kept.length,
      durationS,
      avgFps: meta.avgFps,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
