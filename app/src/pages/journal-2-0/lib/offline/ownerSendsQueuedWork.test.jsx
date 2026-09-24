/**
 * ⭐⭐ D3 / F5P-1 — THE OFFLINE LAYER'S HALF: WHO SENDS WORDS QUEUED FOR THE OPEN NOTE.
 *
 * F5P-1 (`docs/notebook/q1-product-followups.md`): a member queued words
 * offline, came back to the note, and sat on it. The sweep skips the note the
 * editor owns, the editor reopened on the server's copy with the words behind a
 * Restore/Discard banner, and nobody sent them. D3 ruled: queued words for the
 * open note are sent by the single writer that owns it — the editor — never by
 * the sweep.
 *
 * The EDITOR applies the answer (its own save, its own 409 reconcile). This file
 * owns the two things the offline layer must give it:
 *
 *   1. `recover()` → `adopt`: "these words are QUEUED — hold them and send them,
 *      on the base they were written on", and null for every case the banner
 *      still owns (a crash draft, two unorderable copies, a blocked entry).
 *   2. `settleOwnerFork`: when the owner's save forks, the durable record settles
 *      the way the sweep's fork settles it, so the note is not forked twice.
 *
 * ⛔ The end-to-end rail — the real editor, return to the note, the queue drains
 * with nobody typing — cannot live here until the editor applies `adopt`. Its
 * specification and the editor change are in `docs/notebook/f5-fixes-2026-09-23.md` §B.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, getNote, listOutbox } from './notebookDb'
import { useDurableNote, settleOwnerFork, __resetNotebookConnections } from './useDurableNote'
import { queuedWorkToAdopt, baseOfRecovered, chooseLocalRecovery } from './recoverLocalState'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T0 = '2026-09-23T09:00:00.000000+00:00'   // the words were written on this
const T1 = '2026-09-23T09:05:00.000000+00:00'   // a door moved the note while they were away

const BASE = { title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 }
const SERVER_NOW = { title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T1 }
const MINE = doc('online. and offline')
/** What the sibling holds: exactly the words the editor had when it built the copy. */
const FORKED = { title: 'Thesis', subtitle: '', bodyJson: MINE }

const record = (extra = {}) => ({
  noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: MINE, dirty: 1, generation: 3,
  sessionId: 's-away', localSavedAt: 10, baseUpdatedAt: T0, serverBase: BASE, ...extra,
})
const entry = (extra = {}) => ({
  mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
  patch: { title: 'Thesis', subtitle: '', bodyJson: MINE },
  baseUpdatedAt: T0, generation: 3, sessionId: 's-away', queuedAt: 10, ...extra,
})

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  __resetNotebookConnections()
  if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
})

