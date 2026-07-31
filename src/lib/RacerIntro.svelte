<script>
  import Phaser from 'phaser'
  import { Game, Scene, Text } from '5velte-ph4ser'
  import { GAME_H, GAME_W, PHASE, UI } from './intro/constants.js'
  import { createIntro } from './intro/scene.js'

  let phase = $state(PHASE.BOOT)
  let host = $state() // the <Game> waits for this element so the canvas lands inside it

  const intro = createIntro({
    onphase: (p) => {
      phase = p
      // Recorder hook: tools/record (headless Chrome) can't reach Svelte
      // state, so mirror the phase onto window and announce changes. The
      // event lets the recorder await transitions instead of polling.
      window.__racerPhase = p
      window.dispatchEvent(new CustomEvent('racer:phase', { detail: p }))
    },
  })

  const inRace = $derived(
    phase === PHASE.MOSAIC || phase === PHASE.RACE || phase === PHASE.CRASH
  )

  // SWAP POINT: sheets in /public/assets load here under the same keys the
  // placeholders use, so textures.js skips generating them.
  //
  // 'car' is the Turbo Out Run F40 rear view — six steering frames in one
  // strip. See scene.js for why the frames are ordered by atlas x rather than
  // by name.
  //
  // 'car-rpm' is the two-state tach gauge (frame 0 full, frame 1 empty) and
  // 'bg-flames' the 8-frame fire wall for the burning stage — both consumed
  // via the same sort-by-atlas-x convention.
  //
  // 'explosion' is the Metal Slug 12-frame fire burst, looped on the wreck in
  // stage.js. The file name's misspelling is the asset's, not the key's.
  const preload = (scene) => {
    scene.load.atlas('car', 'assets/car.png', 'assets/car.json')
    scene.load.atlas('car-enemy', 'assets/car-enemy.png', 'assets/car-enemy.json')
    scene.load.atlas('car-rpm', 'assets/car-rpm.png', 'assets/car-rpm.json')
    scene.load.atlas('bg-flames', 'assets/bg-flames.png', 'assets/bg-flames.json')
    scene.load.atlas(
      'explosion',
      'assets/metal-slug-exposion.png',
      'assets/metal-slug-exposion.json'
    )
    scene.load.atlas(
      'truck-explosion',
      'assets/truck-explosion.png',
      'assets/truck-explosion.json'
    )
    scene.load.image('skyline', 'assets/skyline.png')
    scene.load.image('truck', 'assets/truck.png')
    // 8x8 arcade caps — turned into a bitmap font in textures.js.
    scene.load.image('font', 'assets/font.png')
    scene.load.atlas('ryu', 'assets/ryu.png', 'assets/ryu.json')
    // Nitrous exhaust FX — left-side art; scene.js flips it for the right pipe.
    scene.load.atlas(
      'car-nitrous-spark-l',
      'assets/car-nitrous-spark-l.png',
      'assets/car-nitrous-spark-l.json'
    )
    scene.load.atlas(
      'car-nitrous-smoke-l',
      'assets/car-nitrous-smoke-l.png',
      'assets/car-nitrous-smoke-l.json'
    )
  }
</script>

<div class="frame" bind:this={host}>
  {#if host}
    <Game
      width={GAME_W}
      height={GAME_H}
      parent={host}
      backgroundColor="#05060f"
      pixelArt={true}
      scale={{
        /*
         * FIT rather than ENVELOP: the canvas grows to whatever the viewport
         * allows while keeping 4:3, so nothing is cropped. ENVELOP would fill
         * a 16:9 screen edge to edge, but it does that by cutting ~25% off the
         * top and bottom — which is where TIME and PRESS START live.
         */
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      }}
      render={{
        /*
         * Phaser 4.2's multi-texture batcher (degenerate triangle-strip
         * quads) can tear a sprite mid-quad when a texture-unit swap forces
         * a flush — seen here as the player car splitting while the rival
         * car shares the frame. Single-texture batches align every flush to
         * an object boundary; at this scene's size the extra draw calls are
         * free.
         */
        maxTextures: 1,
      }}
    >
    <Scene key="racer-intro" {preload} create={intro.create}>
      <!-- Declarative overlay — everything below is Svelte state → Phaser -->
      <Text
        x={42}
        y={GAME_H - 58}
        text="LAP"
        fontFamily={UI.font}
        fontSize="15px"
        fontStyle="bold"
        color="#ffffff"
        backgroundColor="#c22333"
        padding={{ x: 7, y: 2 }}
        depth={800}
        visible={inRace}
      />
      <Text
        x={92}
        y={GAME_H - 70}
        text="3/4"
        fontFamily={UI.font}
        fontSize="30px"
        fontStyle="bold italic"
        color="#e8e8ff"
        stroke="#101024"
        strokeThickness={6}
        depth={800}
        visible={inRace}
      />
      <!-- PRESS START is a bitmap-font object built in scene.js, not a Text -->
      </Scene>
    </Game>
  {/if}
</div>

<style>
  /* Phaser's FIT mode sizes the canvas against this box, so it takes the
     whole viewport — the letterbox bars are just the page background. */
  .frame {
    line-height: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .frame :global(canvas) {
    image-rendering: pixelated;
  }
</style>
