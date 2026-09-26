/**
 * ⛔⛔ B1 (wave 5 final review) — THE OUTBOX MAY NOT LAUNDER AN OLD TAB'S BODY
 * THROUGH THIS BUNDLE'S DECLARATION.
 *
 * The scenario, from code: a production (pre-wave-5) tab opens a note that holds
 * a wave-5 type, reads it as EMPTY, and the member types a line. The tab's own
 * PUT carries no schema header and is refused — but the durable record and its
 * outbox entry stay queued. Any NEWER tab's sweep then sends that entry. Before
 * this fix `sendNoteUpdate` declared the SENDING bundle's level (1), the server
 * saw 1 ≥ 1 and answered 200, and the note became the empty stand-in.
 *
 * ⭐ The declaration must describe the bundle that WROTE the body. A capture
 * carries `writtenSchema`; a capture with none — every record production has
 * ever written — is 0.
 *
 * Driven with the REAL drain, the REAL `sendNoteUpdate` / `forkConflictedCopy` /
 * `serverCopyIsOursDefault`, and the real adapter over an in-memory IndexedDB,
 * against a server model that refuses from the header actually on the wire
 * (`__fixtures__/schemaServer.js`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFakeDb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { makeSchemaServer, requiredLevel } from './__fixtures__/schemaServer'
import { getNote, listOutbox, putMeta, putNoteWithIntent } from './notebookDb'
import { drainOutbox, FORKED, SENT, SKIPPED } from './outboxDrain'
import { forkConflictedCopy, sendNoteUpdate, serverCopyIsOursDefault } from './useOutboxDrain'
import { liveSessionIds, markerKeyFor, sessionLockNameFor } from './inFlight'
import { lockNameFor } from './outboxLeader'
import { deriveDeclaredSchema } from '../notebookSchema'
import { editorSchema } from '../tiptap'

const R = '2026-09-24T09:00:00.000000+00:00'
const para = (...inline) => ({ type: 'paragraph', content: inline })
const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) })
const doc = (...blocks) => ({ type: 'doc', content: blocks })

/** "NVDA thesis" on the server, holding a formula (inlineMath, level 1). */
const LEVEL1_BODY = doc(para(text('NVDA thesis '), { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }))
const LEVEL0_BODY = doc(para(text('NVDA thesis', ['bold'])))
/** What the production tab queued: its empty stand-in plus the line the member typed. */
const TYPED = 'one line typed into an empty-looking editor'
const BLANK_PLUS_TYPED = doc(para(text(TYPED)))

/** This bundle's own level — derived, never typed, exactly as the product derives it. */
const CURRENT = deriveDeclaredSchema(editorSchema())

let server
let db
const realFetch = globalThis.fetch
beforeEach(() => {
  installKeyRange()
  db = createFakeDb()
})
afterEach(() => { globalThis.fetch = realFetch })

function serve(body) {
  server = makeSchemaServer({ body, updatedAt: R })
  globalThis.fetch = server.fetch
}

/**
 * The queued work, as a writer left it. ⛔ `stamp: undefined` omits the field
 * entirely — the exact shape of every record and entry production writes today.
 */
async function queued({ noteId = 'n1', body = BLANK_PLUS_TYPED, stamp, sessionId = 's-prod', serverBody = LEVEL1_BODY } = {}) {
  const stamped = stamp === undefined ? {} : { writtenSchema: stamp }
  await putNoteWithIntent(db, {
    noteId, title: 'NVDA thesis', subtitle: '', bodyJson: body, baseUpdatedAt: R,
    generation: 4, sessionId, localSavedAt: 1000, dirty: 1,
    // What that tab's `lastSavedRef` held: the server copy at R.
    serverBase: { title: 'NVDA thesis', subtitle: '', bodyJson: serverBody, updatedAt: R },
    ...stamped,
  }, {
    mutationId: `note:${noteId}`, noteId, kind: 'note-update',
    patch: { title: 'NVDA thesis', subtitle: '', bodyJson: body },
    baseUpdatedAt: R, generation: 4, sessionId, queuedAt: 1000,
    ...stamped,
  })
}

