/**
 * ⛔⛔ B1 (wave 5 final review) — THE EDITOR MAY NOT LAUNDER AN OLD TAB'S BODY
 * THROUGH ITS OWN DECLARATION, AND THE REFUSAL IS NEVER A DEAD END.
 *
 * The scenario the refusal sentence sends a member into: a production tab
 * opened "NVDA thesis" (it holds a formula, a wave-5 type) as EMPTY, the member
 * typed a line, the PUT was refused — "…Reload to edit it." — and the empty
 * stand-in stayed queued: durable record, outbox entry, crash draft, none of
 * them stamped. The member reloads. The NEW bundle recovers those words and, as
 * D3 intends, sends them through its own save. Before this fix it declared ITS
 * OWN level (1): 200, and the note became one line.
 *
 * ⭐ What must happen instead, on every door that forwards recovered words:
 *   · the save declares the WRITER's level (unstamped ⇒ 0), so the server refuses;
 *   · the editor preserves BOTH — the words become a `(conflicted copy)`, the
 *     page shows the server's note — never a bare retry into the same refusal;
 *   · the server's stored body is byte-identical to what it was.
 *
 * Driven on the REAL editor with the REAL `useJ2Note` (so the header asserted is
 * the one `fetch` actually carried), the real offline layer over an in-memory
 * IndexedDB, and a server model that refuses from that header
 * (`lib/offline/__fixtures__/schemaServer.js`). The sweep is mounted excluding
 * the open note, exactly as NotebookTab mounts it, and throws if it is ever the
 * one that sends: the owner of the note decides.
 */
import { render, screen, act, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from '../../lib/offline/__fixtures__/fakeIndexedDb'
import { makeSchemaServer } from '../../lib/offline/__fixtures__/schemaServer'
import { __resetNotebookConnections } from '../../lib/offline/useDurableNote'
import { useOutboxDrain } from '../../lib/offline/useOutboxDrain'
import { OFFLINE_FLAG_KEY } from '../../lib/offline/offlineFlag'
import { dbNameFor } from '../../lib/offline/notebookDb'
import { deriveDeclaredSchema } from '../../lib/notebookSchema'
import { editorSchema } from '../../lib/tiptap'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
// The version-history panel, reduced to its one hand-off into the editor: the
// server's restored version, handed to `onRestored`.
vi.mock('./NoteHistoryPanel', () => ({
  default: ({ onRestored }) => (
    <button type="button" onClick={() => onRestored(globalThis.__restoredVersion)}>stub: restore a version</button>
  ),
}))

const R = '2026-09-24T09:00:00.000000+00:00'
const para = (...inline) => ({ type: 'paragraph', content: inline })
const text = (t) => ({ type: 'text', text: t })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const FORMULA = { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }
/** The note on the server: a formula — level 1. */
const LEVEL1_BODY = doc(para(text('NVDA thesis '), FORMULA))
/** A note any bundle can read — level 0. */
const LEVEL0_BODY = doc(para(text('NVDA thesis, plain')))
const TYPED = 'one line typed into an empty-looking editor'
/** What the production tab queued: its empty stand-in, plus the member's line. */
const BLANK_PLUS_TYPED = doc(para(text(TYPED)))
const CURRENT = deriveDeclaredSchema(editorSchema())

const ACCOUNT_DB = dbNameFor('u42')
let factory
let server
let putGate = null
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
  putGate = null
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  installLocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
})

function serve(body = LEVEL1_BODY, { failCreate = false } = {}) {
  server = makeSchemaServer({ body, updatedAt: R })
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || '').toUpperCase()
    if (putGate && method === 'PUT') await putGate
    if (failCreate && method === 'POST' && String(url) === '/api/j2/notes') {
      return { ok: false, status: 500, json: async () => ({ detail: 'down' }) }
    }
    return server.fetch(url, init)
  })
}

/**
 * What the production tab left behind. ⛔ `stamp: undefined` writes NO
 * `writtenSchema` field at all — the shape of every capture production has ever
 * written. The base is the server copy that tab was shown (at R).
 */
