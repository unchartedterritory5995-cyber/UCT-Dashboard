/**
 * ⭐⭐ C-1 — THE DECISION, ONE LEVEL DOWN: whether a write may supersede (or
 * retire) the durable record counts SERVER-APPENDED BLOCK IDENTITIES, not only
 * text. `undoMergedBlocks.test.jsx` owns the behaviour through the real editor;
 * this file owns the two places the decision is asked, so each half can be
 * mutation-proved on its own:
 *
 *   1. `persist` (the editor's capture) — through `editorStateDiscardsUnsentWork`
 *      and `swapCaptureSpills`;
 *   2. `settleLandedSave` (the outbox retire path, with the lineage the save SENT).
 *
 * ⛔ "The member's own block" is a block this live view did NOT get from the 409
 * reconcile's merge. The editor names the merged ones on its edit lineage
 * (`merged`), and only those are protected from a same-view supersede; a block
 * the member inserted, or one the note opened with, is theirs to remove.
 * ⛔ Without a lineage (another view, a door's copy) nothing about provenance is
 * known, so a block the record holds and the incoming copy lacks reads as a
 * discard, exactly as missing text does.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeDb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { listOutbox, putNoteWithIntent, getNote } from './notebookDb'
import { settleLandedSave } from './useDurableNote'
import {
  editorStateDiscardsUnsentWork, swapCaptureSpills, editorLineageStamp,
} from './recoverLocalState'
import { nodeKeyOf } from './serverChange'
import { isNoteCopy } from './noteCopy'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const body = (...blocks) => ({ type: 'doc', content: blocks })
const WIDGET = {
  type: 'widgetEmbed',
  attrs: { widgetId: 'w-1', capturedAt: '2026-10-16T19:00:00Z', searchText: 'NVDA', caption: 'CAPTION-KEEP' },
}
const FACT = { type: 'financialFact', attrs: { factId: 'f-1' } }
const EXCERPT = { type: 'documentExcerpt', attrs: { excerptId: 'x-1' } }
const MINE = para('ab cd ef')
const T0 = '2026-10-16T20:00:00.000000+00:00'
const T1 = '2026-10-16T20:00:10.000000+00:00'
const T2 = '2026-10-16T20:00:20.000000+00:00'

/** A record the live view `L` wrote at `seq`, stamped exactly as `persist` stamps it. */
function recordFrom(bodyJson, { dirty = 1, seq = 1, base = T1 } = {}) {
  const rec = {
    noteId: 'n1', title: 'n', subtitle: '', bodyJson, dirty, baseUpdatedAt: base, generation: 1,
    serverBase: dirty ? { title: 'n', subtitle: '', bodyJson: body(para('ab cd')), updatedAt: T0 } : null,
  }
  rec.editorLineage = editorLineageStamp(rec, { id: 'L', seq })
  return rec
}
const capture = (bodyJson, lineage) => ({ title: 'n', subtitle: '', bodyJson, editLineage: lineage })

describe('1. the editor’s capture (`persist`)', () => {
  it.each([['widgetEmbed', WIDGET], ['financialFact', FACT], ['documentExcerpt', EXCERPT]])(
    '⭐⭐ the same view dropping a %s the reconcile MERGED does not supersede: it spills the record to a copy',
    (_k, node) => {
      const prev = recordFrom(body(MINE, node))
      const incoming = capture(body(MINE), { id: 'L', seq: 2, merged: [nodeKeyOf(node)] })
      expect(swapCaptureSpills(prev, incoming, false), 'the capture superseded the merged block without a copy').toBe(true)
    },
  )

  it('⭐ the same holds when the record is CLEAN (the retry landed the merged block before the Undo)', () => {
    const prev = recordFrom(body(MINE, WIDGET), { dirty: 0 })
    const incoming = capture(body(MINE), { id: 'L', seq: 2, merged: [nodeKeyOf(WIDGET)] })
    expect(swapCaptureSpills(prev, incoming, false), 'the landed merged block left without a copy').toBe(true)
  })

  it('⛔ CONTROL — the member’s OWN block (not merged) removed in the same view supersedes: no discard, no copy', () => {
    const prev = recordFrom(body(MINE, WIDGET))
    const incoming = capture(body(MINE), { id: 'L', seq: 2, merged: [] })
    expect(editorStateDiscardsUnsentWork(prev, incoming)).toBe(false)
    expect(swapCaptureSpills(prev, incoming, false)).toBe(false)
  })

  it('⛔ CONTROL — the merged block still on the page: an ordinary capture, no copy', () => {
    const prev = recordFrom(body(MINE, WIDGET))
    const incoming = capture(body(para('ab cd ef gh'), WIDGET), { id: 'L', seq: 2, merged: [nodeKeyOf(WIDGET)] })
    expect(editorStateDiscardsUnsentWork(prev, incoming)).toBe(false)
    expect(swapCaptureSpills(prev, incoming, false)).toBe(false)
  })

  it('⭐⭐ the containment test (no proven lineage) counts blocks as well as text', () => {
    const prev = recordFrom(body(MINE, FACT))
    const incoming = capture(body(para('ab cd ef and more')), undefined)
    expect(editorStateDiscardsUnsentWork(prev, incoming), 'a copy that never held the block superseded it').toBe(true)
  })

  it('⛔ CONTROL — containment with every block carried is still not a discard', () => {
    const prev = recordFrom(body(MINE, FACT))
    const incoming = capture(body(para('ab cd ef and more'), FACT), undefined)
    expect(editorStateDiscardsUnsentWork(prev, incoming)).toBe(false)
  })
})

