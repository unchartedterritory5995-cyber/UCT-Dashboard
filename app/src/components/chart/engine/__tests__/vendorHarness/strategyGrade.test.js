// W9-T2: the strategy grade (design 5.2 E), pure. Every rule has a fixture and a control.
import { describe, it, expect } from 'vitest'
import { gradeStrategy, STRATEGY_FLOOR, strategyFirstDifference } from '../../../../../../../tools/vendor_harness/compare.mjs'

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

// ─── U14 step 5: fills, fill by fill ──────────────────────────────────────────
describe('step 5: fills (U14)', () => {
  // one entry and one exit fill per trade, at the trade's own bar times
  const fillsOf = (trades) => trades.flatMap((t) => [
    { time: t.entryTime, side: 'buy', role: 'entry', price: t.entryPrice, qty: t.qty, id: 'L', labelled: true, rule: t.rule },
    { time: t.exitTime, side: 'sell', role: 'exit', price: t.exitPrice, qty: t.qty, id: 'XL', labelled: true, rule: t.rule },
  ])
  const withFills = (refFills, ourFills, over = {}) => {
    const { args } = base(5, mkTrades(5))
    args.reference = { trades: mkTrades(5), fills: refFills, fillsTimed: true, fillsReason: null, ...over }
    const ours = args.ours
    Object.defineProperty(ours, 'fills', { value: ourFills, enumerable: true })
    return args
  }
  const F = () => fillsOf(mkTrades(5))

  it('equal fills: MATCH, and the grade says it covered the fills', () => {
    expect(gradeStrategy(withFills(F(), F()))).toMatchObject({ verdict: 'MATCH', step: 5, graded: { trades: true, fills: true } })
  })
  it('without a reference fill list the MATCH says it did NOT cover fills (resolve_pins never pins from it)', () => {
    const { args } = base(5, mkTrades(5))
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'MATCH', step: 4, graded: { fills: false } })
  })
  it.each([
    ['a quantity', (f) => { f[3].qty += 1 }],
    ['a price beyond the tick', (f) => { f[2].price += 0.05 }],
    ['a side', (f) => { f[4].side = 'sell' }],
    ['a role', (f) => { f[5].role = 'order' }],
    ['an extra fill', (f) => { f.push({ ...f[0], time: f[0].time + 3 * 86400 }) }],
    ['a missing fill', (f) => { f.splice(6, 1) }],
    ['an id', (f) => { f[1].id = 'XS' }],
  ])('⛔ the same trades with %s differing in OUR fills is DIVERGE at step 5', (_n, mutate) => {
    const ours = F()
    mutate(ours)
    expect(gradeStrategy(withFills(F(), ours))).toMatchObject({ verdict: 'DIVERGE', step: 5 })
  })
  it('one exit of 10 on one side and two of 4 + 6 on the other at that bar and price are the same fill fact', () => {
    const split = (q1, q2) => { const r = F(); r.splice(1, 1, { ...r[1], qty: q1 }, { ...r[1], qty: q2 }); return r }
    expect(gradeStrategy(withFills(split(4, 6), F()))).toMatchObject({ verdict: 'MATCH', step: 5 })
    // control: 4 + 5 is not 10
    expect(gradeStrategy(withFills(split(4, 5), F()))).toMatchObject({ verdict: 'DIVERGE', step: 5 })
  })
  it('an unlabelled fill of ours (a close TradingView names itself) is not held to an id', () => {
    const ours = F().map((f, i) => (i === 1 ? { ...f, id: null, labelled: false } : f))
    expect(gradeStrategy(withFills(F(), ours)).verdict).toBe('MATCH')
  })
  it('⛔ fills that cannot be placed in time are INCONCLUSIVE, never skipped', () => {
    expect(gradeStrategy(withFills(F(), F(), { fillsTimed: false, fillsReason: 'x' }))).toMatchObject({ verdict: 'INCONCLUSIVE', step: 5 })
  })
})

describe('step 6: report slots (U14)', () => {
  const slots = (over = {}) => ({
    netProfit: { kind: 'value', reference: { status: 'ok', value: 100.5 }, ours: { status: 'served', value: 100.5 } },
    totalClosedTrades: { kind: 'count', reference: { status: 'ok', value: 5 }, ours: { status: 'served', value: 5 } },
    sharpeRatio: { kind: 'value', reference: { status: 'ok', value: 1.2 }, ours: { status: 'refused', guard: 'runtime:strategy-report-unstated' } },
    ...over,
  })
  it('the slots both sides state are compared; a slot ours refuses is listed ungraded, never compared', () => {
    const { args } = base(5, mkTrades(5))
    args.slots = () => slots()
    const g = gradeStrategy(args)
    expect(g).toMatchObject({ verdict: 'MATCH', step: 6, graded: { slots: 2 } })
    expect(g.ungradedSlots).toEqual([{ slot: 'sharpeRatio', why: 'ours runtime:strategy-report-unstated' }])
  })
  it('⛔ a stated slot that differs is DIVERGE at step 6', () => {
    const { args } = base(5, mkTrades(5))
    args.slots = slots({ totalClosedTrades: { kind: 'count', reference: { status: 'ok', value: 5 }, ours: { status: 'served', value: 6 } } })
    expect(gradeStrategy(args)).toMatchObject({ verdict: 'DIVERGE', step: 6 })
  })
})

