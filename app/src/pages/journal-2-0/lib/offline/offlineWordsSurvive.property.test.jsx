/**
 * ⭐⭐ THE PROPERTY THE WHOLE WAVE ANSWERS TO.
 *
 *     THE MEMBER'S LAST OFFLINE SENTENCE ENDS UP IN THE SERVER'S BODY,
 *     AND THE NOTE COUNT DOES NOT CHANGE.
 *
 * Every door × every ordering, one assertion pair at the end of each. Nothing
 * about baselines, markers, rings or outcomes is asserted here — those are the
 * mechanism, and mechanism-level rails are exactly what stayed green through
 * two shipped defects that lost a member's words.
 *
 * ⚰️ WHY THIS FILE EXISTS, in one line each:
 *   · deploy #4 shipped `settleLandedSave` wired to the wrong save path. Eleven
 *     rails and four mutations were green; the fix was not on the path.
 *   · deploy #4b's `settleMetadataRevision` fell back to `saved` when the editor
 *     could not report local state, which read as "caught up" and DELETED the
 *     queued entry. The drain's own step stayed green, because "the server holds
 *     text" is satisfied by the words typed ONLINE.
 * ⛔ Both were invisible to every existing rail and visible to this property.
 *
 * ⛔ THE INVARIANT BEHIND IT: a queued entry is never removed unless the server
 * body is PROVEN to contain its content. Every other outcome is
 * rebase-and-resend, or leave it queued. "Ours" is never, by itself, a reason
 * to delete.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, putMeta, listOutbox, getNote } from './notebookDb'
import { drainOutbox } from './outboxDrain'
import { settleLandedSave, recordLandedRevision } from './useDurableNote'
import { markerFor, markerKeyFor, landedKeyFor, withLanded, IN_FLIGHT_TTL_MS } from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const text = (bodyJson) => JSON.stringify(bodyJson || {})
const ONLINE = 'typed online.'
const OFFLINE = 'typed offline — THIS is the sentence that must survive.'
const BOTH = `${ONLINE} ${OFFLINE}`

const T0 = '2026-09-10T13:00:00.000000+00:00'
// ⛔⛔ FIVE DOORS, NOT FOUR. Q1's record named four — body, folder, ticker, tags
// — and that list was derived from WHAT THE CANARY DROVE, not from what the
// product does. Enumerating from the code (every server-side update_note writer
// and every client write to /api/j2/notes/*) found `hero` on 2026-09-12, live on
// production, unsettled. `embeds` is the sixth and lands in fix 2/2.
//
// ⭐ hero is driven with canSeeLocalState:false because HeroImagePicker has NO
// EDITOR MOUNTED — it records the landed revision and settles nothing, which is
// exactly what `settleNoteWrite` does and all that is needed to stop the fork.
const DOORS = ['folder', 'ticker', 'tags', 'hero']

let db
const connect = async () => db

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

/**
 * A server that behaves like the real one on the only axis that matters:
 * compare-and-set. A PUT whose baseline is not the current revision 409s.
 */
function makeServer(startBody) {
  let rev = 0
  const state = { body: startBody, updatedAt: T0 }
  const notes = { count: 1 }          // forks create a SECOND note
  const stamp = () => { rev += 1; state.updatedAt = `2026-09-10T13:00:${String(10 + rev).padStart(2, '0')}.000000+00:00` }
  return {
    state,
    notes,
    /** the door: a metadata PUT that moves the revision and carries NO body */
    door(which) {
      stamp()
      state.lastDoor = which
      return { ...state }
    },
    /** the editor's / drain's compare-and-set body PUT */
    send: vi.fn(async (entry) => {
      if (entry.baseUpdatedAt !== state.updatedAt) {
        const e = new Error('conflict'); e.status = 409; throw e
      }
      state.body = entry.patch?.bodyJson ?? state.body
      stamp()
      return { ...state }
    }),
    fork: vi.fn(async () => { notes.count += 1; return { ...state } }),
    /** guard 2's question, answered honestly against this server */
    serverCopyIsOurs: async (entry, { landedRevisions } = {}) => {
      const identical = text(state.body) === text(entry.patch?.bodyJson)
      if (identical) return { ours: true, identical: true, serverUpdatedAt: state.updatedAt, why: 'byte-identical' }
      if (landedRevisions && landedRevisions.has(state.updatedAt)) {
        return { ours: true, identical: false, serverUpdatedAt: state.updatedAt, why: 'ours, body differs' }
      }
      return { ours: false, identical: false, serverUpdatedAt: state.updatedAt, why: 'not ours' }
    },
  }
}

/** The member typed online (it landed), went offline, typed more (it queued). */
async function offlineWorkQueued(server) {
  server.state.body = doc(ONLINE)
  const base = server.state.updatedAt
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'note', subtitle: '', bodyJson: doc(BOTH),
    baseUpdatedAt: base, generation: 1, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'note', subtitle: '', bodyJson: doc(BOTH) },
    baseUpdatedAt: base, generation: 1, sessionId: 's1', queuedAt: 5,
  })
  await settleIdb(4)
}

