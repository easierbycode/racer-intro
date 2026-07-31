// CLI: deno task slides --tutorial examples/hello-css.json
//
// Turns a Tutorial JSON (see types.ts — same shape as pablo.gg's GPT-
// generated reels scripts) into a recorded 9:16 typing video: render the
// self-contained HTML, serve it on a throwaway local port, point the
// generic scene recorder at it, transcode to the social cut.

import { parseArgs } from '@std/cli/parse-args'
import { ensureDir } from '@std/fs'
import { join } from '@std/path'
import { recordScene } from '../record/recorder.ts'
import { toReel } from '../transcode/transcode.ts'
import { renderTutorialHtml, estimateDurationMs } from './render.ts'
import { validateTutorial } from './types.ts'

const args = parseArgs(Deno.args, {
  string: ['tutorial', 'out-dir', 'name', 'chrome'],
  boolean: ['help', 'keep-raw'],
  default: { 'out-dir': 'out' },
})

if (args.help || !args.tutorial) {
  console.log(`slides — render a coding-tutorial typing video from a Tutorial JSON

Usage: deno task slides --tutorial <file.json> [--name <basename>] [--out-dir out]

Tutorial JSON: { "description": "...", "commands": "code to type",
                 "files": [{ "name": "index.html", "content": "" }] }
(or timed "steps" — see tools/slides/types.ts; that's the input shape the
 planned VS Code / Codespaces plugin will emit)`)
  Deno.exit(args.help ? 0 : 1)
}

const tutorial = validateTutorial(JSON.parse(await Deno.readTextFile(args.tutorial)))
const name = args.name ?? 'tutorial'
await ensureDir(args['out-dir'])

const html = renderTutorialHtml(tutorial)
const server = Deno.serve(
  { port: 0, onListen: () => {} },
  () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
)

try {
  const estMs = estimateDurationMs(tutorial)
  console.log(`recording "${tutorial.description}" (~${Math.round(estMs / 1000)}s)...`)
  const result = await recordScene(
    {
      name,
      url: `http://localhost:${server.addr.port}/`,
      // Rendered natively at 9:16 — the transcode is then a near-passthrough.
      width: 1080,
      height: 1920,
      startWhen: '!!window.__slidesState',
      stopWhen: 'window.__slidesState === "done"',
      tailMs: 700,
      maxMs: estMs * 1.5 + 15_000,
    },
    { outDir: args['out-dir'], chromePath: args.chrome ?? Deno.env.get('RECORD_CHROME') },
  )
  console.log(`  ${result.rawVideo}: ${result.frameCount} frames, ${result.durationS.toFixed(1)}s`)

  const reel = join(args['out-dir'], `${name}.reel.mp4`)
  await toReel({ input: result.rawVideo, output: reel, fill: 'pad' })
  console.log(`  ${reel}`)
  if (!args['keep-raw']) await Deno.remove(result.rawVideo)
} finally {
  await server.shutdown()
}
