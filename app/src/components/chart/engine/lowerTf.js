// app/src/components/chart/engine/lowerTf.js
//
// ─── ⭐⭐ C27 — `request.security` / `request.security_lower_tf` AT A TIMEFRAME
//     BELOW THE CHART'S OWN (intraday bars read from a daily chart) ───────────────
//
// THE ONE PLACE THE LOWER-TIMEFRAME RULES ARE STATED. `pine.js` asks
// `lowerTfRefusal` why a request is not served (and says so by name); the reading
// itself — which intraday bars, bucketed how, mapped onto which chart bar, and
// when a chart bar is UNKNOWN — is `intrabarSeries` / `intrabarGroups` /
// `readLowerTf` below. Nothing else restates any of it.
//
// ── WHAT PINE MEANS ───────────────────────────────────────────────────────────
//   (a) `request.security(sym, lowerTf, expr)` on a higher-timeframe chart: `expr`
//       is evaluated on the lower-timeframe bars (their own history, their own
//       recurrences) and each chart bar reads its LAST intrabar's value (Pine's
//       documented rule for a lower-timeframe `request.security`, lookahead off).
//   (b) `request.security_lower_tf(sym, tf, expr)`: the ARRAY of `expr` over every
//       intrabar inside the chart bar, in time order (`intrabarArrays`).
//
// ── WHAT IS WITNESSED ON VENDOR BARS (committed captures, replayed in
//    `vendorHarness.c27LowerTf.test.js`) ────────────────────────────────────────
//   * BUCKETING. TradingView's regular-session 60m bars open at 09:30, 10:30, …,
//     15:30 (the last one 30 minutes), NOT on the clock hour, and each is exactly
//     the aggregate of the regular-session 5m bars inside it: 12 of 12 complete
//     buckets equal OHLCV (`vw-clock-vwap-spy-5-ext-2026-09-28` against
//     `vw-time-session-spy-60-rth-2026-09-28`, 2026-09-24/25). ⛔ OUR STORE'S `tf=60`
//     IS CLOCK-ALIGNED (09:30–10:00, 10:00–11:00, … — `bars_fetch.py::
//     bucket_60_et_unix_seconds`), so a `"60"` read is built here from the store's
//     `tf=15` bars, bucketed from the session open (`LOWER_TF_SOURCE`).
//   * THE CHART'S DAILY BAR IS NOT THE AGGREGATE OF ITS INTRADAY BARS. SPY 1D vs its
//     own regular-session 60m bars, 2,951 sessions 2015–2026: close equal on 190,
//     open on 2,023, high on 2,792, low on 2,786 (`vw-bool-cast-spy-1d` /
//     `vw-bool-cast-spy-60`, 2026-09-28). So a lower-timeframe read can never be
//     derived from the daily bars in hand — it needs the intraday bars — and it is
//     a DIFFERENT number from the chart's own `close` on ~94 % of days.
//   * THE CHART SESSION. A 1D chart's symbol reports the regular session
//     (`symbol.session` `0930-1600` in every SPY 1D capture); with extended hours
//     on, a 60m chart reports `0400-2000`.
//
// ── WHAT IS NOT WITNESSED, AND WHY NOTHING IS SERVED YET ─────────────────────────
//   `LOWER_TF_WITNESS` names the capture each rule rests on. Two rows have none:
//   no committed capture holds a lower-timeframe `request.security` read ON a
//   higher-timeframe chart, so (i) which intrabar it answers (documented: the
//   last) and (ii) which session's intrabars a 1D chart's request reads (the
//   chart symbol's regular session is the documented reading; extended hours
//   would change every value) are Pine's documentation, not measurements. Until a
//   capture pins both, every lower-timeframe request is REFUSED BY NAME
//   (`lower-tf:unwitnessed`) at the member door, and the capture that settles it
//   is named in the refusal (`docs/pine/capture-queue-2026-09-30-lower-tf.md`).
//
// ── WHERE THE BARS COME FROM ─────────────────────────────────────────────────────
//   In the product (once served): the chart's OWN ticker at the store timeframe
//   `LOWER_TF_SOURCE[code]` — `GET /api/bars/{ticker}?tf=<source>` through the same
//   secondary-bars cache a `sym:` source uses (`secondaryBars.js::ensureAll`), the
//   depth from `lowerTfFetchPlan`. The store's intraday bars include extended
//   hours; `intrabarSeries` keeps only TradingView's regular session for the day
//   (`tradingViewCloseMinute`: 16:00, 13:00 on a half-day it applies). In the
//   vendor harness: only from committed captures.
//
// ── COVERAGE: A CHART BAR IS KNOWN ONLY WHOLE, NEVER PARTIAL ──────────────────────
//   Intraday history is far shorter than daily. A chart bar is UNKNOWN (never
//   `na`: `nz` would turn a gap into 0, `na(x)` into true) unless EVERY one of its
//   sessions is complete in the supply — every bucket from 09:30 to the session
//   close present, each built from every source slot inside it — and no intrabar
//   is missing within the expression's reach (`maxLookback`, in intrabars) of
//   the one it reads. A forming session is incomplete, so the newest chart bar of
//   a live chart is unknown by the same rule.

