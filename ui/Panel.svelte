<script>
  import Phaser from 'phaser'
  import { Game, Scene, Text, Rectangle } from '5velte-ph4ser'

  const W = 620
  const H = 560
  const FONT = 'Orbitron, "Courier New", ui-monospace, monospace'

  // CMG launcher palette (cmg static/dashboard.css) — Xbox-blade greens.
  const C = {
    bg: '#020a04',
    green: 0x9cff6b,
    greenHex: '#9cff6b',
    glowHex: '#7cff4f',
    deep: 0x0e6a2b,
    blade: 0x17842f,
    bladeHot: 0x27b046,
    panel: 0x06140a,
    panelHot: 0x113d1c,
    stroke: 0x3f7a30,
    strokeHot: 0x7cff4f,
    danger: 0x5a0e14,
    dangerHot: 0x8a1620,
    text: '#eaffd2',
    textDim: '#89c96a',
    bladeHi: '#d9ffa6',
    yellow: '#ffee5a',
    red: '#ff4554',
  }

  // ── server state ─────────────────────────────────────────────────────────
  let status = $state(null) //   /api/status snapshot
  let jobs = $state([]) //       /api/jobs, newest first
  let outputs = $state([]) //    /api/outputs
  let caption = $state('')
  let token = $state(localStorage.getItem('app_token') ?? '')
  let dryRun = $state(true)
  let sceneIdx = $state(0)
  let hovered = $state(null)
  let launching = $state(false)

  const scenes = $derived(status?.scenes ?? ['racer-intro'])
  const scene = $derived(scenes[sceneIdx % scenes.length])
  const latest = $derived(jobs[0] ?? null)
  const logTail = $derived(
    latest ? latest.log.slice(-9).map((l) => l.slice(0, 62)) : ['no jobs yet — press a button'],
  )

  const headers = () => ({
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  })

  // Reads are gated too when the server sets APP_TOKEN, and the download
  // links in the outputs list are plain <a> navigations that can't carry a
  // header — so mirror the token into a cookie the browser sends on both.
  const syncCookie = () => {
    if (!token) return
    document.cookie =
      `app_token=${encodeURIComponent(token)}; path=/; max-age=86400; samesite=strict`
  }

  const refresh = async () => {
    syncCookie()
    try {
      const [s, j, o] = await Promise.all([
        fetch('/api/status', { headers: headers() }).then((r) => r.json()),
        fetch('/api/jobs', { headers: headers() }).then((r) => r.json()),
        fetch('/api/outputs', { headers: headers() }).then((r) => r.json()),
      ])
      // A 401 answers with { error }, not the arrays the panel expects.
      status = s?.error ? null : s
      jobs = Array.isArray(j) ? j : []
      outputs = Array.isArray(o) ? o : []
    } catch {
      // server briefly unreachable (dev restarts) — keep the last snapshot
    }
  }

  const launch = async (action, args = {}) => {
    if (launching) return
    launching = true
    try {
      localStorage.setItem('app_token', token)
      syncCookie()
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action, args }),
      })
      if (!res.ok) {
        const why = res.status === 401
          ? 'set the app token below'
          : (await res.json().catch(() => ({}))).error ?? res.statusText
        jobs = [
          { id: '—', action, status: 'error', log: [`${res.status} — ${why}`] },
          ...jobs,
        ]
        return
      }
      await refresh()
    } finally {
      launching = false
    }
  }

  $effect(() => {
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  })

  // ── console buttons ──────────────────────────────────────────────────────
  const postArgs = (platform) => ({
    platform,
    caption,
    dryRun: String(dryRun),
    ...(platform === 'tiktok' ? { privacy: 'SELF_ONLY' } : {}),
  })

  const buttons = $derived([
    { id: 'scene', label: `SCENE ◂ ${scene} ▸`, color: C.panel, hover: C.panelHot, act: () => (sceneIdx += 1) },
    { id: 'record', label: '● RECORD SCENE', color: C.deep, hover: C.blade, act: () => launch('record', { scene }) },
    { id: 'transcode', label: '◫ TRANSCODE → 9:16 REEL', color: C.panel, hover: C.panelHot, act: () => launch('transcode', { input: `out/${scene}.raw.mp4` }) },
    { id: 'ig', label: `▲ POST INSTAGRAM${dryRun ? ' (DRY)' : ''}`, color: C.panel, hover: C.panelHot, act: () => launch('post', { ...postArgs('instagram'), video: `out/${scene}.reel.mp4` }) },
    { id: 'tiktok', label: `♪ POST TIKTOK${dryRun ? ' (DRY)' : ''}`, color: C.panel, hover: C.panelHot, act: () => launch('post', { ...postArgs('tiktok'), video: `out/${scene}.reel.mp4` }) },
    { id: 'pipeline', label: '▶ FULL PIPELINE', color: C.blade, hover: C.bladeHot, act: () => launch('pipeline', { scene, caption, dryRun: String(dryRun), post: [status?.instagram && 'instagram', status?.tiktok && 'tiktok'].filter(Boolean).join(',') }) },
    { id: 'dry', label: `DRY-RUN: ${dryRun ? 'ON' : 'OFF'}`, color: dryRun ? C.panel : C.danger, hover: dryRun ? C.panelHot : C.dangerHot, act: () => (dryRun = !dryRun) },
  ])

  const statusLine = $derived(
    latest
      ? `JOB ${latest.id} ${latest.action.toUpperCase()} — ${latest.status.toUpperCase()}`
      : 'IDLE',
  )
  const statusColor = $derived(
    latest?.status === 'error' ? C.red : latest?.status === 'running' ? C.yellow : C.greenHex,
  )
  const modeLine = $derived(
    status
      ? `${status.onDeploy ? 'DEPLOY → GH ACTIONS' : 'LOCAL RUNNER'}  ·  IG ${status.instagram ? '✓' : '—'}  ·  TT ${status.tiktok ? '✓' : '—'}`
      : 'connecting…',
  )

  let host = $state()
