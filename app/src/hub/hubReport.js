// W2 / owner ruling R2 (2026-09-17) — the owner's phone IS the intake.
//
// ⭐ WHY THIS MODULE IS SEPARATE FROM `gestureTrace.js`, AND WHY THAT IS NOT A DODGE.
// `gestureTrace.js` says in its own header: "NO SINK, NO NETWORK, EVER … nothing in this file may
// POST, fetch, beacon, or write to a server", and adds that this "is not a limitation to be
// engineered around later — it is the reason this instrument was allowed to exist at all."
//
// R2 relaxes that, and the relaxation is deliberately narrow. The recorder stays exactly as pure as
// it was: it records into a ring, resolves nothing, sends nothing. What is new is that a DIFFERENT
// module, on an EXPLICIT tap by an ADMIN, reads the ring's already-public export and posts it to an
// admin-only endpoint. Nothing is sent on a timer, on navigation, on unload, or in the background.
//
// ⛔ SO THE RULE THAT SURVIVES IS THE ONE THAT MATTERED: no analytics, no telemetry, no silent
// collection. A human pressing a button labelled "Report" is not telemetry. If a future change
// makes this fire without a tap, it has broken the spec whatever the file layout says —
// `hubReport.test.js` rails the tap, not the transport.

import { gestureTracePayload } from './gestureTrace.js'
import { ROLLOUT_STAGE } from './rolloutStage.js'
import { routeToModeId } from './hubRoutes.js'
import { showingFromTriple } from './hubShowing'

export const REPORT_ENDPOINT = '/api/hub/reports'
export const NOTE_MAX = 280

/**
 * The PRESENT-IS-NOT-SHOWING triple, measured from the live element.
 *
 * ⚰️ This exists because the programme already published a defect that was not one. `HubRoot` keeps
 * `<div data-testid="hub-root">` in the DOM and sets the HTML `hidden` attribute, so a
 * `querySelector` presence check answers "did React render the container", never "can the member see
 * it" — and a smoke run reported a chart-shell bug on that basis. `offsetParent === null` is not the
 * signal either: the hub is `position: fixed`, so that is null while it is plainly on screen.
 *
 * All three, or the answer is a guess.
 */
export function visibilityTriple(el, win = typeof window !== 'undefined' ? window : undefined) {
  if (!el) return { present: false, hiddenAttr: null, display: null, box: null }
  const cs = win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : null
  const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
  return {
    present: true,
    hiddenAttr: el.hasAttribute ? el.hasAttribute('hidden') : null,
    display: cs ? cs.display : null,
    box: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
  }
}

/**
 * Freeze everything the report needs, AT TAP TIME.
 *
 * ⛔ THE CAPTURE IS SYNCHRONOUS AND HAPPENS BEFORE ANY UI MOVES. The moment a sheet opens, the
 * thing the owner is reporting has already changed — the fan closed, the chip re-rendered, focus
 * moved. A payload assembled when Send is pressed would describe the report form, not the defect.
 */
export function buildReport({
  note = null,
  hubEl = null,
  page = null,
  mode = null,
  flags = {},
  win = typeof window !== 'undefined' ? window : undefined,
  nav = typeof navigator !== 'undefined' ? navigator : undefined,
} = {}) {
  const trimmed = typeof note === 'string' ? note.trim() : null
  const path = page || (win && win.location ? win.location.pathname : null)
  return {
    // `''` never reaches the wire: an empty note and no note are the same fact and must have one
    // spelling (`lesson_chosen_with_nullish_consumed_with_truthiness`).
    note: trimmed ? trimmed.slice(0, NOTE_MAX) : null,
    trace: gestureTracePayload(),
    device: {
      viewport: win ? [win.innerWidth, win.innerHeight] : null,
      dpr: win ? win.devicePixelRatio : null,
      userAgent: nav ? nav.userAgent : null,
    },
    // ⛔ THE TRIPLE IS THE MEASUREMENT; `showing` IS THE VERDICT, and the owner's report needs
    // the verdict. A payload carrying only `{hiddenAttr, display, box}` makes every reader of a
    // report re-derive "was it actually on screen" — and PRESENT IS NOT SHOWING is exactly the
    // inference a tired reader gets wrong. `hubShowing.js` is the single place that judgement is
    // made, shared with the rendering harness so the two cannot drift.
    visibility: (() => {
      const triple = visibilityTriple(hubEl, win)
      return { ...triple, showing: showingFromTriple(triple) }
    })(),
    page: path,
    // ⭐ DERIVED, never passed in. `hubRoutes.routeToModeId` is the one authority on which mode a
    // route belongs to; a `mode` threaded down from the host would be a second spelling of it, and
    // the two would agree right up until the moment they did not.
    mode: mode || (path ? routeToModeId(path) : null) || null,
    stage: ROLLOUT_STAGE,
    flags,
    clientTime: Date.now(),
  }
}

/**
 * POST it. Resolves `{ ok, id }` or `{ ok: false, error }` — never throws.
 *
 * ⛔ NEVER THROWS, ON PURPOSE. This runs from a tap on a phone with one bar of signal. A rejected
 * promise here would surface as an unhandled rejection and the owner would see nothing at all,
 * which is worse than a failed report: he would not know to try again. The caller renders the
 * error.
 */
export async function sendReport(report, fetchImpl = undefined) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!f) return { ok: false, error: 'no fetch in this environment' }
  try {
    const res = await f(REPORT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    })
    if (!res || !res.ok) {
      const status = res ? res.status : 'no response'
      return { ok: false, error: `the server refused the report (${status})` }
    }
    const json = await res.json().catch(() => ({}))
    return { ok: true, id: json.id }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
