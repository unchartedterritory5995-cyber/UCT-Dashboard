// RW-NEW-01 (a11y second review, 2026-10-01, WCAG 2.4.3 Focus Order): the
// chart modal opened without moving focus into itself -- on /dashboard, Tab
// from the trigger walked 26 stops of background page content (the other
// ticker chips, the nav rail, the Compass orb) before ever reaching the
// dialog's own "Switch ticker" field or its Save/Flag/Close buttons.
//
// ⛔ Assert `document.activeElement`, never just that the modal opened -- a
// trap that silently did nothing would still let the existing "shows modal
// on click" test in TickerPopup.test.jsx pass.
import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils'
import { useState } from 'react'
import { vi, test, expect, describe } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/SymbolSearch', () => ({ default: () => null }))
// ChartPane is mocked directly (not just its StockChart child, as
// TickerPopup.test.jsx does) so the dialog's focusable set is small and
// deterministic for focus-ORDER assertions, and the lazy-chunk question
// reduces to one `findByTestId` for the stub itself -- the same idiom
// TickerPopup.anchor.test.jsx already uses. The stub carries one button so
// the trap is proved to reach content behind the Suspense boundary too, not
// just the always-present header chrome.
vi.mock('./chart/pane/ChartPane', () => ({
  default: () => (
    <div data-testid="pane-stub">
      <button type="button">Pane control</button>
    </div>
  ),
}))

import TickerPopup from './TickerPopup'

function dialogFocusable() {
  const dialog = screen.getByRole('dialog')
  return [...dialog.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'
  )]
}
function firstFocusable() { return dialogFocusable()[0] }
async function openAndSettle(triggerEl) {
  fireEvent.click(triggerEl)
  await screen.findByTestId('pane-stub')
}

describe('RW-NEW-01: focus moves into the chart modal on open', () => {
  test('Enter on the trigger moves focus inside the dialog immediately', () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    const trigger = screen.getByTestId('ticker-NVDA')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    // Focus landed on the dialog's FIRST focusable control (never the Close
    // button specifically -- Close sits near the END of the header's action
    // row, which would put the capture buttons many Tabs away again), not
    // left on the trigger and not fallen to <body>.
    expect(document.activeElement).toBe(firstFocusable())
    expect(document.activeElement.closest('[role="dialog"]')).toBeInTheDocument()
    // Document the concrete control, since that is what a real member meets:
    // the always-present "Switch ticker" field (nothing else precedes it in
    // this fixture -- no flow meta, no live price yet, no journal backlinks).
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Switch ticker…'))
  })

  test('a mouse click on the trigger ALSO moves focus inside the dialog', () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    fireEvent.click(screen.getByTestId('ticker-NVDA'))
    expect(document.activeElement).toBe(firstFocusable())
  })

  test('hover never moves focus -- only a real open does', () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    const trigger = screen.getByTestId('ticker-NVDA')
    const before = document.activeElement
    fireEvent.mouseEnter(trigger)
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(before)
  })

  test('focus is not lost when the Suspense fallback is replaced by the real chart', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    fireEvent.click(screen.getByTestId('ticker-NVDA'))
    // Assert immediately, before the lazy chunk has necessarily resolved --
    // this is the moment the original defect (and a naive fix that only
    // focuses in once the chart finishes loading) would differ.
    const focused = firstFocusable()
    expect(document.activeElement).toBe(focused)
    await screen.findByTestId('pane-stub')
    expect(document.activeElement).toBe(focused)
  })
})

describe('RW-NEW-01: reach the capture buttons in a handful of Tabs', () => {
  // ⛔ jsdom does not implement the browser's native Tab-key focus
  // advancement (only this app's own wrap logic moves focus on a boundary
  // Tab -- see `trapTabKey`), so an ordinary forward Tab cannot be simulated
  // with `fireEvent.keyDown` here; that is proved in a real browser instead
  // (`docs/notebook/evidence/a11y-fix-2026-10-01/af3/verify_fixes_af3.py`).
  // What jsdom CAN prove, structurally: the control's DOM-order POSITION
  // relative to where focus lands on open -- which is exactly what a real
  // Tab sequence walks. Before this fix, 0 controls preceded the trigger (it
  // was never reached by Tab at all, and once reachable the modal moved
  // focus nowhere, so the walk continued through 26 BACKGROUND stops). After
  // this fix, the capture button is the 4th focusable control counting from
  // where focus opens -- i.e. 3 real Tabs, not 26.
  test("Save ... current price to Notebook sits within a handful of DOM positions of where focus opens", async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    fireEvent.click(screen.getByTestId('ticker-NVDA'))
    const focusable = dialogFocusable()
    const openIndex = focusable.indexOf(document.activeElement)
    expect(openIndex).toBe(0) // focus opens ON the first control, not before/after it
    const priceIndex = focusable.findIndex(
      (n) => n.getAttribute('aria-label') === "Save NVDA's current price to Notebook")
    expect(priceIndex).toBeGreaterThan(-1)
    expect(priceIndex - openIndex).toBeLessThanOrEqual(6)
  })
})

