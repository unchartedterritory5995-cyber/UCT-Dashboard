// app/src/components/chart/engine/ast/pinePhase1Builtins.test.js
//
// ─── PINE COVERAGE PHASE 1 (2026-10-30) — THE NAMES AND THE ROBUSTNESS FIXES ──
//
// `docs/pine/COVERAGE-MAP.md` §6 phase 1: the built-in names the member door did
// not have, the call shapes it did not map, and the translator defects that
// refused or broke scripts it should have carried. Every name here is held to a
// NUMBER, in one of two ways, and each block says which:
//
//   VENDOR — through the real member door (`memberPaneDefinition` →
//            `installUserDefinitions` → `computeFor`) on a TradingView capture's
//            own bars, compared bar for bar with what TradingView plotted:
//            `ta.alma` (v6 and the v4 bare spelling), `ta.nvi`, `ta.pvi` (full
//            history from the listing), `fixnan` (holes at the start, scattered,
//            and a 7-bar run; two call sites), `ta.accdist`'s per-bar formula.
//   REFERENCE — no capture holds the name yet, so it is compared with an
//            implementation written HERE from TradingView's published definition,
//            in plain loops that share nothing with the engine: `ta.swma`,
//            `ta.tsi`, `ta.rci`, `ta.percentile_nearest_rank`, `math.acos`,
//            `ta.cci` of a non-`hlc3` source. ⚠️ These still owe a capture.
//
// `na` and warm-up are asserted for every name, not only values.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine } from './pine'
import { parseFormula } from './parse'
import { interpret } from './interpret'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { toProductBars, tfCodeOf, barIndexStartsAtZero } from '../__tests__/vendorHarness/ourSide'

const REPO = path.resolve(process.cwd(), '..')
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'))
const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RUNTIME_FLAG = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
const DEF_ID = 'u_phase1-builtins'

afterEach(() => { vi.unstubAllEnvs() })

/** One translation's single output tree, read back the way a saved definition is. */
function treeOf(source, opts) {
  const t = translatePine(source, opts)
  const outs = (t.outputs || []).filter((o) => o.formula && !o.refusal)
  expect(outs.length, `nothing translated: ${JSON.stringify(t.refusals || t.refusal || null).slice(0, 400)}`)
    .toBeGreaterThan(0)
  const parsed = parseFormula(outs[0].formula)
  expect(parsed.ok, outs[0].formula).toBe(true)
  return { tree: parsed.ast, formula: outs[0].formula }
}
const refusalOf = (source, opts) => {
  const t = translatePine(source, opts)
  const all = [...(t.refusals || []), ...(t.outputs || []).map((o) => o.refusal).filter(Boolean)]
  return all[0] || t.refusal || null
}
const V6 = (body) => `//@version=6\nindicator("p")\n${body}`

/** The member door, production flags, on a capture's own bars: label → column. */
function throughTheDoor(source, capture) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, '')
  const d = memberPaneDefinition({ source, id: DEF_ID, name: 'phase1' })
  expect(d.ok, `the member door refused: ${d.reason}`).toBe(true)
  expect((d.translation.refusals || []).map((r) => `${r.guard} ${r.message}`)).toEqual([])
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  try {
    const bars = toProductBars(capture)
    const ctx = {
      tf: tfCodeOf(capture.timeframe),
      newestBarIsForming: capture.newestBarIsForming ?? null,
      historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true),
      barIndexFromFirstBar: barIndexStartsAtZero(capture),
    }
    const cols = registry.computeFor(installed[0], bars, undefined, ctx)
    const byLabel = {}
    for (const row of d.rows) byLabel[row.label] = Array.from(cols[row.key], (x) => (Number.isFinite(x) ? x : null))
    return byLabel
  } finally {
    registry.uninstallUserDefinition(DEF_ID)
  }
}

/** The capture's plotted column, by title. */
function vendorColumn(capture, title) {
  const styles = capture.study.styles || {}
  const id = Object.keys(styles).find((k) => styles[k].title === title)
  const j = capture.plotValues.fields.indexOf(id)
  expect(j, `no plot titled ${title}`).toBeGreaterThan(0)
  return capture.plotValues.rows.map((r) => r[j])
}

