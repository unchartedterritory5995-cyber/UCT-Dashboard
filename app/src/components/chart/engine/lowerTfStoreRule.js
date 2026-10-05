// app/src/components/chart/engine/lowerTfStoreRule.js
//
// ─── ⭐⭐ LTF — WHICH LOWER-TIMEFRAME READS OUR STORE MAY SERVE (2026-10-05) ──────
//
// C41 proved the RULE of a read below the chart's timeframe on TradingView's own
// intraday bars (`lowerTf.js`). In the product the bars are OURS
// (`/api/bars/<ticker>?tf=<5|15>`), and they are not TradingView's. This module is
// the one place that says which reads our bars can still answer exactly as
// TradingView does, and why every other one is refused.
//
// ── WHAT WAS MEASURED (committed: `tests/fixtures/store/*.json.gz`, the exact bytes
//    the route returned, against the committed captures named in `EVIDENCE`) ─────
//   The comparison is `__tests__/storeIntradayAgreement.js::servedAgreement`: the
//   SAME `intrabarSeries` on both sides (ours built from the store's source
//   timeframe, theirs from the capture at the code), every session complete on
//   both, and per field the value the read would serve. Root causes, each measured
//   (`__tests__/lowerTfStoreRule.test.js` rails every one of them):
//   * VOLUME — TradingView's intraday volume is a SUBSET of the consolidated
//     volume. Our daily volume IS TradingView's daily volume (equal on 631 / 634 RDDT
//     and 1,747 / 1,800 SPY days, the rest late corrections a fraction of a percent
//     apart); TradingView's own daily volume is a median 1.54x the sum of
//     its own regular-session 15m bars (RDDT); ours / TradingView per 15m bar is a
//     median 1.38 (p05 1.17, p95 1.75), in EVERY slot of the session, so it is not
//     extended hours and not the auctions. No intraday volume of ours is
//     TradingView's: 0 equal bars of 16,360 (RDDT 15) and of 5,246 (SPY 60).
//   * THE 09:30 OPEN — our 09:30 bar opens at the OFFICIAL opening print (the SIP's
//     "MC Official Open", which sets open/close but not high/low): on every day our
//     09:30 open differs from TradingView's, it equals the official daily open
//     (RDDT 29 / 29, SPY 66 / 66), and TradingView's is another trade. Any read of
//     the session's FIRST bar's open differs on 5% (RDDT) to 52% (SPY) of days.
//   * THE SESSION'S LAST PRINT — the close of the last regular-session bar is a
//     different trade in 1 day of 30 (RDDT 19 / 632, SPY 9 / 126 at 15m), 1-3
//     cents apart, and it is not the official close either (TradingView's last-15m
//     close equals its own daily close on 84 / 634 days). A different choice of
//     the last eligible print in the final second: not derivable from bars.
//   * SCATTERED PRINTS — about 1 bar in 2,000 differs in high or low by a cent or
//     more mid-session (late or out-of-sequence prints one side counts).
//   * NOT causes, measured: extended hours (the store's 18,777 RDDT bars outside
//     09:30-16:00 are all dropped by `intrabarSeries`; the vendor capture has 0
//     there), the session boundary or time zone (0 vendor bars missing from the
//     store; the only store-only regular-session bars are the 13:00 bar of six
//     half-days, cut by `tradingViewCloseMinute`, and ONE off-grid zero-volume
//     11:05 bar on 2026-05-28 that leaves that day incomplete — withheld, never
//     wrong), bucketing (60 and 240 built from our 15s disagree with TradingView's
//     own 60s / 240s exactly where our 15s do), splits and dividends (our close /
//     theirs is 1.000000 in every year on both symbols), and 4-decimal storage
//     (sub-1e-4 differences are the store's precision, not another value).
//
// ── THE RULE ──────────────────────────────────────────────────────────────────
//   A (code, field) is served only when EVERY compared value is equal (`BAR`), on
//   BOTH measured listings, each over at least `BAR.minSessions` sessions. A read
//   whose expression reaches back (`maxLookback` > 0) consumes every intrabar in
//   its reach, so it needs the field equal on EVERY intrabar too, not only the
//   last. A code is served for a document only when every `ltf` child at that code
//   meets it; otherwise the whole code is refused, by name (`STORE_DISAGREES`),
//   with the measured numbers. ⛔ No tolerance is applied to a price beyond the
//   store's own precision, and none to volume: "close enough" is a known wrong
//   value on the chart.
//
// ⛔ THIS IS THE DATA QUESTION ONLY. It runs AFTER `lowerTfRefusal` (shape,
// witnesses, the build flag `lowerTfGate.js`) and only for bars that are OURS: a
// supply that declares `origin: 'tradingview'` (the vendor harness, whose bars ARE
// TradingView's) is not asked. A supply that declares nothing is ours — fail closed.

