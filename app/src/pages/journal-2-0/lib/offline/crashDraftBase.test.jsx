/**
 * ⭐⭐ D3b (wave 6) — A CRASH DRAFT RECORDS ITS BASE, AND RESTORE NEVER CLOBBERS.
 *
 * Wave 5's review (N5, then §C.5 and §E.1 of `f5-fixes-2026-09-23.md`): Restore of
 * a CRASH DRAFT that won recovery still PUT over another device's words, because
 *   · the draft stored no base,
 *   · `baseOfRecovered` returned null for a draft winner, and
 *   · `chooseLocalRecovery` gave the draft the server's CURRENT revision.
 * The same no-known-base path was taken by a durable record whose base the entry
 * refuses (NEWER than the entry — poisoned, or the legitimate drain-rebase shape).
 *
 * This file owns the recovery half: what `baseOfRecovered` answers for those, and
 * that a base known only by its REVISION can only ever fork through the drain's
 * own classifier. The editor half (the draft writer recording `baseUpdatedAt`) and
 * the end-to-end Restore-then-keystroke cells live in `f5p1OwnerSendsQueued`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent } from './notebookDb'
import { useDurableNote, __resetNotebookConnections } from './useDurableNote'
import { baseOfRecovered, chooseLocalRecovery, queuedWorkToAdopt } from './recoverLocalState'
import { BODY_REWRITE, classifyServerChange, snapshotOfServerCopy } from './serverChange'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (...texts) => ({ type: 'doc', content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) })
const T0 = '2026-09-23T09:00:00.000000+00:00'   // what the draft was typed on
const T1 = '2026-09-23T09:05:00.000000+00:00'   // another device saved since
const T2 = '2026-09-23T09:07:00.000000+00:00'
const WIDGET = { type: 'widgetEmbed', attrs: { widgetId: 'w-1', capturedAt: '2026-09-23T09:04:00Z', searchText: 'NVDA' } }

const AT_T0 = { title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 }
const OTHER_DEVICE = { title: 'Thesis', subtitle: '', bodyJson: doc('rewritten on another device'), updatedAt: T1 }
const DRAFT = {
  title: 'Thesis', subtitle: '', bodyJson: doc('online', 'typed, then the tab crashed'),
  savedAt: 20, sessionId: 's-crashed', baseUpdatedAt: T0,
}
const REVISION_ONLY = (at) => ({ title: '', subtitle: '', bodyJson: null, updatedAt: at, bodyUnknown: true })

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  __resetNotebookConnections()
  if (!globalThis.indexedDB) globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
})

const decideFor = (server, { record = null, draft = DRAFT } = {}) =>
  chooseLocalRecovery({ server, idbRecord: record, lsDraft: draft })

describe('baseOfRecovered — a crash draft that won', () => {
  it('⛔⛔ another device saved since: the draft’s OWN revision, body unknown — never the server’s current one', () => {
    const decision = decideFor(OTHER_DEVICE)
    expect(decision.source).toBe('localStorage')
    expect(decision.baseUpdatedAt, 'the draft’s recorded base reaches the decision').toBe(T0)
    expect(baseOfRecovered({ decision, draft: DRAFT, server: OTHER_DEVICE })).toEqual(REVISION_ONLY(T0))
  })

  it('⭐ the server has not moved since: its copy IS the base, body and all', () => {
    const decision = decideFor(AT_T0)
    expect(baseOfRecovered({ decision, draft: DRAFT, server: AT_T0 }))
      .toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
  })

  it('⭐ the durable record’s last-known copy at the draft’s revision is the base (a draft ahead of the record)', () => {
    const record = {
      noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('online', 'typed'), dirty: 1,
      generation: 2, sessionId: 's-crashed', localSavedAt: 10, baseUpdatedAt: T0, serverBase: AT_T0,
    }
    const decision = decideFor(OTHER_DEVICE, { record })
    expect(decision.source, 'the draft is ahead of the record').toBe('localStorage')
    expect(baseOfRecovered({ decision, record, draft: DRAFT, server: OTHER_DEVICE }))
      .toEqual({ title: 'Thesis', subtitle: '', bodyJson: doc('online'), updatedAt: T0 })
  })

  it('⛔ a draft written BEFORE D3b has no recorded base — nothing is guessed, Restore keeps its old path', () => {
    const legacy = { ...DRAFT }
    delete legacy.baseUpdatedAt
    const decision = decideFor(OTHER_DEVICE, { draft: legacy })
    expect(baseOfRecovered({ decision, draft: legacy, server: OTHER_DEVICE })).toBeNull()
  })

  it('⛔ no draft handed in (the wave is off, or the winner is not the draft) — null', () => {
    expect(baseOfRecovered({ decision: decideFor(OTHER_DEVICE), server: OTHER_DEVICE })).toBeNull()
  })

  it('⛔ a revision-only base is NEVER sent by ourselves — `queuedWorkToAdopt` refuses it; only a Restore uses it', () => {
    const record = {
      noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued'), dirty: 1,
      generation: 2, sessionId: 's', localSavedAt: 10, baseUpdatedAt: T0,
      serverBase: { ...AT_T0, updatedAt: T1 },        // NEWER than the entry
    }
    const entry = {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued') }, baseUpdatedAt: T0,
    }
    const decision = decideFor(OTHER_DEVICE, { record, draft: null })
    expect(baseOfRecovered({ decision, record, entry })).toEqual(REVISION_ONLY(T0))
    expect(queuedWorkToAdopt({ decision, record, entry })).toBeNull()
  })
})

describe('⭐ D3b fix round 1 (review N-1) — which revision a refused record base falls back to, in every shape', () => {
  // `oldestRevision`'s comment said a pair that cannot be ordered is "not guessed
  // between" while the code chose. They now say the same thing, and each shape is
  // pinned: a record with NO last-known copy, so only the revision can be offered.
  const recordAt = (baseUpdatedAt) => ({
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued'), dirty: 1,
    generation: 2, sessionId: 's', localSavedAt: 10, baseUpdatedAt,
  })
  const entryAt = (baseUpdatedAt) => ({
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued') }, baseUpdatedAt,
  })
  const baseFor = (recAt, entAt) => {
    const record = recordAt(recAt)
    return baseOfRecovered({ decision: decideFor(OTHER_DEVICE, { record, draft: null }), record, entry: entryAt(entAt) })
  }

  it('both parse ⇒ the OLDER of the two (a send on it can only 409 more often)', () => {
    expect(baseFor(T1, T0)).toEqual(REVISION_ONLY(T0))
    expect(baseFor(T0, T1)).toEqual(REVISION_ONLY(T0))
  })

  it('⛔ a MIXED pair — the ENTRY unparseable ⇒ the record’s own revision, the one real evidence', () => {
    expect(baseFor(T0, 'not-a-revision')).toEqual(REVISION_ONLY(T0))
  })

  it('⛔ a MIXED pair — the RECORD unparseable ⇒ the entry’s, the revision the sweep itself would send these words on', () => {
    expect(baseFor('garbled-revision', T1)).toEqual(REVISION_ONLY(T1))
  })

  it('a lone usable revision that does not parse ⇒ itself (what a direct PUT would have sent)', () => {
    expect(baseFor('garbled-revision', 'garbled-revision')).toEqual(REVISION_ONLY('garbled-revision'))
  })

  it('⛔ two that do not parse ⇒ nothing to order them by ⇒ null, and Restore keeps its old path', () => {
    expect(baseFor('garbled-one', 'garbled-two')).toBeNull()
  })
})

describe('⭐⭐ a base known only by its revision can only FORK — through the drain’s own classifier', () => {
  // The editor's reconcile classifies the server's copy against the base it
  // saved on. Every server shape a moved note can have must read BODY_REWRITE
  // against a revision-only base: never a merge nobody can prove, never a rebase
  // that sends the member's words over what is there.
  const shapes = {
    'another device rewrote the body': OTHER_DEVICE,
    'a door moved it (metadata only)': { ...AT_T0, updatedAt: T1 },
    'a door appended a widget': { ...AT_T0, bodyJson: { ...doc('online'), content: [...doc('online').content, WIDGET] }, updatedAt: T1 },
    'a title change': { ...AT_T0, title: 'Renamed', updatedAt: T2 },
    'an untitled note with a body': { title: '', subtitle: '', bodyJson: doc('x'), updatedAt: T1 },
    'a blank note (the server sends an empty doc, not null)': { title: '', subtitle: '', bodyJson: { type: 'doc', content: [] }, updatedAt: T1 },
  }
  for (const [name, fresh] of Object.entries(shapes)) {
    it(`${name} ⇒ BODY_REWRITE ⇒ fork`, () => {
      expect(classifyServerChange(fresh, REVISION_ONLY(T0))).toBe(BODY_REWRITE)
    })
  }
})

function mount(db) {
  return renderHook(() => useDurableNote({
    accountId: 'acct1', noteId: 'n1', debounceMs: 0, connect: vi.fn(async () => db),
  }))
}

describe('recover() — the draft reaches the base authority, and the kill switch rolls it back', () => {
  it('⭐ a crash draft that won comes back with `base` at the draft’s own revision', async () => {
    const db = createFakeDb()
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: OTHER_DEVICE, lsDraft: DRAFT }) })
    expect(decision.source).toBe('localStorage')
    expect(decision.adopt).toBeNull()
    expect(decision.base).toEqual(REVISION_ONLY(T0))
  })

  it('⭐ a record whose base the entry refuses (the legitimate drain-rebase shape) comes back with the entry’s revision', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, {
      noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued'), dirty: 1,
      generation: 2, sessionId: 's', localSavedAt: 10, baseUpdatedAt: T0,
      serverBase: { ...AT_T0, updatedAt: T1 },
    }, {
      mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
      patch: { title: 'Thesis', subtitle: '', bodyJson: doc('online', 'queued') }, baseUpdatedAt: T0,
    })
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: { ...OTHER_DEVICE, updatedAt: T2 } }) })
    expect(decision.adopt).toBeNull()
    expect(decision.base).toEqual(REVISION_ONLY(T0))
  })

  it('⛔ with the wave switched OFF the draft reads exactly as before D3b: no base, the server’s revision (§21)', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    const db = createFakeDb()
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: OTHER_DEVICE, lsDraft: DRAFT }) })
    expect(decision.source).toBe('localStorage')
    expect(decision.base).toBeNull()
    expect(decision.baseUpdatedAt, 'off, a draft’s recorded base must not change the old path').toBe(T1)
  })
})

/**
 * ⛔⛔ D3b FIX ROUND 2 (review NN-1) — "NEVER SEND ON AN UNKNOWN BODY BY OURSELVES"
 * MUST SURVIVE A SESSION.
 *
 * A Restore on a revision-only base, with no durable record before it, makes
 * `persist` store `snapshotOfServerCopy(state.serverBase)` — and that frozen
 * snapshot keeps no `bodyUnknown`. The next session's `baseOfRecovered` reads the
 * copy back as a FULL base at the same revision: a null body and no flag. Keyed on
 * the flag, `queuedWorkToAdopt` adopted it, and any server move then forked a note
 * nobody asked to fork. Keyed on the missing BODY — the key residual (b) uses in
 * `commitSave` — it is offered instead, and only the member's Restore sends it.
 * The real-editor half is in `f5p1OwnerSendsQueued.test.jsx` (fix round 2).
 */
