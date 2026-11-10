// app/src/components/chart/engine/ast/varOrigin.test.js
//
// ─── ⭐⭐ 2026-11-09 — A `var` THAT BEGAN BEFORE THE LOADED BARS, AND `isfirst` ───
//
// Off the listing (ruling R-W) a translated `var` is the bounded window
// `accum(seed, update, 250)`, re-seeded 250 bars back on every bar, where Pine's
// `var` was set ONCE on the symbol's first bar. Where the update forgot the seed
// inside the window the two agree; where it did not the window drew a number
// TradingView never shows (`vw-bar-origin-spy-1d-300-2026-10-02` O07: 20294.6
// days where TradingView reads 8429.6, the listing). `interpret.js::varOriginMask`
// withholds those bars BY NAME (`var-origin:window` / `var-origin:bars`), and
// `barstate.isfirst` is read as the threshold `bar_index < 1`
// (`barIndexShift.js::FIRST_BAR_LEAVES`, `bar-index:first-bar`).
//
// The trees and their two-lane answers live in the C45 parity fixture
// (`tests/fixtures/ast/bar_index_shift_parity.json`, the `· var origin ·` cases,
// written by `barIndexShift.test.js`, read by `tests/test_ast_bar_index_shift_parity.py`).
// This file reads them and adds the ORACLE: the same tree run over the bars FROM
// THE LISTING is the truth, and every bar served off the listing must equal it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { interpret, varOriginMask, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, SEED_RESIDUAL_TOLERANCE } from './interpret.js'
import { SEED_RESIDUAL_TOLERANCE as PINE_TOLERANCE } from './pine.js'
import { barIndexVerdict, FIRST_BAR_LEAVES, FIRST_BAR_TEST } from './barIndexShift.js'
import { varOriginAbsoluteFor, barIndexAbsoluteFor, PINE_RECURRENCE_ORIGIN } from '../nativeRegistry.js'

const PARITY = JSON.parse(readFileSync('../tests/fixtures/ast/bar_index_shift_parity.json', 'utf8'))
const BARS = PARITY.bars
const N = BARS.length
const VAR_DOC = { tf: 'D', barIndexAbsolute: true, varOriginAbsolute: true }
const byName = new Map(PARITY.cases.map((c) => [c.name, c]))
const kase = (key, where = 'off the listing') => {
  const c = byName.get(`${key} · var origin · ${where}`)
  if (!c) throw new Error(`no fixture case ${key} · ${where}`)
  return c
}
const col = (key, where) => kase(key, where).expected
const codes = (key, where) => kase(key, where).codes
const nulls = (key, where) => col(key, where).filter((v) => v === null).length
const KEYS = [...new Set(PARITY.cases.filter((c) => c.name.includes(' · var origin · ')).map((c) => c.pine))]

describe('the fixture holds the var-origin trees', () => {
  it('nineteen trees, each off the listing, with controls from the listing and in the formula language', () => {
    expect(KEYS.length).toBe(19)
    expect(PARITY.cases.filter((c) => c.name.endsWith('· var origin · from the listing')).length).toBe(4)
    expect(PARITY.cases.filter((c) => c.name.endsWith("· var origin · the formula language's own accum")).length).toBe(3)
  })
})

describe('⭐ a `var` that keeps its first value: withheld whole off the listing, by name', () => {
  it('`var t0 = time` — every bar withheld, `var-origin:window`', () => {
    expect(nulls('var first time')).toBe(N)
    expect(codes('var first time')).toEqual(['var-origin:window'])
    expect(nulls('var first close, as a ratio')).toBe(N)
    expect(codes('var first close, as a ratio')).toEqual(['var-origin:window'])
  })

  it('CONTROL — from the listing it is the first bar\'s time on every bar', () => {
    const c = col('var first time', 'from the listing')
    const t0 = Date.parse(`${BARS[0].t}T14:30:00Z`) / 86400000
    expect(c.every((v) => v !== null && Math.abs(v - c[0]) < 1e-9)).toBe(true)
    expect(Math.abs(c[0] - t0)).toBeLessThan(1)
    expect(codes('var first time', 'from the listing')).toEqual([])
  })

  it('CONTROL — a formula\'s own `accum(…, 250)` is a 250-bar window by its sentence, and is served as before', () => {
    const c = col('var first time', "the formula language's own accum")
    expect(c.slice(250).every((v) => v !== null)).toBe(true)
    expect(c[300]).not.toBe(c[251])                                  // the window's own moving value
    expect(codes('var first time', "the formula language's own accum")).toEqual([])
  })

  it('a `var` seeded with an input IS Pine\'s value and is served (past the window\'s warm-up)', () => {
    expect(codes('var seeded by an input')).toEqual([])
    expect(col('var seeded by an input').slice(250)).toEqual(new Array(N - 250).fill(28))
  })
})

