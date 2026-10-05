import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// S7 Stage 5 — minimal Settings management panel. Controlled mock of the
// shared hook so list/suspend/reactivate/state-refresh are deterministic.
const filingWatchMock = vi.hoisted(() => ({
  // The S7 gate now lives in useFilingWatch itself, so a mock of that hook
  // must say whether the feature exists. These suites are about the
  // control's BEHAVIOUR, so they run with it on; absence-when-off has its
  // own dedicated tests.
  enabled: true,
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
  filingWatchMock.cooldown = null
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

// FT-035 -- the per-alert expiry control (owner-scoped, PUT .../expiry).
describe('FilingWatchesPanel -- FT-035 expiry control', () => {
  const res = (status, json) => ({ ok: status < 300, status, json: async () => json })

  it('rejects a date more than a year out via the date input max, and PUTs a valid one', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      expect(url).toBe('/api/alerts/predicates/p1/expiry')
      expect(init.method).toBe('PUT')
      const body = JSON.parse(init.body)
      return res(200, { id: 'p1', expires_at: body.expires_at })
    })
    vi.stubGlobal('fetch', fetchMock)
    filingWatchMock.predicates = [predicate('p1', 'NVDA')]
    render(<FilingWatchesPanel />)

    const input = screen.getByLabelText('Set expiry for p1')
    const maxAttr = input.getAttribute('max')
    const oneYearFromNow = new Date(Date.now() + 366 * 86400 * 1000).toISOString().slice(0, 10)
    // The control caps the picker itself at ~1 year out -- a date beyond
    // that is simply not selectable, which is the browser-level refusal.
    expect(maxAttr <= oneYearFromNow).toBe(true)
    expect(input.getAttribute('min')).toBeTruthy()

    const within30Days = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10)
    fireEvent.change(input, { target: { value: within30Days } })
    fireEvent.click(screen.getByRole('button', { name: 'Set expiry' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(await screen.findByText(/Expires in \d+ days?/)).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('shows the server refusal for a date the backend itself rejects (e.g. in the past)', async () => {
    const fetchMock = vi.fn(async () => res(400, { detail: 'An expiry must be in the future.' }))
    vi.stubGlobal('fetch', fetchMock)
    filingWatchMock.predicates = [predicate('p1', 'NVDA')]
    render(<FilingWatchesPanel />)

    const input = screen.getByLabelText('Set expiry for p1')
    const today = new Date().toISOString().slice(0, 10)
    fireEvent.change(input, { target: { value: today } })
    fireEvent.click(screen.getByRole('button', { name: 'Set expiry' }))

    expect(await screen.findByText('An expiry must be in the future.')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('Clear expiry PUTs a null expires_at and the row returns to "No expiry"', async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      const body = JSON.parse(init.body)
      expect(body).toEqual({ expires_at: null })
      return res(200, { id: 'p1', expires_at: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    filingWatchMock.predicates = [predicate('p1', 'NVDA')]
    render(<FilingWatchesPanel />)

    // Arm an expiry first via the control's own local state.
    const input = screen.getByLabelText('Set expiry for p1')
    const within10Days = new Date(Date.now() + 10 * 86400 * 1000).toISOString().slice(0, 10)
    fireEvent.change(input, { target: { value: within10Days } })
    fetchMock.mockImplementationOnce(async (_url, init) => res(200, { id: 'p1', expires_at: JSON.parse(init.body).expires_at }))
    fireEvent.click(screen.getByRole('button', { name: 'Set expiry' }))
    await screen.findByText(/Expires in \d+ days?/)

    fireEvent.click(screen.getByRole('button', { name: 'Clear expiry' }))
    await waitFor(() => expect(screen.getByTestId('expiry-control-p1').textContent).toContain('No expiry'))
    vi.unstubAllGlobals()
  })

  it('a suspended watch shows no expiry control', () => {
    filingWatchMock.predicates = [predicate('p1', 'NVDA', { suspended: true })]
    render(<FilingWatchesPanel />)
    expect(screen.queryByTestId('expiry-control-p1')).not.toBeInTheDocument()
  })
})

// TERM-062 -- the published re-arm rule is the server's sentence, rendered verbatim.
describe('FilingWatchesPanel -- published cooldown', () => {
  it('renders the cooldown sentence the list response carries', () => {
    filingWatchMock.cooldown = { type_id: 'document-arrival', sentence: 'Checked every 20 minutes. Each new filing alerts you once, and never again.' }
    render(<FilingWatchesPanel />)
    expect(screen.getByText('Checked every 20 minutes. Each new filing alerts you once, and never again.')).toBeInTheDocument()
  })

  it('renders no rule at all when the response carries none (never a typed fallback)', () => {
    render(<FilingWatchesPanel />)
    expect(screen.queryByTestId('filing-watch-cooldown')).not.toBeInTheDocument()
    expect(screen.queryByText(/Checked every/)).not.toBeInTheDocument()
  })
})
