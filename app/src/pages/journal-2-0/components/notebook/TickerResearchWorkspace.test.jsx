import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let hookResult
const useTickerResearchSpy = vi.fn(() => hookResult)
vi.mock('../../hooks/useTickerResearch', () => ({ default: (symbol) => useTickerResearchSpy(symbol) }))

const createNoteViaApi = vi.fn()
const createNoteFromTemplateViaApi = vi.fn()
vi.mock('../../lib/noteCreation', () => ({
  createNoteViaApi: (...a) => createNoteViaApi(...a),
  createNoteFromTemplateViaApi: (...a) => createNoteFromTemplateViaApi(...a),
}))

import TickerResearchWorkspace from './TickerResearchWorkspace'

const EMPTY_SUMMARY = {
  identity: { symbol: 'NVDA', entityId: null, displayName: null, symbols: ['NVDA'] },
  notes: [], activeTheses: [], pastTheses: [], facts: [],
  tradeSummary: { openPositions: 0, closedTrades: 0 },
}

function renderWorkspace(props = {}) {
  return render(
    <MemoryRouter>
      <TickerResearchWorkspace symbol="NVDA" {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  hookResult = { summary: EMPTY_SUMMARY, isLoading: false, error: null, refresh: vi.fn() }
  useTickerResearchSpy.mockClear()
  createNoteViaApi.mockReset().mockResolvedValue({ id: 'new1' })
  createNoteFromTemplateViaApi.mockReset().mockResolvedValue({ id: 'new2' })
})

describe('TickerResearchWorkspace', () => {
  it('shows a loading state before the summary resolves', () => {
    hookResult = { summary: null, isLoading: true, error: null, refresh: vi.fn() }
    renderWorkspace()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows the honest empty state for a security with zero research', () => {
    renderWorkspace()
    expect(screen.getByText('No research on NVDA yet.')).toBeTruthy()
  })

  it('shows the company name when the entity resolves one', () => {
    hookResult = {
      summary: { ...EMPTY_SUMMARY, identity: { ...EMPTY_SUMMARY.identity, displayName: 'NVIDIA Corporation' } },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderWorkspace()
    expect(screen.getByText('NVIDIA Corporation')).toBeTruthy()
  })

  it('renders active theses, notes, facts, and trade summary when present', () => {
    hookResult = {
      summary: {
        identity: { symbol: 'NVDA', entityId: 'e1', displayName: null, symbols: ['NVDA'] },
        notes: [{ id: 'n1', title: 'NVDA research note', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {} }],
        activeTheses: [{ id: 't1', title: 'NVDA Thesis', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: { 'builtin:thesis_status': 'active' } }],
        pastTheses: [{ id: 't2', title: 'Old thesis', updatedAt: '2026-08-01T00:00:00Z', propertiesJson: { 'builtin:thesis_status': 'invalidated' } }],
        facts: [{ id: 'f1', noteId: 'n1', factLabel: 'Price', ticker: 'NVDA', value: 142.83, unit: 'usd_per_share', observedAt: '2026-09-01T00:00:00Z' }],
        tradeSummary: { openPositions: 1, closedTrades: 3 },
      },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderWorkspace()
    expect(screen.getByText('Active thesis')).toBeTruthy()
    expect(screen.getByText('NVDA Thesis')).toBeTruthy()
    expect(screen.getByText('NVDA research note')).toBeTruthy()
    expect(screen.getByText('Price')).toBeTruthy()
    expect(screen.getByText('$142.83')).toBeTruthy()
    expect(screen.getByText('1 open position')).toBeTruthy()
    expect(screen.getByText('3 closed trades')).toBeTruthy()
    // Past theses stay collapsed by default (checkpoint decision 35).
    expect(screen.queryByText('Old thesis')).toBeNull()
    fireEvent.click(screen.getByText(/Past theses/))
    expect(screen.getByText('Old thesis')).toBeTruthy()
  })

  it('New Note pre-fills the workspace symbol and opens the created note', async () => {
    const onOpenNote = vi.fn()
    renderWorkspace({ onOpenNote })
    fireEvent.click(screen.getByRole('button', { name: /New note/ }))
    await waitFor(() => expect(createNoteViaApi).toHaveBeenCalledWith({ ticker: 'NVDA' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'new1' })
  })

  it('New Thesis reuses the shared thesis template creation path, pre-filling the symbol', async () => {
    const onOpenNote = vi.fn()
    renderWorkspace({ onOpenNote })
    fireEvent.click(screen.getByRole('button', { name: /New thesis/ }))
    await waitFor(() => expect(createNoteFromTemplateViaApi).toHaveBeenCalledWith('thesis', { ticker: 'NVDA' }))
    expect(onOpenNote).toHaveBeenCalledWith({ id: 'new2' })
  })

  it('clicking a note row calls onOpenNote', () => {
    const onOpenNote = vi.fn()
    hookResult = {
      summary: { ...EMPTY_SUMMARY, notes: [{ id: 'n1', title: 'A note', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: {} }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderWorkspace({ onOpenNote })
    fireEvent.click(screen.getByText('A note'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('shows a back link to Notebook by default, hides it when embedded (Company Page bridge)', () => {
    const { rerender } = renderWorkspace()
    expect(screen.getByText('Notebook')).toBeTruthy()
    rerender(
      <MemoryRouter>
        <TickerResearchWorkspace symbol="NVDA" showBackLink={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Notebook')).toBeNull()
  })
})
