import { define } from '../../../utils.ts'
import { getJob } from '../../../lib/jobs.ts'

export const handler = define.handlers({
  GET(ctx) {
    const job = getJob(ctx.params.id)
    return job
      ? Response.json(job)
      : Response.json({ error: 'no such job' }, { status: 404 })
  },
})