/** Bar-for-bar agreement: the same `na` bars, and every value within `rel`. */
function agree(ours, theirs, { rel = 1e-12, abs = 0 } = {}) {
  expect(ours.length).toBe(theirs.length)
  let compared = 0
  for (let i = 0; i < theirs.length; i++) {
    const a = ours[i]
    const b = theirs[i]
    expect(a === null, `bar ${i}: ours ${a}, TradingView ${b} — the na pattern differs`).toBe(b === null)
    if (b === null) continue
    const tol = Math.max(abs, rel * Math.abs(b))
    expect(Math.abs(a - b) <= tol, `bar ${i}: ours ${a}, TradingView ${b}`).toBe(true)
    compared += 1
  }
  return compared
}

const capBars = (capture) => capture.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v ?? 0 }))
const asNull = (col) => Array.from(col, (x) => (Number.isFinite(x) ? x : null))

// ─── VENDOR ──────────────────────────────────────────────────────────────────

describe('⭐ ta.alma — VENDOR (vw-alma-spy-1d-2026-09-27, 8,472 bars from the listing)', () => {
  const cap = readJson('tests/fixtures/vendor/vw-alma-spy-1d-2026-09-27.json')
  // The capture's own rows, less A02 (`floor = true`, which this engine refuses
  // by name — see the last case). Titles are the capture's own.
  const source = V6([
    'plot(ta.alma(close, 9, 0.85, 6), "A01_alma_close_9_085_6")',
    'plot(na(ta.alma(close, 9, 0.85, 6)) ? -1 : bar_index, "A03_first_nonNA_bar")',
    'plot(ta.alma(close, 9, 0.99, 6) - close, "A04_offset099_minus_close_NEAR0")',
    'holed = bar_index % 50 == 25 ? na : close',
    'plot(ta.alma(holed, 9, 0.85, 6), "A05_alma_over_series_with_na")',
  ].join('\n'))
  const ours = throughTheDoor(source, cap)

  it('A01 — every value, to the last bit or one past it', () => {
    expect(agree(ours.A01_alma_close_9_085_6, vendorColumn(cap, 'A01_alma_close_9_085_6'))).toBe(8464)
  })
  it('A03 — warm-up: na on bars 0-7, the first value on bar length - 1', () => {
    const v = vendorColumn(cap, 'A03_first_nonNA_bar')
    expect(v.slice(0, 9)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, 8])
    agree(ours.A03_first_nonNA_bar, v, { rel: 0 })
  })
  it('A04 — the weight ORIENTATION: offset 0.99 leans on the newest bar', () => {
    agree(ours.A04_offset099_minus_close_NEAR0, vendorColumn(cap, 'A04_offset099_minus_close_NEAR0'),
      { rel: 1e-9, abs: 1e-9 })
  })
  it('A05 — an na inside the window poisons it for exactly length bars', () => {
    expect(agree(ours.A05_alma_over_series_with_na, vendorColumn(cap, 'A05_alma_over_series_with_na')))
      .toBeGreaterThan(6900)
  })
  it('floor = true is refused by name; floor = false is the four-argument call exactly', () => {
    const r = refusalOf(V6('plot(ta.alma(close, 9, 0.85, 6, true))'))
    expect(r && r.guard).toBe('pine:arity')
    expect(String(r.message)).toMatch(/floor = true/)
    expect(treeOf(V6('plot(ta.alma(close, 9, 0.85, 6, false))')).formula).toBe('alma(close, 9, 0.85, 6)')
  })
})

