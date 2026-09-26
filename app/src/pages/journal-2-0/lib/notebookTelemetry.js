/**
 * Notebook telemetry — the ONE door for the Notebook's core-action events
 * (wave 6, D14). It wraps the existing `POST /api/j2/telemetry`.
 *
 * ⛔ EVERY NAME IN `NOTEBOOK_EVENTS` MUST ALSO BE IN `_J2_TELEMETRY_EVENTS`
 * (`api/routers/journal_two.py`), or the POST is a 400 and the count is
 * silently zero — which reads exactly like "nobody used it".
 * `tests/test_notebook_telemetry_events.py` reads the names out of THIS file
 * and asserts each one is accepted; nothing restates them.
 *
 * ⛔ NEVER NOTE CONTENT, AND NEVER WHAT A MEMBER TYPED. Every event has a
 * SCHEMA below: a prop not on it is dropped, a number must be finite, and a
 * string prop is kept ONLY if it is one of that prop's enumerated values —
 * anything else becomes 'other'. So a caller who passes a search query, a note
 * title or an Ask question in a string prop sends 'other', never the text.
 * (A free-form "short string" rule would not do: a search for "nvda" is a
 * perfectly short string.)
 *
 * Best-effort by contract: it never throws into a caller and never blocks one.
 * An instrument that can break the thing it measures is worse than none.
 *
 * Call sites are wired by the owning lanes, not here — see the wave-6 F report.
 */

export const NOTEBOOK_EVENTS = Object.freeze({
  NOTE_OPEN_MS: 'note_open_ms',
  SAVE_FAILED: 'save_failed',
  CONFLICT_FORKED: 'conflict_forked',
  ASK_USED: 'ask_used',
  CAPTURE_USED: 'capture_used',
  SEARCH_USED: 'search_used',
  SWITCHER_USED: 'switcher_used',
})

const OTHER = 'other'
const num = { type: 'number' }
const bool = { type: 'bool' }
const oneOf = (...values) => ({ type: 'enum', values: new Set(values) })

/** Per-event prop schemas. A key not listed here never leaves the browser. */
export const EVENT_SCHEMAS = Object.freeze({
  note_open_ms: {
    ms: num,
    source: oneOf('list', 'switcher', 'link', 'search', 'deeplink', 'new', 'tasks', 'mention'),
    cached: bool,
  },
  save_failed: {
    status: num,
    reason: oneOf('network', 'http', 'conflict', 'quota', 'offline', 'too-large', 'unknown'),
    offline: bool,
    retrying: bool,
  },
  conflict_forked: {
    door: oneOf('editor', 'outbox', 'restore', 'board', 'capture', 'import', 'unknown'),
    queued: bool,
  },
  ask_used: {
    scope: oneOf('note', 'notebook', 'selection'),
    inserted: bool,
    ms: num,
  },
  capture_used: {
    target: oneOf('current', 'new', 'inbox'),
    widget: oneOf('chart', 'widget', 'fact', 'excerpt', 'web', 'quote', 'unknown'),
  },
  search_used: {
    results: num,
    filters: num,
    mode: oneOf('text', 'tag', 'ticker', 'filter'),
    ms: num,
  },
  switcher_used: {
    results: num,
    rank: num,
    picked: bool,
    mode: oneOf('title', 'recent', 'favorite', 'create'),
  },
})

const KNOWN = new Set(Object.values(NOTEBOOK_EVENTS))

/** The props this event may carry, cleaned. Pure — the rail reads it. */
export function sanitizeProps(event, props) {
  const schema = EVENT_SCHEMAS[event]
  if (!schema || !props || typeof props !== 'object') return {}
  const out = {}
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue
    const v = props[key]
    if (spec.type === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.round(v)
    } else if (spec.type === 'bool') {
      if (typeof v === 'boolean') out[key] = v
    } else if (spec.type === 'enum') {
      out[key] = typeof v === 'string' && spec.values.has(v) ? v : OTHER
    }
  }
  return out
}

/**
 * Send one event. Unknown names are not sent (they would 400 anyway).
 * @returns the props actually sent, or null when nothing was sent
 */
export function trackNotebookEvent(event, props, { fetchImpl } = {}) {
  if (!KNOWN.has(event)) return null
  const clean = sanitizeProps(event, props)
  const f = fetchImpl || globalThis.fetch
  try {
    const p = f('/api/j2/telemetry', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props: clean }),
    })
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch { /* the action being measured already happened */ }
  return clean
}

/**
 * `note_open_ms` helper: start when the member asks for a note, stop when its
 * content is on screen. `stop()` fires at most once, so a re-render that calls
 * it again cannot double-count an open.
 */
export function startNoteOpenTimer({ now, fetchImpl } = {}) {
  const clock = now || (() => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()))
  const t0 = clock()
  let done = false
  return function stop(props = {}) {
    if (done) return null
    done = true
    return trackNotebookEvent(NOTEBOOK_EVENTS.NOTE_OPEN_MS, { ...props, ms: clock() - t0 }, { fetchImpl })
  }
}
