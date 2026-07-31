// Turns a raw game capture into a vertical 9:16 clip that Instagram Reels
// and TikTok both accept: H.264 high@4.1, yuv420p, CFR, AAC audio track
// (Instagram rejects silent-video-only files), moov atom up front.

import { ffmpegBin, ffprobeJson, run } from '../lib/proc.ts'

export interface ReelOptions {
  input: string
  output: string
  /** Output canvas, defaults to 1080x1920 (Reels/TikTok native). */
  width?: number
  height?: number
  /**
   * How to fill the 9:16 canvas around a non-9:16 source:
   *  - 'blur': blown-up blurred copy of the video behind the sharp one
   *  - 'pad':  solid color bars
   */
  fill?: 'blur' | 'pad'
  /** Pad color for fill:'pad', as 0xRRGGBB hex string. */
  background?: string
  fps?: number
  /** Trim: seconds into the source to start, and/or clip length. */
  start?: number
  duration?: number
  /** x264 CRF — 18 is visually lossless for pixel art at this size. */
  crf?: number
}

/**
 * The scaler chain for pixel-art sources: nearest-neighbor 2x first so the
 * later lanczos fit works from clean doubled pixels instead of smearing
 * 1x art — at 640x480 the doubled frame already exceeds the 1080 target,
 * so the final pass only ever sharp-downscales.
 */
const FIT_SHARP =
  'scale=iw*2:ih*2:flags=neighbor,' +
  'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos'

function filterGraph(o: Required<Pick<ReelOptions, 'width' | 'height' | 'fill' | 'background' | 'fps'>>) {
  const fit = FIT_SHARP.replaceAll('{W}', String(o.width)).replaceAll('{H}', String(o.height))
  if (o.fill === 'blur') {
    return (
      `[0:v]split[bg][fg];` +
      `[bg]scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,` +
      `crop=${o.width}:${o.height},gblur=sigma=28,eq=brightness=-0.15[bgb];` +
      `[fg]${fit}[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${o.fps},format=yuv420p[v]`
    )
  }
  return (
    `[0:v]${fit},` +
    `pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2:color=${o.background},` +
    `fps=${o.fps},format=yuv420p[v]`
  )
}

export async function toReel(opts: ReelOptions): Promise<void> {
  // Callers pass explicit `undefined` for unset CLI flags — drop those so
  // they can't shadow the defaults in the spread below.
  const given = Object.fromEntries(
    Object.entries(opts).filter(([, v]) => v !== undefined),
  ) as ReelOptions
  const o = {
    width: 1080,
    height: 1920,
    fill: 'blur' as const,
    background: '0x07070d',
    fps: 30,
    crf: 18,
    ...given,
  }

  const probe = await ffprobeJson(o.input)
  const hasAudio = probe.streams.some((s) => s.codec_type === 'audio')

  const args = [ffmpegBin(), '-y', '-hide_banner']
  if (o.start != null) args.push('-ss', String(o.start))
  args.push('-i', o.input)
  // Instagram's ingest rejects videos without an audio stream, and the game
  // is silent — synthesize stereo silence and let -shortest end it with the
  // video.
  if (!hasAudio) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
  }
  if (o.duration != null) args.push('-t', String(o.duration))
  args.push(
    '-filter_complex', filterGraph(o),
    '-map', '[v]',
    '-map', hasAudio ? '0:a:0' : '1:a:0',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-preset', 'medium',
    '-crf', String(o.crf),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-shortest',
    o.output,
  )
  await run(args)
}

/** Grab a single frame as the Reels cover image (JPEG). */
export async function extractCover(
  video: string,
  output: string,
  atSeconds = 0,
): Promise<void> {
  await run([
    ffmpegBin(), '-y', '-hide_banner',
    '-ss', String(atSeconds),
    '-i', video,
    '-frames:v', '1',
    '-q:v', '2',
    output,
  ])
}
