/**
 * Wave Q1 — THE GAP THIS FILE CLOSES, AND THE PROOF IT WAS REAL.
 *
 * `blockedEntryIsVisible.test.jsx` measured what a member is told when the
 * drain refuses to send their work, and its last row was the bad one: for a
 * note the member is not looking at, the hold was COMPLETELY SILENT. Every word
 * safe on disk, the queue honest, and nothing on any screen.
 *
 * ⛔ THE ORDER MATTERED. The first assertion below was written and run against
 * the un-wired product BEFORE the surface existed — it failed, naming the
 * missing sentence, which is what makes it a rail rather than a decoration. It
 * is mutation-proved in both directions (disconnect either list view's prop and
 * exactly the matching test goes red; see the file's own §MUTATION notes).
 *
 * ⛔ EVERY ASSERTION READS RENDERED TEXT. A member is told something or they are
 * not; `expect(setBadge).toHaveBeenCalled()` proves nothing about whether a
 * human ever saw a sentence — this repo has shipped two toasts that rendered
 * for zero frames with every structural assertion green.
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { openNotebookDb, putNoteWithIntent, listOutbox } from './notebookDb'
import { drainOutbox } from './outboxDrain'
import { listBlockedNoteIds } from './blockedNotes'
import { BLOCKED_BADGE, BLOCKED_TITLE, blockedLabel, unsyncedLabel, savedLocally } from './unsyncedCopy'
import { AuthContext } from '../../../../context/AuthContext'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

const NOTES = [
  { id: 'n1', title: 'NVDA thesis', subtitle: '', updatedAt: '2026-09-10T03:00:00Z', tags: [], ticker: null, propertiesJson: null },
  { id: 'n2', title: 'Semis rotation', subtitle: '', updatedAt: '2026-09-10T03:00:00Z', tags: [], ticker: null, propertiesJson: null },
]

// ── the tab's heavy neighbours, stubbed. ⛔ NoteCard and NotesTableView are
// NOT stubbed: they are the thing under test, and a component test that mocks
// the component it is about is the "severed wire" blind spot this repo has
// already paid for once (Screener.scanmount).
vi.mock('../../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: NOTES, isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: NOTES.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../../hooks/useJ2SavedViews', () => ({ default: () => ({ views: [], create: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../../hooks/useJ2PropertyDefs', () => ({ default: () => ({ defs: [], refresh: vi.fn() }) }))
vi.mock('../../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folders" /> }))
vi.mock('../../components/notebook/NoteEditorPage', () => ({ default: ({ noteId }) => <div data-testid="editor" data-note-id={noteId} /> }))
vi.mock('../../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../../components/notebook/export/ExportDialog', () => ({ default: () => null }))
vi.mock('../../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="home" /> }))

const entryFor = (noteId, text, base) => ({
  mutationId: `note:${noteId}`,
  noteId,
  kind: 'note-update',
  patch: { title: `${noteId} title`, subtitle: '', bodyJson: doc(text) },
  baseUpdatedAt: base,
  generation: 3,
  queuedAt: 10,
})

async function queue(db, noteId, text, base) {
  const entry = entryFor(noteId, text, base)
  await putNoteWithIntent(db, {
    noteId, title: entry.patch.title, subtitle: '', bodyJson: entry.patch.bodyJson,
    baseUpdatedAt: base, generation: 3, sessionId: 's1', localSavedAt: 20, dirty: 1,
  }, entry)
  return entry
}

let factory

function setup({ flag = '1' } = {}) {
  localStorage.clear()
  if (flag !== null) localStorage.setItem(OFFLINE_FLAG_KEY, flag)
  __resetNotebookConnections()
  installKeyRange()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
}

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  __resetNotebookConnections()
})

/** ⛔ `?view=all` is not decoration — without it `isHome` is true and the tab
 *  renders ResearchHome, so every assertion below would be reading a screen
 *  that has no note list on it at all. That is how a list rail passes or fails
 *  for a reason that has nothing to do with the list. */
