// PNG-sequence → Instagram/TikTok-ready reel, in a single encode.
//
// This is the encode half of the deterministic pipeline (see the encoding
// notes in tools/record/deterministic.ts): ffmpeg never touches a capture
// device, just its perfectly portable encoder — one command, identical
// bytes, on macOS / Linux / Windows x64 / Windows ARM64.

import { ffmpegBin, run } from '../lib/proc.ts'

export interface FramesEncodeOptions {
  framesDir: string
  /** Frame files are %05d.png starting at 0. */
  fps: number
  /** Source frame dimensions (from the recorder). */
  width: number
  height: number
  output: string
  /** 9:16 canvas, defaults 1080x1920. */
  targetW?: number
  targetH?: number
  fill?: 'pad' | 'blur'
  /** Pad color — the game's own background reads as intentional sky. */
  background?: string
  /**
   * Pixel-art two-stage scale: nearest-neighbor up to an integer multiple
   * that overshoots the target, then a gentle lanczos reduction. A direct
   * 640→1080 (1.6875x) lanczos would smear every hard pixel edge.
   */
  pixelArt?: boolean
}

export async function encodeFramesToReel(o: FramesEncodeOptions): Promise<void> {
  const tw = o.targetW ?? 1080
  const th = o.targetH ?? 1920
  const fill = o.fill ?? 'pad'
  const background = o.background ?? '0x05060f'
  const pixelArt = o.pixelArt ?? true

  // Sharp size: fit the source into the target canvas, even dimensions.
  const scale = Math.min(tw / o.width, th / o.height)
  const even = (n: number) => Math.round(n / 2) * 2
  const sharpW = even(o.width * scale)
  const sharpH = even(o.height * scale)

  let fit: string
  if (pixelArt) {
    // Integer overshoot factor: one clean neighbor multiple past the sharp
    // size (640x480 → 3x = 1920x1440 → lanczos down to 1080x810).
    const k = Math.ceil(sharpH / o.height) + 1
    fit = `scale=${o.width * k}:${o.height * k}:flags=neighbor,` +
      `scale=${sharpW}:${sharpH}:flags=lanczos`
  } else {
    fit = `scale=${sharpW}:${sharpH}:flags=lanczos`
  }

  const graph = fill === 'blur'
    ? `[0:v]split[bg][fg];` +
      `[bg]scale=${tw}:${th}:force_original_aspect_ratio=increase,` +
      `crop=${tw}:${th},gblur=sigma=28,eq=brightness=-0.15[bgb];` +
      `[fg]${fit}[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
    : `[0:v]${fit},` +
      `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${background},format=yuv420p[v]`

  await run([
    ffmpegBin(), '-y', '-hide_banner',
    '-framerate', String(o.fps),
    '-i', `${o.framesDir}/%05d.png`,
    // Silent stereo — Instagram ingests reels with an audio track present
    // far more reliably than without one.
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', graph,
    '-map', '[v]',
    '-map', '1:a',
    '-shortest',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    // Level 4.0 covers 1080x1920@30; 60fps needs 4.2.
    '-level', o.fps > 30 ? '4.2' : '4.0',
    '-preset', 'slow',
    '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M',
    // Fixed 2s GOP, no scene-cut keyframes — steady quality through the
    // fireball, and what Instagram's re-encode handles best.
    '-g', String(o.fps * 2), '-keyint_min', String(o.fps * 2), '-sc_threshold', '0',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    o.output,
  ])
}
