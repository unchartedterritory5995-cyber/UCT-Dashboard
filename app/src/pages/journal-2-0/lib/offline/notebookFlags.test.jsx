/**
 * ⛔⛔ WAVE K — THE CONFIG RAILS. K-R1 … K-R5, K-R7, K-R9.
 *
 * Every one is mutation-proved: break the guard, watch the rail redden, restore.
 * The two that matter most are the ones that assert a NEGATIVE — K-R1 and K-R4,
 * which say no database is opened. A kill switch that returns `false` while the
 * store is already open has not killed anything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FLAG_FALLBACKS, latchNotebookFlags, notebookFlag, notebookFlagsDebug,
  notebookFlagsReady, __resetNotebookFlags,
} from './notebookFlags'
import { OFFLINE_DEFAULT_ON, OFFLINE_FLAG_KEY, offlineEnabled } from './offlineFlag'

const ON = { notebook_offline_default_on: true }
const OFF = { notebook_offline_default_on: false }

beforeEach(() => { __resetNotebookFlags(); localStorage.clear() })
afterEach(() => { __resetNotebookFlags(); localStorage.clear(); vi.restoreAllMocks() })

describe('K-R1 — the switch actually kills, and kills before any write', () => {
  it('config false + constant true ⇒ offlineEnabled() is false', () => {
    expect(OFFLINE_DEFAULT_ON, 'the premise: the constant is ON').toBe(true)
    latchNotebookFlags(OFF)
    expect(offlineEnabled()).toBe(false)
  })

  it('⛔ and NO DATABASE IS OPENED — the assertion that makes it a kill', async () => {
    // ⭐ A switch that answers "off" after the store is open has not killed
    // anything: the working copy is already on disk and the lock already held.
    const { recordLandedRevision } = await import('./useDurableNote')
    const connect = vi.fn(async () => { throw new Error('a store was opened under a killed wave') })
    latchNotebookFlags(OFF)

    const landed = await recordLandedRevision({
      accountId: 'acct-A', noteId: 'n1', updatedAt: '2026-09-12T00:00:00Z', connect,
    })
    expect(landed).toBeNull()
    expect(connect, '⛔ the wave is off and a store was still opened').not.toHaveBeenCalled()
  })

  it('⭐ CONTROL — with config TRUE the same call does reach the store', async () => {
    const { recordLandedRevision } = await import('./useDurableNote')
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
    const connect = vi.fn(async () => { throw new Error('reached') })
    latchNotebookFlags(ON)

    await recordLandedRevision({
      accountId: 'acct-A', noteId: 'n1', updatedAt: '2026-09-12T00:00:00Z', connect,
    })
    expect(connect, 'without this the rail above passes for a broken settle').toHaveBeenCalled()
  })
})

describe('K-R2 — every failure row falls back to the CONSTANT, each driven separately', () => {
  it.each([
    ['no payload at all', null],
    ['a payload with none of the keys (an older backend)', { plan: 'pro' }],
    ['a payload whose key is not a boolean', { notebook_offline_default_on: 'true' }],
    ['a payload whose key is null', { notebook_offline_default_on: null }],
  ])('%s ⇒ the compile-time constant', (_label, payload) => {
    latchNotebookFlags(payload)
    expect(offlineEnabled()).toBe(OFFLINE_DEFAULT_ON)
  })

  it('⛔ an older backend does NOT latch — one stale pod must not kill the wave', () => {
    // ⚰️ The dangerous shape: treat "no key" as `false` and a single answer from
    // a pod that predates K turns the wave off for that member, permanently,
    // for the life of the tab.
    latchNotebookFlags({ plan: 'pro' })
    expect(notebookFlagsReady(), 'nothing should have latched').toBe(false)
    latchNotebookFlags(OFF)
    expect(notebookFlag('notebook_offline_default_on'), 'a real answer still latches afterwards').toBe(false)
  })

  it('the Q2 capabilities fall back to their OWN defaults, which are off', () => {
    latchNotebookFlags({ notebook_offline_default_on: true })
    for (const k of ['notebook_offline_read_on', 'notebook_conflict_ux_on', 'notebook_attachments_on']) {
      expect(notebookFlag(k), `${k} is an enablement gate — absent means off`).toBe(FLAG_FALLBACKS[k])
      expect(FLAG_FALLBACKS[k]).toBe(false)
    }
  })
})

describe('K-R3 — the member opt-out is TERMINAL', () => {
  it('the member\'s "0" beats config true AND constant true', () => {
    latchNotebookFlags(ON)
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    expect(offlineEnabled()).toBe(false)
  })

  it('the member\'s "1" beats config FALSE — their choice, either direction', () => {
    latchNotebookFlags(OFF)
    localStorage.setItem(OFFLINE_FLAG_KEY, '1')
    expect(offlineEnabled(), 'a member who opted IN is not opted out by a server value').toBe(true)
  })

  it('⛔ and it is checked FIRST, so it never depends on a flag having arrived', () => {
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    expect(notebookFlagsReady()).toBe(false)
    expect(offlineEnabled()).toBe(false)
  })
})

describe('K-R5 — one latch, however many times a payload arrives', () => {
  it('the FIRST payload carrying the keys wins, for the life of the tab', () => {
    latchNotebookFlags(ON)
    latchNotebookFlags(OFF)
    latchNotebookFlags(OFF)
    expect(notebookFlag('notebook_offline_default_on'), 'a later poll must not move it').toBe(true)
  })

  it('a disagreement is RECORDED, not applied — it is real information', () => {
    latchNotebookFlags(ON)
    latchNotebookFlags(OFF)
    const d = notebookFlagsDebug()
    expect(d.ignoredDisagreements, 'somebody flipped the switch while this tab was open').toBe(1)
    expect(d.latched.notebook_offline_default_on).toBe(true)
    expect(d.latchedAt, 'an operator must be able to see WHEN the answer was fixed').toBeTypeOf('number')
  })
})

describe('K-R9 — the LATCH: the answer cannot move under a running tab', () => {
  it('offlineEnabled() returns the same value across many later polls', () => {
    latchNotebookFlags(ON)
    const first = offlineEnabled()
    for (let i = 0; i < 20; i += 1) latchNotebookFlags(OFF)
    expect(offlineEnabled(), '⛔ the flag moved mid-session').toBe(first)
  })

  it('⛔⛔ a mid-session flip never reaches a tab that has already decided it may write', async () => {
    // ⭐ THE PROPERTY IN ITS REAL SHAPE. Q1's SESSION_ID, its sync Web Lock and
    // its in-flight marker all belong to a tab that answered "yes" once. If the
    // answer moved, `offlineEnabled()` could say "no" between a PUT going out
    // and its ack coming back — "am I allowed to write" changing DURING a write.
    latchNotebookFlags(ON)
    const { recordLandedRevision } = await import('./useDurableNote')
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
    const reached = []
    const connect = vi.fn(async () => { reached.push(1); throw new Error('stop') })

    await recordLandedRevision({ accountId: 'a', noteId: 'n1', updatedAt: 'T1', connect })
    latchNotebookFlags(OFF)                        // the operator flips it, mid-session
    await recordLandedRevision({ accountId: 'a', noteId: 'n1', updatedAt: 'T2', connect })

    expect(reached.length, 'both writes belong to a tab that already decided').toBe(2)
  })

  it('⭐ CONTROL — a NEW tab does see the new answer', () => {
    latchNotebookFlags(ON)
    expect(offlineEnabled()).toBe(true)
    __resetNotebookFlags()                          // a new tab: fresh module state
    latchNotebookFlags(OFF)
    expect(offlineEnabled(), 'the flip reaches the next tab immediately').toBe(false)
  })
})

describe('K-R7 — with the wave off by CONFIG, the sixteen door settles write nothing', () => {
  it('a door settle lands nothing and opens no store when config says off', async () => {
    // ⚰️ Q1 proved this for the CONSTANT (`settleNoteWrite.test.jsx` §21). K
    // moves the authority, so the proof moves with it or it stops being a proof.
    const { settleNoteWrite } = await import('./settleNoteWrite')
    const { setCurrentAccountId } = await import('./currentAccount')
    setCurrentAccountId('acct-A')
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
    const connect = vi.fn(async () => { throw new Error('a store was opened under a killed wave') })
    latchNotebookFlags(OFF)

    const landed = await settleNoteWrite('n1', { updatedAt: 'T1' }, 'acct-A', { connect })
    expect(landed).toBeNull()
    expect(connect, '⛔ sixteen call sites inherit this refusal — it must hold').not.toHaveBeenCalled()
    setCurrentAccountId(null)
  })

  it('⭐ CONTROL — the same settle DOES land with config on', async () => {
    const { settleNoteWrite } = await import('./settleNoteWrite')
    const { setCurrentAccountId } = await import('./currentAccount')
    setCurrentAccountId('acct-A')
    globalThis.indexedDB = { open: () => { throw new Error('injected') } }
    const connect = vi.fn(async () => { throw new Error('reached') })
    latchNotebookFlags(ON)

    await settleNoteWrite('n1', { updatedAt: 'T1' }, 'acct-A', { connect })
    expect(connect).toHaveBeenCalled()
    setCurrentAccountId(null)
  })
})

describe('⛔ K merges DARK — with nothing set, nothing changes', () => {
  it('no payload key, no variable ⇒ offlineEnabled() is exactly what it was before K', () => {
    // ⭐ THE PROPERTY THAT MAKES K SAFE TO MERGE. Every member whose backend has
    // not been given the variable reads the compile-time constant, which is the
    // pre-K behaviour byte for byte.
    latchNotebookFlags({ plan: 'pro' })
    expect(offlineEnabled()).toBe(OFFLINE_DEFAULT_ON)
  })
})
