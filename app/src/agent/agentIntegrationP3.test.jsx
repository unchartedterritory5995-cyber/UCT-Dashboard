// UCT Agent PHASE 3 — WORKSTREAM 5, INTEGRATION & ACCEPTANCE. The workstreams together, through the REAL panel
// (panelHarness: AgentPanel + useAgent, planner, policy, runtime, receipts, Undo, the board writer and the Indicators
// mutation interface), with the guide's controls present in the document as the product renders them. The model is a
// stand-in that none of these needs. Every scenario asserts the WORKSPACE (cells, tickers, timeframes, widgets,
// indicators and their colours), not only what was said.
//
//   1  a compound multi-chart workspace request                 6  Do it for me — receipt and Undo
//   2  a multi-turn correction referring to earlier indicators  7  a failed / ambiguous request changes nothing unasked
//   3  an existing-widget modification                          8  a multi-step operation, then repeated Undo
//   4  a contextual product-guide explanation                   9  duplicate prevention and an explicit copy
//   5  Show me on a real control                               10  Phase 2 behaviour intact (its live acceptance requests)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR, bareSettings } from './testing/panelHarness'
import { _resetGuide } from './guide/guideStore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  _resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); vi.restoreAllMocks(); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

function controls(id = 'c') {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `<div data-widget-id="${id}" data-widget-type="chart">
      <button data-guide="widget.link" aria-label="Color group N (click to cycle)"></button>
      <div data-guide="chart.timeframe"><button>D</button><button>W</button></div>
      <button data-guide="chart.timeframeMore" aria-label="More timeframes">v</button>
      <button data-guide="chart.settings" aria-label="Chart settings">gear</button>
    </div>`
  document.body.appendChild(root)
}
const GREEN = '#2faf68'
const YELLOW = '#facc15'
const charts = (board) => board.state.widgets.filter(w => w.type === 'chart')
const shape = (board) => JSON.stringify(board.state.widgets.map(w => [w.id, w.type, w.x, w.y, w.w, w.h, w.color]))
const emas = (board, id) => p.instancesOn(board, id).filter(i => i.defId === 'movingAverage' && i.inputs?.maType === 'ema').map(i => [i.inputs.period, i.inputs.color])
const cardText = () => screen.queryByTestId('guide-text')?.textContent || ''

