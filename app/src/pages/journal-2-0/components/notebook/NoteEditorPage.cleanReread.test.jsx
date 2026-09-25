/**
 * ⛔⛔ Ruling D-G5 (wave 7 whole-branch fix, frontend review I-3) — A CLEAN OPEN EDITOR RE-READS
 * ITS NOTE WHEN THE MEMBER COMES BACK, AND ADOPTS A NEWER SERVER BODY.
 *
 * The personal API and email-in append to a note on the server (lane G). The open editor never
 * adopted a server change: its fresh-body swap is keyed on the note id, and the single-note SWR
 * does not revalidate on focus. So a member who left today's daily note open on the desktop, fired
 * the iOS Shortcut from the phone, came back and typed ONE word saved against the pre-append base,
 * got a 409, and the classifier (F5-frozen: only widgetEmbed / financialFact / documentExcerpt
 * merge) read the appended paragraph as a BODY_REWRITE -- a `(conflicted copy)` for a member who
 * had no unsent words at all. The documented trigger ("open in a tab with unsaved words") was
 * narrower than the real one ("open in a tab").
 *
 * The fix touches no F5-frozen file (serverChange.js, settleNoteWrite.js, outboxDrain.js): when the
 * tab becomes visible or the window regains focus, an editor that is CLEAN -- nothing typed since
 * the last landed save, no save pending or on the wire, and nothing unsent for the note by the
 * offline layer's own predicate (`noteHasUnsentWork`: not dirty, nothing in the outbox) -- re-reads
 * the note and, when the server's revision is newer, adopts it through the editor's existing
 * server-copy adoption path (the one a version restore uses). An editor HOLDING unsent words keeps
 * today's behaviour exactly: its save 409s and the note forks, never clobbered.
 *
 * Driven on the REAL editor with the REAL `useJ2Note`, the real offline layer over an in-memory
 * IndexedDB, and a server model with compare-and-set (`__fixtures__/schemaServer.js`). The append
 * is a direct write into the server model, the way a personal-API or email-in append lands.
 */
import { render, screen, act, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb, installKeyRange } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { makeSchemaServer } from '../../lib/offline/__fixtures__/schemaServer'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { useOutboxDrain } from '../../lib/offline/useOutboxDrain'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const R = '2026-09-24T09:00:00.000000+00:00'
const APPENDED_AT = '2026-09-24T12:40:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const BODY = doc(para('Daily note, Thursday.'), para('Watching NVDA into the open.'))
const APPENDED = 'Added from my phone: trimmed half of SMCI.'

const ACCOUNT_DB = dbNameFor('u42')
let factory
let server
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
  sweepSend.mockClear(); sweepFork.mockClear()
  __resetNotebookConnections()
  installKeyRange()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  installLocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  server = makeSchemaServer({ body: BODY, updatedAt: R, title: 'Daily note' })
  global.fetch = vi.fn(async (url, init = {}) => server.fetch(url, init))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

function Tab({ Editor }) {
  useOutboxDrain({ accountId: 'u42', excludeNoteId: 'n1', send: sweepSend, fork: sweepFork })
  return <Editor noteId="n1" onBack={() => {}} />
}
async function openTheNote() {
  const mod = await import('./NoteEditorPage')
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><Tab Editor={mod.default} /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
}
async function sit(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(500); await settleIdb(6) })
  }
}
async function liveEditor() {
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
async function typeInBody(t) {
  const ed = await liveEditor()
  await act(async () => { ed.chain().focus('end').insertContent(t).run(); await settleIdb(2) })
}
/** What a personal-API / email-in append does to the stored note: one ordinary paragraph at the
 *  end, and a new revision. No client is told. */
function appendOnTheServer() {
  server.note.bodyJson = { ...server.note.bodyJson, content: [...server.note.bodyJson.content, para(APPENDED)] }
  server.note.updatedAt = APPENDED_AT
}
async function comeBack(kind = 'visibility') {
  await act(async () => {
    if (kind === 'visibility') document.dispatchEvent(new Event('visibilitychange'))
    else window.dispatchEvent(new Event('focus'))
    await settleIdb(4)
  })
  await sit(4)
}
const bodyPuts = () => server.puts.filter((p) => Object.hasOwn(p.patch, 'bodyJson'))
const noteGets = () => global.fetch.mock.calls
  .filter(([u, i]) => String(u) === '/api/j2/notes/n1' && !(i?.method && i.method !== 'GET')).length
const text = (body) => JSON.stringify(body)

describe('⭐ D-G5 — a CLEAN open editor adopts a server append when the member comes back', () => {
  it('visibilitychange: the append is adopted, the next word lands on it -- no conflicted copy', async () => {
    await openTheNote()
    await sit(6)
    expect(server.forks).toHaveLength(0)
    const getsBefore = noteGets()

    appendOnTheServer()
    await comeBack('visibility')
    expect(noteGets(), 'the clean editor re-read its note').toBeGreaterThan(getsBefore)
    expect(text((await liveEditor()).getJSON()), 'the append is on screen before any typing').toContain(APPENDED)

    await typeInBody(' one')
    await sit(6)
    expect(server.forks, 'a member with no unsent words got a conflicted copy').toHaveLength(0)
    expect(bodyPuts().at(-1).status).toBe(200)
    expect(text(server.note.bodyJson)).toContain(APPENDED)
    expect(text(server.note.bodyJson)).toContain('one')
  })

  it('window focus (a window switched back to) does the same', async () => {
    await openTheNote()
    await sit(6)
    appendOnTheServer()
    await comeBack('focus')
    await typeInBody(' two')
    await sit(6)
    expect(server.forks).toHaveLength(0)
    expect(text(server.note.bodyJson)).toContain(APPENDED)
    expect(text(server.note.bodyJson)).toContain('two')
  })
})

describe('⛔ D-G5 — an editor holding unsent words keeps fork-never-clobber', () => {
  it('words typed and not yet sent when the member comes back: nothing is adopted, the save forks, the append survives', async () => {
    await openTheNote()
    await sit(6)
    await typeInBody(' my unsent line')          // the autosave debounce has not fired yet
    appendOnTheServer()
    await comeBack('visibility')
    await sit(10)
    expect(server.forks, 'unsent words must become a conflicted copy, never be merged or dropped').toHaveLength(1)
    expect(text(server.forks[0].bodyJson)).toContain('my unsent line')
    expect(text(server.note.bodyJson), 'the append was clobbered').toContain(APPENDED)
    expect(text(server.note.bodyJson)).not.toContain('my unsent line')
  })

  it('an entry still QUEUED for the note in the offline layer: the editor does not adopt', async () => {
    await openTheNote()
    await sit(6)
    // Another tab of this browser queued words for this note and the drain has not delivered them
    // (the sweep excludes the note this editor owns). The editor itself is clean.
    factory.databases.get(ACCOUNT_DB).seed('outbox', {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'Daily note', subtitle: '', bodyJson: doc(para('queued elsewhere')) },
      baseUpdatedAt: R, generation: 9, sessionId: 's-other-tab', queuedAt: 2000,
    })
    appendOnTheServer()
    await comeBack('visibility')
    expect(text((await liveEditor()).getJSON()), 'adopted over queued work').not.toContain(APPENDED)
  })
})
