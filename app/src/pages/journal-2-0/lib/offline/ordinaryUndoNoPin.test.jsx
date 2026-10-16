/**
 * ⭐⭐ AN ORDINARY UNDO OR REDO IS AN EDIT OF THE VIEW — IT NEVER PINS THE DURABLE
 * RECORD. AN UNDO OR REDO THAT CROSSES A WHOLE-VIEW SWAP STILL DOES.
 *
 * ⚰️ THE DEFECT (re-review M2 of the mid-text hotfix, `rails/probe-undo-own.log`
 * in the #342 evidence). Fix round 1 of that hotfix minted a NEW edit lineage on
 * EVERY undo or redo, because an Undo past a whole-view swap could otherwise let a
 * capture of the pre-swap page supersede words the swap put on screen. But a new
 * lineage is also what an ordinary Undo of the member's own typing got: its
 * capture then lost the containment test against the record the same view wrote a
 * moment earlier, and the record stayed PINNED to the pre-undo words for the rest
 * of the view (later captures: another lineage; later landed saves: the strict
 * settle). Measured outcomes, no words lost, master the same:
 *   · Undo back to text that has already landed, then leave: the undone text is
 *     re-sent and lands in the main note SILENTLY — the member's Undo reversed.
 *   · Undo to an unsaved state and keep typing: one spurious `(conflicted copy)`.
 *
 * ⭐ THE RULING: the lineage rotates on an undo or redo only when it CROSSES a
 * whole-view swap — when the history transaction replaces the whole document
 * (every `replaceDocument` swap is one whole-document replace step, and so is its
 * undo and its redo), or when it crosses a crash-draft Restore (`noteRestoreCrossing`).
 * Anything else is the member editing the view, and supersedes like a keystroke.
 *
 * (a) type, let it land, Undo, leave ⇒ the server ends with the post-undo text, no fork
 * (b) type (unsent), Undo, keep typing, leave ⇒ the server ends with the final text,
 *     no `(conflicted copy)` — online, and offline then back online
 * (c) the Redo variants of both
 * (d) the swaps still keep the offline words when Undo crosses them (the version
 *     restore here; adoption and both crash-draft Restores in
 *     `swapLineageRotation.test.jsx` C1 and `restoreUndoKeepsWords.test.jsx`)
 * (e) a genuine second writer still forks — with the member's NEWEST words
 *
 * (a)–(c) are RED on `35dc861b85` (the I-A tip, round 1's rotate-on-every-undo).
 * The REAL editor, the REAL durable layer over the fake IndexedDB, a real Undo and
 * Redo, the REAL drain, and a compare-and-set server.
 */
import { render, screen, act, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb } from './__fixtures__/fakeIndexedDb'
import { dbNameFor } from './notebookDb'
import { drainOutbox, FORKED } from './outboxDrain'
import { __resetNotebookConnections } from './useDurableNote'
import { serverCopyIsOursDefault } from './useOutboxDrain'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

// The real editor and several durable windows per rail: past the default budget.
vi.setConfig({ testTimeout: 60_000 })

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const T0 = '2026-10-16T20:00:00.000000+00:00'
const TV = '2026-10-16T20:30:00.000000+00:00'

