/**
 * ⛔⛔ A REMOUNT NEVER DISCARDS UNSENT WORK TO ADOPT THE SERVER'S COPY.
 *
 * The owner's wording, adopted as the fourth instance of the pattern:
 *   "remount when the server has moved discards local state without proving the
 *    server holds it"
 *
 * ⚰️ THE MECHANISM, traced from production on 2026-09-13.
 *
 * `settleLandedSave` answers "has this note caught up with the server?" with
 * `sameAuthoredContent(acked, current)` — the server's accepted copy against the
 * editor's current copy. On an ordinary save that is a fair question. On a
 * REMOUNT it is not, because the editor was just rebuilt FROM the server copy,
 * so both sides of that comparison are the server. The cheap answer is `true`
 * for a reason that has nothing to do with the member's work.
 *
 * What follows is written in ONE transaction: the record goes `dirty: 0` at the
 * server's newer baseline carrying the SERVER's body, and `intent` is `null` —
 * and `putNoteWithIntent(db, record, null)` deletes every queued entry for that
 * note. The member's offline words are gone from the durable copy AND from the
 * queue, without one byte of them ever reaching the server.
 *
 * ⭐ THE QUESTION THE CONTENT COULD HAVE ANSWERED: is there unsent work for this
 * note, and does what landed contain it? Both are available right there — the
 * previous record's `dirty` flag, and the queued entry's own patch.
 *
 * ⛔ ONE STEP EARLIER THAN `supersedeProvesContent.test.js`. That rail catches
 * the drain discarding an entry on a clock comparison; by then the durable copy
 * has ALREADY been overwritten here. Both are real, they fail for different
 * reasons, and both stay.
 *
 * ⛔⛔ MODE — THIS RAIL IS EXPECTED TO BE RED UNTIL THE FIX LANDS. The first case
 * DRIVES the defect; its failure is the finding, not a broken test. The fix is
 * ruled but HELD until the production second-writer-while-away cell reports. A
 * mechanism refuted by measurement is never shipped as a fix — this programme
 * has already had one stated mechanism refuted by its own trail.
 *
 * ⛔ The settle is FROZEN by `f5Freeze.test.js` while Q1-F5 is open. Changing it
 * requires an owner ruling recorded there as an amendment, exactly as the
 * `ringVouchedPlan` amendment was. THIS RAIL CHANGES NO PRODUCT CODE.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createFakeDb, settleIdb, installKeyRange } from "./__fixtures__/fakeIndexedDb"
import { getNote, listOutbox, putNoteWithIntent } from "./notebookDb"
import { settleLandedSave } from "./useDurableNote"

const T1 = "2026-09-13T17:22:35.000000+00:00"   // the member's entry was queued against this
const T2 = "2026-09-13T17:22:43.000000+00:00"   // the second writer moved the server to here

const SENTENCE = "the member typed this offline and it must survive"

const doc = (...paras) => ({
  type: "doc",
  content: paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
})

const SERVER_BODY = doc("baseline", "a folder move touched nothing in the body")
const MEMBER_BODY = doc("baseline", SENTENCE)

const entryFor = (bodyJson) => ({
  mutationId: "note:n1",
  noteId: "n1",
  kind: "note-update",
  patch: { title: "n1", subtitle: "", bodyJson },
  baseUpdatedAt: T1,
  generation: 3,
  queuedAt: 10,
})

/** The state at the instant the member returns: their words are in the durable
 *  record and in the queue; the server has moved to T2 under them. */
async function seedUnsentWork(db, { dirty }) {
  const entry = entryFor(MEMBER_BODY)
  await putNoteWithIntent(db, {
    noteId: "n1", title: "n1", subtitle: "", bodyJson: dirty ? MEMBER_BODY : SERVER_BODY,
    baseUpdatedAt: T1, generation: 3, sessionId: "s1", localSavedAt: 20,
    dirty: dirty ? 1 : 0,
  }, entry)
  await settleIdb(4)
  return entry
}

/** The remount's own autosave landing: the editor was rebuilt from the server,
 *  so `acked` and `current` are the SAME body. That is the whole trap. */
const remountSettle = (db) => settleLandedSave({
  accountId: "acct-1",
  noteId: "n1",
  acked: { title: "n1", subtitle: "", bodyJson: SERVER_BODY },
  current: { title: "n1", subtitle: "", bodyJson: SERVER_BODY },
  updatedAt: T2,
  connect: async () => db,
})

const bodyText = (rec) => JSON.stringify(rec ? rec.bodyJson : null)

let db
let realIdb
beforeEach(async () => {
  installKeyRange()
  db = createFakeDb()
  // `settleLandedSave` refuses when there is nowhere to write. `connect` is
  // injected, so this only has to satisfy the availability probe.
  realIdb = globalThis.indexedDB
  globalThis.indexedDB = { open() { throw new Error("the injected connect is the only door") } }
})
afterEach(() => { globalThis.indexedDB = realIdb })

