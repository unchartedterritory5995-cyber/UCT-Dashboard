import { describe, it, expect, beforeEach } from 'vitest'
import { memGet, memPeek, memHas, memPut, memClear, MEM_CACHE_MAX } from './barsMemCache'

const bars = (n, base = 1) =>
  Array.from({ length: n }, (_, i) => ({ t: base + i, o: 1, h: 2, l: 0, c: 1, v: 10 }))

describe('barsMemCache', () => {
  beforeEach(() => memClear())

  it('put then get returns the same bars', () => {
    const b = bars(3)
    memPut('AAPL', 'D', b)
    expect(memGet('AAPL', 'D')).toBe(b)
    expect(memHas('AAPL', 'D')).toBe(true)
  })

  it('normalizes symbol case', () => {
    const b = bars(2)
    memPut('aapl', '30', b)
    expect(memGet('AAPL', '30')).toBe(b)
    expect(memHas('Aapl', '30')).toBe(true)
  })

  it('is a no-op for empty/missing input', () => {
    memPut('AAPL', 'D', [])
    expect(memHas('AAPL', 'D')).toBe(false)
    expect(memGet(null, 'D')).toBeNull()
    expect(memGet('AAPL', null)).toBeNull()
    expect(memHas('', 'D')).toBe(false)
  })

  it('evicts the least-recently-used entry past the cap', () => {
    for (let i = 0; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    expect(memHas('T0', 'D')).toBe(true)
    memPut('OVER', 'D', bars(1, 999)) // one past cap → evicts oldest (T0)
    expect(memHas('T0', 'D')).toBe(false)
    expect(memHas('OVER', 'D')).toBe(true)
    expect(memHas('T1', 'D')).toBe(true)
  })

  it('promotes an entry to most-recently-used on get (survives eviction)', () => {
    for (let i = 0; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    memGet('T0', 'D')                  // touch oldest → now MRU
    memPut('OVER', 'D', bars(1, 999))  // evicts the NEW oldest (T1), not T0
    expect(memHas('T0', 'D')).toBe(true)
    expect(memHas('T1', 'D')).toBe(false)
  })

  it('memPeek returns bars WITHOUT reordering (safe to call during render)', () => {
    const first = bars(1, 0)
    memPut('T0', 'D', first)
    for (let i = 1; i < MEM_CACHE_MAX; i++) memPut(`T${i}`, 'D', bars(1, i))
    expect(memPeek('T0', 'D')).toBe(first)             // returns the stored array
    memPut('OVER', 'D', bars(1, 999)) // peek did NOT promote T0 → T0 still oldest → evicted
    expect(memHas('T0', 'D')).toBe(false)
    expect(memPeek('NOPE', 'D')).toBeNull()
  })
})
