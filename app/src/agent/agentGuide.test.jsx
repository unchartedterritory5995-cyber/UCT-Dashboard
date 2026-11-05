// PHASE 2 Workstream B — EXPLAIN · SHOW ME · DO IT FOR ME, through the REAL panel (AgentPanel + useAgent + registry,
// planner, runtime, receipts and Undo) over a fixture board, with the board's controls present in the document as the
// product renders them (their `data-guide` targets — agentGuideTargets.test.js rails that every one is real).
// jsdom lays nothing out, so each control is given a box. Stand-in: the Agent model (none of these turns reaches it).
//
//   E  explain        teaches; never changes the board; no model call for UCT's own terms
//   S  show me        highlights the real control, step by step; never changes the board; says when it cannot see it;
//                     waits for the member's own click; ends when its control is gone; Escape / Exit / Done
//   D  do it for me   the feature's existing capability on the chart that was shown — asked, receipted, undoable
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { _resetGuide } from './guide/guideStore'
import { LOST_MS } from './guide/placement'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  _resetGuide()
  // every element that is in the document has a box (jsdom lays nothing out)
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); vi.restoreAllMocks(); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

/** The board's controls as the product renders them, for the charts given (data-widget-id = the chart ref). */
function controls(chartIds = ['c']) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `
    <button data-guide="workspace.widgets">Widgets ▾</button>
    <div data-guide="workspace.layouts" role="toolbar" aria-label="Saved layouts"><button data-guide="workspace.layoutLibrary" aria-label="Layout library">+</button></div>
    ${chartIds.map(id => `
      <div data-widget-id="${id}" data-widget-type="chart">
        <div data-guide="chart.symbol">sym</div>
        <div data-guide="chart.timeframe"><button>D</button><button>W</button></div>
        <button data-guide="chart.timeframeMore" aria-label="More timeframes">v</button>
        <button data-guide="chart.settings" aria-label="Chart settings">gear</button>
        <div data-guide="chart.drawingTools"><button data-guide="chart.tool.trendline">t</button><button data-guide="chart.tool.horizontal">h</button></div>
      </div>`).join('')}`
  document.body.appendChild(root)
  return root
}
const card = () => screen.queryByTestId('guide-card')
const cardText = () => screen.queryByTestId('guide-text')?.textContent || ''
const boardJson = (board) => JSON.stringify(board.state.widgets)

// ═══ E — explain ═════════════════════════════════════════════════════════════════════════════════════════
describe('E · Explain teaches and changes nothing', () => {
  // UCT's OWN meanings — its concepts, features AND its catalog's indicators (owner decision 2026-10-29) — are answered
  // instantly in UCT's own words; anything more stays the model's. Either way nothing on the board changes.
  it.each([
    ["What's the difference between a chart indicator and a condition?", /An indicator draws VALUES on the chart.*A condition is a true\/false rule/],
    ['what is a layout?', /A layout is a saved board/],
    ['what are link colours', /Widgets in the same colour share a symbol/],
    ['explain the drawing tools', /The drawing tools run along the chart’s toolbar/],
    // the catalog's own rows (components/chart/indicatorCatalog) — name, short name or tag, exactly one
    ['What is RSI?', /RSI \(Relative Strength Index\) — Momentum on a 0-100 scale/],
    ['Explain RSI', /RSI \(Relative Strength Index\) — Momentum on a 0-100 scale/],
    ['What does ADR mean?', /ADR % — Average daily range/],
    ['What is MACD?', /MACD — The gap between two moving averages/],
    ['What is an EMA?', /EMA is one of the types of UCT’s Moving Average indicator, chosen in its “Type” setting\. Moving Average: The average of any series/],
    ['rsi vs macd', /RSI: Momentum.*MACD: The gap between two moving averages/],
  ])('%s', async (q, want) => {
    const { board, say } = p.mount(...ONE())
    const before = boardJson(board)
    const out = await say(q)
    expect(out).toMatch(want)
    expect(boardJson(board)).toBe(before)
    expect(p.turns()).toBe(0)
    expect(card()).toBeNull()
    expect(p.summaries()).toEqual([])                                   // no receipt: nothing was done
  }, 30000)

  // the catalog names no single row (a comparison of two types of one indicator, a term it lacks) or the question asks
  // for more than what the indicator is → the model
  it.each(['what is the difference between an ema and an sma', 'what does a dead cat bounce mean?', 'what is rsi telling me about nvda right now', "what's a good setting for rsi on the 5 minute"])(
    'more than the catalog says goes to the model, which answers — nothing is invented locally and nothing changes: %s', async (q) => {
      const { board, say } = p.mount(...ONE())
      const before = boardJson(board)
      p.st.envelopes.push(p.env('answer', [], 'A model answer.'))
      const out = await say(q)
      expect(p.turns()).toBe(1)
      expect(out).toMatch(/A model answer\./)
      expect(boardJson(board)).toBe(before)
      expect(p.summaries()).toEqual([])
    }, 30000)
  it("the model can ask for UCT's own catalog wording (guide.explain) — a query: an answer, no receipt, no change", async () => {
    const { board, say } = p.mount(...ONE())
    const before = boardJson(board)
    // routed with the guide group when the model asks for it; here the model plans guide.explain on the guide entry
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'guide.explain', target: (body.context.guide || [{ ref: 'g1' }])[0].ref, args: { topic: 'ADR' } }]))
    await say('walk me through what ADR means in UCT')
    await waitFor(() => expect(p.transcript()).toMatch(/Average daily range/))
    expect(boardJson(board)).toBe(before)
    expect(p.summaries()).toEqual([])
  }, 30000)
})

