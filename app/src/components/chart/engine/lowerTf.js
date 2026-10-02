// app/src/components/chart/engine/lowerTf.js
//
// ─── ⭐⭐ C27 / C41 — `request.security` / `request.security_lower_tf` AT A TIMEFRAME
//     BELOW THE CHART'S OWN (intraday bars read from a daily or weekly chart) ─────
//
// THE ONE PLACE THE LOWER-TIMEFRAME RULES ARE STATED. `pine.js` asks
// `lowerTfRefusal` whether a request is served (and says why not, by name); the
// reading itself — which intraday bars, bucketed how, mapped onto which chart bar,
// and when a chart bar is UNKNOWN — is `intrabarSeries` / `intrabarGroups` /
// `readLowerTf` below; what one BINDING is handed is `resolveLowerTf`. Nothing
// else restates any of it.
//
// ── WHAT PINE MEANS ───────────────────────────────────────────────────────────
//   (a) `request.security(sym, lowerTf, expr)` on a higher-timeframe chart: `expr`
//       is evaluated on the lower-timeframe bars (their own history, their own
//       recurrences) and each chart bar reads its LAST intrabar's value
//       (lookahead off). The tree node is `ltf` (`parse.js::NODE_TYPES`).
//   (b) `request.security_lower_tf(sym, tf, expr)`: the ARRAY of `expr` over every
//       intrabar inside the chart bar, in time order (`intrabarArrays`).
//
// ── WHAT IS WITNESSED (committed captures) ───────────────────────────────────────
//   * BUCKETING. TradingView's regular-session 60m bars open at 09:30, 10:30, …,
//     15:30 (the last one 30 minutes), NOT on the clock hour, and each is exactly
//     the aggregate of the regular-session 5m / 15m bars inside it
//     (`vw-clock-vwap-spy-5-ext-2026-09-28` against
//     `vw-time-session-spy-60-rth-2026-09-28`; RDDT 15 → 60 on 4,413 buckets,
//     `vw-bar-counters-rddt-{15,60}-2026-09-30`). Its 240m bars open at 09:30 and
//     13:30 (the second 13:30–16:00; a 13:00 half-day has 09:30 only) and are the
//     aggregate of the 60m bars inside (`vw-bar-counters-rddt-240-2026-09-30`).
//     ⛔ OUR STORE'S `tf=60` IS CLOCK-ALIGNED (09:30–10:00, 10:00–11:00, … —
//     `bars_fetch.py::bucket_60_et_unix_seconds`), so a `"60"` or `"240"` read is
//     built here from the store's `tf=15` bars, bucketed from the session open
//     (`LOWER_TF_SOURCE`).
//   * THE CHART'S DAILY BAR IS NOT THE AGGREGATE OF ITS INTRADAY BARS. SPY 1D vs its
//     own regular-session 60m bars, 2,951 sessions 2015–2026: close equal on 190
//     (`vw-bool-cast-spy-1d` / `vw-bool-cast-spy-60`, 2026-09-28). So a
//     lower-timeframe read can never be derived from the daily bars in hand.
//   * THE CHART SESSION. A 1D chart's symbol reports the regular session
//     (`symbol.session` `0930-1600` in every SPY 1D capture).
//   * ⭐ C41 (2026-09-30 evening, `vw-lower-tf-{spy-1d,spy-1w,rddt-1d}`) — THE TWO
//     RULES C27 COULD NOT SERVE ON:
//       (i)  WHICH INTRABAR. `request.security(own, "60", close)` on a 1D chart is
//            the close of the day's LAST regular-session 60m bar (L02: SPY
//            2,951 / 2,951 days against `vw-bool-cast-spy-60`, RDDT 634 / 634
//            against `vw-bar-counters-rddt-60`), its `time` that bar's open (L03),
//            and the child runs on the intraday series (L04: Pine's EMA(9) over
//            the 60m closes, 2,666 / 2,666, max abs diff 4.5e-13). `"15"` (L05),
//            `"5"` (L06) and `"240"` (L15/L16) read the same way.
//       (ii) WHICH SESSION. The REGULAR one: L03 is 15:30 ET (12:30 on a 13:00
//            half-day), L09 is 7 bars (4 on a half-day), never 16; L10 is 09:30.
//     On a 1W chart L02 is the WEEK's last 60m close and L09 the week's 60m bar
//     count (35 in a full week): 612 / 612 complete weeks.
//
// ── WHAT IS STILL REFUSED BY NAME (`LOWER_TF_REFUSAL`) ───────────────────────────
//   * `lower-tf:lookahead` — the capture shows the chart bar's FIRST intrabar
//     (L07/L08) but `na` on RDDT's listing day, and no node carries that pick.
//   * `lower-tf:intrabar-array` — the array's size, first, last and sum are
//     witnessed (L09–L12); an array has no column here.
//   * `lower-tf:session` — a `ticker.modify(…, session.*)` / `ticker.new(…,
//     session.*)` symbol. The extended control (L13/L14) did not discriminate on
//     1D and differs unexplained on 1W, so an explicit session is not readable.
//   * `lower-tf:other-symbol`, `lower-tf:intraday-chart`, `lower-tf:not-served`
//     (a code no store timeframe builds), `lower-tf:unwitnessed` (a code or a
//     chart period no capture shows: `1`, `30`, a monthly chart),
//     `lower-tf:screen` (a screen holds daily bars only), `lower-tf:runtime-lane`
//     (the dark per-bar runtime lane reads no intraday bars),
//     `lower-tf:expression` (a child the intraday series cannot answer the way
//     TradingView's does: a bar counter, `barstate.*`, a recurrence, a nested
//     request — its value depends on where the series starts, and ours starts
//     later than TradingView's).
//
// ── WHERE THE BARS COME FROM ─────────────────────────────────────────────────────
//   In the product: the chart's OWN ticker at the store timeframe
//   `LOWER_TF_SOURCE[code]` — `GET /api/bars/{ticker}?tf=<source>` through the same
//   secondary-bars cache a `sym:` source uses (`secondaryBars.js::ensureAll`,
//   `useSecondarySources.js::useLowerTfSources`), the depth from
//   `lowerTfFetchPlan` (capped at the route's 60,000). The store's intraday bars
//   include extended hours; `intrabarSeries` keeps only TradingView's regular
//   session for the day (`tradingViewCloseMinute`). In the vendor harness: only
//   from committed captures of the chart's own symbol, regular session.
//   ⚠️ OUR STORE'S INTRADAY BARS ARE NOT TRADINGVIEW'S. The rule is proved on the
//   vendor's bars; a live value is TradingView's only where our store's intraday
//   bars agree with TradingView's for that symbol and day.
//
// ── COVERAGE: A CHART BAR IS KNOWN ONLY WHOLE, NEVER PARTIAL ──────────────────────
//   A chart bar is UNKNOWN (withheld — never `na`: `nz` would turn a gap into 0,
//   `na(x)` into true) unless EVERY one of its sessions is complete in the supply
//   — every bucket from 09:30 to the session close present, each built from every
//   source slot inside it — no intrabar is missing within the expression's reach
//   (`maxLookback`, in intrabars) of the one it reads, and that reach does not run
//   off the FRONT of the supply. A forming session is incomplete, so the newest
//   chart bar of a live chart is unknown by the same rule.
//   ⭐ DEPTH (C41). Where TradingView itself has no intraday history it reads `na`
//   and an array of size 0 (SPY 15m before 2011-06-06, 5m before 2021-08-16, 60m
//   on 1W before 2000). Our store's depth is not TradingView's, and where its
//   history ends is a fact about the vendor's plan, not a rule — so a chart bar
//   before OUR supply is UNKNOWN (withheld), never `na`. Nothing is invented.

