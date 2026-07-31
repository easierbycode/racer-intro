// TikTok publishing via the official Content Posting API (Direct Post,
// FILE_UPLOAD). Needs a developer app with the Content Posting API product,
// a user access token carrying the video.publish scope, and — until the app
// passes TikTok's audit — posts are forced to SELF_ONLY visibility, so
// that's the default here.

const API = 'https://open.tiktokapis.com/v2'

export interface TikTokOptions {
  accessToken: string
  videoPath: string
  caption?: string
  privacy?:
    | 'SELF_ONLY'
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
  timeoutMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api(
  accessToken: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  const error = (json as { error?: { code?: string; message?: string } }).error
  if (!res.ok || (error && error.code !== 'ok')) {
    throw new Error(
      `TikTok API ${res.status} ${error?.code ?? ''}: ${error?.message ?? JSON.stringify(json)}`,
    )
  }
  return (json as { data?: Record<string, unknown> }).data ?? {}
}

export async function postVideo(
  opts: TikTokOptions,
): Promise<{ publishId: string; status: string }> {
  const stat = await Deno.stat(opts.videoPath)
  const size = stat.size

  // The creator query both validates the token and tells us which privacy
  // levels this account may use — unaudited apps only ever get SELF_ONLY.
  const creator = await api(opts.accessToken, '/post/publish/creator_info/query/')
  const allowed = (creator.privacy_level_options as string[] | undefined) ?? []
  const privacy = opts.privacy ?? 'SELF_ONLY'
  if (allowed.length && !allowed.includes(privacy)) {
    throw new Error(
      `privacy level ${privacy} not available for this account (allowed: ${allowed.join(', ')}) — ` +
        `unaudited apps can only post SELF_ONLY`,
    )
  }

  // Chunking rules from the media-transfer guide: a file up to 64MB may go
  // as one whole-file chunk, above that it's 10MB chunks with the final one
  // absorbing the remainder, and total_chunk_count is floor division.
  // Math.min matters: a fixed 10MB chunk_size on a 6MB file would declare a
  // chunk larger than the file (and floor(6/10) = 0 chunks), which the init
  // call rejects — exactly the size range a short reel lands in.
  const chunkSize = Math.min(size, 10 * 1024 * 1024)
  const chunkCount = Math.max(1, Math.floor(size / chunkSize))

  const init = await api(opts.accessToken, '/post/publish/video/init/', {
    post_info: {
      title: opts.caption ?? '',
      privacy_level: privacy,
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      is_aigc: false,
    },
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: size,
      chunk_size: chunkSize,
      total_chunk_count: chunkCount,
    },
  })
  const publishId = init.publish_id as string
  const uploadUrl = init.upload_url as string

  const file = await Deno.open(opts.videoPath, { read: true })
  try {
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize
      // The last chunk runs to end-of-file regardless of chunk size.
      const end = i === chunkCount - 1 ? size : Math.min(start + chunkSize, size)
      const buf = new Uint8Array(end - start)
      await file.seek(start, Deno.SeekMode.Start)
      let read = 0
      while (read < buf.length) {
        const n = await file.read(buf.subarray(read))
        if (n === null) break
        read += n
      }
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(buf.length),
          'content-range': `bytes ${start}-${end - 1}/${size}`,
        },
        body: buf,
      })
      if (!res.ok && res.status !== 201) {
        throw new Error(`chunk ${i + 1}/${chunkCount} upload failed: HTTP ${res.status}`)
      }
      console.log(`  uploaded chunk ${i + 1}/${chunkCount} (${end - start} bytes)`)
    }
  } finally {
    file.close()
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000)
  while (true) {
    const status = await api(opts.accessToken, '/post/publish/status/fetch/', {
      publish_id: publishId,
    })
    const code = status.status as string
    if (code === 'PUBLISH_COMPLETE') return { publishId, status: code }
    if (code === 'FAILED') {
      throw new Error(
        `TikTok publish failed: ${status.fail_reason ?? 'unknown reason'}`,
      )
    }
    if (Date.now() > deadline) {
      return { publishId, status: code ?? 'TIMED_OUT' }
    }
    await sleep(3000)
  }
}
