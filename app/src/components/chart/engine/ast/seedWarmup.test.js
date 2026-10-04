// app/src/components/chart/engine/ast/seedWarmup.test.js
//
// ─── ⭐⭐ F5 — A RECURSIVE SERIES SEEDED AT THE WINDOW, OFF THE LISTING ─────────
//
// Integrator ruling, 2026-10-03: off the listing a recursive series (`ta.ema`,
// `ta.rma`, `ta.rsi`, `ta.atr`, a MACD line, the DMI legs, and whatever reads
// them) is seeded where TradingView's is not, so its first bars are a different
// number that converges. Each such bar is WITHHELD, decided from a bound derived
// from the series' own decay — `interpret.js::seedWarmupMask` / `seedBoundOf`.
//
// This file pins (1) that the decision is the decay maths and nothing else, (2)
// that it propagates through compositions, (3) that nothing changes from the
// listing or for a document that claims no other platform's number, and (4) the
// Python lane (`api/services/ast_seed_warmup.py`) to the same answer through ONE
// fixture (`tests/fixtures/ast/seed_warmup_parity.json`, read by
// `tests/test_ast_seed_warmup_parity.py`).
//
// ⛔ THE TREES ARE THE MEMBER DOOR'S OWN: each case is what `translatePine(…,
// { strict: true })` writes for its lines of Pine.
//
// To regenerate after a deliberate change (from `app/`):
//   SEED_WARMUP_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/seedWarmup.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import {
  interpret, seedWarmupMask, seedFromWindowOf, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE,
  SEED_WARMUP_REL, SEED_WARMUP_ABS, SEED_WARMUP_CODE, SEEDED_CALLS,
} from './interpret.js'
import { REL_TOL, ABS_FLOOR_UNKNOWN_SCALE } from '../../../../../../tools/vendor_harness/compare.mjs'

const FIXTURE = '../tests/fixtures/ast/seed_warmup_parity.json'
const WRITE = process.env.SEED_WARMUP_PARITY_WRITE === '1'

/** 700 daily bars, deterministic: a trend, two cycles and a crash, so a
 *  smoother's range is wide and its comparisons cross. */
const N = 700
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + i * 0.08 + Math.sin(i / 9) * 6 + Math.sin(i / 41) * 11 - (i > 300 && i < 330 ? (i - 300) * 1.2 : 0)
    + (i >= 330 && i < 380 ? (36 - (i - 330) * 0.72) : 0)
  const o = c + Math.cos(i * 1.7) * 1.3
  const d = new Date(Date.UTC(2022, 0, 3))
  d.setUTCDate(d.getUTCDate() + i)
  return { t: d.toISOString().slice(0, 10), o, h: Math.max(o, c) + 1 + (i % 7) * 0.1, l: Math.min(o, c) - 1 - (i % 5) * 0.1, c, v: 1000 + (i % 13) * 37 }
})

