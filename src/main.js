import { mount } from 'svelte'
import App from './App.svelte'

// Phaser rasterises Text once at create — if Orbitron is still in flight the
// TIME/LAP readouts bake in the Courier fallback for good. Hold the mount
// until the face is ready, but never longer than a beat if the CDN is down.
Promise.race([
  Promise.allSettled([
    document.fonts.load('bold 31px Orbitron'),
    document.fonts.load('bold 15px Orbitron'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(() => mount(App, { target: document.getElementById('app') }))
