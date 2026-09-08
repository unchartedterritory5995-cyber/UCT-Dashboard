import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let summaryResult
let factsResult
let excerptsResult
const useThesisSummarySpy = vi.fn(() => summaryResult)
const useNoteFactsSpy = vi.fn(() => factsResult)
const useNoteExcerptsSpy = vi.fn(() => excerptsResult)
vi.mock('../../hooks/useThesisSummary', () => ({ default: (noteId) => useThesisSummarySpy(noteId) }))
vi.mock('../../hooks/useNoteFacts', () => ({ default: (noteId) => useNoteFactsSpy(noteId) }))
vi.mock('../../hooks/useNoteExcerpts', () => ({ default: (noteId) => useNoteExcerptsSpy(noteId) }))

import ThesisSection from './ThesisSection'

function renderIt(note, extraProps = {}) {
  return render(
    <MemoryRouter>
      <ThesisSection noteId="n1" note={note} {...extraProps} />
    </MemoryRouter>,
  )
}

const PLAIN_NOTE = { id: 'n1', title: 'Grocery list', tags: [], propertiesJson: {} }
const THESIS_NOTE_BY_PROPERTY = {
  id: 'n1', title: 'NVDA Thesis', tags: [], propertiesJson: { 'builtin:research_type': 'long_thesis' },
}
const THESIS_NOTE_BY_TAG = { id: 'n1', title: 'NVDA Thesis', tags: ['thesis'], propertiesJson: {} }

beforeEach(() => {
  summaryResult = { evidence: [], changelog: [], isLoading: false, refresh: vi.fn() }
  factsResult = { facts: [] }
  excerptsResult = { excerpts: [] }
  useThesisSummarySpy.mockClear()
  useNoteFactsSpy.mockClear()
  useNoteExcerptsSpy.mockClear()
  global.fetch = vi.fn()
  // CollapsibleSection persists open/closed per-id in localStorage -- clear
  // it so one test's toggle can't leak into the next (both tests here use
  // the same noteId, hence the same persisted key).
  window.localStorage.clear()
})

describe('ThesisSection', () => {
  it('renders nothing for an ordinary note (not thesis-shaped)', () => {
    const { container } = renderIt(PLAIN_NOTE)
    expect(container.firstChild).toBeNull()
  })

  it('renders for a note with Research Type set to Long Thesis', () => {
    renderIt(THESIS_NOTE_BY_PROPERTY)
    expect(screen.getByText('Add evidence')).toBeTruthy()
  })

  it('renders for a note carrying the legacy thesis tag, even with no research_type property', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    expect(screen.getByText('Add evidence')).toBeTruthy()
  })

  it('renders once evidence exists, even for an otherwise-plain note', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'note', targetId: 'n2', stance: 'supports', caption: 'x', removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    renderIt(PLAIN_NOTE)
    expect(screen.getByText('x')).toBeTruthy()
    expect(screen.getByText('Supports')).toBeTruthy()
  })

  it('shows an honest empty state in the changelog, never nothing, once expanded', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Changelog'))
    expect(screen.getByText(/Changes will appear here/)).toBeTruthy()
  })

  it('renders changelog events when present', () => {
    summaryResult = {
      evidence: [], changelog: [{ type: 'thesis_edited', at: '2026-09-01T00:00:00Z', fromVersionId: 'v1', toVersionId: 'v2' }],
      isLoading: false, refresh: vi.fn(),
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Changelog'))
    expect(screen.getByText('Thesis edited')).toBeTruthy()
  })

  it('opening the add-evidence picker lets a member choose supports/opposes and note/fact', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    expect(screen.getByText('Supports')).toBeTruthy()
    expect(screen.getByText('Opposes')).toBeTruthy()
    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.getByText('Captured fact')).toBeTruthy()
  })

  it('adding evidence posts to the evidence endpoint and refreshes', async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/notes?q=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'n2', title: 'Supporting note' }] }) })
      }
      if (url.includes('/evidence') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ evidence: { id: 'e1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const refresh = vi.fn()
    summaryResult = { evidence: [], changelog: [], isLoading: false, refresh }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.change(screen.getByPlaceholderText('Search notes…'), { target: { value: 'support' } })
    await waitFor(() => expect(screen.getByText('Supporting note')).toBeTruthy(), { timeout: 1000 })
    fireEvent.click(screen.getByText('Supporting note'))
    fireEvent.click(screen.getByText('Add evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(postCall[0]).toBe('/api/j2/notes/n1/evidence')
    expect(JSON.parse(postCall[1].body)).toMatchObject({ targetType: 'note', targetId: 'n2', stance: 'supports' })
  })

  it('removing evidence calls the delete endpoint and refreshes', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const refresh = vi.fn()
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'note', targetId: 'n2', stance: 'opposes', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh,
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByLabelText('Remove evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    expect(global.fetch).toHaveBeenCalledWith('/api/j2/evidence/e1', expect.objectContaining({ method: 'DELETE' }))
  })
})

