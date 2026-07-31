// Subprocess helpers shared by the record / transcode / social tools.
// Everything shells out through Deno.Command; ffmpeg/ffprobe resolve from
// the FFMPEG / FFPROBE env vars first, then PATH (covers Windows ARM64
// boxes pointing at a pinned community build, and anyone with a
// non-standard install).

export const ffmpegBin = (): string => Deno.env.get('FFMPEG') ?? 'ffmpeg'
export const ffprobeBin = (): string => Deno.env.get('FFPROBE') ?? 'ffprobe'

export class CommandError extends Error {
  constructor(
    readonly cmd: string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    // ffmpeg writes its useful diagnostics to stderr — keep the tail, the
    // head is mostly the build banner.
    const tail = stderr.split('\n').slice(-15).join('\n')
    super(`\`${cmd.join(' ')}\` exited ${code}\n${tail}`)
    this.name = 'CommandError'
  }
}

/** Run a command, inherit nothing, throw with stderr tail on failure. */
export async function run(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<void> {
  const { code, stderr } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'null',
    stdout: 'null',
    stderr: 'piped',
  }).output()
  if (code !== 0) {
    throw new CommandError(cmd, code, new TextDecoder().decode(stderr))
  }
}

/** Run a command and return trimmed stdout; throw on failure. */
export async function runCapture(
  cmd: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts.cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (code !== 0) {
    throw new CommandError(cmd, code, new TextDecoder().decode(stderr))
  }
  return new TextDecoder().decode(stdout).trim()
}

/** ffprobe a media file into its JSON description (format + streams). */
export async function ffprobeJson(path: string): Promise<{
  format: { duration?: string; size?: string; format_name?: string }
  streams: Array<{
    codec_type: string
    codec_name?: string
    width?: number
    height?: number
    avg_frame_rate?: string
    pix_fmt?: string
  }>
}> {
  const out = await runCapture([
    ffprobeBin(),
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    path,
  ])
  return JSON.parse(out)
}

/** True if `bin` resolves on PATH (used for friendly preflight errors). */
export async function binAvailable(bin: string): Promise<boolean> {
  try {
    await new Deno.Command(bin, {
      args: ['-version'],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    }).output()
    return true
  } catch {
    return false
  }
}
