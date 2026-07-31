// Job execution for the control-panel API.
//
// Two runners, chosen by where the app is running:
//  - locally, jobs spawn the repo's own Deno tool CLIs as subprocesses and
//    stream their output into an in-memory job log;
//  - on Deno Deploy (DENO_DEPLOY env is set) there is no ffmpeg/Chrome to
//    spawn, so jobs become workflow_dispatch calls against the repo's
//    record.yml GitHub Action instead (GITHUB_TOKEN + GITHUB_REPO env).
//
// SECURITY: every value here reaches a subprocess argv. There is no shell,
// but @std/cli's parseArgs honours `--flag=value` inside a single token, so
// an unvalidated value could smuggle in flags the API never exposes
// (--chrome runs an arbitrary binary; --output writes anywhere). Nothing is
// passed through: each field is matched against an allowlist, a number, or
// a bare out/ filename. Free text (captions) is the one exception and is
// only rejected for a leading '-'.

import { SCENES } from '../../tools/record/scenes.ts'
import { REPO_ROOT } from './out-dir.ts'

export type JobAction = 'record' | 'transcode' | 'post' | 'pipeline' | 'slides'

export interface Job {
  id: string
  action: JobAction
  args: Record<string, string>
  status: 'queued' | 'running' | 'done' | 'error'
  log: string[]
  createdAt: string
  endedAt?: string
}

const MAX_LOG_LINES = 400
const jobs = new Map<string, Job>()
let seq = 0

export const listJobs = (): Job[] =>
  [...jobs.values()].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))

export const getJob = (id: string): Job | undefined => jobs.get(id)

export const onDeploy = (): boolean => Deno.env.get('DENO_DEPLOY') != null

export class InvalidJobArgs extends Error {}

function push(job: Job, line: string) {
  job.log.push(line)
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES)
}

// ── argument validators ────────────────────────────────────────────────────

const bad = (msg: string): never => {
  throw new InvalidJobArgs(msg)
}

