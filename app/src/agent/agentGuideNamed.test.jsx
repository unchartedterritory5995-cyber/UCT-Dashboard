// ⭐ GUIDE SYSTEM — a walkthrough takes its chart, and its instance, from the words. Real-model findings 2026-11-05: "add
// bollinger bands to the NVDA chart" walked the AAPL chart, and "the EMA 20 line" ringed the EMA 9 row.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { namedChart, namesAChart } from './guide/namedChart'
import { readIndicator, stepsFor } from './guide/slots'
import { ACTION_SLOTS } from './guide/actions'
import { guideFeature, matchFeature } from './guide/registry'
import { findTarget, restoreClipped, unclip } from './guide/targets'
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
  // 2026-11-07 (selection oracle flow-ring-named): the words ALWAYS travel, and `answer` reads the chart from them against the
  // real board; before, they travelled only when the fast path itself saw a chart named, and a panel whose fast path could not
  // see the board walked the clicked chart
  it('the words always reach the walkthrough, which reads the chart from them', () => {
    const fast = (raw) => getCapability('guide.show').fast({ raw, host: { surface: 'charts', charts: { list: () => TWO } } })
    expect(fast('Where do I change the timeframe?')).toEqual({ feature: 'timeframe', detail: 'Where do I change the timeframe?' })
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
    'how do I change the left chart', 'how do I change the weekly chart',
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

describe('a length of time is a chart name only when a chart here is on it', () => {
  it.each(['how do I see the 3 month chart', 'how do I see the 6 month chart', 'show me how to get my 3-month chart', 'show me how to get my 6-month chart'])('it still reaches the range buttons: %s', (q) => {
    expect(ACTION_SLOTS.viewAct?.read?.(q)?.id ?? ACTION_SLOTS.chartAct?.read?.(q)?.id ?? Object.values(ACTION_SLOTS).map(s => s.read(q)?.id).find(id => id === 'range')).toBe('range')
    expect(matchFeature(q, null, 'charts')).not.toBeNull()
  })
  const one = [chart('a', 'AAPL', 'left', 0)]
  const two = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
  it.each([
    ['how do I see the 3 month chart', '3M'], ['how do I see the 6 month chart', '6M'], ['how do I see the 3M chart', '3M'], ['how do I see the 6M chart', '6M'], ['how do I see the 12M chart', '12M'],
    // held out
    ['show me how to get my 3-month chart', '3M'], ['where do I find that 6 months chart', '6M'], ['how do I look at the 12 month chart', '12M'], ['how do I open the 2 day chart', '2D'], ['how would I see the 5-day chart', '5D'], ['how do I get this 2 week chart', '2W'],
  ])('%s', (q, tf) => {
    expect(namedChart(q, one)).toBeNull()
    expect(namedChart(q, two)).toBeNull()
    expect(namedChart(q, [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, tf)])?.chart?.ref).toBe('b')
    expect(namedChart(q, [chart('a', 'AAPL', 'left', 0, tf), chart('b', 'NVDA', 'right', 1, tf)])?.say).toMatch(/More than one chart fits/)
  })
  it('a timeframe the buttons read as one is still said when it is not here', () => {
    expect(namedChart('how do I add RSI to the 1W chart', two)?.say).toMatch(/No chart on this board is on 1W/)
    expect(namedChart('how do I add RSI to the weekly chart', two)?.say).toMatch(/No chart on this board is on weekly/)
    expect(namedChart('how do I add RSI to the 15m chart', two)?.say).toMatch(/No chart on this board is on 15m/)
  })
  it('3M reads 3 on a board in minutes', () => {
    expect(namedChart('how do I see the 3M chart', [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '3')])?.chart?.ref).toBe('b')
  })
})

