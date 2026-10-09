// Fin polish: the desktop Ask panel hangs from whichever edge of its toggle keeps it inside
// the ancestor that clips it. Measured on production 2026-10-08 (both evidence folders under
// docs/notebook/evidence/prod-ask/): on a note page the right-hung 400 px panel reached ~150 px
// past the scrolling note pane's left edge and its first ~60 px rendered under the folder
// sidebar ("s note", "ode is QX-7731"). On Research Home the toggle sits at the far right and
// right-hanging is correct. jsdom lays nothing out, so the geometry is stubbed per element and
// the pure chooser is railed on its own.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('../../../../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

import AskPanel from './AskPanel'
import { choosePanelAnchor, clipBoundaryOf } from './askPanelAnchor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const rect = (left, right) => ({ left, right, top: 0, bottom: 300, width: right - left, height: 300 })

describe('choosePanelAnchor (pure)', () => {
  it('right-hung panel inside its boundary: stays hung from the right', () => {
    expect(choosePanelAnchor({ panel: rect(700, 1100), bound: rect(347, 1235), toggleLeft: 1040 })).toBe('end')
  })
  it('the production note-page shape: panel crosses the pane\'s left edge, left-hung fits -> start', () => {
    // toggle at x=597..652, panel hung right = 252..652, pane = 347..1235
    expect(choosePanelAnchor({ panel: rect(252, 652), bound: rect(347, 1235), toggleLeft: 597 })).toBe('start')
  })
  it('crosses the left edge but left-hung would cross the right edge too: keeps the default', () => {
    expect(choosePanelAnchor({ panel: rect(-50, 350), bound: rect(0, 360), toggleLeft: 300 })).toBe('end')
  })
  it('no boundary (jsdom, no ancestor): the default', () => {
    expect(choosePanelAnchor({ panel: rect(252, 652), bound: null, toggleLeft: 597 })).toBe('end')
  })
})

describe('clipBoundaryOf', () => {
  it('returns the nearest ancestor whose overflow-x is not visible, else the viewport', () => {
    const outer = document.createElement('div')
    outer.style.overflowX = 'auto'
    const inner = document.createElement('div')
    const leaf = document.createElement('div')
    inner.appendChild(leaf); outer.appendChild(inner); document.body.appendChild(outer)
    vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue(rect(347, 1235))
    expect(clipBoundaryOf(leaf)).toMatchObject({ left: 347, right: 1235 })
    const loose = document.createElement('div')
    document.body.appendChild(loose)
    expect(clipBoundaryOf(loose)).toMatchObject({ left: 0 })
    outer.remove(); loose.remove()
  })
})

function openPanel({ paneRect, panelRect, toggleRect }) {
  // A scrolling pane (the note pane's overflow-y:auto clips x too) around the real AskPanel.
  const pane = document.createElement('div')
  pane.style.overflowX = 'auto'
  pane.setAttribute('data-testid', 'pane')
  document.body.appendChild(pane)
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(paneRect)
  // Geometry per element, by role: the dialog is the panel; its parent is the toggle's wrap.
  const orig = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this === pane) return paneRect
    if (this.getAttribute?.('role') === 'dialog') return panelRect
    if (this.querySelector?.('[role="dialog"]') && this.parentElement === pane) return toggleRect
    return orig.call(this)
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
  render(<AskPanel scope="note" target="n1" autoOpen onOpenNote={vi.fn()} />, { container: pane })
  return screen.getByRole('dialog')
}

describe('PanelShell on desktop', () => {
  it('the production note-page shape hangs the panel from the left (data-anchor=start)', () => {
    const dialog = openPanel({ paneRect: rect(347, 1235), panelRect: rect(252, 652), toggleRect: rect(597, 652) })
    expect(dialog).toHaveAttribute('data-anchor', 'start')
    expect(dialog.className).toMatch(/panelStart/)
  })
  it('CONTROL: a panel that already fits keeps the right anchoring', () => {
    const dialog = openPanel({ paneRect: rect(347, 1235), panelRect: rect(700, 1100), toggleRect: rect(1040, 1100) })
    expect(dialog).toHaveAttribute('data-anchor', 'end')
    expect(dialog.className).not.toMatch(/panelStart/)
  })
})
