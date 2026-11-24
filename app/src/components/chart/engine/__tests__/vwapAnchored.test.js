// app/src/components/chart/engine/__tests__/vwapAnchored.test.js
//
// ─── ⭐⭐ e95 UNIT 2 — PINE'S ANCHORED `ta.vwap(source, anchor[, stdev_mult])`, BOTH LANES ─────────────────────
//
// TradingView's built-in VWAP reads `[_vwap, _stdevUpper, _] = ta.vwap(src, isNewPeriod, 1)` inside an `if` block;
// both lanes refused it (the host `pine:tuple` -> `pine:reassign`, the runtime `runtime:call-windowed-state`), and
// neither lane had an anchored VWAP at all. Now one accumulator (`interpret.js::vwapAnchorAccumulate`, TradingView's
// published `computeVWAP`: sums from each reset, `na` before the first), one builder (`PINE_TUPLE_BUILTINS.vwap`),
// both lanes and the Python twin (`ast_interpret._vwap_anchor_col`, `tests/test_vwap_anchor_parity.py`).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { translatePine } from '../ast/pine.js'
import { parseFormula } from '../ast/parse.js'
import { interpret, FN, VWAP_BEFORE_FIRST_ANCHOR, PER_BAR_CLOCK_CODES, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE } from '../ast/interpret.js'
import { RUNNING_TOTAL_CALLS, ANCHOR_RESET_CALLS, barIndexVerdict, readsRunningTotal } from '../ast/barIndexShift.js'
import { TABLE } from '../ast/parse.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor } from '../nativeRegistry'
import { referenceBars, REFERENCE_SYMBOL } from '../referenceSeries.js'