import { etClockAt } from '../indicators.js'
import { tradingViewCloseMinute, SESSION_OPEN_MINUTE } from '../../../lib/marketClock/tradingViewSession.js'
import { interpret, isoDay, maxLookback, tfBucket } from './ast/interpret.js'

/** Why a lower-timeframe request is not served — one code per sentence, so a
 *  rail and a surface can name the reason without matching prose. */
export const LOWER_TF_REFUSAL = Object.freeze({
  UNWITNESSED: 'lower-tf:unwitnessed',
  NOT_SERVED: 'lower-tf:not-served',
  LOOKAHEAD: 'lower-tf:lookahead',
  OTHER_SYMBOL: 'lower-tf:other-symbol',
  INTRADAY_CHART: 'lower-tf:intraday-chart',
  INTRABAR_ARRAY: 'lower-tf:intrabar-array',
})

/** ⭐ THE CAPTURE EACH RULE RESTS ON, or null where none does. A lower-timeframe
 *  read is served only when EVERY row names one (`lowerTfWitnessed`). */
export const LOWER_TF_WITNESS = Object.freeze({
  bucketing: 'vw-clock-vwap-spy-5-ext-2026-09-28 + vw-time-session-spy-60-rth-2026-09-28',
  chartBarIsNotIntrabarAggregate: 'vw-bool-cast-spy-1d-2026-09-28 + vw-bool-cast-spy-60-2026-09-28',
  chartSession: 'vw-time-session-spy-1d-2026-09-28 (symbol.session 0930-1600)',
  requestValue: null,
  requestSession: null,
})

/** The capture that would settle the two unwitnessed rows (queued in
 *  `docs/pine/capture-queue-2026-09-30-lower-tf.md`). */
export const LOWER_TF_SETTLING_CAPTURE =
  'probe `tools/visual_conformance/probes/vw-lower-tf.pine` on AMEX:SPY 1D (Q-L1 in '
  + '`docs/pine/capture-queue-2026-09-30-lower-tf.md`): `request.security(syminfo.tickerid, '
  + '"60", close)` and `array.size(request.security_lower_tf(syminfo.tickerid, "60", close))` '
  + 'on the dates the committed SPY 60m capture holds'

/** Is every rule a served read needs witnessed? */
export function lowerTfWitnessed(witness = LOWER_TF_WITNESS) {
  return Object.values(witness).every((w) => typeof w === 'string' && w.length > 0)
}

/** ⭐ THE REQUESTED CODE → THE STORE TIMEFRAME ITS BARS ARE BUILT FROM. Only codes
 *  the store serves (`GET /api/bars?tf=1/5/15/30/60`). `60` is built from `15`:
 *  the store's own 60m bars are clock-aligned and TradingView's open at 09:30 +
 *  60k (witnessed, `LOWER_TF_WITNESS.bucketing`). `1/5/15/30` are aligned on the
 *  09:30 grid in both. `240` and every other code are not served. */
export const LOWER_TF_SOURCE = Object.freeze({ 1: '1', 5: '5', 15: '15', 30: '30', 60: '15' })

const minutesOf = (code) => (typeof code === 'string' && /^[0-9]+$/.test(code) ? Number(code) : null)
const CHART_PERIODS = new Set(['D', 'W', 'M'])

/** Is `code` a lower-timeframe request on a chart at `base`? A minute code on a
 *  D/W/M chart — the question the door asks before it asks anything else. */
export function isLowerTfRequest(code, base) {
  return minutesOf(String(code)) !== null && (CHART_PERIODS.has(String(base)) || minutesOf(String(base)) !== null)
    && (minutesOf(String(base)) === null || minutesOf(String(code)) < minutesOf(String(base)))
}

