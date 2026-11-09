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
  it('thirteen trees, each off the listing, with controls from the listing and in the formula language', () => {
    expect(KEYS.length).toBe(13)
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
