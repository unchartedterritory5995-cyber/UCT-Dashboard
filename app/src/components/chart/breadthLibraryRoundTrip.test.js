// A breadth series SURVIVES BEING SAVED AND REOPENED — as the same identity, with
// the same presentation.
//
// ⭐ THIS IS THE STEP THAT MAKES THE LIBRARY REAL. Ranking a metric well is worth
// nothing if `NASDAQ:A50` comes back from the preference row as `NASDAQ` + a field
// called `A50:close`, or if Net New High-Low reopens as a plain line. The colon in a
// universe-namespaced symbol is the exact character `parseSource` also uses as its
// separator, so the round-trip is not a formality — it is the risk.
//
// ⛔ NO NEW SURFACE IS EXERCISED. `createFromResult` is the canonical add path,
// `JSON.parse(JSON.stringify(cs))` is exactly what a preference row does to chart
// settings, and `parseSource` / `presentedPlot` are the readers the renderer uses.
import { describe, it, expect } from 'vitest'

import CATALOG from './__fixtures__/breadthLibraryRows.json'
import { searchLibrary } from './breadthLibrary'
import { breadthResults, createFromResult, securityResults } from './discoveryCatalog'
import * as registry from './engine/nativeRegistry'
import { parseSource } from './engine/sourceRef'
import { presentedPlot } from './engine/presentation'
import { signColorsForPlot } from './engine/pool'

const ROWS = CATALOG.rows
const METRIC_ORDER = new Map(CATALOG.metric_order.map((m, i) => [m, i]))

const pick = (q) =>
  breadthResults(searchLibrary(ROWS, q, { limit: 1, metricOrder: METRIC_ORDER }))[0]

/** Add each identity through the canonical discovery path. */
function build(...queries) {
  let cs = { indicatorInstances: [] }
  for (const q of queries) cs = createFromResult(cs, pick(q), registry)
  return cs
}

/** What a preference row does to chart settings, and nothing more. */
const reopen = (cs) => JSON.parse(JSON.stringify(cs))

describe('save → reopen keeps the identity', () => {
  it('⭐ a universe-namespaced symbol survives the JSON round-trip unchanged', () => {
    const cs = build('UCTA50', 'NASDAQ:A50', 'US:NETHL')
    expect(reopen(cs)).toEqual(cs)
    expect(cs.indicatorInstances.map((i) => i.inputs.source)).toEqual([
      'sym:UCTA50:close', 'sym:NASDAQ:A50:close', 'sym:US:NETHL:close',
    ])
  })

  it('⛔ and the reopened source parses back to the SAME symbol, colon and all', () => {
    // `sym:NASDAQ:A50:close` has three colons. Splitting on the FIRST one yields the
    // symbol `NASDAQ` and the field `A50:close` — a different series, silently.
    for (const inst of reopen(build('NASDAQ:A50', 'US:NETHL', 'NYSE:A200')).indicatorInstances) {
      const p = parseSource(inst.inputs.source)
      expect(p.kind).toBe('symbol')
      expect(p.field).toBe('close')
      expect(inst.inputs.source).toBe(`sym:${p.symbol}:close`)
      expect(p.symbol).toMatch(/^(NASDAQ|US|NYSE):[A-Z0-9]+$/)
    }
  })

  it('a legacy UCT row reopens as its own symbol, not as "UCT"', () => {
    const [inst] = reopen(build('UCTA50')).indicatorInstances
    expect(parseSource(inst.inputs.source).symbol).toBe('UCTA50')
  })
})

describe('save → reopen keeps the presentation', () => {
  it('⭐ NETHL is still a signed histogram after the round-trip; A50 is still a line', () => {
    const cs = reopen(build('US:NETHL', 'NASDAQ:A50'))
    const plotOf = (inst) =>
      presentedPlot({ key: 'value', style: 'line', color: '#4f9cf9' }, inst)

    const nethl = plotOf(cs.indicatorInstances[0])
    expect(nethl.style).toBe('histogram')
    expect(nethl.colorMode).toBe('sign')
    // the colours come from the presentation chain, not from a breadth branch
    expect(signColorsForPlot(nethl)).toEqual({ up: '#2faf68', down: '#df4646' })

    const a50 = plotOf(cs.indicatorInstances[1])
    expect(a50.style).toBe('line')
    expect(a50.colorMode).toBeUndefined()
    expect(signColorsForPlot(a50)).toBeNull()
  })
})