describe('RW-NEW-01: Tab/Shift+Tab stay inside the dialog', () => {
  test('Tab from the last focusable control wraps to the first', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    await openAndSettle(screen.getByTestId('ticker-NVDA'))
    const focusable = dialogFocusable()
    expect(focusable.length).toBeGreaterThan(1)
    const [first] = focusable
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })

  test('Shift+Tab from the first focusable control wraps to the last', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    await openAndSettle(screen.getByTestId('ticker-NVDA'))
    const focusable = dialogFocusable()
    const [first] = focusable
    const last = focusable[focusable.length - 1]
    first.focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  test('the lazy pane control (behind the Suspense boundary) is reachable in the trap too', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    await openAndSettle(screen.getByTestId('ticker-NVDA'))
    expect(screen.getByRole('button', { name: 'Pane control' })).toBeInTheDocument()
    expect(dialogFocusable()).toContain(screen.getByRole('button', { name: 'Pane control' }))
  })

  test('a full forward walk through every dialog control never reaches a background trigger, and wraps at the end', async () => {
    // ⛔ jsdom does not implement the browser's native Tab-key focus
    // advancement (see the comment on the "handful of Tabs" test above), so
    // a loop of bare `fireEvent.keyDown(..., {key:'Tab'})` from a non-
    // boundary position would be VACUOUS here -- nothing would ever move,
    // and "focus never reached the background trigger" would pass for the
    // wrong reason (nothing moved at all), not because the trap held.
    // Simulate what a real forward Tab does at each step (advance to the
    // next dialog control) and let THIS APP'S OWN capture-phase listener
    // react to the keydown exactly as it would in a browser -- it only ever
    // intervenes at the boundary (the trap's whole job), which is the one
    // point background content could otherwise be reached. A real multi-
    // dozen-Tab walk against a live browser is proved separately:
    // `docs/notebook/evidence/a11y-fix-2026-10-01/af3/verify_fixes_af3.py`.
    renderWithProviders(
      <>
        <TickerPopup sym="NVDA" />
        <TickerPopup sym="SPY" />
      </>
    )
    await openAndSettle(screen.getByTestId('ticker-NVDA'))
    const dialog = screen.getByRole('dialog')
    const spyTrigger = screen.getByTestId('ticker-SPY')
    const focusable = dialogFocusable()
    expect(focusable.length).toBeGreaterThan(2)
    for (const node of focusable) {
      node.focus()
      fireEvent.keyDown(document.activeElement, { key: 'Tab' })
      expect(document.activeElement).not.toBe(spyTrigger)
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    // The walk just pressed Tab FROM the last control -- the trap's wrap
    // already fired, landing back on the first.
    expect(document.activeElement).toBe(focusable[0])
  })
})

describe('RW-NEW-01: Escape returns focus to the invoker (uncontrolled)', () => {
  test('Escape closes the modal and restores focus to the trigger', async () => {
    renderWithProviders(<TickerPopup sym="NVDA" />)
    const trigger = screen.getByTestId('ticker-NVDA')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(document.activeElement).toBe(firstFocusable())
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })
})

describe('RW-NEW-01: controlled mode (open/onClose, no trigger)', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open NVDA chart</button>
        {open && <TickerPopup sym="NVDA" open onClose={() => setOpen(false)} />}
      </>
    )
  }

  test('focus moves into the dialog on open, and returns to the element that had focus before it opened, on close', async () => {
    renderWithProviders(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open NVDA chart' })
    opener.focus()
    await openAndSettle(opener)
    expect(document.activeElement).toBe(firstFocusable())

    fireEvent.click(screen.getByRole('button', { name: 'Close chart' }))
    await waitFor(() => expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(opener)
  })

  test('Tab stays inside a controlled-mode dialog too', async () => {
    renderWithProviders(<Harness />)
    await openAndSettle(screen.getByRole('button', { name: 'Open NVDA chart' }))
    const focusable = dialogFocusable()
    const [first] = focusable
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
  })
})
