// app/src/pages/calendar/WireView.test.jsx
// The Wire's readability rules are the whole point of the view, so they are
// tested as behaviour rather than as styling:
//   • order is by ARRIVAL and never by move size (a row must not jump)
//   • significance drives visual WEIGHT only
//   • before the first print the view says what is expected, never blank
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('./useWire', () => ({ useWire: () => globalThis.__wire }))
vi.mock('./useWireCoverage', () => ({
  useWireCoverage: () => (globalThis.__wireCov ?? { data: null }),
}))

import WireView from './WireView'

const row = (sym, seen, extra = {}) => ({
  sym, first_seen_at: seen, timing: 'amc', move_pct: 6.4,
  eps_act: null, eps_est: 1.11, rev_act: null, rev_est: 4.98e10,
  confirmed: 0, peak_move_pct: 6.4, trigger: 'price', ...extra,
})

const syms = () => screen.getAllByTestId('wire-sym').map(n => n.textContent)

// Seam 20 (Calendar TickerActions Reuse V2): WireView rows are now real
// <button>s navigating via useNavigate, which requires a Router ancestor.
function renderWire(props) {
  return render(<MemoryRouter><WireView {...props} /></MemoryRouter>)
}

describe('WireView', () => {
  it('renders newest first', () => {
    globalThis.__wire = { data: { rows: [row('NVDA', 1000), row('AMD', 3000)], expected: 37 } }
    renderWire()
    expect(syms()).toEqual(['AMD', 'NVDA'])
  })

  it('orders by arrival, NOT by move size', () => {
    // The big mover arrived FIRST, so it must stay BELOW the newer small one.
    globalThis.__wire = {
      data: {
        rows: [row('NVDA', 1000, { move_pct: 12.0 }), row('AMD', 3000, { move_pct: 0.4 })],
        expected: 37,
      },
    }
    renderWire()
    expect(syms()).toEqual(['AMD', 'NVDA'])
  })

  it('shows what is expected before the first print instead of rendering blank', () => {
    globalThis.__wire = { data: { rows: [], expected: 37 } }
    renderWire()
    expect(screen.getByText(/37 reporters/i)).toBeInTheDocument()
  })

  it('shows a revenue-only print instead of hiding it behind pending', () => {
    // KOPN 2026-08-11: +22.6% on a revenue beat, NO EPS figure published.
    // An eps-only gate rendered "numbers pending…" over revenue it had.
    globalThis.__wire = {
      data: { rows: [row('KOPN', 1000, { rev_act: 12.7, rev_est: 11.7 })], expected: 1 },
    }
    renderWire()
    expect(screen.queryByText(/pending/i)).toBeNull()
    expect(screen.getByText(/Rev 12\.70 vs 11\.70/)).toBeInTheDocument()
  })

  it('marks a row without actuals as pending', () => {
    globalThis.__wire = { data: { rows: [row('NVDA', 1000)], expected: 1 } }
    renderWire()
    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })

  it('renders the numbers once they land', () => {
    globalThis.__wire = {
      data: { rows: [row('NVDA', 1000, { eps_act: 1.24, rev_act: 5.12e10, confirmed: 1 })], expected: 1 },
    }
    renderWire()
    expect(screen.queryByText(/pending/i)).toBeNull()
    expect(screen.getByText(/1\.24/)).toBeInTheDocument()
  })

  it('survives a price outage without crashing the row', () => {
    globalThis.__wire = {
      data: { rows: [row('NVDA', 1000, { move_pct: null, eps_act: 1.24 })], expected: 1 },
    }
    renderWire()
    expect(syms()).toEqual(['NVDA'])
  })

  it('renders nothing loud when the session has no reporters at all', () => {
    globalThis.__wire = { data: { rows: [], expected: 0 } }
    renderWire()
    expect(screen.getByText(/no reporters/i)).toBeInTheDocument()
  })

  it('does not crash before the first fetch resolves', () => {
    globalThis.__wire = { data: undefined }
    renderWire()
    expect(screen.getByText(/no reporters|waiting/i)).toBeInTheDocument()
  })
})

describe('WireView -- Seam 20, row click-through to Research (Calendar TickerActions Reuse V2)', () => {
  it('the row is a real button and clicking it navigates to canonical Research', () => {
    mockNavigate.mockClear()
    globalThis.__wire = { data: { rows: [row('NVDA', 1000)], expected: 1 } }
    renderWire()
    const btn = screen.getByText('NVDA').closest('button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/research/NVDA')
  })

  it('each row navigates to its OWN symbol, not a shared/stale one', () => {
    mockNavigate.mockClear()
    globalThis.__wire = { data: { rows: [row('NVDA', 1000), row('AMD', 3000)], expected: 2 } }
    renderWire()
    fireEvent.click(screen.getByText('AMD').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/AMD')
    mockNavigate.mockClear()
    fireEvent.click(screen.getByText('NVDA').closest('button'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/NVDA')
  })

  it('the row is keyboard-focusable by default (a real <button>, no extra ARIA needed)', () => {
    globalThis.__wire = { data: { rows: [row('NVDA', 1000)], expected: 1 } }
    renderWire()
    const btn = screen.getByText('NVDA').closest('button')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).not.toHaveAttribute('disabled')
    expect(btn).toHaveAttribute('title', 'View NVDA in Research')
  })
})
