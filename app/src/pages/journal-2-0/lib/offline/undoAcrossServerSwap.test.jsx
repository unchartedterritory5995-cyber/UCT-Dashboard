/**
 * ⭐⭐ C-1 FIX ROUND 1 — AN UNDO ACROSS A SWAP THAT BROUGHT SERVER CONTENT IN NEVER
 * DELETES THAT CONTENT FROM EVERY LAYER.
 *
 * ⚰️ CR-1 (independent review of the C-1 fix, pre-existing on master). The clean
 * editor's re-read (`rereadCleanNote` → `adoptServerCopy`) swaps the SERVER's newer
 * copy onto the page — another device's appended widget, or paragraph. The swap is
 * an ordinary undoable step and writes nothing durable, so one Undo puts the old page
 * back, the autosave PUTs it on the adopted revision (200), and what the other device
 * added was on the server, in a fork, in the record, in the queue: none of them. The
 * C-1 fix only knew blocks the 409 reconcile merged, and only within one lineage.
 *
 *  1 the reviewer's widget probe (clean re-read adoption, one Undo)
 *  2 the PROSE variant — measured first, recorded in the evidence either way
 *  3 a reconcile merge, then a later swap (a version restore), then Undo back across both
 *  4 MI-1: merge, then the degraded history mode, then Undo — the record follows the
 *    page (never pinned): later keystrokes are durable, and the block is kept
 *  5 IM-1: the retry PUT carrying the merged block lands AFTER the Undo and BEFORE the
 *    Undo's own durable write — the settle must not retire the record holding the block
 *
 * The REAL editor, the REAL `useJ2Note`, the REAL durable layer over the fake
 * IndexedDB, the REAL drain, and the compare-and-set `schemaServer`.
 */
import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createFakeIndexedDbFactory, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { makeSchemaServer } from './__fixtures__/schemaServer'
import { __resetNotebookConnections } from './useDurableNote'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { dbNameFor } from './notebookDb'
import { drainOutbox } from './outboxDrain'
import { NOTEBOOK_SCHEMA_HEADER } from '../notebookSchema'

vi.setConfig({ testTimeout: 60_000 })

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u42', role: 'member' } }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
// The version-history panel's hand-off, without its UI (as `ordinaryUndoNoPin.test.jsx`).
const versionGate = vi.hoisted(() => ({ note: null }))
vi.mock('../../components/notebook/NoteHistoryPanel', async () => {
  const React = await import('react')
  return {
    default: ({ onRestored }) => React.createElement('button', {
      type: 'button', onClick: () => onRestored?.(versionGate.note),
    }, 'rail: restore a version'),
  }
})

const R = '2026-09-24T09:00:00.000000+00:00'
const APPENDED_AT = '2026-09-24T12:40:00.000000+00:00'
const RESTORED_AT = '2026-09-24T12:50:00.000000+00:00'
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const W_MARK = 'CAPTION-KEEP the other device’s chart words'
const WIDGET = {
  type: 'widgetEmbed',
  attrs: {
    widgetId: 'w-other-device', capturedAt: '2026-09-24T12:39:00Z', searchText: 'NVDA chart',
    caption: W_MARK, annotations: [{ id: 'drawing-keep-1', type: 'trendline', points: [] }],
  },
}
const P_MARK = 'Added from my phone: trimmed half of SMCI.'

const ACCOUNT_DB = dbNameFor('u42')
let factory
let server
const net = { offline: false, dropAfterRead: false, holdPut: 0, puts: 0, held: null }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  __resetNotebookConnections()
  installKeyRange()
  factory = createFakeIndexedDbFactory()
  globalThis.indexedDB = factory
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  server = makeSchemaServer({ body: doc(para('ab cd')), updatedAt: R, title: 'Daily note' })
  Object.assign(net, { offline: false, dropAfterRead: false, holdPut: 0, puts: 0, held: null })
  versionGate.note = null
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const isNote = String(url) === '/api/j2/notes/n1'
    if (method !== 'GET' && net.offline) throw new TypeError('Failed to fetch')
    if (isNote && method === 'PUT') {
      net.puts += 1
      if (net.holdPut && net.puts === net.holdPut) {
        let release
        const gate = new Promise((r) => { release = r })
        net.held = { release, called: true }
        await gate
      }
    }
    const r = await server.fetch(url, init)
    if (isNote && method === 'GET' && net.dropAfterRead) { net.dropAfterRead = false; net.offline = true }
    return r
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
  delete globalThis.indexedDB
})