const N = 80
const T0 = Date.UTC(2024, 0, 2) / 1000
const BARS = Array.from({ length: N }, (_, i) => ({
  t: T0 + i * 86400,
  o: 100 + Math.sin(i * 0.4) * 5,
  h: 106 + Math.sin(i * 0.4) * 5 + (i % 3),
  l: 95 + Math.sin(i * 0.4) * 5 - (i % 2),
  c: 100 + Math.cos(i * 0.3) * 6,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

afterEach(() => { vi.unstubAllEnvs() })

/** the published `computeVWAP` body by hand: sums from each reset, `na` before the first */
function byHand(anchorAt, mult = 1) {
  let spv = NaN; let sv = NaN; let sppv = NaN
  return BARS.map((b, i) => {
    const p = (b.h + b.l + b.c) / 3
    if (anchorAt(i)) { spv = p * b.v; sv = b.v; sppv = b.v * (p * p) } else { spv = p * b.v + spv; sv = b.v + sv; sppv = b.v * (p * p) + sppv }
    const vwap = sv > 0 ? spv / sv : NaN
    const variance = sppv / sv - vwap * vwap
    const sd = Math.sqrt(variance < 0 ? 0 : variance)
    return { vwap, upper: vwap + sd * mult, lower: vwap - sd * mult }
  })
}
/** the host lane: every plot's column through the columnar interpreter */
function hostColumns(body) {
  const t = translatePine(`${HEAD}${body}`, { strict: true })
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  return t.outputs.map((o) => {
    expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
    const parsed = parseFormula(o.formula)
    expect(parsed.ok, o.formula).toBe(true)
    const col = interpret(parsed.ast, BARS, {})
    return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
  })
}
/** the runtime lane: the run's outputs */
function runtimeColumns(body) {
  const built = buildRuntimeIr(`${HEAD}${body}`, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  return r.outputs.map((o) => Array.from(o))
}
function same(got, want, label) {
  expect(got.length).toBe(want.length)
  let finite = 0
  for (let i = 0; i < want.length; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i}: ours ${got[i]}, want na`).toBe(true)
    else { expect(got[i], `${label} bar ${i}`).toBe(want[i]); finite += 1 }
  }
  return finite
}

const EVERY7 = (i) => i % 7 === 3
// a per-bar anchor the run computes (a `var` it writes), so the runtime lane's own kernel answers it
const RUN_ANCHOR = 'var bool a = false\na := bar_index % 7 == 3\n'

describe('the anchored VWAP: ta.vwap(source, anchor)', () => {
  it('host lane: the published computeVWAP sums from each reset, na before the first anchor, bit for bit', () => {
    const [v] = hostColumns('plot(ta.vwap(hlc3, bar_index % 7 == 3))\n')
    const want = byHand(EVERY7).map((r) => r.vwap)
    expect(same(v, want, 'host vwap')).toBe(N - 3)
    expect(Number.isNaN(v[2]) && Number.isFinite(v[3])).toBe(true)
  })
  it('runtime lane: the same numbers from its own kernel (an anchor the run computes)', () => {
    const [v] = runtimeColumns(`${RUN_ANCHOR}plot(ta.vwap(hlc3, a))\n`)
    expect(same(v, byHand(EVERY7).map((r) => r.vwap), 'runtime vwap')).toBe(N - 3)
  })
  it('the three-value form: [vwap, upper, lower] with the bands at the multiplier, both lanes', () => {
    const body = (anchor) => `[m, u, l] = ta.vwap(hlc3, ${anchor}, 2)\nplot(m)\nplot(u)\nplot(l)\n`
    const want = byHand(EVERY7, 2)
    const h = hostColumns(body('bar_index % 7 == 3'))
    same(h[0], want.map((r) => r.vwap), 'host mid'); same(h[1], want.map((r) => r.upper), 'host upper'); same(h[2], want.map((r) => r.lower), 'host lower')
    const r = runtimeColumns(`${RUN_ANCHOR}${body('a')}`)
    same(r[0], want.map((x) => x.vwap), 'rt mid'); same(r[1], want.map((x) => x.upper), 'rt upper'); same(r[2], want.map((x) => x.lower), 'rt lower')
  })
  it('⛔ the sums run from the RESET, never from the series start (a long series stays exact)', () => {
    const col = FN.vwapAnchor(SERIES[3], Float64Array.from(BARS.map((_, i) => (i === 40 ? 1 : 0))), SERIES[4])
    expect(col[41]).toBe((BARS[40].c * BARS[40].v + BARS[41].c * BARS[41].v) / (BARS[40].v + BARS[41].v))
    expect(Number.isNaN(col[39])).toBe(true)
  })
  it('⛔ a computed source is refused by name on the host lane (what the vendor sums do with an na term is not measured)', () => {
    const t = translatePine(`${HEAD}plot(ta.vwap(ta.sma(close, 3), bar_index % 7 == 3))\n`, { strict: true })
    const out = t.outputs && t.outputs[0]
    expect((t.refusal && t.refusal.guard) || (out && out.refusal && out.refusal.guard)).toBe('pine:arity')
  })
  it('the one-argument session VWAP is untouched (a control)', () => {
    const t = translatePine(`${HEAD}plot(ta.vwap(close))\n`, { strict: true })
    expect(t.outputs[0].formula).toMatch(/vwapOf\(/)
  })
})

// ─── ⭐⭐ THE HAZARD RULING (coordinator, 2026-11-22): AN ANCHORED VWAP IS ITS OWN CLASS, NEVER A RUNNING TOTAL ─────
//
// `lookback: "series"` made `vwapAnchor` a running total (`barIndexShift.js::RUNNING_TOTAL_CALLS`): withheld WHOLE on
// every chart not starting at the listing (named `running-total:window`, "counts from the first bar loaded": false of
// a VWAP), and fed to the additive-constant algebra (`ORIGIN_ATOM`), which would serve `vwapAnchor - vwapAnchor[n]`
// as if an unseen constant cancelled. The truth: after the first anchor INSIDE the chart's window the sums reset, so
// every later bar is exact and window-independent; only the bars before it are unknown. Served PER BAR, those bars
// withheld BY NAME (`vwap:before-first-anchor`, `interpret.js::builtinWitnessMask`).
describe('⭐⭐ the anchored VWAP off the listing: served from the first anchor shown on the chart, per bar', () => {
  // `close < 95` first fires on bar 9, and again from bar 30: an anchor no bar index and no clock decides
  const FIRST = 9
  const ANCH = (i) => BARS[i].c < 95
  // a Pine document's own flags (`nativeRegistry.barIndexAbsoluteFor` / `varOriginAbsoluteFor`)
  const OFF = { historyFromListing: false, barIndexAbsolute: true, varOriginAbsolute: true }
  const FROM = { historyFromListing: true, barIndexAbsolute: true, varOriginAbsolute: true }
  /** every plot of a translated script, through the columnar lane under `opts`, with the codes it named */
  function run(body, opts) {
    const t = translatePine(`${HEAD}${body}`, { strict: true })
    expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
    return t.outputs.map((o) => {
      expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
      const parsed = parseFormula(o.formula)
      const sink = new Map()
      const perBar = new Map()
      const col = interpret(parsed.ast, BARS, {}, undefined, undefined, { ...opts, chartClockSink: sink, withheldBarsSink: perBar })
      return { col: Array.from({ length: N }, (_, i) => col[i]), codes: [...sink.keys()].sort(), perBar, ast: parsed.ast }
    })
  }
  const want = byHand(ANCH).map((r) => r.vwap)

  it('the manifest: the anchored sums are their own class, NOT a running total, and tagged with a true sentence', () => {
    expect(BARS.findIndex((b) => b.c < 95)).toBe(FIRST)
    expect(ANCHOR_RESET_CALLS).toEqual(['vwapAnchor', 'vwapAnchorDev'])
    expect(RUNNING_TOTAL_CALLS).toEqual(['cum'])
    const tag = TABLE._requirement_tags.anchor_dependent
    expect(tag.calls).toEqual(['vwapAnchor', 'vwapAnchorDev'])
    expect(TABLE._requirement_tags.window_dependent.calls).not.toContain('vwapAnchor')
    expect(tag.memberNote).toBeUndefined()
  })

  it('a chart starting mid-history is SERVED from its first in-window anchor, bit for bit, and nothing is withheld whole', () => {
    const [{ col, codes, perBar }] = run('plot(ta.vwap(hlc3, close < 95))\n', OFF)
    for (let i = FIRST; i < N; i += 1) expect(col[i], `bar ${i}`).toBe(want[i])
    expect(codes).toEqual([VWAP_BEFORE_FIRST_ANCHOR])
    expect(codes).not.toContain('running-total:window')
    // the bars before it are withheld BY NAME, per bar — never a whole-series withhold
    const bars0 = perBar.get(VWAP_BEFORE_FIRST_ANCHOR)
    expect(Array.from(bars0).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual(Array.from({ length: FIRST }, (_, i) => i))
    for (let i = 0; i < FIRST; i += 1) expect(Number.isNaN(col[i]), `bar ${i}`).toBe(true)
  })

  it('the bands too: each leg served from the first in-window anchor, withheld before it by the same name', () => {
    const outs = run('[m, u, l] = ta.vwap(hlc3, close < 95, 1)\nplot(m)\nplot(u)\nplot(l)\n', OFF)
    const w = byHand(ANCH, 1)
    outs.forEach(({ col, codes }, k) => {
      const key = ['vwap', 'upper', 'lower'][k]
      for (let i = FIRST; i < N; i += 1) expect(col[i], `${key} bar ${i}`).toBe(w[i][key])
      for (let i = 0; i < FIRST; i += 1) expect(Number.isNaN(col[i])).toBe(true)
      expect(codes).toEqual([VWAP_BEFORE_FIRST_ANCHOR])
    })
  })

  it('⛔ a value read from the bars before the anchor is never drawn: `nz(vwap)` is withheld there, not drawn as 0', () => {
    const [{ col, codes }] = run('plot(nz(ta.vwap(hlc3, close < 95)))\n', OFF)
    for (let i = 0; i < FIRST; i += 1) expect(Number.isNaN(col[i]), `bar ${i}: ${col[i]}`).toBe(true)
    for (let i = FIRST; i < N; i += 1) expect(col[i]).toBe(want[i])
    expect(codes).toEqual([VWAP_BEFORE_FIRST_ANCHOR])
  })

  it('⛔⛔ `vwap - vwap[n]` is NEVER served by the additive-constant algebra: withheld until the read reaches the anchor', () => {
    const body = 'v = ta.vwap(hlc3, close < 95)\nplot(nz(v) - nz(v[5]))\n'
    const [{ col, codes, ast }] = run(body, OFF)
    // the pass reads no running total in it: no unseen constant to cancel (`ORIGIN_ATOM` never sees it)
    expect(readsRunningTotal(ast)).toBe(false)
    expect(barIndexVerdict(ast).cls).toBe('inv')
    for (let i = 0; i < FIRST + 5; i += 1) expect(Number.isNaN(col[i]), `bar ${i}: ${col[i]}`).toBe(true)
    for (let i = FIRST + 5; i < N; i += 1) expect(col[i], `bar ${i}`).toBe(want[i] - want[i - 5])
    // `v[5]` on the first five bars also reads before the chart (`history:before-chart`): both names, never the total's
    expect(codes).toContain(VWAP_BEFORE_FIRST_ANCHOR)
    expect(codes.filter((c) => c.startsWith('running-total'))).toEqual([])
  })

  it('⛔⛔ an anchor this chart cannot read on its first bar is no reset: the built-in `na(src[1])` restart', () => {
    // TradingView's built-in VWAP restarts where `na(src[1])` (the listing's first bar). Off the listing this chart's
    // bar 0 reads `src[1]` before its first bar: true here, false on TradingView, so a reset there is NOT known, and
    // the bars until the first KNOWN anchor are withheld by name rather than summed from bar 0.
    const [{ col, codes }] = run('a = close < 95 or na(hlc3[1])\nplot(ta.vwap(hlc3, a))\n', OFF)
    for (let i = 0; i < FIRST; i += 1) expect(Number.isNaN(col[i]), `bar ${i}: ${col[i]}`).toBe(true)
    for (let i = FIRST; i < N; i += 1) expect(col[i], `bar ${i}`).toBe(want[i])
    expect(codes).toContain(VWAP_BEFORE_FIRST_ANCHOR)
    // from the listing the first bar IS TradingView's restart: summed from bar 0
    const [{ col: fromListing }] = run('a = close < 95 or na(hlc3[1])\nplot(ta.vwap(hlc3, a))\n', FROM)
    const restart = byHand((i) => i === 0 || ANCH(i)).map((r) => r.vwap)
    for (let i = 0; i < N; i += 1) expect(fromListing[i], `listing bar ${i}`).toBe(restart[i])
  })

  it('from the listing nothing is withheld or named: TradingView is `na` before the first anchor too', () => {
    const [{ col, codes }] = run('plot(ta.vwap(hlc3, close < 95))\n', FROM)
    expect(codes).toEqual([])
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[i])) expect(Number.isNaN(col[i])).toBe(true)
      else expect(col[i]).toBe(want[i])
    }
  })

  it('the code is a per-bar one with a true sentence, never the running-total one', () => {
    expect(PER_BAR_CLOCK_CODES).toContain(VWAP_BEFORE_FIRST_ANCHOR)
    expect(CHART_CLOCK_WHOLE).not.toContain(VWAP_BEFORE_FIRST_ANCHOR)
    const sentence = CHART_CLOCK_WITHHELD[VWAP_BEFORE_FIRST_ANCHOR]('D')
    expect(sentence).toContain('starts at the first anchor shown on the chart')
    expect(sentence).not.toMatch(/first bar that was loaded|counts from the first bar/)
  })
})

// ─── ⭐⭐ THE BUILT-IN'S OWN SHAPE, THROUGH THE MEMBER DOOR, OFF THE LISTING ────────────────────────────────────────
// TradingView's built-in VWAP restarts where `na(src[1])` (the listing's first bar) beside its period anchor, through
// an `if` that reassigns the anchor. Off the listing that restart is unknown on this chart's first bar (`isfirst`,
// `bar-index:first-bar`); carried forever under the anchored sum it blanked EVERY bar. The memory of an anchored sum
// ends at its next reset, so only the bars before the first anchor this chart knows fired are withheld.
describe('⭐⭐ the built-in shape off the listing: a Session VWAP on daily bars is drawn from the first known anchor', () => {
  const SHAPE = ['//@version=6', 'indicator("v", overlay = true)', 'src = hlc3', 'isNewPeriod = timeframe.change("D")',
    'if na(src[1])', '    isNewPeriod := true', 'plot(ta.vwap(src, isNewPeriod))'].join('\n')
  it('every daily bar is its own session, so each value is that bar\'s hlc3, drawn on all but the first bars', () => {
    const d = memberPaneDefinition({ source: SHAPE, id: 'u_0000vwapshape1', name: 'vwap shape' })
    expect(d.ok, d.reason).toBe(true)
    const bars = referenceBars().slice(-600)
    const cols = computeFor(d.definition, bars, {}, { tf: 'D', newestBarIsForming: false, symbol: { ticker: REFERENCE_SYMBOL.ticker } })
    const col = Array.from(cols.value)
    const drawn = col.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v))
    expect(drawn.length, 'the anchored VWAP was withheld on (nearly) every bar').toBeGreaterThan(bars.length * 0.95)
    for (const [v, i] of drawn) expect(v, `bar ${i}`).toBeCloseTo((bars[i].h + bars[i].l + bars[i].c) / 3, 9)
  })
})
