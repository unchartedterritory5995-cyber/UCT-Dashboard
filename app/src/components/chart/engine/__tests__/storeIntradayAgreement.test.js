// app/src/components/chart/engine/__tests__/storeIntradayAgreement.test.js
//
// ─── ⭐⭐ C41 — THE MEASUREMENT THAT FLIPS `VITE_PINE_LOWER_TF_ENABLED` ─────────
//
// `lowerTfGate.js` keeps every read below the chart's timeframe refused
// (`lower-tf:store-unmeasured`) until OUR intraday bars have been compared with
// TradingView's. This is that comparison:
//
//   store   the exact JSON `GET /api/bars/RDDT?tf=15&bars=60000` returns, saved as it
//           arrived, at a LOCAL path outside the repo named by `STORE_INTRADAY_LOCAL`
//   vendor  tests/fixtures/vendor/harness/vw-bar-counters-rddt-15-2026-09-30.json
//
// ⛔⛔ e98 (coordinator ruling 2026-11-26) — THE STORE PAYLOAD IS OUR DATA VENDOR'S LICENSED BARS AND IS NEVER
// COMMITTED to this public repo, uploaded to a runner or pasted anywhere. The test reads it ONLY from the local path
// in `STORE_INTRADAY_LOCAL` (the `PASTE_BYTES_LOCAL` precedent), refuses a path inside the repo by name, and SKIPS BY
// NAME when the variable is unset — so in CI this measurement never runs, and the controls below (on a synthetic
// payload built from the vendor capture's own bars) prove the comparison can fail. The verdict is local evidence, and
// the flag's flip rests on that evidence in its PR. `tests/test_fixture_bar_rows_guard.py` keeps a vendor-bar dump out
// of `tests/fixtures`.
//
// ⛔ WHEN THE LOCAL PAYLOAD IS GIVEN AND THIS GOES RED, THAT IS THE ANSWER: the
// store does not meet the proposed bar (`FLIP_CRITERION`) and the gate stays off.
// The assertion message carries the whole report.
//
// ⭐ e98 — PRICES ARE COMPARED AT THE STORE'S 4-DP GRAIN (`api/services/bars_fetch.py::PRICE_DP`, by design;
// TradingView's capture keeps 6): a difference past the 4th decimal is not a difference, one in the 4th is. Volume is
// compared exactly. The rail below holds the JS grain to the server's constant.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  barsOf, compareIntraday, agreementVerdict, describeAgreement, FLIP_CRITERION, KNOWN_DEFINITION_DIFFERENCES,
  STORE_PRICE_DP, samePrice, PENDING_KNOWN_DIFFERENCES,
} from './storeIntradayAgreement'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor/harness/vw-bar-counters-rddt-15-2026-09-30.json')
/** The local store payload, or null: never a path inside the repo (a committed copy of vendor bars). */
export function localStorePath(value, repo = REPO) {
  if (typeof value !== 'string' || !value.trim()) return null
  const p = path.resolve(value.trim())
  const rel = path.relative(path.resolve(repo), p)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`STORE_INTRADAY_LOCAL points inside the repo (${rel}): the store payload is licensed vendor data and is read only from outside it`)
  }
  return p
}
const STORE = localStorePath(process.env.STORE_INTRADAY_LOCAL)
const vendorBars = barsOf(JSON.parse(fs.readFileSync(VENDOR, 'utf8')))
const storePresent = !!STORE && fs.existsSync(STORE)

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

  it('⭐ e98 — the session\'s 09:30 OPEN is a known definition difference; the next bar\'s open is a price field', () => {
    const [first] = midSession()
    const k0 = vendorBars.indexOf(first)
    const movedFirst = vendorBars.map((b, i) => (i === k0 ? { ...b, o: b.o + 0.01 } : b))
    const r = compareIntraday(movedFirst, vendorBars)
    expect(r.totals.sessionOpen.differ, 'non-vacuous: the moved open is seen').toBe(1)
    expect(r.totals.sessionOpen.maxAbs).toBeCloseTo(0.01, 9)
    expect(r.totals.priceEqual).toBe(r.totals.sessions)
    expect(r.totals.fields.o.differ).toBe(0)
    expect(describeAgreement(r, agreementVerdict(r))).toContain('known definition differences (not failures)')
    // CONTROL: the session's SECOND bar's open moved is a price difference
    const movedSecond = vendorBars.map((b, i) => (i === k0 + 1 ? { ...b, o: b.o + 0.01 } : b))
    const r2 = compareIntraday(movedSecond, vendorBars)
    expect(r2.totals.sessionOpen.differ).toBe(0)
    expect(r2.totals.priceEqual).toBe(r2.totals.sessions - 1)
  })

  it('⭐ e98 — a store volume about 1.38x TradingView\'s on every bar is reported as a definition, never a failure', () => {
    const scaled = vendorBars.map((b) => ({ ...b, v: b.v * 1.38 }))
    const r = compareIntraday(scaled, vendorBars)
    const v = agreementVerdict(r)
    expect(v.pass).toBe(true)
    expect(v.measured.volume).toBe(0)
    const text = describeAgreement(r, v)
    expect(text).toContain(`volume: ${KNOWN_DEFINITION_DIFFERENCES.volume}`)
    expect(text).toMatch(/median 1\.380/)
    expect(text).not.toMatch(/against the proposed bar:[^\n]*volume/)
  })

  it('⭐ e98 — prices at the store\'s 4-dp grain: a 5th-decimal difference is the same price, a 4th-decimal one is not', () => {
    const k = Math.floor(vendorBars.length / 2)
    const fifth = vendorBars.map((b, i) => (i === k ? { ...b, c: Math.round(b.c * 1e4) / 1e4 + 0.00004 } : b))
    const base = vendorBars.map((b, i) => (i === k ? { ...b, c: Math.round(b.c * 1e4) / 1e4 } : b))
    expect(compareIntraday(fifth, base).totals.fields.c.differ, 'a 5th-decimal difference passes').toBe(0)
    // CONTROL: the 4th decimal is a difference
    const fourth = base.map((b, i) => (i === k ? { ...b, c: b.c + 0.0001 } : b))
    expect(compareIntraday(fourth, base).totals.fields.c.differ, 'a 4th-decimal difference fails').toBe(1)
    expect(samePrice(12.34571, 12.3457)).toBe(true)
    expect(samePrice(12.3456, 12.3457)).toBe(false)
    // volume is not rounded: one share apart is a difference
    const vol = base.map((b, i) => (i === k ? { ...b, v: b.v + 1 } : b))
    expect(compareIntraday(vol, base).totals.fields.v.differ).toBe(1)
  })

  it('⭐ e98 — the JS grain is the server\'s: STORE_PRICE_DP equals api/services/bars_fetch.py PRICE_DP', () => {
    const py = fs.readFileSync(path.join(REPO, 'api/services/bars_fetch.py'), 'utf8')
      .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    const m = /^PRICE_DP\s*=\s*(\d+)\s*$/m.exec(py)
    expect(m, 'PRICE_DP is declared on one line').toBeTruthy()
    expect(STORE_PRICE_DP).toBe(Number(m[1]))
  })

  it('⭐ e98 — the odd-lot-print line is prepared and INACTIVE: the bars it would name still count as differences', () => {
    expect(PENDING_KNOWN_DIFFERENCES.oddLotPrint).toMatchObject({ sentence: 'differs only by an odd-lot print', active: false })
    const k = Math.floor(vendorBars.length / 2)
    const moved = vendorBars.map((b, i) => (i === k ? { ...b, h: b.h + 0.05 } : b))
    const r = compareIntraday(moved, vendorBars, '15', { oddLotPrintBars: [vendorBars[k].t] })
    expect(r.totals.fields.h.differ).toBe(1)
    expect(r.totals.oddLotPrint).toBe(0)
    expect(describeAgreement(r, agreementVerdict(r))).toContain('INACTIVE until')
  })

  it('the proposed bar is the one written down', () => {
    expect(FLIP_CRITERION).toEqual({ coverage: 0.99, price: 0.99, lastClose: 0.995, volumeNote: 0.99 })
  })

  it('⛔ the store payload is read only from OUTSIDE the repo, and an unset variable is no payload', () => {
    expect(localStorePath(undefined)).toBe(null)
    expect(localStorePath('  ')).toBe(null)
    expect(() => localStorePath(path.join(REPO, 'tests/fixtures/store/api-bars-RDDT-tf15.json')))
      .toThrow(/points inside the repo/)
    expect(localStorePath(path.join(path.dirname(REPO), 'elsewhere', 'api-bars-RDDT-tf15.json')))
      .toBe(path.resolve(path.dirname(REPO), 'elsewhere', 'api-bars-RDDT-tf15.json'))
  })
})

describe('C41 · storeIntradayAgreement — OUR store against TradingView (RDDT, 15m)', () => {
  const title = storePresent
    ? 'the local store payload meets the proposed bar for serving a lower-timeframe read'
    : 'SKIPPED — STORE_INTRADAY_LOCAL names no local store payload (the exact JSON of '
      + 'GET /api/bars/RDDT?tf=15&bars=60000, saved OUTSIDE the repo: licensed vendor data, never committed); '
      + 'until it is measured locally, VITE_PINE_LOWER_TF_ENABLED stays off'
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