import { TABLE, BAR_READERS } from './ast/parse.js'
import { maxLookback } from './ast/interpret.js'

/** The refusal code this module adds (`lowerTf.js::LOWER_TF_REFUSAL.STORE_DISAGREES`). */
export const STORE_DISAGREES = 'lower-tf:store-disagrees'

/** A supply whose bars are TradingView's own (the vendor harness). Any other — or none — is our store. */
export const TRADINGVIEW_ORIGIN = 'tradingview'

/** ⭐ THE BAR. `share` 1: every compared value equal (prices at the store's
 *  4-decimal precision, volume and time exactly). Two listings, each at least
 *  `minSessions` sessions complete on both sides. */
export const BAR = Object.freeze({ share: 1, minSessions: 40, listings: Object.freeze(['RDDT', 'SPY']) })

/** The fields a read can consume. `t` is the intrabar's time (every clock leaf
 *  derives from it); o/h/l/c/v the bar's own. */
export const FIELDS = Object.freeze(['t', 'o', 'h', 'l', 'c', 'v'])

/** ⭐⭐ THE MEASUREMENT, as `[equal, compared]` per listing — WRITTEN DOWN, and
 *  re-derived from the committed payloads by `lowerTfStoreRule.test.js`, which goes
 *  red the moment a payload, a capture or the comparison moves either number.
 *  `last` = the session's last intrabar; `every` = every intrabar of the session. */
const m = (t, o, h, l, c, v) => Object.freeze({ t, o, h, l, c, v })
export const EVIDENCE = Object.freeze({
  5: Object.freeze({
    sources: Object.freeze({
      RDDT: 'api-bars-RDDT-tf5.json.gz vs vw-bar-counters-rddt-5-2026-09-30',
      SPY: 'api-bars-SPY-tf5.json.gz vs vw-time-tf-spy-5-2026-10-01',
    }),
    sessions: Object.freeze({ RDDT: 248, SPY: 42 }),
    last: Object.freeze({
      RDDT: m([248, 248], [248, 248], [248, 248], [248, 248], [240, 248], [0, 248]),
      SPY: m([42, 42], [42, 42], [42, 42], [42, 42], [40, 42], [0, 42]),
    }),
    every: Object.freeze({
      RDDT: m([19272, 19272], [19262, 19272], [19271, 19272], [19269, 19272], [19225, 19272], [0, 19272]),
      SPY: m([3276, 3276], [3253, 3276], [3269, 3276], [3271, 3276], [3271, 3276], [0, 3276]),
    }),
  }),
  15: Object.freeze({
    sources: Object.freeze({
      RDDT: 'api-bars-RDDT-tf15.json.gz vs vw-bar-counters-rddt-15-2026-09-30',
      SPY: 'api-bars-SPY-tf15.json.gz vs vw-time-tf-spy-15-2026-10-01',
    }),
    sessions: Object.freeze({ RDDT: 632, SPY: 126 }),
    last: Object.freeze({
      RDDT: m([632, 632], [632, 632], [631, 632], [632, 632], [613, 632], [0, 632]),
      SPY: m([126, 126], [126, 126], [126, 126], [126, 126], [117, 126], [0, 126]),
    }),
    every: Object.freeze({
      RDDT: m([16360, 16360], [16330, 16360], [16354, 16360], [16354, 16360], [16302, 16360], [0, 16360]),
      SPY: m([3276, 3276], [3210, 3276], [3268, 3276], [3271, 3276], [3263, 3276], [0, 3276]),
    }),
  }),
  60: Object.freeze({
    sources: Object.freeze({
      RDDT: 'api-bars-RDDT-tf15.json.gz (bucketed from 09:30) vs vw-bar-counters-rddt-60-2026-09-30',
      SPY: 'api-bars-SPY-tf15.json.gz (bucketed from 09:30) vs vw-bool-cast-spy-60-2026-09-28',
    }),
    sessions: Object.freeze({ RDDT: 632, SPY: 752 }),
    last: Object.freeze({
      RDDT: m([632, 632], [632, 632], [631, 632], [632, 632], [613, 632], [0, 632]),
      SPY: m([752, 752], [752, 752], [744, 752], [746, 752], [727, 752], [0, 752]),
    }),
    every: Object.freeze({
      RDDT: m([4406, 4406], [4377, 4406], [4401, 4406], [4403, 4406], [4378, 4406], [0, 4406]),
      SPY: m([5246, 5246], [4929, 5246], [5192, 5246], [5201, 5246], [5218, 5246], [0, 5246]),
    }),
  }),
  240: Object.freeze({
    sources: Object.freeze({
      RDDT: 'api-bars-RDDT-tf15.json.gz (bucketed from 09:30) vs vw-bar-counters-rddt-240-2026-09-30',
      SPY: 'api-bars-SPY-tf15.json.gz (bucketed from 09:30) vs vw-time-tf-spy-240-2026-10-02',
    }),
    sessions: Object.freeze({ RDDT: 632, SPY: 603 }),
    last: Object.freeze({
      RDDT: m([632, 632], [632, 632], [631, 632], [631, 632], [613, 632], [0, 632]),
      SPY: m([603, 603], [599, 603], [591, 603], [594, 603], [580, 603], [0, 603]),
    }),
    every: Object.freeze({
      RDDT: m([1258, 1258], [1229, 1258], [1255, 1258], [1257, 1258], [1238, 1258], [0, 1258]),
      SPY: m([1200, 1200], [933, 1200], [1183, 1200], [1186, 1200], [1177, 1200], [0, 1200]),
    }),
  }),
})