describe('Phase 3 integration — the workstreams together, asserted on the workspace', () => {
  it('1 · compound workspace: four daily charts, a watchlist rail, the 9 and 20 EMA coloured and RSI on each', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    await say('Make me a workspace with four daily charts for NVDA, AMD, AVGO and MU, a watchlist, and RSI beneath each chart.')
    const cs = charts(board)
    expect(cs.map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['NVDA', 'D'], ['AMD', 'D'], ['AVGO', 'D'], ['MU', 'D']])
    expect(board.state.widgets.find(w => w.type === 'watchlist')).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })
    for (const w of cs) expect(p.instancesOn(board, w.id).some(i => i.defId === 'rsi')).toBe(true)
    // the brief's own compound phrasing on the same charts, then a reference back to them
    await say('slap the 9/20 on all four')
    await say('fast one green slow one yellow')
    for (const w of cs) expect(emas(board, w.id)).toEqual([[9, GREEN], [20, YELLOW]])
    expect(p.turns()).toBe(0)
  }, 90000)

  it('2 · a multi-turn correction about earlier indicators: "the other one", then "undo just the color change"', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add the 9 and 20 ema')
    await say('make the 9 green')
    await say('make the other one yellow')
    expect(emas(board, 'c')).toEqual([[9, GREEN], [20, YELLOW]])
    const out = await say('undo just the color change')
    expect(out).toMatch(/Put EMA 20 on Chart \(BRCB\) back as it was/)
    expect(emas(board, 'c')).toEqual([[9, GREEN], [20, '#f0b90b']])
    expect(p.turns()).toBe(0)
  }, 40000)

  it('3 · existing widgets modified in place — no replacement: a chart re-symboled, the watchlist moved, a timeframe synced', async () => {
    const wl = { id: 'wl', type: 'watchlist', x: 0, y: 0, w: 6, h: 20, color: 'N', opts: {} }
    const c = { id: 'c', type: 'chart', x: 6, y: 0, w: 18, h: 20, color: 'N', opts: { settings: bareSettings() } }
    const { say, board, h } = p.mount([wl, c], { 'N:c': 'BRCB' })
    await say('change the chart to amd')
    expect(h.charts.read('c').symbol).toBe('AMD')
    await say('move my watchlist to the right')
    expect(board.state.widgets.map(w => [w.id, w.x, w.w])).toEqual([['wl', 18, 6], ['c', 0, 18]])
    expect(board.state.widgets.map(w => w.id)).toEqual(['wl', 'c'])           // the same two widgets — nothing replaced
    expect(p.turns()).toBe(0)
  }, 40000)

  it('3b · a chart named by its ORDER takes an indicator directly (found by the integration smoke run: "to the first chart" reached the model)', async () => {
    const { say, board } = p.mount(...FOUR())
    await say('add the 9 and 20 ema to the first chart')
    await say('add rsi to the second chart')
    await say('put macd on the last chart')
    expect(emas(board, 'c0').map(([n]) => n)).toEqual([9, 20])
    expect(p.instancesOn(board, 'c1').map(i => i.defId)).toEqual(['rsi'])
    expect(p.instancesOn(board, 'c3').map(i => i.defId)).toEqual(['macd'])
    expect(p.turns()).toBe(0)
  }, 40000)

  it('4 · a contextual explanation from the product\'s own metadata, instantly, changing nothing', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    const before = shape(board)
    const out = await say('What does the bar-close countdown do?')
    expect(out).toMatch(/Bar-close countdown — Chart Settings → Markers → Countdown \(intraday\)\. It is on or off\. I can change it for you/)
    expect(shape(board)).toBe(before)
    expect(p.turns()).toBe(0)
  }, 30000)

  it('5 + 6 · Show me on the real link dot, then Do it for me: asked, receipted, undone', async () => {
    controls('c')
    const { say, click, board } = p.mount(...ONE('BRCB'))
    const before = shape(board)
    expect(await say('how do I link my charts?')).toMatch(/I’ve highlighted it .* Nothing on your board has changed/)
    await waitFor(() => expect(cardText()).toMatch(/This dot is the chart’s link colour/))
    expect(shape(board)).toBe(before)                                           // Show me never changes the workspace
    expect(await say('do it for me')).toMatch(/Which link colour\?/)
    await click('Purple')
    await waitFor(() => expect(board.state.widgets[0].color).toBe('D'))
    expect(p.summaries().join(' ')).toMatch(/Linked the Chart.* to the purple group \(D\)/)
    await say('undo')
    await waitFor(() => expect(shape(board)).toBe(before))
    expect(p.turns()).toBe(0)
  }, 40000)

  it('7 · failed or ambiguous requests change nothing the member did not ask for — each says why', async () => {
    const { say, board, h } = p.mount(...FOUR())
    const state = () => shape(board) + JSON.stringify(board.state.widgets.map(w => w.opts))
    let before = state()
    expect(await say('switch em to weekly')).toMatch(/Which charts do you mean by “them”\?.*Nothing has changed/)
    expect(await say('keep the top left but swap the rest for AMD and META')).toMatch(/you named 2 tickers .* Nothing has changed/)
    expect(state()).toBe(before)
    await say('make the top left weekly')                                       // one chart now differs …
    before = state()
    expect(await say('make these charts use the same timeframe')).toMatch(/Which timeframe should they share.*Nothing has changed/)
    expect(state()).toBe(before)                                                // … and nothing more changed
    expect(charts(board).map(w => h.charts.read(w.id).tf)).toEqual(['W', 'D', 'D', 'D'])
  }, 40000)

  it('8 · a multi-step operation, then repeated Undo — the board exactly as it was', async () => {
    const { say, board, h } = p.mount(...ONE('BRCB'))
    const before = shape(board)
    await say('open daily charts for aapl msft nvda, each with a 50sma')
    await say('make them weekly')
    expect(charts(board).slice(1).map(w => h.charts.read(w.id).tf)).toEqual(['W', 'W', 'W'])
    for (let i = 0; i < 6 && charts(board).length > 1; i++) await say('undo')
    expect(shape(board)).toBe(before)
    expect(h.charts.read('c').symbol).toBe('BRCB')
    expect(p.turns()).toBe(0)
  }, 60000)

  it('9 · duplicates are prevented, an explicit copy is made', async () => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add the 9 ema')
    const again = await say('add the 9 ema')
    expect(again).toMatch(/already/i)
    expect(emas(board, 'c').map(([n]) => n)).toEqual([9])
    await say('add another 9 ema')
    expect(emas(board, 'c').map(([n]) => n)).toEqual([9, 9])
  }, 40000)

  it('10 · Phase 2 intact — its three live acceptance requests, exactly as typed', async () => {
    controls('c')
    const { say, board, h } = p.mount(...ONE('BRCB'))
    await say('throw the 9 and 20 ema on my chart. make the fast one green and the other one yellow')
    expect(emas(board, 'c')).toEqual([[9, GREEN], [20, YELLOW]])
    await say('undo all of that')
    expect(emas(board, 'c')).toEqual([])
    const before = shape(board)
    await say('open daily charts for aapl msft nvda, each with a 50sma')
    expect(charts(board).map(w => h.charts.read(w.id).symbol)).toEqual(['BRCB', 'AAPL', 'MSFT', 'NVDA'])
    expect(charts(board).map(w => [w.x, w.y, w.w, w.h])).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    await say('undo all of that')
    expect(shape(board)).toBe(before)
    expect(await say('Show me how to change the timeframe')).toMatch(/I’ve highlighted it/)
    await waitFor(() => expect(cardText()).toMatch(/These buttons switch this chart’s timeframe/))
    expect(p.turns()).toBe(0)
  }, 90000)
})
