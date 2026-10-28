// The TickerPopup chart modal through the screen-reader lens (Playwright WebKit + axe walk of
// the live site, iPad landscape and the desktop modal):
//   4. "+ Compare" was named "QQQ -- click to search a different ticker": the wrong action,
//      and without the visible word (WCAG 2.5.3).
//   5. The "Switch ticker" box was a plain textbox over an UNNAMED listbox (axe
//      aria-input-field-name, serious): no combobox semantics, no active option, no count,
//      and Escape with suggestions open closed the whole popup, not the list.
import { renderWithProviders, render, screen, fireEvent, waitFor, within } from '../test-utils'
import { vi, test, expect, describe, beforeEach } from 'vitest'
import { expectNoAxeViolations } from '../pages/journal-2-0/a11y/axeHarness'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane-stub" /> }))

import TickerPopup from './TickerPopup'
import ChartContextMenu from './chart/ChartContextMenu'

const RESULTS = [
  { ticker: 'NVDA', name: 'NVIDIA Corp' },
  { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA' },
  { ticker: 'NVO', name: 'Novo Nordisk' },
]

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/ticker-search')) return { ok: true, json: async () => ({ results: RESULTS }) }
    return { ok: true, json: async () => ({}) }
  })
})

function openPopup(onClose = vi.fn()) {
  renderWithProviders(<TickerPopup sym="QQQ" open onClose={onClose} />)
  return { onClose, dialog: screen.getByRole('dialog', { name: 'QQQ chart' }) }
}

async function typeAndWait(box, text) {
  fireEvent.change(box, { target: { value: text } })
  return screen.findByRole('listbox', { name: 'Ticker suggestions' })
}

