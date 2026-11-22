// heldRows: the handoff's cover rule reads how many rows the store holds for the chart's key (closed rows
// plus the developing one), never building the legacy array; with `answered`, only rows the server gave in
// this life of the key count (a saved copy alone is 0).
import { describe, it, expect } from 'vitest'
import { createPrefetch } from './prefetch'

function stubStore() {
  const held = new Map()
  const answered = new Set()
  return {
    held, answered,
    peek: (key) => held.get(key) ?? null,
    network: { answered: (key) => answered.has(key) },
  }
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 1800 }))

describe('prefetch.heldRows', () => {
  it('counts closed rows plus the developing one, for the key the chart would read', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', '30')
    store.held.set(key, { bars: rows(1120), developing: { t: 1 }, restSeen: true })
    expect(pf.heldRows('AAA', '30')).toBe(1121)
    expect(pf.heldRows('BBB', '30')).toBe(0)                    // nothing held
  })

  it('with answered: 0 for a saved copy alone, the count once the server answered in this life', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', 'D')
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: true })
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(0)  // restSeen from an earlier life, no answer now
    store.answered.add(key)
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(3000)
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: false })
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(0)  // a local copy, whatever `answered` says
    expect(pf.heldRows('AAA', 'D')).toBe(3000)                   // without the option: what is held
  })
})
