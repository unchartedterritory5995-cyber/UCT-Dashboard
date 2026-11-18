// Owner 2026-11-17 (QQQ 1m): the FIRST candle after opening a chart had the wrong body until
// the next bucket. The post-setData re-top (legacyLiveWriters, Writer D's Finnhub branch)
// opened the current bucket from ONE live price, unmarked; the push feed's bucket-to-date
// frame then could not replace that open (I2) nor narrow the range (I1).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mergePushBar, provisionalOpen } from './liveBarMerge'

const T = 1_800_000_000 - (1_800_000_000 % 60)
const push = { time: T, open: 10, high: 12, low: 9, close: 11, volume: 500 }

describe('first mount mid-bucket', () => {
  it('a bucket opened from one price is replaced outright by the first push frame', () => {
    const m = mergePushBar({ ...provisionalOpen(T, 11.5), sym: 'ZZQ' }, push, { sym: 'ZZQ' })
    expect(m.kind).toBe('update')
    expect([m.bar.open, m.bar.high, m.bar.low, m.bar.close]).toEqual([10, 12, 9, 11])
    expect(m.bar.provisional).toBeUndefined()
  })

  it('the unmarked bar is what kept the wrong open (the regression this guards)', () => {
    const m = mergePushBar({ time: T, open: 11.5, high: 11.5, low: 11.5, close: 11.5, sym: 'ZZQ' }, push, { sym: 'ZZQ' })
    expect(m.bar.open).toBe(11.5)
  })

  it('the re-top opens an intraday bucket with provisionalOpen', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/components/chart/legacyLiveWriters.js'), 'utf8')
    const i = src.indexOf("if (decision.kind === 'new') {\n      const isDW = !isIntradayTf".replace(/\n/g, src.includes('\r\n') ? '\r\n' : '\n'))
    expect(i).toBeGreaterThan(0)
    const branch = src.slice(i, i + 3000)
    expect(branch).toMatch(/isIntradayTf && !_lbSame\s*\?\s*provisionalOpen\(barTime, lp\)/)
  })
})