describe('⭐ bare `alma` — VENDOR on v4 (h3-alma-v4-spy-1d-2026-10-02), REFUSED on v6 (r11-alma)', () => {
  it('a v4 script\'s bare alma is TradingView\'s alma', () => {
    const cap = readJson('tests/fixtures/vendor/harness/h3-alma-v4-spy-1d-2026-10-02.json')
    const src = '//@version=4\nstudy("p")\nplot(alma(close, 9, 0.85, 6), "A01_alma_close_9_085_6_RAW")'
    const ours = throughTheDoor(src, cap)
    // ⚠️ this capture's window opens deep in history (bar_index 6,677), so our
    // first length - 1 bars are warm-up where TradingView already had a value.
    const v = vendorColumn(cap, 'A01_alma_close_9_085_6_RAW')
    expect(ours.A01_alma_close_9_085_6_RAW.slice(0, 8)).toEqual(new Array(8).fill(null))
    expect(agree(ours.A01_alma_close_9_085_6_RAW.slice(8), v.slice(8))).toBeGreaterThan(400)
  })
  it.each([
    ['alma(close, 9, 0.85, 6)', 'ta.alma'], ['acos(0.5) + close', 'math.acos'],
    ['swma(close)', 'ta.swma'], ['tsi(close, 13, 25)', 'ta.tsi'], ['rci(close, 10)', 'ta.rci'],
    ['percentile_nearest_rank(close, 10, 50)', 'ta.percentile_nearest_rank'],
    ['nvi', 'ta.nvi'], ['pvi', 'ta.pvi'], ['accdist', 'ta.accdist'],
  ])('a v6 script\'s bare %s is refused and named — TradingView refuses it too', (expr, spelled) => {
    const r = refusalOf(V6(`plot(${expr})`))
    expect(r && r.guard).toBe('pine:function')
    expect(String(r.message)).toContain(`\`${spelled}\``)
  })
})

