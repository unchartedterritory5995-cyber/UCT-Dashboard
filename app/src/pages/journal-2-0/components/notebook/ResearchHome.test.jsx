import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let hookResult
const useNotebookHomeSpy = vi.fn(() => hookResult)
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => useNotebookHomeSpy() }))

import ResearchHome from './ResearchHome'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

function renderHome(props = {}) {
  return render(
    <MemoryRouter>
      <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
  useNotebookHomeSpy.mockClear()
})

describe('ResearchHome', () => {
  it('shows a loading state while the hook is loading', () => {
    hookResult = { home: EMPTY, isLoading: true, error: null, refresh: vi.fn() }
    renderHome()
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('shows the first-run empty state for a brand new account', () => {
    renderHome({ hasAnyNotes: false })
    expect(screen.getByText('Welcome to your Notebook')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Start a note/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create a thesis/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import notes/ })).toBeTruthy()
  })

  it('first-run actions call their handlers', () => {
    const onCreateNote = vi.fn()
    const onCreateThesis = vi.fn()
    const onImport = vi.fn()
    renderHome({ hasAnyNotes: false, onCreateNote, onCreateThesis, onImport })
    fireEvent.click(screen.getByRole('button', { name: /Start a note/ }))
    fireEvent.click(screen.getByRole('button', { name: /Create a thesis/ }))
    fireEvent.click(screen.getByRole('button', { name: /Import notes/ }))
    expect(onCreateNote).toHaveBeenCalled()
    expect(onCreateThesis).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
  })

  it('shows a quiet state when the account has notes but nothing qualifies for any section', () => {
    renderHome({ hasAnyNotes: true })
    expect(screen.getByText('Nothing needs your attention right now.')).toBeTruthy()
  })

  it('each section only renders when it has content -- no dead cards', () => {
    hookResult = {
      home: { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderHome()
    expect(screen.getByText('Favorites')).toBeTruthy()
    expect(screen.queryByText('Continue working')).toBeNull()
    expect(screen.queryByText('Active theses')).toBeNull()
    expect(screen.queryByText('Needs review')).toBeNull()
  })

  it('renders a thesis-shaped row with its status and confidence chips', () => {
    hookResult = {
      home: {
        ...EMPTY,
        activeTheses: [{
          id: 'n1', title: 'NVDA Thesis', ticker: 'NVDA', updatedAt: '2026-09-01T00:00:00Z',
          propertiesJson: { 'builtin:thesis_status': 'active', 'builtin:confidence': 'high' },
        }],
      },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderHome()
    expect(screen.getByText('Active theses')).toBeTruthy()
    expect(screen.getByText('NVDA Thesis')).toBeTruthy()
    expect(screen.getByText('$NVDA')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('High confidence')).toBeTruthy()
  })

  it('clicking a row calls onOpenNote with the note', () => {
    const onOpenNote = vi.fn()
    hookResult = {
      home: { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderHome({ onOpenNote })
    fireEvent.click(screen.getByText('Fav note'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('open-position-research rows show "Open position" instead of a relative date', () => {
    hookResult = {
      home: { ...EMPTY, openPositionResearch: [{ id: 'n1', title: 'AMD note', ticker: 'AMD', updatedAt: '2026-09-01T00:00:00Z' }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderHome()
    expect(screen.getByText('Connected to your open positions')).toBeTruthy()
    expect(screen.getByText('Open position')).toBeTruthy()
  })

  it('the Continue Working section has a View all link to the All Notes grid', () => {
    hookResult = {
      home: { ...EMPTY, continueWorking: [{ id: 'n1', title: 'Recent note', updatedAt: '2026-09-01T00:00:00Z' }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    renderHome()
    const link = screen.getByRole('link', { name: /view all continue working/i })
    expect(link.getAttribute('href')).toBe('/journal/notebook?view=all')
  })
})
