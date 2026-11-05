import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Audit 2026-11-05, spec S5 (B3): "Start a note from a template" never ticked. Its evidence (the
 * template's closing walkthrough in `bodyPlain`) is cut off by Research Home's 400-character
 * summaries, so the door the member used records it instead: a note made from a template ticks
 * the step; a blank note does not.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({
  default: ({ noteId }) => <div data-testid="note-editor" data-note-id={noteId} />,
}))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
const setPrefMerged = vi.fn()
vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, setPref: vi.fn(), setPrefMerged }),
}))

import NotebookTab from './NotebookTab'

beforeEach(() => {
  setPrefMerged.mockReset()
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/notes' && init.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ note: { id: 'new1', title: 'x' } }) }
    }
    if (u.startsWith('/api/j2/note-folders')) return { ok: true, json: async () => ({ folders: [] }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.clearAllMocks())

const renderAt = (entry) => render(<MemoryRouter initialEntries={[entry]}><NotebookTab /></MemoryRouter>)
const ticks = () => setPrefMerged.mock.calls.filter(([k]) => k === 'notebook_getting_started')

describe('S5 (B3): the template step ticks from the door', () => {
  it('a note made from a template records the template step', async () => {
    renderAt('/journal/notebook?new=thesis')
    await waitFor(() => expect(ticks().length).toBe(1))
    const write = ticks()[0][1]
    expect(write(undefined)).toEqual(expect.objectContaining({ done: ['template'] }))
    expect(write({ v: 1, done: ['template'] })).toBeUndefined()   // a step never writes twice
  })

  it('a blank note does not', async () => {
    renderAt('/journal/notebook?new=blank')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u, o]) => String(u) === '/api/j2/notes' && o?.method === 'POST')).toBe(true))
    await new Promise((r) => setTimeout(r, 30))
    expect(ticks()).toEqual([])
  })
})