describe('Switch ticker is an ARIA combobox', () => {
  test('combobox semantics: role, autocomplete, controls, collapsed until there are suggestions', () => {
    openPopup()
    const box = screen.getByRole('combobox', { name: /Switch ticker/ })
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box.getAttribute('aria-controls')).toBeTruthy()
    expect(box).not.toHaveAttribute('aria-activedescendant')
  })

  test('typing opens a NAMED listbox the combobox controls, and the count is announced', async () => {
    openPopup()
    const box = screen.getByRole('combobox', { name: /Switch ticker/ })
    // the status region is mounted, empty, BEFORE any suggestion exists: a live region
    // inserted together with its text is often never announced
    const status = screen.getByTestId('switch-ticker-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveTextContent('')
    const list = await typeAndWait(box, 'NV')
    expect(screen.getByTestId('switch-ticker-status')).toBe(status)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(list.id).toBe(box.getAttribute('aria-controls'))
    expect(within(list).getAllByRole('option')).toHaveLength(3)
    expect(status).toHaveTextContent('3 suggestions')
  })

  test('ArrowDown points aria-activedescendant at the arrowed-to option; options are not Tab stops', async () => {
    openPopup()
    const box = screen.getByRole('combobox', { name: /Switch ticker/ })
    const list = await typeAndWait(box, 'NV')
    const opts = within(list).getAllByRole('option')
    for (const o of opts) expect(o).toHaveAttribute('tabindex', '-1')
    // Enter takes the TYPED symbol until a row is arrowed to, so nothing is active yet
    expect(box).not.toHaveAttribute('aria-activedescendant')
    expect(opts.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(0)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box).toHaveAttribute('aria-activedescendant', opts[1].id)
    expect(opts[1]).toHaveAttribute('aria-selected', 'true')
  })

  test('the first Escape closes the suggestions and NOT the popup; the next one closes the popup', async () => {
    const { onClose } = openPopup()
    const box = screen.getByRole('combobox', { name: /Switch ticker/ })
    await typeAndWait(box, 'NV')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('an IME composition owns Enter and Escape until it commits', async () => {
    const { onClose } = openPopup()
    const box = screen.getByRole('combobox', { name: /Switch ticker/ })
    await typeAndWait(box, 'NV')
    fireEvent.keyDown(box, { key: 'Escape', isComposing: true })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    // Enter during composition did not pick: the box still holds the text and the list
    expect(box).toHaveValue('NV')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // once composition ends, the same keys behave as before
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('Escape from an idle box still closes the popup (unchanged)', () => {
    const { onClose } = openPopup()
    fireEvent.keyDown(screen.getByRole('combobox', { name: /Switch ticker/ }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Escape belongs to the TOP layer (Chart Settings opened over the popup)', () => {
  // Chart Settings, the symbol search, a confirm: each is a modal dialog portaled to <body>
  // AFTER the popup. Escape there used to close that layer AND the popup in one keystroke.
  function openLayerAbove({ inertBeneath = false } = {}) {
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('aria-modal', 'true')
    layer.setAttribute('aria-label', 'Chart settings')
    const btn = document.createElement('button')
    btn.textContent = 'Done'
    layer.appendChild(btn)
    document.body.appendChild(layer)
    // what fix/chart-a11y's inertBeneath() does: everything under the top layer goes inert
    const popupRoot = screen.getByTestId('chart-modal')
    if (inertBeneath) popupRoot.setAttribute('inert', '')
    return { layer, btn, close: () => { layer.remove(); popupRoot.removeAttribute('inert') } }
  }

  test('a modal dialog above the popup owns Escape; the popup stays open', () => {
    const { onClose } = openPopup()
    const { btn, close } = openLayerAbove()
    // whether focus is still on the page or inside the layer
    fireEvent.keyDown(document.body, { key: 'Escape' })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    close()
    // once that layer is gone, Escape closes the popup again
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('the popup beneath an inert background never closes on Escape', () => {
    const { onClose } = openPopup()
    const { close, layer } = openLayerAbove({ inertBeneath: true })
    layer.remove()   // only the inert wrapper is left: that alone must hold the popup
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    close()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('a dialog that is mounted but hidden is not a layer', () => {
    const { onClose } = openPopup()
    const { layer, close } = openLayerAbove()
    layer.hidden = true
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    close()
  })

  test('the IME guard still holds', () => {
    const { onClose } = openPopup()
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('+ Compare names its own action', () => {
  test('the name says Compare and names the ticker, never "search a different ticker"', () => {
    openPopup()
    const btn = screen.getByText('+ Compare').closest('button')
    expect(btn).toHaveAccessibleName('Compare QQQ with another ticker')
  })
})

describe('axe', () => {
  test('0 violations in the open modal with suggestions showing', async () => {
    const { dialog } = openPopup()
    await screen.findByTestId('pane-stub')
    await typeAndWait(screen.getByRole('combobox', { name: /Switch ticker/ }), 'NV')
    await waitFor(() => expect(screen.getByTestId('switch-ticker-status')).toHaveTextContent('3 suggestions'))
    await expectNoAxeViolations(dialog)
  }, 30000)
})

describe('a dialog INSIDE the popup is a layer above it too', () => {
  test('Escape with an open modal dialog inside the popup does not close the popup', () => {
    const { onClose, dialog } = openPopup()
    const inner = document.createElement('div')
    inner.setAttribute('role', 'dialog'); inner.setAttribute('aria-modal', 'true')
    dialog.appendChild(inner)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    inner.remove()
  })
})

describe("the chart's OWN non-modal layers inside the popup own Escape too", () => {
  // ChartContextMenu (role=menu), the earnings marker popover (role=dialog WITHOUT aria-modal)
  // and the IPO tag carry [data-escape-layer] -- lib/topLayer.js's one definition of a layer.
  // The popup's own selector used to miss them: right-click, Escape, and the menu AND the
  // popup closed.
  test('the REAL ChartContextMenu opened inside the popup: Escape closes the menu, not the popup', () => {
    const { onClose, dialog } = openPopup()
    const host = document.createElement('div')
    dialog.querySelector('[data-ticker-popup-chart]').appendChild(host)
    const closeMenu = vi.fn()
    render(<ChartContextMenu open x={40} y={40} onClose={closeMenu}
      sections={[{ id: 's', items: [{ id: 'chart-set', label: 'Chart settings…', onSelect: () => {} }] }]} />, { container: host })
    expect(screen.getByRole('menu')).toHaveAttribute('data-escape-layer')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(closeMenu).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a [data-escape-layer] popover inside the popup (non-modal role=dialog) holds it open', () => {
    const { onClose, dialog } = openPopup()
    const pop = document.createElement('div')
    pop.setAttribute('role', 'dialog')          // no aria-modal: the earnings popover's shape
    pop.setAttribute('data-escape-layer', '')
    dialog.appendChild(pop)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    pop.remove()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('a layer under a display:none ANCESTOR, or with visibility:hidden, is not showing and does not count', () => {
    const { onClose } = openPopup()
    const wrap = document.createElement('div')
    wrap.style.display = 'none'
    const hiddenByAncestor = document.createElement('div')
    hiddenByAncestor.setAttribute('data-escape-layer', '')
    wrap.appendChild(hiddenByAncestor)
    const invisible = document.createElement('div')
    invisible.setAttribute('aria-modal', 'true')
    invisible.style.visibility = 'hidden'
    document.body.append(wrap, invisible)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    wrap.remove(); invisible.remove()
  })
})
