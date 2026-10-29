// PHASE 2 — both workstreams together, through the REAL panel: natural-language follow-ups (conversation.js,
// compound.js) and the product guide (Explain / Show me / Do it for me). The conversations of the overnight brief's
// Phase 5, end to end, with what each turn must and must not do:
//   • Explain never mutates   • Show me never executes   • Do it for me uses the canonical capabilities
//   • follow-ups resolve on the live board   • Undo still works   • no model call where UCT can read it itself
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, FOUR } from './testing/panelHarness'
import { _resetGuide } from './guide/guideStore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  p = setupPanel()
  _resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = () => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }
})
afterEach(() => { restore(); vi.restoreAllMocks(); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

function controls(chartIds) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = chartIds.map(id => `
    <div data-widget-id="${id}" data-widget-type="chart">
      <div data-guide="chart.symbol">sym</div>
      <div data-guide="chart.timeframe"><button>D</button></div>
      <button data-guide="chart.timeframeMore">v</button>
      <button data-guide="chart.settings">gear</button>
    </div>`).join('')
  document.body.appendChild(root)
}
const card = () => screen.queryByTestId('guide-card')
const rsi = (board, id) => p.instancesOn(board, id).filter(i => i.defId === 'rsi')

describe('Phase 2 — the brief\'s integrated conversations', () => {
  it('"Show me where to change my timeframe." → "Now do it for me." → Weekly — shown first (nothing changed), then done through chart.setTimeframe, undoable', async () => {
    controls(['c'])
    const { h, say, click } = p.mount(...ONE())
    const tf = h.charts.read('c').tf
    await say('Show me where to change my timeframe.')
    await waitFor(() => expect(card()).toBeTruthy())
    expect(h.charts.read('c').tf).toBe(tf)                              // Show me never executes
    await say('Now do it for me.')
    await click('Weekly')
    await waitFor(() => expect(h.charts.read('c').tf).toBe('W'))
    await say('undo')
    await waitFor(() => expect(h.charts.read('c').tf).toBe(tf))
    expect(p.turns()).toBe(0)
  }, 40000)

  it('"Explain RSI." (the model) → "Add RSI to this chart." → "Make that indicator green." → "Show me how to change its settings." — each does exactly its job', async () => {
    controls(['c'])
    const { board, say } = p.mount(...ONE())
    p.st.envelopes.push(p.env('answer', [], 'RSI measures momentum on a 0–100 scale.'))
    await say('Explain RSI.')
    expect(rsi(board, 'c')).toHaveLength(0)                              // Explain never mutates
    await say('Add RSI to this chart.')
    expect(rsi(board, 'c')).toHaveLength(1)
    const out = await say('Make that indicator green.')
    expect(out).toMatch(/Changed RSI \(14\)'s colour on Chart \(QQQ\) to #2faf68/)
    await say('Show me how to change its settings.')
    await waitFor(() => expect(card()).toBeTruthy())
    expect(rsi(board, 'c')).toHaveLength(1)
    expect(p.turns()).toBe(1)                                            // only the general explanation asked the model
  }, 40000)

  it('"Create four charts for SPY, QQQ, NVDA and TSLA and make them daily." → "Now put the same indicators on the others." — after RSI on the first', async () => {
    const { board, h, say } = p.mount(...ONE())
    await say('Create four charts for SPY, QQQ, NVDA and TSLA and make them daily.')
    const ids = board.state.widgets.filter(w => w.type === 'chart').map(w => w.id)
    expect(ids).toHaveLength(4)
    for (const c of h.charts.list()) expect(c.tf).toBe('D')
    await say(`add rsi to the top left chart`)
    expect(rsi(board, ids[0])).toHaveLength(1)
    await say('Now put the same indicators on the others.')
    for (const id of ids) expect(rsi(board, id), id).toHaveLength(1)
    expect(p.turns()).toBe(0)
  }, 60000)

  it('a guide walkthrough and a follow-up never step on each other: "the first one" after a walkthrough is still the indicator', async () => {
    controls(['c0', 'c1', 'c2', 'c3'])
    p.select('c0')
    const { board, say } = p.mount(...FOUR())
    await say('add the 9 and 20 ema')
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    await say('make the first one green')
    const ema9 = p.instancesOn(board, 'c0').find(i => i.inputs?.period === 9)
    expect(ema9.inputs.color).toBe('#2faf68')
  }, 40000)
})
