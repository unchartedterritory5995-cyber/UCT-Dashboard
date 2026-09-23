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
import { describeBatch, exportSelectedNotes, runNoteBatch } from './noteBatch'
import { BLOCKED_TITLE } from './offline/unsyncedCopy'

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
