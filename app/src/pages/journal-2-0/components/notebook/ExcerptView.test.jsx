import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * G-106 (Wave B lower-frequency sweep, competitive-gap-ledger.md): this file
 * mirrors FinancialFactView.test.jsx exactly -- ExcerptView.jsx's own header
 * comment says it "mirrors FinancialFactView.jsx's own shape and
 * settle-window handling exactly", so its loading-state test does too. No
 * test file existed for this component before this pass.
 */

let hookResult
const useNoteExcerptsSpy = vi.fn((noteId) => hookResult)
vi.mock('../../hooks/useNoteExcerpts', () => ({ default: (noteId) => useNoteExcerptsSpy(noteId) }))

import ExcerptView from './ExcerptView'

function nodeFor(excerptId) {
  return { attrs: { excerptId } }
}

function editorWith(noteId) {
  return { storage: { uctJournalWidgets: { noteId } } }
}

beforeEach(() => {
  hookResult = { excerpts: [], isLoading: true }
  useNoteExcerptsSpy.mockClear()
})

describe('ExcerptView — loading state (G-106)', () => {
  it('shows a Skeleton loading state (not bare text) before the excerpts resolve', () => {
    hookResult = { excerpts: [], isLoading: true }
    render(<ExcerptView node={nodeFor('e1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading excerpt…')
  })

  it('shows "no longer available" once loaded but the excerpt cannot be found', () => {
    hookResult = { excerpts: [], isLoading: false }
    render(<ExcerptView node={nodeFor('gone')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText(/no longer available/)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the loading skeleton disappears once the excerpt resolves', () => {
    hookResult = {
      excerpts: [{
        id: 'e1', documentId: 'd1', documentName: 'q3-deck.pdf', pageNumber: 2,
        capturedText: 'gross margin expanded', annotation: null,
      }],
      isLoading: false,
    }
    render(<ExcerptView node={nodeFor('e1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/gross margin expanded/)).toBeTruthy()
  })

  // Same settle-window race FinancialFactView.test.jsx documents: node-view
  // render can happen before NoteEditorPage's onCreate stamps
  // editor.storage.uctJournalWidgets.noteId.
  it('shows loading (never "no longer available") while noteId is not yet on editor.storage', () => {
    hookResult = { excerpts: [], isLoading: false }
    const editor = { storage: {} }  // uctJournalWidgets not stamped yet
    render(<ExcerptView node={nodeFor('e1')} editor={editor} deleteNode={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading excerpt…')
    expect(screen.queryByText(/no longer available/)).toBeNull()
    // useNoteExcerpts must never be called with a noteId of null/undefined --
    // that would fire a request no note can answer.
    expect(useNoteExcerptsSpy).toHaveBeenCalledWith(null)
  })
})
