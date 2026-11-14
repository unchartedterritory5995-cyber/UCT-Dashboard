/**
 * Final fix pass, item 1 — a note the list's drain just sent or settled must not reopen from the
 * cached read taken before those words.
 *
 * ⚰️ Found by the controller's browser run: type while the save cannot land, Back to the list, the
 * drain sends the words (or proves the server holds them), reopen the note in the same visit. The
 * editor mounted from the SWR entry `/api/j2/notes/<id>` nobody refreshed, showed the old text
 * labelled "Saved", and the next keystroke's PUT carried the stale base, 409'd, and forked.
 *
 * The drain's decisions are not under test here (`outboxDrain.js` is mocked to hand back fixed
 * results); what is under test is the carrier: which results drop the note's cached read, which do
 * not, and that a failing drop never changes what `drainNow` returns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useSWR, { mutate as globalMutate } from 'swr'
import { createFakeDb, installKeyRange } from './__fixtures__/fakeIndexedDb'
import { useOutboxDrain } from './useOutboxDrain'
import { LEADER } from './outboxLeader'
import { OFFLINE_FLAG_KEY } from './offlineFlag'
import { FORKED, KEPT, SENT, SKIPPED, SUPERSEDED, drainOutbox, summarize } from './outboxDrain'
import { noteReadKey } from '../noteReadKey'

vi.mock('./outboxDrain', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, drainOutbox: vi.fn() }
})
vi.mock('../notebookTelemetry', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, trackNotebookEvent: vi.fn() }
})

let db

function installLocks() {
  const held = new Set()
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (name, opts, cb) => {
        if (opts?.ifAvailable) {
          if (held.has(name)) return cb(null)
          held.add(name)
          return cb({ name })
        }
        return new Promise(() => {})
      },
    },
  })
}

beforeEach(() => {
  localStorage.setItem(OFFLINE_FLAG_KEY, '1')
  installKeyRange()
  db = createFakeDb()
  globalThis.indexedDB = { open: () => { throw new Error('injected in tests') } }
  installLocks()
})
afterEach(() => {
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined })
  delete globalThis.indexedDB
  vi.clearAllMocks()
})

const r = (noteId, outcome, extra = {}) => ({ mutationId: `note:${noteId}`, noteId, outcome, ...extra })

function mount(extra = {}, initialProps = { excludeNoteId: null }) {
  return renderHook(({ excludeNoteId }) => useOutboxDrain({
    accountId: 'acct1', connect: async () => db, send: vi.fn(), fork: vi.fn(), intervalMs: 100000,
    excludeNoteId, ...extra,
  }), { initialProps })
}

/** Every key `mutate` was asked to drop, in call order. */
const dropped = (mutate) => mutate.mock.calls.map((c) => c[0])

describe('⭐ final fix pass, item 1 — the drain drops a drained note’s cached read', () => {
  it('SENT for A clears A’s key; SKIPPED for B leaves B’s key alone', async () => {
    drainOutbox.mockResolvedValue([r('A', SENT), r('B', SKIPPED)])
    const mutate = vi.fn(async () => undefined)
    const { result } = mount({ mutate })
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(mutate).toHaveBeenCalledWith(noteReadKey('A'), undefined, { revalidate: true })
    expect(dropped(mutate)).not.toContain(noteReadKey('B'))
    // The key is the one useJ2Note reads, built in one place.
    expect(noteReadKey('A')).toBe('/api/j2/notes/A')
  })

  it('a settled (SUPERSEDED) result and a FORKED result clear too; KEPT and a forked COPY do not', async () => {
    drainOutbox.mockResolvedValue([
      r('S', SUPERSEDED), r('F', FORKED), r('K', KEPT), r('C', FORKED, { copy: true }),
    ])
    const mutate = vi.fn(async () => undefined)
    const { result } = mount({ mutate })
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    const keys = dropped(mutate)
    expect(keys).toContain(noteReadKey('S'))
    expect(keys).toContain(noteReadKey('F'))
    expect(keys).not.toContain(noteReadKey('K'))
    expect(keys).not.toContain(noteReadKey('C'))
  })

  it('a mutate that throws, or rejects, does not change what drainNow returns', async () => {
    const results = [r('A', SENT), r('B', SKIPPED)]
    drainOutbox.mockResolvedValue(results)
    const runWith = async (mutate) => {
      installLocks()     // a fresh lock manager per mount: this fake never hands the lock back
      const { result, unmount } = mount({ mutate })
      await waitFor(() => expect(result.current.role).toBe(LEADER))
      await waitFor(() => expect(drainOutbox).toHaveBeenCalled())
      // Let the mount's own drains finish (single flight), then ask once more.
      let s = null
      await waitFor(async () => {
        await act(async () => { s = await result.current.drainNow() })
        expect(s).not.toBeNull()
      })
      unmount()
      return s
    }
    const control = await runWith(vi.fn(async () => undefined))
    expect(control).toEqual(summarize(results))
    const throwing = vi.fn(() => { throw new Error('cache gone') })
    expect(await runWith(throwing)).toEqual(control)
    expect(throwing).toHaveBeenCalled()
    const rejecting = vi.fn(() => Promise.reject(new Error('revalidate failed')))
    expect(await runWith(rejecting)).toEqual(control)
    expect(rejecting).toHaveBeenCalled()
  })

  it('never drops the note this tab opened while the drain was running', async () => {
    let release
    const gate = new Promise((res) => { release = res })
    drainOutbox.mockImplementation(async () => { await gate; return [r('A', SENT), r('C', SENT)] })
    const mutate = vi.fn(async () => undefined)
    const { result, rerender } = mount({ mutate })
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await waitFor(() => expect(drainOutbox).toHaveBeenCalled())
    // The member opens A in this tab while the send is on the wire.
    rerender({ excludeNoteId: 'A' })
    await act(async () => { release() })
    await waitFor(() => expect(dropped(mutate)).toContain(noteReadKey('C')))
    expect(dropped(mutate)).not.toContain(noteReadKey('A'))
  })

  it('with SWR’s own global mutate, a reopen after the drain loads the server copy, not the cached one', async () => {
    const id = `real-${Math.random().toString(36).slice(2)}`
    const key = noteReadKey(id)
    // The read the editor cached before the member's words went out.
    await globalMutate(key, { note: { id, body: 'before the words' } }, { revalidate: false })
    drainOutbox.mockResolvedValue([r(id, SENT)])
    const { result } = mount()
    await waitFor(() => expect(result.current.role).toBe(LEADER))
    await waitFor(() => expect(result.current.lastSummary).not.toBeNull())
    // The reopen: the same key, mounted again.
    const fetcher = vi.fn(async () => ({ note: { id, body: 'with the words' } }))
    const reopen = renderHook(() => useSWR(key, fetcher))
    expect(reopen.result.current.data?.note?.body).not.toBe('before the words')
    await waitFor(() => expect(reopen.result.current.data?.note?.body).toBe('with the words'))
    expect(fetcher).toHaveBeenCalled()
  })
})
