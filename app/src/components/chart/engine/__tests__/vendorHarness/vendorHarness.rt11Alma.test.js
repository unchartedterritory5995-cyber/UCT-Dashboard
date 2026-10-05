// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt11Alma.test.js
//
// ⭐⭐ RT11 (2026-10-04) — `alma` ON THE HOST LANE, GRADED ON TRADINGVIEW'S OWN NUMBERS.
//
// v4's bare `alma(src, length, offset, sigma)` and v5/v6's `ta.alma(…[, floor])` are
// `pine.js::BUILTIN_CALL_TREE.alma`: TradingView's published `pine_alma` written out
// as a weighted sum of the window's own offsets. Three captures say what it is:
//
//   · `h3-alma-v4-{rddt,spy}-1d-2026-10-02` (Q-H3c, //@version=4): bare `alma`
//     COMPILES; A01 is its raw value, A03..A06 are `alma - pine_alma` over four
//     argument sets (all ~0), A07 is when it is `na` (first value at bar 8).
//   · `vw-alma-spy-1d-2026-09-27` (//@version=6): `ta.alma` raw, its `floor` form,
//     the first non-`na` bar, and one `na` in the source poisoning the window.
//
// ⛔ CONTROLS: v6's BARE `alma` keeps its refusal (the vendor refuses it,
// `refusalsThatMeanOppositeThings.test.js`), `ta.alma` in a v4 script and bare
// `alma` in an unmeasured version (v3, v5, the formula box) refuse, and a length
// the bar decides refuses by name.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret } from '../../ast/interpret'
import { translatePine } from '../../ast/pine'
import { toProductBars } from './ourSide'
import { HARNESS_DIR } from './harness'

const VENDOR = path.resolve(HARNESS_DIR, '..')
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const V4 = {
  RDDT: load(path.join(HARNESS_DIR, 'h3-alma-v4-rddt-1d-2026-10-02.json')),
  SPY: load(path.join(HARNESS_DIR, 'h3-alma-v4-spy-1d-2026-10-02.json')),
}
const V6 = load(path.join(VENDOR, 'vw-alma-spy-1d-2026-09-27.json'))

const col = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  if (!plot) throw new Error(`no plot ${title}`)
  const k = cap.plotValues.fields.indexOf(plot.id)
  return cap.plotValues.rows.map((r) => r[k])
}
const isNa = (v) => v === null || v === undefined || Number.isNaN(v)

/** The translated output `k` of `src`, interpreted on the capture's bars. */
function ours(src, bars, k = 0) {
  const t = translatePine(src, { strict: true })
  expect(t.ok, JSON.stringify(t.refusal || null)).toBe(true)
  return interpret(t.outputs[k].ast, bars, {})
}

/** TradingView's `pine_alma`, as the Q-H3c probe writes it out by hand. */
function referenceAlma(xs, len, off, sig, floor = false) {
  const m = floor ? Math.floor(off * (len - 1)) : off * (len - 1)
  const s = len / sig
  return xs.map((_, bar) => {
    let norm = 0
    let sum = 0
    for (let i = 0; i <= len - 1; i += 1) {
      const weight = Math.exp(-1 * Math.pow(i - m, 2) / (2 * Math.pow(s, 2)))
      norm += weight
      const k = bar - (len - i - 1)
      const v = k >= 0 ? xs[k] : NaN
      sum += v * weight
    }
    return sum / norm
  })
}

/** ⛔ `from`: a capture that does not start at the listing (`history.startsAtBar0`
 *  false — SPY's 1800 bars) holds the vendor's values on bars whose window reaches
 *  before the capture; those are the WINDOW's, not the formula's, and are skipped. */
function agree(a, b, from = 0) {
  let compared = 0
  let worst = 0
  let naDisagree = 0
  for (let i = from; i < a.length; i += 1) {
    if (isNa(a[i]) !== isNa(b[i])) { naDisagree += 1; continue }
    if (isNa(a[i])) continue
    compared += 1
    worst = Math.max(worst, Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])))
  }
  return { compared, worst, naDisagree }
}

const head4 = '//@version=4\nstudy("rt11")\n'
const head6 = '//@version=6\nindicator("rt11")\n'
const guard = (src) => {
  const t = translatePine(src, { strict: true })
  return t.ok ? 'ok' : String((t.refusal || {}).guard || '?')
}

describe('RT11 — v4 bare `alma` is TradingView\'s on every bar (Q-H3c)', () => {
  for (const [sym, cap] of Object.entries(V4)) {
    const bars = toProductBars(cap)
    const fromListing = cap.history && cap.history.startsAtBar0 === true
    const from = fromListing ? 0 : 19 // the longest window graded is 20
    it(`${sym}: the capture says alma == pine_alma (A03..A06 ~0), and A01 is our value bar for bar`, () => {
      expect(cap.plotValues.rows.length).toBe(bars.length)
      for (const t of ['A03_alma_MINUS_reference_MUST_BE_0', 'A04_high_20_MINUS_reference_MUST_BE_0',
        'A05_low_14_05_2_MINUS_reference_MUST_BE_0', 'A06_offset_1_MINUS_reference_MUST_BE_0']) {
        const d = col(cap, t).filter((v) => !isNa(v))
        expect(d.length, t).toBeGreaterThan(400)
        expect(Math.max(...d.map(Math.abs)), t).toBeLessThan(1e-9)
      }
      const r = agree(ours(`${head4}plot(alma(close, 9, 0.85, 6))\n`, bars), col(cap, 'A01_alma_close_9_085_6_RAW'), from)
      expect(r.naDisagree).toBe(0)
      expect(r.compared).toBeGreaterThan(400)
      expect(r.worst).toBeLessThan(1e-12)
    })
    it(`${sym}: the first value is bar length-1 from the listing (A07), and the other three argument sets equal pine_alma`, () => {
      const isna = col(cap, 'A07_alma_is_na')
      const o = ours(`${head4}plot(alma(close, 9, 0.85, 6))\n`, bars)
      if (fromListing) {
        for (let i = 0; i < 12; i += 1) expect(isNa(o[i]) ? 1 : 0, `bar ${i}`).toBe(isna[i])
        expect(isna.indexOf(0)).toBe(8)
      } else {
        // off the listing the vendor's window reaches before the capture; ours is full from bar 8
        expect(isna.every((v) => v === 0)).toBe(true)
        expect(o.slice(8).every((v) => !isNa(v))).toBe(true)
      }
      const src = { high: bars.map((b) => b.h), low: bars.map((b) => b.l), close: bars.map((b) => b.c) }
      for (const [s, n, off, sig] of [['high', 20, 0.85, 6], ['low', 14, 0.5, 2], ['close', 9, 1.0, 6]]) {
        const r = agree(ours(`${head4}plot(alma(${s}, ${n}, ${off}, ${sig}))\n`, bars), referenceAlma(src[s], n, off, sig))
        expect(r.naDisagree, s).toBe(0)
        expect(r.worst, s).toBeLessThan(1e-12)
      }
    })
  }
})