describe('⭐ ta.nvi / ta.pvi — VENDOR (vw-nvi-pvi-spy-1d-full-2026-09-27, full history)', () => {
  const cap = readJson('tests/fixtures/vendor/vw-nvi-pvi-spy-1d-full-2026-09-27.json')
  const ours = throughTheDoor(cap.source.text, cap)
  it('P01/P02 — the LEVELS, from the 1.0 seed on bar 0, within float re-association', () => {
    expect(agree(ours.P01_nvi_RAW, vendorColumn(cap, 'P01_nvi_RAW'), { rel: 1e-12 })).toBe(8472)
    expect(agree(ours.P02_pvi_RAW, vendorColumn(cap, 'P02_pvi_RAW'), { rel: 1e-12 })).toBe(8472)
  })
  it('P03/P04 — the update rule per bar (residuals are zero on TradingView and here)', () => {
    agree(ours.P03_nvi_step_resid_MUST_BE_0, vendorColumn(cap, 'P03_nvi_step_resid_MUST_BE_0'), { abs: 1e-12 })
    agree(ours.P04_pvi_step_resid_MUST_BE_0, vendorColumn(cap, 'P04_pvi_step_resid_MUST_BE_0'), { abs: 1e-12 })
  })
  it('P05 — the seed bar is bar 0; P06/P07 — the corpus quantity x - ema(x, 255), warm-up included', () => {
    agree(ours.P05_first_nonNA_pvi_bar, vendorColumn(cap, 'P05_first_nonNA_pvi_bar'), { rel: 0 })
    expect(agree(ours.P06_corpus_nvi_minus_ema255, vendorColumn(cap, 'P06_corpus_nvi_minus_ema255'),
      { rel: 1e-9, abs: 1e-12 })).toBe(8218)
    agree(ours.P07_corpus_pvi_minus_ema255, vendorColumn(cap, 'P07_corpus_pvi_minus_ema255'), { rel: 1e-9, abs: 1e-12 })
  })
  it('volume UNCHANGED is neither fell nor rose: both indexes hold (the strict < and > of the published rule)', () => {
    const bars = [
      { t: 1, o: 10, h: 10, l: 10, c: 10, v: 500 },
      { t: 2, o: 11, h: 11, l: 11, c: 11, v: 500 },   // unchanged volume, +10% close
      { t: 3, o: 12, h: 12, l: 12, c: 12, v: 400 },   // fell
      { t: 4, o: 13, h: 13, l: 13, c: 13, v: 600 },   // rose
    ]
    const nvi = asNull(interpret(treeOf(V6('plot(ta.nvi)'), { strict: true }).tree, bars))
    const pvi = asNull(interpret(treeOf(V6('plot(ta.pvi)'), { strict: true }).tree, bars))
    expect(nvi[1]).toBe(1)
    expect(pvi[1]).toBe(1)
    expect(nvi[2]).toBeCloseTo(12 / 11, 12)
    expect(pvi[2]).toBe(1)
    expect(nvi[3]).toBe(nvi[2])
    expect(pvi[3]).toBeCloseTo(13 / 12, 12)
  })
  it.each(['ta.nvi', 'ta.pvi', 'ta.accdist'])('it is the `cum` bargain: a screen refuses %s by name; a pane draws it', (n) => {
    const r = refusalOf(V6(`plot(${n})`))
    // a screen meets the ruling it always met — `_functions_excluded` refuses the level
    expect(r && r.guard, 'a screen took a fetch-dependent level').toBe('pine:function')
    expect(String(r.message)).toMatch(/RULED on that name/)
    expect(treeOf(V6(`plot(${n})`), { strict: true }).formula).toMatch(/cum\(/)
  })
})

describe('⭐ fixnan — VENDOR (vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04)', () => {
  const cap = readJson('tests/fixtures/vendor/harness/vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04.json')
  const source = V6([
    'x = bar_index < 3 or (bar_index >= 20 and bar_index <= 26) or bar_index % 3 == 1 ? na : close',
    'plot(x, "F00_x_CONTROL")',
    'plot(fixnan(x), "F01_fixnan")',
    'f(s) => fixnan(s)',
    'plot(f(x), "F02a_fixnan_in_fn")',
    'plot(f(bar_index % 4 == 0 ? high : na), "F02b_fixnan_in_fn_second_site")',
  ].join('\n'))
  const ours = throughTheDoor(source, cap)
  it.each(['F00_x_CONTROL', 'F01_fixnan', 'F02a_fixnan_in_fn', 'F02b_fixnan_in_fn_second_site'])(
    '%s — exact, na before the first known value included', (title) => {
      expect(agree(ours[title], vendorColumn(cap, title), { rel: 0 })).toBeGreaterThan(5000)
    })
  it('every hole carries the last known value, however long the run', () => {
    let last = null
    let holes = 0
    ours.F00_x_CONTROL.forEach((x, i) => {
      if (x !== null) last = x
      else holes += 1
      expect(ours.F01_fixnan[i], `bar ${i}`).toBe(last)
    })
    expect(holes).toBeGreaterThan(2000)
  })
  it('a member\'s own fixnan(…) is theirs', () => {
    expect(treeOf(V6('fixnan(x) => x * 2\nplot(fixnan(close))')).formula).toBe('close * 2')
  })
})

describe('⭐ ta.accdist — VENDOR (ta-accdist-delta5-2026-09-06), and the cum bargain', () => {
  const obs = readJson('tests/fixtures/vendor/observations/ta-accdist-delta5-2026-09-06.json')
  it('TradingView says ta.accdist moves by this per-bar money flow; ours is that money flow', () => {
    // ⭐ THE VENDOR HALF: on TradingView's own bars the builtin's 5-bar delta
    // (`ad_change5`) and the 5-bar sum of `((close - low) - (high - close)) /
    // (high - low) * volume` (`ad_deltaSumCandReal5`) are the same number on all
    // 15 rows read. ⚠️ The fixture's OHLCV is a transcript (volume rounded to
    // 10,000), so OUR delta over it is held to the same formula exactly and to
    // TradingView's reading only as a scale check.
    const bars = obs.market.bars.map((b) => ({ t: Number(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
    const { tree } = treeOf(V6('plot(ta.accdist - ta.accdist[5])'), { strict: true })
    const ours = interpret(tree, bars)
    const mfv = bars.map((b) => (b.h === b.l ? 0 : (((b.c - b.l) - (b.h - b.c)) / (b.h - b.l)) * b.v))
    let compared = 0
    obs.market.bars.forEach((b, i) => {
      const want = obs.vendor.values[b.t].ad_change5
      expect(obs.vendor.values[b.t].ad_deltaSumCandReal5).toBe(want)
      if (i < 5) {
        expect(Number.isFinite(ours[i]), `bar ${i} has no 5 bars behind it`).toBe(false)
        return
      }
      const ref = mfv.slice(i - 4, i + 1).reduce((a, x) => a + x, 0)
      expect(Math.abs(ours[i] - ref), `bar ${i}: ${ours[i]} vs the formula ${ref}`).toBeLessThan(1e-6 * Math.abs(ref))
      expect(Math.abs(ours[i] - want), `bar ${i}: ${ours[i]} vs TradingView ${want}`).toBeLessThan(2e-2 * Math.abs(want))
      compared += 1
    })
    expect(compared).toBe(10)
  })
  it('a flat bar (high == low) contributes 0, not na', () => {
    const bars = [
      { t: 1, o: 1, h: 2, l: 1, c: 2, v: 10 },
      { t: 2, o: 1, h: 1, l: 1, c: 1, v: 99 },
      { t: 3, o: 1, h: 3, l: 1, c: 1, v: 4 },
    ]
    expect(asNull(interpret(treeOf(V6('plot(ta.accdist)'), { strict: true }).tree, bars))).toEqual([10, 10, 6])
  })
})

describe('⭐ ta.cci(close, 5) — VENDOR (w2-warmup-spy-12m-2026-09-22, the whole series from bar 0)', () => {
  it('starts on the bar TradingView starts on, and agrees on every value after', () => {
    const fix = readJson('tests/fixtures/vendor/w2-warmup-spy-12m-2026-09-22.json')
    expect(fix.rows[0].bar_index).toBe(0)
    const bars = fix.rows.map((r) => ({ t: r.date, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }))
    const ours = interpret(treeOf(V6('plot(ta.cci(close, 5))'), { strict: true }).tree, bars)
    expect(ours.findIndex(Number.isFinite)).toBe(fix.first_emission_bar.W10_cci5)
    let compared = 0
    fix.rows.forEach((r, i) => {
      const v = r.W10_cci5
      expect(Number.isFinite(ours[i]), `bar ${i}`).toBe(v !== null)
      if (v === null) return
      expect(Math.abs(ours[i] - v) / Math.max(1, Math.abs(v)), `bar ${i}: ${ours[i]} vs ${v}`).toBeLessThan(1e-9)
      compared += 1
    })
    expect(compared).toBeGreaterThan(20)
  })
})

// ─── REFERENCE ───────────────────────────────────────────────────────────────
// SPY's own bars, with holes punched in a copy so the na rules are exercised.

const SPY = readJson('tests/fixtures/vendor/vw-alma-spy-1d-2026-09-27.json')
const BARS = capBars(SPY).slice(0, 1500)
const closeCol = BARS.map((b) => b.c)
const HOLE = (i) => i % 97 === 50 || (i >= 300 && i <= 303)
/** a source with holes: `bar_index`-free so `interpret` needs no listing proof */
const holedBars = BARS.map((b, i) => (HOLE(i) ? { ...b, c: NaN } : b))

/** Pine's ta.ema as the engine is vendor-pinned to it: SMA seed over the first `n`
 *  KNOWN values, then alpha-smoothing; an na bar emits na and holds the state. */
function refEma(xs, n) {
  const out = xs.map(() => NaN)
  const a = 2 / (n + 1)
  let state = NaN
  let seen = 0
  let sum = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    if (!Number.isFinite(x)) continue
    if (!Number.isFinite(state)) {
      sum += x; seen += 1
      if (seen === n) { state = sum / n; out[i] = state }
      continue
    }
    state = a * x + (1 - a) * state
    out[i] = state
  }
  return out
}
const near = (a, b, rel = 1e-12) => (Number.isFinite(a) || Number.isFinite(b))
  ? Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)) : true
function same(ours, ref, rel = 1e-12) {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    expect(Number.isFinite(ours[i]), `bar ${i}: ours ${ours[i]} ref ${ref[i]} (na differs)`).toBe(Number.isFinite(ref[i]))
    expect(near(ours[i], ref[i], rel), `bar ${i}: ours ${ours[i]} ref ${ref[i]}`).toBe(true)
    if (Number.isFinite(ref[i])) n += 1
  }
  return n
}

describe('ta.swma — REFERENCE: TradingView\'s pine_swma, x[3]/6 + 2x[2]/6 + 2x[1]/6 + x/6', () => {
  const ref = (xs) => xs.map((_, i) => (i < 3 ? NaN : xs[i - 3] * 1 / 6 + xs[i - 2] * 2 / 6 + xs[i - 1] * 2 / 6 + xs[i] * 1 / 6))
  it('every bar, holes included (an na anywhere in the four is na), warm-up of 3 bars', () => {
    const ours = interpret(treeOf(V6('plot(ta.swma(close))')).tree, holedBars)
    expect(same(ours, ref(holedBars.map((b) => b.c)))).toBeGreaterThan(1400)
    expect([0, 1, 2].map((i) => Number.isFinite(ours[i]))).toEqual([false, false, false])
  })
  it('an expression source is offset as a whole', () => {
    expect(treeOf(V6('plot(ta.swma(close - open))')).formula)
      .toBe('(close - open)[3] / 6 + (close - open)[2] * 2 / 6 + (close - open)[1] * 2 / 6 + (close - open) / 6')
  })
})

describe('ta.tsi — REFERENCE: ema(ema(pc, long), short) / ema(ema(|pc|, long), short), in [-1, 1]', () => {
  const refTsi = (xs, s, l) => {
    const pc = xs.map((x, i) => (i === 0 ? NaN : x - xs[i - 1]))
    const num = refEma(refEma(pc, l), s)
    const den = refEma(refEma(pc.map(Math.abs), l), s)
    return num.map((v, i) => v / den[i])
  }
  it('every bar, holes included; the first value lands after both warm-ups', () => {
    const ours = interpret(treeOf(V6('plot(ta.tsi(close, 13, 25))')).tree, holedBars)
    const ref = refTsi(holedBars.map((b) => b.c), 13, 25)
    expect(same(ours, ref, 1e-9)).toBeGreaterThan(1400)
    expect(ours.findIndex(Number.isFinite)).toBe(ref.findIndex(Number.isFinite))
    for (const v of ours) if (Number.isFinite(v)) expect(Math.abs(v)).toBeLessThanOrEqual(1)
  })
  it('a length this engine cannot read when it builds the formula is refused by name', () => {
    expect(refusalOf(V6('plot(ta.tsi(close, bar_index, 25))')).guard).toBe('pine:window')
  })
})

describe('ta.rci — REFERENCE: Spearman of time order (newest = 1) against price order (highest = 1)', () => {
  /** ranks by SORTING, ties averaged — a different construction from the engine's counting. */
  const refRci = (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN
    const w = xs.slice(i - n + 1, i + 1).reverse()        // w[0] is the newest
    if (w.some((v) => !Number.isFinite(v))) return NaN
    const order = w.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v)
    const rank = new Array(n)
    for (let p = 0; p < n;) {
      let q = p
      while (q + 1 < n && order[q + 1].v === order[p].v) q += 1
      for (let r = p; r <= q; r++) rank[order[r].k] = (p + q) / 2 + 1
      p = q + 1
    }
    let d2 = 0
    for (let k = 0; k < n; k++) d2 += ((k + 1) - rank[k]) ** 2
    return (1 - (6 * d2) / (n * (n * n - 1))) * 100
  })
  it('every bar, holes included', () => {
    const ours = interpret(treeOf(V6('plot(ta.rci(close, 10))')).tree, holedBars)
    expect(same(ours, refRci(holedBars.map((b) => b.c), 10), 1e-12)).toBeGreaterThan(1300)
  })
  it('a rising window reads +100, a falling one −100, ties average their ranks', () => {
    const bars = (cs) => cs.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }))
    const run = (cs) => asNull(interpret(treeOf(V6('plot(ta.rci(close, 5))')).tree, bars(cs)))
    expect(run([1, 2, 3, 4, 5])[4]).toBe(100)
    expect(run([5, 4, 3, 2, 1])[4]).toBe(-100)
    expect(run([1, 2, 3, 4, 5]).slice(0, 4)).toEqual([null, null, null, null])
    expect(run([1, 1, 2, 2, 3])[4]).toBeCloseTo(refRci([1, 1, 2, 2, 3], 5)[4], 12)
  })
})

