// Lane FIN-A11Y (review R4, I-3): in Holdings the thesis chip used to be a <button>
// (and, when open, an <a>) INSIDE the row's <a>. Interactive content inside a link is
// invalid HTML and VoiceOver reads the row link as one element, so the chip could not be
// reached. With a chip the row is now a plain container: the link COVERS the row as a
// sibling of the content, and the chip sits above it.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HoldingsList from './HoldingsList'

vi.mock('../hooks/useHoldingsSparklines', () => ({
  default: () => ({ closes: {}, loading: false }),
}))
vi.mock('../../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid={'logo-' + sym} />,
}))
vi.mock('./OptionsBoard', () => ({ default: () => null }))

const chipState = { on: true }
vi.mock('../hooks/useThesisChips', () => ({
  default: () => ({
    chips: chipState.on
      ? { AAPL: { noteId: 'n1', title: 'AAPL plan', thesisStatus: 'active', entry: 100, stop: 95, target: 130, link: '/journal/notebook?note=n1' } }
      : {},
  }),
}))
vi.mock('../lib/thesisChips', async (orig) => ({
  ...(await orig()),
  thesisChipsEnabled: () => chipState.on,
}))

const positions = [
  { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
  { id: 2, symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' },
]
const prices = {
  AAPL: { price: 110, change_pct: 2, prev_close: 107.84 },
  TSLA: { price: 190, change_pct: -1, prev_close: 191.92 },
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
const renderList = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route
        path="*"
        element={<><HoldingsList positions={positions} optionStrategies={[]} prices={prices} /><Where /></>}
      />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => { localStorage.clear(); chipState.on = true })

describe('HoldingsList -- a row with a thesis chip (I-3)', () => {
  it('nests no interactive element inside the row link', () => {
    renderList()
    const link = screen.getByRole('link', { name: 'AAPL position detail' })
    expect(link).toHaveAttribute('href', '/journal-2-0/position/AAPL')
    expect(link.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull()
    const chip = screen.getByRole('button', { name: /Thesis note/ })
    expect(chip.closest('a')).toBeNull()
  })

  it('the chip and the row link are siblings inside one row', () => {
    renderList()
    const link = screen.getByRole('link', { name: 'AAPL position detail' })
    const row = link.parentElement
    expect(within(row).getByRole('button', { name: /Thesis note/ })).toBeInTheDocument()
    expect(within(row).getByTestId('holding-sym')).toHaveTextContent('AAPL')
    // the hub's carrier stays on the link
    expect(link).toHaveAttribute('data-hub-pos')
  })

  it('"Open note" in the preview is not inside the row link either', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Thesis note/ }))
    const open = screen.getByRole('link', { name: 'Open note' })
    expect(open.closest('a[aria-label="AAPL position detail"]')).toBeNull()
  })

  it('clicking the chip opens its preview and does not navigate; the row link still does', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Thesis note/ }))
    expect(screen.getByText('AAPL plan')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
    fireEvent.click(screen.getByRole('link', { name: 'AAPL position detail' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/journal-2-0/position/AAPL')
  })

  it('a row with no chip keeps the plain link-wraps-the-row markup (flags-off parity)', () => {
    renderList()
    const tsla = screen.getByRole('link', { name: 'TSLA position detail' })
    expect(within(tsla).getByTestId('holding-sym')).toHaveTextContent('TSLA')
  })
})
