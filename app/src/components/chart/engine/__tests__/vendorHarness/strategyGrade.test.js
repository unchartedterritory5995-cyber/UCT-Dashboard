// W9-T2: the strategy grade (design 5.2 E), pure. Every rule has a fixture and a control.
import { describe, it, expect } from 'vitest'
import { gradeStrategy, STRATEGY_FLOOR } from '../../../../../../../tools/vendor_harness/compare.mjs'

const T0 = 1_700_000_000
const DAY = 86400
const mkTrades = (n, { shift = 0, idxOffset = 0 } = {}) => Array.from({ length: n }, (_, i) => ({
  entryTime: T0 + (i * 10 + shift) * DAY,
  exitTime: T0 + (i * 10 + 5 + shift) * DAY,
  direction: 'long',
  entryPrice: 100 + i,
  exitPrice: 103 + i,
  qty: 10 + i,
  profit: 30 + i * 10,
  barIndex: i * 10 + idxOffset,
  rule: `R-${i}`,
}))
const mkBars = (n = 60) => Array.from({ length: n }, (_, i) => ({
  time: T0 + i * DAY, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 + i,
}))

/** `ours` whose `trades` accessor is a spy. */
const spyOurs = (trades, extra = {}) => {
  const calls = { n: 0 }
  const o = { ...extra }
  Object.defineProperty(o, 'trades', { get() { calls.n += 1; return trades } })
  return { ours: o, calls }
}

const base = (refN, oursTrades, over = {}) => {
  const bars = mkBars()
  const { ours, calls } = spyOurs(oursTrades)
  return {
    calls,
    args: { reference: { trades: mkTrades(refN) }, ours, tick: 0.01, span: { from: T0, to: T0 + 1000 * DAY }, refBars: bars, ourBars: bars.map((b) => ({ ...b })), ...over },
  }
}

describe('step 0: the reference floor reads TradingView alone', () => {
  it('floor is five', () => expect(STRATEGY_FLOOR).toBe(5))

  it('reference 6, ours 2: DIVERGE (the floor is never applied to our count)', () => {
    const { args } = base(6, mkTrades(2))
    const g = gradeStrategy(args)
    expect(g.verdict).toBe('DIVERGE')
    expect(g.reason).toMatch(/counts differ/)
    expect(g.first).toEqual({ time: T0 + 20 * DAY, rule: 'R-2' })
  })

  it('reference 6, ours 9: DIVERGE naming our first unmatched fill', () => {
    const { args } = base(6, mkTrades(9))
    const g = gradeStrategy(args)
    expect(g.verdict).toBe('DIVERGE')
    expect(g.first.time).toBe(T0 + 60 * DAY)
  })

  it('reference 2, ours 6: UNGRADABLE, and our count is never read (spy)', () => {
    const { args, calls } = base(2, mkTrades(6))
    const g = gradeStrategy(args)
    expect(g.verdict).toBe('UNGRADABLE')
    expect(g.step).toBe(0)
    expect(calls.n).toBe(0)
  })

  it.each([[0, 0], [4, 4]])('reference %i, ours %i: UNGRADABLE', (r, o) => {
    const { args, calls } = base(r, mkTrades(o))
    expect(gradeStrategy(args).verdict).toBe('UNGRADABLE')
    expect(calls.n).toBe(0)
  })

  it('reference 5, ours 5, all equal: MATCH', () => {
    const { args } = base(5, mkTrades(5))
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'MATCH', step: 4 })
  })

  it('a reference with no trade list is INCONCLUSIVE, not a floor verdict', () => {
    expect(gradeStrategy({ reference: {}, ours: {} }).verdict).toBe('INCONCLUSIVE')
  })
})

describe('step 1: refusals', () => {
  it('an expected refusal is EXPECTED-REFUSAL, never DIVERGE', () => {
    const { args } = base(6, [], { })
    args.ours = { refusal: { rule: 'runtime:strategy-barstate', expected: true } }
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'EXPECTED-REFUSAL', rule: 'runtime:strategy-barstate' })
  })
  it('any other refusal against a TradingView value is DIVERGE', () => {
    const { args } = base(6, [])
    args.ours = { refusal: { rule: 'runtime:strategy-unpinned', expected: false } }
    expect(gradeStrategy(args).verdict).toBe('DIVERGE')
  })
  it('a refusal is checked only after the floor: a below-floor reference is UNGRADABLE', () => {
    const { args } = base(3, [])
    args.ours = { refusal: { rule: 'x', expected: true } }
    expect(gradeStrategy(args).verdict).toBe('UNGRADABLE')
  })
})