describe('ta.percentile_nearest_rank — REFERENCE: the value at rank ceil(p/100 · n)', () => {
  const refPnr = (xs, n, p) => xs.map((_, i) => {
    if (i < n - 1) return NaN
    const w = xs.slice(i - n + 1, i + 1)
    if (w.some((v) => !Number.isFinite(v))) return NaN
    const s = [...w].sort((a, b) => a - b)
    return s[Math.min(n, Math.max(1, Math.ceil((p / 100) * n))) - 1]
  })
  it.each([[3, 50], [20, 90], [10, 0], [10, 100], [7, 33]])('length %i, %i%% — every bar, holes included', (n, p) => {
    const ours = interpret(treeOf(V6(`plot(ta.percentile_nearest_rank(close, ${n}, ${p}))`)).tree, holedBars)
    expect(same(ours, refPnr(holedBars.map((b) => b.c), n, p), 0)).toBeGreaterThan(1100)
  })
  it('the 0th and 100th are ta.lowest and ta.highest; every answer is a member of its window', () => {
    const lo = interpret(treeOf(V6('plot(ta.percentile_nearest_rank(close, 10, 0))')).tree, BARS)
    const hi = interpret(treeOf(V6('plot(ta.percentile_nearest_rank(close, 10, 100))')).tree, BARS)
    const lowest = interpret(treeOf(V6('plot(ta.lowest(close, 10))')).tree, BARS)
    const highest = interpret(treeOf(V6('plot(ta.highest(close, 10))')).tree, BARS)
    same(lo, lowest, 0)
    same(hi, highest, 0)
    const mid = interpret(treeOf(V6('plot(ta.percentile_nearest_rank(close, 4, 50))')).tree, BARS)
    for (let i = 3; i < BARS.length; i++) expect(closeCol.slice(i - 3, i + 1)).toContain(mid[i])
  })
})

