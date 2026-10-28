// The TickerPopup chart modal through the screen-reader lens (Playwright WebKit + axe walk of
// the live site, iPad landscape and the desktop modal):
//   4. "+ Compare" was named "QQQ -- click to search a different ticker": the wrong action,
//      and without the visible word (WCAG 2.5.3).
//   5. The "Switch ticker" box was a plain textbox over an UNNAMED listbox (axe
//      aria-input-field-name, serious): no combobox semantics, no active option, no count,
//      and Escape with suggestions open closed the whole popup, not the list.
import { renderWithProviders, screen, fireEvent, waitFor, within } from '../test-utils'
import { vi, test, expect, describe, beforeEach } from 'vitest'
import { expectNoAxeViolations } from '../pages/journal-2-0/a11y/axeHarness'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane-stub" /> }))

import TickerPopup from './TickerPopup'

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
    const onPick = vi.fn()
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
    expect(onPick).not.toHaveBeenCalled()
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