/** name → lines of Pine (one plot each) */
const PINE = {
  'ema 10': ['plot(ta.ema(close, 10))'],
  'ema 50': ['plot(ta.ema(close, 50))'],
  'rma 14': ['plot(ta.rma(close, 14))'],
  'rsi 14': ['plot(ta.rsi(close, 14))'],
  'atr 14': ['plot(ta.atr(14))'],
  'macd line': ['[m, s, h] = ta.macd(close, 12, 26, 9)', 'plot(m)'],
  'macd signal': ['[m, s, h] = ta.macd(close, 12, 26, 9)', 'plot(s)'],
  'adx': ['[p, m, a] = ta.dmi(14, 14)', 'plot(a)'],
  'ema of ema': ['plot(ta.ema(ta.ema(close, 10), 10))'],
  'sma of ema': ['plot(ta.sma(ta.ema(close, 10), 20))'],
  'wma of ema': ['plot(ta.wma(ta.ema(close, 8), 5))'],
  'keltner upper': ['plot(ta.ema(close, 20) + 2 * ta.atr(10))'],
  'ema cross marker': ['plot(ta.crossover(ta.ema(close, 8), ta.ema(close, 21)) ? high : na)'],
  'ema above sma': ['plot(ta.ema(close, 20) > ta.sma(close, 20) ? 1 : 0)'],
  'rsi above 50 colourless': ['plot(ta.rsi(close, 14) > 50 ? close : open)'],
  'sqrt of atr': ['plot(math.sqrt(ta.atr(14)))'],
  'a ratchet reading atr': [
    'up = hl2 - 3 * ta.atr(10)',
    'up1 = nz(up[1], up)',
    'up := close[1] > up1 ? math.max(up, up1) : up',
    'plot(up)',
  ],
  'weekly ema': ['plot(request.security(syminfo.tickerid, "W", ta.ema(close, 5)))'],
  'sma alone': ['plot(ta.sma(close, 20))'],
  'close alone': ['plot(close)'],
}
const treeOf = (key) => {
  const t = translatePine(`//@version=5\nindicator("p")\n${PINE[key].join('\n')}\n`, { strict: true })
  if (!t.ok) throw new Error(`${key}: ${t.refusal && t.refusal.message}`)
  return t.outputs[t.selected].ast
}

const OFF = { tf: 'D', barIndexAbsolute: true }
const CASES = [
  ...Object.keys(PINE).map((k) => [`${k} · off the listing`, k, OFF]),
  ...['ema 10', 'rsi 14', 'keltner upper', 'a ratchet reading atr']
    .map((k) => [`${k} · from the listing`, k, { ...OFF, historyFromListing: true }]),
  ...['ema 10', 'macd signal'].map((k) => [`${k} · the formula language's own document`, k, { tf: 'D' }]),
]

function evaluate(ast, opts) {
  const sink = new Map()
  const seed = {}
  const col = Array.from(interpret(ast, BARS, {}, undefined, undefined, { ...(opts || {}), chartClockSink: sink, seedWarmupSink: seed }))
    .map((x) => (Number.isNaN(x) ? null : x))
  return { expected: col, codes: [...sink.keys()].sort(), withheld: seed.mask ? Array.from(seed.mask).filter(Boolean).length : 0 }
}

if (WRITE) {
  const doc = {
    _: 'F5 — a recursive series seeded at the window, withheld by its own decay off the listing; the same '
      + 'answer in both lanes. Written by app/src/components/chart/engine/ast/seedWarmup.test.js '
      + '(SEED_WARMUP_PARITY_WRITE=1); read by that file and by tests/test_ast_seed_warmup_parity.py. '
      + '`expected` is the JS lane\'s own interpret output under `opts` (null = withheld / not computable); '
      + '`codes` the withholding codes named; `withheld` how many bars the seed mask withheld.',
    pine: PINE,
    bars: BARS,
    cases: CASES.map(([name, key, opts]) => ({ name, pine: key, opts, ast: treeOf(key), ...evaluate(treeOf(key), opts) })),
  }
  writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
}

const PARITY = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const byName = new Map(PARITY.cases.map((c) => [c.name, c]))
const col = (name) => byName.get(name).expected
const plain = (key) => Array.from(interpret(treeOf(key), BARS, {}, undefined, undefined, { tf: 'D' }))
const firstValued = (c) => c.findIndex((v) => v !== null)

describe('F5 · the fixture is the member door\'s own trees over the bars this file builds', () => {
  it.each(PARITY.cases.map((c) => [c.name, c]))('%s — the tree is what the door writes today', (_n, c) => {
    expect(c.ast).toEqual(treeOf(c.pine))
  })
})