describe('math.acos — REFERENCE: Math.acos, na outside [-1, 1]', () => {
  it('the domain and na', () => {
    const bars = [0.5, -1, 1, 1.5, -2, NaN, 0].map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }))
    const ours = asNull(interpret(treeOf(V6('plot(math.acos(close))')).tree, bars))
    expect(ours).toEqual([Math.acos(0.5), Math.PI, 0, null, null, null, Math.PI / 2])
  })
})

describe('ta.cci of a non-hlc3 source — REFERENCE: (src − sma) / (0.015 · mean |src − sma|)', () => {
  const refCci = (xs, n) => xs.map((_, i) => {
    if (i < n - 1) return NaN
    const w = xs.slice(i - n + 1, i + 1)
    if (w.some((v) => !Number.isFinite(v))) return NaN
    const m = w.reduce((a, b) => a + b, 0) / n
    const dev = w.reduce((a, b) => a + Math.abs(b - m), 0) / n
    return (xs[i] - m) / (0.015 * dev)
  })
  it('ta.cci(close, 20), every bar, holes included', () => {
    const { tree, formula } = treeOf(V6('plot(ta.cci(close, 20))'))
    expect(formula).toBe('(close - sma(close, 20)) / (0.015 * dev(close, 20))')
    expect(same(interpret(tree, holedBars), refCci(holedBars.map((b) => b.c), 20), 1e-9)).toBeGreaterThan(1100)
  })
  it('the same expansion on hlc3 IS the table\'s cci column — one CCI, not two', () => {
    const table = interpret(treeOf(V6('plot(ta.cci(hlc3, 20))')).tree, BARS)
    const hlc3 = BARS.map((b) => (b.h + b.l + b.c) / 3)
    same(table, refCci(hlc3, 20), 1e-9)
  })
})

