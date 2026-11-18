// ⭐ RAIL: a menu row the product offers only when it is on for this member (a layout's Version history, while the server's
// version store is off). The step that opens the menu knows it (`absent`): with the menu open and the row not in it, the guide
// says so and ends, instead of waiting on a row that will not come. With the row there, it carries on as designed. A step
// without `absent` (a menu whose rows differ by where it was opened) never ends this way. LOCAL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import GuideOverlay, { ABSENT_MS } from './guide/GuideOverlay'
import { startGuide, guideState, _resetGuide } from './guide/guideStore'
import { POLL_MS } from './guide/placement'
import { LAYOUT_ACTIONS } from './guide/actions'

const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
let restore = []
beforeEach(() => {
  _resetGuide()
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

const F = { id: 'layoutAction', title: 'A layout’s version history', control: 'your layouts bar' }
const dom = (html) => { const d = document.createElement('div'); d.setAttribute('data-fixture', ''); d.innerHTML = html; document.body.appendChild(d); return d }
const notice = () => screen.queryByTestId('guide-notice')?.textContent || ''
const BAR = '<div data-guide="workspace.layouts"><button data-layout-pin="1" title="Swing">Swing</button></div>'
const MENU = (rows) => `<div data-guide="workspace.layoutMenu" role="menu">${rows}</div>`
const history = LAYOUT_ACTIONS.find(r => r.id === 'history').steps

describe('a menu row that is not offered here', () => {
  it('the Version history step carries what is true when its row is not offered', () => {
    expect(history[0].absent).toMatch(/^Version history isn’t in that menu for you right now/)
  })
  it('menu open, row absent: said and ended (no ring, no waiting)', async () => {
    const root = dom(BAR)
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: history }) })
    await waitFor(() => expect(guideState()).not.toBeNull())
    act(() => { root.insertAdjacentHTML('beforeend', MENU('<button data-menu-id="rename">Rename layout</button><button data-menu-id="duplicate">Duplicate layout</button>')) })
    await waitFor(() => expect(guideState()).toBeNull(), { timeout: ABSENT_MS + 2000 })
    expect(notice()).toMatch(/^Version history isn’t in that menu for you right now/)
    expect(screen.queryByTestId('guide-ring')).toBeNull()
  })
  it('menu open, row there: the walkthrough moves on to it', async () => {
    const root = dom(BAR)
    render(<GuideOverlay />)
    act(() => { startGuide(F, { steps: history }) })
    await waitFor(() => expect(guideState()?.index).toBe(0))
    act(() => { root.insertAdjacentHTML('beforeend', MENU('<button data-menu-id="history">Version history</button>')) })
    await waitFor(() => expect(guideState()?.index).toBe(1))
  })
  it('a step without `absent` keeps waiting when its menu opens without the row', async () => {
    const root = dom(BAR)
    render(<GuideOverlay />)
    const steps = history.map(({ absent, ...s }) => s)
    act(() => { startGuide(F, { steps }) })
    act(() => { root.insertAdjacentHTML('beforeend', MENU('<button data-menu-id="rename">Rename layout</button>')) })
    await new Promise(r => setTimeout(r, ABSENT_MS + POLL_MS * 4))
    expect(guideState()).not.toBeNull()
  })
})