async function openTheNote() {
  const mod = await import('../../components/notebook/NoteEditorPage')
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><mod.default noteId="n1" onBack={() => {}} /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
}
async function sit(rounds = 8, ms = 500) {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(ms); await settleIdb(6) })
  }
}
async function liveEditor() {
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
async function edit(fn) {
  const ed = await liveEditor()
  await act(async () => { fn(ed.chain()).run(); await settleIdb(2) })
}
const undo = () => edit((c) => c.focus().undo())
const onScreen = async () => JSON.stringify((await liveEditor()).getJSON())
const store = () => factory.databases.get(ACCOUNT_DB)
const outbox = () => store()?.dump('outbox') ?? []
const record = () => (store()?.dump('notes') ?? []).find((r) => r.noteId === 'n1')
const bodyPuts = () => server.puts.filter((p) => Object.hasOwn(p.patch, 'bodyJson'))
/** Another device writes the server copy: no client is told. */
function anotherDeviceAppends(node, at = APPENDED_AT) {
  server.note.bodyJson = { ...server.note.bodyJson, content: [...server.note.bodyJson.content, node] }
  server.note.updatedAt = at
}
async function comeBack() {
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await settleIdb(4) })
  await sit(4)
}
/** The member left: the editor unmounts and the sweep drains (copies included). */
async function leaveAndDrain() {
  cleanup()
  await sit(1, 50)
  net.offline = false
  const send = async (entry) => {
    const res = await server.fetch('/api/j2/notes/n1', {
      method: 'PUT',
      body: JSON.stringify({
        title: entry.patch?.title ?? '', subtitle: entry.patch?.subtitle || null,
        ...(entry.patch?.bodyJson ? { bodyJson: entry.patch.bodyJson } : {}),
        ...(entry.baseUpdatedAt ? { baseUpdatedAt: entry.baseUpdatedAt } : {}),
      }),
      headers: { [NOTEBOOK_SCHEMA_HEADER]: '99' },
    })
    if (!res.ok) { const e = new Error('refused'); e.status = res.status; throw e }
    return (await res.json()).note
  }
  const fork = async (entry) => { server.forks.push(entry); return { ...server.note } }
  return drainOutbox(store(), { send, fork })
}
const whereIs = (marker) => ({
  onServer: server.storedBody().includes(marker),
  inAConflictedCopy: JSON.stringify(server.forks).includes(marker),
  queued: JSON.stringify(outbox()).includes(marker),
  inTheRecord: JSON.stringify(record() ?? null).includes(marker),
})
function expectKept(marker, label) {
  const at = whereIs(marker)
  expect(at.onServer || at.inAConflictedCopy,
    `${label} is in no layer: ${JSON.stringify(at)} server=${server.storedBody()} forks=${JSON.stringify(server.forks)}`).toBe(true)
}

// ── 1 + 2 ───────────────────────────────────────────────────────────────────
describe.each([
  ['a widget (the reviewer’s probe)', WIDGET, W_MARK],
  ['a PROSE paragraph (the prose variant)', para(P_MARK), P_MARK],
])('CR-1: the clean re-read adopts %s another device appended; one Undo crosses the adoption', (_l, node, marker) => {
  it('⭐⭐ what the other device added ends on the server or in a (conflicted copy), never in no layer', async () => {
    await openTheNote()
    await sit(6)
    anotherDeviceAppends(node)
    await comeBack()
    expect(await onScreen(), 'precondition: the clean editor adopted the server copy').toContain(marker)
    await undo()
    expect(await onScreen(), 'precondition: the Undo crossed the adoption and took it off the page').not.toContain(marker)
    await sit(8)
    expect(bodyPuts().at(-1)?.status, 'precondition: the Undo’s page was PUT and landed').toBe(200)
    await leaveAndDrain()
    expectKept(marker, 'what the other device added')
  })
})

// ── 3 ───────────────────────────────────────────────────────────────────────
describe('a reconcile merge, then a later swap, then an Undo back across both', () => {
  it('⭐⭐ merge W (online), version restore, Undo across the restore, Undo the merge ⇒ W is kept', async () => {
    await openTheNote()
    await sit(6)
    await edit((c) => c.focus('end').insertContent(' ef'))
    await sit(1, 300)
    anotherDeviceAppends(WIDGET)                         // the save will 409 and merge W
    await sit(8, 300)
    expect(await onScreen(), 'precondition: the reconcile merged W').toContain(W_MARK)
    expect(server.storedBody(), 'precondition: the retry landed with W').toContain('ab cd ef')
    // A version restore on the server, handed to the editor.
    server.note.bodyJson = doc(para('a restored version'))
    server.note.updatedAt = RESTORED_AT
    versionGate.note = { ...server.note }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rail: restore a version' })); await settleIdb(6) })
    await waitFor(async () => expect(await onScreen()).toContain('a restored version'))
    await sit(3)
    await undo()                                         // across the restore: the merged page is back
    expect(await onScreen(), 'precondition: the Undo crossed the restore').toContain(W_MARK)
    await sit(2, 300)
    await undo()                                         // the merge itself: W comes off
    expect(await onScreen(), 'precondition: the second Undo took W off').not.toContain(W_MARK)
    expect(await onScreen()).toContain('ab cd ef')
    await sit(8)
    await leaveAndDrain()
    expectKept(W_MARK, 'the merged widget')
  })
})

