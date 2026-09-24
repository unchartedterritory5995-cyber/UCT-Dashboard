/**
 * The bulk-operation client, DRIVEN through the real module.
 *
 * ⭐ THE STUB IS AT THE BOTTOM OF THE STACK, the same way
 * lib/offline/doorFamilies.settle.test.jsx drives the single-note doors:
 * `recordLandedRevision` is the only call that puts a revision in the landed
 * ring, so stubbing it leaves `settleNoteWrites` — the account gate, the
 * baseline authority, the sequential loop — running for real. The question
 * every test answers is WHICH REVISIONS ENDED UP IN THE RING.
 *
 * ⛔ Every positive is paired with its negative: an unchanged note, a
 * favourite, a refused request and a blocked note all land nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setCurrentAccountId } from './offline/currentAccount'
import { recordLandedRevision } from './offline/useDurableNote'
import {
  UNCHECKED_SENTENCE, checkUnsentWork, describeBatch, describeExport, describeUnchecked, exportSelectedNotes,
  holdsUnsentWork, joinUndo, runNoteBatch, undoFor,
} from './noteBatch'
import { BLOCKED_TITLE } from './offline/unsyncedCopy'
import { __resetNotebookFlags, latchNotebookFlags } from './offline/notebookFlags'
import { installKeyRange } from './offline/__fixtures__/fakeIndexedDb'

vi.mock('./offline/useDurableNote', () => ({
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

const T1 = '2026-09-23T14:00:00.000001+00:00'
const T2 = '2026-09-23T14:00:00.000002+00:00'
const landed = () => recordLandedRevision.mock.calls.map(([a]) => [a.noteId, a.updatedAt])

function answering(body, { ok = true, status = 200 } = {}) {
  const fn = vi.fn(async () => ({ ok, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
  setCurrentAccountId('acct-A')
})
afterEach(() => { vi.unstubAllGlobals(); setCurrentAccountId(null) })

describe('runNoteBatch — every changed note lands its revision', () => {
  it('a move lands exactly the revisions the server says advanced', async () => {
    const fetchFn = answering({
      op: 'move',
      results: [
        { id: 'n1', status: 'changed', updatedAt: T1 },
        { id: 'n2', status: 'unchanged' },
        { id: 'n3', status: 'changed', updatedAt: T2 },
        { id: 'n4', status: 'not_found' },
      ],
    })
    const out = await runNoteBatch({ ids: ['n1', 'n2', 'n3', 'n4'], op: 'move', args: { folderId: 'f1' } })
    expect(landed()).toEqual([['n1', T1], ['n3', T2]])
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/j2/notes/batch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ ids: ['n1', 'n2', 'n3', 'n4'], op: 'move', args: { folderId: 'f1' } })
    expect([out.changed, out.unchanged, out.failed]).toEqual([2, 1, 1])
  })

  it('⛔ CONTROL — a favourite never advances a revision, so nothing lands', async () => {
    answering({ op: 'favorite', results: [{ id: 'n1', status: 'changed' }] })
    await runNoteBatch({ ids: ['n1'], op: 'favorite' })
    expect(landed()).toEqual([])
  })

  it('⛔ CONTROL — a refused request throws the server\'s reason and lands nothing', async () => {
    answering({ detail: 'folder not found' }, { ok: false, status: 400 })
    await expect(runNoteBatch({ ids: ['n1'], op: 'move', args: { folderId: 'x' } }))
      .rejects.toThrow('folder not found')
    expect(landed()).toEqual([])
  })

  it('⛔ CONTROL — signed out, nothing lands (the account gate holds at this door too)', async () => {
    setCurrentAccountId(null)
    answering({ op: 'restore', results: [{ id: 'n1', status: 'changed', updatedAt: T1 }] })
    await runNoteBatch({ ids: ['n1'], op: 'restore' })
    expect(landed()).toEqual([])
  })
})

describe('runNoteBatch — a blocked note is never sent', () => {
  it('holds it back, reports it with the wave\'s sentence, and sends the rest', async () => {
    const fetchFn = answering({ op: 'trash', results: [{ id: 'n1', status: 'changed' }] })
    const out = await runNoteBatch({ ids: ['n1', 'n2'], op: 'trash', blockedNoteIds: new Set(['n2']) })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids).toEqual(['n1'])
    expect(out.results).toContainEqual({ id: 'n2', status: 'blocked', error: BLOCKED_TITLE })
    expect(out.failed).toBe(1)
  })

  it('when EVERY note is blocked, no request is made at all', async () => {
    const fetchFn = answering({})
    const out = await runNoteBatch({ ids: ['n2'], op: 'addTag', args: { tag: 'x' }, blockedNoteIds: new Set(['n2']) })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(out.results.map((r) => r.status)).toEqual(['blocked'])
  })

  it('a favourite IS allowed on a blocked note — it never touches the note row', async () => {
    const fetchFn = answering({ op: 'favorite', results: [{ id: 'n2', status: 'changed' }] })
    await runNoteBatch({ ids: ['n2'], op: 'favorite', blockedNoteIds: new Set(['n2']) })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids).toEqual(['n2'])
  })
})

describe('describeBatch — the sentence a member reads', () => {
  const outcome = (op, results) => ({
    op,
    results,
    changed: results.filter((r) => r.status === 'changed').length,
    unchanged: results.filter((r) => r.status === 'unchanged').length,
    failed: results.filter((r) => !['changed', 'unchanged'].includes(r.status)).length,
  })

  it('says what happened, where', () => {
    const d = describeBatch(outcome('move', [{ id: 'a', status: 'changed' }, { id: 'b', status: 'changed' }]),
      { folderName: 'Research / Semis' })
    expect(d).toEqual({ message: 'Moved 2 notes to Research / Semis.', tone: 'ok' })
  })

  it('names the notes that did not change, and why', () => {
    const titles = { b: 'Old idea', c: 'Draft' }
    const d = describeBatch(outcome('addTag', [
      { id: 'a', status: 'changed' },
      { id: 'b', status: 'in_trash' },
      { id: 'c', status: 'blocked' },
      { id: 'd', status: 'unchanged' },
    ]), { tag: 'semis', titleOf: (id) => titles[id] })
    expect(d.tone).toBe('partial')
    expect(d.message).toBe(
      'Tagged 1 note #semis. 1 was already that way. 2 notes were not changed: '
      + '"Old idea" is in the Trash; "Draft" is waiting to sync (edit it again first).',
    )
  })

  it('an invalid note carries the server\'s own reason', () => {
    const d = describeBatch(outcome('addTag', [{ id: 'a', status: 'invalid', error: 'tags exceeds cap of 30' }]),
      { tag: 'x', titleOf: () => 'Full' })
    expect(d.tone).toBe('error')
    expect(d.message).toContain('"Full" tags exceeds cap of 30')
  })

  it('more than three failures are summarised, not listed', () => {
    const results = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, status: 'not_found' }))
    expect(describeBatch(outcome('trash', results)).message).toContain('and 2 more.')
  })
})

describe('exportSelectedNotes', () => {
  it('posts the ids, downloads the zip, and reports what the server counted', async () => {
    const created = []
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { created.push(this.download) })
    const headers = { 'content-disposition': 'attachment; filename="uct-notebook-selection-20260923.zip"', 'x-export-count': '2', 'x-export-skipped': '1' }
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200, blob: async () => new Blob(['zip']), headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    }))
    vi.stubGlobal('fetch', fetchFn)
    const out = await exportSelectedNotes(['n1', 'n2', 'n3'])
    expect(fetchFn.mock.calls[0][0]).toBe('/api/j2/notes/batch/export')
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ ids: ['n1', 'n2', 'n3'] })
    expect(out).toEqual({ count: 2, skipped: 1 })
    expect(created).toEqual(['uct-notebook-selection-20260923.zip'])
    click.mockRestore()
  })

  it('a busy export slot is said in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })))
    await expect(exportSelectedNotes(['n1'])).rejects.toThrow(/already running/)
  })
})

// ── fix round 1 ─────────────────────────────────────────────────────────────

/** A STORE stub answering the two reads `noteHasUnsentWork` makes, PER NOTE —
 *  the predicate itself runs (R-05: a control that restates the predicate
 *  agrees with itself and says nothing). */