describe('⭐ a `var` set on some bars and held on the others: withheld on the bars it still holds the seed', () => {
  it('a rare set: withheld where no set lies inside the window, `var-origin:bars`', () => {
    const off = col('var set on a rare bar')
    const listed = col('var set on a rare bar', 'from the listing')
    expect(codes('var set on a rare bar')).toEqual(['var-origin:bars'])
    // the last bar with close < 93
    let lastSet = -1
    for (let i = 0; i < N; i++) if (BARS[i].c < 94) lastSet = i
    expect(lastSet).toBeGreaterThan(0)
    expect(lastSet).toBeLessThan(N - 250)
    for (let i = 250; i < N; i++) {
      if (i - 250 < lastSet) expect(off[i], `bar ${i}`).toBe(listed[i])
      else expect(off[i], `bar ${i}`).toBeNull()
    }
    expect(codes('var set on a rare bar, seeded na')).toEqual(['var-origin:bars'])
  })

  it('CONTROL — a set inside every window is served on every bar past the warm-up, naming nothing', () => {
    expect(codes('var set on a frequent bar')).toEqual([])
    expect(nulls('var set on a frequent bar')).toBe(250)
    expect(codes('an ema by hand')).toEqual([])
    expect(nulls('an ema by hand')).toBe(250)
  })

  it('CONTROL — a two-state machine is probed from the states it takes, and served (a SuperTrend direction)', () => {
    // ⚰️ probed from ±1e12 instead, `dir == 1` / `dir == -1` never matched, the probe was held
    // for ever and every bar was withheld (622 right bars on `supertrend-explorer`, AMEX:SPY 1D)
    expect(codes('a direction that flips')).toEqual([])
    expect(nulls('a direction that flips')).toBe(250)
    expect(col('a direction that flips').slice(250).every((v) => v === 1 || v === -1)).toBe(true)
  })
})

describe('⭐ a counter: named, where it used to be blank with no name', () => {
  it('`var n = 0; n += 1` — every bar, `var-origin:window`; from the listing it is bar_index + 1', () => {
    expect(nulls('a bar counter')).toBe(N)
    expect(codes('a bar counter')).toEqual(['var-origin:window'])
    expect(col('a bar counter', 'from the listing')).toEqual(BARS.map((_, i) => i + 1))
    expect(codes('a bar counter', 'from the listing')).toEqual([])
    // the formula language's door names nothing (and its switched mark stays blank, as before)
    expect(codes('a bar counter', "the formula language's own accum")).toEqual([])
  })

  it('a run-length counter is served from its first reset, and the bars before it are named', () => {
    const c = col('a run-length counter')
    const firstReset = BARS.findIndex((b) => !(b.c > b.o))
    expect(c.slice(firstReset).every((v) => v !== null)).toBe(true)
    expect(c.slice(0, firstReset).every((v) => v === null)).toBe(true)
    expect(codes('a run-length counter')).toEqual(firstReset > 0 ? ['var-origin:bars'] : [])
  })
})