// ═══ S — show me ═════════════════════════════════════════════════════════════════════════════════════════
describe('S · Show me highlights the real control and changes nothing', () => {
  it('S1 "Where do I change the timeframe?" — the real timeframe bar, two steps, Next / Done; the board is untouched', async () => {
    controls(['c'])
    const { board, h, say, click } = p.mount(...ONE())
    const before = boardJson(board)
    const out = await say('Where do I change the timeframe?')
    expect(out).toMatch(/I’ve highlighted it — follow the card .* Nothing on your board has changed\./)
    await waitFor(() => expect(cardText()).toMatch(/These buttons switch this chart’s timeframe/))
    expect(screen.getByTestId('guide-ring')).toBeTruthy()
    expect(card().textContent).toMatch(/1 of 2/)
    await click('Next')
    await waitFor(() => expect(cardText()).toMatch(/Every other timeframe/))
    await click('Done')
    expect(card()).toBeNull()
    expect(boardJson(board)).toBe(before)
    expect(h.charts.read('c').tf).not.toBe('W')
    expect(p.turns()).toBe(0)
  }, 30000)

  it('S2 several charts: the walkthrough is on the chart the member clicked, and says which', async () => {
    controls(['cl', 'cr'])
    p.select('cr')
    const { say } = p.mount(...TWO())
    const out = await say('show me how to change the symbol')
    expect(out).toMatch(/I’ve highlighted it on Chart \(AMD\)/)
    await waitFor(() => expect(cardText()).toMatch(/Click the symbol name/))
  }, 30000)

  it('S3 a control that is NOT on screen is never claimed — it says so and explains instead', async () => {
    const { say } = p.mount(...ONE())                                   // no controls rendered
    const out = await say('where do i change the timeframe')
    expect(out).toMatch(/I can’t see the timeframe control on your screen right now/)
    expect(out).toMatch(/The timeframe is how much time each bar covers/)
    expect(card()).toBeNull()
  }, 30000)

  it('S4 a step that needs the member: "open the gear" waits for THEIR click (the settings opening), then moves on by itself', async () => {
    const root = controls(['c'])
    const { say } = p.mount(...ONE())
    await say('show me where to add an indicator')
    await waitFor(() => expect(cardText()).toMatch(/Open this chart’s settings with the gear/))
    expect(card().textContent).toMatch(/Skip/)
    // the member clicks the gear: Chart settings opens (as ChartSettingsModal renders it)
    const modal = document.createElement('div')
    modal.setAttribute('data-guide', 'chartSettings')
    modal.innerHTML = '<button data-guide="chartSettings.tab.indicators">Indicators</button>'
    act(() => { root.appendChild(modal) })
    await waitFor(() => expect(cardText()).toMatch(/Open the Indicators tab/), { timeout: 3000 })
    // …and the Indicators tab: its search box appears
    act(() => { modal.insertAdjacentHTML('beforeend', '<input aria-label="Search indicators" />') })
    await waitFor(() => expect(cardText()).toMatch(/Search for an indicator and add it/), { timeout: 3000 })
    expect(p.turns()).toBe(0)
  }, 30000)

  it('S4b context-aware: with Chart settings ALREADY open on the Indicators tab, the walkthrough starts at its search box — never "open the gear"', async () => {
    const root = controls(['c'])
    const modal = document.createElement('div')
    modal.setAttribute('data-guide', 'chartSettings')
    modal.innerHTML = '<button data-guide="chartSettings.tab.indicators">Indicators</button><input aria-label="Search indicators" />'
    root.appendChild(modal)
    const { say } = p.mount(...ONE())
    const out = await say('how do I add an indicator?')
    expect(out).toMatch(/You’re already part of the way there, so I started from where you are\./)
    await waitFor(() => expect(cardText()).toMatch(/Search for an indicator and add it/))
  }, 30000)

  it('S5 the control disappears mid-walkthrough → the guide stops and says why (never points at nothing)', async () => {
    const root = controls(['c'])
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    act(() => { root.querySelector('[data-widget-id="c"]').remove() })
    await waitFor(() => expect(card()).toBeNull(), { timeout: LOST_MS + 3000 })
    expect(screen.getByTestId('guide-notice').textContent).toMatch(/I can’t see that control on screen any more/)
  }, 30000)

  it('S6 Escape and Exit end it; a new walkthrough replaces the old one', async () => {
    controls(['c'])
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })                   // a page-level Escape is not the guide's
    expect(card()).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Exit the guide' }), { key: 'Escape' })   // from inside the card
    await waitFor(() => expect(card()).toBeNull())
    await say('how do i draw a trendline')
    await waitFor(() => expect(cardText()).toMatch(/drawing tools for this chart/))
    await say('how do I save my layout')
    await waitFor(() => expect(cardText()).toMatch(/Your saved layouts/))
    fireEvent.click(screen.getByRole('button', { name: 'Exit the guide' }))
    await waitFor(() => expect(card()).toBeNull())
  }, 30000)

  it('S7 the card never takes a click away from the board: the ring is pointer-events none, the card is not modal', async () => {
    controls(['c'])
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    expect(card().getAttribute('aria-modal')).toBe('false')
    expect(card().hasAttribute('data-escape-layer')).toBe(true)
    expect(document.activeElement && card().contains(document.activeElement)).toBe(false)     // focus stays where it was
  }, 30000)
})