function storeWith({ queued = [], dirty = [], unreadable = [] } = {}) {
  const store = {
    closed: false,
    close() { store.closed = true },
    transaction() {
      return {
        objectStore() {
          return {
            get(noteId) {
              const req = {}
              setTimeout(() => {
                if (unreadable.includes(noteId)) { req.onerror?.(); return }
                req.result = dirty.includes(noteId) ? { noteId, dirty: 1 } : null
                req.onsuccess?.()
              }, 0)
              return req
            },
            index() {
              return {
                getKey(range) {
                  const req = {}
                  setTimeout(() => { req.result = queued.includes(range.__only) ? 'mut-1' : undefined; req.onsuccess?.() }, 0)
                  return req
                },
              }
            },
          }
        },
      }
    },
  }
  return store
}

describe('S1 — trash and export also see words still being SENT, not only retired', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    installKeyRange()
    localStorage.setItem('uct.notebook.offline', '1')
    vi.stubGlobal('indexedDB', { open: () => ({}) })
  })
  afterEach(() => {
    localStorage.removeItem('uct.notebook.offline')
    __resetNotebookFlags()
  })

  it('a queued note the drain has NOT retired is refused for trash, named, and the rest is sent', async () => {
    const fetchFn = answering({ op: 'trash', results: [{ id: 'n1', status: 'changed' }] })
    const store = storeWith({ queued: ['n2'] })
    const out = await runNoteBatch({ ids: ['n1', 'n2'], op: 'trash', connect: async () => store })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids).toEqual(['n1'])
    expect(out.results).toContainEqual({ id: 'n2', status: 'unsent' })
    expect(describeBatch(out, { titleOf: (id) => ({ n2: 'Second note' })[id] }).message).toBe(
      'Moved 1 note to the Trash. 1 note was not changed: "Second note" is still syncing — try again in a moment.',
    )
  })

  it('a dirty record that is not queued yet is refused too', async () => {
    const fetchFn = answering({})
    const out = await runNoteBatch({ ids: ['n3'], op: 'trash', connect: async () => storeWith({ dirty: ['n3'] }) })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(out.results).toEqual([{ id: 'n3', status: 'unsent' }])
  })

  it('⛔ the RAW signal whatever the door-guard mode — unknown-only still refuses a queued note', async () => {
    latchNotebookFlags({
      notebook_offline_default_on: true, notebook_offline_read_on: false,
      notebook_conflict_ux_on: false, notebook_attachments_on: false,
      notebook_door_guard: 'unknown-only',
    })
    const fetchFn = answering({})
    const out = await runNoteBatch({ ids: ['n2'], op: 'trash', connect: async () => storeWith({ queued: ['n2'] }) })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(out.results).toEqual([{ id: 'n2', status: 'unsent' }])
  })

  it('R1-S1: a store that cannot be OPENED is UNCHECKED — held back, and never called "still syncing"', async () => {
    const fetchFn = answering({})
    const out = await runNoteBatch({
      ids: ['n1'], op: 'trash', connect: async () => { throw new Error('cannot open') },
    })
    expect(fetchFn).not.toHaveBeenCalled()                    // never a silent proceed
    expect(out.results).toEqual([{ id: 'n1', status: 'unchecked' }])
    // The batch's own sentence says nothing untrue about it…
    expect(describeBatch(out, { titleOf: () => 'First note' }).message).toBe('')
    // …and the truth, with a way through, is its own sentence.
    const offer = describeUnchecked('trash', ['n1'], { titleOf: () => 'First note' })
    expect(offer.message).toBe(
      "Can't check this device for unsent words. 1 note was not moved to the Trash: \"First note\".")
    expect(offer.message).not.toMatch(/syncing|try again/)
    expect(offer.anyway).toMatchObject({ op: 'trash', ids: ['n1'], label: 'Trash anyway', confirmLabel: 'Yes, trash anyway' })
  })

  it('R1-S1: an open that never SETTLES (a blocked upgrade) is unchecked after the timeout — the action does not hang', async () => {
    const fetchFn = answering({})
    const out = await runNoteBatch({
      ids: ['n1', 'n2'], op: 'trash', connect: () => new Promise(() => {}), timeoutMs: 20,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(out.results).toEqual([{ id: 'n1', status: 'unchecked' }, { id: 'n2', status: 'unchecked' }])
  })

  it('R1-S1: a note whose own read fails is unchecked; the rest of the answer still stands', async () => {
    const got = await checkUnsentWork(['a', 'b', 'c'], {
      connect: async () => storeWith({ unreadable: ['a'], queued: ['b'] }),
    })
    expect([...got.unchecked]).toEqual(['a'])
    expect([...got.unsent]).toEqual(['b'])
  })

  it('R1-S1: the CONFIRMED "anyway" sends the unchecked note — and ONLY that: a note the re-check finds unsent is still refused', async () => {
    const fetchFn = answering({ op: 'trash', results: [{ id: 'n1', status: 'changed' }, { id: 'n3', status: 'changed' }] })
    const connect = async () => storeWith({ unreadable: ['n1'], queued: ['n2'] })
    const out = await runNoteBatch({ ids: ['n1', 'n2', 'n3'], op: 'trash', connect, acceptUnchecked: true })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids).toEqual(['n1', 'n3'])
    expect(out.results).toContainEqual({ id: 'n2', status: 'unsent' })
    expect(out.results.some((r) => r.status === 'unchecked')).toBe(false)
  })

  it('⛔ CONTROL — without the confirmation the same selection holds the unchecked note back', async () => {
    const fetchFn = answering({ op: 'trash', results: [{ id: 'n3', status: 'changed' }] })
    const connect = async () => storeWith({ unreadable: ['n1'], queued: ['n2'] })
    const out = await runNoteBatch({ ids: ['n1', 'n2', 'n3'], op: 'trash', connect })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids).toEqual(['n3'])
    expect(out.results).toContainEqual({ id: 'n1', status: 'unchecked' })
    expect(out.results).toContainEqual({ id: 'n2', status: 'unsent' })
    expect(describeBatch(out, { titleOf: (id) => ({ n2: 'Second note' })[id] }).message).toBe(
      'Moved 1 note to the Trash. 1 note was not changed: "Second note" is still syncing — try again in a moment.')
  })

  it('R1-S1: the export offer says "included", and its confirmation says what the file would miss', () => {
    const offer = describeUnchecked('export', ['a', 'b', 'c', 'd'], { titleOf: (id) => id.toUpperCase() })
    expect(offer.message).toBe(
      `${UNCHECKED_SENTENCE} 4 notes were not included: "A"; "B"; "C" and 1 more.`)
    expect(offer.anyway.label).toBe('Export anyway')
    expect(offer.anyway.confirm).toMatch(/^Export 4 notes without checking this device\?/)
    expect(describeUnchecked('export', [], {})).toBeNull()
  })

  it('⛔ CONTROL — move, tag and restore never ask: they rebase, and the words still arrive', async () => {
    const connect = vi.fn(async () => storeWith({ queued: ['n2'] }))
    for (const [op, args] of [['move', { folderId: 'f1' }], ['addTag', { tag: 'x' }], ['restore', {}]]) {
      const fetchFn = answering({ op, results: [] })
      await runNoteBatch({ ids: ['n2'], op, args, connect })
      expect(JSON.parse(fetchFn.mock.calls[0][1].body).ids, op).toEqual(['n2'])
    }
    expect(connect).not.toHaveBeenCalled()
  })

  it('one store connection for the whole selection, closed afterwards', async () => {
    const store = storeWith({ queued: ['b'] })
    const connect = vi.fn(async () => store)
    const held = await checkUnsentWork(['a', 'b', 'c'], { connect })
    expect([...held.unsent]).toEqual(['b'])
    expect([...held.unchecked]).toEqual([])
    expect(connect).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(store.closed).toBe(true)
  })

  it('holdsUnsentWork reads the raw answer out of every verdict shape', () => {
    expect(holdsUnsentWork({ unsent: true, why: 'queued' })).toBe(true)
    expect(holdsUnsentWork({ unsent: false, why: 'guard-unknown-only' })).toBe(true)
    expect(holdsUnsentWork({ unsent: false, why: null })).toBe(false)
    expect(holdsUnsentWork({ unsent: false, why: 'wave-off' })).toBe(false)
    expect(holdsUnsentWork({ unsent: false, why: 'no-store' })).toBe(false)
  })
})