/** ⭐⭐ WHY A LOWER-TIMEFRAME REQUEST IS NOT SERVED, or null when it is.
 *  `{code, why}` — `code` from `LOWER_TF_REFUSAL`, `why` the member's sentence.
 *  Checked in this order: the shape (array form, another symbol, look-ahead, an
 *  intraday chart, a code the store does not serve), then the witness. */
export function lowerTfRefusal({ code, base, lookahead = false, other = null, array = false } = {},
  witness = LOWER_TF_WITNESS) {
  const c = String(code)
  const shown = `\`${c}\``
  if (array) {
    return { code: LOWER_TF_REFUSAL.INTRABAR_ARRAY,
      why: `${LOWER_TF_REFUSAL.INTRABAR_ARRAY}: an intrabar ARRAY (one value per ${shown} bar inside `
        + 'each chart bar) has no column here; the intrabar reading itself is also unwitnessed — '
        + `${LOWER_TF_SETTLING_CAPTURE}` }
  }
  if (other) {
    return { code: LOWER_TF_REFUSAL.OTHER_SYMBOL,
      why: `${LOWER_TF_REFUSAL.OTHER_SYMBOL}: \`${other}\` at ${shown}, below this chart's timeframe — `
        + 'another symbol\'s intraday bars are not read' }
  }
  if (lookahead) {
    return { code: LOWER_TF_REFUSAL.LOOKAHEAD,
      why: `${LOWER_TF_REFUSAL.LOOKAHEAD}: look-ahead on (or a \`lookahead\` spelling this door cannot `
        + `read) at ${shown}, below this chart's timeframe — which intrabar TradingView answers then `
        + 'is unmeasured' }
  }
  if (minutesOf(String(base)) !== null) {
    return { code: LOWER_TF_REFUSAL.INTRADAY_CHART,
      why: `${LOWER_TF_REFUSAL.INTRADAY_CHART}: ${shown} inside an intraday chart bar is not read` }
  }
  if (!Object.prototype.hasOwnProperty.call(LOWER_TF_SOURCE, c)) {
    return { code: LOWER_TF_REFUSAL.NOT_SERVED,
      why: `${LOWER_TF_REFUSAL.NOT_SERVED}: ${shown} is not an intraday timeframe the bar store `
        + `serves (${Object.keys(LOWER_TF_SOURCE).join(', ')})` }
  }
  if (!lowerTfWitnessed(witness)) {
    return { code: LOWER_TF_REFUSAL.UNWITNESSED,
      why: `${LOWER_TF_REFUSAL.UNWITNESSED}: ${shown} below this chart's timeframe reads intraday bars, `
        + 'and which intrabar TradingView answers, over which session, is documented but not yet '
        + `captured — ${LOWER_TF_SETTLING_CAPTURE}` }
  }
  return null
}

const ymdOf = (p) => p.y * 10000 + p.m * 100 + p.d
const isoOfYmd = (ymd) => `${String(Math.floor(ymd / 10000)).padStart(4, '0')}-`
  + `${String(Math.floor(ymd / 100) % 100).padStart(2, '0')}-${String(ymd % 100).padStart(2, '0')}`

function ymdAddDays(ymd, k) {
  const y = Math.floor(ymd / 10000); const m = Math.floor(ymd / 100) % 100; const d = ymd % 100
  const u = new Date(Date.UTC(y, m - 1, d + k))
  return u.getUTCFullYear() * 10000 + (u.getUTCMonth() + 1) * 100 + u.getUTCDate()
}

/** ⭐⭐ THE LOWER-TIMEFRAME SERIES TradingView READS, built from store bars.
 *
 *  `storeBars` are the store's intraday bars at `sourceCode` (unix-second `t`,
 *  extended hours included). Kept: a bar whose New York start minute lies in
 *  TradingView's regular session for its day, [09:30, close) with close from
 *  `tradingViewCloseMinute`. Bucketed from 09:30 in `code` minutes, the last
 *  bucket cut at the close. A bucket is COMPLETE when every `sourceCode` slot
 *  inside it is present; a session is complete when all its buckets are.
 *
 *  @returns {{bars, sessions: Map<ymd,{complete, from, to}>, damage: number[]}}
 *    `bars` — complete buckets only, in time order, `{t,o,h,l,c,v,day}`;
 *    `damage` — positions q in `bars` with a bucket MISSING just before q (a gap
 *    between q-1 and q, or at the end: q = bars.length), from the first supplied
 *    session to the last. */