import { etClockAt } from '../indicators.js'
import { tradingViewCloseMinute, SESSION_OPEN_MINUTE } from '../../../lib/marketClock/tradingViewSession.js'
import { interpret, isoDay, maxLookback, tfBucket } from './ast/interpret.js'
import { lowerTfServingEnabled } from './lowerTfGate.js'

/** Why a lower-timeframe request is not served — one code per sentence, so a
 *  rail and a surface can name the reason without matching prose. */
export const LOWER_TF_REFUSAL = Object.freeze({
  UNWITNESSED: 'lower-tf:unwitnessed',
  NOT_SERVED: 'lower-tf:not-served',
  LOOKAHEAD: 'lower-tf:lookahead',
  OTHER_SYMBOL: 'lower-tf:other-symbol',
  INTRADAY_CHART: 'lower-tf:intraday-chart',
  INTRABAR_ARRAY: 'lower-tf:intrabar-array',
  SESSION: 'lower-tf:session',
  EXPRESSION: 'lower-tf:expression',
  SCREEN: 'lower-tf:screen',
  RUNTIME_LANE: 'lower-tf:runtime-lane',
  // ⭐ the rule is witnessed and the DATA is not (`lowerTfGate.js`): every read
  // that would otherwise be served is refused under this name while the gate is off.
  STORE_UNMEASURED: 'lower-tf:store-unmeasured',
  // decided per BINDING (`resolveLowerTf`), never at the translate door:
  FRAMED: 'lower-tf:framed',
  NO_BARS: 'lower-tf:no-bars',
})