describe('queuedWorkToAdopt — the decision, as a truth table', () => {
  const decide = (rec, lsDraft = null) => chooseLocalRecovery({ server: SERVER_NOW, idbRecord: rec, lsDraft })

  it('⭐ ADOPT: a dirty record with its queued entry, unambiguous', () => {
    const rec = record()
    const adopt = queuedWorkToAdopt({ decision: decide(rec), record: rec, entry: entry() })
    expect(adopt.state).toEqual({ title: 'Thesis', subtitle: '', bodyJson: MINE })
    // ⛔⛔ The base the words were WRITTEN ON, with its own revision — never the
    // server's current copy. Sending on T1 would succeed without a 409 and skip
    // the classification that keeps a door's appended block.
    expect(adopt.base).toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
  })

  it('⭐ ADOPT when the crash draft AGREES with the queued words', () => {
    const rec = record()
    const lsDraft = { title: 'Thesis', subtitle: '', bodyJson: MINE, savedAt: 11, sessionId: 's-away' }
    expect(queuedWorkToAdopt({ decision: decide(rec, lsDraft), record: rec, entry: entry() })).not.toBeNull()
  })

  it('⛔ a BLOCKED entry is not auto-sent — its badge asks the member to act', () => {
    const rec = record()
    expect(queuedWorkToAdopt({ decision: decide(rec), record: rec, entry: entry({ permanent: true }) })).toBeNull()
  })

  it('⛔ no queued entry ⇒ not provably committed to the server ⇒ the banner offers it', () => {
    const rec = record()
    expect(queuedWorkToAdopt({ decision: decide(rec), record: rec, entry: null })).toBeNull()
  })

  it('⛔ a crash draft AHEAD of the queued words is the member\'s choice, not ours', () => {
    const rec = record()
    const lsDraft = { title: 'Thesis', subtitle: '', bodyJson: doc('online. and offline. and more'), savedAt: 12, sessionId: 's-away' }
    const decision = decide(rec, lsDraft)
    expect(decision.unsynced).toBe(true)
    expect(queuedWorkToAdopt({ decision, record: rec, entry: entry() })).toBeNull()
  })

  it('⛔ an AMBIGUOUS decision stays with the member', () => {
    const rec = record()
    const decision = { ...decide(rec), ambiguous: true }
    expect(queuedWorkToAdopt({ decision, record: rec, entry: entry() })).toBeNull()
  })

  it('⛔ an entry that disagrees with its record is a reason to ask, not to send', () => {
    const rec = record()
    const stray = entry({ patch: { title: 'Thesis', subtitle: '', bodyJson: doc('something else') } })
    expect(queuedWorkToAdopt({ decision: decide(rec), record: rec, entry: stray })).toBeNull()
  })

  it('⛔ no last-known server copy (or no revision on it) ⇒ no safe base ⇒ no adopt', () => {
    const bare = record({ serverBase: null })
    expect(queuedWorkToAdopt({ decision: decide(bare), record: bare, entry: entry() })).toBeNull()
    const noRev = record({ serverBase: { ...BASE, updatedAt: '' } })
    expect(queuedWorkToAdopt({ decision: decide(noRev), record: noRev, entry: entry() })).toBeNull()
  })

  it('⛔ a base whose revision is not the entry’s is refused — a record poisoned before A-1 is never adopted (N4)', () => {
    // The pre-A-1 settle wrote `acked@landed` as the base — a copy already
    // holding a door's block — while the entry stayed on the older revision.
    const poisoned = record({ serverBase: { ...BASE, bodyJson: doc('online'), updatedAt: T1 } })
    expect(queuedWorkToAdopt({ decision: decide(poisoned), record: poisoned, entry: entry() })).toBeNull()
    // …and the banner still gets the words: the decision itself is untouched.
    expect(decide(poisoned).unsynced).toBe(true)
  })

  it('nothing to recover ⇒ nothing to adopt', () => {
    expect(queuedWorkToAdopt({ decision: decide(null), record: null, entry: null })).toBeNull()
  })
})

