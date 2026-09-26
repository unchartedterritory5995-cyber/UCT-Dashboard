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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { createLockManager } from './__fixtures__/fakeWebLocks'
import { injectAfterRead } from './__fixtures__/injectAfterRead'
import { putNoteWithIntent, putMeta, listOutbox, getNote } from './notebookDb'
import { drainOutbox } from './outboxDrain'
import {
  settleLandedSave, recordLandedRevision, settleOwnerFork, useDurableNote,
} from './useDurableNote'
import { markerFor, markerKeyFor, landedKeyFor, withLanded, IN_FLIGHT_TTL_MS } from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { isNoteOwned } from './noteOwnerLock'
import { sameAuthoredContent } from './recoverLocalState'
import {
  BODY_REWRITE, appendedServerNodes, classifyServerChange, missingServerNodes, nodeKeyOf, serverAppendedKeysIn,
} from './serverChange'
import { ownerReconcilePlan, LANDED, FORK } from './ownerReconcile'

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
// ⛔⛔ SEVEN FAMILIES, NOT FOUR — Q1-F5. The four above are METADATA doors: they
// move `updatedAt` and carry no body. The three below are APPEND doors, and they
// are different in kind — the server adds a NODE to the body. A matrix that
// models them as metadata doors would be seven copies of one case wearing seven
// names (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
//
// ⭐ AND THE PROPERTY HAS TO WIDEN WITH THEM. "The member's offline sentence is
// in the server body" is satisfied by a merge that keeps the sentence and
// DISCARDS the appended node — losing the widget the member just inserted, on a
// rail that stays green. For an append family the node must survive too.
const METADATA_DOORS = ['folder', 'ticker', 'tags', 'hero']

/** The three append families, and the node each one makes the server add.
 *  ⛔ The attrs are the REAL identity fields — `nodeKeyOf` reads exactly these,
 *  so a merge that re-applies the node has to match on the same key the product
 *  matches on, not on a shape invented for the test. */
const APPEND_DOORS = {
  append_widget_embed: {
    type: 'widgetEmbed',
    attrs: { widgetId: 'w-1', capturedAt: '2026-09-13T00:00:00Z', searchText: 'NVDA chart' },
  },
  append_financial_fact: { type: 'financialFact', attrs: { factId: 'f-1' } },
  append_document_excerpt: { type: 'documentExcerpt', attrs: { excerptId: 'x-1' } },
}

const DOORS = [...METADATA_DOORS, ...Object.keys(APPEND_DOORS)]
const appendedNode = (door) => APPEND_DOORS[door] || null

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
  // ⛔ THE NOTE HAS A TITLE ON THE SERVER, as a real one does. D3 (wave 5): the
  // fixture carried none while the member's record carried 'note', which was
  // harmless until a settle's server copy became a classifier base -- then a
  // title that differs only because the MODEL dropped it reads as an authored
  // change and forks. The drain never sends a different title, so it stays put.
  const state = { body: startBody, updatedAt: T0, title: 'note', subtitle: '' }
  const notes = { count: 1 }          // forks create a SECOND note
  // ⭐ D3b (wave 6): what each fork PRESERVED, so a family whose second writer
  // earns a fork can ask where the member's words went. Recording only — no
  // existing case reads it, and nothing it returns changed.
  const forkBodies = []
  const stamp = () => { rev += 1; state.updatedAt = `2026-09-10T13:00:${String(10 + rev).padStart(2, '0')}.000000+00:00` }
  return {
    state,
    notes,
    forkBodies,
    /** The door. A METADATA door moves the revision and carries no body; an
     *  APPEND door adds the server's own node to the body and then moves it.
     *  ⛔ Both stamp, because both are writes — the difference is the body. */
    door(which) {
      const node = appendedNode(which)
      if (node) {
        state.body = {
          ...state.body,
          content: [...(state.body?.content || []), { ...node, attrs: { ...node.attrs } }],
        }
      }
      stamp()
      state.lastDoor = which
      return { ...state }
    },
    /** A SECOND write after the door, always metadata: the revision moves and
     *  the body does not. ⛔ Separate from `door` on purpose — the matrix
     *  replaces `door` with the family under test, and this one must stay a
     *  folder/ticker/tags write whatever that family is. */
    metadataStamp() {
      stamp()
      return { ...state }
    },
    /** the editor's / drain's compare-and-set body PUT */
    send: vi.fn(async (entry) => {
      if (entry.baseUpdatedAt !== state.updatedAt) {
        const e = new Error('conflict'); e.status = 409; throw e
      }
      state.body = entry.patch?.bodyJson ?? state.body
      // ⛔ AND THE AUTHORED FIELDS A PUT CARRIES (review N9, fix round 1). The
      // real `update_note` writes the title and subtitle it is sent; a fake that
      // kept its own while the queued patch said otherwise is the exact
      // unfaithfulness that once manufactured a fork in this file.
      if (entry.patch && 'title' in entry.patch) state.title = entry.patch.title ?? ''
      if (entry.patch && 'subtitle' in entry.patch) state.subtitle = entry.patch.subtitle ?? ''
      stamp()
      return { ...state }
    }),
    fork: vi.fn(async (entry) => {
      notes.count += 1
      forkBodies.push(entry?.patch?.bodyJson ?? null)
      return { ...state }
    }),
    /** guard 2's question, answered honestly against this server.
     *
     * ⛔⛔ IT RETURNS THE DOCUMENT, because the real one does
     * (`useOutboxDrain.js`: *"THE DOCUMENT COMES BACK WITH THE VERDICT … the
     * drain's classifier cannot classify a document it was never handed"*).
     *
     * ⚰️ THIS FIXTURE OMITTED `serverNote` AND MANUFACTURED A FINDING, 2026-09-13.
     * Without it, `mine?.serverNote` is undefined, the whole classification
     * branch is skipped, and every append-family case fell through to the
     * ring-based rebase and dropped the server's node. All eighteen went red and
     * read exactly like a product defect in the append-only merge. ⭐ It is the
     * third time this wave that the instrument, not the product, was wrong — and
     * the tell was that ALL eighteen failed, including orderings where the
     * classifier is the only code that could possibly run.
     */
    serverCopyIsOurs: async (entry, { landedRevisions } = {}) => {
      const serverNote = { ...state, bodyJson: state.body }
      const identical = text(state.body) === text(entry.patch?.bodyJson)
      if (identical) return { ours: true, identical: true, serverUpdatedAt: state.updatedAt, serverNote, why: 'byte-identical' }
      if (landedRevisions && landedRevisions.has(state.updatedAt)) {
        return { ours: true, identical: false, serverUpdatedAt: state.updatedAt, serverNote, why: 'ours, body differs' }
      }
      return { ours: false, identical: false, serverUpdatedAt: state.updatedAt, serverNote, why: 'not ours' }
    },
  }
}

