/**
 * Wave Q1 — who is allowed to spend the outbox.
 *
 * ⛔ The property under test is a REFUSAL. A follower that "tries anyway" and a
 * follower that waits look identical in a screenshot and differ only when two
 * tabs reconnect at once — which is precisely the case nobody reproduces on
 * purpose. So the rails assert that nothing was sent, and each one carries a
 * control showing the same setup DOES send when the tab leads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createFakeDb, settleIdb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { putNoteWithIntent, listOutbox, getNote } from './notebookDb'
import { useOutboxDrain } from './useOutboxDrain'
import { LEADER, FOLLOWER, READ_ONLY_FOR_SYNC } from './outboxLeader'
import { OFFLINE_FLAG_KEY } from './offlineFlag'

const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })

let db
let held

/** One real lock per name, the shape `claimSyncLeadership` actually calls. */
function installLocks({ alreadyHeld = false } = {}) {
  held = new Set(alreadyHeld ? ['uct.nb.sync.acct1'] : [])
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (name, opts, cb) => {
        if (opts?.ifAvailable) {
          if (held.has(name)) return cb(null)
          held.add(name)
          return cb({ name })          // held for the life of the returned promise
        }
        return new Promise(() => {})   // queued behind the holder — never resolves here
      },
    },
  })
}
function removeLocks() {
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
}

beforeEach(async () => {
  // ⛔ Wave Q1 ships DARK: the offline layer is off until the §32 browser
  // matrix is reported. These rails opt this browser in, the same way
  // certification does.
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
  await putNoteWithIntent(db, {
    noteId: 'n1', title: 'queued', subtitle: '', bodyJson: doc('written offline'),
    baseUpdatedAt: 'T1', generation: 2, sessionId: 's1', localSavedAt: 5, dirty: 1,
  }, {
    mutationId: 'note:n1', noteId: 'n1', kind: 'note-update',
    patch: { title: 'queued', subtitle: '', bodyJson: doc('written offline') },
    baseUpdatedAt: 'T1', generation: 2, queuedAt: 5,
  })
})
afterEach(() => {
  removeLocks()
  delete globalThis.indexedDB
  vi.clearAllMocks()
})

function mount({ send, ...extra } = {}) {
  const connect = vi.fn(async () => db)
  return renderHook(() => useOutboxDrain({
    accountId: 'acct1', connect, send, fork: vi.fn(), intervalMs: 100000, ...extra,
  }))
}

describe('⭐ the control: a leader drains', () => {
  it('sends the queued work on mount', async () => {
    installLocks()
    const send = vi.fn(async () => ({ updatedAt: 'T2' }))
    const { result } = mount({ send })
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await act(async () => { await settleIdb() })
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0].noteId).toBe('n1')
    await waitFor(() => expect(result.current.pending).toBe(0))
  })
})

describe('⛔ and nobody else does', () => {
  it('a FOLLOWER sends nothing — another tab already leads', async () => {
    installLocks({ alreadyHeld: true })
    const send = vi.fn(async () => ({ updatedAt: 'T2' }))
    const { result } = mount({ send })
    await waitFor(() => expect(result.current.role).toBe(FOLLOWER))
    await act(async () => { await settleIdb() })
    expect(send).not.toHaveBeenCalled()
    // The work is still there, waiting for whoever leads — not lost, not raced.
    await waitFor(() => expect(result.current.pending).toBe(1))
  })

  it('without Web Locks the tab is READ-ONLY FOR SYNC and sends nothing', async () => {
    removeLocks()
    const send = vi.fn(async () => ({ updatedAt: 'T2' }))
    const { result } = mount({ send })
    await waitFor(() => expect(result.current.role).toBe(READ_ONLY_FOR_SYNC))
    await act(async () => { await settleIdb() })
    expect(send).not.toHaveBeenCalled()
    // ⛔ Degrading to "everyone tries" would reintroduce exactly the
    // last-write-wins this wave exists to forbid.
    expect(result.current.isLeader).toBe(false)
  })
})

describe('coming back online', () => {
  it('a leader drains again when the network returns', async () => {
    installLocks()
    let offline = true
    const send = vi.fn(async () => {
      if (offline) throw new Error('network down')
      return { updatedAt: 'T2' }
    })
    const { result } = mount({ send })
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // The failed send kept the entry.
    await waitFor(() => expect(result.current.pending).toBe(1))

    offline = false
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await settleIdb()
    })
    await waitFor(() => expect(result.current.pending).toBe(0))
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('⛔ §21 — the rollback stops PROCESSING, it does not discard work', () => {
  it('with the wave switched off the tab claims no leadership, sends nothing, and leaves the queue intact', async () => {
    // This is the emergency path: `OFFLINE_DEFAULT_ON` back to false, or one
    // browser opting out. It must never be able to mean "delete what the member
    // already wrote" — activation created real durable member state, and a
    // feature disable has no authority over it.
    installLocks()
    localStorage.setItem(OFFLINE_FLAG_KEY, '0')
    const send = vi.fn(async () => ({ updatedAt: 'T2' }))
    const { result } = mount({ send })
    await act(async () => { await settleIdb(6) })

    expect(result.current.supported).toBe(false)
    expect(result.current.isLeader).toBe(false)
    expect(send).not.toHaveBeenCalled()
    // ⛔ No lock was even claimed — a dark tab does not queue behind the leader.
    expect(held.has('uct.nb.sync.acct1')).toBe(false)
    // And the queued work is exactly where it was, ready for a re-enable.
    const left = await listOutbox(db)
    expect(left).toHaveLength(1)
    expect(left[0].patch.bodyJson).toEqual(doc('written offline'))
    expect((await getNote(db, 'n1')).dirty).toBe(1)
  })
})
