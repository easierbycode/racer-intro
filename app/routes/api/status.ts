import { define } from '../../utils.ts'
import { onDeploy } from '../../lib/jobs.ts'
import { SCENES } from '../../../tools/record/scenes.ts'

// One snapshot the panel reads at boot: where jobs will run and which
// credentials are wired up (presence only — values never leave the server).
export const handler = define.handlers({
  GET() {
    return Response.json({
      onDeploy: onDeploy(),
      scenes: Object.keys(SCENES),
      instagram: !!(Deno.env.get('IG_ACCESS_TOKEN') && Deno.env.get('IG_USER_ID')),
      tiktok: !!Deno.env.get('TIKTOK_ACCESS_TOKEN'),
      github: !!Deno.env.get('GITHUB_TOKEN'),
    })
  },
})