/** The member typed online (it landed), went offline, typed more (it queued). */
async function offlineWorkQueued(server, { withBase = true } = {}) {
  server.state.body = doc(ONLINE)
  const base = server.state.updatedAt
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'note', subtitle: '', bodyJson: doc(BOTH),
    baseUpdatedAt: base, generation: 1, sessionId: 's1', localSavedAt: 5, dirty: 1,
    // ⛔⛔ A DIRTY RECORD CARRIES THE LAST KNOWN SERVER COPY, and this fixture
    // did not — a second way it was unfaithful, found 2026-09-13. The product
    // sets it at the moment a record goes dirty:
    //   useDurableNote.js:385 — `record.serverBase = record.dirty
    //       ? (lastKnownServerCopy(prev) || snapshotOfServerCopy(state?.serverBase)) : null`
    // Without it `lastKnownServerCopy` returns null, `classifyServerChange`
    // answers BODY_REWRITE for everything ("missing evidence is never a licence
    // to merge"), and no classification-based outcome can be observed AT ALL.
    // ⭐ THE CONTROL THAT MAKES THIS A CORRECTION AND NOT A PASS: with the base
    // present and the drain UNCHANGED, all eighteen append rows stayed RED —
    // measured before the fix. The base alone changes nothing; the decision
    // ORDER is the defect.
    // ⛔ DERIVED FROM THE SERVER, NEVER TYPED. A hand-written base drifted from
    // what the fake server actually returns — it carried `title: 'note'` where
    // the server carries none — and `classifyServerChange` compares titles
    // FIRST, so every metadata door read as BODY_REWRITE and four green rows
    // went red. The base is the server's own copy at this instant, by
    // construction, so the two cannot disagree.
    serverBase: withBase ? { ...server.state, bodyJson: server.state.body, updatedAt: base } : null,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'note', subtitle: '', bodyJson: doc(BOTH) },
    baseUpdatedAt: base, generation: 1, sessionId: 's1', queuedAt: 5,
  })
  await settleIdb(4)
}

/** ⭐ THE ONLY ASSERTION. Everything above is arrangement. */
async function assertWordsSurvived(server, label, door) {
  expect(text(server.state.body), `${label}: the offline sentence is NOT in the server body`).toContain(OFFLINE)
  expect(server.notes.count, `${label}: a note was forked`).toBe(1)
  expect(await listOutbox(db), `${label}: work left queued and unsent`).toHaveLength(0)

  // ⛔⛔ THE APPEND HALF. Without this, a drain that resolved the conflict by
  // sending the member's body and dropping the server's node would pass every
  // assertion above — and the member would watch the widget they just inserted
  // disappear a second later. Both sides of an append-only merge survive, or it
  // was not a merge.
  const node = appendedNode(door)
  if (node) {
    const key = nodeKeyOf(node)
    const present = (server.state.body?.content || []).some((n) => nodeKeyOf(n) === key)
    expect(present, `${label}: the server's appended ${node.type} was DROPPED by the merge`).toBe(true)
  }
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
  // ⛔⛔ AN APPEND DOOR CANNOT SETTLE WITH LOCAL STATE, and this is measured
  // from the product, not assumed. `settleMetadataRevision` — the only path that
  // passes `current` to `settleLandedSave` — is called by exactly three doors:
  // folder, ticker and tags. The three APPEND doors call `settleNoteWrite`,
  // which RECORDS the revision and deliberately does not settle ("an editor-only
  // optimisation that needs local state"). So a `settle-first` append row would
  // model a shape the product cannot produce, and a rail that models an
  // impossible shape proves nothing about a real one. The structural claim is
  // asserted below, from the source, rather than taken on trust here.
  // ⛔ THE FAMILY UNDER TEST, NOT THE ORDERING'S HARD-CODED NAME. Each ordering
  // spells `'folder'` and the matrix substitutes the real family by replacing
  // `server.door` — so `which` here is always `'folder'` and reading it would
  // silently un-clamp every append row. Caught by `settle-first` staying red
  // while `drain-first`, its identical twin after clamping, went green.
  const family = server.familyUnderTest || which
  const canSettle = canSeeLocalState && !appendedNode(family)
  const s = server.door(which)
  await recordLandedRevision({ accountId: 'a1', noteId: 'n1', updatedAt: s.updatedAt, connect })
  if (canSettle) {
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1',
      // ⛔ `acked` is the SERVER'S WHOLE COPY and `current` the editor's, exactly as
      // `settleMetadataRevision` passes them (`acked: saved`, `current: captureLocalState()`).
      acked: { title: s.title, subtitle: s.subtitle, bodyJson: s.body },
      current: { title: 'note', subtitle: '', bodyJson: doc(BOTH) },
      updatedAt: s.updatedAt, connect,
    })
  }
  await settleIdb(4)
  return s
}