describe('⭐ `barstate.isfirst` off the listing is the threshold `bar_index < 1`', () => {
  it('the pass lists the leaf as one threshold, and the comparison it stands for is `barindex < 1`', () => {
    expect(FIRST_BAR_LEAVES).toEqual(['isfirst'])
    expect(FIRST_BAR_TEST).toEqual({ type: 'op', name: '<', args: [{ type: 'series', name: 'barindex' }, { type: 'num', value: 1 }] })
    expect(barIndexVerdict(kase('isfirst').ast)).toMatchObject({ cls: 'inv' })
    expect(barIndexVerdict(kase('isfirst').ast).thresholds.length).toBe(1)
  })

  it('withheld on the first bar only, false (0) on every later bar; `bar-index:first-bar`', () => {
    const c = col('isfirst')
    expect(c[0]).toBeNull()
    expect(c.slice(1)).toEqual(new Array(N - 1).fill(0))
    expect(codes('isfirst')).toEqual(['bar-index:first-bar'])
    // bar 1 reads `close[1]`, i.e. bar 0: within the tree's reach of the unknown bar
    expect(col('isfirst picks a source').slice(0, 3)).toEqual([null, null, BARS[1].c])
  })

  it('`ta.barssince(barstate.isfirst)` reaches back to that bar from every bar: withheld whole', () => {
    expect(nulls('barssince(isfirst)')).toBe(N)
    expect(codes('barssince(isfirst)')).toEqual(['bar-index:first-bar'])
  })

  it('CONTROL — from the listing bar 0 IS the first bar: 1, then 0', () => {
    expect(col('isfirst', 'from the listing')).toEqual(BARS.map((_, i) => (i === 0 ? 1 : 0)))
    expect(codes('isfirst', 'from the listing')).toEqual([])
  })
})

describe('⭐ THE ORACLE — truth is the tree run from the listing; every bar served off it must be that number', () => {
  // the window must outlast the 250-bar bounded window for a `var` to be served at all
  const OFF = 40
  const window = BARS.slice(OFF)
  const run = (c, bars, opts) => Array.from(interpret(c.ast, bars, c.inputs || {}, undefined, undefined, opts))
  const tally = (opts) => {
    let served = 0
    let wrong = 0
    for (const key of KEYS) {
      const c = kase(key)
      const truth = run(c, BARS, { ...VAR_DOC, historyFromListing: true }).slice(OFF)
      const ours = run(c, window, opts)
      for (let i = 0; i < ours.length; i++) {
        if (Number.isNaN(ours[i])) continue
        served += 1
        const t = truth[i]
        if (!(Math.abs(ours[i] - t) <= 1e-9 * Math.max(1, Math.abs(t)))) wrong += 1
      }
    }
    return { served, wrong }
  }

  it('the Pine document off the listing: no bar served wrong, and bars ARE served', () => {
    const { served, wrong } = tally(VAR_DOC)
    expect(wrong).toBe(0)
    expect(served).toBeGreaterThan(300)
  })

  it('CONTROL — the oracle can fail: without the var-origin declaration the same window serves wrong bars', () => {
    const { wrong } = tally({ tf: 'D', barIndexAbsolute: true })
    expect(wrong).toBeGreaterThan(60)
  })
})