/** Why a field disagrees, in the member's words — the measured cause. */
export const FIELD_CAUSE = Object.freeze({
  t: 'the intrabar times',
  o: 'our 09:30 bar opens at the official opening print and TradingView\'s at another trade',
  h: 'a late or out-of-sequence print sets a high on one side and not the other',
  l: 'a late or out-of-sequence print sets a low on one side and not the other',
  c: 'the session\'s last print is a different trade on about 1 day in 30, 1-3 cents apart',
  v: 'TradingView\'s intraday volume is a subset of the consolidated volume our bars hold '
    + '(ours / theirs a median 1.38 per 15-minute bar; the daily volumes are equal)',
})

const FIELD_NAME = Object.freeze({ t: 'time', o: 'open', h: 'high', l: 'low', c: 'close', v: 'volume' })

const pct = (eq, n) => `${eq} / ${n}`

/** Does `field` at `code` meet the bar for a read of reach `reach`?
 *  `{ok, line}` — `line` names the first listing and measurement that fails it. */
export function fieldServes(code, field, reach, evidence = EVIDENCE, bar = BAR) {
  const e = evidence[String(code)]
  if (!e) return { ok: false, line: `\`${code}\` was not measured against TradingView` }
  if (!FIELDS.includes(field)) return { ok: false, line: `\`${field}\` is not a bar field that was measured` }
  const kinds = reach > 0 ? ['last', 'every'] : ['last']
  for (const listing of bar.listings) {
    const sessions = e.sessions && e.sessions[listing]
    if (!(sessions >= bar.minSessions)) {
      return { ok: false, line: `${listing} at \`${code}\` was compared on ${sessions || 0} sessions, `
        + `fewer than ${bar.minSessions}` }
    }
    for (const kind of kinds) {
      const cell = e[kind] && e[kind][listing] && e[kind][listing][field]
      if (!cell || !(cell[1] > 0) || !(cell[0] / cell[1] >= bar.share)) {
        const where = kind === 'last' ? 'the session\'s last' : 'every'
        return { ok: false, line: `${FIELD_NAME[field]} of ${where} \`${code}\` bar equals TradingView's on `
          + `${cell ? pct(cell[0], cell[1]) : 'no'} ${listing} ${kind === 'last' ? 'sessions' : 'bars'} `
          + `(${e.sources[listing]}) — ${FIELD_CAUSE[field]}` }
      }
    }
  }
  return { ok: true, line: null }
}