describe('Multi Chart rows (#860 follow-ups)', () => {
  const row = (q) => ACTION_SLOTS.gridAct.read(q)?.id ?? null
  it.each([
    ['how do I go back to the previous group in multi chart', 'groupStep'], ['how do I step to the next group in the grid', 'groupStep'], ['how do I switch back a group in the grid', 'groupStep'],
    ['how do I exit multi chart', 'exit'], ['how do I close multi chart', 'exit'], ['how do I close the grid', 'exit'], ['how do I get out of the grid', 'exit'], ['how do I leave multi-chart', 'exit'],
    ['how do I go back to my board from the grid', 'exit'], ['how do I get back to the workspace from multi chart', 'exit'],
    ['how do I make one cell a line chart in the grid', 'cellStyle'], ['how do I set hollow candles in a grid cell', 'cellStyle'],
  ])('%s', (q, id) => { expect(row(q)).toBe(id) })
  it.each(['how do I close a chart in the grid', 'how do I add a line to a chart in the grid', 'how do I go back a step in the grid'])('neither leaves the grid nor sets a style: %s', (q) => {
    expect(['exit', 'cellStyle']).not.toContain(row(q))
  })
  it('the style card says which option follows the main chart', () => {
    expect(JSON.stringify(stepsFor(guideFeature('gridAction'), 'how do I set one cell to candles in the grid'))).toMatch(/The option called Style follows your main chart/)
  })
  it('a member who is not an admin is told, and the card lands on a control they have', () => {
    const last = stepsFor(guideFeature('gridAction'), 'how do I save a prebuilt grid').at(-1)
    expect(last.target).toEqual([{ within: 'multiChart.flyout', label: 'Prebuilt (available to all users)' }, { within: 'multiChart.flyout', aria: 'Grid name' }])
    expect(last.altText).toMatch(/^Only admins can offer a grid to everyone/)
  })
})

describe('add another (#860 follow-ups)', () => {
  const row = (q) => ACTION_SLOTS.indAct.read(q)?.id ?? null
  const fast = (raw) => getCapability('guide.show').fast({ raw, host: { surface: 'charts' } })?.feature
  it.each(['how do I add another rsi', 'how do I add a second EMA', 'how do I put another moving average on', 'teach me how to get an extra macd', 'how do I add another copy of RSI', 'how do I add another one'])('%s', (q) => {
    expect(row(q)).toBe('addAnother')
  })
  it.each(['how do I add another rsi', 'how do I add a second EMA', 'how do I put another moving average on'])('reaches the row on the fast path: %s', (q) => {
    expect(fast(q)).toBe('indicatorManage')
  })
  it.each(['how do I add RSI to the second chart', 'how do I add another chart', 'how do I add another pane', 'how do I change the second RSI'])('not a copy: %s', (q) => {
    expect(row(q)).not.toBe('addAnother')
  })
})

describe('what the guide moves on screen (#860 follow-ups)', () => {
  afterEach(() => { cleanup(); restoreClipped(); document.body.innerHTML = '' })
  const zero = (el) => { el.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 20, width: 0, height: 20 }); el.getClientRects = () => [{}] }
  const board = (marker) => {
    document.body.innerHTML = `<div data-widget-id="w"><div id="row"><div id="strip" ${marker}><button data-guide="chart.tool.x">x</button><button>y</button></div><div id="near">near</div></div></div>`
    document.querySelectorAll('#strip, #strip button').forEach(zero)
    return document.getElementById('near')
  }
  it('a toolbar row we know makes room, and is put back', () => {
    const near = board('data-guide="chart.drawingTools"')
    unclip('chart.tool.x', { chartRef: 'w' })
    expect(near.style.display).toBe('none')
    restoreClipped()
    expect(near.style.display).toBe('')
  })
  it('anything else squeezed to nothing hides nothing beside it', () => {
    const near = board('class="dock"')
    unclip('chart.tool.x', { chartRef: 'w' })
    expect(near.style.display).toBe('')
  })
  it('scrolls to a control once, however many ticks it stays out of reach', () => {
    const near = board('class="dock"')
    const el = document.querySelector('[data-guide="chart.tool.x"]')
    const scroll = el.scrollIntoView = vi.fn()
    for (let i = 0; i < 5; i++) unclip('chart.tool.x', { chartRef: 'w' })
    expect(scroll).toHaveBeenCalledTimes(1)
    restoreClipped()
    unclip('chart.tool.x', { chartRef: 'w' })
    expect(scroll).toHaveBeenCalledTimes(2)
    expect(near).toBeTruthy()
  })
})

describe('the duplicate attribute', () => {
  it('the headline Explain button carries its data-guide once', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/charts/widgets/TradeExchangeNewsParts.jsx'), 'utf8')
    expect(src.match(/data-guide="teNews\.explain"/g)).toHaveLength(1)
  })
})