/** ⭐ THE CAPTURE EACH RULE RESTS ON, or null where none does. A lower-timeframe
 *  read is served only when EVERY row names one (`lowerTfWitnessed`). */
export const LOWER_TF_WITNESS = Object.freeze({
  bucketing: 'vw-clock-vwap-spy-5-ext-2026-09-28 + vw-time-session-spy-60-rth-2026-09-28',
  chartBarIsNotIntrabarAggregate: 'vw-bool-cast-spy-1d-2026-09-28 + vw-bool-cast-spy-60-2026-09-28',
  chartSession: 'vw-time-session-spy-1d-2026-09-28 (symbol.session 0930-1600)',
  requestValue: 'vw-lower-tf-spy-1d-2026-09-30 + vw-lower-tf-rddt-1d-2026-09-30 (L02/L03 the LAST '
    + 'regular-session intrabar, L04 the child on the intraday series; against '
    + 'vw-bool-cast-spy-60-2026-09-28 and vw-bar-counters-rddt-60-2026-09-30)',
  requestSession: 'vw-lower-tf-spy-1d-2026-09-30 + vw-lower-tf-rddt-1d-2026-09-30 (L03 15:30 ET, '
    + 'L09 7 bars / 4 on a half-day, L10 09:30 — the regular session)',
})

/** ⭐ C41 — THE CAPTURE ROW THAT SHOWS EACH CODE READ BELOW A CHART, or null. A
 *  code the store could build but no capture shows is `lower-tf:unwitnessed`. */
export const LOWER_TF_CODE_WITNESS = Object.freeze({
  1: null,
  5: 'vw-lower-tf-rddt-1d-2026-09-30 L06 (vw-bar-counters-rddt-5-2026-09-30)',
  15: 'vw-lower-tf-rddt-1d-2026-09-30 L05 (vw-bar-counters-rddt-15-2026-09-30)',
  30: null,
  60: 'vw-lower-tf-spy-1d-2026-09-30 L02 (vw-bool-cast-spy-60-2026-09-28)',
  240: 'vw-lower-tf-rddt-1d-2026-09-30 L15/L16 (vw-bar-counters-rddt-240-2026-09-30)',
})

/** ⭐ C41 — THE CAPTURE THAT SHOWS A LOWER READ ON EACH CHART PERIOD, or null.
 *  A monthly chart has none: its reads stay unknown, by name. */
export const LOWER_TF_CHART_WITNESS = Object.freeze({
  D: 'vw-lower-tf-spy-1d-2026-09-30 + vw-lower-tf-rddt-1d-2026-09-30',
  W: 'vw-lower-tf-spy-1w-2026-09-30 (L02 the week\'s last 60m close, L09 35 bars)',
  M: null,
})

/** The capture that would settle a row still unwitnessed. */
export const LOWER_TF_SETTLING_CAPTURE =
  'probe `tools/visual_conformance/probes/vw-lower-tf.pine` (Q-L1 in '
  + '`docs/pine/capture-queue-2026-09-30-lower-tf.md`) with a row at this timeframe, on this '
  + 'chart period, beside TradingView\'s own intraday bars of the symbol at that timeframe'

/** Is every rule a served read needs witnessed? */
export function lowerTfWitnessed(witness = LOWER_TF_WITNESS) {
  return Object.values(witness).every((w) => typeof w === 'string' && w.length > 0)
}

