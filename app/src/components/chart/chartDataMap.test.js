// app/src/components/chart/chartDataMap.test.js
//
// ─── THE MAP MUST BE THE CHART, NOT A PICTURE OF IT ─────────────────────────
//
// ⭐⭐ EVERY CASE HERE IS BUILT THROUGH THE REAL WRITERS — `addInstance`,
// `setInstanceDisplayTarget`, `setInstanceHidden`, `removeInstance` — and never
// by hand-writing an instance object. A hand-written fixture is a statement
// about what I THINK the blob looks like; these are statements about what the
// product actually stores, which is the only thing the map will meet in
// production. (The one hand-built case is explicitly a CORRUPT blob, and says so.)
//
// ⛔ AND THE GROUPING IS ASSERTED AGAINST THE SAME HELPERS THE RENDERER USES,
// in the cases that matter, rather than against a remembered expectation. A test
// that only knew "RSI goes in its own pane" would keep passing after the layout
// stopped agreeing.

import { describe, it, expect } from 'vitest'
import { paneMap, ORPHAN_GROUP, HIDDEN_GROUP } from './chartDataMap'
import { mergeChartSettings } from './chartDefaults'
import { listAllIndicators } from './indicatorRegistry'
import * as registry from './engine/nativeRegistry'
import { createDirectSeries, lastCreatedInstance } from './discoveryCatalog'
import { symbolSource, paneOfTarget } from './engine/sourceRef'
import { primeSecondaryBars, clearSecondaryBars } from './engine/secondaryBars'
import {
  addInstance, setInstanceDisplayTarget, setInstanceHidden, removeInstance, setInstanceInput,
} from './engine/instanceControls'
import { paneOwnKeys, paneOwnersNeeded } from './engine/displayTarget'
import { setPaneOrder, PRICE_PANE } from './engine/paneOrder'

const defOf = (id) => registry.getDefinition(id)
const map = (cs) => paneMap(listAllIndicators(cs, registry), cs, defOf)
const group = (cs, id) => map(cs).find((g) => g.id === id)
const labels = (g) => (g ? g.rows.map((r) => r.label) : null)

function prime(symbol) {
  primeSecondaryBars(symbol, 'D', 400, {
    bars: Array.from({ length: 12 }, (_, i) => ({
      t: `2026-09-${String(i + 1).padStart(2, '0')}`,
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    })),
  })
}

/** A direct symbol series, added the way the catalogue adds one. */
function withSeries(cs, symbol) {
  prime(symbol)
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

/** An indicator instance, added the way the catalogue adds one. */
function withDef(cs, defId) {
  const next = addInstance(cs, defId, registry)
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

const base = () => mergeChartSettings({})

describe('the groups that are always the chart itself', () => {
  it('⭐ a bare chart maps to Price, and Price survives being empty', () => {
    const groups = map(base())
    expect(groups[0].id).toBe('price')
    expect(groups.some((g) => g.id === ORPHAN_GROUP)).toBe(false)
  })

  it('⚰️ a BANDED volume is content of Price — the map must not invent a pane', () => {
    // ⚰️ IT USED TO BE ITS OWN GROUP UNCONDITIONALLY, which was harmless while
    // nothing could be reordered: a heading is just a heading. With whole-pane
    // ordering it became an offer — a pane to drag that the renderer never
    // allocates, because the default volume is a BAND inside the candles' pane.
    // `cs.volume.separatePane` is the difference, and the map reads it.
    const cs = base()
    expect(cs.volume.separatePane, 'fixture assumption: the shipped default bands volume').toBe(false)
    expect(labels(group(cs, 'price'))).toContain('Volume')
    expect(group(cs, 'volume'), 'a band was drawn as a pane').toBeFalsy()
  })

  it('⭐ …and a SEPARATE volume really is its own pane', () => {
    const cs = { ...base(), volume: { ...base().volume, separatePane: true } }
    expect(labels(group(cs, 'volume'))).toContain('Volume')
    expect(labels(group(cs, 'price'))).not.toContain('Volume')
  })

  it('⛔ the MA overlays are fixtures on PRICE — they have no instance to ask', () => {
    const cs = base()
    const price = labels(group(cs, 'price'))
    // The shipped blob carries four moving-average overlays.
    expect(price.filter((l) => /^(EMA|SMA)\s/.test(l)).length).toBeGreaterThan(0)
  })
})

describe('an instance goes where the chart puts it', () => {
  it('⭐⭐ an own-pane instance becomes its OWN group, named as the menu names it', () => {
    const { cs, id } = withDef(base(), 'rsi')
    const g = group(cs, id)
    expect(g, 'RSI got no pane group').toBeTruthy()
    expect(g.kind).toBe('pane')
    expect(g.name).toMatch(/RSI/)
    // The host is the first member of its own pane — it draws there too.
    expect(labels(g)).toEqual([g.host.label])
  })

  it('⭐⭐ TWO instances of ONE definition are TWO panes (P2.0c identity)', () => {
    let cs = base()
    const a = withDef(cs, 'rsi'); cs = a.cs
    const b = withDef(cs, 'rsi'); cs = b.cs
    const groups = map(cs).filter((g) => g.kind === 'pane')
    expect(groups.length, 'two own-pane RSIs collapsed onto one pane').toBe(2)
    expect(groups.map((g) => g.id).sort()).toEqual([a.id, b.id].sort())
    // …and they are told apart by name, through the same authority the legend
    // and the destination menu use.
    expect(groups[0].name).not.toBe(groups[1].name)
  })

  it('⭐ a guest sent to a host joins THAT host\'s group, not a new one', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)

    const g = group(cs, host.id)
    expect(labels(g)).toContain('QQQ')
    expect(group(cs, guest.id), 'the guest kept a pane of its own').toBeFalsy()
    expect(map(cs).filter((x) => x.kind === 'pane').length).toBe(1)
  })

  it('⭐ a guest sent to Price sits on Price', () => {
    let cs = base()
    const s = withSeries(cs, 'QQQ'); cs = s.cs
    cs = setInstanceDisplayTarget(cs, s.id, 'price', registry)
    expect(labels(group(cs, 'price'))).toContain('QQQ')
  })

  it('⭐ a guest sent to Volume sits on Volume', () => {
    let cs = base()
    const s = withSeries(cs, 'QQQ'); cs = s.cs
    cs = setInstanceDisplayTarget(cs, s.id, 'volume', registry)
    expect(labels(group(cs, 'volume'))).toContain('QQQ')
  })
})