describe('only a ticker’s shape counts for a bare name', () => {
  const one = [chart('a', 'AAPL', 'left', 0)]
  const two = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
  const noNote = (q) => { expect(namedChart(q, one)).toBeNull() }
  // never a chart, on any board: the same three boards every time
  const stands = (q) => { noNote(q); expect(namedChart(q, two)).toBeNull(); expect(namedChart(q, FOUR)).toBeNull() }
  it.each([
    'how do I switch to Renko', 'how do I change to Line', 'how do I show earnings on Monday', 'how do I set it to Extended', 'how do I open Replay in Settings', 'how do I get to Multi Chart',
    // held out
    'how do I move it to Tuesday', 'how do I go to Heikin Ashi', 'how do I switch to Logarithmic', 'how do I get to Breadth', 'how do I add it to Favourites', 'how do I save it in Layouts', 'how do I set alerts for Friday', 'how do I go to Watchlists', 'how do I turn on Volume', 'how do I jump to Today',
  ])('a title-case word: %s', stands)
  it.each([
    'how do I add it on RTH', 'how do I price it in USD',
    // held out: all capitals, and no ticker
    'how do I show earnings on MONDAY', 'how do I switch to NASDAQ', 'how do I switch to NYSE', 'how do I set the time to UTC', 'how do I see it in GMT', 'how do I mark it on FOMC', 'how do I open it in SETTINGS', 'how do I change it to EXTENDED', 'how do I move it to PRE-MKT', 'how do I switch to AMEX',
    'how do I go to WATCHLISTS', 'how do I look for EARNINGS',
  ])('capitals that are no ticker: %s', stands)
  it.each(['how do I change the timeframe on MSFT', 'how do I change the timeframe for BRK.B', 'how do I change the timeframe in GOOGL', 'how do I add RSI to BF.B'])('a ticker’s shape is still said, and still draws the note: %s', (q) => {
    expect(namedChart(q, two)?.say).toMatch(/^There’s no [A-Z.]+ chart on this board/)
    expect(namedChart(q, FOUR)?.say).toMatch(/^There’s no [A-Z.]+ chart on this board/)
    expect(namedChart(q, one)?.note).toBe('This board only has AAPL, so I’ll show it there.')
  })
  it('one letter alone is left alone', () => { stands('how do I set it to L') })
  it('a symbol the board shows is that chart, whatever its shape', () => {
    expect(namedChart('how do I add RSI to GOOGLE', [chart('a', 'AAPL', 'left', 0), chart('b', 'GOOGLE', 'right', 1)])?.chart?.ref).toBe('b')
  })
  it('the X chart form is unchanged', () => {
    expect(namedChart('how do I add RSI to the Renko chart', two)).toBeNull()
    expect(namedChart('how do I add RSI to the Tesla chart', two)?.say).toMatch(/can’t match “Tesla”/)
    expect(namedChart('how do I add RSI to the Tesla chart', one)?.note).toBeTruthy()
    expect(namedChart('how do I add RSI to the MONDAY chart', two)?.say).toMatch(/no MONDAY chart/)
  })
})

describe('a bare name on a board of several', () => {
  const two = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
  const host = { surface: 'charts', charts: { list: () => two, selected: () => 'a' } }
  it.each([
    ['how do I add rsi to nvda', 'NVDA'], ['how do I change the timeframe on aapl', 'AAPL'], ['how do I add an ema for nvda', 'NVDA'],
    // held out
    ['walk me through putting macd on nvda', 'NVDA'], ['where do I change the timeframe in aapl', 'AAPL'],
  ])('lowercase asks: %s', (q, sym) => {
    expect(namedChart(q, two)?.say).toBe(`Did you mean the ${sym} chart?`)
    expect(getCapability('guide.show').answer({}, { feature: 'timeframe', detail: q }, host)).toBe(`Did you mean the ${sym} chart?`)
    expect(guideState()).toBeNull()
  })
  it.each(['how do I add RSI on TSLA', 'how do I change the timeframe for TSLA', 'how do I change the timeframe in BRK.B', 'walk me through adding macd to GOOGL', 'where do I set the timeframe on TSLA'])('absent in capitals is said: %s', (q) => {
    expect(namedChart(q, two)?.say).toMatch(/^There’s no [A-Z.]+ chart on this board/)
    expect(namedChart(q, two)?.chart).toBeUndefined()
  })
  it.each(['how do I add rsi to it', 'how do I turn on all my indicators', 'how do I add rsi to my chart', 'how do I change the timeframe on charts', 'how do I set it to low', 'how do I export it to CSV', 'how do I set alerts for EOD', 'how do I add RSI to VWAP', 'how do I press on ENTER keys', 'how do I change the timeframe on the keys chart', 'how do I change the timeframe on the files chart', 'how do I change the timeframe to tsla'])('names nothing here, the clicked chart stands: %s', (q) => {
    expect(namedChart(q, two)).toBeNull()
  })
  it('a chart named some other way wins over a bare word', () => {
    expect(namedChart('how do I add rsi to nvda on the left chart', two)?.chart?.ref).toBe('a')
    expect(namedChart('how do I add RSI to TSLA on the left chart', two)?.chart?.ref).toBe('a')
  })
})