const drain = (extra = {}) => drainOutbox(db, {
  send: sendNoteUpdate, fork: forkConflictedCopy, serverCopyIsOurs: serverCopyIsOursDefault, ...extra,
})

describe('precondition — the fixture is the scenario', () => {
  // ⭐ AT LEAST level 1, not exactly 1 — the treatment fc143ac37 gave
  // NoteEditorPage.writtenSchema.test.jsx's B1 precondition: wave 6 registered
  // its node types at level 2, so this bundle now reads 2, and the hole — an
  // UNSTAMPED (level-0) body drained over a level-1 note — is still reachable
  // from any level ≥ 1. The fixture bodies stay at level 1 and 0, so the
  // scenario is unchanged. ⚰️ It read `toBe(1)` and went red the moment wave 6
  // raised the level, on a change that did not touch the hole at all.
  it('the server note is level 1 and this bundle reads level 1 or newer', () => {
    expect(requiredLevel(LEVEL1_BODY)).toBe(1)
    expect(requiredLevel(LEVEL0_BODY)).toBe(0)
    expect(CURRENT, 'the bundle under test must read wave-5 types (level 1) or newer, or the rail tests nothing')
      .toBeGreaterThanOrEqual(1)
  })
})

describe('⛔⛔ B1 — an UNSTAMPED queued body is sent as the OLDEST writer', () => {
  it('a production-shaped record + entry for a level-1 note: declared 0 → 409 → forked, server body byte-identical', async () => {
    serve(LEVEL1_BODY)
    await queued()                                           // no writtenSchema anywhere
    const before = server.storedBody()

    const results = await drain()

    expect(server.puts.length, 'non-vacuity: the drain did send').toBeGreaterThan(0)
    expect(server.puts.map((p) => p.header), 'every send declared the WRITER’s level, 0').toEqual(server.puts.map(() => '0'))
    expect(server.puts.every((p) => p.status === 409), 'a send landed').toBe(true)
    expect(server.storedBody(), 'the server note was written over').toBe(before)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    // Litter, not loss: the member's line is in a sibling, never dropped.
    expect(server.forks).toHaveLength(1)
    expect(server.forks[0].title).toBe('NVDA thesis (conflicted copy)')
    expect(JSON.stringify(server.forks[0].bodyJson)).toContain(TYPED)
    // …and the queue does not hold it for a second fork.
    expect(await listOutbox(db)).toEqual([])
    expect((await getNote(db, 'n1')).dirty).toBe(0)
  })

  it('an entry stamped 0 explicitly is refused the same way', async () => {
    serve(LEVEL1_BODY)
    await queued({ stamp: 0 })
    const before = server.storedBody()
    const results = await drain()
    expect(server.puts.map((p) => p.header)).toEqual(server.puts.map(() => '0'))
    expect(server.storedBody()).toBe(before)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ a junk stamp is not a stamp — it reads as 0, never as this bundle’s level', async () => {
    serve(LEVEL1_BODY)
    await queued({ stamp: 'one' })
    const before = server.storedBody()
    await drain()
    expect(server.puts[0].header).toBe('0')
    expect(server.storedBody()).toBe(before)
  })
})

describe('⭐ CONTROLS — ordinary offline recovery still lands', () => {
  it('a record stamped by THIS bundle’s level for a level-1 note is sent at that level and lands', async () => {
    serve(LEVEL1_BODY)
    const mine = doc(para(text('NVDA thesis '), { type: 'inlineMath', attrs: { latex: '\\pi r^2' } }), para(text('and a line typed offline')))
    await queued({ body: mine, stamp: CURRENT })
    const results = await drain()
    expect(server.puts.map((p) => p.header)).toEqual([String(CURRENT)])
    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(server.storedBody()).toBe(JSON.stringify(mine))
    expect(server.forks).toHaveLength(0)
  })

  it('an UNSTAMPED entry for a level-0 note still lands — pre-deploy queued work keeps flowing', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY })
    const results = await drain()
    expect(server.puts.map((p) => p.header)).toEqual(['0'])
    expect(results.map((r) => r.outcome)).toEqual([SENT])
    expect(server.storedBody()).toBe(JSON.stringify(BLANK_PLUS_TYPED))
    expect(server.forks).toHaveLength(0)
  })
})

