/**
 * ⭐⭐ D3 / F5P-1 — QUEUED WORDS LEAVE WHILE THE MEMBER SITS ON THE NOTE.
 *
 * THE EXACT F5P-1 SCENARIO (`docs/notebook/q1-product-followups.md`): the member
 * queued words offline, left the note, and came back to it — and sits there.
 * Nobody types. The real editor and the real sweep (excluding the note the editor
 * owns, as NotebookTab mounts it) run against an in-memory IndexedDB and a
 * compare-and-set server.
 *
 * ⛔ The single writer is the EDITOR: the sweep's send/fork throw if called.
 * ⛔ Each server state is a different door the member met while away — nothing,
 * a metadata door, an append door, a second writer — and each must end with the
 * words on the server, the queue empty, and at most the ONE fork a genuine
 * second writer earns. A blocked entry must still wait for the member.
 *
 * Lands WITH the editor change (E-1 adopt / E-3 settle the owner's fork),
 * `docs/notebook/f5-fixes-2026-09-23.md` §B. Against the editor without it, the
 * four send cells are RED: the words never leave.
 */
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { __resetNotebookConnections } from './useDurableNote'
import { useOutboxDrain } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const ONLINE = para('typed online.')
const SENTENCE = 'typed offline while away - THIS must reach the server.'
const MINE = doc(ONLINE, para(SENTENCE))
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T09:04:00Z', searchText: 'NVDA' } }

// ── a server with compare-and-set, the only axis that matters ───────────────
let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Thesis', subtitle: '', body, updatedAt, puts: [], forks: [],
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-09-23T09:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  return s
}
const update = vi.fn(async (patch) => {
  server.puts.push(patch)
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== server.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) server.body = patch.bodyJson
  if ('title' in patch) server.title = patch.title
  server.stamp()
  return server.note()
})
let mountedNote = null
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: mountedNote, isLoading: false, error: null, update, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../noteCreation', () => ({
  createNoteViaApi: vi.fn(async (args) => { server.forks.push(args); return { id: 'fork-1', ...args } }),
}))

const ACCOUNT_DB = dbNameFor('u42')
let factory
const sweepSend = vi.fn(async () => { throw new Error('the sweep must never send the note the editor owns') })
const sweepFork = vi.fn(async () => { throw new Error('the sweep must never fork the note the editor owns') })

function installLocks() {
  const held = new Set()
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (name, opts, cb) => {
        if (opts?.ifAvailable) {
          if (held.has(name)) return cb(null)
          held.add(name)
          return cb({ name })
        }
        return new Promise(() => {})
      },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear(); sweepSend.mockClear(); sweepFork.mockClear()
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  installLocks()
  global.fetch = vi.fn((url) => {
    if (String(url) === '/api/j2/notes/n1') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: server.note() }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

/** The member typed offline on the note, left it, and the queue holds their words. */
async function queuedWhileAway({ permanent = false } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  store.seed('notes', {
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: MINE, dirty: 1, generation: 5,
    sessionId: 's-away', localSavedAt: 1000, baseUpdatedAt: T0,
    serverBase: { title: 'Thesis', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 },
  })
  store.seed('outbox', {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: MINE },
    baseUpdatedAt: T0, generation: 5, sessionId: 's-away', queuedAt: 1000,
    ...(permanent ? { permanent: true, lastError: 'gone', lastStatus: 404 } : {}),
  })
}

/** What NotebookTab renders: the editor, and the sweep excluding the note it owns. */
function Tab({ Editor }) {
  useOutboxDrain({ accountId: 'u42', excludeNoteId: 'n1', send: sweepSend, fork: sweepFork })
  return <Editor noteId="n1" onBack={() => {}} />
}

async function returnToTheNoteAndSit() {
  mountedNote = server.note()
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(<MemoryRouter><Tab Editor={mod.default} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  // ⛔ NOBODY TYPES. Sit on the note: past the durable window, the 800ms
  // autosave, a 409 round trip and its 50ms retry, several times over.
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}

const outbox = () => factory.databases.get(ACCOUNT_DB)?.dump('outbox') ?? []
const record = () => (factory.databases.get(ACCOUNT_DB)?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const serverText = () => JSON.stringify(server.body)
const hasWidget = () => (server.body?.content || []).some((n) => n.type === 'widgetEmbed')

describe('F5P-1 — queued words leave while the member sits on the note', () => {
  it('nothing moved on the server: the owner sends them, no banner, queue settled', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText(), 'the queued sentence reached the server').toContain(SENTENCE)
    expect(screen.queryByText(/Unsaved changes from a previous session/i)).toBeNull()
    expect(outbox()).toHaveLength(0)
    expect(record()?.dirty).toBe(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('a metadata door moved it while away: 409, rebase, sent — no fork', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText()).toContain(SENTENCE)
    expect(server.puts[0]?.baseUpdatedAt, 'the first send is on the words’ own base').toBe(T0)
    expect(outbox()).toHaveLength(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('an append door added a widget while away: merged — sentence AND widget survive, no fork', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText()).toContain(SENTENCE)
    expect(hasWidget(), 'the captured widget was dropped').toBe(true)
    expect(outbox()).toHaveLength(0)
    expect(record()?.dirty).toBe(0)
    expect(server.forks).toHaveLength(0)
    expect(sweepSend).not.toHaveBeenCalled()
  })

  it('a second writer rewrote it while away: exactly ONE fork, never clobbered, queue settled', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway()
    await returnToTheNoteAndSit()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(serverText()).not.toContain(SENTENCE)
    expect(server.forks, 'the member’s words must be preserved in exactly one sibling').toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
    expect(outbox(), 'a settled fork leaves nothing for the sweep to fork again').toHaveLength(0)
    expect(sweepFork).not.toHaveBeenCalled()
  })

  it('a BLOCKED entry is not auto-sent — the member is asked, as before', async () => {
    server = makeServer({ body: doc(ONLINE), updatedAt: T0 })
    await queuedWhileAway({ permanent: true })
    await returnToTheNoteAndSit()
    expect(server.puts).toHaveLength(0)
    expect(outbox()).toHaveLength(1)
  })
})

/** The banner path, still used for copies the owner must not send by itself. */
async function restoreThenType() {
  const restore = await screen.findByRole('button', { name: 'Restore' })
  await act(async () => { fireEvent.click(restore); await settleIdb(6) })
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
  // One keystroke after the Restore — the moment the measured clobber happened.
  fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Thesis!' } })
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}

describe('D3 — Restore never overwrites a server that moved, and never drops its appends', () => {
  it('⛔⛔ Restore after a second writer, then a keystroke: ONE fork, the other device’s words kept', async () => {
    server = makeServer({ body: doc(para('rewritten on another device')), updatedAt: T1 })
    await queuedWhileAway({ permanent: true })          // blocked ⇒ the banner, not adoption
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(SENTENCE)
  })

  it('⛔⛔ Restore after an append door, then a keystroke: the words AND the widget survive, no fork', async () => {
    server = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queuedWhileAway({ permanent: true })
    await returnToTheNoteAndSit()
    await restoreThenType()
    expect(serverText()).toContain(SENTENCE)
    expect(hasWidget(), 'the captured widget was dropped').toBe(true)
    expect(server.forks).toHaveLength(0)
  })
})