describe('ta.barssince(cond), unbounded, on a pane — REFERENCE: bars since cond last held, na if never', () => {
  const refSince = (cond) => {
    let last = -1
    return cond.map((c, i) => { if (c) last = i; return last < 0 ? NaN : i - last })
  }
  it('every bar of 1,500, a run thousands of bars long included, and na before the first true', () => {
    // true on 40 scattered bars and then never again for ~1,000 bars: no window caps it
    const cond = BARS.map((_, i) => i > 3 && i < 500 && i % 13 === 0)
    const bars = BARS.map((b, i) => ({ ...b, o: cond[i] ? b.c - 1 : b.c + 1 }))
    const { tree, formula } = treeOf(V6('plot(ta.barssince(close > open))'), { strict: true })
    expect(formula).toBe('cum(1) - valuewhenOccurrence(close > open, cum(1), 0)')
    const ours = interpret(tree, bars)
    expect(same(ours, refSince(cond), 0)).toBe(1500 - 13)
    expect(ours[1499]).toBe(1499 - 494)
  })
  it('a screen keeps the refusal — the count reads a running total, which a screen cannot hold', () => {
    expect(refusalOf(V6('plot(ta.barssince(close > open))')).guard).toBe('pine:function')
  })
})

// ─── THE DOOR'S OWN DEFECTS ──────────────────────────────────────────────────

