import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let hookResult
const useNoteFactsSpy = vi.fn((noteId) => hookResult)
vi.mock('../../hooks/useNoteFacts', () => ({ default: (noteId) => useNoteFactsSpy(noteId) }))

import FinancialFactView from './FinancialFactView'

function nodeFor(factId) {
  return { attrs: { factId } }
}

function editorWith(noteId) {
  return { storage: { uctJournalWidgets: { noteId } } }
}

beforeEach(() => {
  hookResult = { facts: [], isLoading: true, refresh: vi.fn() }
  useNoteFactsSpy.mockClear()
})

describe('FinancialFactView', () => {
  it('shows a loading state before the note facts resolve', () => {
    hookResult = { facts: [], isLoading: true, refresh: vi.fn() }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText(/Loading captured fact/)).toBeTruthy()
  })

  it('shows "no longer available" when the fact cannot be found', () => {
    hookResult = { facts: [], isLoading: false, refresh: vi.fn() }
    render(<FinancialFactView node={nodeFor('gone')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText(/no longer available/)).toBeTruthy()
  })

  describe('the editor.storage.uctJournalWidgets.noteId settle-window race', () => {
    // Regression: node-view render (for a doc's INITIAL content) can happen
    // before NoteEditorPage's onCreate stamps editor.storage.uctJournalWidgets
    // .noteId -- the exact race WidgetEmbedView's own "settle window" comment
    // documents for its self-archive effect. A synchronous read of noteId at
    // render time loses that race PERMANENTLY (nothing else re-renders this
    // node view), so useNoteFacts never fetches and the card wrongly shows
    // "no longer available" forever. Caught live via real-browser E2E: a
    // captured fact confirmed present via a direct API call rendered as
    // unavailable in the actual note editor.
    it('shows loading (never "no longer available") while noteId is not yet on editor.storage', () => {
      hookResult = { facts: [], isLoading: false, refresh: vi.fn() }
      const editor = { storage: {} }  // uctJournalWidgets not stamped yet
      render(<FinancialFactView node={nodeFor('f1')} editor={editor} deleteNode={vi.fn()} />)
      expect(screen.getByText(/Loading captured fact/)).toBeTruthy()
      expect(screen.queryByText(/no longer available/)).toBeNull()
      // useNoteFacts must never be called with a noteId of null/undefined --
      // that would fire a request no note can answer.
      expect(useNoteFactsSpy).toHaveBeenCalledWith(null)
    })

    it('re-checks editor.storage after the settle window and starts fetching once noteId lands', async () => {
      hookResult = { facts: [], isLoading: false, refresh: vi.fn() }
      const editor = { storage: {} }
      render(<FinancialFactView node={nodeFor('f1')} editor={editor} deleteNode={vi.fn()} />)
      expect(useNoteFactsSpy).toHaveBeenLastCalledWith(null)

      // onCreate stamps storage sometime after this node view's first render
      // (the exact race) -- simulate it landing mid-settle-window, using the
      // real clock (the component's own setTimeout is real, un-mocked).
      editor.storage.uctJournalWidgets = { noteId: 'n1' }

      await waitFor(() => expect(useNoteFactsSpy).toHaveBeenLastCalledWith('n1'), { timeout: 1000 })
    })
  })

  it('renders the captured (THEN) value, ticker, and label', () => {
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price',
        value: 142.83, unit: 'usd_per_share', temporalMode: 'live_and_snapshot',
        observedAt: '2026-09-06T14:00:00Z', caption: null,
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText('NVDA')).toBeTruthy()
    expect(screen.getByText('$142.83')).toBeTruthy()
  })

  it('renders a resolved current value (NOW) alongside the original for a live_and_snapshot fact', () => {
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price',
        value: 142.83, unit: 'usd_per_share', temporalMode: 'live_and_snapshot',
        observedAt: '2026-09-06T14:00:00Z', current: 145.10, caption: null,
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText('$142.83')).toBeTruthy()
    expect(screen.getByText('$145.10')).toBeTruthy()
    // Change: +$2.27 (+1.59%)
    expect(screen.getByText(/\+\$2\.27/)).toBeTruthy()
  })

  it('a failed current-value resolution never hides the original — shows an honest failure instead', () => {
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price',
        value: 142.83, unit: 'usd_per_share', temporalMode: 'live_and_snapshot',
        observedAt: '2026-09-06T14:00:00Z', current: null, caption: null,
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText('$142.83')).toBeTruthy()  // original still fully visible
    expect(screen.getByText(/Couldn.t refresh/)).toBeTruthy()
  })

  it('a snapshot-only fact (e.g. user_note) never renders a Current row', () => {
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'user_note', factLabel: 'Note',
        value: 'My target: 195', unit: 'text', temporalMode: 'snapshot',
        observedAt: '2026-09-06T14:00:00Z', caption: null,
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.queryByText('Current')).toBeNull()
  })

  it('shows a caption when present', () => {
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price',
        value: 142.83, unit: 'usd_per_share', temporalMode: 'live_and_snapshot',
        observedAt: '2026-09-06T14:00:00Z', caption: 'ahead of earnings',
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={vi.fn()} />)
    expect(screen.getByText('ahead of earnings')).toBeTruthy()
  })

  it('the remove button calls deleteNode', () => {
    const deleteNode = vi.fn()
    hookResult = {
      facts: [{
        id: 'f1', ticker: 'NVDA', factType: 'price', factLabel: 'Price',
        value: 142.83, unit: 'usd_per_share', temporalMode: 'live_and_snapshot',
        observedAt: '2026-09-06T14:00:00Z', caption: null,
      }],
      isLoading: false, refresh: vi.fn(),
    }
    render(<FinancialFactView node={nodeFor('f1')} editor={editorWith('n1')} deleteNode={deleteNode} />)
    fireEvent.click(screen.getByLabelText('Remove captured fact from note'))
    expect(deleteNode).toHaveBeenCalled()
  })
})
