import { define } from '../../../utils.ts'
import { InvalidJobArgs, type JobAction, listJobs, startJob } from '../../../lib/jobs.ts'

const ACTIONS: JobAction[] = ['record', 'transcode', 'post', 'pipeline', 'slides']

export const handler = define.handlers({
  GET() {
    return Response.json(listJobs())
  },
  async POST(ctx) {
    let body: { action?: string; args?: Record<string, string> }
    try {
      body = await ctx.req.json()
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    const action = body.action as JobAction
    if (!ACTIONS.includes(action)) {
      return Response.json(
        { error: `action must be one of ${ACTIONS.join(', ')}` },
        { status: 400 },
      )
    }
    // Args are validated up front (see lib/jobs.ts) — a rejected value is a
    // 400, not a job that fails later in its log.
    const args = Object.fromEntries(
      Object.entries(body.args ?? {}).map(([k, v]) => [k, String(v)]),
    )
    try {
      return Response.json(startJob(action, args), { status: 201 })
    } catch (e) {
      if (e instanceof InvalidJobArgs) {
        return Response.json({ error: e.message }, { status: 400 })
      }
      throw e
    }
  },
})