describe('robustness — what used to translate and then fail, or refuse before the first statement', () => {
  it('TradingView\'s Aroon installs: `ta.highestbars(high, length + 1)` folds its length', () => {
    const src = V6([
      'length = input.int(14, minval=1)',
      'upper = 100 * (ta.highestbars(high, length + 1) + length)/length',
      'lower = 100 * (ta.lowestbars(low, length + 1) + length)/length',
      'plot(upper, "Aroon Up")',
      'plot(lower, "Aroon Down")',
    ].join('\n'))
    const ours = throughTheDoor(src, SPY)
    // TradingView's own formula, by hand: 100 * (14 - bars since the 15-bar high) / 14,
    // a tie read at the OLDEST bar holding the high (`_functions_arg_extreme`)
    const h = SPY.bars.rows.map((r) => r[2])
    for (let i = 14; i < 600; i++) {
      let best = i - 14
      for (let k = i - 14; k <= i; k++) if (h[k] > h[best]) best = k
      const want = (100 * (14 - (i - best))) / 14
      expect(ours['Aroon Up'][i], `bar ${i}`).toBeCloseTo(want, 9)
    }
  })
  it('an ideographic space before a comment is whitespace, not `pine:character`', () => {
    expect(treeOf(V6('x = close\n\u3000\u3000// note\nplot(x)')).formula).toBe('close')
    // ⛔ and only the ideographic space: a no-break space is still refused by name
    expect(refusalOf(V6('plot(close\u00a0+ open)')).guard).toBe('pine:character')
  })
  it('a string keeps an ideographic space: it is not lexed as a blank inside quotes', () => {
    const t = translatePine(V6('plot(close, "a\u3000b")'))
    expect((t.outputs || []).some((o) => o.formula === 'close')).toBe(true)
  })
})

describe('timeframe.isdwm', () => {
  it('isdwm is 1 on D/W/M and 0 on a minute chart — asked of the same tests as isminutes', () => {
    expect(treeOf(V6('plot(timeframe.isdwm ? close : open)')).formula).toBe('close')
    expect(treeOf(V6('plot(timeframe.isdwm ? close : open)'), { basePeriod: 'W' }).formula).toBe('close')
    expect(treeOf(V6('plot(timeframe.isdwm ? close : open)'), { basePeriod: '60' }).formula).toBe('open')
  })
})
