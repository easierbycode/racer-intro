// Muxes the screencast frame dump into a real-time-accurate mp4.
//
// CDP screencast frames arrive at whatever cadence the compositor produced
// them, each stamped with an epoch-seconds timestamp. ffmpeg's concat
// demuxer can't express those gaps faithfully (it quantizes to a 1/25
// timebase, collapsing bursts), so instead the frames are resampled onto a
// constant-fps timeline here — each output tick shows the newest captured
// frame at that instant — and streamed to ffmpeg as one JPEG/PNG pipe.
// Constant frame rate also happens to be what Instagram/TikTok ingest best.

import { join } from '@std/path'
import { CommandError, ffmpegBin } from '../lib/proc.ts'

export interface CapturedFrame {
  /** File name inside the frames dir (frame-000042.jpg). */
  file: string
  /** CDP metadata.timestamp — seconds since epoch. */
  timestamp: number
}

export async function muxFrames(opts: {
  framesDir: string
  frames: CapturedFrame[]
  output: string
  /** Output timeline rate. 60 matches the game's animation cadence. */
  fps?: number
}): Promise<void> {
  const { framesDir, frames, output } = opts
  const fps = opts.fps ?? 60
  if (frames.length < 2) {
    throw new Error(`only ${frames.length} frame(s) captured — nothing to encode`)
  }

  const t0 = frames[0].timestamp
  const tEnd = frames[frames.length - 1].timestamp
  const ticks = Math.max(Math.ceil((tEnd - t0) * fps), 1)

  const cmd = new Deno.Command(ffmpegBin(), {
    args: [
      '-y', '-hide_banner',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-i', '-',
      '-c:v', 'libx264',
      '-preset', 'medium',
      // Near-lossless intermediate: this file feeds the transcode step, so
      // keep generational loss out of it.
      '-crf', '14',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'piped',
  })
  const child = cmd.spawn()
  const stderrPromise = new Response(child.stderr).text()

  const writer = child.stdin.getWriter()
  try {
    // Walk the capture once while emitting ticks — both are time-ordered.
    let idx = 0
    let bytes: Uint8Array | null = null
    let bytesIdx = -1
    for (let tick = 0; tick < ticks; tick++) {
      const t = t0 + tick / fps
      while (idx + 1 < frames.length && frames[idx + 1].timestamp <= t) idx++
      if (bytesIdx !== idx) {
        bytes = await Deno.readFile(join(framesDir, frames[idx].file))
        bytesIdx = idx
      }
      await writer.write(bytes!)
    }
  } finally {
    await writer.close().catch(() => {})
  }

  const status = await child.status
  if (!status.success) {
    throw new CommandError(['ffmpeg', 'image2pipe'], status.code, await stderrPromise)
  }
}
