// app/src/components/chart/engine/ast/barIndexShift.test.js
//
// ─── ⭐⭐ C45 — `bar_index` OFF THE LISTING: what is served, what is withheld, and
//     the same answer in both lanes ───────────────────────────────────────────────
//
// Pine's `bar_index` counts from the first bar of the symbol's history; this
// engine's `barindex` counts from the first bar it was handed. Off the listing
// they differ by an unknown `D ≥ 0`. `barIndexShift.js` proves from the tree alone
// how a value moves with `D`, and `interpret.js::barIndexMask` withholds what
// depends on it. The vendor rails are `vendorHarness.c45BarIndex`; this file pins
// the classification, case by case, and holds the Python lane to it.
//
// `api/services/ast_interpret.py::bar_index_verdict` / `bar_index_mask` are the
// ports. This file and `tests/test_ast_bar_index_shift_parity.py` read ONE fixture
// (`tests/fixtures/ast/bar_index_shift_parity.json`), so a lane that drifts fails
// against the other lane's own output, never against a value retyped here.
//
// ⛔ THE TREES ARE THE MEMBER DOOR'S OWN: each case's tree is what
// `translatePine(…, { strict: true })` writes for its lines of Pine, and the first
// test re-translates every one and compares.
//
// To regenerate after a deliberate change (from `app/`):
//   BAR_INDEX_SHIFT_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/barIndexShift.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret, barIndexMask, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE } from './interpret.js'
import { barIndexClass, barIndexVerdict, thresholdUnknown, readsBarIndex, BAR_INDEX_LEAVES } from './barIndexShift.js'

const FIXTURE = '../tests/fixtures/ast/bar_index_shift_parity.json'
const WRITE = process.env.BAR_INDEX_SHIFT_PARITY_WRITE === '1'

/** 320 daily bars, deterministic, with up and down closes — past the 250-bar
 *  warm-up a translated `var` carries, so the `var` cases have values to judge. */
const N = 320
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + Math.sin(i / 5) * 8 + i * 0.07
  const o = c + Math.cos(i * 1.3) * 1.5
  const d = new Date(Date.UTC(2025, 0, 6))
  d.setUTCDate(d.getUTCDate() + i)
  return { t: d.toISOString().slice(0, 10), o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 + i }
})