describe('step 2: bars and settings', () => {
  it('bars differ gives INCONCLUSIVE', () => {
    const { args } = base(5, mkTrades(5))
    args.ourBars[7] = { ...args.ourBars[7], close: 999 }
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    expect(gradeStrategy(args).reason).toMatch(/bars differ/)
  })
  it('a sub-tick bar difference is identical to the tick', () => {
    const { args } = base(5, mkTrades(5))
    args.ourBars[7] = { ...args.ourBars[7], close: args.ourBars[7].close + 0.004 }
    expect(gradeStrategy(args).verdict).toBe('MATCH')
  })
  it('missing bars on a side is INCONCLUSIVE', () => {
    const { args } = base(5, mkTrades(5), { ourBars: undefined })
    expect(gradeStrategy(args).verdict).toBe('INCONCLUSIVE')
  })
  it('a script with NO literal settings (nothing-compared) is NOT blocked by the settings check', () => {
    const { args } = base(5, mkTrades(5), {
      settings: { verdict: 'INCONCLUSIVE', reason: 'strategy-settings:nothing-compared (x)', compared: 0, disagreements: [] },
    })
    expect(gradeStrategy(args).verdict).toBe('MATCH')
  })
  it('a real settings disagreement blocks', () => {
    const { args } = base(5, mkTrades(5), {
      settings: { verdict: 'INCONCLUSIVE', reason: null, compared: 2, disagreements: [{ key: 'initial_capital' }] },
    })
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
  })
  it('no strategy() declaration blocks', () => {
    const { args } = base(5, mkTrades(5), {
      settings: { verdict: 'INCONCLUSIVE', reason: 'strategy-settings:no-declaration (y)', compared: 0, disagreements: [] },
    })
    expect(gradeStrategy(args).verdict).toBe('INCONCLUSIVE')
  })
})

describe('step 3: signal identity (method b only)', () => {
  const sig = (v) => ({ ema: Array.from({ length: 40 }, (_, i) => ({ time: T0 + i * DAY, value: v + i })) })
  it('a diverged seed inside [X, Y) is INCONCLUSIVE "warm-up has not converged"', () => {
    const { args } = base(5, mkTrades(5), { method: 'b', graded: { from: T0, to: T0 + 1000 * DAY }, refSignals: sig(1), ourSignals: sig(1.5) })
    const g = gradeStrategy(args)
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 3 })
    expect(g.reason).toMatch(/warm-up has not converged/)
  })
  it('identical plots pass; method (a) never consults them', () => {
    const b = base(5, mkTrades(5), { method: 'b', graded: { from: T0, to: T0 + 1000 * DAY }, refSignals: sig(1), ourSignals: sig(1) })
    expect(gradeStrategy(b.args).verdict).toBe('MATCH')
    const a = base(5, mkTrades(5), { method: 'a', refSignals: sig(1), ourSignals: sig(9) })
    expect(gradeStrategy(a.args).verdict).toBe('MATCH')
  })
})

describe('step 4: trades and values', () => {
  it('joins on bar time, never bar index (a method (b) fixture offset by 1,000 bars still matches)', () => {
    const ours = mkTrades(5, { idxOffset: 1000 })
    const { args } = base(5, ours, { method: 'b', graded: { from: T0, to: T0 + 1000 * DAY },
      refSignals: { s: [{ time: T0, value: 1 }] }, ourSignals: { s: [{ time: T0, value: 1 }] } })
    expect(gradeStrategy(args).verdict).toBe('MATCH')
  })
  it.each([['entryPrice', 5], ['exitPrice', 5], ['qty', 1], ['profit', 1]])('a differing %s is DIVERGE naming the rule', (field, d) => {
    const ours = mkTrades(5)
    ours[3] = { ...ours[3], [field]: ours[3][field] + d }
    const { args } = base(5, ours)
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'DIVERGE', first: { rule: 'R-3' } })
  })
  it('an exit-time difference is DIVERGE', () => {
    const ours = mkTrades(5)
    ours[0] = { ...ours[0], exitTime: ours[0].exitTime + DAY }
    expect(gradeStrategy(base(5, ours).args).verdict).toBe('DIVERGE')
  })
  it('the same fills shifted in time (same count, no time join) are DIVERGE', () => {
    expect(gradeStrategy(base(5, mkTrades(5, { shift: 1 })).args).verdict).toBe('DIVERGE')
  })
  it('prices to the tick: a sub-tick wobble matches', () => {
    const ours = mkTrades(5)
    ours[2] = { ...ours[2], entryPrice: ours[2].entryPrice + 0.003 }
    expect(gradeStrategy(base(5, ours).args).verdict).toBe('MATCH')
  })
})
