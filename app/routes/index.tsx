import { define } from '../utils.ts'

// The control panel itself is a 5velte-ph4ser (Svelte 5 + Phaser 4) app —
// built by `deno task ui:build` at the repo root into static/ui/panel.js
// and mounted into #panel below. Fresh only provides the shell + API.
export default define.page(function Home() {
  const embed = Deno.env.get('RACER_EMBED_URL') ??
    'https://easierbycode.github.io/racer-intro/'
  return (
    <div class='deck'>
      <h1>RACER CONTROL DECK</h1>
      <iframe
        class='game-embed'
        src={embed}
        title='racer intro'
        allow='autoplay'
      />
      <div id='panel'>
        <div class='panel-note'>
          panel bundle not found — build it with{' '}
          <code>deno task ui:build</code>{' '}
          at the repo root (it lands in app/static/ui/), then reload.
        </div>
      </div>
      <link rel='stylesheet' href='/ui/panel.css' />
      <script type='module' src='/ui/panel.js' />
    </div>
  )
})
