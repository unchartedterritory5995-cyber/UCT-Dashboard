// Audit 2026-11-05, spec S6 (B2, B5, and the post-#816 Recents title): the counts and the lists
// always agree, without a reload. Through REAL SWR hooks and a mocked server: a recap and a
// canvas create, then a move, then a title save -- after each, the list total, the sidebar counts
// and Recents read what the server now says.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { SWRConfig, mutate as globalMutate } from 'swr'
import useJ2Notes, { useJ2NoteFolderCounts, useJ2Recents } from '../../hooks/useJ2Notes'
import { invalidateNoteViews, isNoteViewKey } from './invalidateNoteViews'
import { latchNotebookFlags, __resetNotebookFlags } from './notebookFlags'

// The server: a set of notes, each in a folder (null = Unfiled).
const SERVER = { notes: [] }
const answer = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

function serverFetch(url) {
  const u = String(url)
  const live = SERVER.notes
  if (u.startsWith('/api/j2/notes/folder-counts')) {
    const counts = {}
    for (const n of live) if (n.folderId) counts[n.folderId] = (counts[n.folderId] || 0) + 1
    return answer({ counts, unfiled: live.filter((n) => !n.folderId).length, total: live.length })
  }
  if (u.startsWith('/api/j2/notes/recents')) return answer({ notes: live.map(({ id, title }) => ({ id, title })) })
  if (u === '/api/j2/notes' || u.startsWith('/api/j2/notes?')) return answer({ notes: live, total: live.length })
  return answer({})
}

// What the recap door (lib/reviewDrafts.draftDailyReview) does on the server: make the day's note.
vi.mock('../reviewDrafts', () => ({
  draftDailyReview: vi.fn(async () => {
    const note = { id: 'recap1', title: '2026-11-05 · Thursday', folderId: 'daily' }
    SERVER.notes = [...SERVER.notes, note]
    return { note, created: true }
  }),
  draftWeeklyReview: vi.fn(), draftMonthlyReview: vi.fn(),
  mondayOfIso: () => '2026-11-02', todayDayIso: () => '2026-11-05', thisMonthIso: () => '2026-11',
}))
// The account picker the reviews box reads.
vi.mock('../../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: null }) }))

function Views() {
  const { total } = useJ2Notes({})
  const { unfiled, counts } = useJ2NoteFolderCounts()
  const { notes: recents } = useJ2Recents()
  return (
    <div>
      <span data-testid="list-total">{String(total)}</span>
      <span data-testid="unfiled">{String(unfiled)}</span>
      <span data-testid="daily">{String(counts?.daily ?? 0)}</span>
      <span data-testid="recents">{recents.map((n) => n.title).join('|')}</span>
    </div>
  )
}

// The app's own (global) SWR cache, as the doors use it; emptied after every test.
const cacheMutate = globalMutate

beforeEach(() => {
  SERVER.notes = [{ id: 'a', title: 'Alpha', folderId: null }, { id: 'b', title: 'Beta', folderId: 'daily' }]
  global.fetch = vi.fn((url) => serverFetch(url))
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_review_drafts_enabled: true })
})
afterEach(async () => {
  cleanup()
  __resetNotebookFlags()
  await globalMutate(() => true, undefined, { revalidate: false })
})

const mount = (extra = null) => render(
  <SWRConfig value={{ dedupingInterval: 0 }}>
    <Views />
    {extra}
  </SWRConfig>,
)
const read = (id) => screen.getByTestId(id).textContent

describe('isNoteViewKey', () => {
  it('the lists, counts, Recents and the graph are views; the open note is not', () => {
    for (const k of ['/api/j2/notes', '/api/j2/notes?sort=title', '/api/j2/notes/folder-counts',
      '/api/j2/notes/recents', '/api/j2/notes/favorites', '/api/j2/notes/graph', '/api/j2/note-folders',
      '/api/j2/notes/by-folders?ids=f1&limit=200']) {
      expect(isNoteViewKey(k), k).toBe(true)
    }
    for (const k of ['/api/j2/notes/n1', '/api/j2/notes/n1/properties', '/api/j2/notes/tags', null, ['x']]) {
      expect(isNoteViewKey(k), String(k)).toBe(false)
    }
  })

  it('the tag cloud only when asked; a title save never touches the counts', () => {
    expect(isNoteViewKey('/api/j2/notes/tags', { tags: true })).toBe(true)
    expect(isNoteViewKey('/api/j2/notes/folder-counts', { titleOnly: true })).toBe(false)
    expect(isNoteViewKey('/api/j2/notes/recents', { titleOnly: true })).toBe(true)
    expect(isNoteViewKey('/api/j2/notes?q=x', { titleOnly: true })).toBe(true)
  })
})

describe('the counts and the lists agree after every door (S6)', () => {
  it("a recap made from Home's reviews box shows in the list total and the Daily count at once", async () => {
    const { ReviewDraftsHomeBox } = await import('../../components/notebook/ResearchHome')
    mount(<ReviewDraftsHomeBox onOpenNote={() => {}} />)
    await waitFor(() => expect(read('list-total')).toBe('2'))
    expect(read('daily')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: "Today's recap" }))
    await waitFor(() => expect(read('list-total')).toBe('3'))
    expect(read('daily')).toBe('2')
  })

  it('a canvas create, then a move out of Unfiled: the counts follow without a reload', async () => {
    mount()
    await waitFor(() => expect(read('unfiled')).toBe('1'))
    // the canvas door (NotebookTab.createCanvas) lands a note, then calls the helper
    SERVER.notes = [...SERVER.notes, { id: 'c', title: 'Trade plan', folderId: null }]
    await act(async () => { await invalidateNoteViews({ mutate: cacheMutate }) })
    await waitFor(() => expect(read('list-total')).toBe('3'))
    expect(read('unfiled')).toBe('2')
    // the editor's folder select (NoteEditorPage.onFolderChange) moves Alpha into Daily
    SERVER.notes = SERVER.notes.map((n) => (n.id === 'a' ? { ...n, folderId: 'daily' } : n))
    await act(async () => { await invalidateNoteViews({ mutate: cacheMutate }) })
    await waitFor(() => expect(read('unfiled')).toBe('1'))
    expect(read('daily')).toBe('2')
  })

  it('a landed title reaches Recents (post-#816: it stayed "Untitled")', async () => {
    SERVER.notes = [{ id: 'n', title: 'Untitled', folderId: null }]
    mount()
    await waitFor(() => expect(read('recents')).toBe('Untitled'))
    SERVER.notes = [{ id: 'n', title: 'NVDA swing plan', folderId: null }]
    const before = global.fetch.mock.calls.length
    await act(async () => { await invalidateNoteViews({ titleOnly: true, mutate: cacheMutate }) })
    await waitFor(() => expect(read('recents')).toBe('NVDA swing plan'))
    // a title cannot move a count, so the counts were not asked again
    const asked = global.fetch.mock.calls.slice(before).map(([u]) => String(u))
    expect(asked.some((u) => u.startsWith('/api/j2/notes/folder-counts'))).toBe(false)
  })
})