/**
 * ⭐ D3 (wave 5) — A METADATA DOOR THAT SETTLES *AFTER* THE FAMILY'S DOOR.
 *
 * The member queued words, the family's door moved the note, and THEN they
 * changed a folder/ticker/tags from the open editor — the one door that settles
 * with local state (`settleMetadataRevision` → `settleLandedSave`, acked = the
 * server's copy, current = the member's words). Modelled exactly as
 * `doorHappens` models its own settle-first case.
 *
 * ⛔ WHY IT IS ITS OWN ORDERING: the settle keeps the member's words dirty and
 * re-queues them — and it also decides which server copy the drain's classifier
 * will later diff against. For an APPEND family that copy is the whole
 * question: diff against a copy that already holds the appended node and the
 * node reads as "not a change", the queued body is re-sent over it, and the
 * widget the member captured is gone. Nothing in the six single-door orderings
 * can reach that, because in each of them the only settle is the door's own.
 */
async function metadataDoorSettles(server) {
  const s = server.metadataStamp()
  await recordLandedRevision({ accountId: 'a1', noteId: 'n1', updatedAt: s.updatedAt, connect })
  await settleLandedSave({
    accountId: 'a1', noteId: 'n1',
    acked: { title: s.title, subtitle: s.subtitle, bodyJson: s.body },
    current: { title: 'note', subtitle: '', bodyJson: doc(BOTH) },
    updatedAt: s.updatedAt, connect,
  })
  await settleIdb(4)
}

/**
 * ⭐ D3 (wave 5) — THE EDITOR MERGED THE DOOR'S CHANGE, SAVED, AND ITS SETTLE
 * READ THE RECORD BEFORE THE MERGE REACHED IT.
 *
 * What `commitSave` does when the member is ON the note holding their words and
 * a door moved it: PUT → 409 → `reconcileConflict` classifies the server's copy
 * against the one the words were written on (`lastSavedRef`), inserts any
 * server-appended blocks it lacks, advances the baseline and re-sends; on the
 * 200 it calls `markSynced` AND `settleLandedSave` back to back.
 *
 * ⛔⛔ THE INTERLEAVING THAT MATTERS. `persist` (via `markSynced`'s flush) and
 * `settleLandedSave` are two read-modify-write writers on one record, started
 * in the same tick. IndexedDB serialises their WRITES but lets both READS run
 * first, so the settle can read the record as it stood BEFORE the merged body
 * was written and land LAST. Modelled here as the settle running alone against
 * the pre-merge record: the one ordering whose final state is the settle's.
 *
 * ⭐ The merge is computed through the product's own classifier helpers, never
 * typed, so this fixture cannot disagree with the editor about what it merges.
 */
