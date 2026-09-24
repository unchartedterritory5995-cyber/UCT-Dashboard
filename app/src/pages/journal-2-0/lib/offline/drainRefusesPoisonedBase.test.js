/**
 * ⭐⭐ D3b FIX ROUND 1, RESIDUAL (c) — THE DRAIN NEVER CLASSIFIES AGAINST A BASE THAT
 * MAY NOT STAND FOR THE QUEUED ENTRY. The controller's RULING, recorded as part of
 * amendment D3b in `f5Freeze.test.js`: treat such a base as UNKNOWN and FORK —
 * never rebase over it. `docs/notebook/f5-fixes-2026-09-23.md` §G.
 *
 * ⚰️ THE DEFECT (review `wave6-D3b-review.md`, residual c; §F.2's third residual):
 * a record settled BEFORE A-1 carries `acked@landed` as its base — a copy that
 * already holds the block a door appended — while its queued entry still sits on
 * the OLDER revision the member's words were written on. With the note closed, the
 * drain classified the server's copy against that base, read "no change"
 * (METADATA_ONLY: the block is on both sides), rebased the queued body onto the
 * server's revision and sent it: a 200, and the captured block was gone. Recovery
 * refused that base since review N4; the drain did not.
 *
 * The drain decides in three places, and each is railed here on its own: the
 * pre-send ring-vouched plan (an expired in-flight marker), the 409 ring-vouched
 * plan, and the 409 diff branch (a revision the ring never heard of). Two
 * CONTROLS pin that an EQUAL and an OLDER base still merge — the ruling refuses
 * poison, it does not turn every conflict into a fork.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, putMeta, listOutbox } from './notebookDb'
import { drainOutbox, FORKED, SENT } from './outboxDrain'
import { markerFor, markerKeyFor, landedKeyFor, withLanded, IN_FLIGHT_TTL_MS } from './inFlight'
import { baseMayStandFor } from './recoverLocalState'

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })
const ONLINE = para('typed online.')
const SENTENCE = 'typed offline - THIS must survive.'
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T09:04:00Z', searchText: 'NVDA' } }
const T_OLDER = '2026-09-23T08:55:00.000000+00:00'
const T0 = '2026-09-23T09:00:00.000000+00:00'
const T1 = '2026-09-23T09:05:00.000000+00:00'   // the door appended the widget here
const T2 = '2026-09-23T09:07:00.000000+00:00'   // a later metadata move

let db
beforeEach(() => {
  installKeyRange()
  db = createFakeDb()
})

/** A server with compare-and-set, honest about whose copy it holds. */
function makeServer({ body, updatedAt }) {
  const s = { title: 'note', subtitle: '', body, updatedAt, forks: [], sends: [] }
  const note = () => ({ title: s.title, subtitle: s.subtitle, bodyJson: s.body, updatedAt: s.updatedAt })
  s.send = vi.fn(async (entry) => {
    s.sends.push(entry.baseUpdatedAt)
    if (entry.baseUpdatedAt !== s.updatedAt) { const e = new Error('conflict'); e.status = 409; throw e }
    s.body = entry.patch?.bodyJson ?? s.body
    s.updatedAt = `2026-09-23T09:1${s.sends.length}:00.000000+00:00`
    return note()
  })
  s.fork = vi.fn(async (entry) => { s.forks.push(entry.patch?.bodyJson ?? null); return note() })
  s.serverCopyIsOurs = async (entry, { landedRevisions } = {}) => {
    const serverNote = note()
    if (JSON.stringify(s.body) === JSON.stringify(entry.patch?.bodyJson)) {
      return { ours: true, identical: true, serverUpdatedAt: s.updatedAt, serverNote, why: 'identical' }
    }
    if (landedRevisions && landedRevisions.has(s.updatedAt)) {
      return { ours: true, identical: false, serverUpdatedAt: s.updatedAt, serverNote, why: 'ours' }
    }
    return { ours: false, identical: false, serverUpdatedAt: s.updatedAt, serverNote, why: 'not ours' }
  }
  return s
}

/** The member's words, queued on `entryAt`, in a record whose last-known server
 *  copy is `base` (the POISONED shape: `acked@landed`, holding the widget). */
async function queued({ entryAt = T0, base }) {
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'note', subtitle: '', bodyJson: doc(ONLINE, para(SENTENCE)),
    baseUpdatedAt: entryAt, generation: 1, sessionId: 's-away', localSavedAt: 5, dirty: 1, serverBase: base,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'note', subtitle: '', bodyJson: doc(ONLINE, para(SENTENCE)) },
    baseUpdatedAt: entryAt, generation: 1, sessionId: 's-away', queuedAt: 5,
  })
  await settleIdb(4)
}
const POISONED = { title: 'note', subtitle: '', bodyJson: doc(ONLINE, WIDGET), updatedAt: T1 }

