// CLI: deno task transcode -- --input out/racer-intro.raw.mp4
// Produces the 1080x1920 Reels/TikTok cut plus a cover JPEG next to it.

import { parseArgs } from '@std/cli/parse-args'
import { dirname, join } from '@std/path'
import { binAvailable, ffprobeJson } from '../lib/proc.ts'
import { extractCover, toReel } from './transcode.ts'

const args = parseArgs(Deno.args, {
  string: ['input', 'output', 'fill', 'background', 'start', 'duration', 'fps', 'cover-at'],
  boolean: ['help'],
  default: { fill: 'blur' },
})

if (args.help || !args.input) {
  console.log(`transcode — format a capture for Instagram Reels / TikTok (1080x1920)

Usage: deno task transcode -- --input <raw.mp4> [options]
  --input <file>       raw capture (from the record tool, or any video)
  --output <file>      default: <input dir>/<name>.reel.mp4
  --fill blur|pad      canvas fill around non-9:16 video (default blur)
  --background 0xRRGGBB  pad color when --fill pad (default 0x07070d)
  --start <sec>        trim head
  --duration <sec>     clip length
  --fps <n>            output frame rate (default 30)
  --cover-at <sec>     cover frame timestamp (default 60% into the clip)`)
  Deno.exit(args.help ? 0 : 1)
}

if (!(await binAvailable('ffmpeg'))) {
  console.error('ffmpeg not found on PATH — install it first (winget install ffmpeg / apt-get install ffmpeg)')
  Deno.exit(1)
}

const input = args.input
const output = args.output ?? join(
  dirname(input),
  input.split(/[\\/]/).pop()!.replace(/(\.raw)?\.[^.]+$/, '') + '.reel.mp4',
)

console.log(`transcoding ${input} -> ${output} (fill: ${args.fill})`)
await toReel({
  input,
  output,
  fill: args.fill as 'blur' | 'pad',
  background: args.background,
  fps: args.fps ? Number(args.fps) : undefined,
  start: args.start ? Number(args.start) : undefined,
  duration: args.duration ? Number(args.duration) : undefined,
})

const probe = await ffprobeJson(output)
const v = probe.streams.find((s) => s.codec_type === 'video')!
const dur = Number(probe.format.duration ?? 0)
console.log(`  ${v.width}x${v.height} ${v.codec_name} ${dur.toFixed(2)}s`)

// Cover frame: default to 35% in — past the mosaic wipe, mid-race, which
// reads better as a thumbnail than the black boot frame at t=0 (or the
// white-out flash later in the sequence).
const coverAt = args['cover-at'] != null ? Number(args['cover-at']) : dur * 0.35
const cover = output.replace(/\.mp4$/, '.cover.jpg')
await extractCover(output, cover, coverAt)
console.log(`  cover: ${cover} (t=${coverAt.toFixed(2)}s)`)