async function editorMergesAndSaves(server) {
  const rec = await getNote(db, 'n1')
  const base = rec.serverBase                       // what the editor's lastSavedRef held
  const fresh = { ...server.state, bodyJson: server.state.body }
  const shape = classifyServerChange(fresh, base)
  expect(shape, 'the editor only re-sends after a door it can prove').not.toBe(BODY_REWRITE)
  const mine = doc(BOTH)
  const missing = missingServerNodes(appendedServerNodes(fresh, base) || [], serverAppendedKeysIn(mine))
  const merged = { ...mine, content: [...mine.content, ...missing] }
  const saved = await server.send({
    noteId: 'n1', baseUpdatedAt: server.state.updatedAt, patch: { title: 'note', subtitle: '', bodyJson: merged },
  })
  const sent = { title: 'note', subtitle: '', bodyJson: merged }
  await settleLandedSave({
    accountId: 'a1', noteId: 'n1', acked: sent, current: sent, updatedAt: saved.updatedAt, connect,
  })
  await settleIdb(4)
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
  // ⭐ D3 (wave 5): two orderings with a SECOND write after the door. See the
  // two helpers above for why each is a real product path and not a variant.
  'a metadata door settles after it (the editor could report local state)': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: false })
    await metadataDoorSettles(server)
  },
  'the editor merged it and saved; its settle read the pre-merge record': async (server) => {
    await doorHappens(server, 'folder', { canSeeLocalState: false })
    await editorMergesAndSaves(server)
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
      await assertWordsSurvived(server, label, 'folder')
    })
  }

  it('⭐⭐ CONTROL — an UNSETTLED hero door still loses the sentence, so this rail can detect the defect', async () => {
    const server = makeServer(doc(''))
    // ⛔⛔ NO LAST-KNOWN SERVER COPY. The control must drive a case the product
    // genuinely cannot rescue, and since 2026-09-13 the drain CAN rescue an
    // unvouched revision whose diff classifies — so a record that still carries a
    // base is no longer a losing case, and this control would have started
    // passing by being FIXED rather than by detecting anything.
    // ⭐ No base is the honest pre-fix state: "missing evidence is never a licence
    // to merge", so the classifier declines, the ring never heard of this
    // revision, and the words are lost exactly as they were.
    // ⚰️ Written first as a re-`put` with a null intent — which DELETES the queued
    // entry, so nothing drained, nothing forked, and the control "failed" for a
    // reason that had nothing to do with the product.
    await offlineWorkQueued(server, { withBase: false })
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
        server.familyUnderTest = door
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
        await assertWordsSurvived(server, `${door} · ${name}`, door)
      })
    }
  }

  // ⛔⛔ THE CONTROL. Without it, a server model that accepted everything, or an
  // assertion that could not fail, would let every case above pass green while
  // proving nothing.
  //
  // ⚰️ It used to DRIVE the shipped 2026-09-10 defect and require the property to
  // fail. Q1 fix 4 made that defect unreproducible — and the control broke, which
  // is the tell: **a non-vacuity control that BORROWS a product defect expires the
  // day that defect is fixed**, exactly when the property most needs proving. It
  // now manufactures its own failure and checks BOTH directions.
  it('⭐⭐ CONTROL — `assertWordsSurvived` can FAIL, so the cases above mean something', async () => {
    // ⛔ NOTHING IS DRAINED HERE, AND THAT IS THE POINT. The work is queued and
    // never sent, so the server demonstrably does not have the words — a state
    // this control MANUFACTURES rather than borrows from the product.
    const server = makeServer(doc(ONLINE))
    await offlineWorkQueued(server)
    await settleIdb(4)

    // ⚔️ REWRITTEN BY Q1 FIX 4 (2026-09-14), and it is stronger for it.
    //
    // ⚰️ This control used to DRIVE the shipped 2026-09-10 defect and require
    // the property to fail. Fix 4 makes that defect unreproducible, so the
    // control could no longer borrow it - and a control that borrows a product
    // defect EXPIRES THE DAY THAT DEFECT IS FIXED, which is precisely when the
    // property most needs to still be proven non-vacuous.
    //
    // ⭐ So it manufactures its own failure instead: the words are queued and
    // never sent, so the server plainly does not have them. If
    // `assertWordsSurvived` cannot reject THAT, it cannot reject anything, and
    // all eighteen cases above are decoration.
    expect(await listOutbox(db), 'the control needs work still queued').toHaveLength(1)
    expect(text(server.state.body)).not.toContain(OFFLINE)
    await expect(assertWordsSurvived(server, 'control')).rejects.toThrow()

    // ⛔ THE OTHER DIRECTION IS ALREADY PROVEN, AND NOT BY THIS TEST. An
    // assertion that ALWAYS rejects would be as useless as one that never does -
    // but every case above calls `assertWordsSurvived` and passes, so the
    // resolving direction is demonstrated eighteen times over. Manufacturing it
    // again here would mean re-satisfying its outbox-is-empty clause, i.e.
    // draining - and a control that drains is back to depending on the product
    // it exists to check.
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ D3b (wave 6) — FOUR MORE FAMILIES. `docs/notebook/f5-fixes-2026-09-23.md` §F.
//
// The property above — the sentence reaches the server, the note count does not
// change — is right wherever the member is the only writer. The first family
// below has no other writer, so it keeps that property WHOLE: zero forks, zero
// lost words. The other three add a GENUINE second writer (another device, or a
// second writer of the record), and there a fork is the correct answer, so the
// property widens the way the append families widened it: nothing the member
// typed is lost (it is in the server body or in a fork), nothing the other
// device wrote is overwritten (it is in the server body), and no more forks
// than the second writer earns.
// ⭐ D3b FIX ROUND 1 adds a FIFTH (§G.1): another tab's sweep PUT already in
// flight as the note opens. Nobody else writes there either, so it keeps the
// original property whole, like the first.
// ═══════════════════════════════════════════════════════════════════════════

const OTHER = 'rewritten on another device'
const asJson = (b) => JSON.stringify(b ?? null)
const docOf = (...texts) => ({
  type: 'doc', content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
})
const inServerOrFork = (server, words) => asJson(server.state.body).includes(words)
  || server.forkBodies.some((b) => asJson(b).includes(words))
const copyOf = (server) => ({
  title: server.state.title, subtitle: server.state.subtitle,
  bodyJson: server.state.body, updatedAt: server.state.updatedAt,
})
const AT_T0 = { title: 'note', subtitle: '', bodyJson: doc(ONLINE), updatedAt: T0 }
const WORDS = { title: 'note', subtitle: '', bodyJson: doc(BOTH) }

/** ⭐ THE D3b ASSERTION, for a family with a genuine second writer. */
function assertNothingLost(server, { mine, other = null, maxForks }, label) {
  for (const words of mine) {
    expect(inServerOrFork(server, words), `${label}: "${words}" is in neither the server body nor a fork`).toBe(true)
  }
  if (other) expect(asJson(server.state.body), `${label}: the other device's words were overwritten`).toContain(other)
  expect(server.notes.count - 1, `${label}: more forks than a second writer earns`).toBeLessThanOrEqual(maxForks)
}

/**
 * THE OWNING EDITOR, reduced to its save — modelled from `NoteEditorPage.jsx`
 * the way `editorMergesAndSaves` above is, through the product's own helpers:
 * `commitSave` sends what it holds on the base it holds (`lastSavedRef`); a 200
 * settles (`settleLandedSave`); a 409 runs `reconcileConflict` — which asks
 * `ownerReconcilePlan`, THE SAME FUNCTION the editor asks (D3b fix round 1, so
 * this model cannot drift from it): the server already holds exactly what was
 * sent ⇒ a landing, settled as a 200; otherwise `classifyServerChange` against
 * that base, then merge-or-rebase and ONE retry, or a fork whose sibling holds
 * exactly what the editor had, settled with `settleOwnerFork` — and the view
 * becomes the server's copy.
 */
function ownerEditor(server, { state, base }) {
  const ed = { state, base }
  ed.save = async ({ retried = false } = {}) => {
    if (sameAuthoredContent(ed.state, ed.base)) return 'nothing to save'
    try {
      const saved = await server.send({ noteId: 'n1', baseUpdatedAt: ed.base.updatedAt, patch: { ...ed.state } })
      await settleLandedSave({
        accountId: 'a1', noteId: 'n1', acked: ed.state, current: ed.state, updatedAt: saved.updatedAt, connect,
      })
      ed.base = { ...ed.state, updatedAt: saved.updatedAt }
      return 'saved'
    } catch (e) {
      if (e?.status !== 409 || retried) return 'error'
      const fresh = copyOf(server)
      const { plan } = ownerReconcilePlan({ fresh, base: ed.base, sent: ed.state })
      if (plan === LANDED) {
        await settleLandedSave({
          accountId: 'a1', noteId: 'n1', acked: ed.state, current: ed.state, updatedAt: fresh.updatedAt, connect,
        })
        ed.base = { ...ed.state, updatedAt: fresh.updatedAt }
        return 'landed'
      }
      if (plan === FORK) {
        const forked = { title: ed.state.title, subtitle: ed.state.subtitle, bodyJson: ed.state.bodyJson }
        server.notes.count += 1
        server.forkBodies.push(forked.bodyJson)
        await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: fresh, forked, connect })
        ed.state = { title: fresh.title, subtitle: fresh.subtitle, bodyJson: fresh.bodyJson }
        ed.base = fresh
        return 'forked'
      }
      const missing = missingServerNodes(appendedServerNodes(fresh, ed.base) || [], serverAppendedKeysIn(ed.state.bodyJson))
      if (missing.length) {
        ed.state = { ...ed.state, bodyJson: { ...ed.state.bodyJson, content: [...ed.state.bodyJson.content, ...missing] } }
      }
      ed.base = { ...ed.base, updatedAt: fresh.updatedAt }
      return ed.save({ retried: true })
    }
  }
  return ed
}

