import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let summaryResult
let factsResult
const useThesisSummarySpy = vi.fn(() => summaryResult)
const useNoteFactsSpy = vi.fn(() => factsResult)
vi.mock('../../hooks/useThesisSummary', () => ({ default: (noteId) => useThesisSummarySpy(noteId) }))
vi.mock('../../hooks/useNoteFacts', () => ({ default: (noteId) => useNoteFactsSpy(noteId) }))

import ThesisSection from './ThesisSection'

function renderIt(note) {
  return render(
    <MemoryRouter>
      <ThesisSection noteId="n1" note={note} />
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
  useThesisSummarySpy.mockClear()
  useNoteFactsSpy.mockClear()
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
