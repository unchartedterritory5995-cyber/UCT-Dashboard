// ONE PAINT, PANES INCLUDED (2026-11-17): the symbol handoff commits a new symbol only once the server
// columns its panes draw have landed (bounded). Measured on production: RS panes appeared 217-270 ms
// after the candles on 2 of 10 typed first opens.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearServerColumns, serverColumnsFor, primeServerColumns, columnsReadyFor, whenColumnsReady,
  __setServerBatchFetcherForTests,
} from './serverCompute'

const WIRE = { times: [1, 2], columns: { rsLine: [0.5, 0.6] } }
let batchCalls = []

beforeEach(() => {
  clearServerColumns()
  batchCalls = []
  __setServerBatchFetcherForTests((url) => { batchCalls.push(url); return new Promise(() => {}) })
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers(); __setServerBatchFetcherForTests(null) })

// a chart at 5m draws rsLine: the ask every chart at that timeframe makes (recorded by its paint)
const chartAsks = () => serverColumnsFor({ id: 'rsLine' }, [], null, { sym: 'ONSCREEN', tf: '5', fetcher: () => new Promise(() => {}) })

describe('columnsReadyFor / whenColumnsReady', () => {
  it('nothing at the timeframe asks for server columns: ready, no wait', async () => {
    expect(columnsReadyFor('NEW', '60')).toBe(true)
    await expect(whenColumnsReady('NEW', '60', 300)).resolves.toBe(true)
  })

  it('a symbol whose columns have not landed is not ready; it is the moment they land', async () => {
    chartAsks()
    expect(columnsReadyFor('NEW', '5')).toBe(false)
    let got = null
    whenColumnsReady('NEW', '5', 300).then((v) => { got = v })
    await vi.advanceTimersByTimeAsync(100)
    expect(got).toBe(null)
    primeServerColumns('rsLine', 'NEW', '5', null, WIRE)                    // lands, unannounced
    await vi.advanceTimersByTimeAsync(20)                                     // seen within one look
    expect(got).toBe(true)
    expect(columnsReadyFor('NEW', '5')).toBe(true)
  })

  it('never waits past its bound, and asks for the missing columns at once', async () => {
    chartAsks()
    let got = null
    whenColumnsReady('SLOW', '5', 300).then((v) => { got = v })
    await vi.advanceTimersByTimeAsync(10)
    expect(batchCalls.some((u) => u.includes('SLOW'))).toBe(true)          // asked now, not at mount
    await vi.advanceTimersByTimeAsync(299)
    expect(got).toBe(false)
  })
})