/** ⭐⭐ THE REQUESTED CODE → THE STORE TIMEFRAME ITS BARS ARE BUILT FROM. Only codes
 *  the store can build (`GET /api/bars?tf=1/5/15/30/60`). `60` and `240` are
 *  built from `15`: the store's own 60m bars are clock-aligned and TradingView's
 *  open at 09:30 + 60k / 240k (witnessed, `LOWER_TF_WITNESS.bucketing` and
 *  `LOWER_TF_CODE_WITNESS[240]`). `1/5/15/30` are aligned on the 09:30 grid in
 *  both. Every other code is not served. */
export const LOWER_TF_SOURCE = Object.freeze({ 1: '1', 5: '5', 15: '15', 30: '30', 60: '15', 240: '15' })

const minutesOf = (code) => (typeof code === 'string' && /^[0-9]+$/.test(code) ? Number(code) : null)
const CHART_PERIODS = new Set(['D', 'W', 'M'])
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Is `code` a lower-timeframe request on a chart at `base`? A minute code on a
 *  D/W/M chart — the question the door asks before it asks anything else. */
export function isLowerTfRequest(code, base) {
  return minutesOf(String(code)) !== null && (CHART_PERIODS.has(String(base)) || minutesOf(String(base)) !== null)
    && (minutesOf(String(base)) === null || minutesOf(String(code)) < minutesOf(String(base)))
}

/** ⭐⭐ WHY A LOWER-TIMEFRAME REQUEST IS NOT SERVED, or null when it is.
 *  `{code, why}` — `code` from `LOWER_TF_REFUSAL`, `why` the member's sentence.
 *  Checked in this order: the shape (array form, an explicit session, another
 *  symbol, look-ahead, the screen lane, an intraday chart, a code the store does
 *  not build), then the witnesses (the two rules, the code's own row, the chart period's). */
