// Gate C misfire class (2026-11-22, layer A h-talk-02): the guide's instant "explain" path names an indicator only when
// the member's words name exactly ONE catalog row, and that row is offered. A row's names (name, short name, id, and
// either without UCT's brand prefix) are matched over the WHOLE catalog: words naming a row the live server has not
// listed (a withheld `meta.requiresServer` definition — the state of every offline test and of a cold page) name THAT
// row, and are never re-read as a different row that carries the same words as a tag or a mode option.
// Class test: every withheld row, by each of its names, alone and in the "difference between A and B" form.
import { describe, it, expect } from 'vitest'
import { explainTopic, explainWords, rowNames } from './guide/explain'
import { catalogRows } from '../components/chart/indicatorCatalog'
import * as nativeRegistry from '../components/chart/engine/nativeRegistry'
import { isCatalogRowOffered } from '../components/chart/engine/serverCompute'

const rows = catalogRows(nativeRegistry).filter(r => r.description && !r.userDefined)
const withheld = rows.filter(r => !isCatalogRowOffered(r, nativeRegistry))
const cases = withheld.flatMap(r => rowNames(r).filter(n => n.length <= 40 && !/ and /.test(n)).map(n => [n, r.id]))
const isIndicator = (hit) => hit?.kind === 'indicator'

describe('guide explain — a withheld row\'s name is never explained as another row', () => {
  it('the class is populated (rows are withheld offline)', () => {
    expect(withheld.length).toBeGreaterThan(0)
    expect(cases.length).toBeGreaterThan(withheld.length)
  })
  it.each(cases)('"%s" (row %s, withheld): not explained as an indicator', (name) => {
    expect(isIndicator(explainTopic(name, 'charts'))).toBe(false)
  })
  it.each(cases)('"what\'s the difference between %s and rsi" (row %s): not answered instantly as a pair', (name) => {
    const w = explainWords(`what's the difference between ${name} and rsi`)
    expect(isIndicator(w ? explainTopic(w, 'charts') : null)).toBe(false)
  })
  it('the brand prefix is a name: "UCT X" rows are found by "X"', () => {
    const branded = rows.filter(r => /^uct\s+/i.test(r.name))
    expect(branded.length).toBeGreaterThan(0)
    for (const r of branded) expect(rowNames(r)).toContain(r.name.toLowerCase().replace(/^uct\s+/, ''))
  })
  it('coverage kept: words ONE offered row names (or tags) are still explained instantly, alone and as a pair', () => {
    expect(explainTopic('rsi', 'charts')).toMatchObject({ id: 'indicator:rsi', local: true })
    expect(explainTopic('rsi and macd', 'charts')).toMatchObject({ kind: 'indicator', local: true })
    expect(explainTopic(explainWords('what is atr'), 'charts')).toMatchObject({ id: 'indicator:atr', local: true })
    expect(explainTopic(explainWords('what is an ema'), 'charts')).toMatchObject({ kind: 'indicator', local: true })
  })
})
