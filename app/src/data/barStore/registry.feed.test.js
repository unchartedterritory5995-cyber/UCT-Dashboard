// registry.feed: the minute feed's door into the registry (minuteFeed.js). Unlike dispatch it never CREATES an entry
// and never marks one USED: a feed that touched every held 1m key once a minute would re-rank them all ahead of the
// keys the member last looked at, and the LRU would evict those first.
//   R1 a key nobody holds: null, and still not held        R2 a held key: the action applies, subscribers hear it
//   R3 the LRU order is unchanged by feed                   R4 the control: dispatch DOES re-rank (so R3 can fail)
//   R5 the bar count stays exact (the budget is kept)
import { describe, it, expect, vi } from 'vitest'
import { createRegistry } from './registry'
import { ACTION, keyOf } from './types'

const T0 = Date.UTC(2026, 10, 10, 14, 30) / 1000                 // Tue 2026-11-10 09:30 ET
const NOW = (T0 + 6 * 60 + 20) * 1000
const bar = (n) => ({ t: T0 + 60 * n, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
const full = () => ({ type: ACTION.REST_FULL, payload: { bars: [0, 1, 2, 3, 4, 5].map(bar) } })
const final6 = (sym) => ({ type: ACTION.PUSH_FINAL, event: { sym, tf: '1', ...bar(6), rev: null } })
const k = (s) => keyOf({ sym: s, tf: '1' })
const reg = (o = {}) => createRegistry({ ctx: () => ({ nowMs: NOW }), ...o })

describe('registry.feed', () => {
  it('R1 a key nobody holds: null, and it is still not held', () => {
    const r = reg()
    expect(r.feed(k('AAA'), final6('AAA'))).toBe(null)
    expect(r.has(k('AAA'))).toBe(false)
    expect(r.stats()).toEqual({ keys: 0, bars: 0, dwell: 0 })   // dwell: #2695 (29aadb5327) added the count
  })

  it('R2 a held key: the action applies and its subscribers hear it', () => {
    const r = reg()
    r.dispatch(k('AAA'), full())
    const cb = vi.fn()
    r.subscribe(k('AAA'), cb, { wake: 'base' })
    const s = r.feed(k('AAA'), final6('AAA'))
    expect(s.bars[s.bars.length - 1]).toMatchObject({ t: T0 + 360, src: 'final' })
    expect(r.peek(k('AAA'))).toBe(s)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenLastCalledWith(s)
  })

  it('R3 the LRU order is unchanged by feed: the fed key is still the first to go', () => {
    const r = reg({ maxKeys: 3 })
    for (const s of ['AAA', 'BBB', 'CCC']) r.dispatch(k(s), full())
    r.feed(k('AAA'), final6('AAA'))                             // the oldest entry is fed
    r.dispatch(k('DDD'), full())                                // one over: the least recently USED goes
    expect(r.has(k('AAA'))).toBe(false)
    expect(r.has(k('BBB'))).toBe(true)
  })

  it('R4 the control: dispatch re-ranks, so the same sequence evicts another key', () => {
    const r = reg({ maxKeys: 3 })
    for (const s of ['AAA', 'BBB', 'CCC']) r.dispatch(k(s), full())
    r.dispatch(k('AAA'), final6('AAA'))
    r.dispatch(k('DDD'), full())
    expect(r.has(k('AAA'))).toBe(true)
    expect(r.has(k('BBB'))).toBe(false)
  })

  it('R5 the bar count stays exact', () => {
    const r = reg()
    r.dispatch(k('AAA'), full())
    expect(r.stats().bars).toBe(6)
    r.feed(k('AAA'), final6('AAA'))
    expect(r.stats().bars).toBe(7)
    r.feed(k('AAA'), final6('AAA'))                             // the same bar again: nothing changes
    expect(r.stats().bars).toBe(7)
  })
})
