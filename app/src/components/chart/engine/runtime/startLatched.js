// app/src/components/chart/engine/runtime/startLatched.js
//
// ─── ⭐⭐ (e103, coordinator ruling 2026-11-27) — WHAT A RUN WITHHOLDS BECAUSE IT LATCHES ITS CHART'S START ─────────
//
// Fred RS (rs-rating-fred6724, `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`) draws three things on its
// newest bar: the RS line's new-high dot (`label.style_circle`, no text) and the two rating labels ("RS Rating" and the
// number). The dot reads the RS line, `close / SP:SPX` times a constant, and `ta.highest` of it over at most 252 bars:
// the same value on a bar whatever bar the chart starts at, once 252 + 250 bars stand behind it. The rating does NOT:
// `var float[] different_values` latches the first 7 distinct seed values the run meets, in the order it meets them
// (lines ~265-304), so where the chart starts decides the levels the rating is read against.
//
// So on a chart whose history does not start at the listing, the run (`runtimeColumns.js::computeStartFree`) serves
// the dots and withholds the rating labels BY NAME, under `RUNTIME_START_LATCHED_GUARD`, never a guess. Every rule here
// is keyed on the script's exact source (`FRED_RS_SOURCE_SHA256`): an edited script is another script and is refused
// as before (`runtime:history-start`).
//
// ⛔ THIS MODULE IMPORTS NOTHING: the run (worker) and the binder both read it.

/** The code a drawing is withheld under when its value latches state from the run's first bar. */
export const RUNTIME_START_LATCHED_GUARD = 'runtime:start-latched-state'

/** What the member reads for it. */
export const START_LATCHED_REASON = "the rating needs the stock's full history; it's shown on daily charts that "
  + 'reach the listing'

/** sha256 of Fred RS's source, the house indicator (`runtimeKill.js::runtimeSourceHash` of the file above). */
export const FRED_RS_SOURCE_SHA256 = 'caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0'

/** How many bars a chart must hold, and the first bar (0-based) whose values are served: 252 bars of the longest
 *  look-back (`n252`, `input.int(... maxval = 252)`) plus the 250-bar new-high look-back. Bars [0, 501) are withheld. */
export const START_FREE_MIN_BARS = 502
export const START_FREE_FROM_BAR = START_FREE_MIN_BARS - 1

/** Is `o` (a run drawing, `objectStore.finish().live[]`) one of Fred RS's start-free dots: a label drawn as a circle,
 *  with no text, made on a bar whose look-back is start-free? */
export function isStartFreeDot(o) {
  if (!o || o.family !== 'label' || !o.props || typeof o.props !== 'object') return false
  if (!Number.isInteger(o.createdBar) || o.createdBar < START_FREE_FROM_BAR) return false
  const style = o.props.style
  if (typeof style !== 'string' || !/(^|[._])circle$/.test(style)) return false
  const text = o.props.text
  return text === undefined || text === null || text === ''
}

/** The record a run that withheld its start-latched drawings carries on its payload (`startLatched`), or null. */
export function startLatchedOf(payload) {
  const r = payload && typeof payload === 'object' ? payload.startLatched : null
  return r && typeof r === 'object' && r.guard === RUNTIME_START_LATCHED_GUARD ? r : null
}
