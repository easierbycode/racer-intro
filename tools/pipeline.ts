// One-shot pipeline: record → transcode → (optionally) post.
//
//   deno task pipeline --scene racer-intro
//   deno task pipeline --scene racer-intro --post instagram,tiktok --caption "..."
//
// Each stage shells out to its own CLI so the pipeline behaves exactly like
// running the steps by hand (same flags, same env), and a failed stage
// stops the run with that stage's own error output.

import { parseArgs } from '@std/cli/parse-args'
import { join } from '@std/path'

const args = parseArgs(Deno.args, {
  string: ['scene', 'url', 'out-dir', 'post', 'caption', 'fill', 'chrome', 'duration', 'privacy', 'mode', 'fps'],
  boolean: ['help', 'dry-run'],
  default: { scene: 'racer-intro', 'out-dir': 'out', mode: 'deterministic' },
})

if (args.help) {
  console.log(`pipeline — record, transcode, and optionally post in one go

Usage: deno task pipeline [--scene racer-intro] [options]
  --mode deterministic|screencast     deterministic (default) renders the reel
                                      in one pass; screencast adds a transcode
  --scene/--url/--duration/--chrome/--fps/--fill   forwarded to record
  --post instagram,tiktok             platforms to publish to (default: none)
  --caption <text>                    forwarded to post
  --privacy <level>                   forwarded to post (tiktok)
  --dry-run                           forwarded to post
  --out-dir <dir>                     working directory (default out/)`)
  Deno.exit(0)
}

async function stage(name: string, cmd: string[]): Promise<void> {
  console.log(`\n━━ ${name} ━━`)
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', ...cmd],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code !== 0) {
    console.error(`${name} failed (exit ${code})`)
    Deno.exit(code)
  }
}

const sceneName = args.url && !args.scene ? 'ad-hoc' : args.scene
const raw = join(args['out-dir'], `${sceneName}.raw.mp4`)
const reel = join(args['out-dir'], `${sceneName}.reel.mp4`)

await stage('record', [
  'tools/record/main.ts',
  '--mode', args.mode,
  ...(args.scene ? ['--scene', args.scene] : []),
  ...(args.url ? ['--url', args.url] : []),
  ...(args.duration ? ['--duration', args.duration] : []),
  ...(args.chrome ? ['--chrome', args.chrome] : []),
  ...(args.fps ? ['--fps', args.fps] : []),
  ...(args.fill ? ['--fill', args.fill] : []),
  '--out-dir', args['out-dir'],
])

// Deterministic recording encodes the reel in the same pass; only the
// screencast path leaves a raw capture behind that needs the transcode.
if (args.mode !== 'deterministic') {
  await stage('transcode', [
    'tools/transcode/main.ts',
    '--input', raw,
    '--output', reel,
    ...(args.fill ? ['--fill', args.fill] : []),
  ])
}

for (const platform of (args.post ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
  await stage(`post:${platform}`, [
    'tools/social/main.ts',
    '--platform', platform,
    '--video', reel,
    ...(args.caption ? ['--caption', args.caption] : []),
    ...(args.privacy ? ['--privacy', args.privacy] : []),
    ...(args['dry-run'] ? ['--dry-run'] : []),
  ])
}

console.log(`\ndone — ${reel}`)