let server
function makeServer({ body, updatedAt }) {
  let rev = 0
  const s = {
    title: 'Note', subtitle: '', body, updatedAt, forks: [], offline: false,
    note: () => ({
      id: 'n1', title: s.title, subtitle: s.subtitle, folderId: null, ticker: null, tags: [],
      heroImageUrl: null, isFavorite: false, bodyJson: s.body, updatedAt: s.updatedAt,
    }),
    stamp: () => { rev += 1; s.updatedAt = `2026-10-16T20:10:${String(10 + rev).padStart(2, '0')}.000000+00:00` },
  }
  return s
}
/** Compare-and-set: the editor's save AND the drain's send meet the same server. */
function casPut(patch) {
  if (patch.baseUpdatedAt && patch.baseUpdatedAt !== server.updatedAt) {
    const e = new Error('note changed — refresh and retry'); e.status = 409; throw e
  }
  if (patch.bodyJson) server.body = patch.bodyJson
  if ('title' in patch) server.title = patch.title
  if ('subtitle' in patch) server.subtitle = patch.subtitle ?? ''
  server.stamp()
  return server.note()
}
const update = vi.fn(async (patch) => {
  if (server.offline) throw new Error('network down')      // no status ⇒ retried, never forked
  return casPut(patch)
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
// ⭐ Every lineage the editor mints — the real function runs; only its answers are recorded.
const minted = vi.hoisted(() => [])
vi.mock('./useDurableNote', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    newEditLineage: () => { const id = real.newEditLineage(); minted.push(id); return id },
  }
})
// The version-history panel's hand-off, without its UI (as `swapLineageRotation.test.jsx`).
const versionGate = vi.hoisted(() => ({ note: null }))
vi.mock('../../components/notebook/NoteHistoryPanel', async () => {
  const React = await import('react')
  return {
    default: ({ onRestored }) => React.createElement('button', {
      type: 'button', onClick: () => onRestored?.(versionGate.note),
    }, 'rail: restore a version'),
  }
})

const ACCOUNT_DB = dbNameFor('u42')
let factory

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  update.mockClear()
  minted.length = 0
  versionGate.note = null
  __resetNotebookConnections()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
  global.fetch = vi.fn((url) => {
    if (String(url) === '/api/j2/notes/n1') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ note: server.note() }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function tick(ms) {
  await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) })
}
async function openTheNote() {
  mountedNote = server.note()
  const NoteEditorPage = (await import('../../components/notebook/NoteEditorPage')).default
  render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  await tick(600)
}
async function editor() {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  return dom.editor
}
/** A real editor transaction, so the editor's own draft / durable / autosave paths run. */
async function edit(fn) {
  const ed = await editor()
  await act(async () => { fn(ed.chain()).run(); await settleIdb(2) })
}
/** The touch Undo / Redo buttons' own commands. */
const undo = () => edit((c) => c.focus().undo())
const redo = () => edit((c) => c.focus().redo())
const viewText = async () => (await editor()).getText()
const store = () => factory.databases.get(ACCOUNT_DB)
const outbox = () => store()?.dump('outbox') ?? []
const record = () => (store()?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const serverText = () => JSON.stringify(server.body)
/** The member left: the editor unmounts and the sweep drains, as on the page they landed on. */
async function leaveAndDrain() {
  cleanup()
  await tick(50)
  const fork = vi.fn(async (entry) => { server.forks.push(entry); return server.note() })
  const send = vi.fn(async (entry) => casPut({
    title: entry.patch?.title ?? '', subtitle: entry.patch?.subtitle || null,
    ...(entry.patch?.bodyJson ? { bodyJson: entry.patch.bodyJson } : {}),
    ...(entry.baseUpdatedAt ? { baseUpdatedAt: entry.baseUpdatedAt } : {}),
  }))
  const results = await drainOutbox(store(), { send, fork, serverCopyIsOurs: serverCopyIsOursDefault })
  return { fork, send, results }
}
/** The server holds exactly `t` as its one paragraph. */
const holdsExactly = (t) => serverText() === JSON.stringify(doc(para(t)))
function expectNoFork({ fork, results }) {
  expect(fork, 'a (conflicted copy) of a note only this member touched').not.toHaveBeenCalled()
  expect(results.map((r) => r.outcome)).not.toContain(FORKED)
  expect(server.forks, 'a sibling note was created').toHaveLength(0)
}

// ── (a) ─────────────────────────────────────────────────────────────────────
describe('(a) type, let it land, Undo, leave ⇒ the server ends with the post-undo text and no fork', () => {
  it('⭐⭐ Undo back to text that has already landed: the undone text is NOT re-sent behind the member’s back', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(1500)                                     // the autosave fires and LANDS
    expect(holdsExactly('ab cd ef'), 'precondition: the first edit landed').toBe(true)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(300)                                      // its durable write lands; its save has not
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds the typing about to be undone').toContain(' gh')
    await undo()
    expect(await viewText(), 'precondition: the Undo took the typing back off the page').toBe('ab cd ef')
    await tick(1500)
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd ef'), `the member's Undo was reversed on the server: ${serverText()}`).toBe(true)
    expect(outbox(), 'nothing is left queued').toHaveLength(0)
  })

  it('⭐ the plain one-edit case: type, it lands, Undo it, it lands, leave', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(1500)
    expect(holdsExactly('ab cd ef'), 'precondition: the edit landed').toBe(true)
    await undo()
    await tick(1500)
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd'), `the server does not hold the post-undo text: ${serverText()}`).toBe(true)
  })
})

// ── (b) ─────────────────────────────────────────────────────────────────────
describe('(b) type (unsent), Undo, keep typing, leave ⇒ the server ends with the final text and no (conflicted copy)', () => {
  it('⭐⭐ online: the Undo comes before the first save, the next save lands, the member leaves', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)                                      // durable write lands; the save has not
    expect(outbox(), 'precondition: the unsent edit is queued').toHaveLength(1)
    await undo()
    await tick(300)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(1500)                                     // the save of the final text lands
    expect(holdsExactly('ab cd gh'), 'precondition: the member’s own save landed').toBe(true)
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd gh'), `the server does not hold the final text: ${serverText()}`).toBe(true)
    expect(outbox(), 'nothing is left queued').toHaveLength(0)
  })

  it('⭐⭐ offline: type, Undo, keep typing, come back online and leave — the durable copy and the queue hold the FINAL text', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    await undo()
    await tick(300)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(1500)
    expect(holdsExactly('ab cd'), 'precondition: nothing landed').toBe(true)
    expect(JSON.stringify(record()?.bodyJson), `the durable copy does not hold the member's final text: ${JSON.stringify(record()?.bodyJson)}`).toContain('ab cd gh')
    server.offline = false
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd gh'), `the server does not hold the final text: ${serverText()}`).toBe(true)
  })
})