const CLOCK = new Set(Object.keys(TABLE.clock || {}))
const SERIES_FIELD = Object.freeze(Object.fromEntries(Object.entries(TABLE.series || {})
  .map(([name, spec]) => [name, spec && spec.field])))
const BAR_READER = new Set(BAR_READERS)
/** Node types that read no bar field themselves. Anything else is not understood
 *  here, so it cannot be cleared: it demands every field. */
const INERT = new Set(['num', 'op', 'call', 'offset', 'str', 'symtext', 'textop', 'tf', 'tf_live', 'sym', 'ltf'])

/** ⭐ WHAT ONE `ltf` CHILD CONSUMES: the bar fields its leaves read and its reach
 *  in intrabars. A function that reads the whole bar (`reads: 'bars'`, e.g.
 *  `vwap`) reads every field; an unreadable reach is unbounded. Fail closed. */
export function demandOf(child) {
  const fields = new Set()
  const stack = [child]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'series') {
      if (CLOCK.has(n.name)) fields.add('t')
      else if (SERIES_FIELD[n.name]) fields.add(SERIES_FIELD[n.name])
      else for (const f of FIELDS) fields.add(f)
    } else if (n.type === 'call' && BAR_READER.has(n.name)) {
      for (const f of FIELDS) fields.add(f)
    } else if (!INERT.has(n.type)) {
      for (const f of FIELDS) fields.add(f)
    }
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  let reach
  try { reach = maxLookback(child) } catch { reach = Infinity }
  if (!Number.isFinite(reach) && reach !== Infinity) reach = Infinity
  return { fields: [...fields].sort((a, b) => FIELDS.indexOf(a) - FIELDS.indexOf(b)), reach }
}

/** Every `ltf` node a document holds, by code (its plots, objects and any other
 *  tree it carries), memoised per document object. */
const _nodesMemo = new WeakMap()
export function lowerTfChildrenOf(def) {
  if (!def || typeof def !== 'object') return new Map()
  if (_nodesMemo.has(def)) return _nodesMemo.get(def)
  const byCode = new Map()
  const stack = [def]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'ltf' && typeof n.value === 'string' && Array.isArray(n.args)) {
      if (!byCode.has(n.value)) byCode.set(n.value, [])
      byCode.get(n.value).push(n.args[0])
    }
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue }
    for (const k of Object.keys(n)) if (k !== 'tok' && k !== 'endTok') stack.push(n[k])
  }
  _nodesMemo.set(def, byCode)
  return byCode
}

/** ⭐⭐ MAY OUR STORE SERVE `code` FOR THIS DOCUMENT? null when every `ltf` child at
 *  `code` reads only fields that meet the bar at its reach; otherwise
 *  `{code: STORE_DISAGREES, why}` naming the first field, listing and number that
 *  fails. A stamped code with no child found is refused too (fail closed). */
export function lowerTfStoreRefusal(def, code, evidence = EVIDENCE, bar = BAR) {
  const c = String(code)
  const children = lowerTfChildrenOf(def).get(c) || []
  const shown = `\`${c}\``
  if (!children.length) {
    return { code: STORE_DISAGREES,
      why: `${STORE_DISAGREES}: no expression read at ${shown} was found in this document, so what `
        + 'it consumes from our intraday bars cannot be checked against what was measured' }
  }
  for (const child of children) {
    const { fields, reach } = demandOf(child)
    for (const f of fields) {
      const r = fieldServes(c, f, reach, evidence, bar)
      if (!r.ok) {
        return { code: STORE_DISAGREES,
          why: `${STORE_DISAGREES}: the expression read at ${shown}, below this chart's timeframe, reads `
            + `${FIELD_NAME[f]}${reach > 0 ? ` over ${reach === Infinity ? 'an unbounded' : reach} intrabar`
              + `${reach === 1 ? '' : 's'} of history` : ''} from our intraday bars, and they are not `
            + `TradingView's there: ${r.line}` }
      }
    }
  }
  return null
}
