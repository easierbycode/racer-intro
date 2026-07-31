import { mount } from 'svelte'
import Panel from './Panel.svelte'

// Same trick as the game's entry: Phaser bakes Text once at create, so wait
// for Orbitron (briefly) before mounting the canvas panel.
Promise.race([
  document.fonts.load('bold 15px Orbitron'),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).then(() => {
  const host = document.getElementById('panel')
  if (!host) return
  host.innerHTML = '' // drop the "bundle not found" fallback note
  mount(Panel, { target: host })
})
