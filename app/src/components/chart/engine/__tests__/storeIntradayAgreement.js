// app/src/components/chart/engine/__tests__/storeIntradayAgreement.js
//
// ─── ⭐⭐ C41 — DO OUR STORE'S INTRADAY BARS AGREE WITH TRADINGVIEW'S? ───────────
//
// The measurement `VITE_PINE_LOWER_TF_ENABLED` waits on (`lowerTfGate.js`). C41's
// rule is proved on TradingView's own intraday bars; the product reads OURS
// (`/api/bars/<ticker>?tf=15`). This compares the two, bar for bar, through the
// SAME reading the product uses — `lowerTf.js::intrabarSeries`: TradingView's
// regular session for the day, slots counted from 09:30 — so what is compared is
// exactly what an `ltf` read would be handed. Nothing here restates that rule.
//
// Test infrastructure: imported by `storeIntradayAgreement.test.js` only.

import { intrabarSeries } from '../lowerTf.js'

const FIELDS = ['o', 'h', 'l', 'c', 'v']
const PRICE = ['o', 'h', 'l', 'c']
/** Two numbers are the SAME bar value within float noise — not within a tick. */
export const EQUAL_EPS = 1e-9
const same = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= EQUAL_EPS * Math.max(1, Math.abs(a), Math.abs(b)))
const isoOf = (ymd) => `${String(Math.floor(ymd / 10000)).padStart(4, '0')}-`
  + `${String(Math.floor(ymd / 100) % 100).padStart(2, '0')}-${String(ymd % 100).padStart(2, '0')}`

/** The bars of the payload `/api/bars/<ticker>?tf=<n>` returns (`{bars: [...]}`),
 *  or of a vendor capture (`{bars: {rows: [[t,o,h,l,c,v], …]}}`), as `{t,o,h,l,c,v}`. */
export function barsOf(doc) {
  if (doc && Array.isArray(doc.bars)) return doc.bars
  if (doc && doc.bars && Array.isArray(doc.bars.rows)) {
    return doc.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v === null || v === undefined ? 0 : v }))
  }
  return []
}

/**
 * Compare two sets of intraday bars at `code` minutes, session by session.
 *
 * Only sessions inside BOTH supplies' date spans are counted (a session one side
 * has no history for says nothing about agreement). Per session:
 *   `both` bars at the same slot on both sides · `onlyStore` / `onlyVendor` ·
 *   per field: `equal`, `differ`, `maxAbs`, `maxRel` over the `both` bars ·
 *   `fullyEqual` (same slots, every O/H/L/C/V equal) · `priceEqual` (O/H/L/C) ·
 *   `lastCloseEqual` (the session's LAST bar on each side has one slot and one
 *   close — the value `request.security(…, "<code>", close)` reads for the day) ·
 *   `storeComplete` / `vendorComplete` (`intrabarSeries`' own completeness).
 */
export function compareIntraday(storeBars, vendorBars, code = '15') {
  const src = String(code)
  const ours = intrabarSeries(storeBars, src, src)
  const theirs = intrabarSeries(vendorBars, src, src)
  const span = (s) => { const k = [...s.sessions.keys()]; return k.length ? [Math.min(...k), Math.max(...k)] : null }
  const a = span(ours); const b = span(theirs)
  const sessions = []
  const totals = {
    code: src, sessions: 0, storeComplete: 0, vendorComplete: 0, bothComplete: 0,
    fullyEqual: 0, priceEqual: 0, lastCloseEqual: 0, bars: { both: 0, onlyStore: 0, onlyVendor: 0 },
    fields: Object.fromEntries(FIELDS.map((f) => [f, { equal: 0, differ: 0, maxAbs: 0, maxRel: 0 }])),
    span: a && b ? { from: isoOf(Math.max(a[0], b[0])), to: isoOf(Math.min(a[1], b[1])) } : null,
  }
  if (!a || !b) return { totals, sessions }
  const from = Math.max(a[0], b[0]); const to = Math.min(a[1], b[1])
  const days = [...new Set([...ours.sessions.keys(), ...theirs.sessions.keys()])]
    .filter((d) => d >= from && d <= to).sort((x, y) => x - y)
  const slice = (s, ymd) => { const m = s.sessions.get(ymd); return m ? s.bars.slice(m.from, m.to) : [] }
  for (const ymd of days) {
    const sb = slice(ours, ymd); const vb = slice(theirs, ymd)
    const vAt = new Map(vb.map((x) => [x.t, x]))
    const sAt = new Map(sb.map((x) => [x.t, x]))
    const row = {
      day: isoOf(ymd), both: 0, onlyStore: 0, onlyVendor: 0,
      storeComplete: !!(ours.sessions.get(ymd) && ours.sessions.get(ymd).complete),
      vendorComplete: !!(theirs.sessions.get(ymd) && theirs.sessions.get(ymd).complete),
      fields: Object.fromEntries(FIELDS.map((f) => [f, { equal: 0, differ: 0, maxAbs: 0, maxRel: 0 }])),
    }
    for (const x of sb) {
      const y = vAt.get(x.t)
      if (!y) { row.onlyStore += 1; continue }
      row.both += 1
      for (const f of FIELDS) {
        const cell = row.fields[f]
        if (same(x[f], y[f])) { cell.equal += 1; continue }
        cell.differ += 1
        const abs = Math.abs(x[f] - y[f])
        const rel = abs / Math.max(Math.abs(y[f]), Number.MIN_VALUE)
        if (!(abs <= cell.maxAbs)) cell.maxAbs = abs
        if (!(rel <= cell.maxRel)) cell.maxRel = rel
      }
    }
    for (const y of vb) if (!sAt.has(y.t)) row.onlyVendor += 1
    const sameSlots = row.onlyStore === 0 && row.onlyVendor === 0 && row.both > 0
    row.priceEqual = sameSlots && PRICE.every((f) => row.fields[f].differ === 0)
    row.fullyEqual = row.priceEqual && row.fields.v.differ === 0
    const ls = sb[sb.length - 1]; const lv = vb[vb.length - 1]
    row.lastCloseEqual = !!ls && !!lv && ls.t === lv.t && same(ls.c, lv.c)
    sessions.push(row)
    totals.sessions += 1
    if (row.storeComplete) totals.storeComplete += 1
    if (row.vendorComplete) totals.vendorComplete += 1
    if (row.storeComplete && row.vendorComplete) totals.bothComplete += 1
    if (row.fullyEqual) totals.fullyEqual += 1
    if (row.priceEqual) totals.priceEqual += 1
    if (row.lastCloseEqual) totals.lastCloseEqual += 1
    totals.bars.both += row.both; totals.bars.onlyStore += row.onlyStore; totals.bars.onlyVendor += row.onlyVendor
    for (const f of FIELDS) {
      const t = totals.fields[f]; const c = row.fields[f]
      t.equal += c.equal; t.differ += c.differ
      if (c.maxAbs > t.maxAbs) t.maxAbs = c.maxAbs
      if (c.maxRel > t.maxRel) t.maxRel = c.maxRel
    }
  }
  return { totals, sessions }
}