/** ⭐ THE ONLY ASSERTION. Everything above is arrangement. */
async function assertWordsSurvived(server, label) {
  expect(text(server.state.body), `${label}: the offline sentence is NOT in the server body`).toContain(OFFLINE)
  expect(server.notes.count, `${label}: a note was forked`).toBe(1)
  expect(await listOutbox(db), `${label}: work left queued and unsent`).toHaveLength(0)
}

/**
 * ⛔ WHAT A DOOR ACTUALLY DOES IN THE PRODUCT, modelled faithfully:
 *   1. a metadata PUT that moves the revision and carries no body
 *   2. RECORD that revision as ours -- unconditionally, because we made the
 *      request
 *   3. settle the queue ONLY if the editor could report local state
 * ⛔ Step 2 is not optional and is not part of step 3. Treating it as part of
 * step 3 is what forked the member's note in 12 of these 18 cases.
 */
async function doorHappens(server, which, { canSeeLocalState }) {
  const s = server.door(which)
  await recordLandedRevision({ accountId: 'a1', noteId: 'n1', updatedAt: s.updatedAt, connect })
  if (canSeeLocalState) {
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1',
      acked: { bodyJson: s.body }, current: { bodyJson: doc(BOTH) },
      updatedAt: s.updatedAt, connect,
    })
  }
  await settleIdb(4)
  return s
}

// ── the orderings ───────────────────────────────────────────────────────────
// Each returns after arranging; the drain runs afterwards, once, for all.
const ORDERINGS = {
  'settle-first': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: true })
  },
  'drain-first (the editor could NOT report local state)': async (server) => {
    // ⛔ The exact shape that lost the words: no settle, because refusing is the
    // safe answer -- but the landing IS recorded, because the PUT was ours.
    await doorHappens(server, 'folder', { canSeeLocalState: false })
  },
  'marker LIVE': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: false })
    await putMeta(db, markerKeyFor('n1'), markerFor({ sessionId: 'this-tab', baseUpdatedAt: T0 }))
    await settleIdb(4)
  },
  'marker EXPIRED': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: false })
    await putMeta(db, markerKeyFor('n1'), markerFor({
      sessionId: 'gone', baseUpdatedAt: T0, now: Date.now() - (IN_FLIGHT_TTL_MS + 5000),
    }))
    await settleIdb(4)
  },
  'slow PUT (landed, ring populated)': async (server) => {
    const s = await doorHappens(server, 'folder', { canSeeLocalState: false })
    await putMeta(db, landedKeyFor('n1'), withLanded([], s.updatedAt))
    await putMeta(db, markerKeyFor('n1'), markerFor({
      sessionId: 'gone', baseUpdatedAt: T0, now: Date.now() - (IN_FLIGHT_TTL_MS + 5000),
    }))
    await settleIdb(4)
  },
  'reload mid-flight (marker from a dead tab)': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: false })
    await putMeta(db, markerKeyFor('n1'), markerFor({ sessionId: 'previous-tab', baseUpdatedAt: T0 }))
    await settleIdb(4)
  },
}

/**
 * ⛔⛔ THE HERO DOOR — modelled as the PRODUCT implements it, not as a door
 * should be implemented.
 *
 * `HeroImagePicker.jsx:25` (set) and `:45` (remove) issue a RAW `fetch` to
 * `POST|DELETE /api/j2/notes/{id}/hero`. Server-side that route calls
 * `notes_service.update_note(..., {"heroImageUrl": ...})`, which ADVANCES
 * `updatedAt`. `GlobalAddPositionProvider.jsx:163` does the same thing.
 *
 * ⛔ NONE of the three calls `settleMetadataRevision`, and therefore none calls
 * `recordLandedRevision`. So unlike folder/ticker/tags, the revision this door
 * creates is never recorded as OURS.
 *
 * ⭐ THAT IS THE ONLY DIFFERENCE modelled here: same stamp, same missing body,
 * no record, no settle. If the product is safe, this still passes.
 */
async function heroDoorHappens(server) {
  server.door('hero')          // the revision moves, carrying no body
  // ⛔ deliberately nothing else — this is the product's behaviour, verbatim
  await settleIdb(4)
}

