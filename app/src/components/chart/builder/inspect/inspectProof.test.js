// INSPECT A BAR, THE PLAN'S PROOF (Studio lane R5): on twenty scripts, each inspected variable
// equals the same expression plotted by hand.
//
// Each case is a script with named variables, and, per variable, THE EXPRESSION WRITTEN OUT BY HAND
// with nothing named (every earlier variable and every input substituted in). The inspected value
// comes from the panel's method (a probe copy that plots the NAME). The by-hand value comes from a
// separate script that plots the EXPRESSION. They are two different programs through the same
// engine, compared on EVERY bar of the engine's 5,000-bar reference series: the same number, or
// empty on the same bars.
//
// A by-hand expression that is a bare number is compared with that number (the engine draws no
// column for a constant, which is why the panel asks for those in a second form).
import { describe, it, expect } from 'vitest'
import { names, build, computeFor } from './inspectDoors'
import { inspectScript, probeTitle } from './barInspection'
import { referenceBars } from '../../engine/referenceSeries.js'

const BARS = referenceBars()
const compute = computeFor({ tf: 'D', sym: 'TEST' })
const script = (title, body, overlay = false) => [
  '//@version=6', `indicator("${title}"${overlay ? ', overlay=true' : ''})`, ...body,
].join('\n')

/** [title, script body lines, { variable: expression by hand }] */
const CASES = [
  ['Two averages', ['fast = ta.sma(close, 10)', 'slow = ta.sma(close, 50)', 'spread = fast - slow', 'plot(spread)'],
    { fast: 'ta.sma(close, 10)', slow: 'ta.sma(close, 50)', spread: 'ta.sma(close, 10) - ta.sma(close, 50)' }],
  ['RSI and its signal', ['len = input.int(14, "Length")', 'r = ta.rsi(close, len)', 'sig = ta.sma(r, 5)', 'plot(r)', 'plot(sig)'],
    { len: '14', r: 'ta.rsi(close, 14)', sig: 'ta.sma(ta.rsi(close, 14), 5)' }],
  ['Exponential pair', ['e1 = ta.ema(close, 12)', 'e2 = ta.ema(close, 26)', 'gap = e1 - e2', 'plot(gap)'],
    { e1: 'ta.ema(close, 12)', e2: 'ta.ema(close, 26)', gap: 'ta.ema(close, 12) - ta.ema(close, 26)' }],
  ['Bands', ['basis = ta.sma(close, 20)', 'dev = ta.stdev(close, 20)', 'upper = basis + 2 * dev', 'lower = basis - 2 * dev', 'plot(upper)', 'plot(lower)'],
    { basis: 'ta.sma(close, 20)', dev: 'ta.stdev(close, 20)', upper: 'ta.sma(close, 20) + 2 * ta.stdev(close, 20)', lower: 'ta.sma(close, 20) - 2 * ta.stdev(close, 20)' }],
  ['Range position', ['hi = ta.highest(high, 20)', 'lo = ta.lowest(low, 20)', 'pos = (close - lo) / (hi - lo)', 'plot(pos)'],
    { hi: 'ta.highest(high, 20)', lo: 'ta.lowest(low, 20)', pos: '(close - ta.lowest(low, 20)) / (ta.highest(high, 20) - ta.lowest(low, 20))' }],
  ['Average true range', ['a = ta.atr(14)', 'pct = a / close * 100', 'plot(pct)'],
    { a: 'ta.atr(14)', pct: 'ta.atr(14) / close * 100' }],
  ['Rate of change', ['n = input.int(10)', 'roc = (close - close[n]) / close[n] * 100', 'plot(roc)'],
    { n: '10', roc: '(close - close[10]) / close[10] * 100' }],
  ['Volume against its average', ['av = ta.sma(volume, 50)', 'rel = volume / av', 'plot(rel)'],
    { av: 'ta.sma(volume, 50)', rel: 'volume / ta.sma(volume, 50)' }],
  ['Up day', ['up = close > open', 'body = math.abs(close - open)', 'plot(body)'],
    { up: 'close > open', body: 'math.abs(close - open)' }],
  ['Typical price', ['tp = (high + low + close) / 3', 'm = ta.sma(tp, 20)', 'd = tp - m', 'plot(d)'],
    { tp: '(high + low + close) / 3', m: 'ta.sma((high + low + close) / 3, 20)', d: '(high + low + close) / 3 - ta.sma((high + low + close) / 3, 20)' }],
  ['Weighted averages', ['w = ta.wma(close, 15)', 'v = ta.vwma(close, 15)', 'diff = w - v', 'plot(diff)'],
    { w: 'ta.wma(close, 15)', v: 'ta.vwma(close, 15)', diff: 'ta.wma(close, 15) - ta.vwma(close, 15)' }],
  ['One-bar change', ['ch = ta.change(close)', 'pc = ch / close[1] * 100', 'plot(pc)'],
    { ch: 'ta.change(close)', pc: 'ta.change(close) / close[1] * 100' }],
  ['Distance from a long average', ['ma = ta.sma(close, 200)', 'dist = (close - ma) / ma * 100', 'plot(dist)'],
    { ma: 'ta.sma(close, 200)', dist: '(close - ta.sma(close, 200)) / ta.sma(close, 200) * 100' }],
  ['Daily range', ['rng = high - low', 'avg = ta.sma(rng, 20)', 'ratio = rng / avg', 'plot(ratio)'],
    { rng: 'high - low', avg: 'ta.sma(high - low, 20)', ratio: '(high - low) / ta.sma(high - low, 20)' }],
  ['Greater of two', ['a = ta.sma(close, 5)', 'b = ta.sma(close, 30)', 'top = math.max(a, b)', 'bot = math.min(a, b)', 'plot(top - bot)'],
    { a: 'ta.sma(close, 5)', b: 'ta.sma(close, 30)', top: 'math.max(ta.sma(close, 5), ta.sma(close, 30))', bot: 'math.min(ta.sma(close, 5), ta.sma(close, 30))' }],
  ['Above its average', ['m = ta.ema(close, 21)', 'above = close > m', 'plot(m)'],
    { m: 'ta.ema(close, 21)', above: 'close > ta.ema(close, 21)' }],
  ['A choice', ['m = ta.sma(close, 20)', 'pick = close > m ? high : low', 'plot(pick)'],
    { m: 'ta.sma(close, 20)', pick: 'close > ta.sma(close, 20) ? high : low' }],
  ['Gap', ['g = open - close[1]', 'gp = g / close[1] * 100', 'plot(gp)'],
    { g: 'open - close[1]', gp: '(open - close[1]) / close[1] * 100' }],
  ['Multiples', ['k = 2.5', 'a = ta.atr(10)', 'stop = close - k * a', 'plot(stop)'],
    { k: '2.5', a: 'ta.atr(10)', stop: 'close - 2.5 * ta.atr(10)' }],
  ['Midpoint of a channel', ['len = input.int(55)', 'mid = (ta.highest(high, len) + ta.lowest(low, len)) / 2', 'off = close - mid', 'plot(off)'],
    { len: '55', mid: '(ta.highest(high, 55) + ta.lowest(low, 55)) / 2', off: 'close - (ta.highest(high, 55) + ta.lowest(low, 55)) / 2' }],
]