</script>

<div class="panel-root">
  <div class="canvas-host" bind:this={host}>
    {#if host}
      <Game width={W} height={H} parent={host} backgroundColor={C.bg}>
        <Scene key="panel">
          <Text x={20} y={18} text="CONTROL DECK" fontFamily={FONT} fontSize="22px" fontStyle="800" color={C.greenHex} stroke={C.glowHex} strokeThickness={1} />
          <Text x={20} y={46} text={modeLine} fontFamily={FONT} fontSize="11px" color={C.textDim} />

          {#each buttons as b, i (b.id)}
            <!--
              Hover feedback rides on fillColor/strokeColor/alpha: the
              wrapper re-applies a prop only when its value changes, and
              Phaser's Rectangle has no setFillAlpha, so the highlight is
              expressed as a brighter fill plus the object-level alpha
              (setAlpha exists) rather than fillAlpha.
            -->
            <Rectangle
              x={W / 2}
              y={92 + i * 50}
              width={W - 40}
              height={42}
              fillColor={hovered === b.id ? b.hover : b.color}
              alpha={hovered === b.id ? 1 : 0.85}
              strokeColor={hovered === b.id ? C.strokeHot : C.stroke}
              strokeWidth={2}
              interactive={true}
              onpointerover={() => (hovered = b.id)}
              onpointerout={() => (hovered = null)}
              onpointerdown={b.act}
            />
            <Text
              x={W / 2}
              y={92 + i * 50}
              originX={0.5}
              originY={0.5}
              text={b.label}
              fontFamily={FONT}
              fontSize="15px"
              fontStyle="bold"
              color={hovered === b.id ? C.bladeHi : C.text}
            />
          {/each}

          <Rectangle x={W / 2} y={487} width={W - 40} height={130} fillColor={C.panel} strokeColor={C.stroke} strokeWidth={2} />
          <Text x={26} y={430} text={statusLine} fontFamily={FONT} fontSize="13px" fontStyle="bold" color={statusColor} />
          <Text x={26} y={450} text={logTail} fontFamily={FONT} fontSize="10px" color="#d6ffb0" lineSpacing={2} />
        </Scene>
      </Game>
    {/if}
  </div>

  <label class="field">
    caption
    <input placeholder="caption for posts…" bind:value={caption} />
  </label>
  <label class="field">
    app token
    <input placeholder="only if APP_TOKEN is set on the server" bind:value={token} />
  </label>

  {#if outputs.length}
    <div class="outputs">
      {#each outputs as f (f.name)}
        <a href={`/api/outputs/${f.name}`} target="_blank" rel="noreferrer">
          {f.name} <span>{(f.size / 1024 / 1024).toFixed(1)}mb</span>
        </a>
      {/each}
    </div>
  {:else if status?.onDeploy}
    <div class="outputs note">
      recordings run in GitHub Actions — grab artifacts from the repo's Actions tab.
    </div>
  {/if}
</div>

<style>
  .panel-root {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: Orbitron, 'Courier New', ui-monospace, monospace;
  }
  .canvas-host {
    line-height: 0;
    border: 2px solid rgba(140, 255, 110, 0.55);
    border-radius: 10px;
    overflow: hidden;
    width: fit-content;
    max-width: 100%;
    box-shadow: 0 0 24px rgba(120, 255, 90, 0.16);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    letter-spacing: 0.18em;
    color: #89c96a;
    text-transform: uppercase;
  }
  .field input {
    flex: 1;
    background: #06140a;
    border: 2px solid rgba(140, 255, 110, 0.35);
    border-radius: 6px;
    color: #eaffd2;
    font: inherit;
    padding: 8px 10px;
  }
  .field input:focus {
    outline: none;
    border-color: #7cff4f;
    box-shadow: 0 0 12px rgba(120, 255, 90, 0.3);
  }
  .outputs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .outputs a {
    color: #9cff6b;
    text-decoration: none;
  }
  .outputs a:hover {
    color: #f6ff4a;
  }
  .outputs a span {
    color: #4f8f3e;
  }
  .outputs.note {
    color: #89c96a;
  }
</style>