describe('2. the outbox retire path (`settleLandedSave`)', () => {
  let db
  const connect = async () => db
  beforeEach(() => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    installKeyRange()
    db = createFakeDb()
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
  })

  async function seed(rec) {
    await putNoteWithIntent(db, rec, rec.dirty ? {
      mutationId: 'n1', noteId: 'n1', kind: 'note-update',
      patch: { title: rec.title, subtitle: rec.subtitle, bodyJson: rec.bodyJson },
      baseUpdatedAt: rec.baseUpdatedAt, generation: 1,
    } : null)
  }

  it.each([['dirty', 1], ['clean', 0]])(
    '⭐⭐ a landed save from the same view that drops a MERGED block (record %s) retires the record only with a copy of it',
    async (_d, dirty) => {
      await seed(recordFrom(body(MINE, WIDGET), { dirty }))
      const acked = { title: 'n', subtitle: '', bodyJson: body(MINE) }
      await settleLandedSave({
        accountId: 'u42', noteId: 'n1', acked, current: acked, updatedAt: T2, connect,
        sentFrom: { id: 'L', seq: 3, merged: [nodeKeyOf(WIDGET)] },
      })
      const rec = await getNote(db, 'n1')
      const queued = await listOutbox(db)
      const where = JSON.stringify(rec) + JSON.stringify(queued)
      expect(where, `the merged block left every layer: record=${JSON.stringify(rec)} queued=${JSON.stringify(queued)}`).toContain('CAPTION-KEEP')
    },
  )

  it('⭐⭐ IM-1: the save has NOT caught up (it carried W; the page after the Undo does not) — the record takes `current`, so a copy is due', async () => {
    // The reviewer's probe B: the retry PUT carrying W lands after the Undo, before the
    // Undo's own durable write. `acked` holds W, `current` (the record's new words) does not.
    await seed(recordFrom(body(MINE, WIDGET)))
    const acked = { title: 'n', subtitle: '', bodyJson: body(MINE, WIDGET) }
    const current = { title: 'n', subtitle: '', bodyJson: body(MINE), editLineage: { id: 'L', seq: 3, merged: [nodeKeyOf(WIDGET)] } }
    await settleLandedSave({
      accountId: 'u42', noteId: 'n1', acked, current, updatedAt: T2, connect,
      sentFrom: { id: 'L', seq: 2, merged: [nodeKeyOf(WIDGET)] },
    })
    const rec = await getNote(db, 'n1')
    const queued = await listOutbox(db)
    expect(JSON.stringify(rec?.bodyJson), 'precondition: the record took the page after the Undo').not.toContain('CAPTION-KEEP')
    expect(queued.filter(isNoteCopy).map((e) => JSON.stringify(e.patch)).join(''),
      `the record let go of W without a copy: queued=${JSON.stringify(queued)}`).toContain('CAPTION-KEEP')
  })

  it('⛔ CONTROL — the member’s own block (not merged) removed: the save retires the record, no copy', async () => {
    await seed(recordFrom(body(MINE, WIDGET)))
    const acked = { title: 'n', subtitle: '', bodyJson: body(MINE) }
    await settleLandedSave({
      accountId: 'u42', noteId: 'n1', acked, current: acked, updatedAt: T2, connect,
      sentFrom: { id: 'L', seq: 3, merged: [] },
    })
    const rec = await getNote(db, 'n1')
    const queued = await listOutbox(db)
    expect(rec?.dirty, 'the member’s own removal left the record dirty').toBeFalsy()
    expect(queued.filter(isNoteCopy), 'a copy was queued for the member’s own removal').toHaveLength(0)
    expect(queued, 'something is still queued').toHaveLength(0)
  })
})
