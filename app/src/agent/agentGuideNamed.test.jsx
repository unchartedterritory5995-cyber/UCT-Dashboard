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

describe('words that do not name a chart (AUDIT N2)', () => {
  const ONE = [chart('a', 'AAPL', 'left', 0)]
  const WIDE = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1)]
  it.each([
    'how do I switch to the log chart', 'how do I make my candles chart hollow', 'how do I reset to the default chart', 'how do I change my intraday chart',
    'how do I get the OHLC chart', 'how do I get the HA chart', 'how do I get the 1D chart',
    // held out: the same classes, other words
    'how do I open the heikin ashi chart', 'how do I turn on the percent chart', 'how do I see the premarket chart', 'how do I get back to the original chart',
    'how do I use the renko chart', 'how do I change the extended hours chart', 'how do I reset my main chart', 'how do I fix the inverted chart',
    'how do I add RSI to the TSLA chart', 'how do I add RSI to the tsla chart', 'how do I change the left chart', 'how do I change the second chart', 'how do I change the weekly chart',
  ])('one chart never refuses: %s', (q) => { expect(namedChart(q, ONE)).toBeNull() })
  it.each([
    'how do I switch to the log chart', 'how do I make my candles chart hollow', 'how do I reset to the default chart', 'how do I change my intraday chart',
    'how do I get the OHLC chart', 'how do I get the HA chart', 'how do I use the hollow candles chart', 'how do I open the heikin ashi chart', 'how do I turn on the percent chart',
    'how do I see the premarket chart', 'how do I get back to the original chart', 'how do I use the renko chart', 'how do I change the extended hours chart', 'how do I reset my main chart',
    'how do I change my logarithmic chart', 'how do I change this area chart', 'how do I use the baseline chart', 'how do I change my RTH chart', 'how do I change the whole chart',
  ])('many charts, the clicked one stands: %s', (q) => {
    expect(namedChart(q, WIDE)).toBeNull()
    const host = { surface: 'charts', charts: { list: () => WIDE, selected: () => 'b' } }
    expect(getCapability('guide.show').fast({ raw: q, host })?.detail ?? q).toBe(q)
  })
  it.each([
    ['how do I add RSI to the 1D chart', 'a'], ['how do I add RSI to the 1d chart', 'a'], ['how do I add RSI to the 1W chart', 'b'], ['how do I add RSI to the weekly chart', 'b'],
    ['how do I add RSI to my D chart', 'a'], ['how do I add RSI to the W chart', 'b'],
  ])('a timeframe label: %s', (q, ref) => {
    const charts = [chart('a', 'AAPL', 'left', 0, 'D'), chart('b', 'NVDA', 'right', 1, 'W')]
    expect(namedChart(q, charts)?.chart?.ref).toBe(ref)
  })
  it.each([
    ['how do I add RSI to the HA chart', 'HA'], ['how do I add RSI to the LINE chart', 'LINE'], ['how do I add RSI to the D chart', 'D'], ['how do I add RSI to the M chart', 'M'],
  ])('a ticker the board shows stays a ticker: %s', (q, symbol) => {
    expect(namedChart(q, [chart('a', 'AAPL', 'left', 0, 'D'), chart('b', symbol, 'right', 1, '5')])?.chart?.ref).toBe('b')
  })
  it('a lowercase letter is not a timeframe', () => {
    expect(namedChart('how do I add RSI to the m chart', [chart('a', 'AAPL', 'left', 0, 'D'), chart('b', 'NVDA', 'right', 1, 'M')])?.say).toMatch(/can’t match “m”/)
  })
  it('the board may spell it 1D as well', () => {
    expect(namedChart('how do I add RSI to the 1D chart', [chart('a', 'AAPL', 'left', 0, '1D'), chart('b', 'NVDA', 'right', 1, '5')])?.chart?.ref).toBe('a')
  })
  it('1M is a month and 1m a minute, as on the buttons', () => {
    const charts = [chart('a', 'AAPL', 'left', 0, 'M'), chart('b', 'NVDA', 'right', 1, '1')]
    expect(namedChart('how do I add RSI to the 1M chart', charts)?.chart?.ref).toBe('a')
    expect(namedChart('how do I add RSI to the 1m chart', charts)?.chart?.ref).toBe('b')
  })
  it.each([
    ['how do I add RSI to the 1W chart', /No chart on this board is on 1W/],
    ['how do I add RSI to the TSLA chart', /no TSLA chart/],
    ['how do I add RSI to the tesla chart', /can’t match “tesla”/],
    ['how do I add RSI to my tsla chart', /can’t match “tsla”/],
    ['how do I add RSI to the BRK.B chart', /no BRK\.B chart/],
  ])('many charts, a name that matches nothing is said, on any clicked chart: %s', (q, said) => {
    const charts = [chart('a', 'AAPL', 'left', 0, 'D'), chart('b', 'NVDA', 'right', 1, '5')]
    expect(namedChart(q, charts)?.say).toMatch(said)
    expect(namedChart(q, charts)?.chart).toBeUndefined()
  })
})