describe('undoFor — how a batch is taken back (B1)', () => {
  const out = (results) => ({ results })
  it('a trash is undone by restoring exactly the notes it trashed', () => {
    expect(undoFor('trash', out([{ id: 'a', status: 'changed' }, { id: 'b', status: 'unchanged' }])))
      .toEqual({ op: 'restore', ids: ['a'], args: {} })
  })
  it('a move is undone per note, back to the folder each one LEFT, only while it is still here', () => {
    const u = undoFor('move', out([
      { id: 'a', status: 'changed', updatedAt: 't', fromFolderId: 'f9' },
      { id: 'b', status: 'changed', updatedAt: 't', fromFolderId: null },
      { id: 'c', status: 'unchanged' },
    ]), { folderId: 'f1' })
    expect(u).toEqual({ op: 'move', ids: ['a', 'b'], args: { folders: { a: 'f9', b: null }, expectFolderId: 'f1' } })
  })
  it('nothing changed, a tag, a favourite, or an Undo itself: nothing to take back', () => {
    expect(undoFor('trash', out([{ id: 'a', status: 'unchanged' }]))).toBeNull()
    expect(undoFor('addTag', out([{ id: 'a', status: 'changed' }]))).toBeNull()
    expect(undoFor('favorite', out([{ id: 'a', status: 'changed' }]))).toBeNull()
    expect(undoFor('move', out([{ id: 'a', status: 'changed', fromFolderId: 'f1' }]), { folders: { a: 'f1' } }))
      .toBeNull()
  })
  it('the Undo of a move says where the notes went', () => {
    const d = describeBatch({ op: 'move', results: [{ id: 'a', status: 'changed' }], changed: 1, unchanged: 0 },
      { backToOrigin: true })
    expect(d.message).toBe('Moved 1 note back to where it was.')
  })
})

