// app/src/components/chart/paneRowMeta.test.js
//
// ─── WHAT A ROW SAYS, AND WHAT IT STILL IS ──────────────────────────────────
//
// ⭐⭐ THE HYBRID 2 SURFACE PRINTS THREE THINGS PER ROW — a name, a SOURCE and a
// DISPLAY — and all three are derived, never stored. These cases pin the derivation
// against the SAME canonical helpers the renderer reads, built through the REAL
// writers, so a map that starts disagreeing with the chart fails here first.
//
// ⛔⛔ AND THE NAMING IS PRESENTATION ONLY. The last group is the one that matters
// most: two instances may legitimately come out of here wearing the SAME visible
// name, and they must remain separately addressable. If a future refactor ever
// makes the label the identity, that group goes red.

import { describe, it, expect } from 'vitest'
import { paneMap, paneRowMeta } from './chartDataMap'
import { derivedTargetOf } from './engine/displayTarget'
import { mergeChartSettings } from './chartDefaults'
import { listAllIndicators, readEnabled } from './indicatorRegistry'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource } from './engine/sourceRef'
import { primeSecondaryBars } from './engine/secondaryBars'
import {
  addInstance, setInstanceDisplayTarget, setInstanceInput, findInstance,
} from './engine/instanceControls'

// ⚠️ `addInstance` IS NOT APPEND-ONLY — measured. It files a new instance in
// definition order, so a movingAverage added after a dataSeries lands BEFORE it.
// Taking `list[list.length - 1]` writes to the wrong instance, silently.
const lastOf = (cs, defId) => {
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  return [...list].reverse().find((i) => i && i.defId === defId)
}

// ⛔⛔ AND AN MA FOLLOWS ITS SOURCE ONLY THROUGH AN INSTANCE REF. `derivedTargetFor`
// answers null for a raw `sym:` source — a symbol derives no pane — so
// `MA(sym:QQQ:close)` stays on Price by declaration. Pointing it at the QQQ
// INSTANCE is what makes it land in QQQ's pane, and it is exactly what the
// member's Source picker produces ("QQQ → Value").
const instRef = (instanceId, plot = 'value') => `@${instanceId}::${plot}`

const defOf = (id) => registry.getDefinition(id)

// ⭐ THE SAME FILTER THE SURFACE APPLIES. `listAllIndicators` lists every shipped
// DEFINITION, drawing or not; the tab maps only what the chart actually draws
// (`ChartSettingsIndicators`' `activeRows`). Feeding the raw list to `paneMap`
// files twenty dormant definitions under Price and the map means nothing.
const isFixture = (r) => r?.path?.kind === 'overlay' || r?.path?.kind === 'section'
const drawnRows = (cs) => listAllIndicators(cs, registry).filter((r) => isFixture(r) || readEnabled(r))
const map = (cs) => paneMap(drawnRows(cs), cs, defOf)
const groupOf = (cs, id) => map(cs).find((g) => g.id === id)
/** Every row of every group, decorated — the shape the surface renders. */
const metaRows = (cs) => map(cs).flatMap((g) =>
  g.rows.map((r) => ({ group: g.name, ...paneRowMeta(r, g, cs, defOf), rowId: r.id })))
// ⚠️ ALWAYS BY INSTANCE, NEVER BY NAME. A default chart already ships four
// legacy `cs.overlays` averages called EMA 9 / EMA 20 / SMA 50 / SMA 200, so a
// name lookup finds one of THOSE and quietly asserts nothing about the engine
// instance under test.
const metaOf = (cs, instanceId) => {
  for (const g of map(cs)) {
    const row = g.rows.find((r) => r.instanceId === instanceId)
    if (row) return { group: g.name, ...paneRowMeta(row, g, cs, defOf), rowId: row.id }
  }
  return null
}

function prime(symbol) {
  primeSecondaryBars(symbol, 'D', 400, {
    bars: Array.from({ length: 12 }, (_, i) => ({
      t: `2026-09-${String(i + 1).padStart(2, '0')}`,
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    })),
  })
}

