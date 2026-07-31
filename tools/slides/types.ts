// Data shapes for dynamically generated coding-tutorial videos.
//
// The base `Tutorial` shape intentionally mirrors the JSON schema from
// pablo.gg's "Creating Instagram Reels coding tutorials automatically with
// OpenAI's GPT" (description / commands / files), so scripts generated the
// way that post describes drop straight in. The `steps` extension is the
// forward path for the planned VS Code plugin (incl. GitHub Codespaces):
// instead of one blob of code typed start-to-finish, an editor session is
// replayed as timed events — the plugin records them, POSTs a Tutorial to
// the app's /api/jobs endpoint, and the same renderer + recorder turn it
// into a clip.

export interface TutorialFile {
  name: string
  /** Starting content; empty for the file the tutorial types into. */
  content: string
}

export interface TutorialStep {
  /** File the step applies to (must exist in `files`). */
  file: string
  /** Text appended by this step (typed character by character). */
  insert: string
  /** Pause before the step starts, ms. */
  delayMs?: number
  /** Typing cadence override for this step, chars/second. */
  charsPerSec?: number
}

export interface Tutorial {
  /** Caption / tagline — also reused as the social-post caption. */
  description: string
  /** Code typed into the editor, start to finish (simple mode). */
  commands?: string
  files: TutorialFile[]
  /** Timed editor events (future VS Code plugin mode). Overrides commands. */
  steps?: TutorialStep[]
  /** Global typing cadence, chars/second (default 30). */
  charsPerSec?: number
}

export function validateTutorial(raw: unknown): Tutorial {
  const t = raw as Tutorial
  if (!t || typeof t !== 'object') throw new Error('tutorial: not an object')
  if (typeof t.description !== 'string') throw new Error('tutorial: missing description')
  if (!Array.isArray(t.files) || t.files.length === 0) {
    throw new Error('tutorial: files must be a non-empty array')
  }
  for (const f of t.files) {
    if (typeof f.name !== 'string' || typeof f.content !== 'string') {
      throw new Error('tutorial: each file needs { name, content }')
    }
  }
  if (!t.commands && !t.steps?.length) {
    throw new Error('tutorial: needs either commands or steps')
  }
  if (t.steps) {
    const names = new Set(t.files.map((f) => f.name))
    for (const s of t.steps) {
      if (!names.has(s.file)) throw new Error(`tutorial: step targets unknown file ${s.file}`)
      if (typeof s.insert !== 'string') throw new Error('tutorial: step.insert must be a string')
    }
  }
  return t
}