export function intrabarSeries(storeBars, code, sourceCode = LOWER_TF_SOURCE[String(code)]) {
  const codeMin = minutesOf(String(code))
  const srcMin = minutesOf(String(sourceCode))
  if (!codeMin || !srcMin || codeMin % srcMin !== 0) {
    throw new Error(`intrabarSeries: '${code}' cannot be built from '${sourceCode}'`)
  }
  const days = new Map() // ymd -> {close, buckets: Map<k,{slots:Set, rows:[]}>, misaligned}
  for (const b of Array.isArray(storeBars) ? storeBars : []) {
    if (!b || typeof b.t !== 'number') continue
    const p = etClockAt(b.t)
    if (!p) continue
    const ymd = ymdOf(p)
    const close = tradingViewCloseMinute(ymd)
    const m = p.h * 60 + p.min
    if (close === null || m < SESSION_OPEN_MINUTE || m >= close) continue
    let day = days.get(ymd)
    if (!day) { day = { close, buckets: new Map(), misaligned: false }; days.set(ymd, day) }
    // ⛔ A source bar off the 09:30 grid cannot be placed in one bucket: the day
    // is not complete (never split, never guessed).
    if ((m - SESSION_OPEN_MINUTE) % srcMin !== 0) { day.misaligned = true; continue }
    const k = Math.floor((m - SESSION_OPEN_MINUTE) / codeMin)
    let bk = day.buckets.get(k)
    if (!bk) { bk = { slots: new Set(), rows: [] }; day.buckets.set(k, bk) }
    if (bk.slots.has(m)) continue // a duplicate slot is the same bar
    bk.slots.add(m)
    bk.rows.push({ m, b })
  }
  const bars = []
  const damage = []
  const sessions = new Map()
  const ymds = [...days.keys()].sort((a, b) => a - b)
  if (!ymds.length) return { bars, sessions, damage }
  // every TradingView session between the first and last supplied day, so a
  // session the store is missing entirely is a gap, not an absence
  const all = []
  for (let d = ymds[0]; d <= ymds[ymds.length - 1]; d = ymdAddDays(d, 1)) {
    if (tradingViewCloseMinute(d) !== null) all.push(d)
  }
  for (const ymd of all) {
    const day = days.get(ymd)
    const close = tradingViewCloseMinute(ymd)
    const nb = Math.ceil((close - SESSION_OPEN_MINUTE) / codeMin)
    const from = bars.length
    let complete = !!day && !day.misaligned
    for (let k = 0; k < nb; k++) {
      const start = SESSION_OPEN_MINUTE + k * codeMin
      const end = Math.min(start + codeMin, close)
      // source slots on the 09:30 grid inside [start, end) — a final bucket cut at
      // the close may hold part of one slot's span (60 from 60: 15:30–16:00 is one)
      const need = Math.ceil((end - start) / srcMin)
      const bk = day ? day.buckets.get(k) : null
      if (!bk || bk.slots.size !== need || day.misaligned) {
        complete = false
        damage.push(bars.length)
        continue
      }
      const rows = bk.rows.slice().sort((x, y) => x.m - y.m)
      const first = rows[0]
      let h = -Infinity; let l = Infinity; let v = 0
      for (const r of rows) {
        if (r.b.h > h) h = r.b.h
        if (r.b.l < l) l = r.b.l
        v += Number.isFinite(r.b.v) ? r.b.v : 0
      }
      bars.push({ t: first.b.t - (first.m - start) * 60, o: first.b.o, h, l,
        c: rows[rows.length - 1].b.c, v, day: ymd })
    }
    sessions.set(ymd, { complete, from, to: bars.length })
  }
  // ⭐ THE SUPPLY'S LEADING EDGE IS THE SERIES' START, not a gap: a gap before
  // position 0 is where our history begins, which the child's own warm-up rule
  // already answers for. Its (partial) first session stays incomplete.
  while (damage.length && damage[0] === 0) damage.shift()
  return { bars, sessions, damage }
}

/** The chart-period key a day belongs to on a `chartTf` chart. */
function periodKey(iso, chartTf) {
  return chartTf === 'D' ? iso : tfBucket(iso, chartTf)
}

/** Every TradingView session in the chart period that holds `iso`. */
function sessionsOfPeriod(iso, chartTf) {
  const [y, m, d] = iso.split('-').map(Number)
  const ymd = y * 10000 + m * 100 + d
  if (chartTf === 'D') return tradingViewCloseMinute(ymd) === null ? [] : [ymd]
  const key = periodKey(iso, chartTf)
  const span = chartTf === 'W' ? 6 : 31
  const out = []
  for (let k = -span; k <= span; k++) {
    const day = ymdAddDays(ymd, k)
    if (periodKey(isoOfYmd(day), chartTf) !== key) continue
    if (tradingViewCloseMinute(day) !== null) out.push(day)
  }
  return out
}

