import Phaser from 'phaser'
import { GAME_H, GAME_W, PHASE, RACE, ROAD, T, UI } from './constants.js'
import { PseudoRoad } from './road.js'
import { buildStage } from './stage.js'
import {
  buildRetroFont,
  buildTextures,
  framesByX,
  keyedSkyline,
} from './textures.js'

const TRUCK_LANE = 0 //       world x offset of the truck (0 = center lane)
const TRUCK_WORLD_W = 690 //  truck width in world units
const CAR_LOOKAHEAD = 2400 // how far up the road the car aims, world units
// Per-step offset of the crash rim-light silhouettes. Five echoes, so this is
// how far the yellow contour reaches past the car on the fire's side — kept
// tight so it reads as an edge catching the light, not a flame off the flank.
const CAR_ECHO_STEP = 1.2

// The rival that gets between us and the truck. It starts ahead in the left
// lane; we reel it in, it cuts at us, we flinch right, it bails back left and
// drops past — then the road is clear for the crash.
const ENEMY = {
  lead: 7200, //      head start, world units
  speed: 3800, //     slower than us
  worldW: 620,
  startLane: -440, // left lane
  cutGap: 2600, //    gap at which it swerves toward us
  passGap: 1150, //   gap at which it bails and we recover
}

/*
 * Peak |lean| for the analytic sine centerline: the camera sits on the
 * centerline, so lean is centerX(z + lookahead) - centerX(z), whose amplitude
 * is 2·sin(Δz·freq/2) of the sway amplitude. Derived rather than hardcoded so
 * retuning ROAD keeps the steering frames correctly normalised.
 */
const CAR_LEAN_MAX =
  ROAD.swayAmp * ROAD.width * 2 * Math.sin((CAR_LOOKAHEAD * ROAD.swayFreq) / 2)

/**
 * The whole sequence, as a factory the <Scene> component consumes:
 *
 *   mosaic → race → crash → flash → stage
 *
 * Everything is built once in create(); replays just reset state, so the
 * declarative overlay in RacerIntro.svelte survives untouched.
 */
