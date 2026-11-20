// app/src/components/chart/engine/ast/rmaSeedDmi.test.js
//
// ─── ⭐⭐ RMA-SEED (NUMBER PENDING) — `ta.rma`'s SEED IS THE EXACTLY ROUNDED SUM, AND `ta.dmi` IS ITS BODY ─────
//
// Pine's `ta.rma` seeds with `ta.sma(src, length)`, and TradingView's `ta.sma` is the exactly rounded window sum
// (SMA-EXACT). The engine seeded `ta.rma` with a left-to-right sum. The first capture that separates the two:
// `vw-bi-dmi-{spy,rddt}-1d-2026-11-19` (committed, our own probe `vw-bi-dmi.pine`), whose W1-W4 subtract
// TradingView's "Directional Movement Index" body (written over `ta.rma`) from `ta.dmi` and read 0 on every
// bar. Of its six ADX seeds, three part a left-to-right sum from the exactly rounded one, and TradingView's
// value is the exactly rounded one at all three:
//   U3 `ta.dmi(17, 14)` ADX   AMEX:SPY bar 30    NYSE:RDDT bar 30
//   U4 `ta.dmi(14, 20)` ADX   AMEX:SPY bar 33
// With that seed, all seven `ta.dmi` columns are TradingView's bit for bit on every bar of both captures, on
// both lanes. `ta.dmi` itself is now `pine.js::PINE_TUPLE_BUILTINS.dmi` (unequal periods served); the house
// `computeADX` it replaced (a Wilder SUM, not `ta.rma`) missed +DI's last bit on most bars.
// (`docs/pine/evidence/2026-11-20-rma-seed-dmi/EVIDENCE.md`.)
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret, CARRIED, FN, FN_PINE, exactSum, rmaSeedMean, carriedCellsOf } from './interpret.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'
import { computeADX, computeRSI } from '../../indicators.js'
import { pineGt, pineEq } from '../pineCompare.js'

const REPO = path.resolve(process.cwd(), '..')
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const HOST_OPTS = { historyFromListing: true, tf: 'D', pineCompare: true }

/** A committed capture: its bars and TradingView's column for each plot title (NaN where TradingView plots na). */
function capture(sym) {
  const cap = JSON.parse(fs.readFileSync(path.join(REPO,
    `tests/fixtures/vendor/harness/vw-bi-dmi-${sym}-1d-2026-11-19.json`), 'utf8'))
  const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  const tv = {}
  cap.study.plots.forEach((p, k) => {
    const at = cap.plotValues.fields.indexOf(p.id)
    tv[p.title] = cap.plotValues.rows.map((r) => (r[at] === null ? NaN : r[at]))
  })
  return { bars, tv }
}
const SPY = capture('spy')
const RDDT = capture('rddt')

const COLUMNS = [
  ['p14', 'D1_plus_14_14'], ['m14', 'D2_minus_14_14'], ['a14', 'D3_adx_14_14'],
  ['p17', 'U1_plus_17_14'], ['m17', 'U2_minus_17_14'], ['a17', 'U3_adx_17_14'], ['a14b', 'U4_adx_14_20'],
]
const SOURCE = [
  '//@version=6', 'indicator("dmi")',
  '[p14, m14, a14] = ta.dmi(14, 14)', '[p17, m17, a17] = ta.dmi(17, 14)', '[p14b, m14b, a14b] = ta.dmi(14, 20)',
  ...COLUMNS.map(([v]) => `plot(${v})`),
].join('\n')

/** Bars where two columns differ: by bit pattern, `na` equal to `na` only. */
const offBars = (ours, want) => want.map((w, i) => i).filter((i) => !(Object.is(ours[i], want[i])
  || (Number.isNaN(ours[i]) && Number.isNaN(want[i]))))

/** TradingView's body written out here, in this file's own words (never imported): `seed` picks the seed. */
function dmiLonghand(bars, diLen, adxLen, seed) {
  const n = bars.length
  const rma = (src, len) => {
    const out = new Array(n).fill(NaN)
    let prev = NaN
    const vals = []
    for (let i = 0; i < n; i += 1) {
      const v = src[i]
      if (!Number.isFinite(v)) continue
      if (Number.isNaN(prev)) { vals.push(v); if (vals.length === len) { prev = seed(vals, len); out[i] = prev } } else { prev = (prev * (len - 1) + v) / len; out[i] = prev }
    }
    return out
  }
  const up = bars.map((b, i) => (i === 0 ? NaN : b.h - bars[i - 1].h))
  const down = bars.map((b, i) => (i === 0 ? NaN : -(b.l - bars[i - 1].l)))
  const dm = (x, y) => x.map((v, i) => (Number.isNaN(v) ? NaN : (pineGt(v, y[i]) && pineGt(v, 0) ? v : 0)))
  const tr = bars.map((b, i) => (i === 0 ? NaN : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))))
  const trr = rma(tr, diLen)
  const fix = (xs) => { let last = NaN; return xs.map((v) => { if (!Number.isNaN(v)) last = v; return last }) }
  const di = (move) => { const r = rma(move, diLen); return fix(r.map((v, i) => 100 * v / trr[i])) }
  const plus = di(dm(up, down))
  const minus = di(dm(down, up))
  const x = plus.map((p, i) => { const s = p + minus[i]; return Math.abs(p - minus[i]) / (pineEq(s, 0) ? 1 : s) })
  return { plus, minus, adx: rma(x, adxLen).map((v) => 100 * v) }
}
const EXACT_SEED = (vals, len) => exactSum(vals, 0, len - 1) / len
const LEFT_TO_RIGHT_SEED = (vals, len) => vals.reduce((s, v) => s + v, 0) / len

