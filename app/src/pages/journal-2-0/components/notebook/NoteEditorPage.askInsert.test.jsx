import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearPendingAskInsert, takePendingAskInsert, writePendingAskInsert } from '../../lib/askInsert'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

// G-064 fix round 1 (F5) — `appendGate.forceFail` substitutes ONLY
// `appendAskInsert`'s boundary return value, so a test can drive the
// PENDING path's failure branch (the one a read-only editor takes, per
// `appendAskInsert`'s own `!editor.isEditable` guard in lib/askInsert.js)
// without the app having any way to make its own editor read-only today
// (confirmed by grep — nothing in NoteEditorPage.jsx calls `setEditable`).
// Every other export, and every other call, is the real implementation.
const { appendGate } = vi.hoisted(() => ({ appendGate: { forceFail: false } }))
vi.mock('../../lib/askInsert', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    appendAskInsert: (editor, node) => (appendGate.forceFail ? false : actual.appendAskInsert(editor, node)),
  }
})

// G-064 — the real editor mount, same convention as NoteEditorPage.noteLinks.test.jsx.
// A component test that mocks the editor could not see a severed wire.

const NOTE = {
  id: 'n1', title: 'Original Title', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My own view.' }] }] },
}
// G-064 fix round 1 (F2) — a second note, for the A->B switch test below.
const NOTE_B = {
  id: 'n2', title: 'Second Note', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: '2026-01-01T00:00:00Z',
  isFavorite: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body of B.' }] }] },
}
const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inserted answer text.' }] }],
}