const NUMBER = /^-?\d+(\.\d+)?$/
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

describe('twenty scripts: each inspected variable equals its expression plotted by hand, on every bar', () => {
  it('there are twenty, and the reference series is the engine\'s 5,000 bars', () => {
    expect(CASES).toHaveLength(20)
    expect(BARS).toHaveLength(5000)
  })

  for (const [title, body, byHand] of CASES) {
    it(title, async () => {
      const source = script(title, body)
      // the panel's method
      const got = await inspectScript({ source, bars: BARS, names, build, compute })
      expect(got.ok, got.reason).toBe(true)
      expect(got.failed).toEqual([])
      expect(got.probes.map((p) => p.name).sort()).toEqual(Object.keys(byHand).sort())   // every name, nothing else
      expect(got.laneDiffers).toBe(false)

      // the same expressions, written out by hand, as their own script
      const exprs = Object.entries(byHand).filter(([, e]) => !NUMBER.test(e))
      const hand = await build(script(`${title} by hand`, exprs.map(([name, e]) => `plot(${e}, title="hand ${name}")`)))
      expect(hand.ok, hand.reason).toBe(true)
      const handOut = compute(hand.definition, BARS)
      expect(Array.isArray(handOut.outputs), handOut.reason).toBe(true)
      const byTitle = Object.fromEntries(handOut.outputs.map((o) => [o.title, o.values]))

      for (const [name, expr] of Object.entries(byHand)) {
        const mine = got.columns[probeTitle(name)]
        expect(mine, name).toBeDefined()
        expect(mine.length, name).toBe(BARS.length)
        let bad = -1
        let filled = 0
        if (NUMBER.test(expr)) {
          const want = Number(expr)
          for (let i = 0; i < mine.length && bad === -1; i += 1) { if (mine[i] !== want) bad = i; else filled += 1 }
        } else {
          const want = byTitle[`hand ${name}`]
          expect(want, `by hand: ${name}`).toBeDefined()
          for (let i = 0; i < mine.length && bad === -1; i += 1) {
            if (!same(mine[i], want[i])) bad = i
            else if (!Number.isNaN(mine[i])) filled += 1
          }
        }
        expect(bad, `${title}: ${name} differs from its by-hand expression at bar ${bad}`).toBe(-1)
        expect(filled, `${title}: ${name} never has a value, so the comparison would prove nothing`).toBeGreaterThan(4000)
      }
    })
  }

  it('CONTROL: a by-hand expression that is NOT the variable\'s is caught', async () => {
    const source = script('Control', ['fast = ta.sma(close, 10)', 'plot(fast)'])
    const got = await inspectScript({ source, bars: BARS, names, build, compute })
    const hand = compute((await build(script('Control by hand', ['plot(ta.sma(close, 11), title="hand fast")']))).definition, BARS)
    const want = hand.outputs.find((o) => o.title === 'hand fast').values
    const mine = got.columns[probeTitle('fast')]
    let differs = 0
    for (let i = 0; i < mine.length; i += 1) if (!same(mine[i], want[i])) differs += 1
    expect(differs).toBeGreaterThan(4000)
  })
})
