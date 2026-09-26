/**
 * S1 / H14 — the Notebook editor never blanks a note it cannot read.
 *
 * A body holding a node or mark type this bundle's schema lacks (a NEWER bundle
 * wrote it) used to open EMPTY, and the next save wrote the empty document over
 * the note. Now the editor locks and says so, and NOTHING of that document is
 * written anywhere: not the server PUT, not the localStorage draft, not the
 * IndexedDB working copy, not the outbox.
 *
 * Driven on the real editor with the real offline adapter over an in-memory
 * IndexedDB (the durable harness), so a write through ANY of those layers shows.
 */
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { UNREADABLE_NOTE_MESSAGE } from '../../lib/noteContentGuard'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
const BODIES = {
  node: { type: 'doc', content: [para('NVDA thesis'), { type: 'waveSixDiagram', attrs: { id: 'd1' } }] },
  mark: { type: 'doc', content: [para('key level', [{ type: 'waveSixUnderwave' }])] },
  control: { type: 'doc', content: [para('Original body')] },
}
let body = BODIES.control
let noteLocked = false        // wave 6 item 8's `locked` field (I-3 rails flip it)
const note = () => ({
  id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: null,
  ticker: null, tags: [], heroImageUrl: null, updatedAt: 'T1', isFavorite: false, bodyJson: body,
  locked: noteLocked,
})

const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: note(), isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [{ id: 'f1', name: 'Theses' }] }) }))

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  noteLocked = false
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...note(), ...patch, updatedAt: 'T2' }))
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function renderEditor(props = {}) {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  const view = render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} {...props} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await act(async () => { await settleIdb(4) })
  return view
}
const liveEditor = () => document.querySelector('.ProseMirror')?.editor
const store = (name) => factory.databases.get(ACCOUNT_DB)?.dump(name) ?? []
const bodyWrites = () => updateMock.mock.calls.filter(([patch]) => patch && 'bodyJson' in patch)
const serverBodyPuts = () => global.fetch.mock.calls.filter(([url, init]) => (
  /\/api\/j2\/notes\//.test(String(url)) && init?.method === 'PUT' && /bodyJson/.test(String(init?.body || ''))))

/** Every way this page can be pushed toward a save, short of a real keyboard. */
async function tryEveryWritePath() {
  const ed = liveEditor()
  expect(ed, 'the rail needs the real editor instance').toBeTruthy()
  // A programmatic transaction: onUpdate is the autosave door.
  await act(async () => { ed.commands.insertContent('typed into an empty-looking note') })
  // The title field (its change handler also schedules the autosave).
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'NVDA thesis — edited' } })
  await act(async () => { vi.advanceTimersByTime(2000); await settleIdb(8) })
}

describe.each([
  ['an unknown NODE type', 'node'],
  ['an unknown MARK type', 'mark'],
])('a note holding %s', (_label, kind) => {
  it('opens LOCKED, says why, and writes its body NOWHERE', async () => {
    body = BODIES[kind]
    const view = await renderEditor()

    // The member reads the reason, in words, on the page.
    expect(screen.getByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()
    expect(liveEditor().isEditable).toBe(false)

    await tryEveryWritePath()
    view.unmount()                                  // the unmount flush
    await act(async () => { vi.advanceTimersByTime(2000); await settleIdb(8) })

    expect(bodyWrites()).toEqual([])                // the note PUT
    expect(serverBodyPuts()).toEqual([])            // and nothing around it
    expect(localStorage.getItem('uct.j2.notedraft.n1')).toBeNull()   // the draft
    expect(store('notes')).toEqual([])              // the durable working copy
    expect(store('outbox')).toEqual([])             // the outbox
  })
})

describe('the metadata doors on a locked note', () => {
  it('a folder change is sent (it carries no body) but puts NOTHING in the durable copy or the outbox', async () => {
    body = BODIES.node
    await renderEditor()
    await act(async () => {
      fireEvent.change(screen.getByDisplayValue('Unfiled'), { target: { value: 'f1' } })
    })
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(8) })
    // The door DID run (non-vacuity) — and carried no body.
    expect(updateMock).toHaveBeenCalledWith({ folderId: 'f1' })
    expect(bodyWrites()).toEqual([])
    // ⛔ The settle after it used to read the EMPTY stand-in as "the member's
    // local copy" and queue it as unsent work: the outbox would have sent it.
    expect(store('notes').filter((r) => r.dirty)).toEqual([])
    expect(store('outbox')).toEqual([])
  })
})

