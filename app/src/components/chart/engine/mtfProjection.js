/**
 * HIGHER-TIMEFRAME RESULTS ONTO A LOWER-TIMEFRAME CHART — without lookahead.
 *
 * A 1D EMA on a 5m chart is computed from canonical DAILY bars (the binder does
 * that); this module decides which daily value each 5m bar may show.
 *
 * ⛔⛔ THE RULE IS UCT'S EXISTING ONE, NOT A NEW ONE: A CHART BAR SHOWS THE VALUE OF
 * THE LAST HIGHER-TIMEFRAME PERIOD THAT HAD CLOSED BEFORE THE CHART BAR'S OWN
 * PERIOD BEGAN. It is the formula engine's `tf` node (`ast/interpret.js` — "a base
 * bar in bucket `b` reads bucket `b - 1`") and the Pine runtime's `runRequest`
 * (`runtime/vm.js` — "the requested bar must be strictly earlier than the chart
 * bar", measured against TradingView). So:
 *   · Monday..Friday of week W show week W-1's weekly value — never Friday's
 *     completed close on Monday;
 *   · every 5m bar of day D shows day D-1's daily value — never D's own final close
 *     at 10:30;
 *   · the FORMING higher-timeframe bar is never shown (COMPLETED semantics).
 * The step therefore lands on the FIRST chart bar of each new period — the classic
 * stair-step — and a chart bar can never show a number that did not exist yet.
 *
 * ⛔ NO INTERPOLATION, EVER. Every chart bar carries the HELD value of its applicable
 * period; nothing between two observations is invented. `Line` and `Step` plot
 * styles draw this same column — Step with vertical risers, Line with the ordinary
 * segment between the last bar of one period and the first of the next (which lies
 * BETWEEN bars, so no bar is assigned an in-between value).
 *
 * ⛔ STALENESS IS NaN, NEVER THE LAST VALUE HELD FOREVER. The frame bars are a
 * snapshot (`secondaryBars` caches one fetch). Two things make a held value a lie:
 *   1. the chart has bars in a period the snapshot does not know has closed — the
 *      chart's own previous period is the WITNESS: if the frame has no completed bar
 *      at least that recent, the frame is behind the chart;
 *   2. the newest frame bar was FORMING when fetched (`newest_bar_is_forming`) — its
 *      value is a partial period, and it cannot become "completed" by waiting.
 * Either way the bar reads NaN (a gap, which every renderer and legend already
 * understands) and `stale` is reported so the caller can refetch. Unknown
 * (`null`) finality is treated as forming — fail closed, as the clock does.
 *
 * ⛔ TIMESTAMPS, NEVER ARRAY INDEX. Periods are derived from each bar's own time in
 * America/New_York (DST-correct via `Intl`), and the trading calendar is the bars'
 * own: a holiday is simply a day with no bar, a short week is a week with four.
 */

// ─── dates ──────────────────────────────────────────────────────────────────

const ET_FMT = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return null }
})()

const _etDateByHour = new Map()

/** The America/New_York calendar date ('YYYY-MM-DD') of a bar time: an ISO string
 *  (D/W/M bars), a YYYYMMDD integer (the store's format), or unix seconds. */
export function etDateOf(t) {
  if (typeof t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
    return null
  }
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  if (t >= 19000101 && t <= 21001231) {
    const s = String(Math.floor(t))
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  const sec = t > 1e11 ? Math.floor(t / 1000) : Math.floor(t)
  // ⭐ ET offsets change only on whole hours, so the date is constant within an
  // hour — one `Intl` call per hour of bars rather than per bar.
  const hour = Math.floor(sec / 3600)
  let hit = _etDateByHour.get(hour)
  if (hit === undefined) {
    const d = new Date(hour * 3600 * 1000)
    hit = ET_FMT ? ET_FMT.format(d) : d.toISOString().slice(0, 10)
    if (_etDateByHour.size > 50000) _etDateByHour.clear()
    _etDateByHour.set(hour, hit)
  }
  return hit
}

function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(z) {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return [m <= 2 ? y + 1 : y, m, d]
}

const pad = (n) => String(n).padStart(2, '0')

/** The Monday of `iso`'s ISO week, as 'YYYY-MM-DD' — a SORTABLE week key (the
 *  formula engine's `YYYY-Www` is not zero-padded, so it cannot be compared). A
 *  weekly bar labelled by its Friday and a Tuesday of that week share it. */
export function weekKeyOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const z = daysFromCivil(y, m, d)
  const dow = (((z + 3) % 7) + 7) % 7          // Mon=0 … Sun=6 (1970-01-01 was a Thursday)
  const [yy, mm, dd] = civilFromDays(z - dow)
  return `${yy}-${pad(mm)}-${pad(dd)}`
}