describe('⭐ r1 — the three shapes the first probe let through (review VAR-OFF N1 / N2 / N3)', () => {
  it('a three-state latch read only in its test: probed from EVERY state it takes, its absorbing middle included', () => {
    // r == 1 absorbs; it was entered at bar ~22 (close < 94) and never left on TradingView.
    const c = col('a latch read only in its test')
    let lastEntry = -1
    for (let i = 0; i < N; i++) if (BARS[i].c < 94) lastEntry = i
    // served (as 1, TradingView's value) only while the window still holds that entry
    for (let i = 250; i < N; i++) expect(c[i], `bar ${i}`).toBe(i - 250 < lastEntry ? 1 : null)
    expect(codes('a latch read only in its test')).toEqual(['var-origin:bars'])
  })

  it('CONTROL — a number the update compares a PRICE with is no state: the direction stays served', () => {
    // ⚰️ seeded with every number in the update, the direction matched neither test at
    // 1.2, held it, and was withheld (633 RIGHT bars on two SuperTrend scripts, census r1)
    expect(codes('a direction with a threshold factor')).toEqual([])
    expect(nulls('a direction with a threshold factor')).toBe(250)
  })

  it('CONTROL — a far seed is graded against ITS OWN distance: a contraction past a rare hold stays served', () => {
    // ~0.9^230 x 1e12 (about 30) is left from a far seed: within 1e-6 of that seed's distance,
    // and far outside 1e-6 of 1 — graded against a fixed distance it would be withheld
    expect(codes('a contraction past a rare hold')).toEqual([])
    expect(nulls('a contraction past a rare hold')).toBe(250)
  })

  it('CONTROL — an arm an input switches off is no path: the direction it never takes is no seed (keltner `out19`)', () => {
    expect(codes('a direction whose levels an input turns off')).toEqual([])
    expect(nulls('a direction whose levels an input turns off')).toBe(250)
  })

  it('…and gated by the INPUT itself (not folded to `na`, as keltner reaches the door) it is served the same', () => {
    const gate = (x) => {
      if (x && x.type === 'op' && x.name === '/' && Array.isArray(x.args) && x.args.every((a) => a && a.type === 'num' && a.value === 0)) {
        return { type: 'op', name: '?:', args: [{ type: 'series', name: 'jz' },
          { type: 'offset', value: 1, args: [{ type: 'series', name: 'close' }] }, x] }
      }
      return x && Array.isArray(x.args) ? { ...x, args: x.args.map(gate) } : x
    }
    const c = kase('a direction whose levels an input turns off')
    const sink = new Map()
    const got = Array.from(interpret(gate(c.ast), BARS, { jz: 0 }, undefined, undefined, { ...VAR_DOC, chartClockSink: sink }))
    expect(got.map(Number.isNaN)).toEqual(c.expected.map((v) => v === null))
    expect([...sink.keys()]).toEqual([])
  })

  // ⭐ r3 (review VAR-OFF P4) — an `||` is NOT an `&&`. The translator folds `r == 1 or bz` with
  // `bz` off to `r == 1` before this lane sees it, so the `||` a saved or bound document can
  // carry is built here: the latch's test, `or` an input.
  const orGate = (ast) => {
    const body = ast.args[1]
    return { ...ast, args: [ast.args[0], { ...body, args: [{ type: 'op', name: '||', args: [body.args[0],
      { type: 'series', name: 'bz' }] }, ...body.args.slice(1)] }, ...ast.args.slice(2)] }
  }
  const runOr = (bz) => {
    const sink = new Map()
    const got = Array.from(interpret(orGate(kase('a latch read only in its test').ast), BARS, { bz }, undefined, undefined,
      { ...VAR_DOC, chartClockSink: sink })).map((x) => (Number.isNaN(x) ? null : x))
    return { got, codes: [...sink.keys()] }
  }
  it('⭐ r3 — `r == 1 || <an input that is off>` IS `r == 1`: still a probe case, withheld exactly as the plain latch', () => {
    const { got, codes: named } = runOr(0)
    expect(got).toEqual(col('a latch read only in its test'))
    expect(named).toEqual(['var-origin:bars'])
  })
  it('…and `|| <an input that is on>` is TRUE on every bar: `r` is 1 everywhere, and served past the warm-up', () => {
    const { got, codes: named } = runOr(1)
    expect(got.slice(250)).toEqual(new Array(N - 250).fill(1))
    expect(named).toEqual([])
  })

  it('a state-gated hold is probed from far seeds as well, and is withheld where its state may lie outside', () => {
    expect(nulls('a state-gated hold')).toBe(N)
    expect(codes('a state-gated hold')).toEqual(['var-origin:bars'])
  })

  it('a hold beside an admitted contraction keeps ~0.94^125 of its seed — above the residual, withheld', () => {
    expect(nulls('a hold beside a contraction')).toBe(N)
    expect(codes('a hold beside a contraction')).toEqual(['var-origin:bars'])
  })

  it('the pass memo answers a recurrence only for ITSELF (review VAR-OFF N4: one answer per recurrence per pass)', () => {
    // one pass, one memo, two different `var`s: each keeps its own withheld bars
    const crossMemo = new Map()
    const one = (key) => Array.from(interpret(kase(key).ast, BARS, {}, undefined, undefined, { ...VAR_DOC, crossMemo }))
      .map((x) => (Number.isNaN(x) ? null : x))
    expect(one('var set on a rare bar')).toEqual(col('var set on a rare bar'))
    expect(one('var set on a frequent bar')).toEqual(col('var set on a frequent bar'))
    expect(one('a latch read only in its test')).toEqual(col('a latch read only in its test'))
    expect([...crossMemo.keys()].filter((k) => typeof k === 'string' && k.startsWith('varorigin')).length).toBe(3)
  })

  it('a `var` read on other bars (`sym` / `tf`) is withheld whole: no window here describes those bars', () => {
    const acc = kase('var set on a frequent bar').ast
    for (const type of ['sym', 'tf']) {
      const tree = { type, value: type === 'sym' ? 'QQQ' : 'W', args: [acc] }
      const sink = new Map()
      const m = varOriginMask(tree, BARS, {}, undefined, undefined, { ...VAR_DOC, chartClockSink: sink })
      expect(Array.from(m).every((v) => v === 1), type).toBe(true)
      expect([...sink.keys()], type).toEqual(['var-origin:window'])
    }
  })
})

