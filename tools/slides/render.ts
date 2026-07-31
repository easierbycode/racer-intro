// Renders a Tutorial into a single self-contained HTML page: a dark
// editor-styled 9:16 layout that types the code out character by character,
// with no external assets so it records identically offline and in CI.
//
// The page drives the same window-flag protocol the racer intro uses, so
// the generic recorder needs nothing special:
//   window.__slidesState = 'typing'  when the animation starts
//   window.__slidesState = 'done'    ~1.5s after the last character lands

import type { Tutorial, TutorialStep } from './types.ts'

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function renderTutorialHtml(t: Tutorial): string {
  // Normalize both input modes to timed steps; simple `commands` become one
  // step against the first empty file (or the first file).
  const target = t.files.find((f) => f.content === '')?.name ?? t.files[0].name
  const steps: TutorialStep[] = t.steps?.length
    ? t.steps
    : [{ file: target, insert: t.commands ?? '' }]

  // <-escape so code containing "</script>" can't terminate the inline
  // script block it's embedded in.
  const payload = JSON.stringify({
    files: t.files,
    steps,
    charsPerSec: t.charsPerSec ?? 30,
  }).replaceAll('<', '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(t.description)}</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; box-sizing: border-box; }
  html, body { height: 100%; background: #07070d; }
  body {
    display: flex; flex-direction: column;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    color: #e8e8ff; padding: 72px 54px;
  }
  h1 {
    font-size: 44px; line-height: 1.25; font-weight: 700;
    color: #ffd23e; margin-bottom: 48px; word-wrap: break-word;
  }
  .editor {
    flex: 1; display: flex; flex-direction: column; min-height: 0;
    background: #101024; border-radius: 18px; overflow: hidden;
    border: 2px solid #2c3444;
  }
  .tabs { display: flex; background: #0d1230; padding: 0 8px; }
  .tab {
    padding: 18px 26px; font-size: 26px; color: #66738c;
    border-bottom: 3px solid transparent;
  }
  .tab.active { color: #e8e8ff; border-bottom-color: #ff7a00; }
  pre {
    flex: 1; overflow: hidden; padding: 30px;
    font-size: 28px; line-height: 1.5; white-space: pre-wrap;
    word-wrap: break-word;
  }
  .caret {
    display: inline-block; width: 14px; height: 32px;
    background: #ff7a00; vertical-align: text-bottom;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<h1>${escapeHtml(t.description)}</h1>
<div class="editor">
  <div class="tabs" id="tabs"></div>
  <pre id="code"><span id="text"></span><span class="caret"></span></pre>
</div>
<script>
  const data = ${payload};
  const tabs = document.getElementById('tabs');
  const text = document.getElementById('text');
  const buffers = Object.fromEntries(data.files.map((f) => [f.name, f.content]));
  let activeFile = data.steps[0].file;

  const drawTabs = () => {
    tabs.innerHTML = data.files
      .map((f) => '<div class="tab' + (f.name === activeFile ? ' active' : '') + '">' +
        f.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>')
      .join('');
  };
  const drawCode = () => { text.textContent = buffers[activeFile]; };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    drawTabs();
    drawCode();
    window.__slidesState = 'typing';
    await sleep(900);
    for (const step of data.steps) {
      if (step.delayMs) await sleep(step.delayMs);
      if (step.file !== activeFile) {
        activeFile = step.file;
        drawTabs();
        drawCode();
        await sleep(400);
      }
      const cps = step.charsPerSec ?? data.charsPerSec;
      for (const ch of step.insert) {
        buffers[activeFile] += ch;
        drawCode();
        // Newlines read like a breath; give them a beat.
        await sleep(ch === '\\n' ? 320 : 1000 / cps);
      }
    }
    await sleep(1500);
    window.__slidesState = 'done';
  })();
</script>
</body>
</html>
`
}

/** Rough clip length estimate, used to size the recorder's safety cap. */
export function estimateDurationMs(t: Tutorial): number {
  const steps = t.steps?.length
    ? t.steps
    : [{ file: '', insert: t.commands ?? '' } as TutorialStep]
  const cps = t.charsPerSec ?? 30
  let ms = 900 + 1500
  for (const s of steps) {
    ms += s.delayMs ?? 0
    const newlines = (s.insert.match(/\n/g) ?? []).length
    ms += newlines * 320 + (s.insert.length - newlines) * (1000 / (s.charsPerSec ?? cps))
  }
  return ms
}