export function lowerTfRefusal({ code, base, lookahead = false, other = null, array = false, session = null,
  screen = false } = {}, witness = LOWER_TF_WITNESS) {
  const c = String(code)
  const shown = `\`${c}\``
  if (array) {
    return { code: LOWER_TF_REFUSAL.INTRABAR_ARRAY,
      why: `${LOWER_TF_REFUSAL.INTRABAR_ARRAY}: an intrabar ARRAY (one value per ${shown} bar inside `
        + 'each chart bar) has no column here. TradingView\'s array is the regular session\'s '
        + 'intrabars in time order (its size, first, last and sum are captured, '
        + '`vw-lower-tf-spy-1d-2026-09-30` L09–L12); a plain `request.security` at that timeframe '
        + 'reads the last of them and is served' }
  }
  if (session) {
    return { code: LOWER_TF_REFUSAL.SESSION,
      why: `${LOWER_TF_REFUSAL.SESSION}: \`${session}\` names a session for a read at ${shown}, below `
        + 'this chart\'s timeframe — the captured control (`vw-lower-tf` L13/L14, '
        + '`ticker.modify(…, session.extended)`) read the regular session\'s values on a 1D chart '
        + 'and an unexplained bar count on 1W, so which intrabars an explicit session reads is not '
        + 'settled. `syminfo.tickerid` reads the regular session and is served' }
  }
  if (other) {
    return { code: LOWER_TF_REFUSAL.OTHER_SYMBOL,
      why: `${LOWER_TF_REFUSAL.OTHER_SYMBOL}: \`${other}\` at ${shown}, below this chart's timeframe — `
        + 'another symbol\'s intraday bars are not read' }
  }
  if (lookahead) {
    return { code: LOWER_TF_REFUSAL.LOOKAHEAD,
      why: `${LOWER_TF_REFUSAL.LOOKAHEAD}: look-ahead on (or a \`lookahead\` spelling this door cannot `
        + `read) at ${shown}, below this chart's timeframe — TradingView answers the chart bar's `
        + 'FIRST intrabar then (`vw-lower-tf-spy-1d-2026-09-30` L07/L08) and `na` on a listing day '
        + '(`vw-lower-tf-rddt-1d-2026-09-30`), a reading this engine has no node for' }
  }
  if (screen) {
    return { code: LOWER_TF_REFUSAL.SCREEN,
      why: `${LOWER_TF_REFUSAL.SCREEN}: ${shown} is below the daily bars a screen evaluates — a screen `
        + 'holds no intraday bars, so this read is served on a chart only' }
  }
  if (minutesOf(String(base)) !== null) {
    return { code: LOWER_TF_REFUSAL.INTRADAY_CHART,
      why: `${LOWER_TF_REFUSAL.INTRADAY_CHART}: ${shown} inside an intraday chart bar is not read` }
  }
  if (!own(LOWER_TF_SOURCE, c)) {
    return { code: LOWER_TF_REFUSAL.NOT_SERVED,
      why: `${LOWER_TF_REFUSAL.NOT_SERVED}: ${shown} is not an intraday timeframe the bar store `
        + `builds (${Object.keys(LOWER_TF_SOURCE).join(', ')})` }
  }
  if (!lowerTfWitnessed(witness) || !LOWER_TF_CODE_WITNESS[c]
      || (own(LOWER_TF_CHART_WITNESS, String(base)) && !LOWER_TF_CHART_WITNESS[String(base)])) {
    return { code: LOWER_TF_REFUSAL.UNWITNESSED,
      why: `${LOWER_TF_REFUSAL.UNWITNESSED}: ${shown} below a ${String(base)} chart reads intraday bars, `
        + 'and no committed capture shows TradingView answering that timeframe on that chart '
        + `period — ${LOWER_TF_SETTLING_CAPTURE}` }
  }
  // ⭐⭐ THE LAST QUESTION, AND THE ONLY ONE ABOUT DATA. Everything above is a rule
  // a capture settles; this one is whether OUR intraday bars are TradingView's.
  // Asked last, so every other refusal keeps its own name whatever the gate says.
  if (!lowerTfServingEnabled()) {
    return { code: LOWER_TF_REFUSAL.STORE_UNMEASURED,
      why: `${LOWER_TF_REFUSAL.STORE_UNMEASURED}: ${shown} is below this chart's timeframe, so it reads `
        + 'intraday bars — and our intraday bars have not been measured against TradingView\'s. '
        + 'TradingView\'s answer is known (the day\'s last regular-session bar, '
        + '`vw-lower-tf-spy-1d-2026-09-30`); it is not served until a stored '
        + '`/api/bars/<ticker>?tf=15` payload has been compared with TradingView\'s 15-minute '
        + 'bars for the same sessions (`storeIntradayAgreement`)' }
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
  // position 0 is where our history begins. Its (partial) first session stays
  // incomplete, and `intrabarGroups` withholds every chart bar whose expression
  // reaches back past position 0.
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
 *  the supply, an intrabar is missing within `reach` intrabars of the last one it
 *  holds, or (C41) those `reach` intrabars run off the FRONT of the supply — the
 *  expression would read bars TradingView holds and we do not. */
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
    // ⛔ C41 — the expression's reach must lie inside the supply: `last - r` below
    // position 0 reads intrabars before our history begins.
    if (last < r) continue
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

/** ⭐ WHAT THE PRODUCT FETCHES: the store timeframe and how many of its bars
 *  cover `chartBars` regular sessions plus the expression's reach (`reach`
 *  intrabars), capped at the route's limit (`/api/bars` `bars <= 60000`) — a
 *  chart bar beyond the capped depth is simply not covered, hence unknown. */
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

// ─── ⭐⭐ C41 — WHAT ONE BINDING IS HANDED ────────────────────────────────────────
//
// The member door stamps `meta.lowerTf` (the codes a document's `ltf` nodes read —
// `pine.js::LOWER_TF_SINK`). A chart fetches one window per STORE timeframe those
// codes are built from (`lowerTfWindowsOf`), and the bind decides, per code,
// whether this chart's bars may be read (`resolveLowerTf`). `interpret` is handed
// the result as `opts.lowerTf[code] = {bars, groups}` and reads nothing else: an
// unsupplied code is UNKNOWN on every bar.

/** The codes a document's `ltf` nodes read, from the member door's stamp. */
export function lowerTfCodesOf(def) {
  const stamped = def && def.meta && Array.isArray(def.meta.lowerTf) ? def.meta.lowerTf : []
  return [...new Set(stamped.map((c) => String(c)).filter((c) => own(LOWER_TF_SOURCE, c)))]
    .sort((a, b) => Number(a) - Number(b))
}

/** How many CHART bars a chart on `chartTf` spans in sessions. */
const sessionsPerChartBar = (chartTf) => (chartTf === 'W' ? 5 : 1)

/** ⭐ THE WINDOWS A CHART FETCHES for a document: one `{tf, bars}` per store
 *  timeframe its codes are built from — the deepest plan any of them asks for,
 *  never above `BARS_ROUTE_MAX`. EMPTY for a document that reads no lower
 *  timeframe, and for a chart period no capture shows a lower read on (an
 *  intraday or monthly chart): nothing is fetched that the bind would refuse.
 *  The reach is a fixed allowance (`LOWER_TF_REACH_ALLOWANCE` intrabars): the
 *  plan is a fetch depth, and a deeper expression is simply unknown further back. */
export const LOWER_TF_REACH_ALLOWANCE = 500
export function lowerTfWindowsOf(def, chartTf, chartBarCount) {
  const tf = String(chartTf)
  // ⛔ nothing is fetched for a read the gate does not serve (`lowerTfGate.js`)
  if (!lowerTfServingEnabled()) return []
  if (!own(LOWER_TF_CHART_WITNESS, tf) || !LOWER_TF_CHART_WITNESS[tf]) return []
  const best = new Map()
  for (const code of lowerTfCodesOf(def)) {
    const plan = lowerTfFetchPlan(code, Math.max(0, chartBarCount || 0) * sessionsPerChartBar(tf),
      LOWER_TF_REACH_ALLOWANCE)
    if (!plan) continue
    if (!best.has(plan.tf) || best.get(plan.tf) < plan.bars) best.set(plan.tf, plan.bars)
  }
  return [...best.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([t, bars]) => ({ tf: t, bars }))
}

/** ⭐ EVERY WINDOW A CHART'S INSTANCES NEED, in one pass: the union of
 *  `lowerTfWindowsOf` over the (visible) instances' definitions, the deepest plan
 *  per store timeframe. ⛔ EMPTY — and therefore NO REQUEST — for a chart none of
 *  whose indicators reads below it: the test is one `meta.lowerTf` read per
 *  instance, never a tree walk. */
export function lowerTfWindowsNeeded(instances, defOf, chartTf, chartBarCount) {
  const best = new Map()
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst || inst.hidden === true) continue
    const def = typeof defOf === 'function' ? defOf(inst.defId) : null
    if (!def || !def.meta || !Array.isArray(def.meta.lowerTf) || !def.meta.lowerTf.length) continue
    for (const w of lowerTfWindowsOf(def, chartTf, chartBarCount)) {
      if (!best.has(w.tf) || best.get(w.tf) < w.bars) best.set(w.tf, w.bars)
    }
  }
  return [...best.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([tf, bars]) => ({ tf, bars }))
}

