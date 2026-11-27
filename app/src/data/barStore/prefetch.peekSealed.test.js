// peekSealedBars: the board's warm admission asks it whether a chart may be mounted at once on a member's switch
// (ChartsWorkspace, useStaggeredMount `admitNowFor`). "Warm" means nothing is left for the chart's mount to fetch but
// freshness: the chart's own window ANSWERED by the server in this life, and no deep or lake load still due.
//   P1 (red first, review G4) rows from the universe pack or a saved copy alone (no answer in this life) are not warm: a
//      daily board of such charts would run N deep loads outside the limit, the herd the stagger exists for
//   P2 an answered key whose deep history (D/W/M) or lake depth (intraday) is still due is not warm
//   P3 an answered key with nothing due is warm; a developing bar alone never is
//   P4 it never hydrates (the board asks during its render): an unseen key is simply not warm
import { describe, it, expect } from 'vitest'
import { createPrefetch } from './prefetch'

function stubStore() {
  const held = new Map()
  const answered = new Set()
  const deepDue = new Set()
  const lakeDue = new Set()
  let hydrations = 0
  return {
    held, answered, deepDue, lakeDue, hydrations: () => hydrations,
    peek: (key) => held.get(key) ?? null,
    network: { answered: (key) => answered.has(key) },
    deepPending: (key) => deepDue.has(key),
    lakePending: (key) => lakeDue.has(key),
    persist: { hydrate: () => { hydrations++; return Promise.resolve(null) } },
  }
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 86400 }))

describe('prefetch.peekSealedBars', () => {
  it('P1 (red first) pack or saved rows alone, with no answer in this life, are not warm', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', 'D')
    store.held.set(key, { bars: rows(240), developing: null, restSeen: false })   // the universe pack's shallow rows
    expect(pf.peekSealedBars('AAA', 'D'), 'pack rows read as warm').toBe(false)
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: true })   // a copy answered in an earlier life
    expect(pf.peekSealedBars('AAA', 'D'), 'an earlier life\'s answer read as warm').toBe(false)
  })

  it('P2 answered, but its deep history or lake depth still due: not warm', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const d = pf.keyFor('AAA', 'D')
    store.held.set(d, { bars: rows(1150), developing: null, restSeen: true })
    store.answered.add(d)
    store.deepDue.add(d)
    expect(pf.peekSealedBars('AAA', 'D')).toBe(false)
    const m5 = pf.keyFor('AAA', '5', { showExtended: false })
    store.held.set(m5, { bars: rows(1150), developing: null, restSeen: true })
    store.answered.add(m5)
    store.lakeDue.add(m5)
    expect(pf.peekSealedBars('AAA', '5', { showExtended: false })).toBe(false)
  })

  it('P3 answered with nothing due: warm; a developing bar alone: never', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', 'D')
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: true })
    store.answered.add(key)
    expect(pf.peekSealedBars('AAA', 'D')).toBe(true)
    store.held.set(key, { bars: [], developing: { t: 1 }, restSeen: true })
    expect(pf.peekSealedBars('AAA', 'D')).toBe(false)
  })

  it('P4 an unseen key is not warm, and nothing is hydrated', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    expect(pf.peekSealedBars('ZZZ', 'D')).toBe(false)
    expect(store.hydrations()).toBe(0)
  })
})
