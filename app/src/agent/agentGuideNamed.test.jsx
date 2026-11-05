// ⭐ GUIDE SYSTEM — a walkthrough takes its chart, and its instance, from the words. Real-model findings 2026-11-05: "add
// bollinger bands to the NVDA chart" walked the AAPL chart, and "the EMA 20 line" ringed the EMA 9 row.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { namedChart, namesAChart } from './guide/namedChart'
import { readIndicator, stepsFor } from './guide/slots'
import { guideFeature } from './guide/registry'
import { findTarget } from './guide/targets'
import { showFeature } from './capabilities/guide'
import { guideState, _resetGuide } from './guide/guideStore'

beforeAll(() => { registerBuiltins() })

const chart = (ref, symbol, position, x, tf = 'D') => ({ ref, symbol, position, tf, label: `${position} chart (${symbol})`, cell: { x, y: 0, w: 1, h: 1 } })
const TWO = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
const FOUR = [chart('a', 'NVDA', 'top-left', 0), chart('b', 'AMD', 'top-right', 1), chart('c', 'TSLA', 'bottom-left', 0), chart('d', 'SPY', 'bottom-right', 1)]

describe('the chart the words name', () => {
  it.each([
    ['how would I add bollinger bands to the NVDA chart?', 'b'],
    ['how do I add RSI to NVDA', 'b'],
    ['how do I add RSI to my nvda chart', 'b'],
    ['how do I change the timeframe on the left chart?', 'a'],
    ['how do I change the timeframe on the second chart', 'b'],
    ['how do I add RSI to the 5 minute chart', 'b'],
    ['how do I change the timeframe on the left one', 'a'],
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
  it.each([
    ['the tsla chart', /can’t match “tsla”/],
    ['the Nvidia chart', /can’t match “Nvidia”/],
    ['the weekly chart', /No chart on this board is on weekly/],
    ['the BRK.B chart', /no BRK\.B chart/],
  ])('%s is said, not walked on the clicked chart', (words, said) => {
    expect(namedChart(`how do I add RSI to ${words}`, TWO)?.say).toMatch(said)
  })
  it('a dotted ticker on the board is that chart', () => {
    expect(namedChart('how do I add RSI to the BRK.B chart', [chart('a', 'AAPL', 'left', 0), chart('b', 'BRK.B', 'right', 1)])?.chart?.ref).toBe('b')
  })
  it('two charts named, or one symbol on two charts, is asked', () => {
    expect(namedChart('how do I compare the AAPL chart and the NVDA chart', TWO)?.say).toMatch(/more than one chart/)
    expect(namedChart('how do I add RSI to the NVDA chart', [chart('a', 'NVDA', 'left', 0), chart('b', 'NVDA', 'right', 1)])?.say).toMatch(/More than one chart shows NVDA/)
  })
  it('words that name no chart leave the clicked one standing', () => {
    for (const q of ['how do I change the timeframe', 'how do I apply a UCT chart theme', 'how do I change this chart', 'how do I use the RSI chart template']) {
      expect(namedChart(q, TWO), q).toBeNull()
    }
  })
  // AUDIT's negatives: each of these must stay on the chart the member clicked
  const WIDE = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1)]
  const TALL = [chart('a', 'AAPL', 'top', 0), chart('b', 'NVDA', 'bottom', 0)]
  it.each([
    ['how do I open the right-click menu', WIDE],
    ['how do I move the price scale to the left', WIDE],
    ['how do I move the legend to the top', TALL],
    ['how do I make the bottom pane taller', TALL],
    ['how can I chart two symbols side by side', WIDE],
    ['how do I chart a symbol', WIDE],
    ['how do I hide all indicators', [chart('a', 'AAPL', 'left', 0), chart('b', 'ALL', 'right', 1)]],
    ['how do I show the high low labels', [chart('a', 'AAPL', 'left', 0), chart('b', 'LOW', 'right', 1)]],
    ['how do I use the line chart', WIDE],
    ['how do I change the price chart', WIDE],
  ])('%s names no chart', (q, charts) => {
    expect(namedChart(q, charts)).toBeNull()
    const host = { surface: 'charts', charts: { list: () => charts, selected: () => 'a' } }
    expect(getCapability('guide.show').fast({ raw: q, host })?.detail ?? q).toBe(q)
  })
  it('a position right-click on a named chart keeps the named chart', () => {
    expect(namedChart('how do I open the right-click menu on the AAPL chart', WIDE)?.chart?.ref).toBe('a')
  })
  it('the words reach the walkthrough only when they choose something', () => {
    const fast = (raw) => getCapability('guide.show').fast({ raw, host: { surface: 'charts', charts: { list: () => TWO } } })
    expect(fast('Where do I change the timeframe?')).toEqual({ feature: 'timeframe' })
    expect(fast('where do I change the timeframe on the NVDA chart').detail).toMatch(/NVDA/)
    expect(namesAChart('where is the timeframe', TWO)).toBe(false)
  })
})

describe('the words on their own', () => {
  afterEach(() => { cleanup(); _resetGuide() })
  const shown = (el) => { el.getBoundingClientRect = () => ({ left: 10, right: 40, top: 10, bottom: 30, width: 30, height: 20 }); el.getClientRects = () => [{}]; return el }
  const legend = (...names) => {
    const { container } = render(<div data-widget-id="w">{names.map(n => <span key={n} data-guide="chart.chip" aria-label={`${n} options`}>{n}</span>)}</div>)
    container.querySelectorAll('span').forEach(shown)
    return (n) => findTarget({ id: 'chart.chip', named: n }, { chartRef: 'w' })?.getAttribute('aria-label')
  }
  it.each([['EMA 20', ['DEMA 20', 'TEMA 20', 'EMA 200', 'EMA 20']], ['SMA 50', ['LSMA 50', 'SMA 50']], ['WMA 21', ['VWMA 21', 'WMA 21']], ['RSI', ['Stoch RSI', 'RSI']], ['ATR', ['ATR Bands', 'ATR']]])('%s', (n, names) => {
    expect(legend(...names)(n)).toBe(`${n} options`)
  })
  it('none of that name is none, not a neighbour', () => {
    expect(legend('DEMA 20', 'EMA 200')('EMA 20')).toBeUndefined()
  })
  it('a clicked chart stands, and the walkthrough opens on it', () => {
    const charts = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1)]
    const { container } = render(<div>{['a', 'b'].map(id => <div key={id} data-widget-id={id}><i data-guide="chart.plot" /></div>)}</div>)
    container.querySelectorAll('i').forEach(shown)
    const out = showFeature(guideFeature('chartMenu'), { surface: 'charts', charts: { list: () => charts, selected: () => 'a' } }, 'how do I open the right-click menu')
    expect(guideState()?.chartRef ?? null, out).toBe('a')
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
  it('adding one with a length waits for the row a new one really shows, and says how to set the length', () => {
    const steps = stepsFor(guideFeature('indicators'), 'how do I add a 20 SMA')
    const text = JSON.stringify(steps)
    expect(text).not.toMatch(/SMA 20 is on the chart/)
    expect(text).toMatch(/set it to 20 under Period/)
    const add = steps.find(s => /to add it to this chart/.test(s.altText))
    // a row of that kind already on the chart must not pass for the new one: the step waits for the result to be taken
    expect(add.waitFor.not.value).toBe('movingAverage')
    expect(stepsFor(guideFeature('indicators'), 'how do I add RSI').at(-1).text).not.toMatch(/Period/)
  })
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