/** The period key of an ISO date at a D / W / M frame. Keys sort as strings. */
export function periodKeyOf(iso, frame) {
  if (!iso) return null
  if (frame === 'W') return weekKeyOf(iso)
  if (frame === 'M') return iso.slice(0, 7)
  return iso
}

const isDwm = (code) => code === 'D' || code === 'W' || code === 'M'
const INTRADAY_MINUTES = { 1: 1, 5: 5, 15: 15, 30: 30, 60: 60 }

/** The date a CHART bar's period BEGINS on. A weekly chart bar is labelled by its
 *  Friday; the period began on its Monday, and that is the date that decides which
 *  month had already closed when it opened. */
function chartRefDate(t, chartTf) {
  const iso = etDateOf(t)
  if (!iso) return null
  return chartTf === 'W' ? weekKeyOf(iso) : iso
}

// ─── the projection ─────────────────────────────────────────────────────────

/**
 * @param {object[]} frameBars   the higher timeframe's canonical bars, ascending
 * @param {Object<string, ArrayLike<number>>} columns  plotKey → column aligned to frameBars
 * @param {string}   frame       the calculation timeframe ('D','W','M','60',…)
 * @param {object[]} chartBars   the chart's bars, ascending
 * @param {string}   chartTf     the chart's timeframe
 * @param {{newestFinal?: boolean|null}} [opts] `newestFinal` is the frame payload's
 *   `newest_bar_is_forming === false`; anything else means the newest frame bar is
 *   not proven complete.
 * @returns {{columns: Object<string, Float64Array>, stale: boolean}}
 */
export function projectFrameColumns(frameBars, columns, frame, chartBars, chartTf, opts) {
  const n = Array.isArray(chartBars) ? chartBars.length : 0
  const out = {}
  const keys = Object.keys(columns || {})
  for (const k of keys) out[k] = new Float64Array(n).fill(NaN)
  const fb = Array.isArray(frameBars) ? frameBars : []
  const m = fb.length
  if (!n || !m || !keys.length) return { columns: out, stale: false }
  const newestFinal = !!(opts && opts.newestFinal === true)
  const pick = isDwm(frame)
    ? dwmIndices(fb, frame, chartBars, chartTf)
    : intradayIndices(fb, frame, chartBars)
  let stale = pick.stale
  for (let i = 0; i < n; i++) {
    const j = pick.at[i]
    if (j < 0) continue
    // ⛔ THE NEWEST FRAME BAR IS ONLY "COMPLETED" IF THE SERVER SAID SO.
    if (j === m - 1 && !newestFinal) { stale = true; continue }
    for (const k of keys) {
      const col = columns[k]
      const v = col ? Number(col[j]) : NaN
      if (Number.isFinite(v)) out[k][i] = v
    }
  }
  return { columns: out, stale }
}

