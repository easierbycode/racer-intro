import { C, GAME_H, GAME_W, ROAD } from './constants.js'

const HALF_W = GAME_W / 2
const HALF_H = GAME_H / 2
const RAIL_H = 210 //  guard rail height, world units
const POLE_H = 620 //  light pole height, world units
const POLE_GAP = ROAD.segLen * 12

function quad(g, x1, y1, w1, x2, y2, w2) {
  g.beginPath()
  g.moveTo(x1 - w1, y1)
  g.lineTo(x1 + w1, y1)
  g.lineTo(x2 + w2, y2)
  g.lineTo(x2 - w2, y2)
  g.closePath()
  g.fillPath()
}

/**
 * Classic OutRun-style segment road, drawn into a single Graphics object
 * every frame. The centerline is analytic (a sine sway), which keeps the
 * math simple — swap `centerX` for a segment-curve table if you want real
 * course data.
 */
export class PseudoRoad {
  constructor(scene) {
    this.scene = scene
    this.horizon = Math.round(GAME_H * 0.55)
    this.g = scene.add.graphics().setDepth(40)
    this.poles = Array.from({ length: 10 }, () =>
      scene.add.image(0, 0, 'pole').setOrigin(0, 1).setDepth(45).setVisible(false)
    )
  }

  /** World-space x of the road centerline at distance z. */
  centerX(z) {
    return Math.sin(z * ROAD.swayFreq) * ROAD.swayAmp * ROAD.width
  }

  /** Projects a world point (road-relative xOff, absolute z) to the screen. */
  project(z, camZ, camX, xOff = 0) {
    const dz = z - camZ
    if (dz <= ROAD.segLen * 0.3) return null
    const scale = ROAD.camDepth / dz
    return {
      x: HALF_W + scale * (this.centerX(z) + xOff - camX) * HALF_W,
      y: this.horizon + scale * ROAD.camHeight * HALF_H,
      w: scale * ROAD.width * HALF_W,
      scale,
    }
  }

  draw(camZ, camX) {
    const g = this.g
    g.clear()

    const rows = []
    const base = Math.floor(camZ / ROAD.segLen)
    for (let n = 1; n <= ROAD.drawDist; n++) {
      const z = (base + n) * ROAD.segLen
      const p = this.project(z, camZ, camX)
      if (p) {
        p.seg = base + n
        rows.push(p)
      }
    }

    // Far → near, so closer strips paint over farther ones.
    for (let i = rows.length - 1; i > 0; i--) {
      const far = rows[i]
      const near = rows[i - 1]
      if (near.y <= far.y) continue

      // asphalt
      g.fillStyle(near.seg % 2 === 0 ? C.road : C.roadAlt, 1)
      quad(g, near.x, near.y, near.w, far.x, far.y, far.w)

      // edge lines
      g.fillStyle(C.rumble, 1)
      for (const side of [-1, 1]) {
        quad(
          g,
          near.x + side * near.w * 0.97,
          near.y,
          near.w * 0.02,
          far.x + side * far.w * 0.97,
          far.y,
          far.w * 0.02
        )
      }

      // lane dashes
      if (near.seg % 3 === 0) {
        g.fillStyle(C.lane, 1)
        for (let l = 1; l < ROAD.lanes; l++) {
          const t = -1 + (2 * l) / ROAD.lanes
          quad(
            g,
            near.x + near.w * t,
            near.y,
            near.w * 0.013,
            far.x + far.w * t,
            far.y,
            far.w * 0.013
          )
        }
      }

      // guard rails
      const nh = near.scale * RAIL_H * HALF_H
      const fh = far.scale * RAIL_H * HALF_H
      for (const side of [-1, 1]) {
        const nx = near.x + side * near.w * 1.04
        const fx = far.x + side * far.w * 1.04
        g.fillStyle(C.railDark, 1)
        g.beginPath()
        g.moveTo(nx, near.y)
        g.lineTo(fx, far.y)
        g.lineTo(fx, far.y - fh)
        g.lineTo(nx, near.y - nh)
        g.closePath()
        g.fillPath()
        g.fillStyle(C.rail, 1)
        g.beginPath()
        g.moveTo(nx, near.y - nh)
        g.lineTo(fx, far.y - fh)
        g.lineTo(fx, far.y - fh * 0.72)
        g.lineTo(nx, near.y - nh * 0.72)
        g.closePath()
        g.fillPath()
      }
    }

    this.updatePoles(camZ, camX)
  }

  updatePoles(camZ, camX) {
    const first = Math.ceil(camZ / POLE_GAP) * POLE_GAP
    let i = 0
    for (let k = 0; k < 5; k++) {
      const z = first + k * POLE_GAP
      for (const side of [-1, 1]) {
        const sprite = this.poles[i++]
        const p = this.project(z, camZ, camX, side * ROAD.width * 1.18)
        if (!p || p.scale < 0.00006) {
          sprite.setVisible(false)
          continue
        }
        const hPx = p.scale * POLE_H * HALF_H
        sprite
          .setVisible(true)
          .setPosition(p.x, p.y)
          .setScale(hPx / 120)
          .setFlipX(side > 0)
          .setOrigin(side < 0 ? 0 : 1, 1)
      }
    }
  }

  setVisible(v) {
    this.g.setVisible(v)
    if (!v) {
      this.g.clear()
      for (const p of this.poles) p.setVisible(false)
    }
    return this
  }
}
