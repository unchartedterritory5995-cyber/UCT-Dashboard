/* useThesisChips: the same symbols array is prepared ONCE, not once per render.
 *
 * A Watchlist widget hands its whole list to this hook (500 symbols for the S&P 500) and re-renders three
 * times between an arrow key and the chart's pixels. The hook filtered, upper-cased, deduped and sorted the
 * list on every one of those renders and gave SWR a new array each time, which SWR then hashed entry by
 * entry (key-press CPU profile, 2026-11-20: 0.6 to 1.2 ms a switch).
 *
 * SWR is replaced by a recorder here, because the claim is about what the hook HANDS it: the same symbol
 * list OBJECT for the same input array (SWR's key hash keeps a WeakMap of arrays it has already hashed, so
 * identity is what makes a re-render free). `useThesisChips.test.js` runs the real SWR and the real request.
 */
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const seen = []   // every key the hook handed useSWR, in order
vi.mock('swr', () => ({
  default: (key) => { seen.push(key); return { data: undefined, error: undefined, isLoading: false } },
}))

const { default: useThesisChips } = await import('./useThesisChips')
const { __resetNotebookFlags, latchNotebookFlags } = await import('../lib/offline/notebookFlags')
const { THESIS_CHIPS_URL } = await import('../lib/thesisChips')

/** An array that counts how many of its entries are read. */
function counted(list) {
  const box = { reads: 0 }
  const arr = new Proxy(list, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) box.reads += 1
      return Reflect.get(target, prop, receiver)
    },
  })
  return { arr, box }
}

beforeEach(() => {
  seen.length = 0
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_thesis_chips_enabled: true })
})
afterEach(() => { __resetNotebookFlags() })

describe('useThesisChips: one preparation per symbols array', () => {
  it('re-rendering with the SAME array reads none of it again and hands SWR the same list object', () => {
    const { arr, box } = counted(['nvda', 'AAPL', 'nvda', '', 'msft', null, 'Aapl'])
    const { rerender } = renderHook(({ syms }) => useThesisChips(syms), { initialProps: { syms: arr } })
    const first = seen[seen.length - 1]
    expect(first).toEqual([THESIS_CHIPS_URL, ['AAPL', 'MSFT', 'NVDA']])   // deduped, upper-cased, sorted, blanks dropped
    const readsAfterFirst = box.reads
    expect(readsAfterFirst).toBeGreaterThan(0)

    rerender({ syms: arr })
    rerender({ syms: arr })
    rerender({ syms: arr })
    expect(box.reads).toBe(readsAfterFirst)                       // the list was not walked again
    expect(seen.length).toBeGreaterThanOrEqual(4)
    for (const key of seen) expect(key[1]).toBe(first[1])         // the SAME object: SWR's hash is a lookup
  })

  it('a NEW array is prepared again, and an equal one gives an equal key', () => {
    const a = ['tsla', 'amd']
    const { rerender } = renderHook(({ syms }) => useThesisChips(syms), { initialProps: { syms: a } })
    const first = seen[seen.length - 1]
    rerender({ syms: ['amd', 'TSLA'] })                           // same set, another array
    const second = seen[seen.length - 1]
    expect(second).toEqual(first)
    rerender({ syms: ['amd', 'TSLA', 'coin'] })                   // a changed set is seen at once
    expect(seen[seen.length - 1]).toEqual([THESIS_CHIPS_URL, ['AMD', 'COIN', 'TSLA']])
  })

  it('no key with the flag off or with nothing to ask for, whatever the array', () => {
    const { rerender } = renderHook(({ syms }) => useThesisChips(syms), { initialProps: { syms: [] } })
    expect(seen[seen.length - 1]).toBeNull()
    rerender({ syms: [null, ''] })
    expect(seen[seen.length - 1]).toBeNull()
    rerender({ syms: undefined })
    expect(seen[seen.length - 1]).toBeNull()
    __resetNotebookFlags()                                         // the flag off again
    rerender({ syms: ['NVDA'] })
    expect(seen[seen.length - 1]).toBeNull()
  })
})