/** The sweep as it runs once the note has closed and nobody owns it. */
async function sweepUntilSettled(server, extra = {}) {
  for (let pass = 0; pass < 2; pass += 1) {
    // eslint-disable-next-line no-await-in-loop
    await drainOutbox(db, {
      send: server.send, fork: server.fork, serverCopyIsOurs: server.serverCopyIsOurs, holders: new Set(), ...extra,
    })
    // eslint-disable-next-line no-await-in-loop
    await settleIdb(4)
  }
}

const withLocks = (value) => Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value })

// ── family 1 ─────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ D3b · 1 — A SECOND TAB LEADS WHILE THE NOTE IS OPEN.
 *
 * Tab A is the note's editor: the REAL `useDurableNote` (its owner lock, its
 * durable writes) and the owning editor's save. Tab B leads and sweeps, through
 * the real `drainOutbox`, asking the owner lock from B's side of one shared lock
 * manager. Every placement of one or two of B's sweeps among
 * open · type offline · reconnect · the owner's save · close.
 * ⚰️ Before D3b, B's sweep between the reconnect and the owner's save sent the
 * words; the owner's own send then 409'd against them and FORKED the member's
 * note — with nobody else writing at all.
 */
describe('⭐⭐ D3b · 1 — a second tab leads while the note is open: zero forks, zero lost words', () => {
  afterEach(() => { withLocks(undefined) })

  const SCENARIOS = {
    'typed while open': ['open', 'type', 'reconnect', 'owner saves', 'close'],
    'typed on an earlier visit, reopened': ['type', 'open', 'reconnect', 'owner saves', 'close'],
  }
  const placements = []
  for (let i = 0; i <= 5; i += 1) placements.push([i])
  for (let i = 0; i <= 5; i += 1) for (let j = i + 1; j <= 5; j += 1) placements.push([i, j])

  async function run(order) {
    const mgr = createLockManager()
    const server = makeServer(doc(ONLINE))
    let online = false
    const net = (fn) => async (...args) => { if (!online) throw new Error('offline'); return fn(...args) }
    const mountA = () => {
      withLocks(mgr.client('tab-A'))
      return renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', debounceMs: 60000, connect }))
    }
    let tabA = null
    let ed = null
    for (const step of order) {
      if (step === 'open') {
        tabA = mountA()
        let decision = null
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { decision = await tabA.result.current.recover({ server: copyOf(server) }); await settleIdb(4) })
        ed = decision?.adopt
          ? ownerEditor(server, { state: decision.adopt.state, base: decision.adopt.base })
          : ownerEditor(server, { state: { title: 'note', subtitle: '', bodyJson: server.state.body }, base: copyOf(server) })
      } else if (step === 'type') {
        const writer = tabA || mountA()
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          writer.result.current.schedule({ ...WORDS, baseUpdatedAt: T0, serverBase: AT_T0 })
          writer.result.current.flush()
          await settleIdb(6)
        })
        if (ed) ed.state = WORDS
        if (!tabA) writer.unmount()                      // an earlier visit, closed again
      } else if (step === 'reconnect') {
        online = true
      } else if (step === 'owner saves') {
        // eslint-disable-next-line no-await-in-loop
        if (tabA && ed) { await ed.save(); await settleIdb(4) }
      } else if (step === 'close') {
        if (tabA) { tabA.unmount(); tabA = null }
        // eslint-disable-next-line no-await-in-loop
        await settleIdb(6)
      } else if (step === 'tab B sweeps') {
        // eslint-disable-next-line no-await-in-loop
        await drainOutbox(db, {
          send: net(server.send), fork: net(server.fork), serverCopyIsOurs: net(server.serverCopyIsOurs),
          holders: new Set(),
          noteIsOwned: (id) => isNoteOwned('a1', id, { locks: mgr.client('tab-B') }),
        })
        // eslint-disable-next-line no-await-in-loop
        await settleIdb(4)
      }
    }
    online = true
    await sweepUntilSettled(server, { noteIsOwned: (id) => isNoteOwned('a1', id, { locks: mgr.client('tab-B') }) })
    await assertWordsSurvived(server, order.join(' → '), 'folder')
  }

  for (const [scenario, events] of Object.entries(SCENARIOS)) {
    for (const at of placements) {
      const order = []
      events.forEach((e, k) => {
        at.filter((p) => p === k).forEach(() => order.push('tab B sweeps'))
        order.push(e)
      })
      at.filter((p) => p === events.length).forEach(() => order.push('tab B sweeps'))
      it(`${scenario} · ${order.join(' → ')}`, async () => { await run(order) })
    }
  }
})

