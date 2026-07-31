// CLI: deno task record -- --scene racer-intro
//      deno task record -- --url http://localhost:8000/ --duration 20
//
// Records a browser scene to out/<scene>.raw.mp4 (real-time-accurate VFR
// capture). Feed the result to `deno task transcode` for the 9:16 social
// cut.

import { parseArgs } from '@std/cli/parse-args'
import { ensureDir } from '@std/fs'
import { join } from '@std/path'
import { binAvailable, ffmpegBin } from '../lib/proc.ts'
import { extractCover } from '../transcode/transcode.ts'
import { encodeFramesToReel } from '../transcode/frames.ts'
import { recordDeterministic } from './deterministic.ts'
import { recordScene } from './recorder.ts'
import { resolveScene, SCENES } from './scenes.ts'

const args = parseArgs(Deno.args, {
  string: [
    'scene', 'url', 'out-dir', 'width', 'height', 'duration', 'format',
    'quality', 'chrome', 'mode', 'fps', 'fill', 'background',
  ],
  boolean: ['help', 'keep-frames', 'no-sandbox', 'no-pixel-art'],
  default: { 'out-dir': 'out', mode: 'deterministic' },
})

if (args.help || (!args.scene && !args.url)) {
  console.log(`record — capture a game scene from a headless browser

Usage:
  deno task record -- --scene racer-intro
  deno task record -- --url <page> [--duration <sec>] [--width 1280 --height 960]

Options:
  --scene <name>     named scene: ${Object.keys(SCENES).join(', ')}
  --url <page>       override the scene URL, or record any page ad hoc
  --duration <sec>   ad-hoc recording length (default 15)
  --out-dir <dir>    output directory (default out/)
  --mode <m>         deterministic (default) | screencast
                     deterministic freezes the page clock and steps the game
                     one exact 1/fps tick at a time — no dropped frames, same
                     bytes every run — then encodes the reel directly.
                     screencast records wall-clock playback via CDP (for
                     pages animated by timers/audio rather than rAF).
  --fps <n>          deterministic frame rate (default 30; use 60 for silk)
  --fill pad|blur    deterministic reel fill (default pad, game-sky color)
  --background <c>   pad color (default 0x05060f)
  --no-pixel-art     skip the neighbor-upscale stage (for non-pixel-art games)
  --format jpeg|png  screencast frame format (default jpeg)
  --quality <0-100>  screencast jpeg quality (default 95)
  --keep-frames      keep the raw frame dump next to the mp4
  --chrome <path>    use an installed Chrome binary (skips astral's download)
  --no-sandbox       pass --no-sandbox to Chrome (auto-added when CI is set)

Env: RACER_URL overrides the racer-intro scene URL (defaults to the local
vite dev server, http://localhost:5173/). RECORD_CHROME points at an
installed Chrome; FFMPEG/FFPROBE override the encoder binaries.`)
  Deno.exit(args.help ? 0 : 1)
}

if (!(await binAvailable('ffmpeg'))) {
  console.error('ffmpeg not found on PATH — install it first (winget install ffmpeg / apt-get install ffmpeg)')
  Deno.exit(1)
}

const spec = resolveScene({
  scene: args.scene,
  url: args.url,
  width: args.width ? Number(args.width) : undefined,
  height: args.height ? Number(args.height) : undefined,
  durationMs: args.duration ? Number(args.duration) * 1000 : undefined,
})

await ensureDir(args['out-dir'])

// RECORD_CHROME lets environments where astral's pinned download doesn't
// run (or shouldn't be downloaded) point at an installed browser without
// threading a flag through every caller.
const chromePath = args.chrome ?? Deno.env.get('RECORD_CHROME')
const chromeArgs = args['no-sandbox'] ? ['--no-sandbox'] : []

console.log(
  `recording "${spec.name}" from ${spec.url} (${args.mode}) @ ${spec.width}x${spec.height}...`,
)

if (args.mode === 'deterministic') {
  const fps = args.fps ? Number(args.fps) : 30
  const det = await recordDeterministic(spec, {
    outDir: args['out-dir'],
    fps,
    keepFrames: args['keep-frames'],
    chromePath,
    chromeArgs,
  })
  const durationS = det.frameCount / fps
  console.log(
    `  ${det.frameCount} frames @ ${fps}fps (${durationS.toFixed(2)}s), canvas ${det.width}x${det.height}`,
  )

  // Frames are the master — encode the social cut in a single pass.
  const reel = join(args['out-dir'], `${spec.name}.reel.mp4`)
  await encodeFramesToReel({
    framesDir: det.framesDir,
    fps,
    width: det.width,
    height: det.height,
    output: reel,
    fill: (args.fill as 'pad' | 'blur' | undefined) ?? 'pad',
    background: args.background,
    pixelArt: !args['no-pixel-art'],
  })
  const cover = reel.replace(/\.mp4$/, '.cover.jpg')
  await extractCover(reel, cover, durationS * 0.35)
  await Deno.writeTextFile(
    join(args['out-dir'], `${spec.name}.meta.json`),
    JSON.stringify(
      {
        scene: spec.name,
        url: spec.url,
        mode: 'deterministic',
        capturedAt: new Date().toISOString(),
        canvas: { width: det.width, height: det.height },
        fps,
        frames: det.frameCount,
        durationS: Number(durationS.toFixed(3)),
      },
      null,
      2,
    ) + '\n',
  )
  if (!args['keep-frames']) await Deno.remove(det.framesDir, { recursive: true })
  console.log(`  ${reel}\n  ${cover}`)
} else {
  const result = await recordScene(spec, {
    outDir: args['out-dir'],
    format: (args.format as 'jpeg' | 'png' | undefined) ?? 'jpeg',
    quality: args.quality ? Number(args.quality) : undefined,
    keepFrames: args['keep-frames'],
    chromePath,
    chromeArgs,
  })
  console.log(
    `  ${result.rawVideo}\n  ${result.frameCount} frames, ${result.durationS.toFixed(2)}s, ~${result.avgFps}fps`,
  )
}
