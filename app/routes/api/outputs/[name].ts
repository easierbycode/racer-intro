import { join } from '@std/path'
import { define } from '../../../utils.ts'
import { OUT_DIR } from '../../../lib/out-dir.ts'

const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  json: 'application/json',
}

export const handler = define.handlers({
  async GET(ctx) {
    const name = ctx.params.name
    // Only plain names inside out/ — no separators, no dot-walking, no
    // Windows drive/UNC prefixes. Same rule the job runner enforces.
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) {
      return new Response('bad name', { status: 400 })
    }
    try {
      const file = await Deno.open(join(OUT_DIR, name), { read: true })
      const ext = name.split('.').pop() ?? ''
      return new Response(file.readable, {
        headers: {
          'content-type': TYPES[ext] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  },
})
