// Lane FIN-A11Y round 2. The Positions phone card was `role="button"` with the thesis chip
// and the Edit, Close and Delete buttons INSIDE it: interactive content inside a button,
// which a screen reader reads as one control. The card is now a named group; its primary
// action is a real button on the title, and the chip and the three actions are its
// siblings. Tap-to-open anywhere on the card is unchanged.
// The desktop table row is checked for the same nesting: it is a focusable `row`, never a
// button or a link, so the controls in its cells are not nested in an interactive role.
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PositionsTable, { POSITIONS_COLUMNS } from './PositionsTable'

const view = vi.hoisted(() => ({ phone: true }))
vi.mock('../../../hooks/useBreakpoint', async (orig) => ({ ...(await orig()), useIsPhone: () => view.phone }))
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ sym, as: Tag = 'span', children, className }) => {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Tag data-testid={'ticker-popup-' + sym} className={className} aria-label={'Chart ' + sym}
          onClick={() => setOpen(true)}>{children}</Tag>
        {open && <div data-testid={'chart-modal-' + sym}>chart modal for {sym}</div>}
      </>
    )
  },
}))
vi.mock('../hooks/useThesisChips', () => ({
  default: () => ({
    chips: { AAPL: { noteId: 'n1', title: 'AAPL plan', thesisStatus: 'active', entry: 100, stop: 95, target: 130, link: '/journal/notebook?note=n1' } },
  }),
}))
vi.mock('../lib/thesisChips', async (orig) => ({ ...(await orig()), thesisChipsEnabled: () => true }))

const positions = [
  { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, stopPrice: 95, entryDate: '2026-06-01' },
]
const BROKER = { id: 2, symbol: 'MSFT', side: 'Long', shares: 5, entryPrice: 200, stopPrice: 200, entryDate: '2026-06-01', source: 'broker', entryEstimated: true }
const OPTION = {
  id: 9, isOption: true, symbol: 'CRWV Oct 16 $110C', side: 'Long Call', sideKind: 'long', underlying: 'CRWV',
  shares: 2, entryPrice: 2, optCurrent: 3, optMarketValue: 600, optPnlDollar: 200, optPnlPercent: 0.5, strategy: { id: 's9' },
}
const prices = { AAPL: { price: 110, change_pct: 2 }, MSFT: { price: 210, change_pct: 1 } }

const renderTable = (rows = positions, props = {}) => render(
  <MemoryRouter>
    <PositionsTable positions={rows} prices={prices} accountSize={10000} visibleColumns={POSITIONS_COLUMNS}
      onEdit={() => {}} onClose={() => {}} onDelete={() => {}} onOptionClose={() => {}} onOptionDelete={() => {}} {...props} />
  </MemoryRouter>,
)

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
/** Every interactive element that sits inside another interactive-role element. */
const nested = (root) => [root, ...root.querySelectorAll('*')]
  .filter((el) => el.matches('button, a[href], [role="button"], [role="link"]'))
  .filter((el) => el.querySelector(INTERACTIVE))
  .map((el) => el.outerHTML.slice(0, 80))

beforeEach(() => { view.phone = true })

describe('Positions phone card -- nothing interactive is nested in anything interactive', () => {
  it('the card is a named group, not a button', () => {
    renderTable()
    const card = screen.getByTestId('position-card')
    expect(card).toHaveAttribute('role', 'group')
    expect(card).toHaveAccessibleName('AAPL position')
    expect(card).not.toHaveAttribute('tabindex', '0')
  })

  it('no button or link on the card contains another control', () => {
    renderTable([...positions, BROKER, OPTION])
    for (const card of screen.getAllByTestId('position-card')) expect(nested(card)).toEqual([])
    // non-vacuity: the cards do hold several controls each
    expect(within(screen.getAllByTestId('position-card')[0]).getAllByRole('button').length).toBeGreaterThanOrEqual(5)
  })

  it('the primary action is a real button on the title, and the chip and actions are its siblings', () => {
    renderTable()
    const card = screen.getByTestId('position-card')
    const open = within(card).getByRole('button', { name: 'AAPL position — open chart, research, and actions' })
    expect(open.tagName).toBe('BUTTON')
    expect(open).toHaveTextContent('AAPL')
    for (const name of [/Thesis note/, 'Edit AAPL', 'Close AAPL', 'Delete AAPL']) {
      const other = within(card).getByRole('button', { name })
      expect(open.contains(other)).toBe(false)
      expect(other.contains(open)).toBe(false)
    }
  })

  it('Enter and Space on the title button open the same TickerPopup a tap does', async () => {
    const user = userEvent.setup()
    renderTable()
    screen.getByRole('button', { name: /AAPL position — open chart/ }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('chart-modal-AAPL')).toBeInTheDocument()
  })

  it('a tap anywhere else on the card still opens it, once', async () => {
    const user = userEvent.setup()
    renderTable()
    await user.click(screen.getByText(/10 @ \$100\.00/))
    expect(screen.getAllByTestId('chart-modal-AAPL')).toHaveLength(1)
  })

  it('the chip opens its own preview and does not open the card; Edit does not either', async () => {
    const user = userEvent.setup()
    renderTable()
    await user.click(screen.getByRole('button', { name: /Thesis note/ }))
    expect(screen.getByText('AAPL plan')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit AAPL' }))
    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
  })

  it('the hub carrier stays on the card, and the card can take focus from a script (delete fallback)', () => {
    renderTable()
    const card = screen.getByTestId('position-card')
    expect(card).toHaveAttribute('data-hub-pos', '1')
    card.focus()
    expect(card).toHaveFocus()
  })

  it('broker and option rules are intact: a placeholder stop is a dash, an option has no Edit', () => {
    renderTable([BROKER, OPTION])
    const cards = screen.getAllByTestId('position-card')
    const broker = cards.find((c) => c.textContent.includes('MSFT'))
    const option = cards.find((c) => c.textContent.includes('CRWV'))
    expect(broker).toHaveTextContent('stop —')
    expect(broker).toHaveTextContent('est.')
    expect(within(option).queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(within(option).getByRole('button', { name: /Close CRWV/ })).toBeInTheDocument()
  })

  it('the title button keeps the 44px floor (stylesheet)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/PositionsTable.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const at = css.indexOf('.cardOpen {')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(css.slice(at, css.indexOf('}', at))).toMatch(/min-height:\s*var\(--tap-min/)
  })
})

describe('Positions desktop row -- checked for the same nesting', () => {
  beforeEach(() => { view.phone = false })

  it('the row is a focusable row, never a button or a link, and no control is nested in another', () => {
    renderTable([...positions, BROKER, OPTION])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.tagName).toBe('TR')
      expect(row).not.toHaveAttribute('role')
      expect(nested(row)).toEqual([])
    }
  })

  it('the chip in the Symbol cell does not open the row, by click or by Enter', async () => {
    const user = userEvent.setup()
    renderTable()
    const chip = screen.getByRole('button', { name: /Thesis note/ })
    await user.click(chip)
    chip.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
    // control: the row itself still opens
    fireEvent.click(screen.getByText('$110.00'))
    expect(screen.getByTestId('chart-modal-AAPL')).toBeInTheDocument()
  })
})