describe('describeExport — every note left out is named', () => {
  const titles = { b: 'Blocked one', u: 'Sending one' }
  it('names a retired note and a still-sending note, each with its own reason', () => {
    const d = describeExport({ count: 1, blocked: ['b'], unsent: ['u'] }, { titleOf: (id) => titles[id] })
    expect(d).toEqual({
      message: 'Exported 1 note as a Markdown zip. 2 notes were not included: '
        + '"Blocked one" is waiting to sync (edit it again first); "Sending one" is still syncing — try again in a moment.',
      tone: 'partial',
    })
  })
  it('nothing exported says so', () => {
    expect(describeExport({ count: 0, unsent: ['u'] }, { titleOf: (id) => titles[id] }).message)
      .toBe('1 note was not included: "Sending one" is still syncing — try again in a moment.')
  })
})

describe('R1-N3 — an Undo that could not put every note back says what happened, never "try again"', () => {
  const titleOf = (id) => ({ b: 'B note', c: 'C note', d: 'D note', e: 'E note' })[id]
  const undoOutcome = {
    op: 'move', changed: 1, unchanged: 0,
    results: [
      { id: 'a', status: 'changed', updatedAt: 't' },
      { id: 'b', status: 'moved_since' },
      { id: 'c', status: 'folder_gone', stayedInFolderId: 'f1', stayedInFolderName: 'Research' },
      { id: 'd', status: 'conflict' },
      { id: 'e', status: 'folder_gone', stayedInFolderId: null, stayedInFolderName: null },
    ],
  }
  it('names each note and why it stayed', () => {
    const { message, tone } = describeBatch(undoOutcome, { backToOrigin: true, titleOf })
    expect(message).toBe(
      'Moved 1 note back to where it was. 4 notes were not changed: '
      + '"B note" was moved again after this — left where it is; '
      + '"C note" could not go back: its folder no longer exists — it stayed in Research; '
      + '"D note" was changed again after this — left where it is and 1 more.')
    expect(message).not.toMatch(/try again/)
    expect(tone).toBe('partial')
  })
  it('a note whose folder is gone and sits in Unfiled says Unfiled', () => {
    const one = { op: 'move', changed: 0, unchanged: 0, results: [undoOutcome.results[4]] }
    expect(describeBatch(one, { backToOrigin: true, titleOf }).message)
      .toBe('Nothing changed. 1 note was not changed: "E note" could not go back: its folder no longer exists — it stayed in Unfiled.')
  })
  it('⛔ CONTROL — an ordinary move that raced still says "try again": it CAN be retried', () => {
    const plain = { op: 'move', changed: 0, unchanged: 0, results: [{ id: 'd', status: 'conflict' }] }
    expect(describeBatch(plain, { folderName: 'Research', titleOf }).message)
      .toBe('Nothing changed. 1 note was not changed: "D note" changed while this ran — try again.')
  })
})

