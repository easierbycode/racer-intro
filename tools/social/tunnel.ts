// Makes local output files publicly downloadable for the Instagram Graph
// API (which only accepts URLs, never uploads). A throwaway static file
// server goes up on an ephemeral port, ngrok fronts it, and the caller gets
// public URLs — the Deno equivalent of the express + @ngrok/ngrok trick in
// pablo.gg's Reels post. Requires the ngrok binary on PATH and a configured
// authtoken (`ngrok config add-authtoken ...`).

import { basename } from '@std/path'

export interface Tunnel {
  /** Public URL for a served file, keyed by the label passed in `files`. */
  urls: Record<string, string>
  close(): Promise<void>
}

/** Serve the given files ({ label: localPath }) through an ngrok tunnel. */
export async function serveViaTunnel(
  files: Record<string, string>,
): Promise<Tunnel> {
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const label = new URL(req.url).pathname.slice(1)
    const path = files[label]
    if (!path) return new Response('not found', { status: 404 })
    try {
      const file = await Deno.open(path, { read: true })
      const type = path.endsWith('.mp4')
        ? 'video/mp4'
        : path.endsWith('.jpg') || path.endsWith('.jpeg')
        ? 'image/jpeg'
        : 'application/octet-stream'
      return new Response(file.readable, {
        headers: { 'content-type': type },
      })
    } catch {
      return new Response('gone', { status: 404 })
    }
  })
  const port = server.addr.port

  let ngrok: Deno.ChildProcess
  try {
    ngrok = new Deno.Command('ngrok', {
      args: ['http', String(port), '--log', 'stdout', '--log-format', 'json'],
      stdin: 'null',
      stdout: 'piped',
      stderr: 'null',
    }).spawn()
  } catch (e) {
    await server.shutdown()
    throw new Error(
      `couldn't start ngrok (${(e as Error).message}) — install it (https://ngrok.com/download) ` +
        `or pass --video-url/--cover-url pointing at already-public copies`,
    )
  }

  // ngrok announces the assigned public URL in its log stream; watch for it
  // rather than polling the local agent API (which may be on a busy port).
  const publicUrl = await (async () => {
    const deadline = Date.now() + 15_000
    const reader = ngrok.stdout.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    try {
      while (Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const m = buf.match(/"url":"(https:\/\/[^"]+)"/)
        if (m) return m[1]
        if (buf.includes('ERR_NGROK') || buf.includes('"lvl":"crit"')) break
      }
    } finally {
      // Keep the process alive but stop consuming its output.
      reader.cancel().catch(() => {})
    }
    throw new Error(
      'ngrok never reported a public URL — check `ngrok config check` (is an authtoken set?)',
    )
  })().catch(async (e) => {
    try {
      ngrok.kill()
    } catch { /* already gone */ }
    await server.shutdown()
    throw e
  })

  const urls: Record<string, string> = {}
  for (const label of Object.keys(files)) {
    urls[label] = `${publicUrl}/${label}`
  }
  // The URL is effectively a capability — anyone who has it can download
  // the files for as long as the tunnel is up, and this output ends up in
  // the control panel's job log. Log what is served, never where.
  console.log(
    `serving ${Object.values(files).map((f) => basename(f)).join(', ')} through an ngrok tunnel`,
  )

  return {
    urls,
    async close() {
      try {
        ngrok.kill()
        await ngrok.status
      } catch { /* already gone */ }
      await server.shutdown()
    },
  }
}