describe('the divider above a named pane (AUDIT 5: the production failure)', () => {
  afterEach(() => { cleanup(); _resetGuide() })
  const box = (el, top, height) => {
    el.getBoundingClientRect = () => ({ left: 10, right: 600, top, bottom: top + height, width: 590, height })
    el.getClientRects = () => [{}]
  }
  // price with ATR Bands on it, then a pane each for Stoch RSI, RSI and ATR: every name holds another's words
  function stack(chips) {
    const { container } = render(
      <div data-widget-id="w">
        <div data-guide="chart.plot">
          {[300, 400, 500].map(y => <div key={y} data-line={y} style={{ cursor: 'row-resize' }} />)}
        </div>
        {chips.map(([name]) => <span key={name} data-guide="chart.chip" aria-label={`${name} options`}>{name}</span>)}
      </div>,
    )
    box(container.querySelector('[data-guide="chart.plot"]'), 0, 600)
    container.querySelectorAll('[data-line]').forEach(el => box(el, Number(el.dataset.line), 9))
    container.querySelectorAll('[data-guide="chart.chip"]').forEach((el, i) => box(el, chips[i][1], 16))
    return (words) => findTarget({ within: 'chart.plot', cursor: 'row-resize', above: words }, { chartRef: 'w' })?.dataset.line ?? null
  }
  const FULL = [['ATR Bands', 20], ['Stoch RSI', 310], ['RSI', 410], ['ATR', 510]]
  it('RSI is the line above RSI, not the one above Stoch RSI', () => { expect(stack(FULL)('RSI')).toBe('400') })
  it('ATR is the line above ATR: it has a pane, whatever the price pane holds', () => { expect(stack(FULL)('ATR')).toBe('500') })
  it('Stoch RSI keeps its own line', () => { expect(stack(FULL)('Stoch RSI')).toBe('300') })
  it('an indicator drawn on the price pane has no line above it', () => { expect(stack(FULL)('ATR Bands')).toBeNull() })
  it('a name that is only inside another name finds no pane', () => { expect(stack([['Stoch RSI', 310]])('RSI')).toBeNull() })
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
  // a new Moving Average is SMA 5 whatever was asked for: the last step names that, and says what is left to set
  const lastStep = (q) => stepsFor(guideFeature('indicators'), q).at(-1)
  it.each([
    ['how do I add a 20 SMA', /^SMA 5 is on the chart\..*set Period to 20\.$/],
    ['how do I add an EMA', /^SMA 5 is on the chart\..*set Type to EMA\.$/],
    ['how do I add a 20 EMA', /^SMA 5 is on the chart\..*set Type to EMA and Period to 20\.$/],
    ['how do I put a 50-day WMA on my chart', /^SMA 5 is on the chart\..*set Type to WMA and Period to 50\.$/],
    ['show me how to add an hma', /^SMA 5 is on the chart\..*set Type to HMA\.$/],
    ['how would I get a DEMA(9) on here', /^SMA 5 is on the chart\..*set Type to DEMA and Period to 9\.$/],
    ['how do I add a TEMA', /^SMA 5 is on the chart\..*set Type to TEMA\.$/],
    ['how do I add a VWMA 21', /^SMA 5 is on the chart\..*set Type to VWMA and Period to 21\.$/],
    ['how do I add an SMMA', /^SMA 5 is on the chart\..*set Type to SMMA\.$/],
    ['how do I add an LSMA', /^SMA 5 is on the chart\..*set Type to LSMA\.$/],
    ['how do I add a 50 day moving average', /^SMA 5 is on the chart\..*set Period to 50\.$/],
  ])('%s never claims what was not applied', (q, text) => { expect(lastStep(q).text).toMatch(text) })
  it.each(['how do I add a DEMA 9', 'how would I get an HMA on here', 'show me how to put a 50-day WMA on my chart', 'how do I put a 200 day moving average on my chart', 'how do I add a VWMA', 'teach me how to add an LSMA', 'where do I add a TEMA', 'how do I add an SMMA to this chart'])('the whole family reaches the walkthrough without the model: %s', (q) => {
    expect(getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })?.feature).toBe('indicators')
  })
  it('a timeframe in days stays a timeframe', () => {
    expect(getCapability('guide.show').fast({ raw: 'how do I make a 45-minute chart', host: { surface: 'charts' } })?.feature).toBe('timeframeCustom')
  })
  it('asking for exactly the default has nothing left to set', () => {
    expect(lastStep('how do I add a 5 SMA').text).toBe('SMA 5 is on the chart. Click it here to change its settings, colours and pane.')
    expect(lastStep('how do I add a moving average').text).toBe('SMA 5 is on the chart. Click it here to change its settings, colours and pane.')
  })
  it('the row it rings is the row a new one really shows', () => {
    expect(JSON.stringify(lastStep('how do I add a 20 EMA').target)).toMatch(/"named":"SMA 5"/)
    expect(JSON.stringify(lastStep('how do I add a 20 EMA').target)).not.toMatch(/EMA/)
  })
  it('an indicator with no such defaults is still named as asked', () => {
    expect(lastStep('how do I add RSI').text).toBe('RSI is on the chart. Click it here to change its settings, colours and pane.')
  })
  it('adding one with a length waits for the add itself', () => {
    const steps = stepsFor(guideFeature('indicators'), 'how do I add a 20 SMA')
    const add = steps.find(s => /to add it to this chart/.test(s.altText))
    // a row of that kind already on the chart must not pass for the new one: the step waits for the result to be taken
    expect(add.waitFor.not.value).toBe('movingAverage')
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