describe('⛔⛔ D3b fix round 2 (review NN-1) — a base with no BODY is never adopted, even after the store dropped its flag', () => {
  const QUEUED = doc('online', 'queued')
  const MOVED = { ...AT_T0, updatedAt: T1 }          // a door moved the note while the member was away
  const recordOn = (serverBase) => ({
    noteId: 'n1', title: 'Thesis', subtitle: '', bodyJson: QUEUED, dirty: 1,
    generation: 2, sessionId: 's', localSavedAt: 10, baseUpdatedAt: T0, serverBase,
  })
  const entryOn = () => ({
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'Thesis', subtitle: '', bodyJson: QUEUED }, baseUpdatedAt: T0,
  })
  // What the durable store holds after a Restore on a revision-only base.
  const STORED = snapshotOfServerCopy(REVISION_ONLY(T0))

  it('precondition: the durable store drops the flag — what it keeps is a plain copy with a null body', () => {
    expect(STORED).toEqual({ title: '', subtitle: '', bodyJson: null, updatedAt: T0 })
    expect(STORED).not.toHaveProperty('bodyUnknown')
  })

  it('⛔⛔ the next session: `baseOfRecovered` reads it back as a full base, and `queuedWorkToAdopt` REFUSES it — offered, never sent by ourselves', () => {
    const record = recordOn(STORED)
    const entry = entryOn()
    const decision = decideFor(MOVED, { record, draft: null })
    expect(baseOfRecovered({ decision, record, entry }), 'precondition: the flag-less copy stands as the base')
      .toEqual({ title: '', subtitle: '', bodyJson: null, updatedAt: T0 })
    expect(queuedWorkToAdopt({ decision, record, entry }),
      'a base with no body was adopted: any server move now forks a note nobody asked to fork').toBeNull()
  })

  it('⛔⛔ through `recover()`: no `adopt` — and the base a Restore sends on is still the words’ own revision', async () => {
    const db = createFakeDb()
    await putNoteWithIntent(db, recordOn(STORED), entryOn())
    await settleIdb(4)
    const { result } = mount(db)
    let decision
    await act(async () => { decision = await result.current.recover({ server: MOVED }) })
    expect(decision.unsynced, 'the words are still offered').toBe(true)
    expect(decision.adopt, 'adopted on a base whose body is unknown').toBeNull()
    expect(decision.base?.updatedAt, 'Restore must still know the revision the words were written on').toBe(T0)
    expect(decision.base?.bodyJson ?? null).toBeNull()
  })

  it('⭐ CONTROL — a KNOWN base at the same revision is still adopted (the refusal is not vacuous)', () => {
    const record = recordOn(AT_T0)
    const adopt = queuedWorkToAdopt({ decision: decideFor(MOVED, { record, draft: null }), record, entry: entryOn() })
    expect(adopt?.base).toEqual(AT_T0)
    expect(adopt?.state.bodyJson).toEqual(QUEUED)
  })

  it('⭐ CONTROL — a BLANK note is a KNOWN body (the server serves an empty doc, never null) and is still adopted', () => {
    // `notes.py` `_row_to_note` serves a NULL `body_json` as `{"type":"doc","content":[]}`,
    // so a null body in a stored copy can only be one this browser did not know.
    const blank = { title: 'Thesis', subtitle: '', bodyJson: { type: 'doc', content: [] }, updatedAt: T0 }
    const record = recordOn(blank)
    const adopt = queuedWorkToAdopt({ decision: decideFor({ ...blank, updatedAt: T1 }, { record, draft: null }), record, entry: entryOn() })
    expect(adopt?.base.bodyJson, 'an EMPTY body was read as an UNKNOWN one').toEqual({ type: 'doc', content: [] })
  })
})