describe('R23-N5 — joinUndo: "Trash anyway" joins the Undo of the trash it finishes', () => {
  const restore = (ids) => ({ op: 'restore', ids, args: {} })

  it('a live restore Undo takes the new notes: one Undo for the whole action', () => {
    expect(joinUndo({ undo: restore(['n3']) }, restore(['n1']))).toEqual({ undo: restore(['n3', 'n1']), earlier: 1 })
  })
  it('a note in both is counted once', () => {
    expect(joinUndo({ undo: restore(['a', 'b']) }, restore(['b', 'c']))).toEqual({ undo: restore(['a', 'b', 'c']), earlier: 1 })
  })
  it('never joins a QUEUED Undo (a promise about its own notes), a missing one, or a different kind', () => {
    const mine = restore(['n1'])
    expect(joinUndo({ undo: restore(['n3']), queued: true }, mine)).toEqual({ undo: mine, earlier: 0 })
    expect(joinUndo(null, mine)).toEqual({ undo: mine, earlier: 0 })
    const move = { op: 'move', ids: ['n3'], args: { folders: { n3: null } } }
    expect(joinUndo({ undo: move }, mine)).toEqual({ undo: mine, earlier: 0 })
    expect(joinUndo({ undo: restore(['n3']) }, null)).toEqual({ undo: null, earlier: 0 })
  })
  it('the sentence counts the earlier part of the action too', () => {
    const outcome = { op: 'trash', changed: 1, unchanged: 0, results: [{ id: 'n1', status: 'changed' }] }
    expect(describeBatch(outcome).message).toBe('Moved 1 note to the Trash.')
    expect(describeBatch(outcome, { earlier: 1 }).message).toBe('Moved 2 notes to the Trash.')
  })
})