describe('baseOfRecovered — what the recovered words were written on (Restore needs it too)', () => {
  const decide = (rec, lsDraft = null) => chooseLocalRecovery({ server: SERVER_NOW, idbRecord: rec, lsDraft })

  it('⭐ the durable record\'s own last-known server copy, with its revision — blocked or not', () => {
    const rec = record()
    expect(baseOfRecovered({ decision: decide(rec), record: rec }))
      .toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
  })

  it('⛔ NOT the server\'s current copy, even though that is the copy on screen', () => {
    const rec = record()
    expect(baseOfRecovered({ decision: decide(rec), record: rec }).updatedAt).not.toBe(SERVER_NOW.updatedAt)
  })

  it('⛔ unknown when a crash draft ahead of the record won — never invented from the server', () => {
    const rec = record()
    const lsDraft = { title: 'Thesis', subtitle: '', bodyJson: doc('online. and offline. and more'), savedAt: 12, sessionId: 's-away' }
    expect(baseOfRecovered({ decision: decide(rec, lsDraft), record: rec })).toBeNull()
  })

  it('⛔ unknown with no record; a record that carries no base copy gives its REVISION only (D3b)', () => {
    expect(baseOfRecovered({ decision: decide(null), record: null })).toBeNull()
    // ⚖️ D3b (wave 6) — this was `toBeNull()`. A record with no last-known copy
    // still proves the revision its words were written on, and Restoring on
    // that revision with an UNKNOWN body forks on any server move instead of
    // taking the direct PUT a later keystroke could turn into an overwrite.
    const bare = record({ serverBase: null })
    expect(baseOfRecovered({ decision: decide(bare), record: bare }))
      .toEqual({ title: '', subtitle: '', bodyJson: null, updatedAt: T0, bodyUnknown: true })
  })

  it('⛔⛔ a base whose revision the queued entry disagrees with is NOT a base — Restore never uses it (N4, fix round 2)', () => {
    // The pre-A-1 settle wrote `acked@landed` (T1, already holding a door's
    // block) while the entry stayed on T0, where the words were really written.
    const poisoned = record({ serverBase: { ...BASE, updatedAt: T1 } })
    // ⚖️ D3b (wave 6) — this was `toBeNull()`. The poisoned BODY is still never
    // used, and neither is its revision T1; what Restore gets now is the ENTRY's
    // revision with an unknown body, so the server's move 409s and forks
    // (`f5-fixes-2026-09-23.md` §F.2) instead of a keystroke overwriting it.
    expect(baseOfRecovered({ decision: decide(poisoned), record: poisoned, entry: entry() }))
      .toEqual({ title: '', subtitle: '', bodyJson: null, updatedAt: T0, bodyUnknown: true })
    // …a base and entry that agree are unchanged…
    const rec = record()
    expect(baseOfRecovered({ decision: decide(rec), record: rec, entry: entry() }))
      .toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
    // …and with no entry there is nothing to compare against: the record's own
    // base, as before (stated in the function, not hidden).
    expect(baseOfRecovered({ decision: decide(poisoned), record: poisoned }).updatedAt).toBe(T1)
  })

  it('⭐ a base OLDER than the entry is used, as at fe4e278bc — a 409 against an older copy can only see more change (N4-b, fix round 3)', () => {
    // The editor's 409 reconcile moved its baseline to T1 and the retry never
    // landed: the next durable write took T1 while the record kept its T0 copy.
    const rec = record({ baseUpdatedAt: T1 })
    const moved = entry({ baseUpdatedAt: T1 })
    expect(baseOfRecovered({ decision: decide(rec), record: rec, entry: moved }))
      .toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
    const adopt = queuedWorkToAdopt({ decision: decide(rec), record: rec, entry: moved })
    expect(adopt?.base.updatedAt, 'the owner adopts on the older copy, as before').toBe(T0)
  })

  it('⛔ only an equal or PROVABLY older revision is used — an entry with no baseline, or one that does not parse, is refused', () => {
    const rec = record()
    // ⚖️ D3b (wave 6) — these were `toBeNull()`. The full base is still refused;
    // the answer is now the record's own parseable revision with an unknown
    // body, which forks on any server move rather than risking an overwrite.
    const revisionOnly = { title: '', subtitle: '', bodyJson: null, updatedAt: T0, bodyUnknown: true }
    expect(baseOfRecovered({ decision: decide(rec), record: rec, entry: entry({ baseUpdatedAt: '' }) })).toEqual(revisionOnly)
    expect(baseOfRecovered({ decision: decide(rec), record: rec, entry: entry({ baseUpdatedAt: 'not-a-revision' }) })).toEqual(revisionOnly)
  })
})

function mount(db) {
  return renderHook(() => useDurableNote({
    accountId: 'acct1', noteId: 'n1', debounceMs: 0, connect: vi.fn(async () => db),
  }))
}

describe('recover() — the answer reaches the editor through the call it already makes', () => {
  it('⭐ a dirty record WITH its queued entry comes back with `adopt`', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: SERVER_NOW }) })
    expect(decision.unsynced).toBe(true)
    expect(decision.adopt?.state.bodyJson).toEqual(MINE)
    expect(decision.adopt?.base.updatedAt).toBe(T0)
  })

  it('⛔ the same record whose entry is BLOCKED comes back without it (the banner, as before)', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry({ permanent: true, lastError: 'gone' }))
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: SERVER_NOW }) })
    expect(decision.unsynced).toBe(true)
    expect(decision.adopt).toBeNull()
    // …but Restore still learns what the words were written on.
    expect(decision.base?.updatedAt).toBe(T0)
  })

  it('⛔⛔ a record poisoned before A-1 comes back with NO `adopt`, and a `base` that is only the entry’s revision — the banner, and a Restore that forks (N4, D3b)', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record({ serverBase: { ...BASE, updatedAt: T1 } }), entry())
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: SERVER_NOW }) })
    expect(decision.unsynced, 'the words are still offered').toBe(true)
    expect(decision.adopt).toBeNull()
    // ⚖️ D3b (wave 6) — this was `toBeNull()`: Restore then took the direct PUT a
    // later keystroke could turn into an overwrite. Never the poisoned base T1
    // (neither its body nor its revision): the entry's T0, body unknown.
    expect(decision.base, 'Restore must not adopt on a base the entry disagrees with')
      .toEqual({ title: '', subtitle: '', bodyJson: null, updatedAt: T0, bodyUnknown: true })
  })

  it('⭐ a record whose base is OLDER than its entry comes back WITH `adopt` and `base`, as at fe4e278bc (N4-b)', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record({ baseUpdatedAt: T1 }), entry({ baseUpdatedAt: T1 }))
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: SERVER_NOW }) })
    expect(decision.adopt?.base.updatedAt).toBe(T0)
    expect(decision.base?.updatedAt).toBe(T0)
  })

  it('⛔ with the wave switched OFF nothing is read and nothing is adopted (§21)', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: SERVER_NOW }) })
    expect(decision.adopt).toBeNull()
    expect(decision.source).toBe('server')
  })
})