/** D/W/M frames: key-based. `at[i]` = the frame index to show, or -1. */
function dwmIndices(fb, frame, chartBars, chartTf) {
  const m = fb.length
  const fk = new Array(m)
  for (let j = 0; j < m; j++) fk[j] = periodKeyOf(etDateOf(fb[j] && fb[j].t), frame)
  const n = chartBars.length
  const at = new Int32Array(n).fill(-1)
  let stale = false
  let j = -1            // last frame index with key < current chart key
  let curKey = null
  let prevKey = null    // the chart's previous period (the witness)
  for (let i = 0; i < n; i++) {
    const ck = periodKeyOf(chartRefDate(chartBars[i] && chartBars[i].t, chartTf), frame)
    if (!ck) continue
    if (ck !== curKey) {
      if (curKey !== null && curKey < ck) prevKey = curKey
      curKey = ck
    }
    while (j + 1 < m && fk[j + 1] !== null && fk[j + 1] < ck) j++
    if (j < 0) continue
    // ⛔ THE WITNESS: the chart shows a period (prevKey) that closed before this
    // bar's; the frame must have a completed bar at least that recent.
    if (prevKey !== null && fk[j] < prevKey) { stale = true; continue }
    at[i] = j
  }
  return { at, stale }
}

/** Intraday frames: time-based. A frame bar is closed at
 *  `min(start + frame minutes, next frame bar's start)`; a chart bar may show the
 *  newest frame bar closed at or before the chart bar's START. */
function intradayIndices(fb, frame, chartBars) {
  const m = fb.length
  const span = (INTRADAY_MINUTES[frame] || Number(frame) || 60) * 60
  const start = new Float64Array(m)
  const end = new Float64Array(m)
  for (let j = 0; j < m; j++) start[j] = toSec(fb[j] && fb[j].t)
  for (let j = 0; j < m; j++) {
    const nominal = start[j] + span
    end[j] = j + 1 < m && Number.isFinite(start[j + 1]) ? Math.min(nominal, start[j + 1]) : nominal
  }
  // ⚠️ THE FALLBACK GRID IS THE SERVER'S: 60-minute bars are anchored to the 09:30
  // open (`barTime.js`), so their periods start at :30 — ET offsets are whole hours,
  // so ET :30 is UTC :30. 1/5/15/30 divide 09:30 evenly and are clock-aligned.
  const offset = span === 3600 ? 1800 : 0
  const gridEnd = (t) => Math.floor((t - offset) / span) * span + offset + span
  const n = chartBars.length
  const at = new Int32Array(n).fill(-1)
  let stale = false
  let j = -1               // newest frame bar CLOSED by this chart bar's start
  let k = -1               // newest frame bar STARTED by the previous chart bar
  let lastClosedEnd = -Infinity
  for (let i = 0; i < n; i++) {
    const t = toSec(chartBars[i] && chartBars[i].t)
    if (!Number.isFinite(t)) continue
    // ⛔ THE WITNESS. The previous chart bar sat in some frame period; if that period
    // has closed by now, the frame must hold a completed bar at least that recent.
    // Its end comes from the frame's own bar when the snapshot has it, and from the
    // server's grid when it does not (which is exactly the case being detected).
    if (i > 0) {
      const prevT = toSec(chartBars[i - 1] && chartBars[i - 1].t)
      if (Number.isFinite(prevT)) {
        while (k + 1 < m && Number.isFinite(start[k + 1]) && start[k + 1] <= prevT) k++
        const pe = (k >= 0 && prevT < end[k]) ? end[k] : gridEnd(prevT)
        if (pe <= t && pe > lastClosedEnd) lastClosedEnd = pe
      }
    }
    while (j + 1 < m && Number.isFinite(end[j + 1]) && end[j + 1] <= t) j++
    if (j < 0) continue
    if (lastClosedEnd > -Infinity && end[j] < lastClosedEnd) { stale = true; continue }
    at[i] = j
  }
  return { at, stale }
}

function toSec(t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return NaN
  return t > 1e11 ? Math.floor(t / 1000) : t
}

/** The key a calculation frame's bars are held under (`useCalcFrames`' map). */
export function frameKey(frame, symbol) {
  return `${frame}|${String(symbol || '').toUpperCase()}`
}

/** Is a frame's bar time format compatible with this projector? D/W/M frames need
 *  dated bars; intraday frames need unix times. */
export function frameBarsUsable(frameBars, frame) {
  const b = Array.isArray(frameBars) && frameBars.length ? frameBars[frameBars.length - 1] : null
  if (!b) return false
  return isDwm(frame) ? etDateOf(b.t) !== null : Number.isFinite(toSec(b.t))
}
