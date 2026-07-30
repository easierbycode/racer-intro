import Phaser from 'phaser'
import { C, GAME_H, GAME_W } from './constants.js'

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER ART — and where to swap in the real sheets
 * ─────────────────────────────────────────────────────────────────────────────
 * Every texture the scene uses is generated here at runtime, so the scaffold
 * runs with zero binary assets. To upgrade to ripped sprites, load images
 * under the SAME KEYS in the <Scene> preload (see RacerIntro.svelte) — any
 * key that already exists is skipped here, so loaded art wins automatically.
 *
 *   'car'      → Turbo Out Run (Genesis), "Ferrari F40" rear-view frames
 *                spriters-resource.com/sega_genesis/turbooutrun/asset/36254/
 *   'truck'    → Turbo Out Run (Genesis), "Other Cars" (includes the semi)
 *                spriters-resource.com/sega_genesis/turbooutrun/asset/36255/
 *   'skyline'  → Rad Racer (NES), "Backgrounds" night skylines
 *   'skyline2'   spriters-resource.com/nes/radracer/asset/255082/
 *   'fireball' → still procedural; the crash burst in scene.js layers it
 *                additively. The Metal Slug rip is loaded as the 'explosion'
 *                atlas and already drives the wreck flames in stage.js —
 *                scene.js's rolling burst could move to it too.
 *                spriters-resource.com/neo_geo_ngcd/ms/asset/11301/
 *   'flames',
 *   'smoke'    → Metal Slug fire / smoke frames
 *
 * Those rips are copyrighted game art — personal / fan use only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Frame names from the atlas builder are double-hex-encoded and carry no
 * usable ordering, so every atlas here is read as a strip sorted by atlas x —
 * index 0 is the leftmost frame. (For 'car-rpm' that makes [full, empty].)
 */
export function framesByX(scene, key) {
  return scene.textures
    .get(key)
    .getFrameNames()
    .sort(
      (a, b) =>
        scene.textures.getFrame(key, a).cutX - scene.textures.getFrame(key, b).cutX
    )
}

/**
 * The ripped skyline strip ships with an opaque dark-navy sky baked in —
 * drawn as-is it reads as a rectangle floating over the gradient. This keys
 * the background color (sampled from the top-left pixel) out into a
 * transparent copy so the sky shows through between the buildings. No-op for
 * sources that already carry transparency (like the procedural placeholder).
 */
export function keyedSkyline(scene) {
  if (!scene.textures.exists('skyline')) return 'skyline'
  if (scene.textures.exists('skyline-cut')) return 'skyline-cut'
  const src = scene.textures.get('skyline').getSourceImage()
  const tex = scene.textures.createCanvas('skyline-cut', src.width, src.height)
  const ctx = tex.context
  ctx.drawImage(src, 0, 0)
  const img = ctx.getImageData(0, 0, src.width, src.height)
  const d = img.data
  if (d[3] === 0) {
    // already transparent — drop the copy, use the original
    scene.textures.remove('skyline-cut')
    return 'skyline'
  }
  const kr = d[0]
  const kg = d[1]
  const kb = d[2]
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - kr) < 8 &&
      Math.abs(d[i + 1] - kg) < 8 &&
      Math.abs(d[i + 2] - kb) < 8
    ) {
      d[i + 3] = 0
    }
  }
  ctx.putImageData(img, 0, 0)
  tex.refresh()
  return 'skyline-cut'
}

export const FONT_KEY = 'retro'

/**
 * Registers font.png as a bitmap font — 36 8x8 glyphs, A-Z then 0-9, which is
 * RetroFont.TEXT_SET3 exactly. Returns the cache key, or null when the sheet
 * isn't loaded so callers can fall back to a web-font Text.
 *
 * TEXT_SET3 carries a 37th character (space) that the sheet doesn't draw, and
 * Phaser drops a glyph it can't find WITHOUT advancing the cursor — 'PRESS
 * START' would render as 'PRESSSTART'. So the sheet is copied one cell wider
 * and the blank tail cell becomes the space, which then measures 8px like
 * every other character.
 */
export function buildRetroFont(scene) {
  if (!scene.textures.exists('font')) return null
  if (scene.cache.bitmapFont.exists(FONT_KEY)) return FONT_KEY

  const src = scene.textures.get('font').getSourceImage()
  if (!scene.textures.exists('font-spaced')) {
    const tex = scene.textures.createCanvas('font-spaced', src.width + 8, src.height)
    tex.context.drawImage(src, 0, 0)
    tex.refresh()
  }
  scene.cache.bitmapFont.add(
    FONT_KEY,
    Phaser.GameObjects.RetroFont.Parse(scene, {
      image: 'font-spaced',
      width: 8,
      height: 8,
      chars: Phaser.GameObjects.RetroFont.TEXT_SET3,
      charsPerRow: 37,
    })
  )
  return FONT_KEY
}