describe('step 2: the run\'s own settings and unread inputs (U14)', () => {
  it('⛔ an effective-settings disagreement or an unread depended-on input is INCONCLUSIVE', () => {
    const a = base(5, mkTrades(5), { settings: { verdict: 'AGREE', reason: null, disagreements: [], effectiveDisagreements: [{ key: 'commission_value' }] } }).args
    expect(gradeStrategy(a)).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    const b = base(5, mkTrades(5), { settings: { verdict: 'AGREE', reason: null, disagreements: [], unreadDependedOn: ['property:slippage'] } }).args
    expect(gradeStrategy(b)).toMatchObject({ verdict: 'INCONCLUSIVE', step: 2 })
    const c = base(5, mkTrades(5), { settings: { verdict: 'AGREE', reason: null, disagreements: [], effectiveDisagreements: [], unreadDependedOn: [] } }).args
    expect(gradeStrategy(c).verdict).toBe('MATCH')
  })
})

// ─── value read-backs: step 7 (value series) and step 8 (drawn texts), pure ───────────────────────────
describe('step 7: the value series (value read-backs)', () => {
  const rows = (f) => Array.from({ length: 30 }, (_, i) => ({ time: T0 + i * DAY, value: f(i) }))
  const series = (over = {}) => [
    { title: 'S03_position_size', reference: rows((i) => (i > 10 ? 3 : 0)), ours: rows((i) => (i > 10 ? 3 : 0)) },
    { title: 'S04_position_avg_price', reference: rows((i) => (i > 10 ? 101.25 : null)), ours: rows((i) => (i > 10 ? 101.25 : null)) },
    { title: 'S08_equity', reference: rows((i) => 100000 + i * 0.1), ours: rows((i) => 100000 + i * 0.1), ...over },
  ]
  const withValues = (values, over = {}) => ({ ...base(5, mkTrades(5), over).args, values })

  it('every series equal: MATCH at step 7, and the grade says how many series it compared', () => {
    const g = gradeStrategy(withValues({ status: 'ok', series: series() }))
    expect(g).toMatchObject({ verdict: 'MATCH', step: 7, graded: { trades: true, values: 3, texts: 0 } })
    expect(g.reason).toMatch(/every value series equal bar by bar/)
  })
  it('without values the grade is the one it was (step 4), and says it compared none', () => {
    expect(gradeStrategy(base(5, mkTrades(5)).args)).toMatchObject({ verdict: 'MATCH', step: 4, graded: { values: 0, texts: 0 } })
  })
  it('⛔ one bar of one series differing is DIVERGE, naming the series, the bar and both values', () => {
    const g = gradeStrategy(withValues({ status: 'ok', series: series({ ours: rows((i) => 100000 + i * 0.1 + (i === 17 ? 0.01 : 0)) }) }))
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 7, first: { time: T0 + 17 * DAY, rule: 'B-VAL' }, graded: { values: 0 } })
    expect(g.reason.startsWith(`value series S08_equity differs at ${T0 + 17 * DAY} (reference 100001.7`)).toBe(true)
    expect(g.reason).toMatch(/, ours 100001\.7\d*\)$/)
  })
  it('a difference inside REL_TOL (float noise) is equal; `na` equals only `na`', () => {
    expect(gradeStrategy(withValues({ status: 'ok', series: series({ ours: rows((i) => (100000 + i * 0.1) * (1 + 1e-12)) }) })).verdict).toBe('MATCH')
    const na = series()
    na[1] = { ...na[1], ours: rows((i) => (i > 10 ? 101.25 : 0)) }
    expect(gradeStrategy(withValues({ status: 'ok', series: na }))).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    expect(gradeStrategy(withValues({ status: 'ok', series: na })).reason).toMatch(/S04_position_avg_price differs at \d+ \(reference na, ours 0\)/)
  })
  it('⛔ a bar of ours missing is DIVERGE (never compared on the bars that happen to exist)', () => {
    const s = series({ ours: rows((i) => 100000 + i * 0.1).slice(0, 29) })
    expect(gradeStrategy(withValues({ status: 'ok', series: s }))).toMatchObject({ verdict: 'DIVERGE', step: 7 })
  })
  it('⛔ a bar of ours TradingView does not have is DIVERGE too (the two series must cover the same bars)', () => {
    const extra = [...rows((i) => 100000 + i * 0.1), { time: T0 + 30 * DAY, value: 100003 }]
    const g = gradeStrategy(withValues({ status: 'ok', series: series({ ours: extra }) }))
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    expect(g.reason).toBe('value series S08_equity has 31 bars of ours against 30')
  })
  it('⛔ an unpaired set of plots is INCONCLUSIVE with its reason, never compared by position', () => {
    const g = gradeStrategy(withValues({ status: 'unpaired', reason: 'our run emitted 2 plot(s) and the capture holds 3' }))
    expect(g).toMatchObject({ verdict: 'INCONCLUSIVE', step: 7 })
    expect(g.reason).toBe('the value series cannot be paired: our run emitted 2 plot(s) and the capture holds 3')
  })
  it('method (b): only the bars inside the graded range are compared', () => {
    // the five reference trades close on days 5..45: the graded range holds them all, and bars 50..59 lie after it
    const graded = { from: T0, to: T0 + 50 * DAY }
    const sig = { s: [{ time: T0, value: 1 }] }
    const long = (f) => Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * DAY, value: f(i) }))
    const one = (bad) => [{ title: 'S08_equity', reference: long((i) => 100000 + i), ours: long((i) => 100000 + i + (i === bad ? 5 : 0)) }]
    const late = one(55)
    expect(gradeStrategy(withValues({ status: 'ok', series: late }, { method: 'b', graded, refSignals: sig, ourSignals: sig }))).toMatchObject({ verdict: 'MATCH', step: 7 })
    // control: the same difference on method (a), which compares every bar, is DIVERGE
    expect(gradeStrategy(withValues({ status: 'ok', series: late }))).toMatchObject({ verdict: 'DIVERGE', step: 7 })
    const early = one(7)
    expect(gradeStrategy(withValues({ status: 'ok', series: early }, { method: 'b', graded, refSignals: sig, ourSignals: sig }))).toMatchObject({ verdict: 'DIVERGE', step: 7 })
  })
  it('the values are a function read only at step 7: a trade DIVERGE never reads them', () => {
    let read = 0
    const ours = mkTrades(5)
    ours[3] = { ...ours[3], qty: 99 }
    const g = gradeStrategy({ ...base(5, ours).args, values: () => { read += 1; return { status: 'ok', series: series() } } })
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 4 })
    expect(read).toBe(0)
  })
})

