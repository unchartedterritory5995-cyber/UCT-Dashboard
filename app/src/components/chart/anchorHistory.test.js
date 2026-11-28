// "No bars at the date" waits for the whole history (review of #2947, M2; LOW 1: the store D/W/M branch had no rail).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { anchorHistoryDone } from './anchorHistory'

const base = { anchorEarliest: true, hasOverride: false, overridePending: false, intraday: false, validating: false, fetchDepth: 12500, fullTarget: 12500, store: true, deepPending: () => false }

describe('anchorHistoryDone', () => {
  it('not before the held rows: done', () => { expect(anchorHistoryDone({ ...base, anchorEarliest: false, validating: true })).toBe(true) })
  it('a host\'s bars: done once no longer pending', () => {
    expect(anchorHistoryDone({ ...base, hasOverride: true, overridePending: true })).toBe(false)
    expect(anchorHistoryDone({ ...base, hasOverride: true, overridePending: false, deepPending: () => true })).toBe(true)
  })
  it('intraday: done once its window answered', () => {
    expect(anchorHistoryDone({ ...base, intraday: true, validating: true })).toBe(false)
    expect(anchorHistoryDone({ ...base, intraday: true, fetchDepth: 1, deepPending: () => true })).toBe(true)
  })
  it('store D/W/M: the full depth asked, settled, AND no deep history still due', () => {
    expect(anchorHistoryDone({ ...base, fetchDepth: 2000 }), 'the full depth not asked yet').toBe(false)
    expect(anchorHistoryDone({ ...base, validating: true }), 'still reading').toBe(false)
    expect(anchorHistoryDone({ ...base, deepPending: () => true }), 'the deep history is still due').toBe(false)
    expect(anchorHistoryDone(base)).toBe(true)
    expect(anchorHistoryDone({ ...base, deepPending: () => { throw new Error('x') } }), 'a throw reads as not due').toBe(true)
  })
  it('legacy D/W/M (no store): the full depth asked and settled', () => {
    expect(anchorHistoryDone({ ...base, store: false, deepPending: () => true })).toBe(true)
    expect(anchorHistoryDone({ ...base, store: false, fetchDepth: 2000 })).toBe(false)
  })
  it('StockChart decides its note with this function, passing the store\'s deepPending', () => {
    const src = readFileSync(resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    expect(src).toMatch(/const _anchorHistoryDone = anchorHistoryDone\(\{/)
    expect(src).toMatch(/deepPending: \(\) => storeDeepPending\(sym, resolvedTf\)/)
  })
})