describe('⛔⛔ the map may never claim a pane the chart does not draw', () => {
  it('a hidden host with NO visible guest gets NO group', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    expect(group(cs, host.id), 'precondition: the pane exists while visible').toBeTruthy()

    cs = setInstanceHidden(cs, host.id, true, registry)
    expect(group(cs, host.id), 'a hidden, empty pane was drawn on the map').toBeFalsy()
  })

  it('⚰️ …and it is NOT SHOWN, not "needs attention" — nothing is broken', () => {
    // ⚰️ MEASURED IN THE HARNESS. Hiding an own-pane RSI filed it with the
    // orphans, under a heading that told the member the pane was "no longer on
    // the chart" — one second after they switched it off on purpose. A missing
    // pane has two causes and they need two sentences: this one is reversible
    // from the row's own toggle, the orphan below is not.
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    cs = setInstanceHidden(cs, host.id, true, registry)

    const hidden = group(cs, HIDDEN_GROUP)
    expect(hidden, 'a hidden own-pane series is in no group at all').toBeTruthy()
    expect(hidden.rows.length).toBe(1)
    expect(group(cs, ORPHAN_GROUP), 'a deliberately hidden row was called an orphan').toBeFalsy()
  })

  it('⭐ a hidden GUEST stays with its host — that pane really is on the chart', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = setInstanceHidden(cs, guest.id, true, registry)

    expect(labels(group(cs, host.id))).toContain('QQQ')
    expect(group(cs, HIDDEN_GROUP), 'a hidden guest was moved out of a pane that exists').toBeFalsy()
  })

  it('⭐⭐ a hidden host WITH a visible guest KEEPS its group — the pane is real', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = setInstanceHidden(cs, host.id, true, registry)

    const g = group(cs, host.id)
    expect(g, 'the guest lost the pane it draws in').toBeTruthy()
    expect(labels(g)).toContain('QQQ')
  })

  it('⭐ the live set is exactly `paneOwnKeys ∪ paneOwnersNeeded` — asked, not guessed', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = setInstanceHidden(cs, host.id, true, registry)

    const insts = cs.indicatorInstances
    const expected = new Set([...paneOwnKeys(insts, cs), ...paneOwnersNeeded(insts, cs)])
    const drawn = new Set(map(cs).filter((g) => g.kind === 'pane').map((g) => g.id))
    expect(drawn).toEqual(expected)
  })
})

describe('⛔⛔ fail-closed orphans are REPORTED, never re-homed', () => {
  it('a guest whose host was deleted lands in Needs attention', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = removeInstance(cs, host.id, registry)

    const orphans = group(cs, ORPHAN_GROUP)
    expect(orphans, 'the orphan was silently swallowed').toBeTruthy()
    expect(labels(orphans)).toContain('QQQ')
    // ⛔ AND IT IS NOT MERELY "NOT SHOWN". The host is GONE; unhiding nothing
    // brings it back, so this row needs a decision the hidden group never does.
    expect(labels(group(cs, HIDDEN_GROUP)) || []).not.toContain('QQQ')
    // ⛔ AND IT WAS NOT QUIETLY MOVED TO PRICE OR TO ITS OWN PANE.
    expect(labels(group(cs, 'price'))).not.toContain('QQQ')
    expect(group(cs, guest.id)).toBeFalsy()
  })

  it('⛔ the STORED target is untouched — the map reports, it does not write', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = removeInstance(cs, host.id, registry)

    const before = JSON.stringify(cs)
    map(cs)
    expect(JSON.stringify(cs), 'reading the map mutated the settings').toBe(before)
    const stored = cs.indicatorInstances.find((i) => i.instanceId === guest.id)
    expect(stored.placement.target).toBe(paneOfTarget(host.id))
  })
})