function canvasTex(scene, key, w, h, paint) {
  if (scene.textures.exists(key)) return
  const tex = scene.textures.createCanvas(key, w, h)
  paint(tex.context, w, h)
  tex.refresh()
}

function shapeTex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return
  const g = scene.add.graphics()
  draw(g)
  g.generateTexture(key, w, h)
  g.destroy()
}

export function buildTextures(scene) {
  // Racer sky — night gradient with a blue band at the horizon.
  canvasTex(scene, 'sky', GAME_W, GAME_H, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#04040c')
    grad.addColorStop(0.5, '#0e1740')
    grad.addColorStop(0.62, '#1b2f8a')
    grad.addColorStop(0.72, '#0a1030')
    grad.addColorStop(1, '#05060f')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  })

  // Stage sky — the fire glow behind the wreck. The bg-flames frames are
  // fully opaque with a #280808 smoke top, so the gradient is pinned to that
  // color where the fire wall's top edge sits (y ≈ 270 → stop 0.56) to hide
  // the seam.
  canvasTex(scene, 'stage-sky', GAME_W, GAME_H, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#0a0304')
    grad.addColorStop(0.4, '#1e0607')
    grad.addColorStop(0.56, '#280808')
    grad.addColorStop(0.75, '#571405')
    grad.addColorStop(1, '#230602')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  })

  // Distant skyline — dark towers, sparse lit windows. Tiles horizontally.
  shapeTex(scene, 'skyline', 512, 140, (g) => {
    let x = 0
    while (x < 512) {
      const bw = 18 + Math.floor(Math.random() * 26)
      const bh = 28 + Math.floor(Math.random() * 100)
      g.fillStyle(C.building, 1)
      g.fillRect(x, 140 - bh, bw, bh)
      g.fillStyle(C.buildingLit, 1)
      const cols = Math.max(1, Math.floor((bw - 6) / 7))
      for (let wx = 0; wx < cols; wx++) {
        for (let wy = 0; wy < Math.floor(bh / 10); wy++) {
          if (Math.random() < 0.4) {
            g.fillRect(x + 4 + wx * 7, 140 - bh + 4 + wy * 10, 3, 4)
          }
        }
      }
      x += bw + 2 + Math.floor(Math.random() * 8)
    }
  })

  // Nearer, darker skyline layer.
  shapeTex(scene, 'skyline2', 512, 90, (g) => {
    let x = 0
    while (x < 512) {
      const bw = 26 + Math.floor(Math.random() * 34)
      const bh = 22 + Math.floor(Math.random() * 62)
      g.fillStyle(0x080c22, 1)
      g.fillRect(x, 90 - bh, bw, bh)
      g.fillStyle(0xd8a83e, 1)
      for (let wx = 0; wx < Math.floor((bw - 6) / 9); wx++) {
        for (let wy = 0; wy < Math.floor(bh / 12); wy++) {
          if (Math.random() < 0.18) {
            g.fillRect(x + 4 + wx * 9, 90 - bh + 5 + wy * 12, 4, 5)
          }
        }
      }
      x += bw + 1 + Math.floor(Math.random() * 5)
    }
  })

  // Player car — green coupe, rear view.
  shapeTex(scene, 'car', 92, 54, (g) => {
    g.fillStyle(0x0a0a0e, 1) // tires
    g.fillRect(4, 34, 16, 18)
    g.fillRect(72, 34, 16, 18)
    g.fillStyle(0x116636, 1) // spoiler
    g.fillRect(8, 8, 76, 6)
    g.fillRect(12, 12, 4, 8)
    g.fillRect(76, 12, 4, 8)
    g.fillStyle(0x18813f, 1) // body shadow
    g.fillRoundedRect(2, 18, 88, 28, 7)
    g.fillStyle(0x1f9e4e, 1) // body
    g.fillRoundedRect(6, 16, 80, 24, 8)
    g.fillStyle(0x0c3320, 1) // cabin
    g.fillRoundedRect(18, 2, 56, 20, 6)
    g.fillStyle(0x274264, 1) // rear window
    g.fillRoundedRect(22, 5, 48, 12, 4)
    g.fillStyle(0x23252e, 1) // bumper
    g.fillRect(6, 40, 80, 8)
    g.fillStyle(0xff2a2a, 1) // taillights
    g.fillRect(9, 35, 15, 5)
    g.fillRect(68, 35, 15, 5)
    g.fillStyle(0xffd0a0, 1) // plate
    g.fillRect(42, 41, 9, 4)
  })

  // Semi truck, rear view — the thing we are about to meet.
  shapeTex(scene, 'truck', 110, 132, (g) => {
    g.fillStyle(0x08080c, 1) // wheels
    g.fillRect(6, 112, 20, 20)
    g.fillRect(84, 112, 20, 20)
    g.fillRect(32, 116, 14, 16)
    g.fillRect(64, 116, 14, 16)
    g.fillStyle(0x6f7888, 1) // box frame
    g.fillRect(2, 6, 106, 108)
    g.fillStyle(0x9aa4b4, 1) // doors
    g.fillRect(6, 10, 98, 96)
    g.lineStyle(2, 0x5c6474, 1)
    g.strokeRect(6, 10, 98, 96)
    g.lineBetween(55, 10, 55, 106)
    g.fillStyle(0x5c6474, 1) // handles
    g.fillRect(46, 56, 6, 16)
    g.fillRect(58, 56, 6, 16)
    g.fillStyle(0x3a4050, 1) // skirt
    g.fillRect(2, 106, 106, 10)
    g.fillStyle(0x14161d, 1) // mudflaps
    g.fillRect(8, 114, 22, 12)
    g.fillRect(80, 114, 22, 12)
    g.fillStyle(0xffb23e, 1) // marker lights
    for (const x of [10, 30, 50, 70, 90]) g.fillRect(x, 2, 6, 4)
    g.fillStyle(0xff3a2a, 1) // taillights
    g.fillRect(6, 108, 12, 5)
    g.fillRect(92, 108, 12, 5)
  })

  // Highway light pole (left-side version — right side is flipX'd).
  shapeTex(scene, 'pole', 34, 120, (g) => {
    g.fillStyle(0x4a5670, 1)
    g.fillRect(0, 6, 5, 114)
    g.fillRect(0, 6, 30, 4)
    g.fillStyle(0x39435a, 1)
    g.fillRect(0, 10, 5, 110)
    g.fillStyle(0xfff0b0, 1)
    g.fillRect(23, 10, 10, 5)
  })

  // Fireball blob — layered additively into a rolling explosion.
  canvasTex(scene, 'fireball', 128, 128, (ctx) => {
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62)
    grad.addColorStop(0, 'rgba(255,248,224,1)')
    grad.addColorStop(0.3, 'rgba(255,210,62,0.95)')
    grad.addColorStop(0.62, 'rgba(255,122,0,0.85)')
    grad.addColorStop(1, 'rgba(255,60,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(64, 64, 62, 0, Math.PI * 2)
    ctx.fill()
  })

  // Flame strip — tongues of fire, tileable horizontally (tileSprite layers).
  canvasTex(scene, 'flames', 256, 120, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    const tongue = (bx, bw, th) => {
      for (const ox of [-w, 0, w]) {
        const x = bx + ox
        const grad = ctx.createLinearGradient(0, h, 0, h - th)
        grad.addColorStop(0, 'rgba(255,122,0,0.95)')
        grad.addColorStop(0.55, 'rgba(255,196,0,0.8)')
        grad.addColorStop(1, 'rgba(255,244,200,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(x - bw / 2, h)
        ctx.quadraticCurveTo(x - bw * 0.45, h - th * 0.45, x, h - th)
        ctx.quadraticCurveTo(x + bw * 0.45, h - th * 0.45, x + bw / 2, h)
        ctx.closePath()
        ctx.fill()
      }
    }
    for (let i = 0; i < 16; i++) {
      tongue(Math.random() * w, 18 + Math.random() * 30, 40 + Math.random() * 75)
    }
  })

  // Smoke puff.
  canvasTex(scene, 'smoke', 96, 96, (ctx) => {
    const grad = ctx.createRadialGradient(48, 48, 6, 48, 48, 46)
    grad.addColorStop(0, 'rgba(150,150,160,0.55)')
    grad.addColorStop(1, 'rgba(120,120,130,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(48, 48, 46, 0, Math.PI * 2)
    ctx.fill()
  })

  // White TV blob — the CvS channel-switch mosaic.
  shapeTex(scene, 'blob', 64, 44, (g) => {
    g.fillStyle(0xf4f6ff, 1)
    g.fillRoundedRect(0, 0, 64, 44, 12)
  })

  // Rising ember dot.
  canvasTex(scene, 'ember', 16, 16, (ctx) => {
    const grad = ctx.createRadialGradient(8, 8, 1, 8, 8, 7)
    grad.addColorStop(0, 'rgba(255,220,150,1)')
    grad.addColorStop(1, 'rgba(255,140,40,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(8, 8, 7, 0, Math.PI * 2)
    ctx.fill()
  })
}
