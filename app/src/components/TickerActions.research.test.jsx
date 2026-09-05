// Entry-point convergence (owner authorization): the universal "Ask AI about
// {sym}" action used to deep-link to the separate, non-grounded /ai-search
// page. A security-scoped "Ask AI" action anywhere in the app must mean the
// same canonical Research Ask AI (ticker_explain.py) that TickerPopup's own
// goToAskAi already used — this pins that TickerActions now agrees, and that
// a "Full Research" action exists here too (there was none before).
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

import TickerActionsMenu from './TickerActions'

const MENU = { sym: 'NVDA', x: 100, y: 100 }

beforeEach(() => {
  navigateMock.mockClear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }))
})

test('offers Full Research, routed to canonical /research/:sym', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /full research/i }))
  expect(navigateMock).toHaveBeenCalledWith('/research/NVDA')
})

test('"Ask AI about {sym}" now routes to canonical Research Ask AI, not generic /ai-search', () => {
  render(<TickerActionsMenu menu={MENU} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /ask ai about nvda/i }))
  expect(navigateMock).toHaveBeenCalledWith('/research/NVDA?section=ai')
  expect(navigateMock).not.toHaveBeenCalledWith(expect.stringContaining('/ai-search'))
})

test('both research actions close the menu after navigating, and unrelated actions are untouched', () => {
  const onClose = vi.fn()
  render(<TickerActionsMenu menu={MENU} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: /full research/i }))
  expect(onClose).toHaveBeenCalledTimes(1)
  // Pre-existing, unrelated actions still present.
  expect(screen.getByRole('button', { name: /flag/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /add to list/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /set alert/i })).toBeInTheDocument()
})
