// ⭐ RAIL (AUDIT #989 follow-up): Escape with a drawing SELECTED ON DESKTOP. The touch quick bar ("Drawing actions") is not on
// screen there; the selection shows as the chart toolbar's "Delete selected" being enabled (StockChart selectedId →
// ChartToolbar hasSelection). With it enabled, Escape does NOT end the walkthrough and the board still deselects; with nothing
// selected (the button disabled), Escape ends it. The real AgentPanel and GuideOverlay (panelHarness), scripted model.
// LOCAL / SIMULATED.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup, act } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { _resetGuide, guideState, boardOwnsEscape, SELECTED_DRAWING } from './guide/guideStore'

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
afterEach(() => { restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

// the chart as the product renders it on desktop: its toolbar's Delete selected, disabled until a drawing is selected
function board(selected) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `
    <div data-widget-id="c" data-widget-type="chart">
      <div data-guide="chart.timeframe"><button>D</button><button>W</button></div>
      <button data-guide="chart.settings" aria-label="Chart settings">gear</button>
      <div data-guide="chart.drawingTools"><button data-guide="chart.tool.trendline">t</button>
        <button aria-label="Delete selected" title="Delete selected (Del)" ${selected ? '' : 'disabled'}>bin</button></div>
    </div>`
  document.body.appendChild(root)
  return root
}
const card = () => screen.queryByTestId('guide-card')
const settled = () => new Promise(r => setTimeout(r, 60))
const escape = () => { const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); act(() => { document.body.dispatchEvent(ev) }); return ev }

describe('a drawing selected on desktop owns Escape', () => {
  it('the selection signal is the toolbar’s own Delete selected, enabled (and the touch bar still counts)', () => {
    expect(SELECTED_DRAWING).toContain('[aria-label="Delete selected"]:not([disabled])')
    expect(SELECTED_DRAWING).toContain('[aria-label="Drawing actions"]')
  })
  it('selected: Escape leaves the walkthrough on screen, and the chart still deselects', async () => {
    const root = board(true)
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    document.activeElement?.blur?.()
    const bin = root.querySelector('[aria-label="Delete selected"]')
    // the chart's own Escape: it clears the selection (ChartDrawingOverlay deselects), so the toolbar disables its bin
    const deselect = (e) => { if (e.key === 'Escape') bin.setAttribute('disabled', '') }
    document.addEventListener('keydown', deselect)
    restore.push(() => document.removeEventListener('keydown', deselect))
    expect(boardOwnsEscape()).toBe(true)
    escape()
    await settled()
    expect(bin.hasAttribute('disabled')).toBe(true)
    expect(card()).toBeTruthy()
    expect(guideState()).not.toBeNull()
  }, 30000)
  it('nothing selected (the bin disabled): Escape ends the walkthrough', async () => {
    board(false)
    const { say } = p.mount(...ONE())
    await say('where do I change the timeframe?')
    await waitFor(() => expect(card()).toBeTruthy())
    document.activeElement?.blur?.()
    expect(boardOwnsEscape()).toBe(false)
    escape()
    await waitFor(() => expect(card()).toBeNull())
    expect(guideState()).toBeNull()
  }, 30000)
})
