import { useState, useRef, useEffect } from 'react'
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, beforeEach, afterEach } from 'vitest'

// A2R-05 nesting fix (notebook 10/10 wave AF2): a lightweight stand-in that
// mirrors the real TickerPopup's keyboard contract at the fidelity this
// file's card/chip INTEGRATION tests need — a real tab stop by default
// (`focusable`, default true), Enter/Space opens, Escape closes and returns
// focus to the trigger. The real component's own contract is TickerPopup's
// own coverage (TickerPopup.test.jsx); this file is about whether the CARD
// nests the chip inside the headline anchor, not about the modal's internals.
vi.mock('../TickerPopup', () => ({
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

import NewsFeed from './NewsFeed'

const mockData = [
  { headline: 'Fed holds rates steady', source: 'Reuters', url: 'http://reuters.com/1', time: '5m ago' },
  { headline: 'Tech earnings beat expectations', source: 'WSJ', url: 'http://wsj.com/1', time: '12m ago' },
]

// Fixture carrying a ticker — the nesting fix is only observable on an item
// that renders at least one chip.
const tickerData = [
  { headline: 'NVDA beats on revenue', source: 'Reuters', url: 'http://reuters.com/nvda', time: '5m ago', tickers: ['NVDA'] },
]

test('renders news headlines', () => {
  renderWithProviders(<NewsFeed data={mockData} />)
  expect(screen.getByText('Fed holds rates steady')).toBeInTheDocument()
  expect(screen.getByText('Tech earnings beat expectations')).toBeInTheDocument()
})

test('renders sources', () => {
  renderWithProviders(<NewsFeed data={mockData} />)
  expect(screen.getByText('Reuters')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state now renders SkeletonTileContent; no literal "loading" text.
  const { container } = renderWithProviders(<NewsFeed data={null} />)
  expect(container).toBeTruthy()
})

// A2R-05 continuation (a11y second review, 2026-10-01): the ticker chip used
// to opt out of A2R-05's keyboard fix (`focusable={false}`) because the whole
// card was a native `<a href target=_blank>` — nesting a focusable element
// inside an anchor is invalid HTML, not merely redundant. The anchor now
// wraps ONLY the headline text; the chip is a sibling of it, inside the
// card's `.meta` row. The card stays clickable for the mouse via a click
// handler on the container that ignores clicks on the anchor (which already
// navigates on its own) and on the chip (`[data-ticker-chip]`).
describe('card/chip nesting fix (A2R-05 continuation)', () => {
  let openSpy

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
  })
  afterEach(() => {
    openSpy.mockRestore()
  })

  test('the ticker chip is its own tab stop and is not inside the headline anchor', () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const chip = screen.getByTestId('ticker-NVDA')
    const link = screen.getByRole('link', { name: /NVDA beats on revenue/i })
    expect(chip).toHaveAttribute('tabindex', '0')
    // Before the fix, the chip's nearest <a> ancestor was the whole card.
    // Search from the PARENT — closest() also matches the element itself,
    // which would always pass trivially since the chip carries its own
    // role="button".
    expect(chip.parentElement.closest('a')).toBeNull()
    expect(link.contains(chip)).toBe(false)
  })

  test('tabbing from the headline link reaches the chip as a sibling stop', async () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const user = userEvent.setup()
    const link = screen.getByRole('link', { name: /NVDA beats on revenue/i })
    const chip = screen.getByTestId('ticker-NVDA')
    link.focus()
    expect(document.activeElement).toBe(link)
    await user.tab()
    expect(document.activeElement).toBe(chip)
  })

  test('Enter and Space on the chip open the popup and do not follow the link', () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('Space on the chip also opens the popup and does not follow the link', () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: ' ' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('Escape closes the popup and returns focus to the chip', async () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const user = userEvent.setup()
    const chip = screen.getByTestId('ticker-NVDA')
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toBe(chip))
  })

  test('a mouse click on the chip opens the popup and does not navigate the card link (as today)', async () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const user = userEvent.setup()
    const chip = screen.getByTestId('ticker-NVDA')
    await user.click(chip)
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
  })

  test('clicking the card elsewhere (not the headline, not the chip) still opens the article — mouse behaviour unchanged', async () => {
    renderWithProviders(<NewsFeed data={tickerData} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Reuters'))
    expect(openSpy).toHaveBeenCalledWith('http://reuters.com/nvda', '_blank', 'noopener,noreferrer')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })
})
