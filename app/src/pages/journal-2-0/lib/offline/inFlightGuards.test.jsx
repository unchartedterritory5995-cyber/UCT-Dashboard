/**
 * Wave Q1 round 2 — TWO GUARDS THAT ARE ACTUALLY INDEPENDENT.
 *
 * ⚰️ ROUND 1 SHIPPED AND REPRODUCED IN EIGHT MINUTES. Two reasons:
 *   · `settleLandedSave` was wired into `restoreDraft` and NOT into
 *     `commitSave` — the debounced autosave the defect actually rides. Eleven
 *     rails and four mutations exercised the FUNCTION; nothing exercised the
 *     WIRE.
 *   · the drain's supersede refusal asks `landedBaseline`, which refuses a
 *     DIRTY record — and in the window that guard was written for, nothing has
 *     settled, so the record IS dirty. Two guards sharing a precondition are
 *     one guard, and what remained was a race.
 *
 * ⛔ SO EVERY CASE HERE CARRIES A CONTROL, and the controls are the point: a
 * guard that never lets anything through is not a guard, it is an outage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, putMeta, listOutbox, getNote } from './notebookDb'
import { drainOutbox, FORKED, SENT, SKIPPED, SUPERSEDED } from './outboxDrain'
import { settleLandedSave, beginInFlightSave, endInFlightSave, SESSION_ID } from './useDurableNote'
import {
  isMarkerLive, markerFor, markerKeyFor, liveSessionIds, sessionLockNameFor, IN_FLIGHT_TTL_MS,
} from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const T1 = '2026-09-10T13:00:00.000000+00:00'
const T2 = '2026-09-10T13:00:09.000000+00:00'
const WORDS = 'online. offline.'
const state = (t = WORDS) => ({ title: 'note', subtitle: '', bodyJson: doc(t) })

let db
const connect = async () => db

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected') } }
})

async function queued(text = WORDS) {
  await putNoteWithIntent(db, {
    noteId: 'n1', ...state(text), baseUpdatedAt: T1,
    generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: state(text), baseUpdatedAt: T1, generation: 2, sessionId: 's1', queuedAt: 5,
  })
}

describe('⭐ guard 1 — the drain does not claim a note whose save is on the wire', () => {
  it('the settle beats the drain ⇒ nothing queued, nothing sent, no fork', async () => {
    await queued()
    await settleLandedSave({ accountId: 'a1', noteId: 'n1', acked: state(), current: state(), updatedAt: T2, connect })
    await settleIdb(4)
    const send = vi.fn(); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork })
    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(results).toHaveLength(0)
  })

  it('⛔ the DRAIN claims first, marker LIVE ⇒ SKIPPED, not sent, not blocked', async () => {
    await queued()
    await beginInFlightSave({ accountId: 'a1', noteId: 'n1', baseUpdatedAt: T1, connect })
    await settleIdb(4)
    const send = vi.fn(); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, holders: new Set([SESSION_ID]) })

    expect(send).not.toHaveBeenCalled()
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SKIPPED])
    // ⛔ SKIPPED is not BLOCKED: the entry is intact and the next drain gets it.
    expect(await listOutbox(db)).toHaveLength(1)
    expect((await listOutbox(db))[0].permanent).toBeFalsy()
  })

  it('⭐ CONTROL — with the marker DOWN the same entry is sent, so the guard is not an outage', async () => {
    await queued()
    await beginInFlightSave({ accountId: 'a1', noteId: 'n1', baseUpdatedAt: T1, connect })
    await endInFlightSave({ accountId: 'a1', noteId: 'n1', connect })
    await settleIdb(4)
    const send = vi.fn(async () => ({ updatedAt: T2 })); const fork = vi.fn()
    const results = await drainOutbox(db, { send, fork, holders: new Set([SESSION_ID]) })
    expect(send).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([SENT])
  })

  it('⛔ a marker from a DEAD session expires immediately, TTL or no TTL', async () => {
    await queued()
    await putMeta(db, markerKeyFor('n1'), markerFor({ sessionId: 'a-tab-that-is-gone', baseUpdatedAt: T1 }))
    await settleIdb(4)
    // The holder set knows nothing of that session ⇒ dead, even though it is
    // milliseconds old and nowhere near the TTL.
    const send = vi.fn(async () => ({ updatedAt: T2 }))
    const results = await drainOutbox(db, { send, fork: vi.fn(), holders: new Set([SESSION_ID]) })
    expect(results.map((r) => r.outcome)).toEqual([SENT])
  })

  it('⛔ holders=null means "the TTL decides alone", NEVER "nobody is alive"', async () => {
    const fresh = markerFor({ sessionId: 'someone', baseUpdatedAt: T1 })
    // With no lock answer, a fresh marker stays live...
    expect(isMarkerLive(fresh, { holders: null })).toBe(true)
    // ...and an empty SET is the opposite claim, and is honoured as such.
    expect(isMarkerLive(fresh, { holders: new Set() })).toBe(false)
  })

  it('⛔ an expired marker is not ignored — it falls through to the server check', async () => {
    await queued()
    const old = markerFor({ sessionId: SESSION_ID, baseUpdatedAt: T1, now: Date.now() - (IN_FLIGHT_TTL_MS + 1000) })
    await putMeta(db, markerKeyFor('n1'), old)
    await settleIdb(4)

    // The save it marked DID land — the server is on T2 with our words.
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn()
    const serverCopyIsOurs = vi.fn(async () => ({ ours: true, identical: true, why: 'byte-identical' }))
    const results = await drainOutbox(db, {
      send, fork, holders: new Set([SESSION_ID]), serverCopyIsOurs,
    })
    expect(serverCopyIsOurs).toHaveBeenCalledTimes(1)
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(await listOutbox(db)).toHaveLength(0)
  })

  it('a marker stamped in the FUTURE is not live (clock skew cannot pin a note open)', () => {
    expect(isMarkerLive({ sessionId: 's', startedAt: Date.now() + 60_000 })).toBe(false)
  })
})

describe('⭐ guard 2 — a 409 asks the server before it forks', () => {
  it('⛔ 409 whose server copy IS ours ⇒ superseded, removed, NO fork', async () => {
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn()
    const results = await drainOutbox(db, {
      send, fork,
      serverCopyIsOurs: async () => ({ ours: true, identical: true, why: 'the server copy is byte-identical to this entry' }),
    })
    expect(fork).not.toHaveBeenCalled()
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
    expect(results[0].reason).toMatch(/byte-identical/)
  })

  it('⭐⭐ CONTROL — A GENUINE SECOND WRITER STILL FORKS. This is the case that must not regress', async () => {
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', title: 'note', updatedAt: T2, bodyJson: doc('someone else') }))
    const results = await drainOutbox(db, {
      send, fork,
      serverCopyIsOurs: async () => ({ ours: false, why: 'the server copy differs and is not one of ours' }),
    })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ the server check THROWING is not permission to discard — it forks', async () => {
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', updatedAt: T2 }))
    const results = await drainOutbox(db, {
      send, fork,
      serverCopyIsOurs: async () => { throw new Error('offline again') },
    })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })

  it('⛔ with NO server check supplied, a 409 forks — the pre-existing behaviour is the floor', async () => {
    await queued()
    const send = vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e })
    const fork = vi.fn(async () => ({ noteId: 'n1', updatedAt: T2 }))
    const results = await drainOutbox(db, { send, fork })
    expect(fork).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.outcome)).toEqual([FORKED])
  })
})

describe('⭐ the orderings that produced the defect', () => {
  it('⛔ reload mid-flight: the marker is DURABLE, so a new session declines, then resolves', async () => {
    await queued()
    // A previous tab raised the marker and then died mid-flight.
    await putMeta(db, markerKeyFor('n1'), markerFor({ sessionId: 'previous-tab', baseUpdatedAt: T1 }))
    await settleIdb(4)

    // While that tab is still alive, this session's drain declines.
    let results = await drainOutbox(db, {
      send: vi.fn(), fork: vi.fn(), holders: new Set(['previous-tab', SESSION_ID]),
    })
    expect(results.map((r) => r.outcome)).toEqual([SKIPPED])

    // It dies. The lock is released, so the marker is stale at once — and the
    // outcome is decided by the SERVER, not by a guess.
    const serverCopyIsOurs = vi.fn(async () => ({ ours: true, identical: true, why: 'byte-identical' }))
    results = await drainOutbox(db, {
      send: vi.fn(async () => { const e = new Error('conflict'); e.status = 409; throw e }),
      fork: vi.fn(), holders: new Set([SESSION_ID]), serverCopyIsOurs,
    })
    expect(results.map((r) => r.outcome)).toEqual([SUPERSEDED])
  })

  it('⛔ an offline entry NEWER than the landed save is REBASED, never discarded', async () => {
    await queued('online. offline.')
    // The ack is for OLDER words; the member kept typing.
    await settleLandedSave({
      accountId: 'a1', noteId: 'n1',
      acked: state('online. offline.'), current: state('online. offline. and more.'),
      updatedAt: T2, connect,
    })
    await settleIdb(4)
    const q = await listOutbox(db)
    expect(q).toHaveLength(1)
    expect(q[0].baseUpdatedAt).toBe(T2)                        // rebased onto the landing
    expect(JSON.stringify(q[0].patch)).toContain('and more')   // newest words survive
  })
})

describe('⭐ the session liveness lock', () => {
  it('reports the sessions holding a session-named lock, and nothing else', async () => {
    const locks = { query: async () => ({ held: [
      { name: sessionLockNameFor('alpha') },
      { name: sessionLockNameFor('beta') },
      { name: 'uct.nb.sync.acct-1' },       // the LEADER lock — a different question
      { name: 'something.else' },
    ] }) }
    const ids = await liveSessionIds(locks)
    expect([...ids].sort()).toEqual(['alpha', 'beta'])
  })

  it('⛔ a browser that cannot answer returns null, not an empty set', async () => {
    expect(await liveSessionIds(undefined)).toBeNull()
    expect(await liveSessionIds({ query: async () => { throw new Error('nope') } })).toBeNull()
  })
})

describe('⛔⛔ THE WIRE — every save path must settle, not just the function', () => {
  // ⚰️ THIS SECTION IS THE ROOT CAUSE OF ROUND 1, RAILED.
  // `settleLandedSave` was correct, unit-tested by eleven rails and proved by
  // four mutations — and called from ONE save path out of two, and not the one
  // the defect rides. Every mutation reddened tests that call the function
  // DIRECTLY, so nothing anywhere could tell that the editor did not call it.
  // ⛔ A guard is only as reachable as its call sites. Test the WIRE.
  const EDITOR = join(
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    'components', 'notebook', 'NoteEditorPage.jsx',
  )
  const src = readFileSync(EDITOR, 'utf8')
  // Comments name these functions constantly; strip them or the rail passes on prose.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /** The body of one top-level `const <name> = async () => { … }`, brace-matched. */
  function bodyOf(name) {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*async\\s*\\(`).exec(code)
    if (!m) return null
    let i = code.indexOf('{', m.index)
    let depth = 0
    for (let k = i; k < code.length; k += 1) {
      if (code[k] === '{') depth += 1
      else if (code[k] === '}') { depth -= 1; if (depth === 0) return code.slice(i, k + 1) }
    }
    return null
  }

  it('⭐ the sweep can find the editor and its save paths (non-vacuity control)', () => {
    expect(code.length).toBeGreaterThan(5000)
    expect(bodyOf('commitSave')).toBeTruthy()
    expect(bodyOf('restoreDraft')).toBeTruthy()
  })

  it('⛔ commitSave — the debounced autosave — RAISES the marker and SETTLES', () => {
    const body = bodyOf('commitSave')
    expect(body).toMatch(/beginInFlightSave\s*\(/)
    expect(body).toMatch(/settleLandedSave\s*\(/)
    expect(body).toMatch(/endInFlightSave\s*\(/)   // the failure fallback
  })

  it('⛔ restoreDraft — the other save path — settles too', () => {
    expect(bodyOf('restoreDraft')).toMatch(/settleLandedSave\s*\(/)
  })

  it('⛔⛔ EVERY save path that awaits `update(` settles. Derived, not listed', () => {
    // ⭐ The list is DERIVED: any top-level async arrow whose body awaits the
    // note-update call is a save path by definition, and must settle. A typed
    // list of two names is how round 1 shipped — a third path added tomorrow
    // would join the file and not this rail.
    const names = [...code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/g)].map((m) => m[1])
    const savePaths = names.filter((n) => {
      const b = bodyOf(n)
      return b && /await\s+update\s*\(/.test(b)
    })
    expect(savePaths.length).toBeGreaterThanOrEqual(2)   // control: it found some

    // ⛔ FOLLOW ONE LEVEL OF INDIRECTION. Settling via a named local helper is a
    // legitimate way to settle, and a rail that only accepts a literal call
    // would push authors to inline the same block three times — which is the
    // guard-repeated-is-a-guard-unproved defect, invited by the test.
    // ⭐ ONE level, deliberately: deeper and this becomes a call-graph walker
    // that passes for reasons nobody can see at a glance.
    const settles = (n) => {
      const b = bodyOf(n)
      if (!b) return false
      if (/settleLandedSave\s*\(/.test(b)) return true
      return names.some((h) => (
        h !== n
        && new RegExp(`\\b${h}\\s*\\(`).test(b)
        && /settleLandedSave\s*\(/.test(bodyOf(h) || '')
      ))
    }
    const unsettled = savePaths.filter((n) => !settles(n))
    expect(unsettled).toEqual([])
  })

  it('⛔⛔ a door NEVER falls back to the server copy for `current` — that deletes queued work', () => {
    // ⚰️ THE LINE THAT LOST A MEMBER'S WORDS, 2026-09-10, streak run 1:
    //     current: captureLocalState() || saved
    // When the editor could not report local state, `current` became `saved`,
    // which IS `acked`, so `sameAuthoredContent` read "caught up", the intent
    // became null, and every queued entry for the note was DELETED.
    //
    // ⛔ WHY THIS IS A SOURCE PIN AND NOT A BEHAVIOURAL CASE. The behavioural
    // rails model the door by calling `settleLandedSave` directly, so mutating
    // the ARGUMENT the editor passes reddens nothing — the mutation gauntlet
    // proved that: M22 was dull until this case existed. It is the same shape as
    // the root cause of round 1: the function was tested, the WIRE was not.
    const body = bodyOf('settleMetadataRevision')
    expect(body, 'settleMetadataRevision must exist').toBeTruthy()

    // ⛔ No fallback of ANY kind for `current`. Absence of local state is not
    // evidence about content, and there is no substitute that is.
    expect(body).not.toMatch(/current:\s*captureLocalState\(\)\s*\|\|/)
    expect(body).toMatch(/const\s+current\s*=\s*captureLocalState\(\)\s*$/m)
    expect(body, 'no local state ⇒ refuse to settle').toMatch(/if\s*\(!current\)\s*return/)

    // ⛔ AND THE LANDING IS RECORDED ANYWAY — recording that a revision is ours
    // needs only that WE made the request, and withholding it made guard 2
    // answer "not ours" about our own write and fork the note.
    expect(body).toMatch(/recordLandedRevision\s*\(/)
    expect(
      body.indexOf('recordLandedRevision'),
      'the landing is recorded BEFORE the refuse-to-settle guard, or it is skipped with it',
    ).toBeLessThan(body.indexOf('if (!current) return'))
  })

  it('⛔ the marker is raised BEFORE the PUT, not after it', () => {
    const body = bodyOf('commitSave')
    // A marker written after the request is one the drain can miss — the whole
    // defect in miniature. Position is the property; assert position.
    expect(body.indexOf('beginInFlightSave')).toBeLessThan(body.indexOf('await update('))
  })
})
