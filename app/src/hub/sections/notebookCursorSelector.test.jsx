/**
 * Q4 — the selector the hub paints its cursor on, against the REAL grid.
 *
 * ⛔ THE NOTEBOOK'S OWN TAB TEST MOCKS `NoteCard`, so it can never see this. `NotebookTab.test.jsx`
 * declares `vi.mock('../components/notebook/NoteCard')` — sensible for testing the tab, useless for
 * testing an attribute that lives ON the card. A rail built on that harness would assert against a
 * stub and pass with the attribute deleted.
 *
 * So this mounts the REAL `NotebookTab` with the REAL `NoteCard`, and mocks only the DATA — the
 * notes hook — plus the ambient hooks that reach the network. The contract asserted is the one the
 * hub depends on: one card per note, each carrying its own id, and nothing else matching.
 *
 * ⚠️ It lives under app/src/hub because rule 12 forbids ADDING files under journal-2-0/**.
 * Importing the tab is a read, not an edit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { NOTE_CARD_SELECTOR, noteIdsInDocument } from './notebookSection'

let notes = []
// ⭐ SPREAD THE REAL MODULE, REPLACE ONE EXPORT. `useJ2Notes.js` exports eight things and the tab
// uses several; naming them one at a time produced a new "No export is defined" on every run — the
// mock telling me it did not match the module. `importOriginal` keeps every other export REAL, so
// this rail does not re-break each time that workstream adds a hook.
vi.mock('../../pages/journal-2-0/hooks/useJ2Notes', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    notes, isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: notes.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
  useJ2NoteFolderCounts: () => ({ counts: {}, isLoading: false, refresh: vi.fn() }),
  useJ2NotesByFolders: () => ({ byFolder: {}, isLoading: false }),
  useJ2Favorites: () => ({ notes: [], isLoading: false, refresh: vi.fn() }),
  useJ2Recents: () => ({ notes: [], isLoading: false, refresh: vi.fn() }),
}))
vi.mock('../../pages/journal-2-0/lib/offline/useOutboxDrain', () => ({
  useOutboxDrain: () => ({}),
  RETRY_INTERVAL_MS: 60000,
  sendNoteUpdate: vi.fn(),
  forkConflictedCopy: vi.fn(),
}))
vi.mock('../../pages/journal-2-0/lib/offline/useBlockedNotes', () => ({
  // The key is `blocked`, not `blockedNoteIds` — the tab renames it on destructure
  // (NotebookTab.jsx:84: `const { blocked: blockedNoteIds } = useBlockedNotes({...})`).
  useBlockedNotes: () => ({ blocked: new Set(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useIsPaid', () => ({ default: () => true }))
vi.mock('../../hooks/useAppFocus', () => ({ default: () => ({ symbol: null }) }))

const { default: NotebookTab } = await import('../../pages/journal-2-0/tabs/NotebookTab')

const fixture = (n) => Array.from({ length: n }, (_, i) => ({
  id: `note-${i + 1}`, title: `Note ${i + 1}`, updatedAt: new Date().toISOString(),
}))

// ⚠️ `?view=all` IS REQUIRED. Bare /journal/notebook renders Research Home, not the All-Notes
// grid — the two look identical otherwise, which is exactly why that flag exists. Without it the
// grid never mounts and every count below would be zero. The non-vacuity control caught this.
const mount = () => render(
  <MemoryRouter initialEntries={['/journal/notebook?view=all']}><NotebookTab /></MemoryRouter>,
)

beforeEach(() => { notes = [] })
afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('Q4 — the note-card selector, against the real NotebookTab', () => {
  it('⛔ the selector matches AT LEAST ONE card — the non-vacuity control (rule 14)', () => {
    // Without this, every count assertion below is satisfied by a grid that rendered nothing, which
    // is exactly what a broken mock or a changed grid would produce.
    notes = fixture(3)
    mount()
    expect(
      document.querySelectorAll(NOTE_CARD_SELECTOR).length,
      'the real grid rendered no cards the selector can see — either the mock is wrong or the '
      + 'attribute is gone, and every count below would pass vacuously',
    ).toBeGreaterThanOrEqual(1)
  })

  it('⛔ EXACTLY one match per rendered note — no more, no fewer', () => {
    notes = fixture(5)
    mount()
    expect(document.querySelectorAll(NOTE_CARD_SELECTOR)).toHaveLength(5)
    expect(noteIdsInDocument()).toEqual(['note-1', 'note-2', 'note-3', 'note-4', 'note-5'])
  })

  it('the ids come back in RENDER order — the cursor indexes into this', () => {
    notes = [
      { id: 'z', title: 'Zebra', updatedAt: new Date().toISOString() },
      { id: 'a', title: 'Apple', updatedAt: new Date().toISOString() },
    ]
    mount()
    // Whatever order the grid chose, the hub must read the SAME order — an index into a different
    // order lands the cursor on a note the member is not looking at.
    const rendered = [...document.querySelectorAll(NOTE_CARD_SELECTOR)]
      .map((el) => el.getAttribute('data-note-card-id'))
    expect(noteIdsInDocument()).toEqual(rendered)
    expect(rendered).toEqual(['z', 'a'])
  })

  it('an empty notebook yields zero matches, not an error', () => {
    notes = []
    mount()
    expect(document.querySelectorAll(NOTE_CARD_SELECTOR)).toHaveLength(0)
    expect(noteIdsInDocument()).toEqual([])
  })

  it('⛔ the selector does not over-match — one card, one match', () => {
    // `[data-note-id]` (TipTap's inline note link) must never be confused with this. A single note
    // must contribute exactly one node, not one per link inside it.
    notes = fixture(1)
    mount()
    expect(document.querySelectorAll(NOTE_CARD_SELECTOR)).toHaveLength(1)
  })
})
