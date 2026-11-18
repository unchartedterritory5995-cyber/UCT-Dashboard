// IDAY: the latest AI-written intraday market update, the pure half (no React and no imports, so an
// agent capability can reuse it and args.js could take from it without pulling a panel in).
//
// ⭐ NO NEW ROUTE. `GET /api/intraday-update` (api/routers/engine_data.py). Its one reader was the
// dashboard's IntradayPulse bar, which lost its mount in the dashboard rework, so until this panel
// no screen showed it.
//
// GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
// SPEED  The route returns one in-memory cache entry (`cache.get`). It builds nothing on the
//        request, so a cold cache answers `{}` at once; it cannot be slow.
//
// WHAT IT IS  The UCT Intelligence engine (an AI model run on a schedule, not a person) reads the
// market three times a session: after the open (about 9:45 AM ET), at midday (12:00 PM) and before
// the close (2:30 PM). Each run posts one small update to `POST /api/push/intraday`
// (api/routers/push.py), which stores it AS SENT under one cache key for 4 HOURS. Nothing on the
// server checks, edits or adds to it. Every word in it is the model's own.
//
// WHAT THE ROUTE ANSWERS
//   {}          nothing in the cache: no run in the last 4 hours (overnight, a weekend, before the
//               first run of the day), or the server restarted since (the cache is in memory).
//   an update   an object with `mode` ('open' | 'midday' | 'preclose'), `timestamp` (ISO instant,
//               New York offset), `date` ('YYYY-MM-DD'), `session_notes` (text), `regime`
//               (`phase` and `notes` are read here) and other keys this model never reads.
//
// ⛔ OWNER RULING 2026-11-17: THE MARKET PHASE AND THE SESSION NOTE ONLY. `intradayRead` reads
// `mode`, `timestamp`, `date`, `session_notes`, `regime.phase` and `regime.notes`, and nothing
// else. Every other key of the update (its per-stock list, its own scores and counts) is never
// read, so it cannot reach the view, the panel or an agent that reuses this file. The view is
// built key by key, never by spreading the body.
// ⛔ IT IS AI-WRITTEN TEXT, AND THE PANEL SAYS SO AND SAYS WHEN. `intradayRead` returns strings and
// nothing else: the panel draws them as text, never as markup.
// ⛔ A MISSING UPDATE IS NOT A FAILED READ, and neither is an error. `{}` is state 'none'; a body
// that is not this route's shape is 'failed'.

/** The terminal code this panel is proposed under (the panel reads the live one from its frame). */
export const INTRADAY_UPDATE_CODE = 'IDAY'
export const INTRADAY_UPDATE_URL = '/api/intraday-update'
/** The server keeps one update this long after it arrives (push.py `ttl=14400`). */
export const INTRADAY_KEEP_HOURS = 4
/** Three updates a session, so the panel asks again at this pace (SWR skips ticks while hidden). */
export const INTRADAY_POLL_MS = 5 * 60 * 1000
/** The longest note this panel draws; a longer one is cut here and the panel says so. */
export const NOTE_MAX = 1000
/** The phase is one or two words ("Uptrend"); anything longer is cut here. */
const PHASE_MAX = 60

/** The three scheduled runs, in session order. `when` is the run as it reads mid-sentence. */
export const INTRADAY_MODES = Object.freeze({
  open: Object.freeze({ label: 'After the open', when: 'after the open', due: 'about 9:45 AM ET' }),
  midday: Object.freeze({ label: 'Midday', when: 'at midday', due: '12:00 PM ET' }),
  preclose: Object.freeze({ label: 'Before the close', when: 'before the close', due: '2:30 PM ET' }),
})

/** The keys that mark a body as this route's update (the only top-level keys this model reads). */
const UPDATE_KEYS = Object.freeze(['mode', 'timestamp', 'session_notes', 'regime'])

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
/** One line of plain text: control characters dropped, runs of white space made one space. */
function plain(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  let out = ''
  for (const ch of String(v)) {
    const c = ch.codePointAt(0)
    out += c < 32 || c === 127 ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Pure: the writer's timestamp as an ISO instant (UTC), or null. The writer sends microseconds
 * (`2026-11-17T12:00:31.123456-05:00`); they are trimmed to milliseconds before parsing, and a
 * stamp with no zone is refused rather than read in the reader's own zone.
 */
export function writtenAtOf(raw) {
  const t = plain(raw)
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(t)
  if (!m) return null
  const zone = m[3] === 'Z' ? 'Z' : `${m[3].slice(0, 3)}:${m[3].slice(-2)}`
  const d = new Date(`${m[1]}${m[2] ? m[2].slice(0, 4) : ''}${zone}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Pure: the route's answer as the panel needs it.
 *   state        'ok' (an update) | 'none' (the route's `{}`: nothing on hand) | 'failed' (not this
 *                route's answer at all)
 *   mode         'open' | 'midday' | 'preclose', or null for a mode this panel does not know
 *   modeLabel, modeDue   that run in plain words, and when it is scheduled (null with the mode)
 *   writtenAt    when the model wrote it, as an ISO instant, or null when the stamp does not read
 *   day          the session day the writer sent ('YYYY-MM-DD'), or null
 *   phase        the model's one-word read of the market phase, or null
 *   phaseNote    the model's note on that read (cut at NOTE_MAX; `phaseNoteCut` says so)
 *   sessionNote  the model's note on the session (cut at NOTE_MAX; `sessionNoteCut` says so)
 *   hasText      true when there is anything to read (a phase or a note)
 * Nothing else of the update is carried.
 */
export function intradayRead(body) {
  const none = {
    state: 'failed', mode: null, modeLabel: null, modeDue: null, writtenAt: null, day: null, phase: null, phaseNote: null,
    phaseNoteCut: false, sessionNote: null, sessionNoteCut: false, hasText: false,
  }
  if (!isObj(body)) return none
  if (Object.keys(body).length === 0) return { ...none, state: 'none' }
  if (!UPDATE_KEYS.some((k) => k in body)) return none
  const modeKey = plain(body.mode).toLowerCase()
  const mode = own(INTRADAY_MODES, modeKey) ? modeKey : null
  const regime = isObj(body.regime) ? body.regime : {}
  const phaseNoteAll = plain(regime.notes)
  const sessionNoteAll = plain(body.session_notes)
  const day = plain(body.date)
  const out = {
    state: 'ok',
    mode,
    modeLabel: mode ? INTRADAY_MODES[mode].label : null,
    modeDue: mode ? INTRADAY_MODES[mode].due : null,
    writtenAt: writtenAtOf(body.timestamp),
    day: DAY.test(day) ? day : null,
    phase: plain(regime.phase).slice(0, PHASE_MAX) || null,
    phaseNote: phaseNoteAll ? phaseNoteAll.slice(0, NOTE_MAX) : null,
    phaseNoteCut: phaseNoteAll.length > NOTE_MAX,
    sessionNote: sessionNoteAll ? sessionNoteAll.slice(0, NOTE_MAX) : null,
    sessionNoteCut: sessionNoteAll.length > NOTE_MAX,
  }
  return { ...out, hasText: !!(out.phase || out.phaseNote || out.sessionNote) }
}
