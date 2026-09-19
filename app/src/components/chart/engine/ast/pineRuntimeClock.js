// app/src/components/chart/engine/ast/pineRuntimeClock.js
//
// ─── ⭐⭐ T4 — THE `newestBarIsForming` PRODUCER FOR THE RUNTIME LANE ────────
//
// Ruling 3.3 made `buildRuntimeIr` REFUSE a script that reads a realtime
// `barstate.*` column while nothing tells this lane whether the newest bar has
// finished. That refusal is correct and it is not the end state: the value
// exists, it crosses the seam already, and nothing in `app/src` was handing it
// to THIS lane. This module is that hand-off, and nothing else.
//
// ⛔⛔ IT COMPUTES NOTHING. No calendar, no `Date.now()`, no timeframe arithmetic.
// The tri-state is settled ONCE per fetch by `indicator_compute.py::bar_close_state`
// — on the side the NYSE calendar lives (`bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` +
// `liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD`) — and `/api/bars` attaches it as
// `newest_bar_is_forming`. `indicators.js::computeClock` says the same thing in its
// own words: *"the seam carries the tri-state; the calendar does not cross it"*.
// Restating either date set in JavaScript would be a second authority over one
// value in a second language, where the two drift silently and each looks correct.
//
// ⭐ SO THIS IS AN ADAPTER, AND ADAPTERS ARE WHERE THIS LANE KEEPS LOSING VALUES.
// `barCloseStateWire.test.js` exists because the native lane's adapter dropped
// exactly this field for months and every other suite stayed green: the four
// realtime columns rendered blank, which is neither a crash nor a wrong number.
// This module is the runtime lane's copy of that wire, written as a function so
// there is one place to test rather than a line in a call site.
//
// ⚠️ NOTHING HERE READS THE WALL CLOCK, for the reason `computeClock` gives: two
// bindings of one fetch must agree bar for bar, and a function that read
// `Date.now()` could not be asked the same question twice.

/** ⛔ THE THREE SPELLINGS THE VALUE ARRIVES UNDER, and no more.
 *
 *  `/api/bars` sends snake_case (`newest_bar_is_forming`); `StockChart` hands the
 *  binder camelCase (`newestBarIsForming`); `interpret` reads it off `interpretOpts`.
 *  A reader that knew only one of them would work in one caller and fail closed in
 *  the next — which is the same silence this whole module exists to end. */
const KEYS = Object.freeze(['newestBarIsForming', 'newest_bar_is_forming'])

/** The tri-state, read out of whatever the fetch handed the caller.
 *
 *  ⛔⛔ `undefined` BECOMES `null`, NEVER `false`. `null` means NOBODY TOLD ME and
 *  blanks the four realtime columns; `false` asserts the newest bar has SETTLED
 *  and hands the column layer a confident `isconfirmed = 1` on a bar that may
 *  still be open. That is the one wrong answer these columns exist to prevent,
 *  and a server that has not shipped the field yet sends `undefined`.
 *
 *  ⭐ IT ALSO REFUSES A NON-BOOLEAN. A string `"false"` is truthy in JavaScript,
 *  and a payload that ever carried one would flip the meaning of the column
 *  silently; anything that is not a real boolean is UNKNOWN.
 *
 *  @param {object|null} payload a bars response, a chart ctx, or an opts object
 *  @returns {boolean|null} true / false / null-for-unknown
 */
export function newestBarIsFormingFrom(payload) {
  if (!payload || typeof payload !== 'object') return null
  for (const k of KEYS) {
    const v = payload[k]
    if (v === true || v === false) return v
  }
  // one level down, because callers hand us the whole ctx as often as the payload
  const nested = payload.interpretOpts
  if (nested && typeof nested === 'object') {
    for (const k of KEYS) {
      const v = nested[k]
      if (v === true || v === false) return v
    }
  }
  return null
}

/** The options fragment `buildRuntimeIr` needs, built from ONE value.
 *
 *  ⛔⛔ IT SETS BOTH KEYS, AND THAT IS THE POINT OF THE FUNCTION. `buildRuntimeIr`
 *  lifts the 3.3 refusal when EITHER `opts.newestBarIsForming` or
 *  `opts.interpretOpts.newestBarIsForming` is non-null, but the COLUMNS are
 *  evaluated from `interpretOpts` alone. A caller that set only the top-level key
 *  would therefore satisfy the gate and still render four blank columns — the
 *  exact failure ruling 3.3 was written to prevent, arriving through the gate the
 *  ruling installed. One value in, both keys out, so the two cannot disagree.
 *
 *  @param {boolean|null} forming the tri-state
 *  @param {object} [extra] anything else the caller already passes to `interpret`
 */
export function runtimeClockOpts(forming, extra = {}) {
  const value = forming === true || forming === false ? forming : null
  return {
    newestBarIsForming: value,
    interpretOpts: { ...extra, newestBarIsForming: value },
  }
}

/** The same, straight from a fetch payload — the one call a door should need. */
export function runtimeClockOptsFrom(payload, extra = {}) {
  return runtimeClockOpts(newestBarIsFormingFrom(payload), extra)
}

/** Which bars are still forming, one entry per bar.
 *
 *  ⭐ DERIVED FROM THE DECLARATION, NOT FROM A RULE WRITTEN HERE.
 *  `closedTable.json::_barstate._realtime` states it: *"ONLY THE NEWEST BAR CAN BE
 *  `isrealtime`. Every earlier bar's period ended before the newest one's began"*.
 *  So a closed series answers `false` on every bar including its last, and a live
 *  one answers `true` on exactly one bar — the last — and `false` before it.
 *
 *  ⛔ UNKNOWN PROPAGATES. If the tri-state is `null` every bar is `null`: an
 *  unknown newest bar makes the whole column unanswerable rather than making the
 *  history confidently closed, because "this bar is not the newest" and "this bar
 *  has finished" are the same sentence only when we know what the newest bar did.
 */
export function formingByBar(bars, forming) {
  const n = bars && bars.length ? bars.length : 0
  if (!n) return []
  const value = forming === true || forming === false ? forming : null
  if (value === null) return new Array(n).fill(null)
  const out = new Array(n).fill(false)
  if (value === true) out[n - 1] = true
  return out
}