/** name → [lines of Pine, the class the pass must prove, how many thresholds it lists] */
const PINE = {
  // ── a value that IS the index, or is built from it ────────────────────────────
  index: [['plot(bar_index)'], 'pos', 0],
  'index + 5': [['plot(bar_index + 5)'], 'pos', 0],
  'index[5]': [['plot(bar_index[5])'], 'pos', 0],
  'valuewhen(index)': [['plot(ta.valuewhen(close > open, bar_index, 0))'], 'pos', 0],
  'highest(index)': [['plot(ta.highest(bar_index, 5))'], 'pos', 0],
  'max(index, index[1])': [['plot(math.max(bar_index, bar_index[1]))'], 'pos', 0],
  'nz(index[1], index)': [['plot(nz(bar_index[1], bar_index))'], 'pos', 0],
  'floor(mean of two indices)': [['plot(math.floor((bar_index + bar_index[2]) / 2))'], 'pos', 0],
  'a var latched to the index': [['var int at = na', 'if close > open', '    at := bar_index', 'plot(at)'], 'pos', 0],
  'a var seeded 0, latched to the index': [['var int at = 0', 'if close > open', '    at := bar_index', 'plot(at)'], 'pos', 0],
  // ── index-INVARIANT: a distance between bars, a regression line ───────────────
  'index - index[5]': [['plot(bar_index - bar_index[5])'], 'inv', 0],
  'bars since (index - valuewhen)': [['plot(bar_index - ta.valuewhen(close > open, bar_index, 0))'], 'inv', 0],
  'last_bar_index - index': [['plot(last_bar_index - bar_index)'], 'inv', 0],
  'index - the var latch': [['var int at = na', 'if close > open', '    at := bar_index', 'plot(bar_index - at)'], 'inv', 0],
  'age test (index - latch > 3)': [['var int at = na', 'if close > open', '    at := bar_index', 'plot(bar_index - at > 3 ? high : low)'], 'inv', 0],
  'change(index)': [['plot(ta.change(bar_index))'], 'inv', 0],
  'stdev(index)': [['plot(ta.stdev(bar_index, 10))'], 'inv', 0],
  'index compared with its own lag': [['plot(bar_index > bar_index[1] ? 1 : 0)'], 'inv', 0],
  'a least-squares line through the index': [[
    'x = bar_index',
    'slope = (ta.sma(x * close, 20) - ta.sma(x, 20) * ta.sma(close, 20)) / (ta.stdev(x, 20) * ta.stdev(x, 20))',
    'plot(x * slope + (ta.sma(close, 20) - slope * ta.sma(x, 20)))',
  ], 'inv', 0],
  'floor(mean of two indices) - index': [['plot(math.floor((bar_index + bar_index[2]) / 2) - bar_index)'], 'inv', 0],
  'no index at all': [['plot(ta.sma(close, 10))'], 'inv', 0],
  // ── ⭐ F9: a running count of a constant IS the index (`c · (bar_index + 1)`) ──
  'ta.cum(1)': [['plot(ta.cum(1))'], 'pos', 0],
  'ta.cum(1) - ta.cum(1)[5]': [['plot(ta.cum(1) - ta.cum(1)[5])'], 'inv', 0],
  'ta.cum(1) - index': [['plot(ta.cum(1) - bar_index)'], 'inv', 0],
  'ta.cum(1) < 16 (atr-trailing-stoploss)': [['plot(ta.cum(1) < 16 ? close : open)'], 'inv', 1],
  'ta.cum(2)': [['plot(ta.cum(2))'], 'dep', 0],
  'ta.cum(close) (a series total: not a count)': [['plot(ta.cum(close))'], 'inv', 0],
  // ── a THRESHOLD: known where a larger D can only confirm it ───────────────────
  'index > 50': [['plot(bar_index > 50 ? close : open)'], 'inv', 1],
  'index >= 50': [['plot(bar_index >= 50 ? close : open)'], 'inv', 1],
  'index < 50': [['plot(bar_index < 50 ? close : open)'], 'inv', 1],
  '50 > index (the sides swapped)': [['plot(50 > bar_index ? close : open)'], 'inv', 1],
  'a threshold under a 10-bar window': [['plot(ta.sma(bar_index > 30 ? close : open, 10))'], 'inv', 1],
  'a threshold under ta.cum': [['plot(ta.cum(bar_index > 10 ? 1 : 0))'], 'inv', 1],
  'a threshold guarding a var': [['var float v = na', 'if bar_index > 20 and close > open', '    v := close', 'plot(v)'], 'inv', 1],
  // ── everything else depends on D in a way no bar can vouch for ────────────────
  'index % 3': [['plot(bar_index % 3)'], 'dep', 0],
  'index == 40': [['plot(bar_index == 40 ? 1 : 0)'], 'dep', 0],
  'index * close': [['plot(bar_index * close)'], 'dep', 0],
  'index * index': [['plot(bar_index * bar_index)'], 'dep', 0],
  'max(index, 10)': [['plot(math.max(bar_index, 10))'], 'dep', 0],
  'nz(index[1])': [['plot(nz(bar_index[1]))'], 'dep', 0],
  'sum of the index over 5 bars': [['plot(math.sum(bar_index, 5))'], 'dep', 0],
  'close[index % 4]': [['plot(close[bar_index % 4])'], 'dep', 0],
  'an index as a truth value': [['plot(bar_index ? 1 : 0)'], 'dep', 0],
}
const treeOf = (key) => {
  const t = translatePine(`//@version=6\nindicator("p", max_bars_back = 50)\n${PINE[key][0].join('\n')}\n`, { strict: true })
  if (!t.ok) throw new Error(`${key}: ${t.refusal && t.refusal.message}`)
  // ⭐ F9 — `plot(ta.cum(1))` reads no bar, so the screener never SELECTS it (a
  // constant, H8); the chart draws it, and its tree is the one output.
  return (t.outputs[t.selected] || t.outputs[0]).ast
}

