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

  it('the committed generation only ever moves FORWARD across a run of writes', async () => {
    // ⚰️ WHAT THIS DOES AND DOES NOT PROVE, because the first version of this
    // rail was vacuous. It resolved the same job's promise twice and asserted
    // the number had not moved — but a settled promise ignores a second
    // resolve, so `persist`'s await never re-fired and the assertion held for
    // ANY implementation. Mutating `Math.max(committed, gen)` to a plain
    // assignment left it green.
    //
    // The writer keeps exactly ONE write in flight and awaits it, so genuinely
    // out-of-order completions cannot be produced through this API at all: the
    // ordering is enforced by SERIALISATION, and the `Math.max` behind it is
    // belt-and-braces for a persist implementation that someday resolves early.
    // What is observable — and what this asserts — is that a sequence of writes
    // leaves `committed` monotonically increasing and equal to the newest
    // scheduled generation.
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    const seen = []

    for (const text of ['A', 'B', 'C']) {
      w.schedule({ text })
      t.fire()
      // eslint-disable-next-line no-await-in-loop
      calls[calls.length - 1].resolve()
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      seen.push(w.committedGeneration())
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(new Set(seen).size).toBe(seen.length)      // strictly increasing
    expect(w.committedGeneration()).toBe(w.latestGeneration())
    expect(w.isDurable()).toBe(true)
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

/**
 * ⭐⭐ D3b (wave 6) — A FLUSH PERSISTS THE LATEST SNAPSHOT *AS OF THE FLUSH*, EVEN
 * BEHIND A WRITE ALREADY IN FLIGHT (wave5-A fix round 2, residual R1).
 *
 * The owner's refused-fork fallback flushes the member's words typed during the
 * fork, then swaps the view to the server copy. With a durable write already in
 * flight, the flush used to wait behind it and leave the words as `desired` —
 * and the member's next keystroke on the new view, a `schedule`, REPLACED them
 * before they were ever written.
 */
describe('⭐⭐ D3b — a flush behind an in-flight write is never superseded', () => {
  const flushed = () => ({ text: 'record + K (typed during the fork)' })
  const later = () => ({ text: 'server copy + K2 (typed on the new view)' })

  it('⛔⛔ a snapshot flushed during an in-flight write is written after it, BEFORE a later keystroke’s', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'record' })
    t.fire()                                     // write 1 in flight
    w.schedule(flushed())                        // a keystroke queued behind it
    w.flush()                                    // the fork fallback's flush
    w.schedule(later())                          // setContent(fresh), then a keystroke
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls[1]?.job.state, 'the flushed snapshot was superseded before it was written').toEqual(flushed())
    calls[1].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    // …and the newest state still follows it, once, as the coalesced latest.
    expect(calls[2]?.job.state).toEqual(later())
    expect(persist).toHaveBeenCalledTimes(3)
    calls[2].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(w.isDurable()).toBe(true)
    expect(w.committedGeneration()).toBe(w.latestGeneration())
  })

  it('⭐ generations stay in order: in-flight < flushed < later', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'record' }); t.fire()
    w.schedule(flushed()); w.flush(); w.schedule(later())
    for (let i = 0; i < 3; i += 1) {
      calls[i].resolve()
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    }
    const gens = calls.map((c) => c.job.generation)
    expect(gens).toEqual([...gens].sort((a, b) => a - b))
    expect(new Set(gens).size).toBe(3)
  })

  it('⭐ NOT pinned when nothing is in flight — flush writes at once, exactly as before', () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule(flushed())
    w.flush()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(calls[0].job.state).toEqual(flushed())
  })

  it('⭐ WITHOUT a flush, edits during a write still coalesce to ONE follow-up (unchanged)', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'record' }); t.fire()
    w.schedule(flushed())
    w.schedule(later())
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(persist).toHaveBeenCalledTimes(2)
    expect(calls[1].job.state).toEqual(later())
  })

  it('⛔ a flushed snapshot whose write FAILS is kept and retried first — never dropped for a newer one', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const seen = []
    const w = createDurableWriter({ persist, ...t, onStatus: (s) => seen.push(s) })
    w.schedule({ text: 'record' }); t.fire()
    w.schedule(flushed()); w.flush(); w.schedule(later())
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    calls[1].reject(new Error('QuotaExceededError'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(seen).toContain(FAILED)
    expect(w.isDurable()).toBe(false)
    w.flush()
    expect(calls[2].job.state, 'the failed flushed snapshot was not retried first').toEqual(flushed())
  })

  it('⭐ the unmount flush (flush, then destroy) still writes its snapshot after an in-flight write', async () => {
    const { persist, calls } = controllablePersist()
    const t = manualTimers()
    const w = createDurableWriter({ persist, ...t })
    w.schedule({ text: 'record' }); t.fire()
    w.schedule(flushed())
    w.flush()
    w.destroy()
    calls[0].resolve()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls[1]?.job.state, 'the last keystrokes before navigating away were dropped').toEqual(flushed())
    expect(w.schedule(later())).toBeNull()       // …and still nothing NEW after destroy
  })
})
