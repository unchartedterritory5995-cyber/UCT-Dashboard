// ONE PAINT, PANES INCLUDED (2026-11-17): the symbol handoff commits a new symbol only once the server
// columns its panes draw have landed (bounded). Measured on production: RS panes appeared 217-270 ms
// after the candles on 2 of 10 typed first opens.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearServerColumns, serverColumnsFor, primeServerColumns, columnsReadyFor, whenColumnsReady,
  warmColumnsFor, __setServerBatchFetcherForTests,
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

describe('warmColumnsFor: the switch asks at Enter', () => {
  it('sends the missing columns request at once, and the commit-time wait does not send it again', async () => {
    chartAsks()
    warmColumnsFor('ENTER', '5')
    await vi.advanceTimersByTimeAsync(10)
    const sent = batchCalls.filter((u) => u.includes('ENTER')).length
    expect(sent).toBe(1)
    whenColumnsReady('ENTER', '5', 300)
    await vi.advanceTimersByTimeAsync(10)
    expect(batchCalls.filter((u) => u.includes('ENTER')).length).toBe(1)   // in flight: not again
  })

  it('asks nothing when the columns are already here, or nothing at the timeframe needs them', async () => {
    warmColumnsFor('NEW', '60')                                             // no ask at 60m
    chartAsks()
    primeServerColumns('rsLine', 'HELD', '5', null, WIRE)
    warmColumnsFor('HELD', '5')
    await vi.advanceTimersByTimeAsync(10)
    expect(batchCalls).toEqual([])
  })
})
