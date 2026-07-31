import { join } from '@std/path'
import { define } from '../../../utils.ts'
import { onDeploy } from '../../../lib/jobs.ts'
import { OUT_DIR } from '../../../lib/out-dir.ts'

// Recordings live on whatever machine ran the job — locally that's out/;
// on Deno Deploy they're GitHub Actions artifacts, so the panel links to
// the Actions page instead of listing files here.
export const handler = define.handlers({
  async GET() {
    if (onDeploy()) return Response.json([])
    const files: Array<{ name: string; size: number; mtime: string | null }> = []
    try {
      for await (const entry of Deno.readDir(OUT_DIR)) {
        if (!entry.isFile) continue
        const stat = await Deno.stat(join(OUT_DIR, entry.name))
        files.push({
          name: entry.name,
          size: stat.size,
          mtime: stat.mtime?.toISOString() ?? null,
        })
      }
    } catch {
      // out/ doesn't exist until the first recording — an empty list is fine.
    }
    files.sort((a, b) => (b.mtime ?? '').localeCompare(a.mtime ?? ''))
    return Response.json(files)
  },
})