// ── family 2 ─────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ D3b · 2 — A CRASH DRAFT WINS AFTER ANOTHER DEVICE SAVED.
 *
 * The member's words are in a crash draft (written by the D3b editor, so it
 * records the revision it was typed on) — alone, or ahead of a lagging durable
 * copy — or in a durable record whose base the entry refuses (the legitimate
 * drain-rebase shape). Another device saves at one of three moments. The member
 * reopens (the REAL `recover()`), clicks Restore — the editor's path: on
 * `recovery.base` when there is one, else the old direct PUT — and types once.
 * ⚰️ Before D3b a crash draft had no base: the direct PUT 409'd into an error,
 * the editor kept the words on the server's CURRENT revision, and the keystroke
 * overwrote the other device.
 */
describe('⭐⭐ D3b · 2 — a crash draft wins after another device saved: Restore forks, never clobbers', () => {
  const AHEAD = 'and the crash draft is AHEAD of the durable copy'
  const K = 'K-typed-after-Restore'
  const DRAFT = {
    title: 'note', subtitle: '', bodyJson: docOf(BOTH, AHEAD), savedAt: Date.now(), sessionId: 's-crashed', baseUpdatedAt: T0,
  }
  const VARIANTS = {
    'a crash draft alone': { draft: DRAFT, record: false, refused: false, mine: [OFFLINE, AHEAD, K], maxForks: 1 },
    'a crash draft ahead of a lagging durable copy': { draft: DRAFT, record: true, refused: false, mine: [OFFLINE, AHEAD, K], maxForks: 1 },
    // ⚠️ the one shape that forks even a METADATA-only move (it cannot be told
    // from a poisoned base by direction — f5-fixes §E.1), so a second fork is
    // earned when the other device then writes too.
    'a durable record whose base the entry refuses': { draft: null, record: true, refused: true, mine: [OFFLINE, K], maxForks: 2 },
  }
  const WHEN = ['before the member reopens', 'after reopening, before Restore', 'after Restore, before the keystroke']

  async function run({ draft, record, refused, mine, maxForks }, when, label) {
    const server = makeServer(doc(ONLINE))
    if (record) {
      await offlineWorkQueued(server)                     // the durable copy: WORDS, queued on T0
      if (refused) {
        // the legitimate NEWER-than-entry base: a drain rebase learned the
        // server's copy at a later revision, and an unsent-work settle then put
        // the entry back on the record's older baseline
        const moved = server.metadataStamp()
        const rec = await getNote(db, 'n1')
        await putNoteWithIntent(db, { ...rec, serverBase: { ...AT_T0, updatedAt: moved.updatedAt } }, (await listOutbox(db))[0])
        await settleIdb(4)
      }
      if (draft) {
        const rec = await getNote(db, 'n1')
        await putNoteWithIntent(db, { ...rec, sessionId: 's-crashed' }, (await listOutbox(db))[0])
        await settleIdb(4)
      }
    }
    const otherDeviceSaves = () => { server.state.body = docOf(OTHER); server.metadataStamp() }
    if (when === WHEN[0]) otherDeviceSaves()
    const tab = renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', debounceMs: 60000, connect }))
    const hydrated = copyOf(server)
    let decision = null
    await act(async () => { decision = await tab.result.current.recover({ server: hydrated, lsDraft: draft }); await settleIdb(4) })
    expect(decision.unsynced, `${label}: nothing was offered`).toBe(true)
    expect(decision.adopt, `${label}: these words are the member's to Restore, not ours to send`).toBeNull()
    if (when === WHEN[1]) otherDeviceSaves()
    const durable = async (ed) => act(async () => {
      tab.result.current.schedule({ ...ed.state, baseUpdatedAt: ed.base.updatedAt, serverBase: ed.base })
      tab.result.current.flush()
      await settleIdb(6)
    })
    // ── Restore, exactly as `restoreDraft` does it ──
    let ed
    if (decision.base) {
      ed = ownerEditor(server, { state: decision.state, base: decision.base })
      await durable(ed)                                   // the adoption's scheduleAutosave
      await ed.save()
    } else {
      ed = ownerEditor(server, { state: decision.state, base: hydrated })   // lastSavedRef stays the hydrated copy
      try {
        const saved = await server.send({ noteId: 'n1', baseUpdatedAt: decision.baseUpdatedAt || hydrated.updatedAt, patch: { ...decision.state } })
        ed.base = { ...decision.state, updatedAt: saved.updatedAt }
      } catch (e) {
        if (e?.status !== 409) throw e                     // an error on screen; the words stay in the view
      }
    }
    await settleIdb(4)
    if (when === WHEN[2]) otherDeviceSaves()
    // ── one keystroke ──
    ed.state = { ...ed.state, bodyJson: { ...ed.state.bodyJson, content: [...(ed.state.bodyJson?.content || []), ...docOf(K).content] } }
    await durable(ed)
    await ed.save()
    await settleIdb(4)
    tab.unmount()
    await settleIdb(4)
    await sweepUntilSettled(server)
    assertNothingLost(server, { mine, other: OTHER, maxForks }, label)
  }

  for (const [variant, spec] of Object.entries(VARIANTS)) {
    for (const when of WHEN) {
      it(`${variant} · the other device saves ${when}`, async () => { await run(spec, when, `${variant} · ${when}`) })
    }
  }
})

