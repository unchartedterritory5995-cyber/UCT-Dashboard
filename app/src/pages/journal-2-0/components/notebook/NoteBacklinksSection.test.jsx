import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

let hookResult
vi.mock('../../hooks/useNoteBacklinksList', () => ({ default: () => hookResult }))

import NoteBacklinksSection from './NoteBacklinksSection'

beforeEach(() => {
  navSpy.mockClear()
  hookResult = { count: 0, notes: [], isLoading: false, error: null }
  // CollapsibleSection persists its open/closed state to REAL localStorage
  // keyed by `id` -- every test here uses the same noteId="n1", so a click
  // that opens the section in one test would leak into the next as an
  // already-open initial state without this.
  window.localStorage.clear()
})

describe('NoteBacklinksSection', () => {
  it('renders nothing while loading', () => {
    hookResult = { count: 0, notes: [], isLoading: true, error: null }
    const { container } = render(<NoteBacklinksSection noteId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing on a fetch error', () => {
    hookResult = { count: 0, notes: [], isLoading: false, error: new Error('boom') }
    const { container } = render(<NoteBacklinksSection noteId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are zero backlinks', () => {
    hookResult = { count: 0, notes: [], isLoading: false, error: null }
    const { container } = render(<NoteBacklinksSection noteId="n1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the collapsible section with a count when backlinks exist', () => {
    hookResult = {
      count: 2, isLoading: false, error: null,
      notes: [
        { id: 'a', title: 'Source A', refs: 1 },
        { id: 'b', title: 'Source B', refs: 3 },
      ],
    }
    render(<NoteBacklinksSection noteId="n1" />)
    expect(screen.getByText('Linked from (2)')).toBeTruthy()
  })

  it('expanding the section and clicking a row navigates to the source note', () => {
    hookResult = {
      count: 1, isLoading: false, error: null,
      notes: [{ id: 'a', title: 'Source A', refs: 1 }],
    }
    render(<NoteBacklinksSection noteId="n1" />)
    fireEvent.click(screen.getByText('Linked from (1)'))
    fireEvent.click(screen.getByText('Source A'))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=a')
  })

  it('shows a ref-count badge only when a source links more than once', () => {
    hookResult = {
      count: 1, isLoading: false, error: null,
      notes: [{ id: 'a', title: 'Source A', refs: 3 }],
    }
    render(<NoteBacklinksSection noteId="n1" />)
    fireEvent.click(screen.getByText('Linked from (1)'))
    expect(screen.getByText('3×')).toBeTruthy()
  })
})
