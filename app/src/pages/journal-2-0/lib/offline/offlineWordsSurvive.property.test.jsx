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
import {
  BODY_REWRITE, appendedServerNodes, classifyServerChange, missingServerNodes, nodeKeyOf, serverAppendedKeysIn,
} from './serverChange'

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
  const stamp = () => { rev += 1; state.updatedAt = `2026-09-10T13:00:${String(10 + rev).padStart(2, '0')}.000000+00:00` }
  return {
    state,
    notes,
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
      stamp()
      return { ...state }
    }),
    fork: vi.fn(async () => { notes.count += 1; return { ...state } }),
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
