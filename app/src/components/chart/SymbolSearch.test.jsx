// FIX C (8/21 UI stress sweep, zero_a11y_name:_badge_10ga6_17): a fresh chart
// widget with no symbol chosen yet renders this badge ICON-ONLY (no ticker
// text, since `sym` is empty) with only a `title` — the sweep's a11y check
// (aria-label OR textContent) never reads `title`. Pins the fix for both the
// empty-symbol state (the actual bug) and the normal ticker-chosen state.
import { render, screen } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import SymbolSearch from './SymbolSearch'

test('no symbol chosen yet: the icon-only badge has an accessible name', () => {
  render(<SymbolSearch sym="" onSymbolChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Search ticker' })).toBeInTheDocument()
})

test('a symbol is chosen: the badge names the ticker and its action', () => {
  render(<SymbolSearch sym="AAPL" onSymbolChange={vi.fn()} />)
  expect(screen.getByRole('button', { name: /AAPL — click to search/i })).toBeInTheDocument()
})