// ── Wave J: document excerpt evidence ────────────────────────────────────

describe('ThesisSection — Wave J document excerpt evidence', () => {
  it('the evidence-type picker offers "Document excerpt" alongside Note/Captured fact', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    expect(screen.getByText('Document excerpt')).toBeTruthy()
  })

  it('picking "Document excerpt" lists this note\'s own saved excerpts by citation + quote', () => {
    excerptsResult = {
      excerpts: [{
        id: 'ex1', documentName: 'NVDA Investor Deck.pdf', pageNumber: 17,
        capturedText: 'Management expects gross margins to normalize lower',
      }],
    }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    expect(screen.getByText(/NVDA Investor Deck\.pdf · p\.17/)).toBeTruthy()
    expect(screen.getByText(/Management expects gross margins/)).toBeTruthy()
  })

  it('shows an honest empty state when the note has no saved excerpts yet', () => {
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    expect(screen.getByText(/Save an excerpt from a PDF in this note first/)).toBeTruthy()
  })

  it('adding document_excerpt evidence posts the right targetType/targetId', async () => {
    excerptsResult = {
      excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'margin commentary' }],
    }
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/evidence') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ evidence: { id: 'e1' } }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    const refresh = vi.fn()
    summaryResult = { evidence: [], changelog: [], isLoading: false, refresh }
    renderIt(THESIS_NOTE_BY_TAG)
    fireEvent.click(screen.getByText('Add evidence'))
    fireEvent.click(screen.getByText('Document excerpt'))
    fireEvent.click(screen.getByText(/Deck\.pdf · p\.17/))
    fireEvent.click(screen.getByText('Opposes'))
    fireEvent.click(screen.getByText('Add evidence'))
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 1000 })
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST')
    expect(JSON.parse(postCall[1].body)).toMatchObject({
      targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes',
    })
  })

  it('a document_excerpt evidence row shows its citation and calls onOpenExcerptSource on click', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = {
      excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'x' }],
    }
    const onOpenExcerptSource = vi.fn()
    renderIt(PLAIN_NOTE, { onOpenExcerptSource })
    expect(screen.getByText(/Deck\.pdf · p\.17/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Deck\.pdf · p\.17/))
    expect(onOpenExcerptSource).toHaveBeenCalledWith('ex1')
  })

  it('shows the caption AND the citation when both exist — the reason never replaces the source', () => {
    // ⛔ This used to assert the caption WON, hiding the citation. Found in a
    // live pass: a thesis with several captioned excerpts then read as a list
    // of sentences with no sources at all -- page-aware citation is the whole
    // point of the wave, and it must not vanish the moment a member explains
    // why a passage matters. The two answer different questions (see
    // ExcerptEvidenceRow) and both are shown, caption first.
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex1', stance: 'opposes', caption: 'Directly weakens my margin thesis', removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = { excerpts: [{ id: 'ex1', documentName: 'Deck.pdf', pageNumber: 17, capturedText: 'x' }] }
    renderIt(PLAIN_NOTE)
    const row = screen.getByRole('button', { name: /Directly weakens my margin thesis/ })
    expect(row.textContent).toContain('Directly weakens my margin thesis')
    expect(row.textContent).toContain('Deck.pdf · p.17')
  })

  it('a document_excerpt evidence row still opens even when the excerpt is not among this note\'s own excerpts (captured elsewhere)', () => {
    summaryResult = {
      evidence: [{ id: 'e1', targetType: 'document_excerpt', targetId: 'ex-from-elsewhere', stance: 'supports', caption: null, removedAt: null }],
      changelog: [], isLoading: false, refresh: vi.fn(),
    }
    excerptsResult = { excerpts: [] } // not locally resolvable
    const onOpenExcerptSource = vi.fn()
    renderIt(PLAIN_NOTE, { onOpenExcerptSource })
    expect(screen.getByText('Document excerpt')).toBeTruthy() // generic fallback label
    fireEvent.click(screen.getByText('Document excerpt'))
    expect(onOpenExcerptSource).toHaveBeenCalledWith('ex-from-elsewhere')
  })
})