describe("remount must not discard unsent work to adopt the server copy", () => {
  it("⛔⛔ keeps the member's queued words when the record is DIRTY", async () => {
    const entry = await seedUnsentWork(db, { dirty: true })

    await remountSettle(db)
    await settleIdb()

    const queued = await listOutbox(db)
    const rec = await getNote(db, "n1")

    expect(queued.some((e) => e.mutationId === entry.mutationId),
      "the remount deleted the queued entry carrying the member's offline words — "
      + "they never reached the server and are now gone from the queue too").toBe(true)
    expect(bodyText(rec).includes(SENTENCE),
      "the remount overwrote the dirty durable copy with server-derived state, "
      + "destroying the member's words in the only place they still existed").toBe(true)
    expect(rec ? rec.dirty : null,
      "the record was marked clean while work for it is still unsent — `dirty: 0` "
      + "means the server has it, and the server does not").toBeTruthy()
  })

  it("⭐ CONTROL — a CLEAN, landed record still adopts server state and clears its stale entry", async () => {
    // ⛔ Without this control the "fix" could be "never settle", which would
    // leave every note permanently dirty and re-send work the server already
    // has, forever. This case must pass BEFORE and AFTER the fix.
    const entry = await seedUnsentWork(db, { dirty: false })

    await remountSettle(db)
    await settleIdb()

    const queued = await listOutbox(db)
    const rec = await getNote(db, "n1")

    expect(queued.some((e) => e.mutationId === entry.mutationId),
      "a stale entry against a clean, caught-up record was not cleared").toBe(false)
    expect(rec ? rec.dirty : null, "a caught-up record should settle clean").toBeFalsy()
    expect(rec ? rec.baseUpdatedAt : null,
      "the settled record should carry the server's newer revision").toBe(T2)
  })

  it("⭐ DISCRIMINATOR — the harness must be able to tell the two cases apart", async () => {
    // ⛔ A FIXTURE THAT CANNOT DISTINGUISH IS NOT A RAIL. If `settleLandedSave`
    // were inert here — an early-returning guard, an injected connect that never
    // fires — both cases above would "pass" by doing nothing at all. This
    // asserts the settle actually WRITES, by measuring the one case whose
    // correct behaviour is a visible change.
    await seedUnsentWork(db, { dirty: false })
    const before = await getNote(db, "n1")
    expect(before.baseUpdatedAt, "seed precondition").toBe(T1)

    await remountSettle(db)
    await settleIdb()

    const after = await getNote(db, "n1")
    expect(after.baseUpdatedAt,
      "the settle wrote nothing at all — every assertion in this file would be "
      + "vacuous, so read a failure HERE as a broken harness, never as a product finding")
      .toBe(T2)
  })
})

describe("putNoteWithIntent guards the STORE, not just the settle", () => {
  // ⛔⛔ THIS RAIL EXISTS BECAUSE THE MUTATION GAUNTLET CAUGHT ME. M29 removes the
  // `noteRecord.dirty` arm from `putNoteWithIntent` — and NOTHING went red. The
  // guard was shipped inside Q1 fix 4 and was, by the programme's own standard,
  // DECORATION: a second layer everyone would have believed in because it reads
  // like defence in depth.
  //
  // ⭐ The settle-side guard (`unsentWork`) protects ONE caller. This one protects
  // the CLASS — `putNoteWithIntent` has eight non-test callers, and any of them
  // can delete a note's queued work by passing a null intent. It is worth having,
  // and therefore worth railing at the layer it defends rather than through a
  // caller that happens to exercise it.

  it("⛔ a null intent does NOT delete a DIRTY note's queued work", async () => {
    const entry = entryFor(MEMBER_BODY)
    await putNoteWithIntent(db, {
      noteId: "n1", title: "n1", subtitle: "", bodyJson: MEMBER_BODY,
      baseUpdatedAt: T1, generation: 3, sessionId: "s1", localSavedAt: 20, dirty: 1,
    }, entry)
    await settleIdb(4)

    // the shape every caller can produce: record written back, intent null
    await putNoteWithIntent(db, {
      noteId: "n1", title: "n1", subtitle: "", bodyJson: MEMBER_BODY,
      baseUpdatedAt: T1, generation: 3, sessionId: "s1", localSavedAt: 21, dirty: 1,
    }, null)
    await settleIdb(4)

    expect((await listOutbox(db)).some((e) => e.mutationId === entry.mutationId),
      "a null intent deleted unsent work for a record that is still DIRTY — the "
      + "store-layer guard is not load-bearing").toBe(true)
  })

  it("⭐ CONTROL — a null intent DOES clear a CLEAN note's queue", async () => {
    // ⛔ Without this the guard could be "never delete anything", which would
    // re-queue work the server already has, forever. The dirty flag must be what
    // decides, not the null intent.
    const entry = entryFor(MEMBER_BODY)
    await putNoteWithIntent(db, {
      noteId: "n1", title: "n1", subtitle: "", bodyJson: SERVER_BODY,
      baseUpdatedAt: T2, generation: 3, sessionId: "s1", localSavedAt: 20, dirty: 0,
    }, entry)
    await settleIdb(4)

    await putNoteWithIntent(db, {
      noteId: "n1", title: "n1", subtitle: "", bodyJson: SERVER_BODY,
      baseUpdatedAt: T2, generation: 3, sessionId: "s1", localSavedAt: 21, dirty: 0,
    }, null)
    await settleIdb(4)

    expect((await listOutbox(db)).some((e) => e.mutationId === entry.mutationId),
      "a clean, caught-up note kept a stale entry — the guard is too wide").toBe(false)
  })
})