// ── family 3 ─────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ D3b · 3 — A KEYSTROKE LANDS BETWEEN THE FORK CHECK AND ITS WRITE.
 *
 * Another device rewrote the note; the owner sends the queued words, 409s, forks,
 * and settles its fork — while a durable write of the words PLUS a keystroke K
 * (a second writer of the record: another tab's editor on the same note, the
 * unmount flush) lands at each moment around the settle's reads. On the
 * SERIALIZED store, because the question is what IndexedDB's ordering does with
 * a write that arrives while the settle is deciding.
 * ⚰️ Before D3b the check and the write were three transactions: a write after
 * the last read was overwritten and its queued entry deleted.
 */
describe('⭐⭐ D3b · 3 — a keystroke lands between the owner’s fork check and its write', () => {
  const K = 'K-typed-in-the-window'
  const WITH_K = { title: 'note', subtitle: '', bodyJson: docOf(BOTH, K) }
  const MOMENTS = ['before the check', 'after the note read', 'after the queue read', 'after the write']

  for (const moment of MOMENTS) {
    it(`the keystroke's write lands ${moment}`, async () => {
      db = createFakeDb({ serialize: true })
      const server = makeServer(doc(ONLINE))
      await offlineWorkQueued(server)
      server.state.body = docOf(OTHER)
      server.metadataStamp()                               // another device rewrote it
      const kWrite = () => putNoteWithIntent(db, {
        noteId: 'n1', ...WITH_K, baseUpdatedAt: T0, generation: 2, sessionId: 's2', localSavedAt: 9, dirty: 1, serverBase: AT_T0,
      }, {
        mutationId: 'note:n1', noteId: 'n1', kind: 'note-update', patch: { ...WITH_K },
        baseUpdatedAt: T0, generation: 2, sessionId: 's2', queuedAt: 9,
      })
      const ed = ownerEditor(server, { state: WORDS, base: AT_T0 })
      let injected = null
      if (moment === MOMENTS[0]) { await kWrite(); await settleIdb(4) }
      const disarm = moment === MOMENTS[1] || moment === MOMENTS[2]
        ? injectAfterRead(db, moment === MOMENTS[1] ? 'note' : 'queue', () => { injected = kWrite() })
        : () => {}
      expect(await ed.save()).toBe('forked')
      disarm()
      await injected
      if (moment === MOMENTS[3]) await kWrite()
      await settleIdb(8)
      await sweepUntilSettled(server)
      assertNothingLost(server, { mine: [OFFLINE, K], other: OTHER, maxForks: 2 }, `the keystroke lands ${moment}`)
    })
  }
})

// ── family 4 ─────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ D3b · 4 — A KEYSTROKE QUEUED BEHIND AN IN-FLIGHT DURABLE WRITE.
 *
 * The owner's fork fell back (the member typed Ka during the create request):
 * the REAL `useDurableNote` is writing words+Ka (held in flight), Kb is typed
 * behind it, the editor FLUSHES, swaps the view to the server copy, and K3 is
 * typed there — with the in-flight write completing at each point of that. The
 * editor then saves its view, closes, and the sweep takes the rest.
 * ⚰️ Before D3b the flush waited behind the in-flight write and K3's snapshot
 * replaced Kb's before it was written; the fix-6 guard then kept words+Ka.
 */
describe('⭐⭐ D3b · 4 — a keystroke queued behind an in-flight durable write survives the flush and the view swap', () => {
  const KA = 'Ka-typed-during-the-fork'
  const KB = 'Kb-queued-behind-the-write'
  const K3 = 'K3-typed-on-the-new-view'
  const ORDERS = {
    'the write lands before Kb': ['release', 'Kb', 'flush', 'K3'],
    'the write lands before the flush': ['Kb', 'release', 'flush', 'K3'],
    'the write lands before the new view’s keystroke': ['Kb', 'flush', 'release', 'K3'],
    'the write lands last': ['Kb', 'flush', 'K3', 'release'],
  }

  for (const [name, order] of Object.entries(ORDERS)) {
    it(name, async () => {
      const server = makeServer(doc(ONLINE))
      await offlineWorkQueued(server)                     // the words, queued on T0
      server.state.body = docOf(OTHER)
      server.metadataStamp()                               // another device rewrote it
      const fresh = copyOf(server)
      let release = () => {}
      let gate = null
      const gatedConnect = async () => { if (gate) await gate; return db }
      const tab = renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', debounceMs: 60000, connect: gatedConnect }))
      const onWords = (...extra) => ({
        title: 'note', subtitle: '', bodyJson: docOf([BOTH, ...extra].join(' ')), baseUpdatedAt: T0, serverBase: AT_T0,
      })
      const view = { title: fresh.title, subtitle: fresh.subtitle, bodyJson: docOf(`${OTHER} ${K3}`) }
      await act(async () => {
        gate = new Promise((r) => { release = () => { gate = null; r() } })
        tab.result.current.schedule(onWords(KA))
        tab.result.current.flush()                         // words+Ka: in flight, held
        await settleIdb(2)
      })
      for (const step of order) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          if (step === 'release') release()
          if (step === 'Kb') tab.result.current.schedule(onWords(KA, KB))
          if (step === 'flush') tab.result.current.flush()
          if (step === 'K3') tab.result.current.schedule({ ...view, baseUpdatedAt: fresh.updatedAt, serverBase: fresh })
          await settleIdb(6)
        })
      }
      await act(async () => { tab.result.current.flush(); await settleIdb(8) })
      // the editor saves its view — the server copy plus K3 — and the ack settles
      const saved = await server.send({ noteId: 'n1', baseUpdatedAt: fresh.updatedAt, patch: { ...view } })
      await settleLandedSave({ accountId: 'a1', noteId: 'n1', acked: view, current: view, updatedAt: saved.updatedAt, connect })
      tab.unmount()
      await settleIdb(6)
      await sweepUntilSettled(server)
      assertNothingLost(server, { mine: [OFFLINE, KA, KB, K3], other: OTHER, maxForks: 1 }, name)
    })
  }
})