const text = (b) => JSON.stringify(b ?? null)
const hasWidget = (s) => (s.body?.content || []).some((n) => n.type === 'widgetEmbed')
const sentenceSurvives = (s) => text(s.body).includes(SENTENCE) || s.forks.some((b) => text(b).includes(SENTENCE))

async function drain(s) {
  const results = await drainOutbox(db, {
    send: s.send, fork: s.fork, serverCopyIsOurs: s.serverCopyIsOurs, holders: new Set(),
  })
  await settleIdb(4)
  return results
}

describe('⛔⛔ residual (c) — a POISONED base is unknown: the drain forks, and the door’s block survives', () => {
  it('⛔⛔ the 409, ring-vouched (the door’s revision is ours): FORK — never the rebase that dropped the widget', async () => {
    const s = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queued({ base: POISONED })
    await putMeta(db, landedKeyFor('n1'), withLanded([], T1))
    await settleIdb(4)
    const results = await drain(s)
    expect(hasWidget(s), 'the queued body was rebased over the door’s block').toBe(true)
    expect(sentenceSurvives(s), 'the member’s sentence is in neither the server nor a fork').toBe(true)
    expect(results[0].outcome).toBe(FORKED)
    expect(s.forks).toHaveLength(1)
    expect(await listOutbox(db)).toHaveLength(0)
  })

  it('⛔⛔ the 409, NOT vouched (a revision the ring never heard of): the diff branch forks too', async () => {
    const s = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T2 })   // widget at T1, then a metadata move
    await queued({ base: POISONED })
    const results = await drain(s)
    expect(hasWidget(s), 'the diff branch rebased over the door’s block').toBe(true)
    expect(sentenceSurvives(s)).toBe(true)
    expect(results[0].outcome).toBe(FORKED)
    expect(s.forks).toHaveLength(1)
  })

  it('⛔⛔ PRE-SEND, an expired marker on a ring-vouched revision: no rebase before the send — it 409s and forks', async () => {
    const s = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queued({ base: POISONED })
    await putMeta(db, landedKeyFor('n1'), withLanded([], T1))
    await putMeta(db, markerKeyFor('n1'), markerFor({
      sessionId: 'gone', baseUpdatedAt: T0, now: Date.now() - (IN_FLIGHT_TTL_MS + 5000),
    }))
    await settleIdb(4)
    const results = await drain(s)
    expect(s.sends[0], 'the pre-send path rebased the entry onto the poisoned revision').toBe(T0)
    expect(hasWidget(s), 'the pre-send rebase sent the queued body straight over the block, with no 409').toBe(true)
    expect(sentenceSurvives(s)).toBe(true)
    expect(results[0].outcome).toBe(FORKED)
  })

  it('⭐ CONTROL — a base at EXACTLY the entry’s revision still MERGES: sentence and widget on the server, no fork', async () => {
    const s = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T1 })
    await queued({ base: { title: 'note', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 } })
    await putMeta(db, landedKeyFor('n1'), withLanded([], T1))
    await settleIdb(4)
    const results = await drain(s)
    expect(results[0].outcome).toBe(SENT)
    expect(text(s.body)).toContain(SENTENCE)
    expect(hasWidget(s)).toBe(true)
    expect(s.forks).toHaveLength(0)
  })

  it('⭐ CONTROL — a base OLDER than the entry is legitimate and still merges (it can only see MORE change)', async () => {
    const s = makeServer({ body: doc(ONLINE, WIDGET), updatedAt: T2 })
    await queued({ base: { title: 'note', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T_OLDER } })
    const results = await drain(s)
    expect(results[0].outcome).toBe(SENT)
    expect(text(s.body)).toContain(SENTENCE)
    expect(hasWidget(s)).toBe(true)
    expect(s.forks).toHaveLength(0)
  })

  it('⭐ the drain and recovery ask ONE predicate — equal and older may stand; newer, unorderable or missing may not', () => {
    expect(baseMayStandFor(T0, T0)).toBe(true)
    expect(baseMayStandFor(T_OLDER, T0)).toBe(true)
    expect(baseMayStandFor(T1, T0), 'a NEWER base is the poisoned shape').toBe(false)
    expect(baseMayStandFor('not-a-revision', T0)).toBe(false)
    expect(baseMayStandFor(null, T0)).toBe(false)
    expect(baseMayStandFor(T0, '')).toBe(false)
  })
})
