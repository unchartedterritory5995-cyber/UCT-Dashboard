// app/src/components/chart/engine/__tests__/storeIntradayAgreement.test.js
//
// ─── ⭐⭐ C41 — THE MEASUREMENT THAT FLIPS `VITE_PINE_LOWER_TF_ENABLED` ─────────
//
// `lowerTfGate.js` keeps every read below the chart's timeframe refused
// (`lower-tf:store-unmeasured`) until OUR intraday bars have been compared with
// TradingView's. This is that comparison:
//
//   store   tests/fixtures/store/api-bars-RDDT-tf15.json — the exact JSON
//           `GET /api/bars/RDDT?tf=15&bars=60000` returns, saved as it arrived
//   vendor  tests/fixtures/vendor/harness/vw-bar-counters-rddt-15-2026-09-30.json
//
// ⛔ NO STORE PAYLOAD IS COMMITTED YET (fetching production is the integrator's /
// owner's step). Until one is, the measurement SKIPS BY NAME — the skipped test's
// title says what is missing — and the controls below prove the comparison can
// fail, on a synthetic payload built from the vendor's own bars.
//
// ⛔ WHEN THE PAYLOAD IS COMMITTED AND THIS GOES RED, THAT IS THE ANSWER: the
// store does not meet the proposed bar (`FLIP_CRITERION`) and the gate stays off.
// The assertion message carries the whole report.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  barsOf, compareIntraday, agreementVerdict, describeAgreement, FLIP_CRITERION,
} from './storeIntradayAgreement'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor/harness/vw-bar-counters-rddt-15-2026-09-30.json')
const STORE = path.join(REPO, 'tests/fixtures/store/api-bars-RDDT-tf15.json')
const vendorBars = barsOf(JSON.parse(fs.readFileSync(VENDOR, 'utf8')))
const storePresent = fs.existsSync(STORE)