// ── 4 ───────────────────────────────────────────────────────────────────────
describe('MI-1: a rotation between the merge and its Undo never PINS the record', () => {
  it('⭐⭐ offline: merge W, then a doc change outside history, then Undo the merge, keep typing ⇒ the new words are durable and W is kept', async () => {
    await openTheNote()
    await sit(6)
    await edit((c) => c.focus('end').insertContent(' ef'))
    await sit(1, 300)
    anotherDeviceAppends(WIDGET)
    net.dropAfterRead = true                             // the retry after the merge fails offline
    await sit(8, 300)
    expect(await onScreen(), 'precondition: the reconcile merged W').toContain(W_MARK)
    expect(net.offline, 'precondition: offline after the merge').toBe(true)
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds W').toContain(W_MARK)
    const ed = await liveEditor()
    await act(async () => {                              // the degraded history mode
      const { state } = ed
      ed.view.dispatch(state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text('outside history')))
        .setMeta('addToHistory', false))
      await settleIdb(2)
    })
    await sit(2, 300)
    await undo()
    expect(await onScreen(), 'precondition: the Undo took W off').not.toContain(W_MARK)
    await sit(2, 300)
    await edit((c) => c.focus('end').insertContent(' gh'))
    await sit(2, 300)
    expect(JSON.stringify(record()?.bodyJson), `the record is PINNED: the newest words are in no durable layer: ${JSON.stringify(record()?.bodyJson)}`).toContain(' gh')
    net.offline = false
    await sit(12, 300)
    await leaveAndDrain()
    expectKept(W_MARK, 'the merged widget')
    expect(server.storedBody(), 'the member’s newest words did not land').toContain(' gh')
  })
})

// ── 5 ───────────────────────────────────────────────────────────────────────
describe('IM-1: the retry carrying the merged block lands after the Undo, before the Undo’s durable write', () => {
  it('⭐⭐ the settle does not retire the record holding W without a copy', async () => {
    await openTheNote()
    await sit(6)
    await edit((c) => c.focus('end').insertContent(' ef'))
    await sit(1, 300)
    anotherDeviceAppends(WIDGET)
    net.holdPut = net.puts + 2                           // the 409, then THE RETRY is held on the wire
    for (let i = 0; i < 40 && !net.held; i += 1) await sit(1, 100)  // eslint-disable-line no-await-in-loop
    expect(net.held, 'precondition: the retry PUT is on the wire').toBeTruthy()
    expect(await onScreen(), 'precondition: the reconcile merged W').toContain(W_MARK)
    await sit(1, 300)                                    // the merge's flushed capture is in the record
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds W').toContain(W_MARK)
    await undo()                                         // W off the page; its durable write is ~200 ms away
    expect(await onScreen()).not.toContain(W_MARK)
    // ⛔ m2 (round 2): the ORDER this cell exists for — the Undo's own durable write has
    // NOT landed yet, so the record the settle meets still holds W. Without this the
    // cell could pass through `persist`'s spill instead of the settle's.
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the Undo’s durable write landed BEFORE the settle — this cell would not test the settle').toContain(W_MARK)
    await act(async () => { net.held.release(); await settleIdb(10) })   // the retry lands; the settle runs — no timer moved
    await sit(10, 300)
    await leaveAndDrain()
    expectKept(W_MARK, 'the merged widget')
  })
})

// ── 6 ───────────────────────────────────────────────────────────────────────
describe('m4: a version restore over a DIRTY record never pins it', () => {
  it('⭐⭐ offline: unsent words, version restore, type, close and reopen ⇒ the old words are durable AND the newer words are in the record', async () => {
    await openTheNote()
    await sit(6)
    net.offline = true
    await edit((c) => c.focus('end').insertContent(' OLD-UNSENT-WORDS'))
    await sit(2, 300)
    expect(JSON.stringify(record()?.bodyJson), 'precondition: the record holds the unsent words').toContain('OLD-UNSENT-WORDS')
    expect(record()?.dirty, 'precondition: the record is dirty').toBeTruthy()
    server.note.bodyJson = doc(para('a restored version'))
    server.note.updatedAt = RESTORED_AT
    versionGate.note = { ...server.note }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'rail: restore a version' })); await settleIdb(6) })
    await waitFor(async () => expect(await onScreen()).toContain('a restored version'))
    await sit(3)
    await edit((c) => c.focus('end').insertContent(' NEWER-WORDS'))
    await sit(3, 300)
    cleanup()                                            // close the note
    await sit(1, 50)
    await openTheNote()                                  // and reopen it, still offline
    await sit(6)
    const durable = JSON.stringify(record() ?? null) + JSON.stringify(outbox())
    expect(durable, `the pre-restore unsent words are in no durable layer: ${durable}`).toContain('OLD-UNSENT-WORDS')
    expect(JSON.stringify(record()?.bodyJson), `the record is PINNED: the newer words are in no durable layer: ${JSON.stringify(record()?.bodyJson)}`).toContain('NEWER-WORDS')
  })
})