describe('step 8: the drawn texts (value read-backs)', () => {
  const labels = () => [{ time: T0 + 5 * DAY, text: 'L>X:X' }, { time: T0 + 15 * DAY, text: 'L>Close position order:flat' }, { time: T0 + 15 * DAY, text: 'S>L:L' }]
  const withTexts = (texts) => ({ ...base(5, mkTrades(5)).args, texts })
  it('the same texts on the same bars (in any order within a bar): MATCH at step 8, counted', () => {
    const ours = [labels()[2], labels()[0], labels()[1]]
    expect(gradeStrategy(withTexts({ status: 'ok', reference: labels(), ours }))).toMatchObject({ verdict: 'MATCH', step: 8, graded: { texts: 3 } })
  })
  it.each([
    ['a text', (l) => { l[0].text = 'L>X:other' }],
    ['a bar', (l) => { l[0].time += DAY }],
    ['a missing text', (l) => { l.pop() }],
    ['a text twice', (l) => { l.push({ ...l[0] }) }],
  ])('⛔ %s differing is DIVERGE at step 8', (_n, mutate) => {
    const ours = labels()
    mutate(ours)
    const g = gradeStrategy(withTexts({ status: 'ok', reference: labels(), ours }))
    expect(g).toMatchObject({ verdict: 'DIVERGE', step: 8, graded: { texts: 0 } })
    expect(g.reason).toMatch(/^the drawn texts at \d+ differ/)
  })
  it('texts that could not be drawn are LISTED ungraded and the verdict keeps what it covered', () => {
    const g = gradeStrategy(withTexts({ status: 'ungraded', what: 'labels (3)', reason: 'the build that draws refused (runtime:x)' }))
    expect(g).toMatchObject({ verdict: 'MATCH', step: 4, graded: { texts: 0 } })
    expect(g.ungradedTexts).toEqual([{ what: 'labels (3)', why: 'the build that draws refused (runtime:x)' }])
  })
  it('⛔ texts that cannot be read on the reference side are INCONCLUSIVE', () => {
    expect(gradeStrategy(withTexts({ status: 'unread', reason: 'the capture carries no object x index' }))).toMatchObject({ verdict: 'INCONCLUSIVE', step: 8 })
  })
})