describe('C41 · storeIntradayAgreement — the comparison itself (controls on the vendor\'s own bars)', () => {
  // the store's shape: `{bars: [{t,o,h,l,c,v}]}`, extended hours included
  const asStore = (bars) => ({ bars: bars.map((b) => ({ ...b })) })
  /** [first bar, last bar] of a full regular session in the middle of the fixture
   *  (a regular-session bar's UTC date is its New York date). */
  const midSession = () => {
    const r0 = compareIntraday(vendorBars, vendorBars)
    const full = r0.sessions.filter((s) => s.both === 26)
    const day = full[Math.floor(full.length / 2)].day
    const rows = vendorBars.filter((b) => new Date(b.t * 1000).toISOString().slice(0, 10) === day)
    return [rows[0], rows[rows.length - 1], vendorBars.indexOf(rows[rows.length - 1])]
  }

  it('non-vacuity: the vendor fixture holds regular-session 15m bars over hundreds of sessions', () => {
    expect(vendorBars.length).toBeGreaterThan(10000)
    const r = compareIntraday(vendorBars, vendorBars)
    expect(r.totals.sessions).toBeGreaterThan(500)
    expect(r.totals.bars.both).toBeGreaterThan(10000)
  })

  it('⭐ identical bars agree on every session, and meet the proposed bar', () => {
    const r = compareIntraday(barsOf(asStore(vendorBars)), vendorBars)
    expect(r.totals.fullyEqual).toBe(r.totals.sessions)
    expect(r.totals.lastCloseEqual).toBe(r.totals.sessions)
    expect(r.totals.bars.onlyStore + r.totals.bars.onlyVendor).toBe(0)
    for (const f of ['o', 'h', 'l', 'c', 'v']) expect(r.totals.fields[f].differ).toBe(0)
    expect(agreementVerdict(r).pass).toBe(true)
  })

  it('⭐ the regular-session filter is applied to the store side: extended-hours bars change nothing', () => {
    const [first, last] = midSession()
    const pre = { ...first, t: first.t - 3600 * 2, c: 1, o: 1, h: 1, l: 1 } // 07:30 ET, pre-market
    const post = { ...last, t: last.t + 3600 * 2, c: 9e9 } // after the close
    const r = compareIntraday([pre, ...vendorBars, post], vendorBars)
    expect(vendorBars.some((b) => b.t === pre.t || b.t === post.t)).toBe(false)
    expect(r.totals.bars.onlyStore).toBe(0)
    expect(r.totals.fullyEqual).toBe(r.totals.sessions)
  })

  it('⛔ CONTROL — ONE moved close is found: one bar, one session, its size reported', () => {
    const k = Math.floor(vendorBars.length / 2)
    const moved = vendorBars.map((b, i) => (i === k ? { ...b, c: b.c + 0.25 } : b))
    const r = compareIntraday(moved, vendorBars)
    expect(r.totals.fields.c.differ).toBe(1)
    expect(r.totals.fields.c.maxAbs).toBeCloseTo(0.25, 9)
    expect(r.totals.fields.c.maxRel).toBeGreaterThan(0)
    expect(r.totals.fullyEqual).toBe(r.totals.sessions - 1)
    expect(r.totals.priceEqual).toBe(r.totals.sessions - 1)
    expect(r.sessions.filter((s) => !s.fullyEqual).length).toBe(1)
    // the other four fields are untouched
    for (const f of ['o', 'h', 'l', 'v']) expect(r.totals.fields[f].differ).toBe(0)
  })

  it('⛔ CONTROL — a moved LAST bar of a session moves the value a `"15"` read serves', () => {
    const [, , last] = midSession()
    const moved = vendorBars.map((b, i) => (i === last ? { ...b, c: b.c * 1.01 } : b))
    const r = compareIntraday(moved, vendorBars)
    expect(r.totals.lastCloseEqual).toBe(r.totals.sessions - 1)
  })

  it('⛔ CONTROL — a bar the store lacks is counted, and its session is not complete', () => {
    const k = Math.floor(vendorBars.length / 3)
    const r = compareIntraday(vendorBars.filter((_, i) => i !== k), vendorBars)
    expect(r.totals.bars.onlyVendor).toBe(1)
    expect(r.totals.storeComplete).toBe(r.totals.vendorComplete - 1)
    expect(r.totals.fullyEqual).toBe(r.totals.sessions - 1)
  })

  it('⛔ CONTROL — a store that disagrees does NOT meet the proposed bar, and says which line', () => {
    // every 50th close moved: far more than 1% of sessions carry a difference
    const bad = vendorBars.map((b, i) => (i % 50 === 0 ? { ...b, c: b.c + 0.01 } : b))
    const v = agreementVerdict(compareIntraday(bad, vendorBars))
    expect(v.pass).toBe(false)
    expect(v.reasons.some((x) => x.startsWith('price '))).toBe(true)
    // …and a store with no overlap at all is not a pass by default
    const none = agreementVerdict(compareIntraday([], vendorBars))
    expect(none.pass).toBe(false)
    expect(none.reasons).toContain('no session lies inside both supplies')
  })

  it('the proposed bar is the one written down', () => {
    expect(FLIP_CRITERION).toEqual({ coverage: 0.99, price: 0.99, lastClose: 0.995, volumeNote: 0.99 })
  })
})

describe('C41 · storeIntradayAgreement — OUR store against TradingView (RDDT, 15m)', () => {
  const title = storePresent
    ? 'the committed store payload meets the proposed bar for serving a lower-timeframe read'
    : 'SKIPPED — tests/fixtures/store/api-bars-RDDT-tf15.json is not committed '
      + '(save the exact JSON of GET /api/bars/RDDT?tf=15&bars=60000 there); '
      + 'until it is, VITE_PINE_LOWER_TF_ENABLED stays off'
  it.skipIf(!storePresent)(title, () => {
    const storeBars = barsOf(JSON.parse(fs.readFileSync(STORE, 'utf8')))
    expect(storeBars.length, 'the payload holds no bars').toBeGreaterThan(0)
    const report = compareIntraday(storeBars, vendorBars)
    const verdict = agreementVerdict(report)
    const text = describeAgreement(report, verdict)
    // eslint-disable-next-line no-console
    console.info(`[storeIntradayAgreement]\n${text}`)
    expect(report.totals.sessions, `no session lies inside both supplies\n${text}`).toBeGreaterThan(0)
    expect(verdict.pass, text).toBe(true)
  })
})