// ── (c) ─────────────────────────────────────────────────────────────────────
describe('(c) the Redo variants', () => {
  it('⭐⭐ (a) by Redo: a landed deletion, Undo, Redo back to the landed text, leave ⇒ no silent revert', async () => {
    server = makeServer({ body: doc(para('ab cd ef')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.deleteRange({ from: 6, to: 9 }))  // ' ef'
    await tick(1500)
    expect(holdsExactly('ab cd'), 'precondition: the deletion landed').toBe(true)
    await undo()                                         // ' ef' back on the page (unsent)
    await tick(300)
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds what the Redo will remove').toContain('ab cd ef')
    await redo()                                         // ' ef' gone again — the landed text
    expect(await viewText(), 'precondition: the Redo took it back off the page').toBe('ab cd')
    await tick(1500)
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd'), `the member's Redo was reversed on the server: ${serverText()}`).toBe(true)
  })

  it('⭐⭐ (b) by Redo: delete (unsent), Undo, Redo, keep typing, leave ⇒ the final text, no (conflicted copy)', async () => {
    server = makeServer({ body: doc(para('ab cd ef')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.deleteRange({ from: 6, to: 9 }))
    await tick(300)
    await undo()
    await tick(300)
    await redo()
    await tick(300)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(1500)
    expect(holdsExactly('ab cd gh'), 'precondition: the member’s own save landed').toBe(true)
    const out = await leaveAndDrain()
    expectNoFork(out)
    expect(holdsExactly('ab cd gh'), `the server does not hold the final text: ${serverText()}`).toBe(true)
  })

  it('⭐ an ordinary Undo and Redo mint no lineage (they are the member’s edits of this view)', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    const before = minted.length
    await undo()
    await redo()
    await undo()
    expect(minted.length, 'an ordinary Undo/Redo replaced the view’s lineage').toBe(before)
  })
})

// ── (d) ─────────────────────────────────────────────────────────────────────
describe('(d) an Undo across a whole-view swap still rotates, and the offline words survive', () => {
  it('version restore: the old view’s unsent words survive typing on the restored version AND an Undo back across it', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true                                // the old view's words never land
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(400)
    expect(record()?.dirty, 'precondition: the old view wrote a dirty record').toBeTruthy()
    server.body = doc(para('a restored version'))
    server.updatedAt = TV
    versionGate.note = server.note()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rail: restore a version' })); await settleIdb(6) })
    expect(await viewText(), 'precondition: the version is on the page').toContain('a restored version')
    await tick(600)                                      // past the history group delay: ' gh' is its own step
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(400)
    const before = minted.length
    await undo()                                         // ' gh' — an ordinary Undo
    expect(minted.length, 'an ordinary Undo on the restored version minted a lineage').toBe(before)
    await undo()                                         // across the version restore
    expect(await viewText(), 'precondition: the Undo crossed the version restore').not.toContain('a restored version')
    expect(minted.length, 'an Undo across the version restore did NOT mint a lineage').toBeGreaterThan(before)
    await tick(1500)
    const kept = [JSON.stringify(record()?.bodyJson ?? null), ...outbox().map((e) => JSON.stringify(e.patch))]
    expect(kept.some((b) => b.includes('ab cd ef')), 'the old view’s unsent words left the durable copy and the queue').toBe(true)
  })

  it('a swap’s own Undo and Redo each mint a lineage; an Undo inside the swapped-in view does not', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.body = doc(para('a restored version'))
    server.updatedAt = TV
    versionGate.note = server.note()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rail: restore a version' })); await settleIdb(6) })
    await tick(600)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(600)
    let n = minted.length
    await undo()
    expect(minted.length, 'Undo of typing on the swapped-in view').toBe(n)
    await undo()
    expect(await viewText()).toBe('ab cd')
    expect(minted.length, 'Undo of the swap').toBe(n + 1)
    n = minted.length
    await redo()
    expect(await viewText()).toBe('a restored version')
    expect(minted.length, 'Redo of the swap').toBe(n + 1)
    n = minted.length
    await redo()
    expect(await viewText()).toBe('a restored version gh')
    expect(minted.length, 'Redo of typing on the swapped-in view').toBe(n)
  })
})

// ── (e) ─────────────────────────────────────────────────────────────────────
describe('(e) ⛔⛔ CONTROL — a genuine second writer still forks', () => {
  it('offline: type, Undo, keep typing; another device rewrites the note; leaving forks ONCE, with the member’s NEWEST words', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    server.offline = true
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    await undo()
    await tick(300)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(1500)
    expect(holdsExactly('ab cd'), 'precondition: nothing landed').toBe(true)
    server.offline = false
    server.body = doc(para('rewritten on another device'))
    server.stamp()
    const { fork, results } = await leaveAndDrain()
    expect(fork, 'the second writer did not fork').toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(JSON.stringify(fork.mock.calls[0][0].patch.bodyJson), 'the fork does not carry the member’s newest words').toContain('ab cd gh')
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
  })

  it('online, after an Undo: another device writes while this view holds unsent words ⇒ the editor’s save forks, never clobbers', async () => {
    server = makeServer({ body: doc(para('ab cd')), updatedAt: T0 })
    await openTheNote()
    await edit((c) => c.focus('end').insertContent(' ef'))
    await tick(300)
    await undo()
    await tick(100)
    server.body = doc(para('rewritten on another device'))
    server.stamp()
    await edit((c) => c.focus('end').insertContent(' gh'))
    await tick(2500)                                     // 409 ⇒ reconcile ⇒ preserve both
    expect(serverText(), 'the other device’s words were overwritten').toContain('rewritten on another device')
    const forked = server.forks.map((f) => JSON.stringify(f))
    expect(forked.some((f) => f.includes('ab cd gh')), `the member's words are not in a sibling: ${JSON.stringify(server.forks)}`).toBe(true)
  })
})