describe('settleOwnerFork — the owner\'s fork settles the note the way the sweep\'s does', () => {
  const connectTo = (db) => async () => db

  it('⭐ the record takes the server copy, CLEAN, and the queue for the note is settled', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    const serverNote = { ...SERVER_NOW, bodyJson: doc('a second writer rewrote this') }
    expect(await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote, forked: FORKED, connect: connectTo(db) })).toBe(true)
    await settleIdb(4)
    const after = await getNote(db, 'n1')
    expect(after.dirty).toBe(0)
    expect(after.bodyJson).toEqual(doc('a second writer rewrote this'))
    expect(after.baseUpdatedAt).toBe(T1)
    expect(await listOutbox(db), 'the sibling preserved the words; the sweep must not fork them again').toHaveLength(0)
  })

  it('⛔ an unusable server note never EMPTIES the record (the drain\'s own rule)', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: {}, forked: FORKED, connect: connectTo(db) })
    await settleIdb(4)
    expect((await getNote(db, 'n1')).bodyJson).toEqual(MINE)
  })

  it('⛔⛔ words typed while the sibling was being created are NOT settled away (S1)', async () => {
    // The member typed K during the create request: the record and the queue
    // hold MINE+K, the sibling holds MINE. Settling would write the server copy
    // clean over K and clear the queue — K in no layer at all.
    const db = createFakeDb()
    const withK = doc('online. and offline K')
    await putNoteWithIntent(db, record({ bodyJson: withK }), entry({ patch: { title: 'Thesis', subtitle: '', bodyJson: withK } }))
    await settleIdb(4)
    expect(await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: SERVER_NOW, forked: FORKED, connect: connectTo(db) })).toBe(false)
    await settleIdb(4)
    const after = await getNote(db, 'n1')
    expect(after.dirty).toBe(1)
    expect(after.bodyJson).toEqual(withK)
    expect(await listOutbox(db), 'K stays queued — a later second fork preserves it').toHaveLength(1)
  })

  it('⛔ a queued entry that moved past what was forked is refused too', async () => {
    const db = createFakeDb()
    const withK = doc('online. and offline K')
    await putNoteWithIntent(db, record(), entry({ patch: { title: 'Thesis', subtitle: '', bodyJson: withK } }))
    await settleIdb(4)
    expect(await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: SERVER_NOW, forked: FORKED, connect: connectTo(db) })).toBe(false)
    expect(await listOutbox(db)).toHaveLength(1)
  })

  it('⛔ no `forked`, no proof: refused, nothing written', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    expect(await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: SERVER_NOW, connect: connectTo(db) })).toBe(false)
    expect((await getNote(db, 'n1')).dirty).toBe(1)
  })

  it('⛔ with the wave switched OFF it writes nothing (§21)', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    const db = createFakeDb()
    await putNoteWithIntent(db, record(), entry())
    await settleIdb(4)
    expect(await settleOwnerFork({ accountId: 'a1', noteId: 'n1', serverNote: SERVER_NOW, forked: FORKED, connect: connectTo(db) })).toBeNull()
    await settleIdb(4)
    expect((await getNote(db, 'n1')).dirty).toBe(1)
    expect(await listOutbox(db)).toHaveLength(1)
  })
})