// ═══ D — do it for me ════════════════════════════════════════════════════════════════════════════════════
describe('D · Do it for me runs the existing capability', () => {
  it('D1 "Where do I change the timeframe?" → "Now do it for me" → which timeframe? → Weekly: changed, receipted, undoable', async () => {
    controls(['c'])
    const { h, say, click } = p.mount(...ONE())
    await say('Where do I change the timeframe?')
    const q = await say('Now do it for me')
    expect(q).toMatch(/Which timeframe\? \(on Chart \(QQQ\)\)/)
    expect(card()).toBeNull()                                           // the walkthrough gives way to the action
    await click('Weekly')
    await waitFor(() => expect(h.charts.read('c').tf).toBe('W'))
    expect(p.summaries().join(' ')).toMatch(/Weekly/)
    await say('undo')
    await waitFor(() => expect(h.charts.read('c').tf).not.toBe('W'))
    expect(p.turns()).toBe(0)
  }, 40000)

  it('D2 a feature whose action needs the member\'s words says what to say — nothing runs on a guess', async () => {
    controls(['c'])
    const { board, say } = p.mount(...ONE())
    await say('how do i change the symbol')
    const before = boardJson(board)
    const out = await say('ok do it for me')
    expect(out).toMatch(/Tell me which one — for example “change this chart to NVDA”/)
    expect(boardJson(board)).toBe(before)
  }, 30000)

  it('D3 "do it for me" with no walkthrough shown is NOT a guide action — nothing changes', async () => {
    const { h, say } = p.mount(...ONE())
    const tf = h.charts.read('c').tf
    await say('do it for me')
    expect(h.charts.read('c').tf).toBe(tf)
    expect(card()).toBeNull()
  }, 30000)

  it('D4 a direct command is just done — "Change my chart to the weekly timeframe" (no walkthrough)', async () => {
    controls(['c'])
    const { h, say } = p.mount(...ONE())
    await say('Change my chart to the weekly timeframe')
    await waitFor(() => expect(h.charts.read('c').tf).toBe('W'))
    expect(card()).toBeNull()
    expect(p.turns()).toBe(0)
  }, 30000)

  it('D5 the indicator walkthrough → do it for me → RSI: added through indicator.add (receipt, Undo)', async () => {
    controls(['c'])
    const { board, say, click } = p.mount(...ONE())
    await say('show me where to add an indicator')
    const q = await say('can you do it for me')
    expect(q).toMatch(/Which indicator\?/)
    await click('RSI')
    await waitFor(() => expect(p.instancesOn(board, 'c').some(i => i.defId === 'rsi')).toBe(true))
    expect(p.summaries().join(' ')).toMatch(/RSI/)
  }, 40000)
})
