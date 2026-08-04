// CLI: deno task post --platform instagram --video out/racer-intro.reel.mp4
//      deno task post --platform tiktok    --video out/racer-intro.reel.mp4
//
// Credentials come from the environment, never flags:
//   Instagram: IG_ACCESS_TOKEN, IG_USER_ID  (optional IG_GRAPH_VERSION)
//   TikTok:    TIKTOK_ACCESS_TOKEN
//
// Instagram needs the files on a public URL — pass --video-url/--cover-url
// if they're already hosted, otherwise an ngrok tunnel is spun up around a
// throwaway local server for the duration of the ingest.

import { parseArgs } from '@std/cli/parse-args'
import { resolve, SEPARATOR } from '@std/path'
import { checkCredentials as checkIg, postReel } from './instagram.ts'
import { checkCredentials as checkTikTok, postVideo } from './tiktok.ts'
import { serveViaTunnel } from './tunnel.ts'

const args = parseArgs(Deno.args, {
  string: ['platform', 'video', 'cover', 'caption', 'video-url', 'cover-url', 'privacy'],
  boolean: ['help', 'dry-run', 'check'],
})

if (args.help || !args.platform) {
  console.log(`post — publish a transcoded clip to Instagram Reels / TikTok

Usage: deno task post --platform instagram|tiktok --video <reel.mp4> [options]
  --video <file>      the transcoded 9:16 mp4 (from deno task transcode)
  --cover <file>      cover JPEG (default: <video>.cover.jpg if it exists)
  --caption <text>    post caption
  --video-url <url>   (instagram) already-public video URL — skips the tunnel
  --cover-url <url>   (instagram) already-public cover URL
  --privacy <level>   (tiktok) SELF_ONLY (default) | PUBLIC_TO_EVERYONE | ...
  --check             verify the credentials against the API and exit
  --dry-run           validate everything, post nothing`)
  Deno.exit(args.help ? 0 : 1)
}

// Dry runs must work without credentials — resolve env lazily and only
// require it on the paths that actually call an API.
const need = (name: string): string => {
  const v = Deno.env.get(name)
  if (!v) {
    console.error(`missing env var ${name}`)
    Deno.exit(1)
  }
  return v
}

// Publishing sends a file to the public internet — through an ngrok tunnel
// for Instagram, or straight into a TikTok account. Confine every path to
// the recordings directory so a stray (or hostile) --video can't turn this
// into an exfiltration tool. RECORDINGS_DIR matches the app's override.
const OUT_DIR = resolve(Deno.env.get('RECORDINGS_DIR') ?? 'out')
const underOut = (p: string): string => {
  const abs = resolve(p)
  if (abs !== OUT_DIR && !abs.startsWith(OUT_DIR + SEPARATOR)) {
    console.error(`refusing ${p} — only files under ${OUT_DIR} may be published`)
    Deno.exit(1)
  }
  return abs
}

const platform = args.platform.toLowerCase()

// --check answers "do the secrets work?" on its own: no recording, no
// tunnel, no upload, no file arguments. An expired token, the wrong
// IG_USER_ID and a missing publish scope all fail here in a second instead
// of five minutes into a CI run that has already recorded a clip.
if (args.check) {
  try {
    if (platform === 'instagram') {
      const { username, quotaUsed, quotaTotal } = await checkIg({
        accessToken: need('IG_ACCESS_TOKEN'),
        igUserId: need('IG_USER_ID'),
      })
      const quota = quotaTotal === undefined
        ? 'publishing quota unavailable (is instagram_content_publish granted?)'
        : `${quotaUsed ?? 0}/${quotaTotal} posts used in the last 24h`
      console.log(`instagram ok: @${username} — ${quota}`)
    } else if (platform === 'tiktok') {
      const { nickname, privacyLevels } = await checkTikTok(need('TIKTOK_ACCESS_TOKEN'))
      const levels = privacyLevels.length ? privacyLevels.join(', ') : 'none reported'
      console.log(`tiktok ok: ${nickname ?? '(no nickname)'} — privacy levels: ${levels}`)
    } else {
      console.error(`unknown platform "${args.platform}" — use instagram or tiktok`)
      Deno.exit(1)
    }
  } catch (err) {
    console.error(`credential check failed: ${err instanceof Error ? err.message : err}`)
    Deno.exit(1)
  }
  Deno.exit(0)
}

if (platform === 'instagram') {
  let videoUrl = args['video-url']
  let coverUrl = args['cover-url']
  let tunnel: Awaited<ReturnType<typeof serveViaTunnel>> | undefined

  if (!videoUrl) {
    if (!args.video) {
      console.error('pass --video <file> (or --video-url <public url>)')
      Deno.exit(1)
    }
    const cover = args.cover ??
      (await Deno.stat(args.video.replace(/\.mp4$/, '.cover.jpg')).then(
        () => args.video!.replace(/\.mp4$/, '.cover.jpg'),
        () => undefined,
      ))
    if (args['dry-run']) {
      console.log(`[dry-run] would tunnel ${args.video}${cover ? ` + ${cover}` : ''} via ngrok and publish a Reel`)
      Deno.exit(0)
    }
    // Resolve creds before paying for the tunnel spin-up.
    need('IG_ACCESS_TOKEN')
    need('IG_USER_ID')
    const files: Record<string, string> = { 'video.mp4': underOut(args.video) }
    if (cover) files['cover.jpg'] = underOut(cover)
    tunnel = await serveViaTunnel(files)
    videoUrl = tunnel.urls['video.mp4']
    coverUrl = cover ? tunnel.urls['cover.jpg'] : undefined
  } else if (args['dry-run']) {
    console.log(`[dry-run] would publish a Reel from ${videoUrl}`)
    Deno.exit(0)
  }
  const creds = { accessToken: need('IG_ACCESS_TOKEN'), igUserId: need('IG_USER_ID') }

  try {
    console.log('publishing Reel...')
    const { mediaId, permalink } = await postReel(creds, {
      videoUrl,
      coverUrl,
      caption: args.caption,
    })
    console.log(`  published: media ${mediaId}${permalink ? ` — ${permalink}` : ''}`)
  } finally {
    await tunnel?.close()
  }
} else if (platform === 'tiktok') {
  if (!args.video) {
    console.error('pass --video <file>')
    Deno.exit(1)
  }
  const privacy = (args.privacy ?? 'SELF_ONLY') as
    | 'SELF_ONLY'
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
  if (args['dry-run']) {
    console.log(`[dry-run] would direct-post ${args.video} to TikTok as ${privacy}`)
    Deno.exit(0)
  }
  const accessToken = need('TIKTOK_ACCESS_TOKEN')
  console.log(`posting to TikTok (${privacy})...`)
  const { publishId, status } = await postVideo({
    accessToken,
    videoPath: underOut(args.video),
    caption: args.caption,
    privacy,
  })
  console.log(`  publish ${publishId}: ${status}`)
} else {
  console.error(`unknown platform "${args.platform}" — use instagram or tiktok`)
  Deno.exit(1)
}
