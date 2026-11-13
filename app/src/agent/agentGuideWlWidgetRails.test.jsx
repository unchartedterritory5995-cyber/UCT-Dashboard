// ⭐ RAILS: the watchlist rows taught inside the Charts Watchlist widget (TEACH-WATCHLISTS-WIDGET-DESIGN.md, group A).
//   1. highlight: each walkthrough rings a real control in the widget on its first step
//   2. instruction: the first step names the member's own step (‹ Lists, ⚙, a right-click, a drag) — the Agent changes no mode
//   3. cancel: Exit, Escape and a new request end it, leaving no ring or card
//   4. no write: while it runs and after it ends, no watchlist, board, pref or storage write (fetch writes, persist,
//      localStorage, the board's widgets)
// The real AgentPanel and GuideOverlay (testing/panelHarness) over a fixture widget, scripted model: no model call.
// LOCAL / SIMULATED.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import * as store from './guide/guideStore'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
let setItems
beforeEach(() => {
  p = setupPanel()
  store._resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  const real = Storage.prototype.setItem
  setItems = []
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { setItems.push(k); return real.call(this, k, v) })
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }, () => spy.mockRestore()]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); store._resetGuide() })

// a Watchlist widget showing one of the member's lists, as Watchlists.jsx renders it in pick mode (its own attributes only)
function widget() {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = `
    <button data-guide="workspace.widgets">Widgets ▾</button>
    <div data-widget-id="w1" data-widget-type="watchlist">
      <button data-guide="watchlist.lists" title="Choose a different list">‹ Lists</button>
      <span><span data-guide="watchlist.title">Momentum</span></span>
      <button data-guide="watchlist.listMenu" aria-haspopup="menu" aria-label="List actions">⋯</button>
      <button data-guide="watchlist.addSymbol" aria-label="Add a symbol">+</button>
      <button data-guide="widget.settings" title="Watchlist settings">⚙</button>
      <div><span aria-label="Sort by Symbol">Symbol</span><span aria-label="Sort by Price">Price</span></div>
      <div data-watch-sym="AAPL">AAPL</div>
    </div>`
  document.body.appendChild(root)
  return root
}
const card = () => screen.queryByTestId('guide-card')
const ring = () => screen.queryByTestId('guide-ring')
const text = () => screen.queryByTestId('guide-text')?.textContent || ''
const title = () => card()?.querySelector('span')?.textContent || ''
const writes = () => p.st.calls.filter(([m, u]) => m !== 'GET' && !String(u).startsWith('/api/agent/'))
const STORE_KEY = /watchlist|charts|layout|workspace|pref/i

const CASES = [
  ['how do I start a new watchlist from one of my templates', 'Creating a list from a template', /‹ Lists/],
  ['how do I save my watchlist look as a template', 'A saved watchlist look', /⚙/],
  ['how do I change the colours of my watchlist', 'Changing a watchlist’s look', /⚙/],
  ['how do I see the attention facts for a ticker in my watchlist', 'A ticker’s attention facts', /Right-click/],
  ['how do I drag columns around in my list', 'Reordering a list’s columns', /Drag/],
  // the list's own menu from its title (#1005, #1006): the member right-clicks the list's name or presses ⋯ List actions
  ['how do I change the name of my watchlist', 'Renaming a list', /Right-click the list’s name, or click ⋯ \(List actions\) beside it/],
  ['how do I download my watchlist as a spreadsheet', 'Exporting a list', /Right-click the list’s name, or click ⋯ \(List actions\) beside it/],
  ['how do I get back an older version of my watchlist', 'A list’s version history', /Right-click the list’s name, or click ⋯ \(List actions\) beside it/],
  ['how do I share my watchlist with everyone', 'Sharing a list with the community', /Right-click the list’s name, or click ⋯ \(List actions\) beside it/],
]

describe('watchlist rows in the Charts widget: highlight, instruction, cancel, no write', () => {
  it.each(CASES)('%s → %s: rings a real control, names the member\'s step, and writes nothing', async (q, want, step) => {
    widget()
    const { say, board } = p.mount(...ONE())
    const before = JSON.stringify(board.state.widgets)
    await say(q)
    await waitFor(() => expect(card()).toBeTruthy())
    expect(title()).toBe(want)
    await waitFor(() => expect(ring()).toBeTruthy())
    expect(text()).toMatch(step)
    expect(writes()).toEqual([])
    expect(setItems.filter(k => STORE_KEY.test(k))).toEqual([])
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    fireEvent.click(screen.getByLabelText('Exit the guide'))
    await waitFor(() => expect(card()).toBeNull())
    expect(ring()).toBeNull()
    expect(writes()).toEqual([])
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  })

  it('Escape on the board ends it, with nothing left on screen', async () => {
    widget()
    const { say } = p.mount(...ONE())
    await say(CASES[2][0])
    await waitFor(() => expect(card()).toBeTruthy())
    document.activeElement?.blur?.()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    await waitFor(() => expect(card()).toBeNull())
    expect(ring()).toBeNull()
  })

  it('a new request ends it', async () => {
    widget()
    const { say } = p.mount(...ONE())
    await say(CASES[4][0])
    await waitFor(() => expect(title()).toBe(CASES[4][1]))
    await say(CASES[3][0])
    await waitFor(() => expect(title()).toBe(CASES[3][1]))
    expect(writes()).toEqual([])
  })
})
