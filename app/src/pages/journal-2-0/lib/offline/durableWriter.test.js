/**
 * Wave Q1 — the coalescing, order-safe durable writer.
 *
 * ⛔ These rails exist because the MEASUREMENT said they had to. Chrome 152, a
 * 48 KB note, warm path: IndexedDB p50 282.6 ms / p95 800.7 ms against
 * localStorage's p50 1.0 ms. A per-keystroke durable write would queue faster
 * than it commits, so the writer coalesces — and once it coalesces, ORDER stops
 * being something the browser gives you for free.
 */
import { describe, it, expect, vi } from 'vitest'
import { createDurableWriter, PENDING, WRITING, DURABLE, FAILED } from './durableWriter'

/** A controllable persist: every call is resolvable by hand, in any order. */
function controllablePersist() {
  const calls = []
  const persist = vi.fn((job) => new Promise((resolve, reject) => {
    calls.push({ job, resolve, reject })
  }))
  return { persist, calls }
}

/** A timer we drive, so nothing here depends on wall-clock luck. */
function manualTimers() {
  let pending = null
  return {
    setTimer: (fn) => { pending = fn; return 1 },
    clearTimer: () => { pending = null },
    fire: () => { const f = pending; pending = null; if (f) f() },
    armed: () => pending !== null,
  }
}

describe('it does not write once per keystroke', () => {
  it('collapses a burst of edits into ONE durable write of the newest state', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })

    for (const text of ['a', 'ab', 'abc', 'abcd']) w.schedule({ text })
    expect(persist).not.toHaveBeenCalled()   // nothing durable yet — correctly

    t.fire()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(calls[0].job.state).toEqual({ text: 'abcd' })
  })

  it('says PENDING, not durable, while the window is still open', () => {
    const { persist } = controllablePersist()
    const t = manualTimers()
    const seen = []
    const w = createDurableWriter({ persist, ...t, onStatus: (s) => seen.push(s) })
    w.schedule({ text: 'a' })
    // ⛔ §13 — never claim "Saved on this device" before the write commits.
    expect(seen).toEqual([PENDING])
    expect(w.isDurable()).toBe(false)
  })

  it('reaches DURABLE only after the write actually commits', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const seen = []
    const w = createDurableWriter({ persist, ...t, onStatus: (s) => seen.push(s) })
    w.schedule({ text: 'a' })
    t.fire()
    expect(seen).toEqual([PENDING, WRITING])
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(seen).toEqual([PENDING, WRITING, DURABLE])
    expect(w.isDurable()).toBe(true)
  })
})

describe('edits during a write are coalesced, not replayed', () => {
  it('writes exactly ONE follow-up carrying the newest state', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'one' })
    t.fire()                                   // write 1 in flight
    w.schedule({ text: 'two' })
    w.schedule({ text: 'three' })
    w.schedule({ text: 'four' })
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    // ⛔ Not four writes, and not the intermediate snapshots — one follow-up
    // for the latest state. The durable goal is the member's newest work.
    expect(persist).toHaveBeenCalledTimes(2)
    expect(calls[1].job.state).toEqual({ text: 'four' })
  })
})

describe('⛔ a late completion can never overwrite newer work (§9)', () => {
  it('write A completing AFTER B still leaves B as the committed state', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'A' })
    t.fire()
    const genA = w.latestGeneration()
    w.schedule({ text: 'B' })                  // B becomes desired while A is in flight

    calls[0].resolve()                          // A completes
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls[1].job.state).toEqual({ text: 'B' })
    const genB = calls[1].job.generation
    expect(genB).toBeGreaterThan(genA)

    calls[1].resolve()                          // B completes
    await Promise.resolve(); await Promise.resolve()
    expect(w.committedGeneration()).toBe(genB)
    expect(w.isDurable()).toBe(true)
  })

  it('a stale resolution cannot drag the committed generation backwards', async () => {
    // ⭐ The property stated directly: `committed` is a max(), so even a persist
    // implementation that resolved out of order could not mark older work as
    // the newest durable state. Browser transaction timing is not an
    // application-intent guarantee.
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'A' }); t.fire()
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve()
    const after = w.committedGeneration()
    calls[0].resolve()                          // resolve the SAME old job again
    await Promise.resolve(); await Promise.resolve()
    expect(w.committedGeneration()).toBe(after)
  })
})

describe('⛔ a failed write is FAILED, and the intent is not thrown away (§14)', () => {
  it('reports FAILED and keeps the snapshot for a later attempt', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const seen = []
    const w = createDurableWriter({ persist, ...t, onStatus: (s) => seen.push(s) })
    w.schedule({ text: 'work' })
    t.fire()
    calls[0].reject(new Error('QuotaExceededError'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    expect(seen).toContain(FAILED)
    // ⛔ NOT durable — the caller must not show "Saved on this device".
    expect(w.isDurable()).toBe(false)
    // And the work is still queued: flushing tries it again rather than losing it.
    w.flush()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(calls[1].job.state).toEqual({ text: 'work' })
  })
})

describe('flush is acceleration, never the durability mechanism (§10)', () => {
  it('writes immediately and disarms the pending window', () => {
    const { persist } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'x' })
    expect(t.armed()).toBe(true)
    w.flush()
    expect(t.armed()).toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('a destroyed writer stops scheduling — a closing tab cannot start new work', () => {
    const { persist } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.destroy()
    expect(w.schedule({ text: 'x' })).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })
})