// ── family 5 ─────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ D3b fix round 1, residual (a) — A SWEEP PUT ALREADY IN FLIGHT AS THE NOTE OPENS.
 *
 * Tab B leads and sweeps while the note is still closed: it passes its last
 * owner-lock check, and its PUT of the queued words goes on the wire. Tab A then
 * opens the note (the REAL `useDurableNote` — its lock, its `recover()`) and the
 * owning editor adopts the SAME words on the revision they were written on. B's
 * PUT lands, B settles, and A saves — in every order the constraints allow, with
 * A's editor hydrated either before B's PUT landed (the fetch raced it) or when it
 * opened. Nobody else writes, so the ORIGINAL property holds whole: zero forks,
 * zero lost words, nothing left queued.
 * ⚰️ Before the fix, A's own send 409'd against the words B had just landed, the
 * reconcile read the member's own words as the server's change, and FORKED.
 */
describe('⭐⭐ D3b · 5 — a sweep PUT in flight as the note opens: zero forks, zero lost words', () => {
  afterEach(() => { withLocks(undefined) })

  const gate = () => {
    let open
    const p = new Promise((r) => { open = r })
    return { p, open }
  }
  // o = A opens · l = B's PUT lands · s = B settles · v = A saves; o < v and l < s.
  const ORDERS = [['o', 'l', 's', 'v'], ['o', 'l', 'v', 's'], ['o', 'v', 'l', 's'],
    ['l', 'o', 's', 'v'], ['l', 'o', 'v', 's'], ['l', 's', 'o', 'v']]
  const NAMES = { o: 'A opens', l: 'B’s PUT lands', s: 'B settles', v: 'A saves' }
  const HYDRATION = {
    'A hydrated before B’s PUT landed': 'stale',
    'A hydrated when it opened': 'fresh',
  }

  async function run(order, hydration, label) {
    const mgr = createLockManager()
    const server = makeServer(doc(ONLINE))
    await offlineWorkQueued(server)                     // the words, queued on T0
    const early = copyOf(server)                        // what a racing fetch saw
    const applied = gate()
    const settled = gate()
    let claimed = false
    const bSend = async (entry) => {
      claimed = true
      await applied.p
      const saved = await server.send(entry)
      await settled.p
      return saved
    }
    const bDrain = drainOutbox(db, {
      send: bSend, fork: server.fork, serverCopyIsOurs: server.serverCopyIsOurs, holders: new Set(),
      noteIsOwned: (id) => isNoteOwned('a1', id, { locks: mgr.client('tab-B') }),
    })
    for (let i = 0; i < 40 && !claimed; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await settleIdb(1)
    }
    expect(claimed, `${label}: precondition — B's PUT is on the wire before the note opens`).toBe(true)

    let tabA = null
    let ed = null
    for (const step of order) {
      if (step === 'o') {
        withLocks(mgr.client('tab-A'))
        tabA = renderHook(() => useDurableNote({ accountId: 'a1', noteId: 'n1', debounceMs: 60000, connect }))
        const hydrated = hydration === 'stale' ? early : copyOf(server)
        let decision = null
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { decision = await tabA.result.current.recover({ server: hydrated }); await settleIdb(4) })
        ed = decision?.adopt
          ? ownerEditor(server, { state: decision.adopt.state, base: decision.adopt.base })
          : ownerEditor(server, { state: { title: hydrated.title, subtitle: hydrated.subtitle, bodyJson: hydrated.bodyJson }, base: hydrated })
      } else if (step === 'l') {
        applied.open()
        // eslint-disable-next-line no-await-in-loop
        await settleIdb(6)
      } else if (step === 's') {
        settled.open()
        // eslint-disable-next-line no-await-in-loop
        await bDrain
        // eslint-disable-next-line no-await-in-loop
        await settleIdb(6)
      } else if (step === 'v') {
        // eslint-disable-next-line no-await-in-loop
        await ed.save()
        // eslint-disable-next-line no-await-in-loop
        await settleIdb(4)
      }
    }
    applied.open()
    settled.open()
    await bDrain
    if (tabA) { tabA.unmount(); tabA = null }
    await settleIdb(6)
    await sweepUntilSettled(server, { noteIsOwned: (id) => isNoteOwned('a1', id, { locks: mgr.client('tab-B') }) })
    await assertWordsSurvived(server, label, 'folder')
  }

  for (const [hname, hydration] of Object.entries(HYDRATION)) {
    for (const order of ORDERS) {
      const label = `${hname} · B claims → ${order.map((x) => NAMES[x]).join(' → ')}`
      it(label, async () => { await run(order, hydration, label) })
    }
  }
})