export function createIntro({ onphase = () => {} } = {}) {
  const S = { phase: PHASE.BOOT, temp: { tweens: [], timers: [] } }

  const setPhase = (p) => {
    S.phase = p
    onphase(p)
  }

  // Tweens/timers that belong to one run — killed on replay.
  const tween = (scene, cfg) => {
    const t = scene.tweens.add(cfg)
    S.temp.tweens.push(t)
    return t
  }
  const after = (scene, ms, fn) => {
    const t = scene.time.delayedCall(ms, fn)
    S.temp.timers.push(t)
    return t
  }
  const clearTemp = () => {
    for (const t of S.temp.tweens) t.stop?.()
    for (const t of S.temp.timers) t.remove?.(false)
    S.temp.tweens = []
    S.temp.timers = []
  }

  function create(scene) {
    buildTextures(scene)

    // ── racer set ──────────────────────────────────────────────────────────
    S.sky = scene.add.image(0, 0, 'sky').setOrigin(0).setDepth(0)

    // Skyline band — adapts to the ripped skyline.png (64px strip, drawn 2x)
    // or the 140px placeholder. The rip's baked-in sky color is keyed out
    // (keyedSkyline) and the strip's bottom tucks just below the road horizon
    // so the buildings rise from behind the expressway instead of floating.
    // The procedural near layer only backs the placeholder; the rip's
    // mountains already carry the depth.
    const skyKey = keyedSkyline(scene)
    const skySrc = scene.textures.get(skyKey).getSourceImage()
    const skyTileScale = skySrc.height < 100 ? 2 : 1
    S.skyFar = scene.add
      .tileSprite(0, 272, GAME_W, skySrc.height * skyTileScale, skyKey)
      .setOrigin(0, 1)
      .setDepth(10)
    S.skyFar.setTileScale(skyTileScale)
    S.skyNear =
      skyTileScale === 1
        ? scene.add
            .tileSprite(0, 272, GAME_W, 90, 'skyline2')
            .setOrigin(0, 1)
            .setDepth(11)
        : null

    S.road = new PseudoRoad(scene) // depths 40 + 45
    S.truck = scene.add.image(0, 0, 'truck').setOrigin(0.5, 1).setDepth(50)

    // ── rival car ──────────────────────────────────────────────────────────
    if (scene.textures.exists('car-enemy')) {
      S.enemyFrames = framesByX(scene, 'car-enemy')
      S.enemy = scene.add
        .image(0, 0, 'car-enemy', S.enemyFrames[0])
        .setOrigin(0.5, 1)
        .setDepth(52)
        .setVisible(false)
    } else {
      S.enemy = null
      S.enemyFrames = []
    }

    /*
     * The car atlas is a single strip laid out in steering order — leftmost
     * frame is dead centre, rightmost is the hardest turn — but the builder
     * writes double-hex-encoded frame names that carry no usable ordering
     * ('atlas_s3' sits at x=0, 'atlas_s0' at x=236). So sort by atlas x and
     * treat the result as a 0..n steering ramp. Falls back to the single
     * generated placeholder frame when the atlas is absent.
     */
    S.carFrames = scene.textures
      .get('car')
      .getFrameNames()
      .sort((a, b) => scene.textures.getFrame('car', a).cutX -
                      scene.textures.getFrame('car', b).cutX)

    S.car = scene.add
      .image(GAME_W / 2, GAME_H - 26, 'car', S.carFrames[0])
      .setOrigin(0.5, 1)
      .setDepth(60)
      // The rip is 59x28 against the old 92x54 placeholder — scale to keep the
      // car the same width on screen as the scaffold was tuned for.
      .setScale(S.carFrames.length ? 3 : 1.9)

    // ── nitrous exhaust: sparks on the pipes + smoke puffs ─────────────────
    // The art is drawn for the LEFT pipe; the right pipe mirrors it (flipX).
    if (
      scene.textures.exists('car-nitrous-spark-l') &&
      !scene.anims.exists('nitro-spark')
    ) {
      scene.anims.create({
        key: 'nitro-spark',
        frames: framesByX(scene, 'car-nitrous-spark-l').map((frame) => ({
          key: 'car-nitrous-spark-l',
          frame,
        })),
        frameRate: 20,
        repeat: -1,
      })
    }
    if (
      scene.textures.exists('car-nitrous-smoke-l') &&
      !scene.anims.exists('nitro-smoke')
    ) {
      scene.anims.create({
        key: 'nitro-smoke',
        frames: framesByX(scene, 'car-nitrous-smoke-l').map((frame) => ({
          key: 'car-nitrous-smoke-l',
          frame,
        })),
        frameRate: 14,
        repeat: 0,
      })
    }
    S.sparks = []
    if (scene.anims.exists('nitro-spark')) {
      for (const side of [-1, 1]) {
        const sp = scene.add
          .sprite(0, 0, 'car-nitrous-spark-l')
          .setOrigin(0.5, 0.3)
          .setDepth(61)
          .setScale(3)
          .setFlipX(side > 0)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
        sp.exhaustSide = side
        sp.play('nitro-spark')
        S.sparks.push(sp)
      }
    }
    S.smokes = []
    if (scene.anims.exists('nitro-smoke')) {
      for (let i = 0; i < 6; i++) {
        S.smokes.push(
          scene.add
            .sprite(0, 0, 'car-nitrous-smoke-l')
            .setDepth(61)
            .setScale(3)
            .setVisible(false)
        )
      }
    }
    S.smokeIdx = 0

    // TIME readout — imperative because it changes every frame.
    S.timeBadge = scene.add
      .text(206, 46, 'TIME', {
        fontFamily: UI.font,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#c22333',
        padding: { x: 7, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(800)
    S.timeText = scene.add
      .text(240, 29, '', {
        fontFamily: UI.font,
        fontSize: '31px',
        fontStyle: 'bold italic',
        color: '#e8e8ff',
        stroke: '#101024',
        strokeThickness: 6,
      })
      .setDepth(800)

    // ── RPM gauge (car-rpm atlas: frame 0 full, frame 1 empty) ─────────────
    if (scene.textures.exists('car-rpm')) {
      S.rpmFrames = framesByX(scene, 'car-rpm')
      S.rpm = scene.add
        .image(GAME_W - 20, GAME_H - 22, 'car-rpm', S.rpmFrames[0])
        .setOrigin(1, 1)
        .setDepth(800)
        .setScale(2)
    }

    // ── crash explosion (pooled) ───────────────────────────────────────────
    // The truck-explosion atlas is a 6-frame blast that grows on its own, so
    // each pooled sprite just plays through once and hides. Without it we fall
    // back to the procedural blob, which needs the scale tween in
    // spawnFireball to read as an explosion at all.
    S.boomAtlas = scene.textures.exists('truck-explosion')
    if (S.boomAtlas && !scene.anims.exists('truck-boom')) {
      scene.anims.create({
        key: 'truck-boom',
        frames: framesByX(scene, 'truck-explosion').map((frame) => ({
          key: 'truck-explosion',
          frame,
        })),
        frameRate: 16,
        repeat: 0,
      })
    }
    S.booms = Array.from({ length: 14 }, () => {
      const b = S.boomAtlas
        ? scene.add.sprite(0, 0, 'truck-explosion')
        : scene.add.image(0, 0, 'fireball').setBlendMode(Phaser.BlendModes.ADD)
      // Registered once, not per spawn: play() restarts the anim, so a
      // per-spawn `once` would leave stale handlers on a recycled sprite.
      b.on?.(Phaser.Animations.Events.ANIMATION_COMPLETE, () => b.setVisible(false))
      return b.setDepth(56).setVisible(false)
    })
    S.boomIdx = 0

    // Silhouette echoes for the crash rim light — additive tint-filled copies
    // of the car stepped toward the fireball, so the glow outlines the car's
    // actual shape (stage.js does the same for the stage props).
    S.carEchoes = Array.from({ length: 5 }, () =>
      scene.add
        .image(0, 0, 'car', S.carFrames[0])
        .setOrigin(0.5, 1)
        .setDepth(59)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false)
    )
    for (const e of S.carEchoes) {
      // Phaser 4: tint-fill is a tint mode now
      e.setTint(0xffc03e).setTintMode(Phaser.TintModes.FILL)
    }

    // ── PRESS START ────────────────────────────────────────────────────────
    // Arcade caps from font.png. Its glyphs are already gold with a red
    // outline, so no tint or stroke — the blink is driven off the scene clock
    // in update() rather than a timer, so replays need no teardown.
    const fontKey = buildRetroFont(scene)
    S.pressStart = fontKey
      ? scene.add
          .bitmapText(GAME_W - 26, GAME_H - 30, fontKey, 'PRESS START', 8)
          .setOrigin(1, 1)
          .setScale(2) // 11 chars × 8px × 2 ≈ the old 17px Text's footprint
          .setDepth(800)
          .setVisible(false)
      : null

    // ── white-out overlay ──────────────────────────────────────────────────
    S.white = scene.add
      .rectangle(0, 0, GAME_W, GAME_H, 0xffffff)
      .setOrigin(0)
      .setDepth(900)
      .setAlpha(0)

    // ── burning stage (hidden until the flash) ─────────────────────────────
    S.stage = buildStage(scene)

    // ── TV-blob mosaic ─────────────────────────────────────────────────────
    S.blobs = []
    for (let cx = 0; cx <= 10; cx++) {
      for (let cy = 0; cy <= 11; cy++) {
        S.blobs.push(
          scene.add
            .image(
              cx * 64 + 32 + (Math.random() * 10 - 5),
              cy * 44 + 22 + (Math.random() * 8 - 4),
              'blob'
            )
            .setDepth(950)
            .setVisible(false)
        )
      }
    }

    // ── input: replay from the stage ───────────────────────────────────────
    const replay = () => {
      if (S.phase === PHASE.STAGE) reset(scene)
    }
    scene.input.on('pointerdown', replay)
    scene.input.keyboard?.on('keydown-SPACE', replay)

    scene.events.on(Phaser.Scenes.Events.UPDATE, (time, delta) =>
      update(scene, time, delta)
    )

    reset(scene)
  }

  // ── sequence ─────────────────────────────────────────────────────────────

  function reset(scene) {
    clearTemp()
    const cam = scene.cameras.main
    cam.resetFX?.()
    cam.panEffect?.reset()
    cam.zoomEffect?.reset()
    cam.setZoom(1)
    cam.centerOn(GAME_W / 2, GAME_H / 2)

    S.camZ = 0
    S.speed = RACE.speedStart
    S.truckZ = RACE.truckLead
    S.clock = RACE.clockStart
    S.elapsed = 0
    S.gear = 0
    S.rpmDipUntil = 0
    S.dodgeX = 0
    S.smokeAcc = 0
    S.smokeSide = 1
    S.sparkBoost = 1
    S.steerSm = 0
    S.carSteerIdx = -1
    S.carFlip = false
    S.enemyIdx = -1
    S.enemyFlip = false
    S.rpmEmpty = null
    S.enemyZ = ENEMY.lead
    S.enemyLane = ENEMY.startLane
    S.enemyPrevLane = ENEMY.startLane
    S.enemyStep = 0 // 0 = cruising ahead, 1 = cutting at us, 2 = bailed left
    S.enemy?.setVisible(true).setAlpha(1)

    for (const b of S.booms) b.setVisible(false)
    S.white.setAlpha(0)
    S.stage.root.setVisible(false)
    S.truck.setVisible(true)
    setRacerVisible(true)

    // The racer is already running under the blobs — the mosaic just reveals it.
    setPhase(PHASE.MOSAIC)
    for (const b of S.blobs) {
      b.setVisible(true).setScale(1.3).setAlpha(1)
      tween(scene, {
        targets: b,
        scale: 0,
        alpha: 0.3,
        delay: Math.random() * (T.mosaic - 450),
        duration: 420,
        ease: 'Cubic.easeIn',
        onComplete: () => b.setVisible(false),
      })
    }
    after(scene, T.mosaic, () => setPhase(PHASE.RACE))
  }

  function setRacerVisible(v) {
    const set = [S.sky, S.skyFar, S.skyNear, S.car, S.timeBadge, S.timeText, S.rpm]
    for (const o of set.filter(Boolean)) {
      o.setVisible(v)
    }
    if (!v) {
      S.truck.setVisible(false)
      S.enemy?.setVisible(false)
      for (const e of S.carEchoes) e.setVisible(false)
      for (const sp of S.sparks) sp.setVisible(false)
      for (const sm of S.smokes) sm.setVisible(false)
    }
    S.road.setVisible(v)
  }

  function crash(scene) {
    setPhase(PHASE.CRASH)
    S.speed = 0

    const p = S.road.project(S.truckZ, S.camZ, S.road.centerX(S.camZ), TRUCK_LANE)
    S.boomAt = p ? { x: p.x, y: p.y - 14 } : { x: GAME_W / 2, y: 300 }

    scene.cameras.main.shake(650, 0.012)
    scene.cameras.main.flash(140, 255, 214, 160)

    // Slow push-in on the fireball — the drama for the transition. The pan
    // target is clamped so the zoomed view never leaves the scene.
    const cam = scene.cameras.main
    const zoom = 1.35
    const pushMs = T.crashHold + T.flashIn
    const halfW = GAME_W / (2 * zoom)
    const halfH = GAME_H / (2 * zoom)
    cam.zoomTo(zoom, pushMs, 'Sine.easeIn')
    cam.pan(
      Phaser.Math.Clamp(S.boomAt.x, halfW, GAME_W - halfW),
      Phaser.Math.Clamp(S.boomAt.y, halfH, GAME_H - halfH),
      pushMs,
      'Sine.easeIn'
    )

    after(scene, 240, () => S.truck.setVisible(false)) // swallowed by the fire

    // Rolling fireballs until the white-out.
    // SWAP POINT: with the Metal Slug sheet loaded, replace spawnFireball
    // with a sprite playing the explosion anim at S.boomAt.
    const burst = () => {
      spawnFireball(scene)
      spawnFireball(scene)
    }
    burst()
    const roll = scene.time.addEvent({ delay: 130, loop: true, callback: burst })
    S.temp.timers.push(roll)

    after(scene, T.crashHold, () => {
      roll.remove(false)
      whiteOut(scene)
    })
  }

  function spawnFireball(scene) {
    const b = S.booms[S.boomIdx++ % S.booms.length]
    b.setVisible(true)
      .setPosition(
        S.boomAt.x + (Math.random() * 56 - 28),
        S.boomAt.y - (Math.random() * 34 - 10)
      )
      .setAlpha(1)

    if (S.boomAtlas) {
      // The atlas blast already expands frame to frame, so it only needs a
      // size and a slow rise — mirroring half of them keeps the repeats from
      // reading as the same explosion twice.
      b.setScale(1.5 + Math.random() * 1.1).setFlipX(Math.random() < 0.5)
      b.play('truck-boom')
      tween(scene, {
        targets: b,
        y: b.y - 22 - Math.random() * 30,
        duration: 520 + Math.random() * 260,
        ease: 'Sine.easeOut',
      })
      return
    }

    b.setScale(0.15 + Math.random() * 0.2)
    tween(scene, {
      targets: b,
      scale: 1.5 + Math.random() * 1.3,
      y: b.y - 30 - Math.random() * 40,
      alpha: 0,
      duration: 600 + Math.random() * 320,
      ease: 'Cubic.easeOut',
      onComplete: () => b.setVisible(false),
    })
  }

  function puffSmoke(scene, side) {
    const s = S.smokes[S.smokeIdx++ % S.smokes.length]
    s.setVisible(true)
      .setFlipX(side > 0) // left-pipe art, mirrored for the right pipe
      .setPosition(S.car.x + side * 44, S.car.y - 10)
      .setAlpha(0.8)
      .setScale(2.4 + Math.random())
    s.play('nitro-smoke')
    tween(scene, {
      targets: s,
      x: s.x + side * (16 + Math.random() * 10),
      y: s.y + 12,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => s.setVisible(false),
    })
  }

  function whiteOut(scene) {
    setPhase(PHASE.FLASH)
    tween(scene, {
      targets: S.white,
      alpha: 1,
      duration: T.flashIn,
      ease: 'Quad.easeIn',
      onComplete: () => {
        // Swap the whole set behind the white, snap the camera off the
        // fireball push-in, and pre-load a slight zoom so the burning stage
        // settles out as the white fades.
        setRacerVisible(false)
        for (const b of S.booms) b.setVisible(false)
        S.stage.root.setVisible(true)
        const cam = scene.cameras.main
        cam.panEffect?.reset()
        cam.zoomEffect?.reset()
        cam.centerOn(GAME_W / 2, GAME_H / 2)
        cam.setZoom(1.16)
        after(scene, T.flashHold, () => {
          cam.zoomTo(1, T.flashOut + 700, 'Sine.easeOut')
          tween(scene, {
            targets: S.white,
            alpha: 0,
            duration: T.flashOut,
            ease: 'Quad.easeOut',
            onComplete: () => setPhase(PHASE.STAGE),
          })
        })
      },
    })
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  function update(scene, time, delta) {
    const dt = delta / 1000
    S.elapsed += dt

    if (S.phase === PHASE.MOSAIC || S.phase === PHASE.RACE) {
      S.speed = Math.min(RACE.speedMax, S.speed + RACE.accel * dt)
      S.camZ += S.speed * dt
      S.truckZ += RACE.truckSpeed * dt
      S.clock += dt

      // Rival car: reel it in → it cuts at us → we flinch → it bails past.
      if (S.enemy) {
        S.enemyZ += ENEMY.speed * dt
        const gap = S.enemyZ - S.camZ
        if (S.enemyStep === 0 && gap < ENEMY.cutGap) {
          S.enemyStep = 1
          tween(scene, {
            targets: S,
            enemyLane: -90,
            duration: 650,
            ease: 'Sine.easeInOut',
          })
          tween(scene, {
            targets: S,
            dodgeX: 70,
            duration: 480,
            ease: 'Sine.easeOut',
          })
        } else if (S.enemyStep === 1 && gap < ENEMY.passGap) {
          S.enemyStep = 2
          tween(scene, {
            targets: S,
            enemyLane: -560,
            duration: 520,
            ease: 'Sine.easeIn',
          })
          tween(scene, {
            targets: S,
            dodgeX: 0,
            duration: 700,
            delay: 150,
            ease: 'Sine.easeInOut',
          })
        }
      }

      // Exhaust smoke, alternating pipes.
      S.smokeAcc += dt
      if (S.smokes.length && S.smokeAcc > 0.15) {
        S.smokeAcc = 0
        S.smokeSide = -S.smokeSide
        puffSmoke(scene, S.smokeSide)
      }

      if (S.phase === PHASE.RACE && S.truckZ - S.camZ < RACE.crashGap) {
        crash(scene)
      }
    } else if (S.phase === PHASE.CRASH) {
      S.clock += dt // the clock keeps running through the fire, like the original
    }

    if (
      S.phase === PHASE.MOSAIC ||
      S.phase === PHASE.RACE ||
      S.phase === PHASE.CRASH
    ) {
      drawRacer(dt)
    }

    // 430ms on, 430ms off — same cadence the Svelte overlay used.
    S.pressStart?.setVisible(
      S.phase === PHASE.STAGE && Math.floor(time / 430) % 2 === 0
    )

    if (S.stage.root.visible) S.stage.update(time, delta)
  }

  function drawRacer(dt = 1 / 60) {
    const camX = S.road.centerX(S.camZ)
    S.road.draw(S.camZ, camX)

    // Skylines drift against the curve.
    S.skyFar.tilePositionX = camX * 0.018 + S.camZ * 0.0004
    if (S.skyNear) S.skyNear.tilePositionX = camX * 0.05 + S.camZ * 0.0012

    // Truck, projected onto the road.
    if (S.truck.visible) {
      const p = S.road.project(S.truckZ, S.camZ, camX, TRUCK_LANE)
      if (p) {
        const pxW = p.w * (TRUCK_WORLD_W / ROAD.width)
        // Divided by the source width so the rip (63px) and the placeholder
        // (110px) both land at the same on-screen width.
        S.truck.setPosition(p.x, p.y).setScale(pxW / S.truck.width)
      }
    }

    // Rival car — projected like the truck; steering frames follow its lane
    // velocity (frame strip is straight → hard turn, mirrored via flipX).
    // It fades over the last stretch and culls before dz→0 would blow the
    // projected quad up to thousands of pixels.
    if (S.enemy && S.enemy.visible) {
      const dzE = S.enemyZ - S.camZ
      const p = dzE > 520 ? S.road.project(S.enemyZ, S.camZ, camX, S.enemyLane) : null
      if (p) {
        S.enemy.setAlpha(Phaser.Math.Clamp((dzE - 520) / 600, 0, 1))
        const pxW = p.w * (ENEMY.worldW / ROAD.width)
        S.enemy.setPosition(p.x, p.y).setScale(pxW / 64)
        const laneVel = S.enemyLane - S.enemyPrevLane
        const idx = Math.min(
          S.enemyFrames.length - 1,
          Math.abs(laneVel) > 6 ? 2 : Math.abs(laneVel) > 1.5 ? 1 : 0
        )
        // frame/flip only on change — per-tick swaps jitter and can tear quads
        const eFlip = laneVel < -1.5 ? true : laneVel > 1.5 ? false : S.enemyFlip
        if (idx !== S.enemyIdx) {
          S.enemyIdx = idx
          S.enemy.setFrame(S.enemyFrames[idx])
        }
        if (eFlip !== S.enemyFlip) {
          S.enemyFlip = eFlip
          S.enemy.setFlipX(eFlip)
        }
        S.enemyPrevLane = S.enemyLane
      } else {
        S.enemy.setVisible(false) // dropped past us
      }
    }

    // Player car — weave, lean into the curve, dodge offset, engine bounce.
    const lean = S.road.centerX(S.camZ + CAR_LOOKAHEAD) - camX
    const bounce = S.speed > 1 ? Math.sin(S.elapsed * 19) * 1.3 : 0
    S.car
      .setPosition(
        GAME_W / 2 + Math.sin(S.elapsed * 1.3) * 9 - lean * 0.045 + S.dodgeX,
        GAME_H - 26 + bounce
      )
      .setRotation(-lean * 0.00035)

    // Steering frames: the strip only turns one way, so mirror it for the
    // other. The dodge reads as steering too. The signal is smoothed and the
    // frame/flip setters only run on change — flapping them every tick both
    // jitters and can tear the sprite's quad mid-swap. Skipped when the
    // placeholder (single frame) is in play.
    const steerLean = lean + S.dodgeX * (CAR_LEAN_MAX / 90)
    S.steerSm += (steerLean - S.steerSm) * Math.min(1, dt * 10)
    if (S.carFrames.length > 1) {
      const last = S.carFrames.length - 1
      const steer = Math.min(
        last,
        Math.round((Math.abs(S.steerSm) / CAR_LEAN_MAX) * last)
      )
      const dead = CAR_LEAN_MAX * 0.06 // deadband so flip doesn't flap at 0
      const flip =
        S.steerSm < -dead ? true : S.steerSm > dead ? false : S.carFlip
      if (steer !== S.carSteerIdx) {
        S.carSteerIdx = steer
        S.car.setFrame(S.carFrames[steer])
      }
      if (flip !== S.carFlip) {
        S.carFlip = flip
        S.car.setFlipX(flip)
      }
    }

    // Nitrous — sparks live on the exhaust pipes while we're on throttle;
    // gear shifts kick sparkBoost for a bigger flash.
    const onThrottle = S.phase === PHASE.MOSAIC || S.phase === PHASE.RACE
    for (const sp of S.sparks) {
      sp.setVisible(onThrottle)
      if (onThrottle) {
        sp.setPosition(
          S.car.x + sp.exhaustSide * 40 + (Math.random() * 4 - 2),
          S.car.y - 13 + (Math.random() * 3 - 1)
        ).setScale(3 * S.sparkBoost * (0.85 + Math.random() * 0.35))
      }
    }
    S.sparkBoost = Math.max(1, S.sparkBoost * 0.9)

    // RPM gauge — full (frame 0) under throttle, a quick dip to empty
    // (frame 1) on each gear change, dead-empty once we've hit the truck.
    if (S.rpm) {
      const gear = Math.floor((S.speed - RACE.speedStart) / 1100)
      if (gear !== S.gear) {
        S.gear = gear
        S.rpmDipUntil = S.elapsed + 0.09
        S.sparkBoost = 1.6 // the shift also spits a bigger backfire
      }
      const empty = S.phase === PHASE.CRASH || S.elapsed < S.rpmDipUntil
      if (empty !== S.rpmEmpty) {
        S.rpmEmpty = empty
        S.rpm.setFrame(S.rpmFrames[empty ? 1 : 0])
      }
    }

    // After the explosion the car itself catches the light — silhouette
    // echoes stacked toward whichever side faces the fireball.
    if (S.phase === PHASE.CRASH && S.boomAt) {
      const dir = S.car.x <= S.boomAt.x ? 1 : -1
      const flicker = 0.75 + Math.random() * 0.25
      for (let i = 0; i < S.carEchoes.length; i++) {
        const e = S.carEchoes[i]
        e.setVisible(true)
          .setPosition(S.car.x + dir * CAR_ECHO_STEP * (i + 1), S.car.y)
          .setScale(S.car.scaleX, S.car.scaleY)
          .setAlpha(0.5 * (1 - i / S.carEchoes.length) * flicker)
        if (e.flipX !== S.car.flipX) e.setFlipX(S.car.flipX)
        if (S.carFrames.length && e.frame.name !== S.car.frame.name) {
          e.setFrame(S.car.frame.name)
        }
      }
    } else {
      for (const e of S.carEchoes) e.setVisible(false)
    }

    // TIME readout.
    const m = Math.floor(S.clock / 60)
    const s = Math.floor(S.clock % 60)
    const ms = Math.floor((S.clock * 1000) % 1000)
    S.timeText.setText(
      `${m}'${String(s).padStart(2, '0')}"${String(ms).padStart(3, '0')}`
    )
  }

  return { create }
}
