// app/src/components/chart/semanticNaming.test.js
//
// ─── TELL ME WHAT IT ACTUALLY IS ────────────────────────────────────────────
//
// ⚰️⚰️ THE DEFECT, IN ONE LINE. `breadthResults` sets `shortName: universeLabel ||
// sym`, `createFromResult` stamped that as the instance's `display.name`, and
// both naming surfaces read `display.name`. So `US:NETHL` — Net New 52-Week
// Highs/Lows for US stocks — was called **`US`** in the Indicators list, in the
// pane strip AND in the editor. A universe is an address, not an indicator name.
//
// ⭐ AND THE UNIVERSE-AS-SHORT-NAME RULE WAS RIGHT, JUST OVER-APPLIED. Four A50
// series sharing one pane read `UCT 63.2  US 54.9  NASDAQ 51.8  NYSE 57.4` under
// a heading that states the metric once, which is exactly what you want THERE.
// The instance now carries BOTH halves and each surface picks: `full` where there
// is room, `compact` in a pane strip.
//
// ⛔ NO TICKER BRANCH ANYWHERE. Every assertion below is driven by catalogue
// metadata (`breadth_metrics`' name / short_name / universe_label), so it holds
// for US, NASDAQ, NYSE and the shipped UCT symbols alike.

import { describe, it, expect } from 'vitest'
import {
  breadthResults, securityResults, semanticNamesFor, createFromResult, lastCreatedInstance,
} from './discoveryCatalog'
import * as registry from './engine/nativeRegistry'
import { instanceLabel } from './engine/sourceRef'

const TF = 'D'
const BARS = 400
const emptyChart = () => ({ indicatorInstances: [] })

/** A namespaced Breadth Library row, verbatim from `breadth_symbols.py`. */
const nethl = (universe, label) => ({
  universe, universe_label: label, metric: 'net_new_high_low', code: 'NETHL',
  symbol: `${label}:NETHL`, name: 'Net New 52-Week Highs-Lows', short_name: 'Net H-L',
  group: 'highs_lows', group_label: 'Highs / Lows', unit: 'count',
  domain: 'signed', presentation: 'histogram', legacy: false,
})
const a50 = (universe, label) => ({
  universe, universe_label: label, metric: 'pct_above_50sma', code: 'A50',
  symbol: `${label}:A50`, name: '% of Stocks Above 50-Day MA', short_name: 'A50',
  group: 'ma', group_label: 'MA Breadth', unit: 'percent',
  domain: 'pct_0_100', presentation: 'line', legacy: false,
})
/** A shipped UCT row, exactly as `/api/breadth-symbols` sends it today. */
const LEGACY = {
  symbol: 'UCTA50', metric: 'pct_above_50sma', name: '% of Stocks Above 50-Day MA',
  short_name: 'A50', group: 'ma', group_label: 'MA Breadth', legacy: true,
}

const namesOf = (row) => semanticNamesFor(breadthResults([row], { tf: TF, bars: BARS })[0])

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ A UNIVERSE IS NOT AN INDICATOR NAME', () => {
  it('US:NETHL never normalises to bare `US`', () => {
    const n = namesOf(nethl('us', 'US'))
    expect(n.full).toBe('Net New 52-Week Highs-Lows · US')
    expect(n.compact).toBe('US: Net H-L')
    expect(n.full, 'the full name collapsed to the universe').not.toBe('US')
    expect(n.compact, 'the compact name collapsed to the universe').not.toBe('US')
  })

  it('⭐ generic across every published universe', () => {
    for (const [u, label] of [['us', 'US'], ['nasdaq', 'NASDAQ'], ['nyse', 'NYSE']]) {
      const n = namesOf(nethl(u, label))
      expect(n.full).toBe(`Net New 52-Week Highs-Lows · ${label}`)
      expect(n.compact).toBe(`${label}: Net H-L`)
      // the metric survives in BOTH halves — that is the whole rule
      expect(n.full).toMatch(/Highs-Lows/)
      expect(n.compact).toMatch(/Net H-L/)
    }
    // …and a different metric follows the same shape, from the same metadata.
    const p = namesOf(a50('nyse', 'NYSE'))
    expect(p.full).toBe('% of Stocks Above 50-Day MA · NYSE')
    expect(p.compact).toBe('NYSE: A50')
  })

  it('⚠️ a LEGACY UCT row keeps its symbol as the COMPACT identity', () => {
    // The earlier ruling, preserved where it belongs: `UCTA50` is what a member
    // types and what the axis has shown for a year, so the pane strip keeps it.
    // The list and the editor gain the metric, because they have the room.
    const n = namesOf(LEGACY)
    expect(n.compact).toBe('UCTA50')
    expect(n.full).toBe('% of Stocks Above 50-Day MA')
  })

  it('⛔ a SECURITY is its own name, both halves — so nothing is stored for it', () => {
    const [sec] = securityResults([{ ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf' }],
      { tf: TF, bars: BARS })
    expect(semanticNamesFor(sec)).toEqual({ full: 'QQQ', compact: 'QQQ' })
    const cs = createFromResult(emptyChart(), sec, registry)
    const inst = lastCreatedInstance(emptyChart(), cs)
    // ⭐ PROVENANCE UNCHANGED: a name identical to the derived stem is not a
    // choice, so re-pointing the source still re-labels the series.
    expect(inst.display ?? null).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ WHICH SURFACE GETS WHICH NAME', () => {
  const instFor = (row) => {
    const [res] = breadthResults([row], { tf: TF, bars: BARS })
    const cs = createFromResult(emptyChart(), res, registry)
    return lastCreatedInstance(emptyChart(), cs)
  }

  it('the LIST and the EDITOR read the full name', () => {
    const inst = instFor(nethl('us', 'US'))
    const def = registry.getDefinition(inst.defId)
    // `instanceLabel` is what the structure list and the Inspector header print.
    expect(instanceLabel(def, inst)).toBe('Net New 52-Week Highs-Lows · US')
  })

  it('the instance carries both halves, and only when they say different things', () => {
    const signed = instFor(nethl('us', 'US'))
    expect(signed.display).toEqual({
      name: 'Net New 52-Week Highs-Lows · US', compact: 'US: Net H-L',
    })
    // A legacy row's compact IS its symbol and its full IS the metric — two
    // different strings, so both are recorded.
    const legacy = instFor(LEGACY)
    expect(legacy.display.name).toBe('% of Stocks Above 50-Day MA')
    expect(legacy.display.compact).toBe('UCTA50')
  })

  it('⛔ no implementation identity reaches either name', () => {
    for (const row of [nethl('us', 'US'), a50('nasdaq', 'NASDAQ'), LEGACY]) {
      const n = namesOf(row)
      for (const v of [n.full, n.compact]) {
        expect(v).not.toMatch(/dataSeries/)
        expect(v).not.toMatch(/inst:/)
        expect(v).not.toMatch(/^sym:/)
      }
    }
  })

  it('⚠️ an instance stored BEFORE the compact name existed still names itself', () => {
    // Backward compatibility is the point of `compact` being optional: a blob
    // written by any earlier build carries `name` alone, and every reader falls
    // back to it rather than to a universe or a raw source.
    const def = registry.getDefinition('dataSeries')
    const old = { defId: 'dataSeries', instanceId: 'inst:dataSeries:1',
      inputs: { source: 'sym:US:NETHL:close' }, display: { name: 'Net New 52-Week Highs-Lows' } }
    expect(instanceLabel(def, old)).toBe('Net New 52-Week Highs-Lows')
  })
})
