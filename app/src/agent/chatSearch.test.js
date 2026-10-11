import { describe, it, expect } from 'vitest'
import { searchChat, highlightRuns, snippet, searchTerms, lineText } from './chatSearch'

const items = [
  { id: 'a', role: 'member', text: 'Add an EMA to the AAPL chart' },
  { id: 'b', role: 'agent', text: 'Done. Apple (AAPL) now shows the 20 EMA.' },
  { id: 'c', role: 'receipt', lines: ['Added EMA 20 to Chart (AAPL)'] },
  { id: 'd', role: 'member', text: 'what about NVDA?' },
]

describe('search the open chat', () => {
  it('case-insensitive; every word must appear, any order; newest first', () => {
    expect(searchChat(items, 'aapl').map(r => r.it.id)).toEqual(['c', 'b', 'a'])
    expect(searchChat(items, 'ema apple').map(r => r.it.id)).toEqual(['b'])
    expect(searchChat(items, 'tsla')).toEqual([])
    expect(searchChat(items, '   ')).toEqual([])
  })
  it('"$AAPL" finds AAPL; cards and receipts are searched by their lines', () => {
    expect(searchTerms('$AAPL  ema')).toEqual(['aapl', 'ema'])
    expect(lineText(items[2])).toBe('Added EMA 20 to Chart (AAPL)')
    expect(searchChat(items, '$aapl').length).toBe(3)
  })
  it('highlights every hit (original casing kept), merging overlaps', () => {
    expect(highlightRuns('Apple and APPLE', 'apple')).toEqual([
      { text: 'Apple', hit: true }, { text: ' and ', hit: false }, { text: 'APPLE', hit: true },
    ])
    expect(highlightRuns('aaplx', 'aapl apl')).toEqual([{ text: 'aapl', hit: true }, { text: 'x', hit: false }])
  })
  it('a long line is cut around its first hit', () => {
    const long = `${'x'.repeat(300)} target ${'y'.repeat(300)}`
    const s = snippet(long, 'target')
    expect(s).toContain('target')
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true)
    expect(snippet('short', 'x')).toBe('short')
    const words = `${'alpha '.repeat(60)}target ${'omega '.repeat(60)}`
    const w = snippet(words, 'target')
    expect(w).toMatch(/^…alpha /)                    // starts on a whole word
    expect(w).toMatch(/ omega…$/)                    // ends on a whole word
  })
})
