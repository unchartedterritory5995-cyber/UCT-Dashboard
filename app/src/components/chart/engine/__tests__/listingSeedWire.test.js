// ─── ⭐⭐ C12w — THE LISTING WIRE: StockChart → binder → computeFor → interpret ──
//
// `interpret`'s listing pass (ruling R-W) is only as good as the fact that reaches
// it. This file pins the four hops, each of which fails SILENTLY if cut — a
// dropped `historyFromListing` does not crash and does not draw a wrong number,
// it just leaves the warm-up curtain down (`lesson_built_tested_green_and_unreachable`):
//
//   1. the PRODUCER (`listingSeed.historyFromListingOf`) says yes in exactly one case;
//   2. the GATE (`nativeRegistry.historyFromListingFor`) needs BOTH the caller's
//      statement AND the document's own declaration;
//   3. the Pine member door STAMPS that declaration, and only the host lane;
//   4. the BINDER carries the statement to the plotted series — and not to a
//      framed instance, whose bars the statement does not describe.

import { describe, it, expect, afterEach } from 'vitest'
import { historyFromListingOf } from '../listingSeed'
import * as registry from '../nativeRegistry'
import { computeFor, historyFromListingFor, PINE_RECURRENCE_ORIGIN } from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'

const W = 250
const N = 320
const isoDay = (i) => new Date(Date.UTC(2024, 2, 21) + i * 86400000).toISOString().slice(0, 10)
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + (i === 3 ? 20 : 0)
  return { t: isoDay(i), o: c, h: c + 1, l: c - 1, c, v: 1000 + i }
})
// A `var` that latches on bar 3 and holds: Pine draws it on every bar from 0.
const SRC = [
  '//@version=5',
  'indicator("c12w wire")',
  'var float b = 7.0',
  'b := close > 109 ? close : b',
  'plot(b)',
].join('\n')
const DEF_ID = 'u_member-pane-c12w-wire'

afterEach(() => { registry.uninstallUserDefinition(DEF_ID) })

const firstColumn = (cols) => Array.from(Object.values(cols).find((c) => c && typeof c.length === 'number'))
const prefixFinite = (col) => col.slice(0, W).filter(Number.isFinite).length

describe('1 — the producer: a daily series whose first bar IS the listing day', () => {
  const bars = [{ t: '2024-03-21' }, { t: '2024-03-22' }]
  it('⭐ yes in exactly that case', () => {
    expect(historyFromListingOf({ bars, tf: 'D', listDate: '2024-03-21' })).toBe(true)
  })
  it.each([
    ['one session after the listing (the IPO badge would still say yes)', { bars: [{ t: '2024-03-22' }], tf: 'D', listDate: '2024-03-21' }],
    ['no listing date', { bars, tf: 'D', listDate: null }],
    ['a malformed listing date', { bars, tf: 'D', listDate: '2024-3-21' }],
    ['a weekly chart', { bars, tf: 'W', listDate: '2024-03-21' }],
    ['an intraday chart', { bars: [{ t: 1711027800 }], tf: '5', listDate: '2024-03-21' }],
    ['a numeric daily key', { bars: [{ t: 1711027800 }], tf: 'D', listDate: '2024-03-21' }],
    ['no bars', { bars: [], tf: 'D', listDate: '2024-03-21' }],
    ['nothing at all', undefined],
  ])('no: %s', (_why, args) => {
    expect(historyFromListingOf(args)).toBe(false)
  })
})

describe('2 — the gate needs the caller AND the document', () => {
  const pineDef = { meta: { recurrenceOrigin: PINE_RECURRENCE_ORIGIN } }
  it.each([
    [pineDef, { historyFromListing: true }, true],
    [pineDef, { historyFromListing: false }, false],
    [pineDef, { historyFromListing: 'true' }, false],
    [pineDef, {}, false],
    [pineDef, undefined, false],
    [{ meta: {} }, { historyFromListing: true }, false],
    [{ meta: { recurrenceOrigin: 'pcf' } }, { historyFromListing: true }, false],
    [{}, { historyFromListing: true }, false],
    [null, { historyFromListing: true }, false],
  ])('%j + %j -> %s', (def, ctx, want) => {
    expect(historyFromListingFor(def, ctx)).toBe(want)
  })
})

describe('3 — the Pine member door declares its recurrences, and computeFor honours it', () => {
  it('⭐ a host-lane document carries meta.recurrenceOrigin = pine', () => {
    const built = memberPaneDefinition({ source: SRC, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.meta.recurrenceOrigin).toBe(PINE_RECURRENCE_ORIGIN)
  })

  it('⭐ through the install door: curtained without the statement, drawn from bar 0 with it', () => {
    const built = memberPaneDefinition({ source: SRC, id: DEF_ID })
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(installed.length).toBe(1)
    const def = installed[0]
    expect(def.meta.recurrenceOrigin, 'the install door dropped the declaration').toBe(PINE_RECURRENCE_ORIGIN)
    const curtained = firstColumn(computeFor(def, BARS, undefined, { tf: 'D' }))
    const listed = firstColumn(computeFor(def, BARS, undefined, { tf: 'D', historyFromListing: true }))
    expect(prefixFinite(curtained), 'NON-VACUITY: the curtain was not down to begin with').toBe(0)
    expect(prefixFinite(listed)).toBe(W)
    // the formerly curtained bars are Pine's own, bar for bar
    let b = 7
    const pine = BARS.map((bar) => { if (bar.c > 109) b = bar.c; return b })
    expect(listed[0]).toBe(7)
    expect(listed.findIndex((v, i) => v !== pine[i])).toBe(-1)
  })

  it('⛔ a document WITHOUT the declaration keeps the curtain whatever the caller says', () => {
    const built = memberPaneDefinition({ source: SRC, id: DEF_ID })
    const def = { ...built.definition, meta: { ...built.definition.meta } }
    delete def.meta.recurrenceOrigin
    const col = firstColumn(computeFor(def, BARS, undefined, { tf: 'D', historyFromListing: true }))
    expect(prefixFinite(col)).toBe(0)
  })
})

describe('4 — the binder carries the statement to the series it draws', () => {
  const drawnPrefix = (ctxExtra) => {
    const built = memberPaneDefinition({ source: SRC, id: DEF_ID })
    registry.installUserDefinitions([built.definition])
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), DEF_ID, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === DEF_ID)
    binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D',
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data),
      plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: DEF_ID, scaleOptions: {} }),
      ...ctxExtra,
    })
    const sets = fake.calls.filter((c) => c.method === 'setData')
    binder.teardown()
    const firstDay = BARS[0].t
    const cutoff = BARS[W - 1].t
    // the points the renderer was handed, inside the would-be curtain
    return sets.flatMap((c) => c.args[0] || [])
      .filter((p) => p && Number.isFinite(p.value) && String(p.time) >= firstDay && String(p.time) <= cutoff).length
  }

  it('⭐ with the statement the curtain lifts on the drawn series; without it, it does not', () => {
    const without = drawnPrefix({})
    const withIt = drawnPrefix({ historyFromListing: true })
    expect(without, 'NON-VACUITY: points were drawn inside the curtain with no statement').toBe(0)
    expect(withIt).toBeGreaterThanOrEqual(W)
  })
})