describe('one chart, and the words named another', () => {
  afterEach(() => { cleanup(); _resetGuide() })
  const NOTE = 'This board only has AAPL, so I’ll show it there.'
  const told = (q, charts = [chart('a', 'AAPL', 'left', 0)]) => {
    const { container } = render(<div data-widget-id="a"><button data-guide="chart.timeframe">1D</button></div>)
    const el = container.querySelector('button')
    el.getBoundingClientRect = () => ({ left: 10, right: 40, top: 10, bottom: 30, width: 30, height: 20 })
    el.getClientRects = () => [{}]
    const out = showFeature(guideFeature('timeframe'), { surface: 'charts', charts: { list: () => charts, selected: () => 'a' } }, q)
    const walked = guideState()?.chartRef ?? null
    cleanup(); _resetGuide()
    return { out, walked }
  }
  // every sentence walks the only chart. The ones that named another say so, first, in the board's own symbol
  it.each([
    'how do I change the timeframe on the TSLA chart', 'how do I change the timeframe on the tsla chart', 'how do I change the timeframe on TSLA',
    'how do I change the timeframe on the BRK.B chart', 'how do I change the timeframe on my Nvidia chart', 'how do I change the timeframe on this MSFT chart',
    'how do I change the timeframe on the second chart', 'how do I change the timeframe for NVDA',
    // held out
    'walk me through changing the interval on that AMD chart', 'how would I change the timeframe in GOOGL', 'where do I set the timeframe on the tesla chart', 'how do I switch timeframes on chart 3',
  ])('named another: %s', (q) => {
    const { out, walked } = told(q)
    expect(walked).toBe('a')
    expect(out.startsWith(`${NOTE} I’ve highlighted it`)).toBe(true)
  })
  it('the note reads the symbol from the board', () => {
    expect(told('how do I change the timeframe on the TSLA chart', [chart('a', 'SPY', 'left', 0)]).out).toMatch(/^This board only has SPY, so I’ll show it there\./)
  })
  it('a chart with no symbol yet claims none', () => {
    expect(told('how do I change the timeframe on the TSLA chart', [chart('a', '', 'left', 0)]).out).toMatch(/^This board only has one chart, so I’ll show it there\./)
  })
  // each pairs with a sentence that does draw the note, so it cannot pass on a page that never says one
  const another = told0 => told0('how do I change the timeframe on the TSLA chart').out.startsWith(NOTE)
  it.each([
    // the same chart
    'how do I change the timeframe on the AAPL chart', 'how do I change the timeframe on the aapl chart', 'how do I change the timeframe on AAPL', 'how do I change the timeframe on my AAPL chart',
    'where do I set the timeframe on this AAPL chart',
    // nothing named
    'how do I change the timeframe', 'how do I change the timeframe on my chart', 'how do I change the timeframe on this chart', 'how do I change the timeframe on the chart',
    // words that are about the chart here
    'how do I change the timeframe on the log chart', 'how do I change the timeframe on the 1D chart', 'how do I change the timeframe on the 1W chart', 'how do I change the timeframe on the candles chart',
    'how do I change the timeframe on the OHLC chart', 'how do I change the timeframe on the HA chart', 'how do I change the timeframe on the default chart', 'how do I change the timeframe on my intraday chart',
    'how do I change the timeframe on the left chart', 'how do I change the timeframe on the first chart', 'how do I change the timeframe on the 5m chart', 'how do I change the timeframe on the RSI chart',
    // held out
    'how do I change the timeframe on the 2-day chart', 'how do I change the timeframe on the 3 month chart', 'how do I change the timeframe on the renko chart', 'how do I change the timeframe on this premarket chart',
    'how do I change the timeframe on the inverted chart', 'how do I set it to RTH', 'how do I export it to CSV', 'how do I change the timeframe on the hourly chart', 'how do I change the timeframe in OHLC',
  ])('no note: %s', (q) => {
    expect(another(told)).toBe(true)
    const { out, walked } = told(q)
    expect(walked).toBe('a')
    expect(out).toMatch(/^I’ve highlighted it/)
  })
  it('a board of several still refuses, on any clicked chart, and no note stands in for it', () => {
    expect(another(told)).toBe(true)
    const two = [chart('a', 'AAPL', 'left', 0), chart('b', 'NVDA', 'right', 1, '5')]
    const { out, walked } = told('how do I change the timeframe on the TSLA chart', two)
    expect(walked).toBeNull()
    expect(out).toMatch(/no TSLA chart/)
    expect(out).not.toMatch(/only has/)
  })
  it('the note is drawn only by words that name another chart', () => {
    const host = { surface: 'charts', charts: { list: () => [chart('a', 'AAPL', 'left', 0)], selected: () => 'a' } }
    const show = getCapability('guide.show')
    const said = (raw) => { const a = show.fast({ raw, host }); return show.answer(null, { feature: a.feature, detail: a.detail }, host) }
    expect(show.fast({ raw: 'how do I use the symbol search on the TSLA chart', host }).feature).toBe('symbol')
    // the words reach `answer`, and namedChart draws the note only for another chart
    expect(show.fast({ raw: 'how do I use the symbol search on the AAPL chart', host }).detail).toMatch(/AAPL/)
    expect(namedChart('how do I use the symbol search on the TSLA chart', host.charts.list())?.note).toMatch(/only has AAPL/)
    expect(namedChart('how do I use the symbol search on the AAPL chart', host.charts.list())).toBeNull()
    expect(namedChart('how do I use the symbol search on the 1D chart', host.charts.list())).toBeNull()
    expect(typeof said).toBe('function')
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

// selection oracle flow-ring-named: the chart the words NAME wins over the clicked one, whatever the fast path could see — the
// same rule as execution. A bare "this" binds to the click; words that fit no chart, or several, are said or asked.
describe('the named chart wins over the click, even when the fast path cannot see the board', () => {
  const FOUR = [chart('tl', 'SPY', 'top-left', 0), chart('tr', 'QQQ', 'top-right', 1), chart('bl', 'NVDA', 'bottom-left', 2), chart('br', 'TSLA', 'bottom-right', 3)]
  const board = { surface: 'charts', charts: { list: () => FOUR, selected: () => 'bl' } }
  const blind = { surface: 'charts' }   // what the panel's fast path may get: no charts list
  const ask = (q) => {
    const show = getCapability('guide.show')
    const args = show.fast({ raw: q, host: blind })
    return show.answer(null, { feature: args.feature, detail: args.detail ?? null }, board)
  }
  afterEach(() => { _resetGuide() })
  it.each([
    ['how do I change the timeframe on the top right chart', 'tr'],
    ['how do I change the timeframe on the QQQ chart', 'tr'],
    ['how do I add RSI to the TSLA chart', 'br'],
    ['how do I change the timeframe on this chart', 'bl'],
    ['how do I change the timeframe', 'bl'],
  ])('%s → %s', (q, ref) => {
    // the sentence names the chart it is about (highlighted on it, or not visible on it in jsdom): never another
    const said = ask(q)
    const want = FOUR.find(c => c.ref === ref)
    expect(said).toContain(want.label)
    for (const c of FOUR.filter(x => x !== want)) expect(said).not.toContain(c.label)
  })
  it('a position no chart holds is said, never walked on the click', () => {
    const said = ask('how do I change the timeframe on the middle left chart')
    expect(guideState()?.chartRef ?? null).not.toBe('bl')
    expect(said).toMatch(/chart/)
  })
  it('a ticker the board shows twice is asked about', () => {
    const twice = { surface: 'charts', charts: { list: () => [chart('a', 'SPY', 'left', 0), chart('b', 'SPY', 'right', 1)], selected: () => 'a' } }
    const show = getCapability('guide.show')
    const args = show.fast({ raw: 'how do I change the timeframe on the SPY chart', host: blind })
    expect(show.answer(null, { feature: args.feature, detail: args.detail }, twice)).toMatch(/Which one do you mean/)
    expect(guideState()).toBeNull()
  })
})
