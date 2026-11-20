// The chart's "no data" sentence for a timeframe a symbol is not charted on.
//
// The server answers `{ no_data: true, reason: 'timeframe_not_carried' }` for an intraday
// timeframe of a currency pair (api/crypto_bars.py): the symbol IS carried, on D, W and M. The
// chart's stock sentence ("The data provider doesn't carry this symbol. It may be delisted...")
// would be untrue there, so that one reason gets its own sentence.
//
// StockChart cannot be mounted cheaply in jsdom (no canvas, no layout), so this reads SOURCE: it
// holds that the branch exists inside the no-data block, keys on the server's exact word, and
// that every other no-data answer still gets the sentence it always had. The server's side of
// the word is pinned in tests/test_crypto_bars.py.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(HERE, 'StockChart.jsx'), 'utf8').replace(/\r\n/g, '\n')
const start = src.indexOf('{showNoData && (')
const block = src.slice(start, src.indexOf('{showWarmingTimedOut && (', start))

describe('the chart\'s no-data block', () => {
  it('is found once', () => {
    expect(start).toBeGreaterThan(0)
    expect(src.split('{showNoData && (').length).toBe(2)
    expect(block.length).toBeGreaterThan(200)
    expect(block.length).toBeLessThan(2000)
  })

  it('a timeframe that is not carried gets its own true sentence, keyed on the server\'s word', () => {
    expect(block).toMatch(/data\?\.reason === 'timeframe_not_carried' \? \(/)
    expect(block).toContain('This symbol is charted on daily, weekly and monthly bars only. Pick D, W or M.')
    expect(block).toContain('data-testid="chart-tf-not-carried"')
    // the true sentence comes first, the stock sentence is the other arm
    expect(block.indexOf('charted on daily, weekly and monthly')).toBeLessThan(block.indexOf("doesn't carry this symbol"))
  })

  it('every other no-data answer keeps the sentence it always had', () => {
    expect(block).toContain('<span>No chart data available for {sym}.</span>')
    expect(block.replace(/\s+/g, ' ')).toContain("The data provider doesn't carry this symbol. It may be delisted, an index with no OHLC series, or not a tradable ticker.")
    expect(block.match(/timeframe_not_carried/g)).toHaveLength(1)
  })

  it('says nothing about a live price', () => {
    expect(block).not.toMatch(/\blive\b|real.?time|streaming/i)
  })
})
