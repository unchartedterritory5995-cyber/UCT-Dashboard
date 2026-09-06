// FIX C (8/21 UI stress sweep, zero_a11y_name:_badge_10ga6_17): a fresh chart
// widget with no symbol chosen yet renders this badge ICON-ONLY (no ticker
// text, since `sym` is empty) with only a `title` — the sweep's a11y check
// (aria-label OR textContent) never reads `title`. Pins the fix for both the
// empty-symbol state (the actual bug) and the normal ticker-chosen state.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { test, expect, vi, beforeEach } from 'vitest'
import SymbolSearch from './SymbolSearch'

// The open dialog fires a `/api/breadth-symbols` prefetch regardless of query;
// stub it so opening the picker in the tests below never touches a real network.
beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbols: [] }) }))
})

test('no symbol chosen yet: the icon-only badge has an accessible name', () => {
  render(<SymbolSearch sym="" onSymbolChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Search ticker' })).toBeInTheDocument()
})

test('a symbol is chosen: the badge names the ticker and its action', () => {
  render(<SymbolSearch sym="AAPL" onSymbolChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: /AAPL — click to search/i })).toBeInTheDocument()
})

// Identity Normalization Hardening V1 — the "+ Compare" call sites (ResearchHeader,
// TickerPopup, TickerActions, TickerHubSheet, PositionDetailPage, TradeDrawer,
// TradeDetailPage) used to pass sym={null} alongside displayLabel="+ Compare" so
// the button would never show a stale ticker. That defeated the self-exclusion
// guard in submit() (`clean !== sym`) and made the button's tooltip literally
// read "null — click to search". The fix passes the real current symbol; these
// tests pin that both problems are actually solved, not just visually.
test('a real sym + displayLabel: the trigger still shows the label, not the sym', () => {
  render(<SymbolSearch sym="AAPL" displayLabel="+ Compare" onSymbolChange={vi.fn()} />)
  expect(screen.getByText('+ Compare')).toBeInTheDocument()
  expect(screen.queryByText('AAPL')).not.toBeInTheDocument()
})

test('a real sym + displayLabel: the tooltip names the real ticker, never the literal string "null"', () => {
  render(<SymbolSearch sym="AAPL" displayLabel="+ Compare" onSymbolChange={vi.fn()} />)
  const btn = screen.getByRole('button', { name: /AAPL — click to search/i })
  expect(btn.title).toBe('AAPL — click to search')
})

test('a null sym (the old call-site shape) rendered the tooltip as the literal string "null" — regression pin', () => {
  // aria-label (the accessible NAME) is conditioned on `sym` truthiness, so a
  // null sym still names the button "Search ticker" -- only the `title`
  // TOOLTIP is conditioned on displayLabel, which is why the old sym={null}
  // shape shipped an accessible button but a broken, literally-"null" tooltip.
  render(<SymbolSearch sym={null} displayLabel="+ Compare" onSymbolChange={vi.fn()} />)
  const btn = screen.getByRole('button', { name: 'Search ticker' })
  expect(btn.title).toBe('null — click to search')
})

test('self-exclusion: picking the current sym from the Compare picker does not fire onSymbolChange', async () => {
  const onSymbolChange = vi.fn()
  render(<SymbolSearch sym="AAPL" displayLabel="+ Compare" onSymbolChange={onSymbolChange} />)
  fireEvent.click(screen.getByRole('button', { name: /AAPL — click to search/i }))
  const dialog = screen.getByRole('dialog')
  const row = await within(dialog).findByRole('button', { name: /^AAPL/ })
  fireEvent.click(row)
  expect(onSymbolChange).not.toHaveBeenCalled()
})

test('picking a different symbol from the Compare picker fires onSymbolChange', async () => {
  const onSymbolChange = vi.fn()
  render(<SymbolSearch sym="AAPL" displayLabel="+ Compare" onSymbolChange={onSymbolChange} />)
  fireEvent.click(screen.getByRole('button', { name: /AAPL — click to search/i }))
  const dialog = screen.getByRole('dialog')
  const row = await within(dialog).findByRole('button', { name: /^MSFT/ })
  fireEvent.click(row)
  expect(onSymbolChange).toHaveBeenCalledWith('MSFT')
})