const PINE_DOC = { tf: 'D', barIndexAbsolute: true }
/** [name, tree key, opts] — the Pine document off the listing, on it, and a
 *  formula-language document (no claim about TradingView's index). */
const CASES = [
  ...Object.keys(PINE).map((k) => [`${k} · off the listing`, k, PINE_DOC]),
  ...['index', 'index % 3', 'index > 50', 'index * close', 'a threshold under ta.cum', 'ta.cum(1)']
    .map((k) => [`${k} · from the listing`, k, { ...PINE_DOC, historyFromListing: true }]),
  ...['index', 'index % 3', 'index > 50'].map((k) => [`${k} · the formula language's own barindex`, k, { tf: 'D' }]),
  // the object lane's reading: an index is a POSITION there, and keeps its column
  ...['index', 'valuewhen(index)', 'index % 3', 'index > 50']
    .map((k) => [`${k} · as a position`, k, { ...PINE_DOC, barIndexUse: 'position' }]),
]

function evaluate(ast, opts) {
  const sink = new Map()
  const col = Array.from(interpret(ast, BARS, {}, undefined, undefined, { ...(opts || {}), chartClockSink: sink }))
    .map((x) => (Number.isNaN(x) ? null : x))
  return { expected: col, codes: [...sink.keys()].sort() }
}

if (WRITE) {
  const doc = {
    _: 'C45 — bar_index off the listing, the same answer in both lanes. Written by '
      + 'app/src/components/chart/engine/ast/barIndexShift.test.js (BAR_INDEX_SHIFT_PARITY_WRITE=1); read by '
      + 'that file and by tests/test_ast_bar_index_shift_parity.py. `cls` / `thresholds` are '
      + 'barIndexShift.js::barIndexVerdict; `expected` is the JS lane\'s own interpret output under `opts` '
      + '(null = withheld / not computable); `codes` are the withholding codes the mask named.',
    pine: Object.fromEntries(Object.entries(PINE).map(([k, v]) => [k, v[0]])),
    bars: BARS,
    cases: CASES.map(([name, key, opts]) => {
      const ast = treeOf(key)
      const v = barIndexVerdict(ast)
      return { name, pine: key, opts, ast, cls: v.cls, thresholds: v.thresholds.length, ...evaluate(ast, opts) }
    }),
  }
  writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
}

const PARITY = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const byName = new Map(PARITY.cases.map((c) => [c.name, c]))
const col = (name) => byName.get(name).expected
const nulls = (name) => col(name).filter((v) => v === null).length

describe('C45 · the fixture is the member door\'s own trees over the bars this file builds', () => {
  it('every case tree is what the translator writes today for its lines of Pine', () => {
    expect(PARITY.cases.map((c) => c.name)).toEqual(CASES.map((c) => c[0]))
    for (const c of PARITY.cases) expect(c.ast, c.name).toEqual(treeOf(c.pine))
    expect(PARITY.bars).toEqual(BARS)
  })
})