describe('a crash draft on a locked note', () => {
  const seedDraft = () => localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({
    title: 'NVDA thesis (draft)', subtitle: '', savedAt: Date.now(),
    bodyJson: { type: 'doc', content: [para('words from last session')] },
  }))
  it('offers no Restore -- the banner is the only door to restoreDraft, and it would PUT', async () => {
    body = BODIES.node
    seedDraft()
    await renderEditor()
    await act(async () => { await settleIdb(8) })
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
  })
  it('⛔ control: the same draft on a readable note IS offered', async () => {
    body = BODIES.control
    seedDraft()
    await renderEditor()
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })
})

describe('⛔ the control — a note this bundle CAN read', () => {
  it('stays editable, shows no lock, and the same pushes DO write (the rail can see a write)', async () => {
    body = BODIES.control
    await renderEditor()
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
    expect(liveEditor().isEditable).toBe(true)

    await tryEveryWritePath()

    expect(bodyWrites().length).toBeGreaterThan(0)
    expect(store('notes').length).toBeGreaterThan(0)
  })

  it('a BLANK note ({doc, content: []}) — structurally loose, but readable — is not locked', async () => {
    body = { type: 'doc', content: [] }
    await renderEditor()
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
    expect(liveEditor().isEditable).toBe(true)
  })
})

/**
 * ⛔ Wave 6 whole-branch review I-3. The wave-5 merge (07e1a74ae) auto-merged
 * wave 5's `readOnly={unreadable}` BESIDE wave 6's `readOnly={locked}` on the
 * title and subtitle inputs; in JSX the later prop wins, so an unreadable note
 * that is not locked took typing again — `commitSave` dropped it silently while
 * the sidebar already showed the new title. And the lock effect handed such a
 * note's editor `setEditable(true)` until the guard re-locked it a render later.
 * ⭐ Typed with user-event, which honours `readOnly` the way a keyboard does:
 * `fireEvent.change` would change a read-only input and prove nothing.
 */
describe('⛔ I-3 — an unreadable note is read-only in its title and subtitle too', () => {
  it('unlocked: both inputs are read-only, typing changes nothing, nothing is renamed or written', async () => {
    body = BODIES.node
    const onTitleChange = vi.fn()
    await renderEditor({ onTitleChange })
    const title = screen.getByPlaceholderText('Title')
    const subtitle = screen.getByPlaceholderText('Subtitle (optional)')
    expect(screen.getByText(UNREADABLE_NOTE_MESSAGE)).toBeInTheDocument()   // the guard tripped
    expect(title.readOnly).toBe(true)
    expect(subtitle.readOnly).toBe(true)

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(title, ' — edited')
    await user.type(subtitle, 'a subtitle')
    await act(async () => { vi.advanceTimersByTime(2000); await settleIdb(8) })

    expect(title.value).toBe('NVDA thesis')
    expect(subtitle.value).toBe('')
    expect(onTitleChange).not.toHaveBeenCalled()          // the sidebar is not told a title that never saves
    expect(updateMock).not.toHaveBeenCalled()             // and no PUT of any kind
  })

  it('a lock and then an unlock never hand the editor back as editable', async () => {
    body = BODIES.node
    const setEditable = vi.spyOn(Editor.prototype, 'setEditable')
    try {
      const onBack = vi.fn()
      const view = await renderEditor({ onBack })
      const NoteEditorPage = (await import('./NoteEditorPage')).default
      const rerender = () => view.rerender(
        <MemoryRouter><NoteEditorPage noteId="n1" onBack={onBack} /></MemoryRouter>)
      noteLocked = true
      await act(async () => { rerender() })
      noteLocked = false
      await act(async () => { rerender() })

      // ⛔ THE LOAD-BEARING ONE: not "is it read-only now" — the guard re-locks a
      // render later, so the end state hides the flip. Was it ever handed `true`?
      expect(setEditable.mock.calls.filter(([editable]) => editable === true)).toEqual([])
      expect(liveEditor().isEditable).toBe(false)
      expect(screen.getByPlaceholderText('Title').readOnly).toBe(true)
      expect(screen.getByPlaceholderText('Subtitle (optional)').readOnly).toBe(true)
    } finally {
      setEditable.mockRestore()
    }
  })

  it('⛔ control: a readable note that is not locked IS typeable (the rail can see typing land)', async () => {
    body = BODIES.control
    const onTitleChange = vi.fn()
    await renderEditor({ onTitleChange })
    const title = screen.getByPlaceholderText('Title')
    expect(title.readOnly).toBe(false)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.type(title, '!')
    expect(title.value).toBe('NVDA thesis!')
    expect(onTitleChange).toHaveBeenCalled()
  })
})
