/**
 * L3 (live Obsidian probe, 2026-11-03): a note removed at its source says so at the top of the
 * note view. Before, a `source-deleted` tag chip was the only sign.
 *
 * The copy is checked on the component; the wiring through the REAL NoteEditorPage (same harness
 * as NoteEditorPage.details.test.jsx): shown for a tagged note, named by its app, absent for an
 * ordinary one, and generic when the note's source is not a connector the roster knows.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import SourceRemovedNotice, { noteIsSourceRemoved, sourceRemovedText } from './SourceRemovedNotice'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body words' }] }] }
const note = (over = {}) => ({
  id: 'n1', title: 'Obsidian gate probe', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: 'T1', isFavorite: false, bodyJson: BODY, importSource: null, ...over,
})

let NOTE = note()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({
    note: NOTE, isLoading: false, error: null, update: vi.fn(), refresh: vi.fn(), patchTags: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

beforeEach(() => {
  localStorage.clear()
  NOTE = note()
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notes/n1/properties') return { ok: true, json: async () => ({ properties: [] }) }
    if (u === '/api/j2/notes/n1/thesis-summary') return { ok: true, json: async () => ({ evidence: [], changelog: [] }) }
    if (u === '/api/j2/notes/n1/reviews') return { ok: true, json: async () => ({ reviews: [], attention: null }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('SourceRemovedNotice copy', () => {
  it('says REMOVED only for a provider whose listing is authoritative (Obsidian)', () => {
    expect(sourceRemovedText('obsidian')).toBe(
      'This note was removed from Obsidian, so it no longer syncs. Your copy here is kept.')
  })

  it('says "no longer lists" for every other provider', () => {
    expect(sourceRemovedText('evernote')).toBe(
      'Evernote no longer lists this note, so it no longer syncs. Your copy here is kept.')
    expect(sourceRemovedText('notion')).toBe(
      'Notion no longer lists this note, so it no longer syncs. Your copy here is kept.')
  })

  it('falls back to a generic name when the source is not a connector the roster knows', () => {
    const generic = 'Its source app no longer lists this note, so it no longer syncs. Your copy here is kept.'
    expect(sourceRemovedText('file')).toBe(generic)
    expect(sourceRemovedText(null)).toBe(generic)
  })

  it('is shown for a tagged CONNECTOR note only, never for a tag typed on a UCT-made note', () => {
    expect(noteIsSourceRemoved({ tags: ['source-deleted'], importSource: 'obsidian' })).toBe(true)
    expect(noteIsSourceRemoved({ tags: ['source-deleted'], importSource: null })).toBe(false)
    expect(noteIsSourceRemoved({ tags: ['source-deleted'], importSource: '' })).toBe(false)
    expect(noteIsSourceRemoved({ tags: ['source-deleted'] })).toBe(false)
    expect(noteIsSourceRemoved({ tags: ['sync-conflict'], importSource: 'obsidian' })).toBe(false)
    expect(noteIsSourceRemoved({ tags: null, importSource: 'obsidian' })).toBe(false)
    expect(noteIsSourceRemoved(null)).toBe(false)
  })

  it('renders an icon, never an emoji, and is kept out of exports', () => {
    const { container } = render(<SourceRemovedNotice importSource="obsidian" />)
    const el = screen.getByTestId('source-removed-notice')
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.hasAttribute('data-export-exclude')).toBe(true)
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => { if (!view.container.querySelector('.ProseMirror')) throw new Error('no body yet') })
  return view
}

describe('NoteEditorPage shows it', () => {
  it('at the top of a note removed from Obsidian, above the body', async () => {
    NOTE = note({ tags: ['source-deleted'], importSource: 'obsidian' })
    const view = await renderEditor()
    const el = screen.getByTestId('source-removed-notice')
    expect(el.textContent).toBe(
      'This note was removed from Obsidian, so it no longer syncs. Your copy here is kept.')
    const body = view.container.querySelector('.ProseMirror')
    // eslint-disable-next-line no-bitwise
    expect(el.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('not on an ordinary note', async () => {
    NOTE = note({ tags: ['thesis'], importSource: 'obsidian' })
    await renderEditor()
    expect(screen.queryByTestId('source-removed-notice')).toBeNull()
  })

  it('in "no longer lists" words for a provider whose listing is not authoritative', async () => {
    NOTE = note({ tags: ['source-deleted'], importSource: 'evernote' })
    await renderEditor()
    expect(screen.getByTestId('source-removed-notice').textContent).toBe(
      'Evernote no longer lists this note, so it no longer syncs. Your copy here is kept.')
  })

  it('not for a note made in UCT that the member tagged source-deleted', async () => {
    NOTE = note({ tags: ['source-deleted'], importSource: null })
    await renderEditor()
    expect(screen.queryByTestId('source-removed-notice')).toBeNull()
  })
})