describe('C45 · the class of each tree — proved from the tree alone', () => {
  it.each(Object.entries(PINE).map(([k, v]) => [k, v[1], v[2]]))('%s is %s (%i threshold)', (key, cls, thresholds) => {
    const v = barIndexVerdict(treeOf(key))
    expect(v.cls).toBe(cls)
    expect(v.thresholds.length).toBe(thresholds)
    expect(barIndexClass(treeOf(key))).toBe(cls)
  })

  it('non-vacuity: every class is exercised, and every tree but the control reads the index', () => {
    const counts = { inv: 0, pos: 0, dep: 0 }
    for (const [, cls] of Object.values(PINE)) counts[cls] += 1
    expect(counts.pos).toBeGreaterThanOrEqual(8)
    expect(counts.inv).toBeGreaterThanOrEqual(15)
    expect(counts.dep).toBeGreaterThanOrEqual(8)
    const READS_NONE = new Set(['no index at all', 'ta.cum(close) (a series total: not a count)'])
    for (const key of Object.keys(PINE)) expect(readsBarIndex(treeOf(key)), key).toBe(!READS_NONE.has(key))
  })

  it('a threshold is unknown exactly where a larger D could change the answer', () => {
    // gap = left − right on this chart; sign +1: the left side gains on the right as D grows
    expect([-1, 0, 1].map((g) => thresholdUnknown('>', 1, g))).toEqual([true, true, false])
    expect([-1, 0, 1].map((g) => thresholdUnknown('>=', 1, g))).toEqual([true, false, false])
    expect([-1, 0, 1].map((g) => thresholdUnknown('<', 1, g))).toEqual([true, false, false])
    expect([-1, 0, 1].map((g) => thresholdUnknown('<=', 1, g))).toEqual([true, true, false])
    // sign −1 (the index on the right): the mirror image
    expect([-1, 0, 1].map((g) => thresholdUnknown('>', -1, g))).toEqual([false, false, true])
    expect([-1, 0, 1].map((g) => thresholdUnknown('>=', -1, g))).toEqual([false, true, true])
    expect([-1, 0, 1].map((g) => thresholdUnknown('<', -1, g))).toEqual([false, true, true])
    expect([-1, 0, 1].map((g) => thresholdUnknown('<=', -1, g))).toEqual([false, false, true])
    // an `na` side: the comparison is false on both platforms — known
    for (const op of ['>', '>=', '<', '<=']) expect(thresholdUnknown(op, 1, NaN)).toBe(false)
  })

  it('⭐ THE PROOF, CHECKED BY BRUTE FORCE: shift the index by D and each tree moves exactly as its class says', () => {
    // An independent oracle, with none of the pass's algebra in it: every index
    // leaf of the tree is rewritten `leaf + D` and the tree is evaluated again on
    // the SAME bars — which is what TradingView's longer history does to the
    // index and to nothing else. 'inv' must not move on any bar the mask does not
    // withhold; 'pos' must move by exactly D on every bar; 'dep' must be NEITHER
    // for at least one D — some bar moves otherwise, or some bars move and others
    // do not (so a 'dep' is a real dependence, not a refusal to look).
    const shifted = (n, d) => {
      if (!n || typeof n !== 'object') return n
      if (n.type === 'series' && BAR_INDEX_LEAVES.includes(n.name)) return { type: 'op', name: '+', args: [n, { type: 'num', value: d }] }
      // ⭐ F9 — a running count of a constant `c` over D more bars is `c · D` larger.
      if (n.type === 'call' && n.name === 'cum' && n.args && n.args.length === 1 && n.args[0] && n.args[0].type === 'num') {
        return { type: 'op', name: '+', args: [n, { type: 'num', value: n.args[0].value * d }] }
      }
      return Array.isArray(n.args) ? { ...n, args: n.args.map((a) => shifted(a, d)) } : n
    }
    const run = (ast) => Array.from(interpret(ast, BARS, {}, undefined, undefined, { tf: 'D' }))
    const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
    const judged = { inv: 0, pos: 0, dep: 0 }
    let compared = 0
    for (const [key, [, cls]] of Object.entries(PINE)) {
      const ast = treeOf(key)
      if (!readsBarIndex(ast)) continue
      const here = run(ast)
      const mask = barIndexMask(ast, BARS, {}, undefined, undefined, { ...PINE_DOC, barIndexUse: 'position' })
      let otherwise = false
      for (const d of [1, 7, 61, 8175]) {
        let there
        try { there = run(shifted(ast, d)) } catch (err) {
          // the rewrite adds two nodes a leaf; a tree it pushes over the node cap is not judged
          if (err && err.guard === 'budget:nodes') { there = null } else throw err
        }
        if (!there) continue
        if (cls === 'dep') {
          const valued = here.map((_, i) => i).filter((i) => !(Number.isNaN(here[i]) && Number.isNaN(there[i])))
          const still = valued.every((i) => same(here[i], there[i]))
          const moved = valued.every((i) => same(here[i] + d, there[i]))
          if (!still && !moved) otherwise = true
          judged.dep += 1
          continue
        }
        for (let i = 0; i < N; i += 1) {
          if (mask && mask[i]) continue
          const want = cls === 'pos' ? here[i] + d : here[i]
          if (!same(want, there[i])) throw new Error(`${key} (${cls}), D = ${d}, bar ${i}: ${here[i]} became ${there[i]}`)
          if (!Number.isNaN(here[i])) compared += 1
        }
        judged[cls] += 1
      }
      if (cls === 'dep') expect(otherwise, `${key}: classified 'dep' and never moved otherwise`).toBe(true)
    }
    expect(judged.inv).toBeGreaterThanOrEqual(60)
    expect(judged.pos).toBeGreaterThanOrEqual(30)
    expect(judged.dep).toBeGreaterThanOrEqual(30)
    expect(compared).toBeGreaterThan(20000)
  })
})