describe('F5 · parity with the Python lane — one fixture, both lanes', () => {
  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_n, c) => {
    const got = evaluate(c.ast, c.opts)
    expect(got.codes).toEqual(c.codes)
    expect(got.withheld).toBe(c.withheld)
    expect(got.expected.length).toBe(c.expected.length)
    for (let i = 0; i < got.expected.length; i++) {
      const a = got.expected[i]
      const b = c.expected[i]
      if (b === null) expect(a, `${c.name} bar ${i}`).toBeNull()
      else expect(Math.abs(a - b), `${c.name} bar ${i}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)))
    }
  })
})

describe('F5 · the withheld region IS the decay maths', () => {
  it('⭐ ta.ema(close, n): the first drawn bar is the first where (1-α)^k·R falls under half the tolerance', () => {
    for (const n of [10, 50]) {
      const c = col(`ema ${n} · off the listing`)
      const ref = plain(`ema ${n}`)
      const closes = BARS.map((b) => b.c)
      const R = Math.max(...closes) - Math.min(...closes)
      const alpha = 2 / (n + 1)
      const seedBar = n - 1
      let expectFirst = -1
      let e = R
      for (let i = seedBar; i < N; i++) {
        if (i > seedBar) e = (1 - alpha) * e
        const thr = 0.5 * Math.max(SEED_WARMUP_ABS, SEED_WARMUP_REL * Math.max(0, Math.abs(ref[i]) - e))
        if (e < thr) { expectFirst = i; break }
      }
      expect(expectFirst, `ema ${n}`).toBeGreaterThan(seedBar)
      expect(firstValued(c), `ema ${n}`).toBe(expectFirst)
      // and every drawn bar is the plain evaluation's own number, untouched
      for (let i = expectFirst; i < N; i++) expect(c[i]).toBe(ref[i])
    }
  })

  it('a longer average forgets more slowly, so more of it is withheld', () => {
    expect(firstValued(col('ema 50 · off the listing'))).toBeGreaterThan(firstValued(col('ema 10 · off the listing')))
    expect(byName.get('ema 50 · off the listing').withheld).toBeGreaterThan(byName.get('ema 10 · off the listing').withheld)
  })

  it('⭐ a composition is withheld at least as long as what it reads — the chain bound is derived', () => {
    const inner = firstValued(col('ema 10 · off the listing'))
    for (const k of ['ema of ema', 'sma of ema', 'keltner upper']) {
      expect(firstValued(col(`${k} · off the listing`)), k).toBeGreaterThanOrEqual(inner)
    }
    expect(firstValued(col('ema of ema · off the listing'))).toBeGreaterThan(inner)
    // a smooth function of a bounded value carries the bound through its own
    // slope: √x halves the relative error, so it is drawn a bar or two BEFORE
    // the average it reads — derived, never copied from the input's mask
    const atr = firstValued(col('atr 14 · off the listing'))
    const root = firstValued(col('sqrt of atr · off the listing'))
    expect(root).toBeLessThanOrEqual(atr)
    expect(root).toBeGreaterThan(atr - 10)
    expect(byName.get('sqrt of atr · off the listing').withheld).toBeGreaterThan(0)
  })

  it('every seeded call this file translates is withheld somewhere off the listing, and named', () => {
    for (const k of ['ema 10', 'rma 14', 'rsi 14', 'atr 14', 'macd line', 'macd signal', 'adx', 'a ratchet reading atr']) {
      const c = byName.get(`${k} · off the listing`)
      expect(c.withheld, k).toBeGreaterThan(0)
      expect(c.codes, k).toContain(SEED_WARMUP_CODE)
    }
    // a weekly read is withheld on ITS OWN bars, by the nested evaluation, and
    // named: its blank weeks arrive here already blank
    const weekly = byName.get('weekly ema · off the listing')
    expect(weekly.codes).toContain(SEED_WARMUP_CODE)
    expect(firstValued(weekly.expected)).toBeGreaterThan(firstValued(plain('weekly ema').map((x) => (Number.isNaN(x) ? null : x))))
    expect(SEEDED_CALLS).toEqual(expect.arrayContaining(['ema', 'rma', 'rsi', 'macd', 'atrPine', 'adx']))
  })

  it('a tree that carries no seed is untouched and names nothing', () => {
    for (const k of ['sma alone', 'close alone']) {
      const c = byName.get(`${k} · off the listing`)
      expect(c.withheld, k).toBe(0)
      expect(c.codes, k).toEqual([])
      expect(c.expected).toEqual(plain(k).map((x) => (Number.isNaN(x) ? null : x)))
    }
  })

  it('⭐ a decision the bound cannot make is withheld, never guessed: an ema crossover marker', () => {
    const c = col('ema cross marker · off the listing')
    const ref = plain('ema cross marker')
    // the plain evaluation fires somewhere early that this one does not draw
    const early = ref.findIndex((v) => !Number.isNaN(v))
    expect(early).toBeGreaterThan(0)
    expect(byName.get('ema cross marker · off the listing').withheld).toBeGreaterThan(0)
    // where it is drawn it is the plain number
    for (let i = 0; i < N; i++) if (c[i] !== null) expect(c[i]).toBe(ref[i])
  })
})

describe('F5 · nothing changes where our seed IS TradingView\'s, or nothing claims to be theirs', () => {
  it.each(['ema 10', 'rsi 14', 'keltner upper', 'a ratchet reading atr'])('%s from the listing is the plain evaluation', (k) => {
    const c = byName.get(`${k} · from the listing`)
    expect(c.withheld).toBe(0)
    expect(c.codes).not.toContain(SEED_WARMUP_CODE)
  })

  it.each(['ema 10', 'macd signal'])('%s in a formula-language document (no Pine claim) is untouched', (k) => {
    const c = byName.get(`${k} · the formula language's own document`)
    expect(c.withheld).toBe(0)
    expect(c.expected).toEqual(plain(k).map((x) => (Number.isNaN(x) ? null : x)))
  })

  it('the gate is the C45 declaration and nothing else', () => {
    expect(seedFromWindowOf({ barIndexAbsolute: true })).toBe(true)
    expect(seedFromWindowOf({ barIndexAbsolute: true, historyFromListing: true })).toBe(false)
    expect(seedFromWindowOf({ barIndexAbsolute: true, prefixProbe: 1e12 })).toBe(false)
    // the object lane (drawings) reads values as positions and is not this rule's
    expect(seedFromWindowOf({ barIndexAbsolute: true, barIndexUse: 'position' })).toBe(false)
    expect(seedFromWindowOf({ tf: 'D' })).toBe(false)
    expect(seedFromWindowOf(undefined)).toBe(false)
  })
})

describe('F5 · disclosure and the harness tolerance', () => {
  it('the code holds a sentence, and is a per-bar withholding, never a whole-series one', () => {
    expect(CHART_CLOCK_WITHHELD[SEED_WARMUP_CODE]('D')).toMatch(/withheld rather than drawn wrong/)
    expect(CHART_CLOCK_WHOLE).not.toContain(SEED_WARMUP_CODE)
  })

  it('⛔ the product never decides against a looser tolerance than the harness grades with', () => {
    expect(SEED_WARMUP_REL).toBeLessThanOrEqual(REL_TOL)
    expect(SEED_WARMUP_ABS).toBeLessThanOrEqual(ABS_FLOOR_UNKNOWN_SCALE)
  })

  it('the mask reports its bound and the value it withheld', () => {
    const sink = {}
    const ast = treeOf('ema 10')
    const mask = seedWarmupMask(ast, BARS, {}, undefined, undefined, { ...OFF, seedWarmupSink: sink })
    expect(mask).toBeTruthy()
    expect(sink.mask).toBe(mask)
    expect(sink.bound.length).toBe(N)
    const ref = plain('ema 10')
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(ref[i])) continue
      expect(sink.raw[i]).toBe(ref[i])
    }
  })
})