/** One built series per (store bars, code, source) — the store entry's `bars`
 *  array is a stable object, so a paint that changes nothing rebuilds nothing. */
const _seriesMemo = new WeakMap()
function seriesFor(storeBars, code, sourceCode) {
  let byKey = _seriesMemo.get(storeBars)
  if (!byKey) { byKey = new Map(); _seriesMemo.set(storeBars, byKey) }
  const key = `${code}|${sourceCode}`
  if (!byKey.has(key)) byKey.set(key, intrabarSeries(storeBars, code, sourceCode))
  return byKey.get(key)
}

/** The supply `interpret` reads for one code: the series' bars, and the chart
 *  bars' groups for a given reach (memoised per chart-bar array). */
function supplyOf(series, chartTf) {
  const memo = new WeakMap()
  return Object.freeze({
    bars: series.bars,
    groups(chartBars, reach) {
      if (!Array.isArray(chartBars)) return []
      let byReach = memo.get(chartBars)
      if (!byReach) { byReach = new Map(); memo.set(chartBars, byReach) }
      const key = Number.isFinite(reach) ? reach : -1
      if (!byReach.has(key)) byReach.set(key, intrabarGroups(chartBars, series, chartTf, reach))
      return byReach.get(key)
    },
  })
}
const _supplyMemo = new WeakMap() // series -> Map<chartTf, supply>

