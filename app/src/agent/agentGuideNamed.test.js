// ⭐ GUIDE SYSTEM — a walkthrough takes its chart, and its instance, from the words. Real-model findings 2026-11-05: "add
// bollinger bands to the NVDA chart" walked the AAPL chart, and "the EMA 20 line" ringed the EMA 9 row.
import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { namedChart, namesAChart } from './guide/namedChart'
import { readIndicator, stepsFor } from './guide/slots'
import { guideFeature } from './guide/registry'

beforeAll(() => { registerBuiltins() })

const chart = (ref, symbol, position, x, tf = 'D') => ({ ref, symbol, position, tf, label: `${position} chart (${symbol})`, cell: { x, y: 0, w: 1, h: 1 } })
const TWO = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
const FOUR = [chart('a', 'NVDA', 'top-left', 0), chart('b', 'AMD', 'top-right', 1), chart('c', 'TSLA', 'bottom-left', 0), chart('d', 'SPY', 'bottom-right', 1)]

describe('the chart the words name', () => {
  it.each([
    ['how would I add bollinger bands to the NVDA chart?', 'b'],
    ['how do I add rsi to nvda', 'b'],
    ['how do I change the timeframe on the left chart?', 'a'],
    ['how do I change the timeframe on the second chart', 'b'],
    ['how do I add RSI to the 5 minute chart', 'b'],
  ])('%s', (q, ref) => { expect(namedChart(q, TWO)?.chart?.ref).toBe(ref) })
  it('a position in a grid', () => {
    expect(namedChart('how do I change the timeframe on the top right chart', FOUR)?.chart?.ref).toBe('b')
  })
  it('a position that fits two charts is asked, never guessed', () => {
    expect(namedChart('how do I change the timeframe on the left chart', FOUR)?.say).toMatch(/can’t tell which chart/)
  })
  it('a chart the board does not hold is said, never swapped for another', () => {
    expect(namedChart('how do I change the timeframe on the TSLA chart', TWO)?.say).toMatch(/no TSLA chart/)
  })
  it('words that name no chart leave the clicked one standing', () => {
    for (const q of ['how do I change the timeframe', 'how do I apply a UCT chart theme', 'how do I change this chart', 'how do I use the RSI chart template']) {
      expect(namedChart(q, TWO), q).toBeNull()
    }
  })
  it('the words reach the walkthrough only when they choose something', () => {
    const fast = (raw) => getCapability('guide.show').fast({ raw, host: { surface: 'charts', charts: { list: () => TWO } } })
    expect(fast('Where do I change the timeframe?')).toEqual({ feature: 'timeframe' })
    expect(fast('where do I change the timeframe on the NVDA chart').detail).toMatch(/NVDA/)
    expect(namesAChart('where is the timeframe', TWO)).toBe(false)
  })
})

describe('the instance the words name', () => {
  it.each([
    ['change the colour of the EMA 20 line', 'EMA 20'],
    ['the 20 EMA', 'EMA 20'],
    ['the 20-day EMA', 'EMA 20'],
    ['ema(20)', 'EMA 20'],
    ['the 200 SMA', 'SMA 200'],
    ['the EMA', 'EMA'],
  ])('%s → %s', (q, label) => { expect(readIndicator(q).label).toBe(label) })
  it('the title and the row name that instance', () => {
    const steps = stepsFor(guideFeature('indicatorColor'), 'change the colour of the EMA 20 line')
    expect(JSON.stringify(steps)).toMatch(/Click EMA 20 in this list/)
    expect(JSON.stringify(steps)).not.toMatch(/\{ind\./)
  })
  it('a named pane looks for the line above that pane', () => {
    const [step] = stepsFor(guideFeature('chartView'), 'how can I make the RSI pane taller')
    expect(step.target[0].above).toBe('RSI')
  })
  it('no pane named: any divider', () => {
    const [step] = stepsFor(guideFeature('chartView'), 'how do I resize a pane')
    expect(step.target[0].above).toBeUndefined()
  })
})
