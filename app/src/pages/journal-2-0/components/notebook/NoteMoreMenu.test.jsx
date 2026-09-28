// Wave 10 lane K2, fix round 1 (review I-1): "More note actions" stays on screen.
// Measured in a browser before the fix (docs/notebook/evidence/d3-controls-2026-09-28/
// more-panel-before.json): at 390 px on a LOCKED note the panel spanned x -75..185, and pressing
// Lock inside the open panel made it jump there from x 35. jsdom lays nothing out, so these rails
// feed the panel the MEASURED boxes and assert the shift the component applies; the verdict is the
// after measurement beside the before one.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import NoteMoreMenu, { onScreenShift, PANEL_GUTTER } from './NoteMoreMenu'

const realRect = HTMLElement.prototype.getBoundingClientRect
const realWidth = window.innerWidth
afterEach(() => {
  cleanup()
  HTMLElement.prototype.getBoundingClientRect = realRect
  Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true, writable: true })
})

/** The panel reports `box()` (its UNshifted span); everything else lays out as jsdom does. */
function measurePanelAs(box) {
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    if (this.getAttribute('role') === 'group' && this.getAttribute('aria-label') === 'More note actions') {
      const [left, right] = box()
      return { left, right, top: 450, bottom: 900, width: right - left, height: 450, x: left, y: 450 }
    }
    return realRect.call(this)
  }
}
const viewport = (w) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })
const panel = () => document.getElementById(screen.getByRole('button', { name: 'More note actions' }).getAttribute('aria-controls'))

describe('onScreenShift', () => {
  it('moves a box that starts left of the gutter right, by exactly the overhang', () => {
    expect(onScreenShift(-75, 185, 390)).toBe(PANEL_GUTTER + 75)
  })
  it('moves a box that ends past the right gutter left', () => {
    expect(onScreenShift(200, 400, 390)).toBe(390 - PANEL_GUTTER - 400)
  })
  it('leaves a box already inside the gutter alone (the measured 390 unlocked case, x 35..295)', () => {
    expect(onScreenShift(35, 295, 390)).toBe(0)
  })
  it('a box wider than the room keeps its LEFT edge on screen', () => {
    expect(onScreenShift(-10, 500, 390)).toBe(PANEL_GUTTER + 10)
  })
})

describe('<NoteMoreMenu> keeps its panel on screen', () => {
  it('the measured LOCKED case at 390 (x -75..185) opens shifted wholly on screen', () => {
    viewport(390)
    measurePanelAs(() => [-75, 185])
    render(<NoteMoreMenu><button type="button">Delete</button></NoteMoreMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    expect(panel().style.transform).toBe('translateX(91px)')   // -75 + 91 = 16, the gutter
  })

  it('Lock while open: a re-render that moves the door re-places the panel (it used to jump off screen)', () => {
    viewport(390)
    let span = [35, 295]
    measurePanelAs(() => span)
    const { rerender } = render(<NoteMoreMenu><button type="button">Lock</button></NoteMoreMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    expect(panel().style.transform).toBe('')
    span = [-75, 185]                                          // Writing help unmounted; the door moved
    rerender(<NoteMoreMenu><button type="button">Unlock</button></NoteMoreMenu>)
    expect(panel().style.transform).toBe('translateX(91px)')
    span = [35, 295]                                          // and back: no stale shift is kept
    rerender(<NoteMoreMenu><button type="button">Lock</button></NoteMoreMenu>)
    expect(panel().style.transform).toBe('')
  })

  it('a window resize while open re-places it', () => {
    viewport(820)
    let span = [397, 657]
    measurePanelAs(() => span)
    render(<NoteMoreMenu><button type="button">Delete</button></NoteMoreMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    expect(panel().style.transform).toBe('')
    viewport(390)
    span = [-75, 185]
    fireEvent(window, new Event('resize'))
    expect(panel().style.transform).toBe('translateX(91px)')
  })

  it('CONTROL: a closed panel is never measured or moved', () => {
    viewport(390)
    const seen = vi.fn(() => [-75, 185])
    measurePanelAs(seen)
    render(<NoteMoreMenu><button type="button">Delete</button></NoteMoreMenu>)
    expect(seen).not.toHaveBeenCalled()
    expect(panel().style.transform).toBe('')
  })
})