/** One of a fixed set, or the default when absent. */
function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if (value == null || value === '') return fallback
  if (!allowed.includes(value as T)) {
    bad(`${field} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

function num(
  value: string | undefined,
  { min, max, field }: { min: number; max: number; field: string },
): string | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    bad(`${field} must be a number between ${min} and ${max}`)
  }
  return String(n)
}

/**
 * A file the tools may read or write: a bare name inside out/, nothing else.
 * This is what keeps `--video` from publishing ~/.ssh/id_rsa through the
 * ngrok tunnel, and `--input` from transcoding arbitrary local media.
 */
function outFile(
  value: string | undefined,
  fallback: string | undefined,
  field: string,
): string | undefined {
  const v = value ?? fallback
  if (v == null || v === '') return undefined
  const name = v.startsWith('out/') ? v.slice(4) : v
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) {
    bad(`${field} must be a plain file name inside out/`)
  }
  return `out/${name}`
}

/** Free text (captions). Only a leading '-' is dangerous in argv. */
function text(value: string | undefined, field: string): string | undefined {
  if (value == null || value === '') return undefined
  if (value.startsWith('-')) bad(`${field} may not start with '-'`)
  if (value.length > 2200) bad(`${field} is too long`)
  return value
}

const PLATFORMS = ['instagram', 'tiktok'] as const
const PRIVACY = [
  'SELF_ONLY',
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
] as const
const MODES = ['deterministic', 'screencast'] as const

const sceneNames = () => Object.keys(SCENES)

function scene(value: string | undefined): string {
  const names = sceneNames()
  if (value == null || value === '') return names[0] ?? 'racer-intro'
  if (!names.includes(value)) bad(`unknown scene "${value}"`)
  return value
}

/** Comma list of platforms, e.g. "instagram,tiktok". */
function platformList(value: string | undefined): string | undefined {
  if (value == null || value === '') return undefined
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  for (const p of parts) {
    if (!PLATFORMS.includes(p as typeof PLATFORMS[number])) bad(`unknown platform "${p}"`)
  }
  return parts.length ? parts.join(',') : undefined
}

/**
 * Map a job to the CLI invocation it runs locally. Throws InvalidJobArgs on
 * anything that doesn't validate, so the route can answer 400.
 *
 * Note there is deliberately no `--url` passthrough: an arbitrary URL would
 * let a caller point headless Chrome at file:// or an internal address and
 * then download the rendered result from /api/outputs. The CLI keeps the
 * flag for local use; the HTTP surface only takes named scenes.
 */
export function cliFor(action: JobAction, a: Record<string, string>): string[] {
  const flag = (name: string, value?: string) => (value ? [`--${name}`, value] : [])
  switch (action) {
    case 'record':
      return [
        'tools/record/main.ts',
        '--scene', scene(a.scene),
        '--mode', oneOf(a.mode, MODES, 'deterministic', 'mode'),
        ...flag('fps', num(a.fps, { min: 1, max: 120, field: 'fps' })),
        ...flag('duration', num(a.duration, { min: 1, max: 300, field: 'duration' })),
      ]
    case 'transcode':
      return [
        'tools/transcode/main.ts',
        '--input', outFile(a.input, 'out/racer-intro.raw.mp4', 'input')!,
        ...flag('fill', oneOf(a.fill, ['blur', 'pad'] as const, 'blur', 'fill')),
      ]
    case 'post':
      return [
        'tools/social/main.ts',
        '--platform', oneOf(a.platform, PLATFORMS, 'instagram', 'platform'),
        '--video', outFile(a.video, 'out/racer-intro.reel.mp4', 'video')!,
        ...flag('caption', text(a.caption, 'caption')),
        ...flag('privacy', oneOf(a.privacy, PRIVACY, 'SELF_ONLY', 'privacy')),
        ...(a.dryRun === 'true' ? ['--dry-run'] : []),
      ]
    case 'pipeline':
      return [
        'tools/pipeline.ts',
        '--scene', scene(a.scene),
        '--mode', oneOf(a.mode, MODES, 'deterministic', 'mode'),
        ...flag('post', platformList(a.post)),
        ...flag('caption', text(a.caption, 'caption')),
        ...(a.dryRun === 'true' ? ['--dry-run'] : []),
      ]
    case 'slides':
      return [
        'tools/slides/main.ts',
        '--tutorial', outFile(a.tutorial, undefined, 'tutorial') ??
          bad('slides needs a tutorial JSON in out/'),
        ...flag('name', outFile(a.name, undefined, 'name')?.slice(4)),
      ]
  }
}

async function runLocal(job: Job, cli: string[]): Promise<void> {
  push(job, `$ deno run -A ${cli.join(' ')}`)
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', ...cli],
    cwd: REPO_ROOT,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()

  // Decode by hand rather than pipeThrough(TextDecoderStream): the app
  // compiles with the DOM lib, whose stream types don't line up with Deno's
  // byte streams here.
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const l of lines) if (l.trim()) push(job, l.trimEnd())
    }
    if (buf.trim()) push(job, buf.trimEnd())
  }

  const [status] = await Promise.all([
    child.status,
    pump(child.stdout),
    pump(child.stderr),
  ])
  job.status = status.success ? 'done' : 'error'
  if (!status.success) push(job, `exit code ${status.code}`)
}

async function runViaGitHub(job: Job): Promise<void> {
  const token = Deno.env.get('GITHUB_TOKEN')
  const repo = Deno.env.get('GITHUB_REPO') ?? 'easierbycode/racer-intro'
  if (!token) {
    throw new Error(
      'running on Deno Deploy without GITHUB_TOKEN — set a token with actions:write to dispatch the record workflow',
    )
  }
  // Only inputs declared in record.yml may be sent — GitHub 422s on any
  // extra key, which would fail every job.
  const inputs: Record<string, string> = {
    scene: scene(job.args.scene),
    'dry-run': job.args.dryRun === 'false' ? 'false' : 'true',
  }
  const post = platformList(job.args.post)
  if (post) inputs.post = post
  const caption = text(job.args.caption, 'caption')
  if (caption) inputs.caption = caption

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/record.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: Deno.env.get('GITHUB_REF_NAME') ?? 'main', inputs }),
    },
  )
  if (res.status !== 204) {
    throw new Error(`workflow dispatch failed: HTTP ${res.status} ${await res.text()}`)
  }
  push(job, `dispatched record.yml on ${repo} — watch https://github.com/${repo}/actions`)
  job.status = 'done'
}

/** Throws InvalidJobArgs if the args don't validate — nothing is started. */
export function startJob(action: JobAction, args: Record<string, string>): Job {
  // Validate before the job exists, so a bad request is a 400 rather than a
  // job that fails asynchronously.
  const deploy = onDeploy()
  const cli = deploy ? [] : cliFor(action, args)
  if (deploy) {
    scene(args.scene)
    platformList(args.post)
    text(args.caption, 'caption')
  }

  const job: Job = {
    id: String(++seq).padStart(4, '0'),
    action,
    args,
    status: 'running',
    log: [],
    createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)

  const run = deploy ? runViaGitHub(job) : runLocal(job, cli)
  run
    .catch((e) => {
      job.status = 'error'
      push(job, String(e instanceof Error ? e.message : e))
    })
    .finally(() => {
      job.endedAt = new Date().toISOString()
      if (job.status === 'running') job.status = 'done'
    })
  return job
}