/** ⭐⭐ WHICH INTRABARS SIT INSIDE EACH CHART BAR, and whether that bar is KNOWN.
 *  `groups[i]` is the ordered list of `series.bars` indices inside chart bar i,
 *  or null when chart bar i is UNKNOWN: a session of its period is incomplete in
 *  the supply, or an intrabar is missing within `reach` intrabars of the last
 *  one it holds. */
export function intrabarGroups(chartBars, series, chartTf, reach) {
  const n = Array.isArray(chartBars) ? chartBars.length : 0
  const tf = String(chartTf)
  if (!CHART_PERIODS.has(tf)) throw new Error(`intrabarGroups: a '${tf}' chart is not a D/W/M chart`)
  const r = Number.isFinite(reach) && reach >= 0 ? reach : Infinity
  const groups = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const iso = isoDay(chartBars[i] && chartBars[i].t)
    if (!iso) continue
    const days = sessionsOfPeriod(iso, tf)
    if (!days.length) continue
    const idx = []
    let whole = true
    for (const d of days) {
      const s = series.sessions.get(d)
      if (!s || !s.complete) { whole = false; break }
      for (let j = s.from; j < s.to; j++) idx.push(j)
    }
    if (!whole || !idx.length) continue
    const last = idx[idx.length - 1]
    // a gap between q-1 and q is read by the child at `last` iff last-r < q <= last
    if (series.damage.some((q) => q <= last && q > last - r)) continue
    groups[i] = idx
  }
  return groups
}

/** ⭐ (b) `request.security_lower_tf` — the intrabar values of each chart bar, in
 *  time order, or null where the chart bar is unknown. */
export function intrabarArrays(groups, column) {
  return groups.map((g) => (g ? g.map((j) => column[j]) : null))
}

/** ⭐⭐ (a)+(b) READ A LOWER TIMEFRAME: `tree` evaluated on the intraday series
 *  (its own scope, the lower code as its base) and mapped onto the chart bars.
 *  @returns {{column: Float64Array, unknown: Float64Array, arrays: Array,
 *    series}} `column[i]` — the LAST intrabar's value (NaN where unknown);
 *    `unknown[i]` — 1 where chart bar i is unknown; `arrays[i]` — every
 *    intrabar's value, in order (null where unknown). */
export function readLowerTf({ tree, code, chartTf, chartBars, storeBars, sourceCode,
  inputs, budget, scalars, opts } = {}) {
  const series = intrabarSeries(storeBars, code, sourceCode)
  const raw = interpret(tree, series.bars, inputs, budget, scalars,
    { ...(opts || {}), tf: String(code), historyFromListing: undefined, probeBase: undefined })
  const child = Float64Array.from({ length: series.bars.length },
    (_, j) => (raw && typeof raw === 'object' && raw.length !== undefined ? raw[j] : raw))
  const groups = intrabarGroups(chartBars, series, chartTf, maxLookback(tree))
  const n = groups.length
  const column = new Float64Array(n).fill(NaN)
  const unknown = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const g = groups[i]
    if (!g) { unknown[i] = 1; continue }
    column[i] = child[g[g.length - 1]]
  }
  return { column, unknown, arrays: intrabarArrays(groups, child), series }
}

/** ⭐ WHAT THE PRODUCT WOULD FETCH: the store timeframe and how many of its bars
 *  cover `chartBars` regular sessions plus the expression's reach (`reach`
 *  intrabars), capped at the route's limit (`/api/bars` `bars <= 60000`) — a
 *  chart bar beyond the capped depth is simply incomplete, hence unknown. */
export const BARS_ROUTE_MAX = 60000
export function lowerTfFetchPlan(code, chartBars, reach = 0) {
  const source = LOWER_TF_SOURCE[String(code)]
  if (!source) return null
  const perSession = Math.ceil((16 * 60 - SESSION_OPEN_MINUTE) / Number(source))
  const perBucket = Number(code) / Number(source)
  // the store's bars include extended hours (04:00–20:00, 16 h): count those too
  const extFactor = (20 * 60 - 4 * 60) / (16 * 60 - SESSION_OPEN_MINUTE)
  const want = Math.ceil(((Math.max(0, chartBars) + 1) * perSession + Math.max(0, reach) * perBucket) * extFactor)
  return { tf: source, bars: Math.min(want, BARS_ROUTE_MAX), capped: want > BARS_ROUTE_MAX }
}