describe('the same metric across universes, and the same identity twice', () => {
  it('one metric over four universes is four DISTINCT series', () => {
    const cs = build('UCTA50', 'US:A50', 'NASDAQ:A50', 'NYSE:A50')
    const srcs = cs.indicatorInstances.map((i) => i.inputs.source)
    expect(new Set(srcs).size).toBe(4)
    expect(new Set(cs.indicatorInstances.map((i) => i.instanceId)).size).toBe(4)
  })

  it('⚠️ adding the SAME identity twice makes two instances — by design, not by accident', () => {
    // A pane is named by the INSTANCE that hosts it, so two adds are two series the
    // member can style and place independently. Deduping here would quietly contradict
    // the rule the rest of the engine is built on.
    const cs = build('NASDAQ:A50', 'NASDAQ:A50')
    expect(cs.indicatorInstances).toHaveLength(2)
    expect(new Set(cs.indicatorInstances.map((i) => i.instanceId)).size).toBe(2)
    expect(new Set(cs.indicatorInstances.map((i) => i.inputs.source)).size).toBe(1)
  })
})

// ─── the reading order, in the surfaces a member actually reads ──────────────
//
// ⭐⭐ "METRIC FIRST, UNIVERSE SECOND" IS A CLAIM ABOUT A RENDERED LIST, so it has
// to be pinned where the list is built. Ranking the A50 family to the top is worth
// nothing if the row then reads `NASDAQ · % of Stocks Above 50-Day MA` — the address
// in bold, the idea in grey. That is exactly what the source picker did before this
// phase, because it leads with `shortName`, and `shortName` is the UNIVERSE badge
// (which is the right answer for a pane legend and the wrong one for a search list).
import { symbolLibraryRow } from './discoveryCatalog'

describe('a result says which half leads', () => {
  const pickRes = (q) =>
    breadthResults(searchLibrary(ROWS, q, { limit: 1, metricOrder: METRIC_ORDER }))[0]

  it('⭐ a breadth result leads with the METRIC and glosses with the universe', () => {
    const r = pickRes('NASDAQ:A50')
    expect(r.lead).toBe('% of Stocks Above 50-Day MA')
    expect(r.sub).toBe('NASDAQ')
    // ⛔ and the pane legend is UNCHANGED — `shortName` still carries the universe,
    // because four A50 series in one pane differ by population, not by metric.
    expect(r.shortName).toBe('NASDAQ')
  })

  it('a legacy UCT row glosses with the symbol it has always worn', () => {
    const r = pickRes('UCTA50')
    expect(r.lead).toBe('% of Stocks Above 50-Day MA')
    expect(r.sub).toBe('UCTA50')
  })

  it('⛔ a SECURITY is untouched: ticker leads, company name glosses', () => {
    const [r] = securityResults([{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf' }])
    expect(r.lead).toBe('QQQ')
    expect(r.sub).toBe('Invesco QQQ Trust')
  })

  it('and a security with no long name glosses with nothing rather than itself', () => {
    const [r] = securityResults([{ ticker: 'QQQ', name: 'QQQ', type: 'etf' }])
    expect(r.lead).toBe('QQQ')
    expect(r.sub).toBe('')
  })

  it('⭐ the Symbols library row inverts too — headline metric, subtitle universe', () => {
    const row = symbolLibraryRow(pickRes('NASDAQ:A50'))
    expect(row.name).toBe('% of Stocks Above 50-Day MA')
    expect(row.description).toBe('NASDAQ · NASDAQ:A50')
    expect(row.shortName).toBe('Breadth')       // the chip still says what it is
  })

  it('…and a security library row still leads with its ticker', () => {
    const row = symbolLibraryRow(securityResults(
      [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf' }])[0])
    expect(row.name).toBe('QQQ')
    expect(row.description).toBe('Invesco QQQ Trust')
  })
})