/** A direct symbol series, added exactly the way the catalogue adds one. */
function withSeries(cs, symbol) {
  prime(symbol)
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

/** A Moving Average reading `src`, through the real writers. */
function withMA(cs, src, period = 20, type = 'ema') {
  let next = addInstance(cs, 'movingAverage', registry)
  const id = lastOf(next, 'movingAverage').instanceId
  next = setInstanceInput(next, id, 'source', src, registry)
  next = setInstanceInput(next, id, 'period', period, registry)
  next = setInstanceInput(next, id, 'maType', type, registry)
  return { cs: next, id }
}

const base = () => mergeChartSettings(null)

describe('⭐ SOURCE — what the row reads, in the member’s own words', () => {
  it('a price moving average reads Close', () => {
    const { cs } = withMA(base(), 'close')
    const row = metaRows(cs).find((r) => r.rowId.includes('movingAverage'))
    expect(row.source).toBe('Close')
  })

  it('⛔ and never the raw ref — a symbol source reads as its ticker', () => {
    const a = withSeries(base(), 'QQQ')
    const { cs } = withMA(a.cs, instRef(a.id))
    const row = metaRows(cs).find((r) => r.rowId.includes('movingAverage'))
    expect(row.source).toBe('QQQ')
    expect(row.source).not.toMatch(/sym:|@inst:/)
  })

  it('⛔ an INSTANCE source reads as that instance’s own name', () => {
    let cs = addInstance(base(), 'rsi', registry)
    const rsiId = lastOf(cs, 'rsi').instanceId
    const made = withMA(cs, `@${rsiId}::rsi`)
    const row = metaRows(made.cs).find((r) => r.rowId.includes('movingAverage'))
    expect(row.source).toMatch(/RSI/)
    expect(row.source).not.toMatch(/@inst:/)
  })

  it('the volume section reads Volume', () => {
    const row = metaRows(base()).find((r) => r.rowId.includes('volume'))
    expect(row.source).toBe('Volume')
  })
})

describe('⭐⭐ THE NAMING RULE — a row never repeats its own band', () => {
  it('⛔ inside QQQ’s pane, an average of QQQ is just EMA 20', () => {
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const qqq = groupOf(made.cs, a.id)
    expect(qqq, 'QQQ never got a pane').toBeTruthy()
    const ma = qqq.rows.map((r) => paneRowMeta(r, qqq, made.cs, defOf))
      .find((m) => /EMA|SMA/.test(m.name))
    expect(ma, 'the average did not follow QQQ into its pane').toBeTruthy()
    expect(ma.name, 'the pane already says QQQ — the row must not').toBe('EMA 20')
    expect(ma.name).not.toMatch(/·/)
    // …and the column still says what it reads.
    expect(ma.source).toBe('QQQ')
  })

  it('⭐⭐ moved to Price, the SAME instance becomes EMA 20 · QQQ', () => {
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const moved = setInstanceDisplayTarget(made.cs, made.id, 'price', registry)
    const ma = metaOf(moved, made.id)
    expect(ma, 'the average did not land anywhere').toBeTruthy()
    expect(ma.group, 'the average did not land on Price').toBe('Price')
    expect(ma.name, 'on Price the source is invisible unless the row says it')
      .toBe('EMA 20 · QQQ')
    expect(ma.display, 'a chosen destination is not Automatic').not.toBe('Automatic')
  })

  it('⛔ a bar field never earns a suffix — no "EMA 20 · Close"', () => {
    const { cs } = withMA(base(), 'close')
    const row = metaRows(cs).find((r) => r.rowId.includes('movingAverage'))
    expect(row.name).toBe('EMA 20')
    expect(row.name).not.toMatch(/Close/)
  })

  it('⛔ a series that NAMES itself from its source is never doubled', () => {
    const a = withSeries(base(), 'QQQ')
    const g = groupOf(a.cs, a.id)
    const self = paneRowMeta(g.rows.find((r) => r.instanceId === a.id), g, a.cs, defOf)
    expect(self.name).toBe('QQQ')
    expect(self.name).not.toBe('QQQ · QQQ')
  })
})

describe('⭐ DISPLAY — intent, not destination', () => {
  it('a derived home reads Automatic', () => {
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const g = groupOf(made.cs, a.id)
    const ma = g.rows.map((r) => paneRowMeta(r, g, made.cs, defOf)).find((m) => /EMA/.test(m.name))
    expect(ma.display).toBe('Automatic')
    expect(ma.explicit).toBe(false)
  })

  it('⭐⭐ a CHOSEN destination reads as that place, and is marked explicit', () => {
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const moved = setInstanceDisplayTarget(made.cs, made.id, 'price', registry)
    const ma = metaOf(moved, made.id)
    expect(ma.explicit, 'the member’s own choice was reported as automatic').toBe(true)
    expect(ma.display).toMatch(/Price/)
  })

  it('⚰️ and returning it to the derived answer clears the marker again', () => {
    // The Track A provenance contract, read from the surface that now prints it.
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const moved = setInstanceDisplayTarget(made.cs, made.id, 'price', registry)
    // ⛔ 'pane' IS NOT "automatic" — it is a DIFFERENT explicit choice ("give it
    // its own pane"), and picking it leaves the marker set. What clears the
    // override is choosing the value the engine would have derived anyway, which
    // is what `derivedTargetOf` names and what the menu shows as the automatic
    // answer. Measured: sending it to 'pane' minted a pane called "EMA 20".
    const home = derivedTargetOf(findInstance(moved, made.id), moved)
    const back = setInstanceDisplayTarget(moved, made.id, home, registry)
    const ma = metaOf(back, made.id)
    expect(ma.group, 'it did not come home to QQQ').toBe('QQQ')
    expect(ma.explicit, 'targetExplicit survived a return to Automatic').toBe(false)
    expect(ma.display).toBe('Automatic')
    expect(ma.name, 'and the short name came back with it').toBe('EMA 20')
  })
})

describe('⛔⛔ A NAME IS NOT AN IDENTITY', () => {
  it('two identical EMA 9s wear one name and stay two instances', () => {
    const one = withMA(base(), 'close', 9, 'ema')
    const two = withMA(one.cs, 'close', 9, 'ema')
    const a = metaOf(two.cs, one.id)
    const b = metaOf(two.cs, two.id)
    expect(a, 'the first average did not render').toBeTruthy()
    expect(b, 'the second average did not render').toBeTruthy()
    // ⭐ THE PRODUCT ALREADY SEPARATES THEM IN WORDS — measured: two engine
    // averages at identical settings come out `EMA 9 #1` and `EMA 9 #2`, which is
    // better than the brief asked for and is left exactly as it is.
    expect(a.name).toMatch(/^EMA 9( #\d+)?$/)
    expect(b.name).toMatch(/^EMA 9( #\d+)?$/)
    // ⛔⛔ AND THE ADDRESS IS THE IDENTITY, whatever the words do. This is the
    // assertion that fails if a refactor ever keys a write off the label.
    expect(a.rowId).not.toBe(b.rowId)
    expect(one.id).not.toBe(two.id)
    expect(a.rowId).toBe(one.id)
    expect(b.rowId).toBe(two.id)
  })

  it('⛔ decorating a row does not touch the row, the instance or the blob', () => {
    const a = withSeries(base(), 'QQQ')
    const made = withMA(a.cs, instRef(a.id))
    const before = JSON.stringify(made.cs)
    const g = groupOf(made.cs, a.id)
    const raw = g.rows[0]
    const rawBefore = JSON.stringify(raw)
    paneRowMeta(raw, g, made.cs, defOf)
    expect(JSON.stringify(made.cs), 'the settings blob was mutated by a READ').toBe(before)
    expect(JSON.stringify(raw), 'the row was mutated by a READ').toBe(rawBefore)
  })
})
