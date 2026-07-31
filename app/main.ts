import { App, staticFiles } from 'fresh'
import type { State } from './utils.ts'

export const app = new App<State>()

app.use(staticFiles())

// Shared-secret gate for the whole API. Reads matter as much as writes here:
// job logs quote tool output and /api/outputs streams recordings, so leaving
// GET open would publish both to anyone who finds the URL.
//
// APP_TOKEN is REQUIRED on Deno Deploy (the app is internet-facing there);
// locally it stays optional so `deno task dev` needs no setup. Accepted
// either as a bearer header or an `app_token` cookie, so the panel's own
// fetches work without CORS preflight.
//
// Cross-origin POSTs are refused outright: the credentials that publish to
// Instagram/TikTok live on this server, so a drive-by form post from another
// page must not be able to spend them.
app.use(async (ctx) => {
  const url = new URL(ctx.req.url)
  if (!url.pathname.startsWith('/api/')) return await ctx.next()

  const token = Deno.env.get('APP_TOKEN')
  if (!token && Deno.env.get('DENO_DEPLOY') != null) {
    return Response.json(
      { error: 'APP_TOKEN is not configured on this deployment — the API is disabled' },
      { status: 503 },
    )
  }

  if (ctx.req.method !== 'GET') {
    const origin = ctx.req.headers.get('origin')
    if (origin && origin !== url.origin) {
      return Response.json({ error: 'cross-origin request refused' }, { status: 403 })
    }
  }

  if (token) {
    const cookie = ctx.req.headers.get('cookie') ?? ''
    const fromCookie = /(?:^|;\s*)app_token=([^;]+)/.exec(cookie)?.[1]
    const presented = ctx.req.headers.get('authorization') === `Bearer ${token}` ||
      (fromCookie != null && decodeURIComponent(fromCookie) === token)
    if (!presented) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  return await ctx.next()
})

app.fsRoutes()
