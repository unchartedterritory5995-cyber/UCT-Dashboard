// #828 added 21 list-widget words to marketDataPhrases.js NOT_A_TICKER ("sort by price" is a column, never a quote for
// SORT). AUDIT's condition: those words must not take a real symbol away from a member.
//   • none of them is a symbol in the universe /api/ticker-search serves (api/data/cap_universe.json, read here);
//   • whether or not one ever becomes a symbol, UPPER CASE or a $ prefix still reads it as a ticker, on the real fast path.
// A failure of the first test means a listing arrived: the second test is then what protects the member, so check it
// holds before re-pinning. No market value is read: the universe file is symbols only.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { fastParse } from './fastPath'
import { parsePriceSentence } from './capabilities/marketDataPhrases'

await registerCatalog()                       // the data kinds on, as production: the fast path's quote reader is server-gated

const WORDS = ['sort', 'sorted', 'sorting', 'rank', 'ranked', 'ranking', 'hide', 'column', 'columns', 'list', 'lists', 'scan', 'scans',
  'scanner', 'first', 'lowest', 'highest', 'biggest', 'smallest', 'ascending', 'descending']
const here = dirname(fileURLToPath(import.meta.url))
const UNIVERSE = new Set(JSON.parse(readFileSync(resolve(here, '../../../api/data/cap_universe.json'), 'utf8')).map(s => String(s).toUpperCase()))
const texts = (r) => (r?.candidates || []).map(c => c.text.replace(/^\$/, '').toUpperCase())
const host = { charts: { list: () => [], read: () => null } }
const quoted = (msg) => (fastParse(msg, { host })?.ops || []).map(o => [o.action, o.args?.symbols ?? o.args?.symbol ?? null])

describe('the list-widget stop words never take a symbol from a member', () => {
  it('the universe is the real one, and these are the 21 words', () => {
    expect(UNIVERSE.size).toBeGreaterThan(1000)
    expect(new Set(WORDS).size).toBe(21)
  })
  it('none of them is a symbol in the searchable universe', () => {
    expect(WORDS.filter(w => UNIVERSE.has(w.toUpperCase()))).toEqual([])
  })
  it.each(WORDS)('%s: in capitals it is a ticker', (w) => {
    const r = parsePriceSentence(`what's the price of ${w.toUpperCase()}`)
    expect(r?.intent).toBe('quote')
    expect(texts(r)).toEqual([w.toUpperCase()])
    expect(quoted(`what's the price of ${w.toUpperCase()}`).length).toBe(1)
  })
  it.each(WORDS)('%s: with a $ prefix it is a ticker, in either case', (w) => {
    for (const t of [`$${w}`, `$${w.toUpperCase()}`]) {
      const r = parsePriceSentence(`price of ${t}`)
      expect(r?.intent, t).toBe('quote')
      expect(texts(r), t).toEqual([w.toUpperCase()])
      expect(quoted(`price of ${t}`).length, t).toBe(1)
    }
  })
  it.each(WORDS)('%s: in lower case, in a sentence that is not a quote frame, it is never a quote', (w) => {
    expect(parsePriceSentence(`${w} the price column`)).toBe(null)
  })
})
