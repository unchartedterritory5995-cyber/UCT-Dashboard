// The rows around a list's selection stay in the store's memory while they are neighbors
// (2026-11-17). Flip proof: a list warm of ~100 rows x (chart tf + daily) filled the registry's
// LRU and evicted the next rows before the member reached them; the flip re-read them from
// IndexedDB and lost the race to its own request (60m UVXY 109 ms vs ~35 ms for held rows).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear() })

async function boot(maxKeys) {
  installFakeBarsServer()
  const { createRegistry } = await import('./registry')
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const registry = createRegistry({ maxKeys })
  const store = createBarStore({
    registry, stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { registry, pf: createPrefetch({ store, tickerMeta: () => {} }) }
}

// A hydrate pins its key while it reads (prefetch._hydrate); let those reads finish so only the
// HOLD can be what keeps a row in memory.
const settle = () => new Promise((r) => setTimeout(r, 30))

function churn(registry, pf, syms) {
  for (const s of syms) { const k = pf.keyFor(s, '5'); registry.acquire(k); registry.release(k) }
}

describe('a neighbor hold pins the rows around the selection', () => {
  it('held rows survive LRU pressure that evicts every unheld row', async () => {
    const { registry, pf } = await boot(3)
    const hold = pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5')
    await settle()
    churn(registry, pf, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    expect(registry.peek(pf.keyFor('AAA', '5'))).toBeTruthy()
    expect(registry.peek(pf.keyFor('BBB', '5'))).toBeTruthy()
    expect(registry.peek(pf.keyFor('C1', '5'))).toBeFalsy()          // CONTROL: unheld is evicted
  })

  it('moving the window releases the rows that left it', async () => {
    const { registry, pf } = await boot(3)
    const hold = pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5')
    hold.set(['BBB', 'CCC'], '5')                                      // AAA left the window
    await settle()
    churn(registry, pf, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    expect(registry.peek(pf.keyFor('AAA', '5'))).toBeFalsy()
    expect(registry.peek(pf.keyFor('BBB', '5'))).toBeTruthy()
    expect(registry.peek(pf.keyFor('CCC', '5'))).toBeTruthy()
  })

  it('clear lets every held row go (a list that unmounts holds nothing)', async () => {
    const { registry, pf } = await boot(3)
    const hold = pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5')
    hold.clear()
    await settle()
    churn(registry, pf, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    expect(registry.peek(pf.keyFor('AAA', '5'))).toBeFalsy()
    expect(registry.peek(pf.keyFor('BBB', '5'))).toBeFalsy()
  })

  it('two holds (two lists on a board) never release each other\'s rows', async () => {
    const { registry, pf } = await boot(3)
    const a = pf.createNeighborHold()
    const b = pf.createNeighborHold()
    a.set(['AAA'], '5')
    b.set(['AAA', 'BBB'], '5')
    b.clear()
    await settle()
    churn(registry, pf, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
    expect(registry.peek(pf.keyFor('AAA', '5'))).toBeTruthy()          // still held by `a`
  })
})
