/**
 * Rails over the ONE way a note revision is landed.
 *
 * ⛔⛔ THESE EXIST BECAUSE FIVE OF SIX DOORS RECORDED NOTHING. Enumerating from
 * the code on 2026-09-12 — every server-side `update_note` writer and every
 * client write to `/api/j2/notes/*` — found six client doors in two endpoint
 * families, and exactly one of them recorded its landing. The other five
 * advanced the server revision silently, so the drain answered "not ours" about
 * this browser's own write and forked the member's note.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { getMeta } from './notebookDb'
import { dbNameFor } from './notebookDb'
import { landedKeyFor } from './inFlight'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { setCurrentAccountId, getCurrentAccountId } from './currentAccount'
import { settleNoteWrite } from './settleNoteWrite'

const T1 = '2026-09-12T13:00:11.000000+00:00'

let db
let openedNames
const connect = async (accountId) => { openedNames.push(dbNameFor(accountId)); return db }

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  openedNames = []
  // ⛔ `recordLandedRevision` refuses before it ever connects unless the platform
  // reports IndexedDB. The fake `connect` never reaches this factory — it only
  // has to exist for `offlineStorageAvailable()` to be true, which is the same
  // shape the property rail uses.
  globalThis.indexedDB = { open: () => { throw new Error('injected — use connect') } }
  setCurrentAccountId(null)
})
afterEach(() => { setCurrentAccountId(null); vi.restoreAllMocks() })

describe('settleNoteWrite — the one way a revision is landed', () => {
  it('records the revision the endpoint returned, with NO editor mounted', async () => {
    setCurrentAccountId('acct-A')
    const landed = await settleNoteWrite('n1', { updatedAt: T1 }, 'acct-A', { connect })
    expect(landed).toBe(T1)
  })

  it('accepts the {note:{…}} envelope /hero and /embeds actually return', async () => {
    setCurrentAccountId('acct-A')
    expect(await settleNoteWrite('n1', { note: { updatedAt: T1 } }, 'acct-A', { connect })).toBe(T1)
  })

  it('⛔ records NOTHING when the endpoint returned no revision — it cannot invent one', async () => {
    setCurrentAccountId('acct-A')
    expect(await settleNoteWrite('n1', { ok: true }, 'acct-A', { connect })).toBeNull()
    expect(await settleNoteWrite('n1', null, 'acct-A', { connect })).toBeNull()
  })

  it('⛔ NEVER THROWS — the write already succeeded server-side', async () => {
    setCurrentAccountId('acct-A')
    await expect(settleNoteWrite(null, { updatedAt: T1 })).resolves.toBeNull()
    await expect(settleNoteWrite('n1', undefined)).resolves.toBeNull()
  })
})

describe('⛔⛔ SIGN-OUT — both directions, and the STORE NAME is the assertion', () => {
  it('signing out clears the registry', () => {
    setCurrentAccountId('acct-A')
    expect(getCurrentAccountId()).toBe('acct-A')
    setCurrentAccountId(null)              // what AuthContext does on logout
    expect(getCurrentAccountId()).toBeNull()
  })

  it('⛔ with the registry EMPTY, a write records nothing and OPENS NO DATABASE', async () => {
    // ⛔⛔ THE FAILURE THIS RAIL EXISTS FOR is not "the registry is null" — it is
    // a write landing in the PREVIOUS member's store. Asserting the registry
    // would not catch that; asserting which database was opened does.
    setCurrentAccountId(null)
    const landed = await settleNoteWrite('n1', { updatedAt: T1 }, undefined, { connect })
    expect(landed).toBeNull()
    expect(openedNames, 'a database was opened with nobody signed in').toEqual([])
  })

  it('⭐ CONTROL — signed in as B, the write opens B’s store and NEVER A’s', async () => {
    setCurrentAccountId('acct-B')
    await settleNoteWrite('n1', { updatedAt: T1 }, 'acct-B', { connect })
    await settleIdb(2)
    expect(openedNames, 'B’s store, and only B’s').toEqual([dbNameFor('acct-B')])
    expect(dbNameFor('acct-B')).toBe('uct_notebook_acct-B')
    expect(dbNameFor('acct-B')).not.toBe(dbNameFor('acct-A'))
  })

  it('⭐ CONTROL — the registry is the ONLY source; an explicit id still wins for callers that have one', async () => {
    setCurrentAccountId('acct-B')
    expect(await settleNoteWrite('n1', { updatedAt: T1 }, 'acct-A', { connect })).toBe(T1)
  })
})

/**
 * ⛔⛔ §21 — SWITCHING THE WAVE OFF MUST WRITE NOTHING, AND THIS IS NOW THE
 * WIDEST STORE-DIRECT ENTRY POINT IN THE PRODUCT.
 *
 * Before 2026-09-12 the mount-independent writers were three, all inside the
 * offline layer. `settleNoteWrite` is called from SIXTEEN places across the
 * Notebook — the trade modal, the importer, the capture targets, the version
 * history, the trash — and none of those files knows anything about the wave.
 * So the one-line rollback is only real if the refusal lives HERE, once, and
 * every one of those sixteen inherits it.
 *
 * ⛔ OFF STOPS PROCESSING — it has never been permission to delete or alter what
 * a member already wrote. The assertion is that NO DATABASE IS OPENED, not
 * merely that the return is null: a store opened under a flag that is off is a
 * write the rollback did not prevent.
 */
describe('⛔⛔ §21 — with the wave OFF, sixteen doors write nothing', () => {
  it('records nothing and OPENS NO DATABASE when the flag is off', async () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    setCurrentAccountId('acct-A')

    const landed = await settleNoteWrite('n1', { updatedAt: T1 }, 'acct-A', { connect })
    expect(landed).toBeNull()
    expect(openedNames, '⛔ the flag is off and a store was still opened').toEqual([])
  })

  it('⭐ CONTROL — the SAME call with the wave on does land, and opens exactly one store', async () => {
    // Without this the test above passes for a settle that never works at all.
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    setCurrentAccountId('acct-A')

    expect(await settleNoteWrite('n1', { updatedAt: T1 }, 'acct-A', { connect })).toBe(T1)
    expect(openedNames).toEqual([dbNameFor('acct-A')])
  })
})
