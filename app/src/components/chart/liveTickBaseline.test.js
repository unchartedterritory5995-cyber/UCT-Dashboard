// ⭐ INVARIANT (2026-11-11): no live-tick acceptance decision for symbol B ever reads a
// baseline belonging to symbol A. The chart's baseline refs outlive a symbol switch (the
// server close was never reset), so before this module every switch between names >50%
// apart in price judged B's first prices against A's close: B's today-seed was refused and
// B's first live ticks were dropped.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isSaneLivePrice, isSaneLivePriceFor, baselinesFor } from './liveTickBaseline'

// Deterministic PRNG so a failure names a reproducible sequence.
function rng(seed) {
  let x = seed >>> 0
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32 }
}
const RATIOS = [0.05, 0.1, 0.3, 0.6, 1, 1.7, 4, 10, 25]

/**
 * A model of the chart's per-symbol state as StockChart drives it on a switch:
 *   - lastBar/lastBarSym: the painted developing bar, cleared on switch, stamped at paint;
 *   - serverClose/serverCloseSym: the last clean server close, stamped at paint, NEVER
 *     cleared on switch (the exact shape that leaked);
 *   - ownClose: the new symbol's own cached close, available before it paints.
 * Ticks for the new symbol are judged in the window BEFORE it paints and after.
 */
function runSequence(seed) {
  const r = rng(seed)
  const state = { lastBar: null, lastBarSym: null, serverClose: null, serverCloseSym: null }
  const prices = {}
  const decisions = []
  for (let step = 0; step < 40; step++) {
    const sym = `S${Math.floor(r() * 6)}`
    // Each symbol trades at its own level, 0.05x..25x apart from the others.
    if (!(sym in prices)) prices[sym] = 100 * RATIOS[Math.floor(r() * RATIOS.length)]
    const own = prices[sym]
    // Switch: the painted bar is cleared; the server close is left behind (as in the chart).
    state.lastBar = null; state.lastBarSym = null
    // Ticks BEFORE the new symbol paints (seed / first live ticks): within 10% of its level.
    for (let k = 0; k < 3; k++) {
      const p = own * (0.9 + r() * 0.2)
      decisions.push({ sym, p, ok: isSaneLivePriceFor(sym, p, { ...state, ownClose: own }), before: true })
    }
    // Paint: the server answers, both baselines become this symbol's.
    state.serverClose = own; state.serverCloseSym = sym
    state.lastBar = { close: own }; state.lastBarSym = sym
    for (let k = 0; k < 3; k++) {
      const p = own * (0.9 + r() * 0.2)
      decisions.push({ sym, p, ok: isSaneLivePriceFor(sym, p, state), before: false })
    }
    // A genuine phantom for this symbol is still rejected, before or after paint.
    decisions.push({ sym, p: own * 100, ok: isSaneLivePriceFor(sym, own * 100, state), phantom: true })
  }
  return decisions
}

describe('live-tick baseline is keyed to the symbol', () => {
  it('INVARIANT: across 200 switch sequences (0.05x..25x), every plausible tick for B is accepted and every 100x phantom rejected — whatever A traded at', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const d of runSequence(seed)) {
        if (d.phantom) expect(d.ok, `seed ${seed}: phantom accepted for ${d.sym}`).toBe(false)
        else expect(d.ok, `seed ${seed}: plausible ${d.before ? 'pre-paint' : 'post-paint'} tick for ${d.sym} rejected`).toBe(true)
      }
    }
  })

  it('a baseline stamped with another symbol is never returned', () => {
    for (const ratio of RATIOS) {
      const b = baselinesFor('B', { lastBar: { close: 100 * ratio }, lastBarSym: 'A', serverClose: 100 * ratio, serverCloseSym: 'A' })
      expect(b).toEqual({ lastClose: null, serverClose: null })
    }
    expect(baselinesFor('b', { lastBar: { close: 7 }, lastBarSym: 'B', serverClose: 8, serverCloseSym: 'B' }))
      .toEqual({ lastClose: 7, serverClose: 8 })
    // Before B paints, B's own cached close stands in for the server close.
    expect(baselinesFor('B', { serverClose: 500, serverCloseSym: 'A', ownClose: 20 })).toEqual({ lastClose: null, serverClose: 20 })
  })

  it('the plausibility rule itself is unchanged (DDOG 100x)', () => {
    expect(isSaneLivePrice(20798, 207.98, 207.98)).toBe(false)
    expect(isSaneLivePrice(210, 207.98, 207.98)).toBe(true)
    expect(isSaneLivePrice(0, null, null)).toBe(false)
    expect(isSaneLivePrice(NaN, null, null)).toBe(false)
  })

  it('negative control: judging B against A\'s baselines (the old wiring) rejects B — the invariant can fail', () => {
    // A at 500, B at 20: the pre-fix call read A's closes for B's tick.
    expect(isSaneLivePrice(20, 500, 500)).toBe(false)
    expect(isSaneLivePriceFor('B', 20, { lastBar: { close: 500 }, lastBarSym: 'A', serverClose: 500, serverCloseSym: 'A', ownClose: 20 })).toBe(true)
  })
})

// ⛔ RAIL: StockChart reaches the rule ONLY through the symbol-keyed helper. A direct call,
// or an inline `> 0.5` copy reading a baseline ref, is how a path drifts back to reading the
// previous symbol's close.
describe('StockChart wiring', () => {
  const src = readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
  it('has no direct isSaneLivePrice( call — every site uses _liveSane(sym, ...)', () => {
    expect(src).not.toMatch(/\bisSaneLivePrice\(/)
    expect((src.match(/_liveSane\(/g) || []).length).toBeGreaterThanOrEqual(10)
  })
  it('reads the server-close baseline only inside _liveSane (plus its one stamped write)', () => {
    const reads = src.split('\n').filter((l) => /lastServerCloseRef\.current/.test(l) && !/^\s*\/\//.test(l))
    expect(reads.map((l) => l.trim())).toEqual([
      'serverClose: lastServerCloseRef.current,',
      expect.stringMatching(/lastServerCloseRef\.current = last\.c; lastServerCloseSymRef\.current = sym/),
    ])
  })
  it('has no inline 50% bound against lastBarRef', () => {
    expect(src).not.toMatch(/lastBarRef\.current\?\.close[\s\S]{0,120}>\s*0\.5/)
  })
})
