// HELD-OUT family (pl-exec, after PR #1016's ROUTE-NOUN pins): a CHART NOUN typed in lower case is never a ticker. A display
// request that carries a price word ("price scale", "price on the crosshair") must not be read by the pre-model price fast
// path (marketDataPhrases.js parsePriceSentence) as a quote for "axis" / "scale" / …: it goes on to the model. Every noun
// in its singular and plural, in phrasings that are NOT the #1016 pins. Controls: a real ticker (capitals or $) in the same
// frame is still a price question, and a plain quote still parses. LOCAL: unit.
import { describe, it, expect } from 'vitest'
import { parsePriceSentence } from './capabilities/marketDataPhrases'

const NOUNS = ['axis', 'axes', 'scale', 'scales', 'crosshair', 'crosshairs', 'legend', 'legends', 'watermark', 'watermarks', 'gridline', 'gridlines', 'grid', 'label', 'labels']
const FRAMES = [
  (n) => `move the price ${n} to the left`,
  (n) => `can you show the price on the ${n}`,
  (n) => `turn off the price ${n} please`,
  (n) => `I want the price in the ${n}`,
  (n) => `what's the price ${n} doing`,
]
const CASES = NOUNS.flatMap(n => FRAMES.map(f => [n, f(n)]))

describe('a chart noun is never a ticker (pre-model price fast path)', () => {
  it.each(CASES)('%s: "%s" is not a price question', (_n, text) => {
    expect(parsePriceSentence(text), JSON.stringify(parsePriceSentence(text))).toBeNull()
  })
  it.each([['what is the price of AXIS', 'AXIS'], ['price of $SCALE', 'SCALE'], ['what is the price of NVDA', 'NVDA']])('control: "%s" is still a quote for %s', (text, sym) => {
    const r = parsePriceSentence(text)
    expect(r?.intent).toBe('quote')
    expect(r.candidates.map(c => c.text.toUpperCase().replace(/^\$/, ''))).toContain(sym)
  })
})
