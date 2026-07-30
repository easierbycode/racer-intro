import Phaser from 'phaser'
import { C, GAME_H, GAME_W, UI } from './constants.js'
import { framesByX, keyedSkyline } from './textures.js'

/**
 * The burning "Expressway" set — built once, kept hidden until the white
 * flash reveals it. Returns { root, update } so the scene can drive the
 * fire flicker.
 *
 * SWAP POINT: everything here is placeholder shapes. With ripped art you
 * would replace the flame tileSprites with Metal Slug fire anims, and the
 * wreck graphics with the Turbo Out Run truck sprite (tinted dark, tipped
 * over) — the composition and layer order can stay as-is.
 */
export function buildStage(scene) {
  const root = scene.add.container(0, 0).setDepth(100).setVisible(false)
  const add = (child) => {
    root.add(child)
    return child
  }

  /*
   * Ryu is the scale reference for the set — he's the one figure with a known
   * real-world size, so the wreck is measured against him rather than against
   * the canvas. (The numbers hold even without the atlas loaded; he just isn't
   * drawn.) The wreck then sits back down the expressway instead of filling
   * the foreground: roughly two Ryus wide, parked high on the road so he reads
   * clearly in front of it.
   */
  const RYU = { x: 150, y: 476, scale: 2.5, frameW: 43 }
  const RYU_W = RYU.frameW * RYU.scale
  const WRECK_NATURAL_W = 338 // trailer's left edge (-134) to the cab's (204)
  const WRECK = { x: 404, y: 380, scale: (RYU_W * 2) / WRECK_NATURAL_W }

  // Sky glow + city silhouette behind the fire. The silhouette reuses the
  // 'skyline' texture, which may be the ripped 64px strip (drawn 2x) or the
  // 140px placeholder — size accordingly rather than tiling vertically.
  add(scene.add.image(0, 0, 'stage-sky').setOrigin(0))
  {
    const key = keyedSkyline(scene) // background color keyed to transparent
    const src = scene.textures.get(key).getSourceImage()
    const tileScale = src.height < 100 ? 2 : 1
    const sil = scene.add
      .tileSprite(0, 310, GAME_W, src.height * tileScale, key)
      .setOrigin(0, 1)
      .setTint(0x553322)
    sil.setTileScale(tileScale)
    add(sil)
  }

  // Fire wall — the bg-flames atlas (8 frames, sorted by atlas x) when it's
  // loaded; procedural tileSprites as the no-asset fallback. The frames are
  // fully opaque with a #280808 smoke top, so the stage-sky gradient is
  // pinned to that color at the wall's top edge (see textures.js).
  const flames = [] // procedural fallback layers
  const flameLayer = (y, h, alpha, speed) => {
    const f = scene.add
      .tileSprite(0, y, GAME_W, h, 'flames')
      .setOrigin(0, 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(alpha)
    f.flickerBase = alpha
    f.driftSpeed = speed
    flames.push(f)
    return f
  }
  const hasFlamesAtlas = scene.textures.exists('bg-flames')
  if (hasFlamesAtlas && !scene.anims.exists('bg-flames-burn')) {
    scene.anims.create({
      key: 'bg-flames-burn',
      // The strip's last frame is dropped — it doesn't loop back into the
      // first cleanly, and on a -1 repeat that shows up as a hitch every cycle.
      frames: framesByX(scene, 'bg-flames')
        .slice(0, -1)
        .map((frame) => ({ key: 'bg-flames', frame })),
      frameRate: 10,
      repeat: -1,
    })
  }
  if (hasFlamesAtlas) {
    // Back wall — five 128px columns cover the stage exactly, desynced so
    // the wall doesn't burn in lockstep.
    for (let col = 0; col < 5; col++) {
      const f = scene.add.sprite(col * 128, 430, 'bg-flames').setOrigin(0, 1)
      f.play('bg-flames-burn')
      f.anims.setProgress((col * 0.37) % 1)
      add(f)
    }
  } else {
    add(flameLayer(430, 190, 0.95, 0.014))
    add(flameLayer(415, 120, 0.7, -0.022))
  }

  /*
   * Directional flame glow — after the explosion every solid item carries a
   * flickering yellow glow on whichever side faces the fire (the burning
   * trailer). Rather than a gradient strip — which dies in a hard straight
   * edge — each item gets a stack of additive, tint-filled copies of itself
   * stepped toward the light: the item then covers everything but a contour
   * that hugs its silhouette exactly, fading with each step.
   */
  const LIGHT_X = 360 // brightest point of the wreck fire
  const glows = []
  const glowEcho = (makeCopy, cx, opts = {}) => {
    const { steps = 5, gap = 2.4, alpha = 0.55, tint = 0xffc03e } = opts
    const dir = cx < LIGHT_X ? 1 : -1 // spill toward the fire
    for (let i = steps; i >= 1; i--) {
      const g = makeCopy() // added beneath the item (call order = paint order)
      g.setTint(tint).setTintMode(Phaser.TintModes.FILL) // Phaser 4 tint-fill
      g.setBlendMode(Phaser.BlendModes.ADD)
      g.x += dir * gap * i
      g.glowBase = alpha * (1 - (i - 1) / steps)
      g.glowSeed = Math.random() * Math.PI * 2
      glows.push(g)
    }
  }
  // Bakes a stage prop into a texture so glowEcho can stamp copies of it.
  const shape = (key, w, h, draw) => {
    if (scene.textures.exists(key)) return key
    const g = scene.add.graphics()
    draw(g)
    g.generateTexture(key, w, h)
    g.destroy()
    return key
  }

  // Rising embers.
  for (let i = 0; i < 14; i++) {
    const e = add(
      scene.add
        .image(40 + Math.random() * 560, 320 + Math.random() * 120, 'ember')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.5 + Math.random() * 0.8)
    )
    scene.tweens.add({
      targets: e,
      y: 120 + Math.random() * 80,
      x: e.x + (Math.random() * 90 - 45),
      alpha: { from: 0.9, to: 0 },
      duration: 1900 + Math.random() * 1700,
      delay: Math.random() * 2200,
      repeat: -1,
      onRepeat: () => {
        e.x = 40 + Math.random() * 560
        e.y = 320 + Math.random() * 120
      },
    })
  }

  // Overhead sign gantry — 事故渋滞発生中 ("accident congestion ahead").
  // The legs are baked textures so they can carry silhouette glows.
  shape('stage-leg', 14, 220, (g) => {
    g.fillStyle(0x10141c, 1)
    g.fillRect(0, 0, 14, 220)
    g.fillStyle(0x181d28, 1)
    g.fillRect(0, 0, 4, 220)
  })
  for (const legX of [96, 530]) {
    glowEcho(
      () => add(scene.add.image(legX, 96, 'stage-leg').setOrigin(0)),
      legX + 7,
      { steps: 5, gap: 2, alpha: 0.4 }
    )
    add(scene.add.image(legX, 96, 'stage-leg').setOrigin(0))
  }
  const gantry = scene.add.graphics()
  gantry.fillStyle(0x181d28, 1)
  gantry.fillRect(88, 96, 464, 10) // truss
  gantry.fillRect(88, 140, 464, 8)
  gantry.lineStyle(2, 0x232a3a, 1)
  for (let x = 96; x < 544; x += 32) gantry.lineBetween(x, 104, x + 32, 140) // lattice
  gantry.fillStyle(0x0f2418, 1) // main board
  gantry.fillRect(216, 100, 208, 44)
  gantry.lineStyle(2, 0x2a4a34, 1)
  gantry.strokeRect(216, 100, 208, 44)
  gantry.fillStyle(0x101418, 1) // side boards
  gantry.fillRect(126, 104, 66, 36)
  gantry.fillRect(448, 104, 66, 36)
  add(gantry)
  add(
    scene.add
      .text(320, 122, '事故渋滞発生中', {
        fontFamily: UI.cjkFont,
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#ffd23e',
      })
      .setOrigin(0.5)
  )
  for (const x of [159, 481]) {
    add(
      scene.add
        .text(x, 122, '渋滞\n2km', {
          fontFamily: UI.cjkFont,
          fontSize: '11px',
          color: '#7ee08a',
          align: 'center',
          lineSpacing: -2,
        })
        .setOrigin(0.5)
    )
  }

  // Foreground road.
  const roadFg = scene.add.graphics()
  roadFg.fillStyle(0x14161f, 1)
  roadFg.fillRect(0, 398, GAME_W, 82)
  roadFg.fillStyle(0x232939, 1)
  roadFg.fillRect(0, 398, GAME_W, 4)
  roadFg.fillStyle(0x3a4152, 0.5)
  roadFg.fillRect(0, 444, GAME_W, 3)
  add(roadFg)

  // Wrecked black car, left of the fire → its right side catches the light.
  shape('stage-wreck-car', 132, 54, (g) => {
    g.fillStyle(0x0e1016, 1)
    g.fillRoundedRect(0, 18, 132, 34, 8)
    g.fillStyle(0x151a24, 1)
    g.fillRoundedRect(18, 0, 86, 26, 8)
    g.fillStyle(0x060608, 1)
    g.fillRect(4, 44, 24, 10)
    g.fillRect(102, 44, 24, 10)
    g.fillStyle(0xff3a2a, 1)
    g.fillRect(116, 26, 10, 6)
    g.fillStyle(0xffb23e, 1)
    g.fillRect(104, 26, 8, 6)
  })
  glowEcho(
    () => add(scene.add.image(48, 396, 'stage-wreck-car').setOrigin(0)),
    114,
    { alpha: 0.75, gap: 1.6 }
  )
  add(scene.add.image(48, 396, 'stage-wreck-car').setOrigin(0))

  // The tipped trailer, back down the road (see WRECK above).
  const wreck = scene.add
    .container(WRECK.x, WRECK.y)
    .setAngle(-9)
    .setScale(WRECK.scale)
  const trailer = scene.add.graphics()
  trailer.fillStyle(0x525c6e, 1) // underside edge
  trailer.fillRect(-134, 24, 268, 18)
  trailer.fillStyle(0x7d8698, 1) // box
  trailer.fillRect(-134, -62, 268, 88)
  trailer.lineStyle(2, 0x5c6474, 1)
  trailer.strokeRect(-134, -62, 268, 88)
  for (const x of [-70, -4, 62]) trailer.lineBetween(x, -60, x, 24) // panel seams
  trailer.fillStyle(0x08080c, 1) // wheels, kicked up
  trailer.fillCircle(-92, 40, 17)
  trailer.fillCircle(-52, 42, 17)
  trailer.fillCircle(64, 44, 17)
  trailer.fillStyle(0x2c3038, 1)
  trailer.fillCircle(-92, 40, 7)
  trailer.fillCircle(-52, 42, 7)
  trailer.fillCircle(64, 44, 7)
  wreck.add(trailer)
  // Cab — right of the flames, so its left side catches the light.
  shape('stage-cab', 66, 52, (g) => {
    g.fillStyle(0x3c4658, 1)
    g.fillRoundedRect(0, 0, 66, 52, 6)
    g.fillStyle(0x1a2436, 1)
    g.fillRect(8, 8, 26, 18)
  })
  const addToWreck = (img) => {
    wreck.add(img)
    return img
  }
  glowEcho(
    () => addToWreck(scene.add.image(138, -20, 'stage-cab').setOrigin(0)),
    WRECK.x + 171 * WRECK.scale, // cab centre in stage space, right of LIGHT_X
    { alpha: 0.5, gap: 2.2 }
  )
  addToWreck(scene.add.image(138, -20, 'stage-cab').setOrigin(0))

  // Flames licking the wreck — the Metal Slug burst (12 frames, sorted by
  // atlas x) looped at each point, with the procedural fireball blob as the
  // no-asset fallback. The `s` values are tuned against the 128px blob, so the
  // 54px atlas frames scale up by the ratio of the two to keep the footprint.
  const hasBoomAtlas = scene.textures.exists('explosion')
  let BOOM_SCALE = 1
  if (hasBoomAtlas) {
    const boomFrames = framesByX(scene, 'explosion')
    if (!scene.anims.exists('explosion-burn')) {
      scene.anims.create({
        key: 'explosion-burn',
        frames: boomFrames.map((frame) => ({ key: 'explosion', frame })),
        frameRate: 14,
        repeat: -1,
      })
    }
    BOOM_SCALE = 128 / scene.textures.getFrame('explosion', boomFrames[0]).width
  }
  /*
   * Arrangement — wreck-local coordinates, so these ride the container's
   * scale. `back: true` parents the flame beneath the trailer graphic instead
   * of above it, so the box occludes its base and the fire reads as wrapped
   * around the wreck rather than stickered onto it. The run walks the trailer
   * from its far end up over the cab, peaking at the middle.
   */
  const WRECK_FLAMES = [
    { x: -118, y: -44, s: 0.58, back: true },
    { x: -74, y: -72, s: 0.72, back: false },
    { x: -18, y: -52, s: 0.54, back: true },
    { x: 26, y: -86, s: 0.95, back: false },
    { x: 92, y: -36, s: 0.66, back: false },
    { x: 150, y: -48, s: 0.5, back: true },
    { x: 190, y: -20, s: 0.44, back: false },
  ]
  WRECK_FLAMES.forEach(({ x: fx, y: fy, s, back }, i) => {
    // Two passes. The fire body stays on normal blend — these frames carry
    // real alpha (hard-edged, no partials), and ADD clips them to white
    // against the trailer's light panels. The heat glow behind it is the
    // additive pass: same art, scaled up and faint, so the light spills onto
    // the trailer and road without touching the fire's own crispness.
    const layer = (blend, mul, alpha) => {
      const fl = hasBoomAtlas
        ? scene.add.sprite(fx, fy, 'explosion').setScale(s * BOOM_SCALE * mul)
        : scene.add.image(fx, fy, 'fireball').setScale(s * mul)
      fl.setBlendMode(blend).setAlpha(alpha)
      // Mirroring alternate flames keeps a seven-strong run of the same loop
      // from reading as one repeated sprite.
      fl.setFlipX(i % 2 === 1)
      if (hasBoomAtlas) {
        fl.play('explosion-burn')
        // Desynced start + a slightly different burn rate each, so they don't
        // pulse in unison.
        fl.anims.setProgress((i * 0.29) % 1)
        fl.anims.timeScale = 0.82 + (i % 4) * 0.11
      }
      // addAt(0) drops the flame to the bottom of the container, under the
      // trailer graphic; add() puts it on top of everything so far.
      if (back) wreck.addAt(fl, 0)
      else wreck.add(fl)
      return fl
    }
    const fire = layer(Phaser.BlendModes.NORMAL, 1, 1)
    const glow = layer(Phaser.BlendModes.ADD, 1.6, 0.26)
    wreck.moveBelow(glow, fire) // the glow is a backing light, never in front
    if (hasBoomAtlas) return

    // Procedural fallback: the blob has no animation, so it needs the pulse.
    for (const fl of [fire, glow]) {
      scene.tweens.add({
        targets: fl,
        scale: fl.scale * 1.45,
        alpha: { from: fl.alpha, to: fl.alpha * 0.75 },
        duration: 320 + Math.random() * 220,
        yoyo: true,
        repeat: -1,
      })
    }
  })

  add(wreck)

  // Smoke drifting off the wreck — anchored to it, so it follows when the
  // wreck is repositioned.
  const SMOKE_Y = WRECK.y - 56
  for (let i = 0; i < 5; i++) {
    const sm = add(scene.add.image(WRECK.x, SMOKE_Y, 'smoke').setAlpha(0))
    scene.tweens.add({
      targets: sm,
      y: 150,
      alpha: { from: 0.5, to: 0 },
      scale: { from: 0.6, to: 1.7 },
      duration: 2400,
      delay: i * 480,
      repeat: -1,
      onRepeat: () => {
        sm.x = WRECK.x - 70 + Math.random() * 140
        sm.y = SMOKE_Y
      },
    })
  }

  // Foreground tire, dead center like the recording — but it doesn't start
  // there. launchTire() (scene.js fires it at the stage reveal) pops it off
  // the trailer's kicked-up wheels; it arcs down the road at the camera,
  // growing as it closes, bounces out its energy and thumps to rest. Every
  // ground impact bumps the camera, scaled to how hard it lands. The glow
  // echoes are re-aimed each frame so the lit arc keeps facing the fire.
  shape('stage-tire', 66, 66, (g) => {
    g.fillStyle(0x0b0b10, 1)
    g.fillCircle(33, 33, 31)
    g.fillStyle(0x23272f, 1)
    g.fillCircle(33, 33, 13)
    g.fillStyle(0x0b0b10, 1)
    g.fillCircle(33, 33, 6)
  })
  const TIRE = {
    start: { x: 350, y: 408, scale: 0.45 }, // at the trailer's rear wheels
    rest: { x: 414, y: 452, scale: 1 }, //    dead center foreground
    launch: { vx: 55, vy: -300 }, //          px/s kick off the wreck
    gravity: 820, //                          px/s²
    restitution: 0.45, //  bounce keeps this much of the impact speed
    settleSpeed: 55, //    impact speed below which it stops bouncing
  }
  const TIRE_ECHO = { steps: 4, gap: 1.4, alpha: 0.65 }
  const tireEchoes = []
  for (let i = TIRE_ECHO.steps; i >= 1; i--) {
    const e = scene.add
      .image(TIRE.rest.x, TIRE.rest.y, 'stage-tire')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false)
    e.setTint(0xffc03e).setTintMode(Phaser.TintModes.FILL)
    e.glowBase = TIRE_ECHO.alpha * (1 - (i - 1) / TIRE_ECHO.steps)
    e.glowSeed = Math.random() * Math.PI * 2
    e.echoStep = i
    glows.push(e)
    tireEchoes.push(e)
    add(e)
  }
  const tire = add(
    scene.add.image(TIRE.rest.x, TIRE.rest.y, 'stage-tire').setVisible(false)
  )
  const tireState = { mode: 'idle', delay: 0, vx: 0, vy: 0 }

  function launchTire(delayMs = 0) {
    tireState.mode = 'wait'
    tireState.delay = delayMs
    tire
      .setVisible(false)
      .setPosition(TIRE.start.x, TIRE.start.y)
      .setScale(TIRE.start.scale)
    for (const e of tireEchoes) e.setVisible(false)
  }

  function updateTire(dt) {
    if (tireState.mode === 'idle') return
    if (tireState.mode === 'wait') {
      tireState.delay -= dt * 1000
      if (tireState.delay > 0) return
      tireState.mode = 'fly'
      tireState.vx = TIRE.launch.vx
      tireState.vy = TIRE.launch.vy
      tire.setVisible(true)
      scene.cameras.main.shake(150, 0.004) // the crack that frees the wheel
    }
    if (tireState.mode === 'fly') {
      // Progress toward the camera is read off horizontal travel: it slides
      // the floor line down the screen and the tire's scale up in lockstep,
      // which is what sells the approach.
      tireState.vy += TIRE.gravity * dt
      tire.x += tireState.vx * dt
      tire.y += tireState.vy * dt
      const p = Phaser.Math.Clamp(
        (tire.x - TIRE.start.x) / (TIRE.rest.x - TIRE.start.x),
        0,
        1
      )
      const floorY = Phaser.Math.Linear(TIRE.start.y, TIRE.rest.y, p)
      tire.setScale(Phaser.Math.Linear(TIRE.start.scale, TIRE.rest.scale, p))
      if (tireState.vy > 0 && tire.y >= floorY) {
        tire.y = floorY
        scene.cameras.main.shake( // impact kick, scaled to landing speed
          Math.min(260, 90 + tireState.vy * 0.4),
          Math.min(0.011, tireState.vy * 0.00003)
        )
        if (tireState.vy < TIRE.settleSpeed) {
          tireState.mode = 'settle'
        } else {
          tireState.vy *= -TIRE.restitution
          tireState.vx *= 0.6
        }
      }
    } else if (tireState.mode === 'settle') {
      // Ease the last few px into the resting spot the composition expects.
      const k = Math.min(1, dt * 6)
      tire.x += (TIRE.rest.x - tire.x) * k
      tire.y += (TIRE.rest.y - tire.y) * k
      tire.setScale(tire.scaleX + (TIRE.rest.scale - tire.scaleX) * k)
      if (Math.abs(tire.x - TIRE.rest.x) < 0.4) {
        tire.setPosition(TIRE.rest.x, TIRE.rest.y).setScale(TIRE.rest.scale)
        tireState.mode = 'idle'
      }
    }
    const dir = tire.x < LIGHT_X ? 1 : -1 // lit arc faces the fire
    for (const e of tireEchoes) {
      e.setVisible(tire.visible)
        .setPosition(
          tire.x + dir * TIRE_ECHO.gap * e.echoStep * tire.scaleX,
          tire.y
        )
        .setScale(tire.scaleX)
    }
  }

  // Small flame layer in front, for depth. Additive blend swallows the
  // atlas frames' opaque smoke top, so only the fire itself reads.
  if (hasFlamesAtlas) {
    for (let col = 0; col < 6; col++) {
      const f = scene.add
        .sprite(col * 128 - 40, 490, 'bg-flames')
        .setOrigin(0, 1)
        .setScale(1, 0.3)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.38)
      f.play('bg-flames-burn')
      f.anims.setProgress((col * 0.61) % 1)
      add(f)
    }
  } else {
    add(flameLayer(478, 70, 0.4, 0.03))
  }

  // Ryu — the left-side fighter, idling in front of the wreckage like the
  // original's pre-fight hold. He stands left of the fire, so his silhouette
  // echoes step right; they re-sync to the idle animation every frame.
  let ryu = null
  const ryuEchoes = []
  if (scene.textures.exists('ryu')) {
    const ryuFrames = framesByX(scene, 'ryu')
    if (!scene.anims.exists('ryu-idle')) {
      scene.anims.create({
        key: 'ryu-idle',
        frames: ryuFrames.slice(0, 4).map((frame) => ({ key: 'ryu', frame })),
        frameRate: 6,
        repeat: -1,
      })
    }
    const RYU_X = RYU.x
    const RYU_Y = RYU.y
    const RYU_SCALE = RYU.scale
    for (let i = 5; i >= 1; i--) {
      const e = scene.add
        .sprite(RYU_X + 2.4 * i, RYU_Y, 'ryu', ryuFrames[0])
        .setOrigin(0.5, 1)
        .setScale(RYU_SCALE)
        .setBlendMode(Phaser.BlendModes.ADD)
      e.setTint(0xffc03e).setTintMode(Phaser.TintModes.FILL)
      e.glowBase = 0.45 * (1 - (i - 1) / 5)
      e.glowSeed = Math.random() * Math.PI * 2
      glows.push(e)
      ryuEchoes.push(e)
      add(e)
    }
    ryu = scene.add
      .sprite(RYU_X, RYU_Y, 'ryu', ryuFrames[0])
      .setOrigin(0.5, 1)
      .setScale(RYU_SCALE)
    ryu.play('ryu-idle')
    add(ryu)
  }

  function update(time, delta) {
    // Clamped so a tab-switch hitch can't fling the tire through the floor.
    updateTire(Math.min(delta, 50) / 1000)
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i]
      f.tilePositionX += f.driftSpeed * delta
      f.alpha = f.flickerBase + Math.sin(time * 0.013 + i * 2.1) * 0.07
      f.scaleY = 1 + Math.sin(time * 0.01 + i * 1.4) * 0.06
    }
    // The rim glows breathe with the fire — a shared pulse plus a per-glow
    // phase so edges don't flicker in unison.
    const pulse =
      0.78 + Math.sin(time * 0.011) * 0.12 + Math.sin(time * 0.043 + 1.7) * 0.08
    for (const g of glows) {
      g.alpha = g.glowBase * (pulse + Math.sin(time * 0.021 + g.glowSeed) * 0.12)
    }
    if (ryu) {
      for (const e of ryuEchoes) {
        if (e.frame.name !== ryu.frame.name) e.setFrame(ryu.frame.name)
      }
    }
  }

  return { root, update, launchTire }
}