// ─── ruling D11: the first difference of a diverging run, and the proof that the bars before it are exact ───
describe('ruling D11: strategyFirstDifference (pure)', () => {
  const fillsOf = (trades) => trades.flatMap((t) => [
    { time: t.entryTime, side: 'buy', role: 'entry', price: t.entryPrice, qty: t.qty, id: 'L', labelled: true, rule: t.rule },
    { time: t.exitTime, side: 'sell', role: 'exit', price: t.exitPrice, qty: t.qty, id: 'XL', labelled: true, rule: t.rule },
  ])
  const bars = (f) => Array.from({ length: 60 }, (_, i) => ({ time: T0 + i * DAY, value: f(i) }))
  const world = () => {
    const trades = mkTrades(5)
    return {
      reference: { trades: mkTrades(5), fills: fillsOf(mkTrades(5)), fillsTimed: true },
      ours: { trades, fills: fillsOf(trades) },
      tick: 0.01,
      values: { status: 'ok', series: [{ title: 'S03', reference: bars((i) => i), ours: bars((i) => i) }] },
      texts: { status: 'ok', reference: [{ time: T0 + 5 * DAY, text: 'a' }, { time: T0 + 25 * DAY, text: 'b' }], ours: [{ time: T0 + 5 * DAY, text: 'a' }, { time: T0 + 25 * DAY, text: 'b' }] },
    }
  }
  const day = (n) => T0 + n * DAY

  it('two equal runs have no first difference', () => {
    expect(strategyFirstDifference(world())).toBeNull()
  })
  it('a missing fill of ours: the difference is on the bar of that fill, at step 5, and the bars before it are exact', () => {
    const w = world()
    w.ours.fills = w.ours.fills.filter((f) => !(f.time === day(25) && f.role === 'exit')) // trade 3 exits on day 25
    expect(strategyFirstDifference(w)).toEqual({ bar: day(25), step: 5, prefixExact: true })
  })
  it('the EARLIEST differing bar wins, whichever step it is on: a value on day 12 before a fill on day 25', () => {
    const w = world()
    w.ours.fills = w.ours.fills.filter((f) => !(f.time === day(25) && f.role === 'exit'))
    w.values.series[0].ours = bars((i) => (i === 12 ? 99 : i))
    expect(strategyFirstDifference(w)).toEqual({ bar: day(12), step: 7, prefixExact: true })
    const t = world()
    t.texts.ours = [{ time: day(5), text: 'DIFFERENT' }, { time: day(25), text: 'b' }]
    t.values.series[0].ours = bars((i) => (i === 12 ? 99 : i))
    expect(strategyFirstDifference(t)).toEqual({ bar: day(5), step: 8, prefixExact: true })
  })
  it('⛔ a closed trade BEFORE the difference that is not equal (a profit) makes the prefix inexact', () => {
    const w = world()
    w.ours.fills = w.ours.fills.filter((f) => !(f.time === day(25) && f.role === 'exit'))
    w.ours.trades[0] = { ...w.ours.trades[0], profit: w.ours.trades[0].profit + 1 } // trade 1 closed on day 5
    expect(strategyFirstDifference(w)).toEqual({ bar: day(25), step: 5, prefixExact: false })
    // control: the same wrong profit on a trade that closes AFTER the difference does not touch the prefix
    const c = world()
    c.ours.fills = c.ours.fills.filter((f) => !(f.time === day(25) && f.role === 'exit'))
    c.ours.trades[4] = { ...c.ours.trades[4], profit: c.ours.trades[4].profit + 1 } // closes on day 45
    expect(strategyFirstDifference(c).prefixExact).toBe(true)
  })
  it('⛔ fails closed: unpaired plots, unreadable texts or untimed reference fills never give a proven prefix', () => {
    const cut = (w) => { w.ours.fills = w.ours.fills.filter((f) => !(f.time === day(25) && f.role === 'exit')); return w }
    const unpaired = cut(world())
    unpaired.values = { status: 'unpaired', reason: 'x' }
    expect(strategyFirstDifference(unpaired)).toEqual({ bar: day(25), step: 5, prefixExact: false })
    const unread = cut(world())
    unread.texts = { status: 'unread', reason: 'x' }
    expect(strategyFirstDifference(unread).prefixExact).toBe(false)
    const untimed = cut(world())
    untimed.reference.fillsTimed = false
    expect(strategyFirstDifference(untimed)).toBeNull()
    // control: texts our run could not draw are not a graded step, so they do not break the proof
    const ungraded = cut(world())
    ungraded.texts = { status: 'ungraded', reason: 'x' }
    expect(strategyFirstDifference(ungraded)).toEqual({ bar: day(25), step: 5, prefixExact: true })
  })
  it('a difference with no bar (a profit alone) is no first difference: the strict rule applies', () => {
    const w = world()
    w.ours.trades[2] = { ...w.ours.trades[2], profit: w.ours.trades[2].profit + 1 }
    expect(strategyFirstDifference(w)).toBeNull()
  })
})