describe('⭐ r1 — THE REVIEWER\'S ORACLE SHAPE: a rally to 200, then a 95–105 range; truth from the listing', () => {
  // The bars and trees live in the parity fixture (`rally`, written by `barIndexShift.test.js`),
  // so the Python lane is held to the same answers.
  const { bars: RALLY, from: FROM, cases: RCASES } = PARITY.rally
  const tally = (opts) => {
    let served = 0
    let wrong = 0
    for (const { ast } of RCASES) {
      const truth = Array.from(interpret(ast, RALLY, {}, undefined, undefined, { ...VAR_DOC, historyFromListing: true })).slice(FROM)
      const ours = Array.from(interpret(ast, RALLY.slice(FROM), {}, undefined, undefined, opts))
      for (let i = 0; i < ours.length; i++) {
        if (Number.isNaN(ours[i])) continue
        served += 1
        if (!(Math.abs(ours[i] - truth[i]) <= 1e-9 * Math.max(1, Math.abs(truth[i])))) wrong += 1
      }
    }
    return { served, wrong }
  }
  it('six trees, 600 bars each', () => {
    expect(RCASES.length).toBe(6)
    expect(RALLY.length - FROM).toBe(600)
  })
  it('no bar of the six is served wrong', () => {
    expect(tally(VAR_DOC).wrong).toBe(0)
  })
  it('CONTROL — without the declaration the window serves them wrong (350 bars each)', () => {
    expect(tally({ tf: 'D', barIndexAbsolute: true }).wrong).toBeGreaterThanOrEqual(6 * 350)
  })
})

describe('the declaration, the codes and the one tolerance', () => {
  it('a Pine document declares it; nothing else does; `barIndexFromFirstBar` does not lift it', () => {
    const pine = { meta: { recurrenceOrigin: PINE_RECURRENCE_ORIGIN } }
    expect(varOriginAbsoluteFor(pine)).toBe(true)
    expect(varOriginAbsoluteFor({ meta: {} })).toBe(false)
    expect(varOriginAbsoluteFor(null)).toBe(false)
    expect(barIndexAbsoluteFor(pine, { barIndexFromFirstBar: true })).toBe(false)
    expect(varOriginAbsoluteFor(pine, { barIndexFromFirstBar: true })).toBe(true)
  })

  it('each code holds a sentence; only `var-origin:window` is whole', () => {
    for (const code of ['var-origin:window', 'var-origin:bars', 'bar-index:first-bar']) {
      expect(typeof CHART_CLOCK_WITHHELD[code]('D')).toBe('string')
    }
    expect(CHART_CLOCK_WHOLE).toContain('var-origin:window')
    expect(CHART_CLOCK_WHOLE).not.toContain('var-origin:bars')
    expect(CHART_CLOCK_WHOLE).not.toContain('bar-index:first-bar')
  })

  it('the translator admits a contraction on the very tolerance the mask grades with', () => {
    expect(PINE_TOLERANCE).toBe(SEED_RESIDUAL_TOLERANCE)
  })

  it('the mask asks nothing of a document that does not declare it, or from the listing', () => {
    const t = kase('var first time').ast
    expect(varOriginMask(t, BARS, {}, undefined, undefined, { tf: 'D' })).toBeNull()
    expect(varOriginMask(t, BARS, {}, undefined, undefined, { ...VAR_DOC, historyFromListing: true })).toBeNull()
    expect(Array.from(varOriginMask(t, BARS, {}, undefined, undefined, VAR_DOC)).every((m) => m === 1)).toBe(true)
  })
})
