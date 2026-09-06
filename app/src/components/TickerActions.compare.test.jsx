// Compare — the same "Compare {sym} with…" pattern used by TickerPopup, wired
// into the universal ticker menu (TickerActions.jsx), which had no Compare
// entry point before this. Bespoke toggle (showCompare), same shape as the
// existing "Add to list" / "Set alert" toggles in this file.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ toggle: vi.fn(), isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null, setTag: vi.fn(), removeTag: vi.fn() }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    createAlert: vi.fn(), deleteAlert: vi.fn(),
    getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({
  default: () => ({ tagColors: [] }),
}))
vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

// The canonical SymbolSearch component has its own dedicated coverage
// elsewhere; stub it here exactly as TickerPopup.test.jsx does so the Compare
// action can be exercised without its real dropdown/fetch machinery. The
// stub deliberately hands back a LOWERCASE comparator so these tests pin
// TickerActions' own uppercasing, not SymbolSearch's.
vi.mock('./chart/SymbolSearch', () => ({
  default: ({ sym, onSymbolChange, displayLabel }) => (
    <button onClick={() => onSymbolChange('amd')}>{displayLabel || sym || 'search'}</button>
  ),
}))

import TickerActionsMenu from './TickerActions'

const MENU = { sym: 'NVDA', x: 100, y: 100 }

beforeEach(() => {
  navigateMock.mockClear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }))
})

test('the menu offers a Compare toggle for the symbol', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: /compare nvda with/i })).toBeInTheDocument()
})

test('clicking Compare reveals the "+ Compare" symbol picker', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /compare nvda with/i }))
  expect(screen.getByRole('button', { name: '+ Compare' })).toBeInTheDocument()
})

test('picking a comparator navigates to the exact canonical compare route (uppercased) and closes the menu', () => {
  const onClose = vi.fn()
  render(<TickerActionsMenu menu={MENU} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: /compare nvda with/i }))
  fireEvent.click(screen.getByRole('button', { name: '+ Compare' }))
  expect(navigateMock).toHaveBeenCalledWith('/research/NVDA/compare/AMD')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('unrelated actions (Full Research, Ask AI, Flag) still work alongside the new Compare toggle', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /full research/i }))
  expect(navigateMock).toHaveBeenCalledWith('/research/NVDA')
  expect(screen.getByRole('button', { name: /ask ai about nvda/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flag/i })).toBeInTheDocument()
})
