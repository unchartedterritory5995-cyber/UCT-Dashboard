import { describe, it, expect, vi } from 'vitest'
import { createRafCoalescer } from './liveCoalesce'

// A manual scheduler: mark() enqueues a flush; we fire it explicitly via tick().
function manualSchedule() {
  let queued = null
  return {
    schedule: (cb) => { queued = cb; return 1 },
    cancel: () => { queued = null },
    tick: () => { const f = queued; queued = null; if (f) f() },
    hasQueued: () => queued != null,
  }
}

describe('createRafCoalescer', () => {
  it('coalesces many marks in a frame into ONE flush per key', () => {
    const s = manualSchedule()
    const flush = vi.fn()
    const c = createRafCoalescer(flush, { schedule: s.schedule, cancel: s.cancel })
    c.mark('AAPL'); c.mark('AAPL'); c.mark('AAPL')
    expect(flush).not.toHaveBeenCalled() // nothing until the frame fires
    s.tick()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('AAPL')
  })

  it('flushes each distinct key once per frame', () => {
    const s = manualSchedule()
    const flush = vi.fn()
    const c = createRafCoalescer(flush, { schedule: s.schedule, cancel: s.cancel })
    c.mark('AAPL'); c.mark('MSFT'); c.mark('AAPL')
    s.tick()
    expect(flush).toHaveBeenCalledTimes(2)
    expect(flush.mock.calls.map(a => a[0]).sort()).toEqual(['AAPL', 'MSFT'])
  })

  it('schedules only one frame per batch, then re-arms on the next mark', () => {
    const s = manualSchedule()
    const sched = vi.fn(s.schedule)
    const c = createRafCoalescer(vi.fn(), { schedule: sched, cancel: s.cancel })
    c.mark('A'); c.mark('B')
    expect(sched).toHaveBeenCalledTimes(1) // one frame for the whole batch
    s.tick()
    c.mark('C')
    expect(sched).toHaveBeenCalledTimes(2) // next mark arms a fresh frame
  })

  it('clears dirty before running flushFn so re-entrant marks schedule a NEW frame', () => {
    const s = manualSchedule()
    let reentered = false
    const c = createRafCoalescer((key) => {
      if (key === 'A' && !reentered) { reentered = true; c.mark('A') } // re-mark during flush
    }, { schedule: s.schedule, cancel: s.cancel })
    c.mark('A')
    s.tick()
    // The re-mark during flush must have queued a fresh frame, not been swallowed.
    expect(s.hasQueued()).toBe(true)
    expect(c.pending()).toBe(1)
  })

  it('flushNow runs the pending batch immediately and cancels the frame', () => {
    const s = manualSchedule()
    const flush = vi.fn()
    const c = createRafCoalescer(flush, { schedule: s.schedule, cancel: s.cancel })
    c.mark('X')
    c.flushNow()
    expect(flush).toHaveBeenCalledWith('X')
    expect(s.hasQueued()).toBe(false) // frame was cancelled
    c.flushNow() // no-op when nothing pending
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('cancel drops pending work without running it', () => {
    const s = manualSchedule()
    const flush = vi.fn()
    const c = createRafCoalescer(flush, { schedule: s.schedule, cancel: s.cancel })
    c.mark('X'); c.mark('Y')
    c.cancel()
    expect(c.pending()).toBe(0)
    s.tick() // even if a stale frame fired, nothing to flush
    expect(flush).not.toHaveBeenCalled()
  })

  it('a throwing subscriber does not kill the rest of the batch', () => {
    const s = manualSchedule()
    const flush = vi.fn((k) => { if (k === 'BAD') throw new Error('boom') })
    const c = createRafCoalescer(flush, { schedule: s.schedule, cancel: s.cancel })
    c.mark('BAD'); c.mark('GOOD')
    expect(() => s.tick()).not.toThrow()
    expect(flush.mock.calls.map(a => a[0]).sort()).toEqual(['BAD', 'GOOD'])
  })

  it('falls back to a real scheduler (setTimeout in jsdom) with no injected schedule', async () => {
    const flush = vi.fn()
    const c = createRafCoalescer(flush) // no opts → rAF/setTimeout fallback
    c.mark('Z')
    expect(flush).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 20)) // let the fallback frame fire
    expect(flush).toHaveBeenCalledWith('Z')
  })

  it('throws if flushFn is not a function', () => {
    expect(() => createRafCoalescer(null)).toThrow()
  })
})