describe('every row reaches exactly one group', () => {
  it('⭐ no row is dropped and none is duplicated, on a busy chart', () => {
    let cs = base()
    const rsi = withDef(cs, 'rsi'); cs = rsi.cs
    const macd = withDef(cs, 'macd'); cs = macd.cs
    const qqq = withSeries(cs, 'QQQ'); cs = qqq.cs
    const spy = withSeries(cs, 'SPY'); cs = spy.cs
    cs = setInstanceDisplayTarget(cs, spy.id, paneOfTarget(rsi.id), registry)
    cs = setInstanceDisplayTarget(cs, qqq.id, 'price', registry)

    const rows = listAllIndicators(cs, registry)
    const placed = paneMap(rows, cs, defOf).flatMap((g) => g.rows)
    expect(placed.length).toBe(rows.length)
    expect(new Set(placed.map((r) => r.id)).size).toBe(rows.length)
  })

  it('⛔ a CORRUPT blob still shows every row rather than losing one', () => {
    // Hand-built on purpose: an instance naming a host id that was never in the
    // list at all. Nothing the writers can produce — and exactly the shape a
    // half-written blob or an old export can carry.
    const cs = { ...base(), indicatorInstances: [
      { instanceId: 'inst:ghost:1', defId: 'rsi', inputs: {}, placement: { target: paneOfTarget('nope') } },
    ] }
    const rows = listAllIndicators(cs, registry)
    const placed = paneMap(rows, cs, defOf).flatMap((g) => g.rows)
    expect(placed.length).toBe(rows.length)
    expect(labels(group(cs, ORPHAN_GROUP))).toEqual(
      expect.arrayContaining([rows.find((r) => r.instanceId === 'inst:ghost:1').label]),
    )
  })
})

describe('⚰️ the map is in the order the CHART stacks them', () => {
  const ids = (cs) => map(cs).filter((g) => ['price', 'volume', 'pane'].includes(g.kind)).map((g) => g.id)

  it('⚰️ an arrangement reorders the GROUPS, including Price', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    expect(ids(cs)).toEqual([PRICE_PANE, r.id])
    cs = setPaneOrder(cs, [r.id, PRICE_PANE])
    expect(ids(cs), 'the map still listed Price first').toEqual([r.id, PRICE_PANE])
  })

  it('⭐ Price can be listed last', () => {
    let cs = base()
    const a = withDef(cs, 'rsi'); cs = a.cs
    const b = withDef(cs, 'macd'); cs = b.cs
    cs = setPaneOrder(cs, [a.id, b.id, PRICE_PANE])
    expect(ids(cs)).toEqual([a.id, b.id, PRICE_PANE])
  })

  it('⛔ Needs attention and Not shown are never arranged — they are not panes', () => {
    let cs = base()
    const host = withDef(cs, 'rsi'); cs = host.cs
    const guest = withSeries(cs, 'QQQ'); cs = guest.cs
    cs = setInstanceDisplayTarget(cs, guest.id, paneOfTarget(host.id), registry)
    cs = removeInstance(cs, host.id, registry)
    cs = setPaneOrder(cs, [ORPHAN_GROUP, PRICE_PANE])
    const groups = map(cs)
    expect(groups[groups.length - 1].kind, 'an orphan list was arranged like a pane').toBe('orphans')
  })
})

describe('order', () => {
  it('⭐ pane groups come out in stored-instance order, like the stack', () => {
    let cs = base()
    const a = withDef(cs, 'rsi'); cs = a.cs
    const b = withDef(cs, 'macd'); cs = b.cs
    const order = map(cs).filter((g) => g.kind === 'pane').map((g) => g.id)
    const stored = cs.indicatorInstances
      .filter((i) => order.includes(i.instanceId))
      .map((i) => i.instanceId)
    expect(order).toEqual(stored)
  })
})

describe('the names are the chart\'s names', () => {
  it('⭐ a pane hosted by a symbol series is named by the SYMBOL', () => {
    let cs = base()
    const s = withSeries(cs, 'QQQ'); cs = s.cs
    expect(group(cs, s.id).name).toBe('QQQ')
  })

  it('⭐ a pane hosted by a parameterised indicator carries its parameters', () => {
    let cs = base()
    const r = withDef(cs, 'rsi'); cs = r.cs
    cs = setInstanceInput(cs, r.id, 'period', 7, registry)
    expect(group(cs, r.id).name).toMatch(/7/)
  })
})

// Each case builds its own chart; the symbol cache is the only shared state.
clearSecondaryBars()