// G-064 fix round 1 (F2) — `useJ2Note` reads from a per-id STORE rather than
// returning one fixed note, so `NoteEditorPage.askInsert.test.jsx` can drive a
// real noteId switch on the SAME component instance (the shape the controller
// ruling is about) without touching the other tests in this file, which only
// ever render "n1" and therefore see the same NOTE they always did.
// G-064 fix round 1 (F4, controller ruling) — `updateGate` lets ONE test hold
// `update()` open (a deferred promise) to reproduce the slow-restore race,
// without touching the timing of every other test in this file.
const { noteStore, updateSpy, updateGate } = vi.hoisted(() => ({
  noteStore: {}, updateSpy: vi.fn(), updateGate: { pending: null },
}))
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: (noteId) => ({
    note: noteStore[noteId] ?? null,
    isLoading: !noteStore[noteId],
    update: async (patch) => {
      updateSpy(noteId, patch)
      if (updateGate.pending) await updateGate.pending
      const updated = { ...noteStore[noteId], ...patch, updatedAt: new Date().toISOString() }
      noteStore[noteId] = updated
      return updated
    },
    refresh: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function sse(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

beforeEach(() => {
  clearPendingAskInsert()
  sessionStorage.clear()
  __resetNotebookFlags()
  noteStore.n1 = { ...NOTE }
  delete noteStore.n2
  updateSpy.mockClear()
  updateGate.pending = null
  appendGate.forceFail = false
  localStorage.clear()
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/j2/ask/stream')) {
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({}),
        body: sse([
          { type: 'sources', scope: 'note', scopeLabel: 'This note', coverageNotice: null, sources: [{
            n: 1, type: 'note', label: 'Other note', citation: 'exact', snippet: 's',
            navigation: { kind: 'note', note_id: 'n9' }, location: {}, payload: {}, stance: null, truncated: false,
          }] },
          { type: 'final', answer: 'Margins fell [1].' },
        ]),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})
afterEach(() => vi.clearAllMocks())

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
}

// G-064 fix round 1 (F3, review finding) — the shipped tests mocked `update`
// and never asserted on it, so an insert that rendered but never reached the
// note's autosave (e.g. `setMeta('preventUpdate', true)` inside the same
// transaction) read as a pass. `hasAskInsert` is the check the two
// "reaches the autosave" assertions below make on each PUT body.
const hasAskInsert = (doc) => JSON.stringify(doc || {}).includes('"askInsert"')

describe('NoteEditorPage — G-064 Ask insert', () => {
  it('an answer picked for this note elsewhere lands at the end of it', async () => {
    writePendingAskInsert('n1', NODE)
    await renderEditor()
    await waitFor(() => expect(screen.getByText('Inserted answer text.')).toBeInTheDocument())
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    expect(await screen.findByText('Answer inserted at the end of this note.')).toBeInTheDocument()
    expect(takePendingAskInsert('n1')).toBeNull()
    // G-064 fix round 1 (F3) — the insert must actually REACH the note's
    // normal autosave (spec §5.2: an editor transaction on the normal
    // autosave path, no endpoint, no settle, no door), past the 800ms
    // debounce (`AUTOSAVE_MS`).
    await waitFor(() => {
      const call = updateSpy.mock.calls.find(([id]) => id === 'n1')
      expect(call).toBeTruthy()
      expect(hasAskInsert(call[1]?.bodyJson)).toBe(true)
    }, { timeout: 3000 })
  })

  it("another note's pending answer is not inserted here", async () => {
    writePendingAskInsert('n2', NODE)
    await renderEditor()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Inserted answer text.')).toBeNull()
    expect(takePendingAskInsert('n2')?.noteId).toBe('n2')
  })

  it('"Insert into this note" appends the answer from the note\'s own Ask panel', async () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This note' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Insert into this note' }))
    await waitFor(() => expect(screen.getByText('From Ask Notebook')).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Inserted' })).toBeDisabled()
    // G-064 fix round 1 (F5) — the success toast is asserted by RENDERED
    // TEXT, not by the `insertAskAnswer` callback having been invoked (repo
    // rule: user-facing feedback is asserted by what a member would see).
    expect(await screen.findByText('Answer inserted at the end of this note.')).toBeInTheDocument()
    // G-064 fix round 1 (F3) — same requirement on the click path: the
    // insert must reach the note's normal autosave, not just render.
    await waitFor(() => {
      const call = updateSpy.mock.calls.find(([id]) => id === 'n1')
      expect(call).toBeTruthy()
      expect(hasAskInsert(call[1]?.bodyJson)).toBe(true)
    }, { timeout: 3000 })
  })

  // G-064 fix round 1 (F2, controller ruling) — DEFENSE IN DEPTH. Production
  // mounts `<NoteEditorPage key={noteId}>` (tabs/NotebookTab.jsx:715), so a
  // note switch there gets a fresh instance. This test drives the case that
  // key exists to prevent — the SAME instance re-rendered with a new noteId —
  // so the gate still holds if the page is ever reused across notes: a
  // pending answer written for note B *while A is still open* must never be
  // spent against A's about-to-be-destroyed editor. Render A, write the
  // pending entry for B, THEN switch — the switch's first render still
  // carries the async draft-recovery decision made for A.
  it('an A->B switch never spends the answer against the stale editor -- B ends up holding it, and no failure toast fires', async () => {
    noteStore.n2 = { ...NOTE_B }
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const view = render(
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>,
    )
    await screen.findByText('My own view.')
    writePendingAskInsert('n2', NODE)
    view.rerender(
      <MemoryRouter><NoteEditorPage noteId="n2" onBack={vi.fn()} showBack /></MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Body of B.')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Inserted answer text.')).toBeInTheDocument())
    expect(screen.getByText('From Ask Notebook')).toBeInTheDocument()
    // Never spent against A: A's own body never gained the answer, and the
    // failure toast -- the tell that an insert was attempted and refused --
    // never fires at any point in the switch.
    expect(screen.queryByText("This note can't take changes right now, so the answer wasn't inserted. Ask again to get it back.")).toBeNull()
    expect(takePendingAskInsert('n2')).toBeNull()
  })

  // G-064 fix round 1 (F4, controller ruling) — the slow-restore race.
  // `restoreDraft()` clears `pendingDraft` (and so opens the `ready` gate on
  // that axis) synchronously, BEFORE its own `await update(...)` resolves.
  // Gating only on `pendingDraft` left a window where a pending Ask insert
  // could fire WHILE the restore's own PUT was still in flight, and its own
  // later autosave PUT would carry the PRE-restore `baseUpdatedAt` -- racing
  // the restore's write with a stale baseline. `saveStatus !== 'saving'`
  // closes it: `restoreDraft()` sets `saveStatus:'saving'` in that same
  // synchronous span and only clears it once the PUT settles.
  it('a pending insert holds behind a slow Restore PUT, then lands once it resolves, on the restored baseline', async () => {
    localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({
      title: 'Recovered Title', subtitle: '',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft body.' }] }] },
      savedAt: Date.now(),
    }))
    writePendingAskInsert('n1', NODE)
    let releaseRestore
    updateGate.pending = new Promise((r) => { releaseRestore = r })
    await renderEditor()
    await screen.findByRole('button', { name: 'Restore' })
    // Held behind the Restore banner -- the recovery decision has not
    // resolved the pendingDraft question yet.
    expect(screen.queryByText('Inserted answer text.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    // The restore's own PUT is now in flight (update() called), but the
    // deferred promise has not resolved -- pendingDraft cleared synchronously,
    // saveStatus:'saving' is what must still hold the insert back here.
    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(screen.queryByText('Inserted answer text.')).toBeNull()

    updateGate.pending = null
    releaseRestore()

    await waitFor(() => expect(screen.getByText('Inserted answer text.')).toBeInTheDocument())
    await waitFor(() => {
      const insertCall = updateSpy.mock.calls.find(([id, patch]) => id === 'n1' && hasAskInsert(patch?.bodyJson))
      expect(insertCall).toBeTruthy()
      // If the page sends a baseUpdatedAt on the insert's own autosave, it
      // must be the RESTORED revision, never the pre-restore one -- proving
      // the insert's autosave read `lastSavedRef` AFTER the restore updated it.
      const base = insertCall[1]?.baseUpdatedAt
      if (base !== undefined) expect(base).not.toBe(NOTE.updatedAt)
    }, { timeout: 3000 })
  })

  // G-064 final fix wave (M1) — the CLICK path shares the pending path's DRAFT
  // gate (not its save gate; see the next test). While a recovered draft is
  // waiting on the member's Restore or Discard, an insert would be erased by a
  // Restore (setContent). So the page does not offer Insert at all until the
  // draft question is settled.
  it('"Insert into this note" is not offered while a recovered draft is pending, and is once it is settled', async () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({
      title: 'Recovered Title', subtitle: '',
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft body.' }] }] },
      savedAt: Date.now(),
    }))
    await renderEditor()
    await screen.findByRole('button', { name: 'Restore' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This note' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    // A finished, cited answer: every other condition for the button holds.
    await waitFor(() => expect(within(dialog).getByTestId('ask-answer')).toHaveTextContent('Margins fell'))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Ask' })).toBeInTheDocument())
    expect(within(dialog).queryByRole('button', { name: /Insert/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await within(dialog).findByRole('button', { name: 'Insert into this note' })).toBeEnabled()
  })

  // G-064 final fix wave (M1, coordinator ruling on concern 1) — an ordinary
  // autosave in flight must NOT withdraw the button. A click-path insert during
  // a save is the same as typing during a save, and the autosave pipeline
  // already carries it: the insert re-arms the debounce and the next PUT holds
  // it. (Gating the click path on `saveStatus` made the button blink out on
  // every save.) Only the recovered-draft window is gated; the PENDING path
  // keeps its own `saveStatus !== 'saving'` gate for a Restore's PUT.
  it('"Insert into this note" stays offered while an autosave is in flight, and clicking it appends the answer', async () => {
    latchNotebookFlags({ notebook_ask_insert_on: true })
    let releaseSave
    updateGate.pending = new Promise((r) => { releaseSave = r })
    await renderEditor()
    // A real autosave: a title edit, past the 800ms debounce, held open.
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Edited Title' } })
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('n1', expect.objectContaining({ title: 'Edited Title' })), { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this note' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ask This note' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'margins?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask' }))
    const insert = await within(dialog).findByRole('button', { name: 'Insert into this note' })
    expect(insert).toBeEnabled()
    // Still in flight: the held PUT has not been released.
    expect(updateSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(insert)
    await waitFor(() => expect(screen.getByText('From Ask Notebook')).toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Inserted' })).toBeDisabled()

    // The normal pipeline carries it: once the held save settles, a later
    // autosave PUT holds the inserted block.
    updateGate.pending = null
    releaseSave()
    await waitFor(() => {
      const call = updateSpy.mock.calls.find(([id, patch]) => id === 'n1' && hasAskInsert(patch?.bodyJson))
      expect(call).toBeTruthy()
    }, { timeout: 3000 })
  })

  // G-064 fix round 1 (F5) — the failure toast, asserted by RENDERED TEXT.
  // `appendAskInsert` returning `false` is what a read-only editor produces
  // (its own `!editor.isEditable` guard, lib/askInsert.js) -- substituted at
  // that one boundary via `appendGate` since nothing in this app can make its
  // OWN editor read-only today (F7a).
  it("a pending insert the editor refuses shows the failure toast, and the answer never renders", async () => {
    appendGate.forceFail = true
    writePendingAskInsert('n1', NODE)
    await renderEditor()
    expect(await screen.findByText(
      "This note can't take changes right now, so the answer wasn't inserted. Ask again to get it back.",
    )).toBeInTheDocument()
    expect(screen.queryByText('Inserted answer text.')).toBeNull()
    expect(screen.queryByText('Answer inserted at the end of this note.')).toBeNull()
    // Spent, not retried: a refused insert does not leave the entry sitting
    // around to be silently retried on the next mount.
    expect(takePendingAskInsert('n1')).toBeNull()
  })
})