describe('C45 · parity with the Python lane — one fixture, both lanes', () => {
  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_name, c) => {
    const v = barIndexVerdict(c.ast)
    expect(v.cls).toBe(c.cls)
    expect(v.thresholds.length).toBe(c.thresholds)
    const got = evaluate(c.ast, c.opts)
    expect(got.expected).toEqual(c.expected)
    expect(got.codes).toEqual(c.codes)
  })

  it('both codes hold a sentence, and the whole-series one is declared whole', () => {
    for (const code of ['bar-index:window', 'bar-index:early-bars']) expect(typeof CHART_CLOCK_WITHHELD[code]('D')).toBe('string')
    expect(CHART_CLOCK_WHOLE).toContain('bar-index:window')
    expect(CHART_CLOCK_WHOLE).not.toContain('bar-index:early-bars')
  })
})

describe('C45 · the fixture is not vacuous', () => {
  const codes = (name) => byName.get(name).codes

  it('an index, and anything that depends on it, is withheld on EVERY bar off the listing — by name', () => {
    for (const k of ['index', 'index + 5', 'valuewhen(index)', 'index % 3', 'index == 40', 'index * close', 'max(index, 10)']) {
      expect(nulls(`${k} · off the listing`), k).toBe(N)
      expect(codes(`${k} · off the listing`), k).toEqual(['bar-index:window'])
    }
  })

  it('an index-invariant tree is SERVED off the listing, and names nothing', () => {
    for (const k of ['index - index[5]', 'bars since (index - valuewhen)', 'last_bar_index - index', 'change(index)', 'index compared with its own lag']) {
      expect(codes(`${k} · off the listing`), k).toEqual([])
      expect(nulls(`${k} · off the listing`), k).toBeLessThan(10)
    }
    // …and it is the right number: a distance of five bars is 5, on every bar it exists
    expect(col('index - index[5] · off the listing').slice(5)).toEqual(new Array(N - 5).fill(5))
    expect(col('last_bar_index - index · off the listing')).toEqual(BARS.map((_, i) => N - 1 - i))
    // the regression line is served past its 20-bar warm-up
    const line = col('a least-squares line through the index · off the listing')
    expect(line.filter((v) => v === null).length).toBe(19)
  })

  it('⭐ a threshold is withheld on the early bars only: `bar_index > 50` is known from bar 51 on', () => {
    const c = col('index > 50 · off the listing')
    expect(c.slice(0, 51)).toEqual(new Array(51).fill(null))
    expect(c.slice(51)).toEqual(BARS.slice(51).map((b) => b.c))
    expect(codes('index > 50 · off the listing')).toEqual(['bar-index:early-bars'])
    // `>=` is known one bar earlier
    expect(col('index >= 50 · off the listing').slice(49, 51)).toEqual([null, BARS[50].c])
    // `<` runs the other way: where it is TRUE here it may be false there
    const lt = col('index < 50 · off the listing')
    expect(lt.slice(0, 50)).toEqual(new Array(50).fill(null))
    expect(lt.slice(50)).toEqual(BARS.slice(50).map((b) => b.o))
    expect(col('50 > index (the sides swapped) · off the listing')).toEqual(lt)
  })

  it('…and reaches as far as the tree reads back: 9 more bars under a 10-bar window, every bar under `ta.cum`', () => {
    const w = col('a threshold under a 10-bar window · off the listing')
    // bars 0..30 unknown, and the ten bars the window's declared reach carries them
    expect(w.slice(0, 41)).toEqual(new Array(41).fill(null))
    expect(w[41]).toBeCloseTo(BARS.slice(32, 42).reduce((s, b) => s + b.c, 0) / 10, 9)
    expect(nulls('a threshold under ta.cum · off the listing')).toBe(N)
    expect(codes('a threshold under ta.cum · off the listing')).toEqual(['bar-index:early-bars'])
  })

  it('a `var` written under a threshold is known again one warm-up past it (the window forgets)', () => {
    // bars 0..20 are unknown, and the 250-bar window carries them: served from bar 271
    const v = col('a threshold guarding a var · off the listing')
    expect(v.slice(0, 271)).toEqual(new Array(271).fill(null))
    expect(v[271]).not.toBeNull()
    expect(codes('a threshold guarding a var · off the listing')).toEqual(['bar-index:early-bars'])
  })

  it('CONTROL — from the listing nothing is withheld for the index: bar 0 is TradingView\'s bar 0', () => {
    expect(col('index · from the listing')).toEqual(BARS.map((_, i) => i))
    expect(col('index % 3 · from the listing')).toEqual(BARS.map((_, i) => i % 3))
    expect(col('index > 50 · from the listing')).toEqual(BARS.map((b, i) => (i > 50 ? b.c : b.o)))
    for (const k of ['index', 'index % 3', 'index > 50', 'index * close', 'a threshold under ta.cum']) {
      expect(byName.get(`${k} · from the listing`).codes, k).toEqual([])
    }
  })

  it('CONTROL — the formula language\'s own `barindex` claims no other platform\'s number and is served as it always was', () => {
    expect(col('index · the formula language\'s own barindex')).toEqual(BARS.map((_, i) => i))
    expect(col('index % 3 · the formula language\'s own barindex')).toEqual(BARS.map((_, i) => i % 3))
    expect(byName.get('index > 50 · the formula language\'s own barindex').codes).toEqual([])
  })

  it('as a POSITION (the object lane) an index keeps its column; a dependence is still withheld', () => {
    expect(col('index · as a position')).toEqual(BARS.map((_, i) => i))
    expect(nulls('valuewhen(index) · as a position')).toBeLessThan(5)
    expect(nulls('index % 3 · as a position')).toBe(N)
    expect(byName.get('index % 3 · as a position').codes).toEqual(['bar-index:window'])
    expect(col('index > 50 · as a position').slice(0, 51)).toEqual(new Array(51).fill(null))
  })

  it('the mask itself: null when the document makes no claim, or the series starts at the listing', () => {
    const ast = treeOf('index % 3')
    expect(barIndexMask(ast, BARS, {}, undefined, undefined, { tf: 'D' })).toBeNull()
    expect(barIndexMask(ast, BARS, {}, undefined, undefined, { tf: 'D', barIndexAbsolute: true, historyFromListing: true })).toBeNull()
    expect(Array.from(barIndexMask(ast, BARS, {}, undefined, undefined, PINE_DOC))).toEqual(new Array(N).fill(1))
    expect(barIndexMask(treeOf('index - index[5]'), BARS, {}, undefined, undefined, PINE_DOC)).toBeNull()
  })
})