// ── The Web Locks question the review raised and did not chase ──────────────
//
// `useOutboxDrain` passes `holders: await liveSessionIds()` to the drain. What
// does that exclude? Traced (see the report): NOTHING by itself. `holders` is
// read in exactly one place, `isMarkerLive`, where it can only DEMOTE an
// in-flight marker whose writing tab is gone. The only per-note exclusion is
// `excludeNoteId`, which is the LEADER's own open note. So a leader drains an
// entry another LIVE tab wrote for the note that tab has open, whenever that tab
// has no save on the wire. These rails pin that behaviour as it is — and pin that
// the B1 stamp makes the end state safe anyway.
describe('the Web Locks trace — what `holders` does and does not exclude', () => {
  const liveMarker = (sessionId) => ({ sessionId, startedAt: Date.now(), baseUpdatedAt: R })

  it('⛔ a leader DRAINS an entry another live tab wrote for the note that tab has open (no save on the wire)', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY, sessionId: 's-other' })
    const results = await drain({ excludeNoteId: 'n-leaders-own', holders: new Set(['s-other', 's-leader']) })
    expect(results.map((r) => r.outcome), 'holders excluded a live tab’s open note').toEqual([SENT])
  })

  it('…and SKIPS it only while that tab has a save on the wire (a live in-flight marker)', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY, sessionId: 's-other' })
    await putMeta(db, markerKeyFor('n1'), liveMarker('s-other'))
    const results = await drain({ excludeNoteId: 'n-leaders-own', holders: new Set(['s-other', 's-leader']) })
    expect(results.map((r) => r.outcome)).toEqual([SKIPPED])
    expect(server.puts).toHaveLength(0)
  })

  it('…a marker from a tab NOT in `holders` (gone) is disregarded — `holders` only demotes', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY, sessionId: 's-gone' })
    await putMeta(db, markerKeyFor('n1'), liveMarker('s-gone'))
    const results = await drain({ excludeNoteId: 'n-leaders-own', holders: new Set(['s-leader']) })
    expect(results.map((r) => r.outcome)).toEqual([SENT])
  })

  it('…with no Web Locks answer (`holders: null`) the TTL alone decides', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY, sessionId: 's-other' })
    await putMeta(db, markerKeyFor('n1'), liveMarker('s-other'))
    expect((await drain({ holders: null })).map((r) => r.outcome)).toEqual([SKIPPED])
  })

  it('the only per-note exclusion is the leader’s OWN open note', async () => {
    serve(LEVEL0_BODY)
    await queued({ serverBody: LEVEL0_BODY, sessionId: 's-other' })
    expect((await drain({ excludeNoteId: 'n1', holders: new Set(['s-other']) })).map((r) => r.outcome)).toEqual([SKIPPED])
  })

  it('`liveSessionIds` answers with the tabs’ OWN session locks — never the sync (leader) lock', async () => {
    const locks = {
      query: async () => ({
        held: [
          { name: lockNameFor('u42') },                   // the leader election lock
          { name: sessionLockNameFor('s-a') },
          { name: sessionLockNameFor('s-b') },
          { name: 'some.other.lock' },
        ],
      }),
    }
    expect([...(await liveSessionIds(locks))].sort()).toEqual(['s-a', 's-b'])
    expect(await liveSessionIds({}), 'no query ⇒ unknown, never "nobody"').toBeNull()
  })

  it('⭐ and the end state is safe anyway: a live PRODUCTION tab’s unstamped blank, drained by a newer leader, is refused and forked', async () => {
    serve(LEVEL1_BODY)
    await queued({ sessionId: 's-prod-tab-still-open' })     // unstamped: written by the old bundle
    const before = server.storedBody()
    const results = await drain({ excludeNoteId: 'n-leaders-own', holders: new Set(['s-prod-tab-still-open', 's-leader']) })
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
    expect(server.puts.every((p) => p.header === '0' && p.status === 409)).toBe(true)
    expect(server.storedBody()).toBe(before)
  })
})