/** The three seed bars that separate the two seeds: [capture, column, bar, adx lengths]. */
const SEPARATING = [[SPY, 'U3_adx_17_14', 30, 17, 14], [RDDT, 'U3_adx_17_14', 30, 17, 14], [SPY, 'U4_adx_14_20', 33, 14, 20]]

function hostColumns(bars) {
  const t = translatePine(SOURCE, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  expect(t.outputs).toHaveLength(COLUMNS.length)
  return t.outputs.map((o) => Array.from(interpret(o.ast, bars, undefined, undefined, undefined, HOST_OPTS)))
}
function runtimeColumns(bars, source = SOURCE, keys = COLUMNS.map(([v]) => v)) {
  const out = computeRuntimeColumns({
    id: 'dmi', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:dmi', outputs: Object.fromEntries(keys.map((k, i) => [k, i])), source },
  }, bars, CTX)
  return keys.map((k) => Array.from(out[k] || []))
}

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('the witness is what this file says it is', () => {
  it('W1-W4 read 0 on every bar TradingView plots them: `ta.dmi` IS the body', () => {
    for (const { tv } of [SPY, RDDT]) {
      for (const w of ['W1_plus_17_minus_body_MUST_BE_0', 'W2_minus_17_minus_body_MUST_BE_0',
        'W3_adx_17_14_minus_body_MUST_BE_0', 'W4_adx_14_20_minus_body_MUST_BE_0']) {
        const plotted = tv[w].filter((v) => !Number.isNaN(v))
        expect(plotted.length, w).toBeGreaterThan(600)
        expect(plotted.every((v) => v === 0), w).toBe(true)
      }
    }
  })
  it('the longhand with the EXACT seed is TradingView on all seven columns, every bar, both symbols', () => {
    for (const { bars, tv } of [SPY, RDDT]) {
      const d14 = dmiLonghand(bars, 14, 14, EXACT_SEED)
      const d17 = dmiLonghand(bars, 17, 14, EXACT_SEED)
      const d1420 = dmiLonghand(bars, 14, 20, EXACT_SEED)
      const got = [d14.plus, d14.minus, d14.adx, d17.plus, d17.minus, d17.adx, d1420.adx]
      COLUMNS.forEach(([, title], k) => expect(offBars(got[k], tv[title]), title).toEqual([]))
    }
  })
  it('⛔ and with a LEFT-TO-RIGHT seed it is NOT: it misses exactly at the three separating seed bars', () => {
    for (const [{ bars, tv }, title, bar, di, adx] of SEPARATING) {
      const ltr = dmiLonghand(bars, di, adx, LEFT_TO_RIGHT_SEED).adx
      const exact = dmiLonghand(bars, di, adx, EXACT_SEED).adx
      expect(Object.is(exact[bar], tv[title][bar]), `${title} bar ${bar}`).toBe(true)
      expect(Object.is(ltr[bar], tv[title][bar]), `${title} bar ${bar}: the left-to-right seed must miss`).toBe(false)
      expect(Number.isNaN(tv[title][bar - 1]), `${title}: bar ${bar} is the seed bar`).toBe(true)
    }
  })
})

describe('⭐⭐ the seed rule, in one place', () => {
  it('`rmaSeedMean` is the exactly rounded sum over its length / the length', () => {
    const xs = [0.1, 0.2, 0.3, 1e16, -1e16, 0.7]
    expect(rmaSeedMean(xs, 0, 6)).toBe(exactSum(xs, 0, 5) / 6)
    expect(rmaSeedMean(xs, 0, 6)).not.toBe(xs.reduce((s, v) => s + v, 0) / 6)
  })
  it('`CARRIED.rma` seeds with it (its cells hold the seed values) and the column driver reads the same', () => {
    const { bars, tv } = SPY
    // the ADX source of `ta.dmi(17, 14)`, written out, stepped by the kernel table and by `FN.rma`
    const d = dmiLonghand(bars, 17, 14, EXACT_SEED)
    const x = d.plus.map((p, i) => { const s = p + d.minus[i]; return Math.abs(p - d.minus[i]) / (pineEq(s, 0) ? 1 : s) })
    const spec = CARRIED.rma
    const st = new Float64Array(carriedCellsOf(spec, 14))
    spec.init(st, 0, 14)
    const stepped = x.map((v) => 100 * spec.step(st, 0, v, 14, spec.alpha(14)))
    const column = Array.from(FN.rma(Float64Array.from(x), 14)).map((v) => 100 * v)
    expect(Object.is(stepped[30], tv.U3_adx_17_14[30])).toBe(true)
    expect(offBars(stepped, tv.U3_adx_17_14)).toEqual([])
    expect(offBars(column, tv.U3_adx_17_14)).toEqual([])
  })
  it('a length longer than the series never seeds, and the column driver does not size its store past the bars', () => {
    expect(carriedCellsOf(CARRIED.rma, 1e9, 50)).toBe(3 + 50)
    expect(carriedCellsOf(CARRIED.rma, 2.5)).toBe(3)
    expect(Array.from(FN.rma(Float64Array.from([1, 2, 3]), 1e9)).every(Number.isNaN)).toBe(true)
  })
  it('Pine\'s `ta.rsi` seeds its two averages with it on both lanes; the native RSI keeps its running sum', () => {
    // a series whose first 14 gains sum differently left to right and exactly
    const xs = [100, 100.1, 100.3, 100.6, 101, 1e15, 101.2, 101.9, 102.5, 101, 103.3, 103.1, 104.4, 104.2, 105, 104.7, 106, 107]
    const bars = xs.map((c, i) => ({ t: i, c }))
    const col = (pts) => xs.map((_, i) => (pts[i] && typeof pts[i].value === 'number' ? pts[i].value : NaN))
    const pine = col(computeRSI(bars, 14, { seedMean: rmaSeedMean }))
    const native = col(computeRSI(bars, 14))
    expect(offBars(pine, native).length, 'the fixture must separate the two seeds').toBeGreaterThan(0)
    expect(offBars(Array.from(FN_PINE.rsi(Float64Array.from(xs), 14)), pine)).toEqual([])
    expect(offBars(Array.from(FN.rsi(Float64Array.from(xs), 14)), native)).toEqual([])
    const spec = CARRIED.rsiPine
    const st = new Float64Array(carriedCellsOf(spec, 14))
    spec.init(st, 0)
    expect(offBars(xs.map((v) => spec.step(st, 0, v, 14)), pine)).toEqual([])
  })
})

describe('⭐⭐ `ta.dmi` on both lanes draws TradingView\'s doubles, every bar, both symbols', () => {
  for (const [label, cap] of [['AMEX:SPY', SPY], ['NYSE:RDDT', RDDT]]) {
    it(`the host lane: all seven columns, ${label}`, () => {
      const got = hostColumns(cap.bars)
      COLUMNS.forEach(([, title], k) => expect(offBars(got[k], cap.tv[title]), title).toEqual([]))
    })
    it(`the runtime lane: all seven columns, ${label}`, () => {
      const got = runtimeColumns(cap.bars)
      COLUMNS.forEach(([, title], k) => expect(offBars(got[k], cap.tv[title]), title).toEqual([]))
    })
  }
  it('the runtime lane\'s own carried kernel seeds the ADX: `ta.rma` over a value the VM steps (U3, both symbols)', () => {
    const source = [
      '//@version=6', 'indicator("dmi vm")',
      '[p, m, a] = ta.dmi(17, 14)',
      'float x = na',
      'x := math.abs(p - m) / (p + m == 0 ? 1 : p + m)',
      'plot(100 * ta.rma(x, 14))',
    ].join('\n')
    for (const { bars, tv } of [SPY, RDDT]) {
      const [got] = runtimeColumns(bars, source, ['adx'])
      expect(Object.is(got[30], tv.U3_adx_17_14[30]), 'the separating seed bar').toBe(true)
      expect(offBars(got, tv.U3_adx_17_14)).toEqual([])
    }
  })
  it('⛔ CONTROL: the house `computeADX` (a Wilder SUM) that equal periods used to read misses +DI on most bars', () => {
    const { bars, tv } = SPY
    const pts = computeADX(bars, 14, { gt: pineGt }).plusDI
    const house = bars.map((_, i) => (pts[i] && typeof pts[i].value === 'number' ? pts[i].value : NaN))
    expect(offBars(house, tv.D1_plus_14_14).length).toBeGreaterThan(5000)
  })
  it('a named argument or a wrong count still refuses by name (taken apart by position)', () => {
    for (const call of ['ta.dmi(diLength = 14, adxSmoothing = 14)', 'ta.dmi(14)']) {
      const t = translatePine(['//@version=6', 'indicator("d")', `[p, m, a] = ${call}`, 'plot(a)'].join('\n'), { strict: true, basePeriod: 'D' })
      expect(t.ok, call).toBe(false)
    }
  })
})