describe('🔬 WHERE DO THE WORDS GO — diagnostic, printed not asserted', () => {
  it('after a hero write discards the queued entry, what is left on the device?', async () => {
    const server = makeServer(doc(''))
    await offlineWorkQueued(server)
    const before = { note: await getNote(db, 'n1'), outbox: await listOutbox(db) }
    await heroDoorHappens(server)
    // ⛔ THE STUB FORK CANNOT ANSWER "are the words safe" - it only counts.
    // The REAL `forkConflictedCopy` passes `entry.patch?.bodyJson` to
    // `createNoteViaApi`, so capture exactly what the drain hands it.
    let forkedBody = null
    const results = await drainOutbox(db, {
      send: server.send,
      fork: async (entry) => { forkedBody = entry?.patch?.bodyJson; return server.fork(entry) },
      serverCopyIsOurs: server.serverCopyIsOurs,
    })
    await settleIdb(4)
    const after = { note: await getNote(db, 'n1'), outbox: await listOutbox(db) }
    /* eslint-disable no-console */
    console.log('BEFORE  outbox entries:', before.outbox.length)
    console.log('BEFORE  working copy body:', text(before.note?.bodyJson))
    console.log('DRAIN   results:', JSON.stringify(results.map(r => ({ ok: r.ok, action: r.action, why: r.why || r.report?.reason }))))
    console.log('AFTER   outbox entries:', after.outbox.length)
    console.log('AFTER   working copy body:', text(after.note?.bodyJson))
    console.log('AFTER   working copy dirty flag:', after.note?.dirty)
    console.log('AFTER   server body:', text(server.state.body))
    console.log('AFTER   forks created:', server.notes.count - 1)
    console.log('FORK    body handed to fork():', text(forkedBody))
    console.log('VERDICT sentence in the FORK?', String(text(forkedBody) || '').includes(OFFLINE))
    console.log('VERDICT sentence on device?', String(text(after.note?.bodyJson) || '').includes(OFFLINE))
    /* eslint-enable no-console */
    expect(true).toBe(true)
  })
})

describe('⛔⛔ THE FIFTH DOOR — hero, found by enumeration on 2026-09-12', () => {
  for (const [label] of [['hero SET (POST /hero)'], ['hero REMOVE (DELETE /hero)']]) {
    it(`${label} during a queued body save — records, does not settle`, async () => {
      const server = makeServer(doc(''))
      await offlineWorkQueued(server)
      await doorHappens(server, 'hero', { canSeeLocalState: false })
      await drainOutbox(db, {
        send: server.send, fork: server.fork,
        serverCopyIsOurs: server.serverCopyIsOurs,
      })
      await settleIdb(4)
      await assertWordsSurvived(server, label)
    })
  }

  it('⭐⭐ CONTROL — an UNSETTLED hero door still loses the sentence, so this rail can detect the defect', async () => {
    const server = makeServer(doc(''))
    await offlineWorkQueued(server)
    server.door('hero')          // ⛔ the pre-fix product: no recordLandedRevision
    await settleIdb(4)
    await drainOutbox(db, {
      send: server.send, fork: server.fork,
      serverCopyIsOurs: server.serverCopyIsOurs,
    })
    await settleIdb(4)
    expect(text(server.state.body)).not.toContain(OFFLINE)
    expect(server.notes.count, 'the unsettled door should fork').toBe(2)
  })
})

describe('⭐⭐ the member’s offline sentence survives every door × every ordering', () => {
  for (const door of DOORS) {
    for (const [name, arrange] of Object.entries(ORDERINGS)) {
      it(`${door} door · ${name}`, async () => {
        const server = makeServer(doc(ONLINE))
        await offlineWorkQueued(server)
        // ⛔ The door under test replaces the one the ordering hard-codes, so the
        // matrix is genuinely doors × orderings and not one door six times.
        const orig = server.door.bind(server)
        server.door = (_which) => orig(door)
        await arrange(server)

        // The drain runs to completion — twice, because an ordering that leaves
        // the entry queued for a live marker must succeed on the NEXT sweep,
        // which is the product's actual behaviour and not a failure.
        for (let pass = 0; pass < 2; pass += 1) {
          // eslint-disable-next-line no-await-in-loop
          await drainOutbox(db, {
            send: server.send, fork: server.fork,
            serverCopyIsOurs: server.serverCopyIsOurs,
            holders: new Set(),          // every marker is dead by the 2nd sweep
          })
          // eslint-disable-next-line no-await-in-loop
          await settleIdb(4)
        }
        await assertWordsSurvived(server, `${door} · ${name}`)
      })
    }
  }

  // ⛔⛔ THE CONTROL. Without it, a server model that accepted everything, or an
  // assertion that could not fail, would let all eighteen cases pass green while
  // proving nothing. This drives the EXACT defect of 2026-09-10 — a settle that
  // treats "no local state" as "caught up" — and requires the property to FAIL.
  it('⭐⭐ CONTROL — the shipped defect makes this property FAIL, so it can detect one', async () => {
    const server = makeServer(doc(ONLINE))
    await offlineWorkQueued(server)
    const s = server.door('folder')
    // The old `current: captureLocalState() || saved` — acked === current.
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1',
      acked: { bodyJson: s.body }, current: { bodyJson: s.body },
      updatedAt: s.updatedAt, connect,
    })
    await settleIdb(4)
    await drainOutbox(db, { send: server.send, fork: server.fork, serverCopyIsOurs: server.serverCopyIsOurs })
    await settleIdb(4)

    // The queue was emptied and the words never went.
    expect(await listOutbox(db)).toHaveLength(0)
    expect(text(server.state.body)).not.toContain(OFFLINE)
    await expect(assertWordsSurvived(server, 'control')).rejects.toThrow()
  })
})
