// app/src/components/chart/legend/readoutPageHint.test.js
//
// UCT RS Phase 4, unit 4-05 — the page hint an assistant is handed from a chip's
// glance rows: one sentence, at most 480 characters, cut only at a row boundary.
import { describe, it, expect } from 'vitest'
import { readoutPageHint, PAGE_HINT_MAX } from './readoutPageHint'

const RS_ROWS = [
  { key: 'benchmarkName', label: 'Benchmark', text: 'S&P 500 (SPY)' },
  { key: 'ratingSummary', label: 'Rating', text: '94 IBD-style' },
  { key: 'phase', label: 'RS line', text: 'above its 21 EMA' },
  { key: 'rsHigh', label: 'Last RS high', text: '3 bars ago, before price' },
  { key: 'regime', label: 'Regime', text: 'persistence' },
  { key: 'checks', label: 'Checks', text: '3 of 4' },
]

describe('readoutPageHint', () => {
  it('reads the map\'s own example from the RS glance rows', () => {
    expect(readoutPageHint(RS_ROWS, { name: 'UCT RS', sym: 'NVDA', vs: 'SPY', skip: ['benchmarkName'] }))
      .toBe('UCT RS for NVDA vs SPY: rating 94 IBD-style; RS line above its 21 EMA; '
        + 'last RS high 3 bars ago, before price; regime persistence; checks 3 of 4')
  })

  it('keeps a row it is not told to skip, and an acronym-led label as written', () => {
    const out = readoutPageHint(RS_ROWS.slice(0, 3), { name: 'UCT RS', sym: 'NVDA' })
    expect(out).toBe('UCT RS for NVDA: benchmark S&P 500 (SPY); rating 94 IBD-style; RS line above its 21 EMA')
  })

  it('leaves out a row with no text, collapses whitespace, and ignores junk rows', () => {
    const rows = [null, 'x', { key: 'a', label: 'Rating', text: '' }, { key: 'b', label: ' Checks ', text: ' 3\n of  4 ' }]
    expect(readoutPageHint(rows, { name: 'UCT RS' })).toBe('UCT RS: checks 3 of 4')
  })

  it('says only the lead when there are no rows, and nothing when there is nothing', () => {
    expect(readoutPageHint([], { name: 'UCT RS', sym: 'NVDA' })).toBe('UCT RS for NVDA')
    expect(readoutPageHint(undefined)).toBe('')
    expect(readoutPageHint([{ key: 'a', label: '', text: 'just text' }])).toBe('just text')
  })

  it('never exceeds 480 characters and cuts at a row boundary, never inside a row', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ key: `r${i}`, label: `Row ${i}`, text: 'x'.repeat(30) }))
    const out = readoutPageHint(rows, { name: 'UCT RS', sym: 'NVDA', vs: 'SPY' })
    expect(PAGE_HINT_MAX).toBe(480)
    expect(out.length).toBeLessThanOrEqual(PAGE_HINT_MAX)
    expect(out.endsWith('x'.repeat(30))).toBe(true)
    const parts = out.slice(out.indexOf(': ') + 2).split('; ')
    for (const p of parts) expect(p).toMatch(/^row \d+ x{30}$/)
    // the next row would not have fit
    expect(out.length + 2 + `row ${parts.length} `.length + 30).toBeGreaterThan(PAGE_HINT_MAX)
  })

  it('a smaller cap is honoured, a larger one is not', () => {
    expect(readoutPageHint(RS_ROWS, { name: 'UCT RS', max: 40 })).toBe('UCT RS: benchmark S&P 500 (SPY)')
    const rows = Array.from({ length: 40 }, (_, i) => ({ key: `r${i}`, label: 'Row', text: 'y'.repeat(40) }))
    expect(readoutPageHint(rows, { name: 'UCT RS', max: 5000 }).length).toBeLessThanOrEqual(PAGE_HINT_MAX)
  })

  it('a lead longer than the cap is sliced to the cap', () => {
    const out = readoutPageHint(RS_ROWS, { name: 'N'.repeat(600) })
    expect(out.length).toBe(PAGE_HINT_MAX)
  })
})