async function renderTab() {
  const NotebookTab = (await import('../../tabs/NotebookTab')).default
  render(
    <AuthContext.Provider value={{ user: { id: 'u42', role: 'member' } }}>
      <MemoryRouter initialEntries={['/journal/notebook?view=all']}>
        <NotebookTab />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
  await act(async () => { await settleIdb(8) })
  // The control that keeps the rail honest: we are looking at the note list.
  await screen.findByText('Semis rotation')
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('⭐ THE NOTES LIST — a note the member is NOT looking at', () => {
  beforeEach(() => { setup() })

  it('⭐⭐ says the words are held and names the action that releases them', async () => {
    // ⛔ THIS IS THE REPRODUCTION. Run against the product before the surface
    // existed, it failed on the line below: nothing in the whole tab carried
    // the sentence, for a note holding work the server will never receive on
    // its own. §MUTATION: pass `blocked={false}` at NotebookTab's NoteCard call
    // site and this goes red while every other test in the wave stays green.
    const db = await openNotebookDb('u42', { factory })
    await queue(db, 'n2', 'three hours of research', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn(), excludeNoteId: null })
    await settleIdb()
    expect((await listOutbox(db))[0].permanent).toBe(true)

    await renderTab()

    await waitFor(() => expect(screen.getByText(BLOCKED_BADGE)).toBeInTheDocument())
    // …and the badge is on THAT note's row, not floating somewhere generic.
    const badge = screen.getByText(BLOCKED_BADGE)
    expect(badge.closest('button, [data-trashed]')?.textContent).toContain('Semis rotation')
    // The full sentence is reachable without a click.
    expect(badge.getAttribute('title')).toBe(BLOCKED_TITLE)
  })

  it('⛔ CONTROL: a queued-but-still-retrying entry says NOTHING', async () => {
    // The badge means "the queue has stopped trying", not "there is unsent
    // work". A rail that fired on any queued entry would be indistinguishable
    // from one that fires on nothing in particular.
    const db = await openNotebookDb('u42', { factory })
    await queue(db, 'n2', 'still on its way', 'T1')   // a REAL baseline: not blocked
    await settleIdb()
    expect((await listOutbox(db))[0].permanent).toBeUndefined()

    await renderTab()
    await act(async () => { await settleIdb(6) })

    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })

  it('⛔ CONTROL: a TRASHED card never carries it — the sentence names an action it cannot take', async () => {
    // A trashed note must be restored before it can be opened, so "edit it
    // again" would be an instruction the card refuses. Silence is the honest
    // answer there; this pins the decision so a later "consistency" pass does
    // not helpfully add it back.
    const NoteCard = (await import('../../components/notebook/NoteCard')).default
    render(<NoteCard note={NOTES[1]} onOpen={vi.fn()} onRestore={vi.fn()} blocked />)
    expect(screen.getByText('Restore')).toBeInTheDocument()   // it IS the trashed card
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })

  it('⛔ CONTROL: an empty outbox says NOTHING', async () => {
    await renderTab()
    await act(async () => { await settleIdb(6) })
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })

  it('⛔⛔ THE GATE: with the offline layer OFF, nothing is read and nothing is said', async () => {
    // Production's state. `OFFLINE_DEFAULT_ON` is false, so a member cannot have
    // a blocked entry at all — and this surface must not be the one place the
    // dark wave reaches into IndexedDB. Seeded anyway, so the assertion is about
    // the gate rather than about an empty store.
    const db = await openNotebookDb('u42', { factory })
    await queue(db, 'n2', 'words', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()

    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    await renderTab()
    await act(async () => { await settleIdb(6) })

    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })
})

describe('⭐ IT CLEARS ITSELF when the member does what it asked', () => {
  beforeEach(() => { setup() })

  it('a later edit replaces the entry, and the note is no longer blocked', async () => {
    // The recovery path, measured end to end at the read the surface uses. The
    // outbox is keyed `note:<id>`, so a fresh durable write REPLACES the blocked
    // entry and the replacement carries no `permanent` flag.
    const db = await openNotebookDb('u42', { factory })
    await queue(db, 'n2', 'blocked words', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn() })
    await settleIdb()
    expect(await listBlockedNoteIds(db)).toEqual(['n2'])

    await queue(db, 'n2', 'edited again, with a baseline', 'T1')
    await settleIdb()
    expect(await listBlockedNoteIds(db)).toEqual([])
  })
})

describe('⭐ THE TABLE VIEW SAYS THE SAME THING', () => {
  beforeEach(() => { setup() })

  it('renders the same badge for a blocked row, and nothing for the others', async () => {
    // ⛔ The other list view. A surface built only on the card grid would be
    // invisible to every member who prefers this one.
    // §MUTATION: drop `blockedNoteIds` from NotebookTab's NotesTableView call
    // site and this goes red.
    const NotesTableView = (await import('../../components/notebook/NotesTableView')).default
    render(
      <MemoryRouter>
        <NotesTableView
          notes={NOTES}
          propertyDefs={[]}
          sort="updated"
          onSortChange={vi.fn()}
          onPropertySortChange={vi.fn()}
          onQuickFilter={vi.fn()}
          onOpenNote={vi.fn()}
          blockedNoteIds={new Set(['n2'])}
        />
      </MemoryRouter>,
    )
    const badges = screen.getAllByText(BLOCKED_BADGE)
    expect(badges).toHaveLength(1)
    expect(badges[0].closest('tr, [data-row], div')?.textContent).toContain('Semis rotation')
  })

  it('⭐⭐ AND THE WIRE IS REAL — switch the tab to Table view and it is still there', async () => {
    // ⛔ The test above renders NotesTableView directly, so it is blind to a
    // severed wire: it would stay green with the tab passing nothing at all.
    // This one drives the member's own control (the Table view button) through
    // the real tab, which is the only version of the assertion that can fail
    // when the prop stops being handed over.
    // §MUTATION: drop `blockedNoteIds` at NotebookTab's NotesTableView call site
    // and exactly this test goes red.
    const db = await openNotebookDb('u42', { factory })
    await queue(db, 'n2', 'three hours of research', null)
    await drainOutbox(db, { send: vi.fn(), fork: vi.fn(), excludeNoteId: null })
    await settleIdb()

    await renderTab()
    await act(async () => { screen.getByTitle('Table view').click(); await settleIdb(4) })

    await waitFor(() => expect(screen.getByText(BLOCKED_BADGE)).toBeInTheDocument())
  })

  it('⛔ CONTROL: no blocked ids ⇒ no badge', async () => {
    const NotesTableView = (await import('../../components/notebook/NotesTableView')).default
    render(
      <MemoryRouter>
        <NotesTableView
          notes={NOTES} propertyDefs={[]} sort="updated"
          onSortChange={vi.fn()} onPropertySortChange={vi.fn()}
          onQuickFilter={vi.fn()} onOpenNote={vi.fn()}
          blockedNoteIds={null}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })
})

describe('⛔ ONE VOCABULARY, ONE AUTHORITY', () => {
  it('the blocked sentence extends the shipped one instead of inventing a new one', () => {
    // The member already knows "Saved on this device · waiting to sync". The
    // blocked line is the SAME noun with a different second half, so the two
    // read as one state that changed rather than two unrelated warnings.
    expect(unsyncedLabel(true)).toBe('Saved on this device · waiting to sync')
    expect(blockedLabel(true)).toBe('Saved on this device · edit it again to sync')
    expect(blockedLabel(true).startsWith(savedLocally(true))).toBe(true)
    expect(unsyncedLabel(true).startsWith(savedLocally(true))).toBe(true)
  })

  it('⛔ the noun still narrows when the platform will not promise retention', () => {
    expect(blockedLabel(null)).toBe('Saved in this browser · edit it again to sync')
    expect(blockedLabel(false)).toBe('Saved in this browser · edit it again to sync')
  })

  it('⭐ the full sentence names the words, the server, AND the action', () => {
    // A member reading only the tooltip must learn all three facts. Asserted on
    // the sentence itself, so a "tidy-up" that drops the second clause fails
    // here rather than quietly making the badge unactionable.
    expect(BLOCKED_TITLE).toMatch(/have not reached the server/i)
    expect(BLOCKED_TITLE).toMatch(/until you edit it again/i)
  })
})
