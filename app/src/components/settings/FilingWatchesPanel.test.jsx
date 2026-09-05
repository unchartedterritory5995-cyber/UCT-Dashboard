import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// S7 Stage 5 — minimal Settings management panel. Controlled mock of the
// shared hook so list/suspend/reactivate/state-refresh are deterministic.
const filingWatchMock = vi.hoisted(() => ({
  predicates: [],
  isLoading: false,
  watchState: vi.fn(() => 'ACTIVE'),
  getWatch: vi.fn(),
  createOrReactivate: vi.fn(),
  suspend: vi.fn(),
}))
vi.mock('../../hooks/useFilingWatch', () => ({ default: () => filingWatchMock }))

import FilingWatchesPanel from './FilingWatchesPanel'

function predicate(id, sym, { suspended = false, created_at = 1_700_000_000 } = {}) {
  return {
    id, entity_scope: { kind: 'entity', id: `ent_${sym}`, symbol: sym },
    created_at, suspended_at: suspended ? created_at + 10 : null,
  }
}

beforeEach(() => {
  filingWatchMock.predicates = []
  filingWatchMock.isLoading = false
  filingWatchMock.watchState.mockReset().mockReturnValue('ACTIVE')
  filingWatchMock.createOrReactivate.mockReset()
  filingWatchMock.suspend.mockReset()
})

describe('FilingWatchesPanel — owner-scoped list', () => {
  it('shows an empty state with no watches', () => {
    render(<FilingWatchesPanel />)
    expect(screen.getByText(/No filing watches yet/)).toBeInTheDocument()
  })

  it('lists only the caller\'s own predicates (whatever the hook returns), with ticker, created date, and state', () => {
    filingWatchMock.predicates = [predicate('p1', 'NVDA'), predicate('p2', 'AAPL', { suspended: true })]
    render(<FilingWatchesPanel />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Suspended')).toBeInTheDocument()
    // created date rendered for each row
    expect(screen.getAllByText(/Created/).length).toBe(2)
  })

  it('shows a loading state distinctly from an empty list', () => {
    filingWatchMock.isLoading = true
    render(<FilingWatchesPanel />)
    expect(screen.getByText(/Loading filing watches/)).toBeInTheDocument()
    expect(screen.queryByText(/No filing watches yet/)).not.toBeInTheDocument()
  })
})

describe('FilingWatchesPanel — actions', () => {
  it('ACTIVE row: Suspend button calls suspend with the predicate id and symbol', () => {
    filingWatchMock.predicates = [predicate('p1', 'NVDA')]
    render(<FilingWatchesPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Suspend filing watch for NVDA' }))
    expect(filingWatchMock.suspend).toHaveBeenCalledWith('p1', 'NVDA')
    expect(filingWatchMock.createOrReactivate).not.toHaveBeenCalled()
  })

  it('SUSPENDED row: Reactivate button calls createOrReactivate, never a hard delete / second predicate', () => {
    filingWatchMock.predicates = [predicate('p1', 'NVDA', { suspended: true })]
    render(<FilingWatchesPanel />)
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate filing watch for NVDA' }))
    expect(filingWatchMock.createOrReactivate).toHaveBeenCalledWith('NVDA')
    expect(filingWatchMock.suspend).not.toHaveBeenCalled()
  })

  it('a busy (CREATING/SUSPENDING) row disables its action button', () => {
    filingWatchMock.predicates = [predicate('p1', 'NVDA')]
    filingWatchMock.watchState.mockReturnValue('SUSPENDING')
    render(<FilingWatchesPanel />)
    expect(screen.getByRole('button', { name: 'Suspend filing watch for NVDA' })).toBeDisabled()
  })

  it('rows sort newest-created first', () => {
    filingWatchMock.predicates = [
      predicate('p_old', 'AAPL', { created_at: 100 }),
      predicate('p_new', 'NVDA', { created_at: 200 }),
    ]
    const { container } = render(<FilingWatchesPanel />)
    const rowSyms = Array.from(container.querySelectorAll('[class*="sessionRow"]'))
      .map(row => row.querySelector('[class*="sessionLabel"]').firstChild.textContent)
    expect(rowSyms).toEqual(['NVDA', 'AAPL'])
  })
})
