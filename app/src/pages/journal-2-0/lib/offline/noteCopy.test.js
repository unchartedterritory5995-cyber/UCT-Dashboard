/**
 * ⭐⭐ I-A FIX ROUND 1 — the queued `(conflicted copy)`: the durable home for
 * unsent words a member's own swap pushed out of the record.
 *
 * The behavioural rails are `restoreUndoKeepsWords.test.jsx` (the real editor).
 * These pin the pieces underneath, each with the real adapter over the fake
 * IndexedDB and the REAL `drainOutbox`:
 *   · the spill predicate's truth table (every clause can fail on its own);
 *   · a copy entry is not the note's entry — a clean settle of the note cannot
 *     delete it, and per-note readers do not see it;
 *   · the sweep forks it with the same `fork`, clears it only after the fork
 *     landed, and keeps it when the fork fails.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { listOutbox, putNoteWithIntent } from './notebookDb'
import { drainOutbox, FORKED, KEPT } from './outboxDrain'
import { swapCaptureSpills, editorLineageStamp } from './recoverLocalState'
import { copyEntryFor, isNoteCopy, NOTE_COPY } from './noteCopy'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const words = (t, title = 'Thesis') => ({ title, subtitle: '', bodyJson: doc(t) })

let db
beforeEach(() => {
  installKeyRange()
  db = createFakeDb()
})

describe('swapCaptureSpills — every clause can refuse on its own', () => {
  const prevOf = (t, lineageId = 'L0', dirty = 1) => {
    const rec = { noteId: 'n1', ...words(t), dirty }
    rec.editorLineage = editorLineageStamp(rec, { id: lineageId, seq: 1 })
    return rec
  }
  const incomingOf = (t, lineageId = 'L1', seq = 5, title) => ({ ...words(t, title), editLineage: { id: lineageId, seq } })

  it('spills: a swap capture over a dirty record of ANOTHER lineage whose words the page does not carry', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('W restored'), true)).toBe(true)
  })
  it('refuses: an ordinary capture (no swap) — today\'s answer keeps the record', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('W restored'), false)).toBe(false)
  })
  it('refuses: no record, or a clean one — nothing is owed', () => {
    expect(swapCaptureSpills(null, incomingOf('W restored'), true)).toBe(false)
    expect(swapCaptureSpills(prevOf('server copy S. K', 'L0', 0), incomingOf('W restored'), true)).toBe(false)
  })
  it('refuses: the page carries the record\'s words (they move with it)', () => {
    expect(swapCaptureSpills(prevOf('server copy S. K'), incomingOf('server copy S. K and more'), true)).toBe(false)
  })
  it('refuses: the same live view, later (the record is superseded, not pushed out)', () => {
    expect(swapCaptureSpills(prevOf('W restored!', 'L1'), incomingOf('W restored', 'L1', 9), true)).toBe(false)
  })
  it('spills on a TITLE the page does not carry (review C1b)', () => {
    expect(swapCaptureSpills(prevOf('same body'), incomingOf('same body', 'L1', 5, 'Renamed'), true)).toBe(true)
  })
})

describe('a copy entry is not the note\'s entry', () => {
  it('is keyed off the note, names its source, and is keyed by its words (one copy per body while queued)', () => {
    const a = copyEntryFor({ noteId: 'n1', words: words('K'), writtenSchema: 2, sessionId: 's1' })
    const b = copyEntryFor({ noteId: 'n1', words: words('K'), writtenSchema: 2, sessionId: 's2' })
    const c = copyEntryFor({ noteId: 'n1', words: words('W'), writtenSchema: 2, sessionId: 's1' })
    expect(a.noteId).not.toBe('n1')
    expect(a.copyOf).toBe('n1')
    expect(a.kind).toBe(NOTE_COPY)
    expect(isNoteCopy(a)).toBe(true)
    expect(a.mutationId).toBe(b.mutationId)
    expect(a.mutationId).not.toBe(c.mutationId)
    expect(a.writtenSchema).toBe(2)
  })

  it('⛔ a CLEAN settle of the note (null intent) cannot delete it', async () => {
    const copy = copyEntryFor({ noteId: 'n1', words: words('pushed-out K'), sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 1, baseUpdatedAt: 'T1' },
      { mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: words('W'), baseUpdatedAt: 'T1' },
      { copies: [copy] })
    await settleIdb()
    expect((await listOutbox(db)).map((e) => e.mutationId).sort()).toEqual([copy.mutationId, 'note:n1'].sort())
    // The note's save landed: the record settles clean and the note's entry goes.
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T2' }, null)
    await settleIdb()
    const left = await listOutbox(db)
    expect(left.map((e) => e.mutationId)).toEqual([copy.mutationId])
  })
})

describe('the sweep turns a queued copy into a sibling', () => {
  async function queueCopy(text = 'pushed-out K') {
    const copy = copyEntryFor({ noteId: 'n1', words: words(text), sessionId: 's1' })
    await putNoteWithIntent(db, { noteId: 'n1', ...words('W'), dirty: 0, baseUpdatedAt: 'T1' }, null, { copies: [copy] })
    await settleIdb()
    return copy
  }

  it('forks it with the SAME fork, against its source note, then clears it — even while the editor owns the source', async () => {
    const copy = await queueCopy()
    const send = vi.fn(async () => { throw new Error('a copy is never sent as an update') })
    const fork = vi.fn(async () => ({ id: 'n1', title: 'Thesis', bodyJson: doc('W'), updatedAt: 'T1' }))
    const results = await drainOutbox(db, { send, fork, excludeNoteId: 'n1' })
    await settleIdb()
    expect(send).not.toHaveBeenCalled()
    expect(fork).toHaveBeenCalledTimes(1)
    expect(fork.mock.calls[0][0].noteId, 'the fork reads the SOURCE note (its folder)').toBe('n1')
    expect(JSON.stringify(fork.mock.calls[0][0].patch)).toContain('pushed-out K')
    expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: FORKED, copy: true })])
    expect(await listOutbox(db)).toEqual([])
  })

  it('⛔ a failed fork (offline) leaves the copy exactly where it was', async () => {
    const copy = await queueCopy()
    const fork = vi.fn(async () => { throw new Error('network down') })
    const results = await drainOutbox(db, { send: vi.fn(), fork })
    await settleIdb()
    expect(results).toEqual([expect.objectContaining({ mutationId: copy.mutationId, outcome: KEPT })])
    expect((await listOutbox(db)).map((e) => e.mutationId)).toEqual([copy.mutationId])
  })
})