/** ⭐ THE PROPOSED BAR FOR FLIPPING THE GATE (a proposal — the flip is an owner
 *  decision). A lower-timeframe child reads the whole intraday series (an EMA
 *  over the closes, a session high), so the last close alone is not enough:
 *
 *    coverage    ≥ 99% of the vendor's complete sessions are complete in the store
 *    price       ≥ 99% of the sessions complete on both sides are equal on EVERY
 *                bar's open, high, low and close
 *    lastClose   ≥ 99.5% of those sessions have the same last-bar close
 *    volume      reported, NOT gating — but below 99% a child that reads `volume`
 *                is not covered by this measurement and must stay refused
 *
 *  ⛔ One symbol does not establish a store. The proposal is this bar on RDDT
 *  (listed 2024, no split) AND on a second, older symbol (SPY) before the flip. */
export const FLIP_CRITERION = Object.freeze({ coverage: 0.99, price: 0.99, lastClose: 0.995, volumeNote: 0.99 })

export function agreementVerdict(report, criterion = FLIP_CRITERION) {
  const t = report.totals
  const ratio = (n, d) => (d > 0 ? n / d : 0)
  const both = report.sessions.filter((s) => s.storeComplete && s.vendorComplete)
  const measured = {
    sessions: t.sessions,
    coverage: ratio(t.bothComplete, t.vendorComplete),
    price: ratio(both.filter((s) => s.priceEqual).length, both.length),
    lastClose: ratio(both.filter((s) => s.lastCloseEqual).length, both.length),
    volume: ratio(both.filter((s) => s.fullyEqual).length, both.length),
  }
  const reasons = []
  if (!t.sessions) reasons.push('no session lies inside both supplies')
  for (const k of ['coverage', 'price', 'lastClose']) {
    if (!(measured[k] >= criterion[k])) reasons.push(`${k} ${(measured[k] * 100).toFixed(2)}% is below ${(criterion[k] * 100).toFixed(1)}%`)
  }
  return {
    pass: reasons.length === 0, reasons, measured,
    volumeCovered: measured.volume >= criterion.volumeNote,
  }
}

/** One paragraph a person can read in an assertion message. */
export function describeAgreement(report, verdict) {
  const t = report.totals
  const pct = (x) => `${(x * 100).toFixed(2)}%`
  const f = (k) => `${k} ${t.fields[k].equal}/${t.fields[k].equal + t.fields[k].differ}`
    + (t.fields[k].differ ? ` (max abs ${t.fields[k].maxAbs}, max rel ${t.fields[k].maxRel.toExponential(2)})` : '')
  return [
    `${t.code}m, sessions inside both supplies ${t.span ? `${t.span.from} → ${t.span.to}` : '(none)'}: ${t.sessions}`,
    `complete: store ${t.storeComplete}, vendor ${t.vendorComplete}, both ${t.bothComplete}`,
    `bars: both ${t.bars.both}, only store ${t.bars.onlyStore}, only vendor ${t.bars.onlyVendor}`,
    `equal bars — ${FIELDS.map(f).join(' · ')}`,
    `sessions fully equal ${t.fullyEqual}, price-equal ${t.priceEqual}, last close equal ${t.lastCloseEqual}`,
    `against the proposed bar: coverage ${pct(verdict.measured.coverage)}, price ${pct(verdict.measured.price)}, `
      + `last close ${pct(verdict.measured.lastClose)}, volume ${pct(verdict.measured.volume)} `
      + `→ ${verdict.pass ? 'MEETS it' : `does NOT meet it (${verdict.reasons.join('; ')})`}`,
  ].join('\n')
}
