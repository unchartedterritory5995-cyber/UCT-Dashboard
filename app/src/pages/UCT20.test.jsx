import { useState, useRef, useEffect } from 'react'
import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { sym: 'NVDA', rs_score: 95.5, cap_tier: 'LARGE', thesis: 'AI infrastructure leader, base breakout' },
      { sym: 'META', rs_score: 91.0, cap_tier: 'LARGE', thesis: 'Ad revenue acceleration, Stage 2 uptrend' },
    ],
    mutate: vi.fn()
  })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

// A2R-05 nesting fix (notebook 10/10 wave AF2): a lightweight stand-in that
// mirrors the real TickerPopup's keyboard contract at the fidelity this
// file's row/chip INTEGRATION tests need — a real tab stop by default
// (`focusable`, default true), Enter/Space opens, Escape closes and returns
// focus to the trigger. The real component's own contract is TickerPopup's
// own coverage (TickerPopup.test.jsx); this file is about whether the ROW
// nests the chip inside another interactive element, not about the modal's
// internals (ChartPane, live prices, etc. are not under test here).
vi.mock('../components/TickerPopup', () => ({
  default: ({ sym, children, focusable = true }) => {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useEffect(() => {
      if (!open) return undefined
      const onKey = (e) => {
        if (e.key === 'Escape') { setOpen(false); ref.current?.focus() }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [open])
    return (
      <>
        <span
          ref={ref}
          data-testid={`ticker-${sym}`}
          role="button"
          aria-label={`View chart for ${sym}`}
          tabIndex={focusable ? 0 : undefined}
          onClick={() => setOpen(true)}
          onKeyDown={!focusable ? undefined : (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) }
          }}
        >
          {children ?? sym}
        </span>
        {open && <div data-testid="chart-modal" role="dialog" aria-label={`${sym} chart`} />}
      </>
    )
  },
}))

import useSWR from 'swr'
import UCT20 from './UCT20'

function mockOneStock(thesis = 'AI infrastructure leader, base breakout') {
  useSWR.mockImplementation((key) => ({
    data: key === '/api/leadership'
      ? { stocks: [{ sym: 'NVDA', rs_score: 95.5, thesis }], status: 'ok', last_updated: '2026-08-29' }
      : undefined,
    mutate: vi.fn(),
  }))
}

test('renders UCT 20 heading', () => {
  renderWithProviders(<UCT20 />)
  expect(screen.getByRole('heading', { name: /uct 20/i })).toBeInTheDocument()
})

// Keep this after the heading test — it replaces the module-level mock's
// implementation for the rest of the file.
test('held banner shows the list\'s verified date, not the push date', () => {
  useSWR.mockImplementation((key) => ({
    data: key === '/api/leadership'
      ? {
          stocks: [{ sym: 'NVDA', rs_score: 95.5, thesis: 'AI leader' }],
          status: 'held',
          last_updated: '2026-08-03',
          meta: { held_since: '2026-07-31' },
        }
      : undefined,
    mutate: vi.fn(),
  }))
  renderWithProviders(<UCT20 />)
  expect(screen.getByText(/didn.t pass its quality checks/i)).toBeInTheDocument()
  expect(screen.getByText(/verified 2026-07-31/)).toBeInTheDocument()
  expect(screen.queryByText(/verified 2026-08-03/)).not.toBeInTheDocument()
})

// The performance/backtest tile sits BELOW the list (owner call, twice asked
// for). Order is invisible to every other assertion here, so rail it directly:
// compare the two tiles' document positions rather than trusting render order.
test('the performance tile renders below the stock list', () => {
  useSWR.mockImplementation((key) => ({
    data: key === '/api/leadership'
      ? { stocks: [{ sym: 'NVDA', rs_score: 95.5, thesis: 'AI leader' }], status: 'ok', last_updated: '2026-08-29' }
      : undefined,
    mutate: vi.fn(),
  }))
  renderWithProviders(<UCT20 />)
  const list = screen.getByRole('region', { name: /current top stocks/i })
  const perf = screen.getByRole('region', { name: /^uct 20 performance$/i })
  // DOCUMENT_POSITION_FOLLOWING (4) = perf comes after list in the document.
  expect(list.compareDocumentPosition(perf) & 4).toBe(4)
})

// A2R-05 continuation (a11y second review, 2026-10-01): the ticker chip used
// to opt out of A2R-05's keyboard fix (`focusable={false}`) because it sat
// inside the row's own `role="button"` container — nesting a second focus
// stop there would have been worse than the status quo. The row is now a
// plain, non-interactive container (mouse-only onClick); the chip and a new
// caret <button> are SIBLING tab stops instead.
describe('row/chip nesting fix (A2R-05 continuation)', () => {
  test('the ticker chip is its own tab stop and is not inside the row\'s or caret\'s own interactive element', () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const chip = screen.getByTestId('ticker-NVDA')
    const caret = screen.getByRole('button', { name: /expand nvda details/i })
    expect(chip).toHaveAttribute('tabindex', '0')
    // Before the fix, the chip's nearest role="button"/anchor ancestor was the
    // ROW itself. Search from the PARENT (closest() also matches the element
    // itself, which would always pass trivially since the chip carries its
    // own role="button").
    expect(chip.parentElement.closest('[role="button"], a, button')).toBeNull()
    // And the caret is a real sibling control, not a wrapper around the chip.
    expect(caret.contains(chip)).toBe(false)
    expect(chip.contains(caret)).toBe(false)
  })

  test('tabbing from the chip reaches the caret as the very next stop (two siblings, not one nested stop)', async () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const user = userEvent.setup()
    const chip = screen.getByTestId('ticker-NVDA')
    const caret = screen.getByRole('button', { name: /expand nvda details/i })
    chip.focus()
    expect(document.activeElement).toBe(chip)
    await user.tab()
    expect(document.activeElement).toBe(caret)
  })

  test('Enter and Space on the chip open the popup and do not also toggle the row', () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(screen.queryByText(/AI infrastructure leader, base breakout/)).not.toBeInTheDocument()
  })

  test('Space on the chip also opens the popup and does not toggle the row', () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: ' ' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(screen.queryByText(/AI infrastructure leader, base breakout/)).not.toBeInTheDocument()
  })

  test('Enter and Space on the caret still toggle the row and do not open the popup', async () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const user = userEvent.setup()
    const caret = screen.getByRole('button', { name: /expand nvda details/i })
    caret.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: /collapse nvda details/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
    expect(screen.getByText(/AI infrastructure leader, base breakout/)).toBeInTheDocument()

    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: /expand nvda details/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
    expect(screen.queryByText(/AI infrastructure leader, base breakout/)).not.toBeInTheDocument()
  })

  test('Escape closes the popup and returns focus to the chip', async () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const user = userEvent.setup()
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(chip))
  })

  test('a mouse click on the chip opens the popup and still does not toggle the row (as today)', async () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const user = userEvent.setup()
    const chip = screen.getByTestId('ticker-NVDA')
    await user.click(chip)
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(screen.queryByText(/AI infrastructure leader, base breakout/)).not.toBeInTheDocument()
  })

  test('a mouse click on the row (not the chip, not the caret) still toggles it, same as today', async () => {
    mockOneStock()
    renderWithProviders(<UCT20 />)
    const user = userEvent.setup()
    // The rank cell is plain row content — clicking it exercises the row's
    // own onClick, unchanged from before this fix.
    await user.click(screen.getByText('1'))
    expect(screen.getByText(/AI infrastructure leader, base breakout/)).toBeInTheDocument()
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })
})