describe('RT11 — v6 `ta.alma` is TradingView\'s (vw-alma SPY 1D, 8472 bars)', () => {
  const bars = toProductBars(V6)
  it('A01 raw and A02 floor = our value on every bar, na on the same bars', () => {
    expect(V6.plotValues.rows.length).toBe(bars.length)
    const a01 = agree(ours(`${head6}plot(ta.alma(close, 9, 0.85, 6))\n`, bars), col(V6, 'A01_alma_close_9_085_6'))
    expect(a01.naDisagree).toBe(0)
    expect(a01.compared).toBeGreaterThan(8000)
    expect(a01.worst).toBeLessThan(1e-9)
    const a02 = agree(ours(`${head6}plot(ta.alma(close, 9, 0.85, 6, true))\n`, bars), col(V6, 'A02_alma_floor_true'))
    expect(a02.naDisagree).toBe(0)
    expect(a02.worst).toBeLessThan(1e-9)
    // ⛔ non-vacuity: `floor` moves the value on this series
    const raw = col(V6, 'A01_alma_close_9_085_6')
    const fl = col(V6, 'A02_alma_floor_true')
    expect(raw.filter((v, i) => !isNa(v) && Math.abs(v - fl[i]) > 1e-6).length).toBeGreaterThan(1000)
  })
  it('A03 first non-na bar is 8; A05 an na in the source is na for exactly `length` bars, as ours', () => {
    expect(col(V6, 'A03_first_nonNA_bar').findIndex((v) => v !== -1)).toBe(8)
    const r = agree(ours(`${head6}holed = bar_index % 50 == 25 ? na : close\nplot(ta.alma(holed, 9, 0.85, 6))\n`, bars),
      col(V6, 'A05_alma_over_series_with_na'))
    expect(r.naDisagree).toBe(0)
    expect(r.worst).toBeLessThan(1e-9)
    // ⛔ non-vacuity: the holes are there in the vendor column (9 na bars per hole)
    expect(col(V6, 'A05_alma_over_series_with_na').filter(isNa).length).toBeGreaterThan(8 + 9 * 100)
  })
})

describe('RT11 — the spellings that keep their refusal', () => {
  it('⛔ v6 bare `alma` (the vendor refuses it) and v5 / v3 / formula-box bare `alma` stay pine:function', () => {
    expect(guard(`${head6}plot(alma(close, 9, 0.85, 6))\n`)).toBe('pine:function')
    expect(guard('//@version=5\nindicator("rt11")\nplot(alma(close, 9, 0.85, 6))\n')).toBe('pine:function')
    expect(guard('//@version=3\nstudy("rt11")\nplot(alma(close, 9, 0.85, 6))\n')).toBe('pine:function')
    expect(guard(`${head4}plot(ta.alma(close, 9, 0.85, 6))\n`)).toBe('pine:function')
    expect(translatePine('alma(close, 9, 0.85, 6)', { strict: true }).ok).toBe(false)
  })
  it('⛔ CONTROL: the served spellings are ok, so the refusals above are about spelling', () => {
    expect(guard(`${head4}plot(alma(close, 9, 0.85, 6))\n`)).toBe('ok')
    expect(guard(`${head6}plot(ta.alma(close, 9, 0.85, 6))\n`)).toBe('ok')
    expect(guard('//@version=5\nindicator("rt11")\nplot(ta.alma(close, 9, 0.85, 6))\n')).toBe('ok')
  })
  it('⛔ a length the bar decides, a zero sigma, or a length past 500 refuses pine:arity by name', () => {
    expect(guard(`${head6}n = bar_index % 5 + 2\nplot(ta.alma(close, n, 0.85, 6))\n`)).not.toBe('ok')
    const t = translatePine(`${head6}plot(ta.alma(close, 9, 0.85, 0))\n`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
    expect(t.refusal.message).toMatch(/Gaussian fixed before bar 0/)
    expect(guard(`${head6}plot(ta.alma(close, 501, 0.85, 6))\n`)).toBe('pine:arity')
    expect(guard(`${head6}plot(ta.alma(close, 9, 0.85, 6, 2))\n`)).toBe('pine:arity')
  })
  it('an input length folds like any other window length', () => {
    expect(guard(`${head4}len = input(12, title="L", minval=1)\nplot(alma(high, len, 0.85, 6))\n`)).toBe('ok')
  })
})