async function queuedByAnOldTab({ body = BLANK_PLUS_TYPED, stamp, permanent = false, draft = true, durable = true, serverBody = LEVEL1_BODY } = {}) {
  factory.open(ACCOUNT_DB)
  await act(async () => { await settleIdb(2) })
  const store = factory.databases.get(ACCOUNT_DB)
  const s = stamp === undefined ? {} : { writtenSchema: stamp }
  if (durable) seedDurable(store, { body, s, permanent, serverBody })
  if (draft) {
    localStorage.setItem('uct.j2.notedraft.n1', JSON.stringify({
      title: 'NVDA thesis', subtitle: '', bodyJson: body, savedAt: 1000, sessionId: 's-prod', ...s,
    }))
  }
}
function seedDurable(store, { body, s, permanent, serverBody }) {
  store.seed('notes', {
    noteId: 'n1', title: 'NVDA thesis', subtitle: '', bodyJson: body, dirty: 1, generation: 5,
    sessionId: 's-prod', localSavedAt: 1000, baseUpdatedAt: R,
    serverBase: { title: 'NVDA thesis', subtitle: '', bodyJson: serverBody, updatedAt: R },
    ...s,
  })
  store.seed('outbox', {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'NVDA thesis', subtitle: '', bodyJson: body },
    baseUpdatedAt: R, generation: 5, sessionId: 's-prod', queuedAt: 1000,
    ...s,
    ...(permanent ? { permanent: true, lastError: 'gone', lastStatus: 404 } : {}),
  })
}

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
async function sit(rounds = 12) {
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
/** The member adds a formula — content only a level-1 bundle can read. */
async function insertFormula() {
  const ed = await liveEditor()
  await act(async () => { ed.chain().focus('end').insertContent({ ...FORMULA, attrs: { latex: 'e^{i\\pi}' } }).run(); await settleIdb(2) })
}

const bodyPuts = () => server.puts.filter((p) => Object.hasOwn(p.patch, 'bodyJson'))
/** PUTs issued by the client, including any still held at the gate. */
const issuedPuts = () => global.fetch.mock.calls
  .filter(([u, i]) => String(u) === '/api/j2/notes/n1' && (i?.method || '').toUpperCase() === 'PUT').length
const outbox = () => factory.databases.get(ACCOUNT_DB)?.dump('outbox') ?? []
const record = () => (factory.databases.get(ACCOUNT_DB)?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const draft = () => JSON.parse(localStorage.getItem('uct.j2.notedraft.n1') || 'null')
const hasFormula = (body) => JSON.stringify(body).includes('inlineMath')

describe('precondition', () => {
  it('this bundle reads level 1, so the hole is reachable here', () => {
    expect(CURRENT).toBe(1)
  })
})

describe('⛔⛔ B1 — adoption: an old tab’s queued blank is never saved over the note', () => {
  it('reloaded into the new bundle, nobody types: declared 0 → refused → kept as a copy; the server note is byte-identical', async () => {
    serve()
    await queuedByAnOldTab()
    const before = server.storedBody()
    await openTheNote()
    await sit(12)

    expect(bodyPuts().length, 'non-vacuity: the owner did send the recovered words').toBeGreaterThan(0)
    expect(bodyPuts().map((p) => p.header), 'the recovered words were sent at the NEW bundle’s level').toEqual(bodyPuts().map(() => '0'))
    expect(bodyPuts().filter((p) => p.status === 200), 'a send of the recovered words landed').toEqual([])
    expect(server.storedBody(), 'the note was written over').toBe(before)
    // Preserved, never dropped: the member's line is a sibling.
    expect(server.forks).toHaveLength(1)
    expect(server.forks[0].title).toBe('NVDA thesis (conflicted copy)')
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(TYPED)
    // ⛔ NEVER a bare retry into the same refusal: at most one refused send.
    expect(bodyPuts()).toHaveLength(1)
    // The page shows the SERVER's note — the formula — not the stand-in.
    expect(hasFormula((await liveEditor()).getJSON()), 'the editor still holds the empty stand-in').toBe(true)
    expect(screen.getByText(/kept as a separate copy/i)).toBeInTheDocument()
    // Settled: nothing left for the sweep to send later, nothing left to fork twice.
    expect(outbox()).toEqual([])
    expect(record()?.dirty).toBe(0)
    expect(sweepSend).not.toHaveBeenCalled()
    expect(sweepFork).not.toHaveBeenCalled()
  })

  it('⭐ and after that, the member’s next keystroke saves on the SERVER’s note at this bundle’s level — the formula survives', async () => {
    serve()
    await queuedByAnOldTab()
    await openTheNote()
    await sit(12)
    await typeInBody(' and a new thought')
    await sit(6)
    const last = bodyPuts().at(-1)
    expect(last.header, 'the taint outlived the fork').toBe(String(CURRENT))
    expect(last.status).toBe(200)
    expect(hasFormula(server.note.bodyJson), 'the formula was dropped').toBe(true)
    expect(JSON.stringify(server.note.bodyJson)).toContain('and a new thought')
  })

  it('⛔ a copy that SAYS it was written at level 0 is treated exactly the same', async () => {
    serve()
    await queuedByAnOldTab({ stamp: 0 })
    const before = server.storedBody()
    await openTheNote()
    await sit(12)
    expect(server.storedBody()).toBe(before)
    expect(server.forks).toHaveLength(1)
  })
})

describe('⭐ CONTROL — ordinary same-version offline recovery still lands', () => {
  it('words queued by a level-1 bundle on the same note are adopted, sent at level 1, and land — no copy', async () => {
    serve()
    const mine = doc(para(text('NVDA thesis '), FORMULA), para(text('written offline in the new bundle')))
    await queuedByAnOldTab({ body: mine, stamp: CURRENT })
    await openTheNote()
    await sit(12)
    expect(bodyPuts().map((p) => [p.header, p.status])).toEqual([[String(CURRENT), 200]])
    expect(server.storedBody()).toBe(JSON.stringify(mine))
    expect(server.forks).toHaveLength(0)
    expect(outbox()).toEqual([])
  })
})

describe('⛔⛔ B1 — the stamp is STICKY: what the new bundle writes about recovered words keeps their writer’s level', () => {
  it('while the adopted words’ save is still on the wire, the NEW durable copy, queue entry and draft all say 0 — even after another keystroke', async () => {
    serve()
    await queuedByAnOldTab()
    let release
    putGate = new Promise((r) => { release = r })
    await openTheNote()
    await sit(4)                                            // adopted; its save is held on the wire
    expect(issuedPuts(), 'precondition: the adopted words’ save was issued').toBeGreaterThan(0)
    await typeInBody(' typed during the held save')
    await sit(2)
    // Were the tab to die now, the next load would find these — and must still
    // send them at 0, never at this bundle's 1.
    expect(record()?.writtenSchema).toBe(0)
    expect(outbox()[0]?.writtenSchema).toBe(0)
    expect(draft()?.writtenSchema).toBe(0)
    expect(JSON.stringify(record()?.bodyJson)).toContain('typed during the held save')
    release(); putGate = null
    await sit(8)
    expect(hasFormula(server.note.bodyJson), 'the note was written over').toBe(true)
    expect(bodyPuts().filter((p) => p.status === 200), 'a send of the recovered words landed').toEqual([])
    // ⛔ Two saves refused together share ONE copy — and it holds the later words.
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain('typed during the held save')
  })

  it('⭐ an ordinary edit of a note this bundle READ is stamped with this bundle’s level, everywhere', async () => {
    serve()
    let release
    putGate = new Promise((r) => { release = r })            // keep it unsent, so the queue holds it
    await openTheNote()
    await typeInBody(' a fresh line')
    await sit(2)
    expect(record()?.writtenSchema).toBe(CURRENT)
    expect(outbox()[0]?.writtenSchema).toBe(CURRENT)
    expect(draft()?.writtenSchema).toBe(CURRENT)
    release(); putGate = null
    await sit(4)
    expect(bodyPuts().at(-1).header).toBe(String(CURRENT))
  })
})

describe('⛔⛔ B1 — Restore: a recovered copy is sent at ITS writer’s level', () => {
  async function clickRestore() {
    const btn = await screen.findByRole('button', { name: 'Restore' })
    await act(async () => { fireEvent.click(btn); await settleIdb(6) })
    await sit(10)
  }

  it('a crash draft alone (an old tab’s, unstamped): Restore declares 0 → refused → kept as a copy; the note is untouched', async () => {
    serve()
    // Only the draft: no durable copy, no queue (the old tab had no durable
    // store, or it was cleared) — so the banner offers it and Restore PUTs it.
    await queuedByAnOldTab({ durable: false })
    const before = server.storedBody()
    await openTheNote()
    await sit(4)
    await clickRestore()
    expect(bodyPuts().length, 'non-vacuity: Restore sent the draft').toBeGreaterThan(0)
    expect(bodyPuts().map((p) => p.header)).toEqual(bodyPuts().map(() => '0'))
    expect(bodyPuts().filter((p) => p.status === 200)).toEqual([])
    expect(server.storedBody(), 'Restore wrote the old tab’s draft over the note').toBe(before)
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(TYPED)
    expect(hasFormula((await liveEditor()).getJSON()), 'the editor still holds the draft').toBe(true)
    // …and a keystroke afterwards cannot carry the draft over the note either.
    await typeInBody(' afterwards')
    await sit(6)
    expect(hasFormula(server.note.bodyJson)).toBe(true)
    expect(server.note.bodyJson ? JSON.stringify(server.note.bodyJson) : '').not.toContain(TYPED)
  })

  it('the banner’s Restore of a BLOCKED queued copy (the base-known path) is refused and kept the same way', async () => {
    serve()
    await queuedByAnOldTab({ permanent: true })              // blocked ⇒ the banner, not adoption
    const before = server.storedBody()
    await openTheNote()
    await sit(4)
    expect(bodyPuts(), 'a blocked entry was sent without the member').toEqual([])
    await clickRestore()
    expect(bodyPuts().map((p) => p.header)).toEqual(bodyPuts().map(() => '0'))
    expect(server.storedBody()).toBe(before)
    expect(server.forks).toHaveLength(1)
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(TYPED)
  })
})


async function restoreFromTheBanner() {
  const btn = await screen.findByRole('button', { name: 'Restore' })
  await act(async () => { fireEvent.click(btn); await settleIdb(6) })
  await sit(10)
}

describe('⭐ CONTROL — the banner’s Restore of a copy THIS bundle wrote still lands', () => {
  it('a blocked copy stamped at this bundle’s level, Restored: sent at that level, lands, no copy', async () => {
    serve()
    const mine = doc(para(text('NVDA thesis '), FORMULA), para(text('restored in the new bundle')))
    await queuedByAnOldTab({ body: mine, stamp: CURRENT, permanent: true })
    await openTheNote()
    await sit(4)
    await restoreFromTheBanner()
    expect(bodyPuts().map((p) => [p.header, p.status])).toEqual([[String(CURRENT), 200]])
    expect(server.storedBody()).toBe(JSON.stringify(mine))
    expect(server.forks).toHaveLength(0)
  })
})

// ⛔ The stamp must also LET GO. Once a save of recovered words LANDS, the server
// holds them — accepted at their writer's level — and what the member types
// next is this bundle's own. A taint that outlived the landing would declare 0
// over a note the member has since given a formula, and every later save would
// be refused and copied: over-refusal on the member's OWN words.
describe('⭐ once recovered words LAND, the editor is this bundle’s own again', () => {
  it('adoption: an old tab’s copy of a LEVEL-0 note lands at 0; then a formula and more typing all land — no copy', async () => {
    serve(LEVEL0_BODY)
    await queuedByAnOldTab({ body: doc(para(text('NVDA thesis, plain')), para(text(TYPED))), serverBody: LEVEL0_BODY })
    await openTheNote()
    await sit(8)
    expect(bodyPuts().map((p) => [p.header, p.status]), 'the old tab’s words on a note it could read land at 0').toEqual([['0', 200]])
    await insertFormula()
    await sit(4)
    await typeInBody(' and then more')
    await sit(4)
    expect(bodyPuts().slice(1).map((p) => [p.header, p.status])).toEqual(
      bodyPuts().slice(1).map(() => [String(CURRENT), 200]),
    )
    expect(bodyPuts().length, 'non-vacuity: the later edits were saved').toBeGreaterThanOrEqual(3)
    expect(hasFormula(server.note.bodyJson)).toBe(true)
    expect(JSON.stringify(server.note.bodyJson)).toContain('and then more')
    expect(server.forks, 'the member’s own later words were refused and copied').toHaveLength(0)
  })

  it('Restore: an old tab’s crash draft of a LEVEL-0 note lands at 0; then a formula and more typing all land — no copy', async () => {
    serve(LEVEL0_BODY)
    await queuedByAnOldTab({ body: doc(para(text('NVDA thesis, plain')), para(text(TYPED))), durable: false })
    await openTheNote()
    await sit(4)
    await restoreFromTheBanner()
    expect(bodyPuts().map((p) => [p.header, p.status])).toEqual([['0', 200]])
    await insertFormula()
    await sit(4)
    await typeInBody(' and then more')
    await sit(4)
    expect(bodyPuts().slice(1).map((p) => p.header)).toEqual(bodyPuts().slice(1).map(() => String(CURRENT)))
    expect(bodyPuts().length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(server.note.bodyJson)).toContain('and then more')
    expect(server.forks).toHaveLength(0)
  })

  it('a VERSION RESTORE puts the server’s copy on screen — what is typed on it is this bundle’s own', async () => {
    serve()
    await queuedByAnOldTab()
    let release
    putGate = new Promise((r) => { release = r })
    await openTheNote()
    await sit(4)                                            // the old tab's words are adopted; their save is held
    globalThis.__restoredVersion = { ...server.note, bodyJson: LEVEL1_BODY }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'stub: restore a version' })); await settleIdb(4) })
    expect(hasFormula((await liveEditor()).getJSON()), 'precondition: the restored version is on screen').toBe(true)
    await typeInBody(' typed on the restored version')
    await act(async () => { vi.advanceTimersByTime(900); await settleIdb(6) })   // its save leaves (held)
    const typedSave = () => server.puts.find((p) => JSON.stringify(p.patch.bodyJson || '').includes('typed on the restored version'))
    release(); putGate = null
    await sit(10)
    expect(typedSave(), 'non-vacuity: the typed save reached the server').toBeTruthy()
    expect(typedSave().header, 'words typed on the server’s own copy went out at the old tab’s level').toBe(String(CURRENT))
    expect(hasFormula(server.note.bodyJson)).toBe(true)
    delete globalThis.__restoredVersion
  })
})

describe('⛔ if keeping a copy FAILS, the refusal is reported — never retried — and the words stay on this device', () => {
  it('the create is down: exactly one refused send, the note untouched, the words still in the durable copy and the queue', async () => {
    serve(LEVEL1_BODY, { failCreate: true })
    await queuedByAnOldTab()
    const before = server.storedBody()
    await openTheNote()
    await sit(12)
    expect(bodyPuts().map((p) => [p.header, p.status]), 'the refusal was retried').toEqual([['0', 409]])
    expect(server.storedBody()).toBe(before)
    expect(server.forks).toHaveLength(0)
    expect(screen.getByText(/Save failed/)).toBeInTheDocument()
    expect(JSON.stringify(record()?.bodyJson)).toContain(TYPED)
    expect(record()?.dirty).toBe(1)
    expect(JSON.stringify(outbox()[0]?.patch)).toContain(TYPED)
    expect(outbox()[0]?.writtenSchema, 'the queue must still say who wrote them').toBe(0)
  })
})