/**
 * Decide, for ONE binding, which of a document's lower-timeframe codes are served.
 *
 * @param {object} def  an installed definition
 * @param {object} ctx
 *   `tf`       the chart's own timeframe;
 *   `lowerTf`  Map storeTf → `{bars, status}` — the chart's OWN symbol at each
 *              store timeframe (`useLowerTfSources`). In the harness: Map
 *              `code:<code>` → `{bars, status, sourceCode}`, a committed capture
 *              and the timeframe it holds;
 *   `framed`   true when the instance computes on a calculation-timeframe frame.
 * @returns {{supply: object, served: string[], refused: {code, refusal, reason}[]}|null}
 *   null when the document reads no lower timeframe.
 */
export function resolveLowerTf(def, ctx = {}) {
  const codes = lowerTfCodesOf(def)
  if (!codes.length) return null
  const supply = {}
  const served = []
  const refused = []
  const no = (code, refusal, reason) => refused.push({ code, refusal, reason })
  const chartTf = String(ctx.tf)
  const have = ctx.lowerTf && typeof ctx.lowerTf.get === 'function' ? ctx.lowerTf : null
  for (const code of codes) {
    if (ctx.framed === true) {
      no(code, LOWER_TF_REFUSAL.FRAMED, `\`${code}\` is read below the chart's own timeframe, and this `
        + 'indicator computes on a different calculation timeframe')
      continue
    }
    const why = lowerTfRefusal({ code, base: chartTf })
    if (why) { no(code, why.code, why.why); continue }
    if (!CHART_PERIODS.has(chartTf)) {
      no(code, LOWER_TF_REFUSAL.INTRADAY_CHART, `\`${code}\` on a \`${chartTf}\` chart is not read`)
      continue
    }
    // ⭐ keyed by STORE timeframe (the product: one window serves every code built
    // from it). A supplier that holds a different window per code — the vendor
    // harness, which has only what TradingView was captured at — keys it
    // `code:<code>` and names the timeframe it holds (`sourceCode`).
    const entry = have ? (have.get(`code:${code}`) || have.get(LOWER_TF_SOURCE[code])) : null
    const bars = entry && Array.isArray(entry.bars) ? entry.bars : null
    if (!bars || !bars.length) {
      no(code, LOWER_TF_REFUSAL.NO_BARS, `this symbol's \`${LOWER_TF_SOURCE[code]}\`-minute bars are not in hand`
        + (entry && entry.status ? ` (${entry.status})` : ''))
      continue
    }
    const sourceCode = entry.sourceCode ? String(entry.sourceCode) : LOWER_TF_SOURCE[code]
    let series
    try {
      series = seriesFor(bars, code, sourceCode)
    } catch (err) {
      no(code, LOWER_TF_REFUSAL.NO_BARS, String((err && err.message) || err))
      continue
    }
    let byTf = _supplyMemo.get(series)
    if (!byTf) { byTf = new Map(); _supplyMemo.set(series, byTf) }
    if (!byTf.has(chartTf)) byTf.set(chartTf, supplyOf(series, chartTf))
    supply[code] = byTf.get(chartTf)
    served.push(code)
  }
  return { supply, served, refused }
}

/** A stable signature of what `resolveLowerTf` would supply — for a compute memo
 *  that must recompute when an intraday window lands. '' when none is read. */
export function lowerTfSignature(def, lowerTf) {
  const codes = lowerTfCodesOf(def)
  if (!codes.length) return ''
  const seen = new Set()
  const parts = []
  for (const code of codes) {
    const src = LOWER_TF_SOURCE[code]
    if (seen.has(src)) continue
    seen.add(src)
    const e = lowerTf && typeof lowerTf.get === 'function' ? lowerTf.get(src) : null
    const bars = e && Array.isArray(e.bars) ? e.bars : null
    const last = bars && bars.length ? bars[bars.length - 1] : null
    parts.push(`${src}:${e ? e.status || '' : '-'}:${bars ? bars.length : 0}:${last ? `${last.t}/${last.c}` : ''}`)
  }
  return parts.join(',')
}
