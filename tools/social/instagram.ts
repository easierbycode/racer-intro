// Instagram Reels publishing via the official Graph API — the approach from
// pablo.gg's "Posting Instagram Reels Using Node.js and the Art of
// Overcoming Limitations": the API refuses direct uploads, accepting only a
// public URL it downloads from, so the flow is
//   create media container (video_url) → poll status → publish → permalink.
// Serving a local file publicly is the caller's problem — see tunnel.ts for
// the ngrok route, or host the file anywhere reachable (e.g. a raw
// GitHub URL on a recordings branch).

export interface IgCredentials {
  /** Long-lived Graph API access token with instagram_content_publish. */
  accessToken: string
  /** Instagram professional-account user id (not the username). */
  igUserId: string
  /** Graph API version segment. Overridable via IG_GRAPH_VERSION. */
  graphVersion?: string
}

export interface IgReelOptions {
  /** Publicly downloadable mp4 URL. */
  videoUrl: string
  /** Publicly downloadable JPEG cover URL. */
  coverUrl?: string
  caption?: string
  /** How long to wait for Instagram to ingest the video. */
  timeoutMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function graphBase(creds: IgCredentials): string {
  const v = creds.graphVersion ?? Deno.env.get('IG_GRAPH_VERSION') ?? 'v23.0'
  return `https://graph.facebook.com/${v}`
}

/**
 * Every call carries the access token in the Authorization header rather
 * than a query string: error messages here surface in the control panel's
 * job log, and a token pasted into a URL would land there verbatim.
 */
async function graphCall(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: number } }).error
    throw new Error(
      `Graph API ${res.status}: ${err?.message ?? JSON.stringify(body)}`,
    )
  }
  return body as Record<string, unknown>
}

export async function postReel(
  creds: IgCredentials,
  opts: IgReelOptions,
): Promise<{ mediaId: string; permalink?: string }> {
  const base = graphBase(creds)

  const container = new URLSearchParams({
    media_type: 'REELS',
    video_url: opts.videoUrl,
  })
  if (opts.coverUrl) container.set('cover_url', opts.coverUrl)
  if (opts.caption) container.set('caption', opts.caption)

  const { id: containerId } = await graphCall(
    `${base}/${creds.igUserId}/media`,
    creds.accessToken,
    { method: 'POST', body: container },
  ) as { id: string }

  // Instagram downloads + transcodes the video server-side; status_code
  // walks IN_PROGRESS → FINISHED (or ERROR/EXPIRED). Meta's guidance is to
  // poll about once a minute, so start slow-ish and back off rather than
  // hammering a rate-limited endpoint for the whole ingest.
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000)
  let wait = 5000
  while (true) {
    const { status_code } = await graphCall(
      `${base}/${containerId}?fields=status_code`,
      creds.accessToken,
    ) as { status_code: string }
    if (status_code === 'FINISHED') break
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Instagram media container ended in ${status_code}`)
    }
    if (Date.now() > deadline) {
      throw new Error('Instagram ingest timed out — is the video URL publicly reachable?')
    }
    await sleep(wait)
    wait = Math.min(wait * 1.5, 30_000)
  }

  const { id: mediaId } = await graphCall(
    `${base}/${creds.igUserId}/media_publish`,
    creds.accessToken,
    { method: 'POST', body: new URLSearchParams({ creation_id: containerId }) },
  ) as { id: string }

  let permalink: string | undefined
  try {
    const res = await graphCall(
      `${base}/${mediaId}?fields=permalink`,
      creds.accessToken,
    ) as { permalink?: string }
    permalink = res.permalink
  } catch {
    // The post exists even when the permalink lookup is denied; not fatal.
  }
  return { mediaId, permalink }
}
