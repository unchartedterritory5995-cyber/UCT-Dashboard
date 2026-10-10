// The note Ticker field's rule is the server's rule (crawl finding, 2026-10-09).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeNoteTicker, NOTE_TICKER_MAX, NOTE_TICKER_PATTERN } from './noteTicker'

const NOTES_PY = path.resolve(__dirname, '../../../../../api/services/journal_two/notes.py')

describe('normalizeNoteTicker', () => {
  it('reads the same limits the server enforces (notes.py _validate_ticker)', () => {
    const py = fs.readFileSync(NOTES_PY, 'utf8')
    expect(Number(py.match(/^MAX_TICKER_LENGTH\s*=\s*(\d+)/m)[1])).toBe(NOTE_TICKER_MAX)
    const serverRe = py.match(/def _validate_ticker[\s\S]*?re\.match\(r"([^"]+)"/)[1]
    expect(serverRe).toBe('^[A-Z0-9.\\-]+$')
    for (const ok of ['NVDA', 'BRK.B', 'BF-B', 'X1']) expect(NOTE_TICKER_PATTERN.test(ok)).toBe(new RegExp(serverRe).test(ok))
    for (const bad of ['NV DA', 'A,B', 'NVDA!']) expect(NOTE_TICKER_PATTERN.test(bad)).toBe(new RegExp(serverRe).test(bad))
  })

  it('accepts and normalises what a trader types', () => {
    expect(normalizeNoteTicker('nvda')).toEqual({ ticker: 'NVDA' })
    expect(normalizeNoteTicker(' $tsla ')).toEqual({ ticker: 'TSLA' })
    expect(normalizeNoteTicker('brk.b')).toEqual({ ticker: 'BRK.B' })
  })

  it('treats an empty field as "no ticker"', () => {
    expect(normalizeNoteTicker('')).toEqual({ ticker: null })
    expect(normalizeNoteTicker('   ')).toEqual({ ticker: null })
  })

  it('refuses what the server would refuse, with a sentence instead of a request', () => {
    expect(normalizeNoteTicker('crawl test 42').error).toMatch(/isn't a ticker symbol/)
    expect(normalizeNoteTicker('NVDA, AMD').error).toMatch(/isn't a ticker symbol/)
    expect(normalizeNoteTicker('A'.repeat(17)).error).toMatch(/too long/)
  })
})
