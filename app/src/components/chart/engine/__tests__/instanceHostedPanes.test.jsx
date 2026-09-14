// app/src/components/chart/engine/__tests__/instanceHostedPanes.test.jsx
//
// ─── PHASE 10 · A PANE BELONGS TO THE INSTANCE THAT HOSTS IT ────────────────
//
// ⭐⭐ THE SENTENCE THIS FILE EXISTS TO HOLD. A pane used to be keyed by a
// DEFINITION, which was indistinguishable from an instance for as long as a
// definition could only ever have one. It stopped being true twice over:
//
//   · "Display in: Own pane" has to work for a definition whose DEFAULT is the
//     price pane — `movingAverage` declares `onPrice`, and the member is allowed
//     to overrule that per instance. Under definition keys the layout allocated
//     nothing, `resolvePlacement` failed closed, and the series silently vanished.
//
//   · "Display in: <another series>" has to name a HOST, and a definition cannot
//     be one. Two direct series over two different instruments would have shared
//     one rectangle and one scale no matter which instruments they carried.
//
// ⛔ SO THE KEY IS THE HOST INSTANCE ID, AND EVERY CASE BELOW IS ABOUT IDENTITY
// RATHER THAN GEOMETRY. The pixel arithmetic is `flipCGeometry`'s and is
// untouched; what is asserted here is WHICH pane a thing lands in, and that the
// answer survives a rename, a source change, a duplicate, and a deletion.
//
// ⚠️ PANE KEYS ARE DERIVED, NEVER PERSISTED. Nothing in a stored blob names one,
// which is why widening them is a realisation change and not a migration — and
// why the only compatibility question is the LEGACY `@<defId>` follow target,
// covered at the end.

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  createChart, LineSeries, HistogramSeries, AreaSeries, BaselineSeries,
  LineStyle, LineType,
} from 'lightweight-charts'

import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import * as engineRegistry from '../nativeRegistry'
import {
  __setPaneModeForTest, computePaneLayout, paneStackHeightPx, SEPARATOR_PX,
} from '../paneLayout'
import {
  resolveDisplayTarget, paneOwnKeys, paneFollowerKeys, paneOwnersNeeded,
  volumeOverlayPaneKeys,
} from '../displayTarget'
import { symbolSource, paneOfTarget, instanceSource } from '../sourceRef'
import { makeBars } from './fakeChart'

const CHART_H = 400
const bars = makeBars()

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 600, height: CHART_H }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 600 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return CHART_H }, configurable: true })
})

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A direct series over one instrument — the thing that HOSTS a pane. */
const series = (id, sym, extra = {}) => ({
  instanceId: id, defId: 'dataSeries', hidden: false,
  inputs: { source: symbolSource(sym, 'close') },
  placement: { target: 'pane' }, ...extra,
})

/** An average, which declares `onPrice` and therefore only ever owns a pane
 *  because THIS INSTANCE said so. */
const avg = (id, source, target, extra = {}) => ({
  instanceId: id, defId: 'movingAverage', hidden: false,
  inputs: { source, period: 5, maType: 'sma' },
  ...(target ? { placement: { target } } : {}),
  ...extra,
})

const csOf = (instances) => ({ indicatorInstances: instances })

/** ⭐⭐ THE LAYOUT OPTIONS `StockChart` PASSES, SPELLED THE SAME WAY. These three
 *  sets are the whole wiring between `displayTarget` and the geometry, and a rail
 *  that built its own answer would be testing this file rather than the product.
 *  Transcribed from the call site on purpose. */
const layoutOptsFor = (instances, cs) => ({
  excludeKeys: new Set([
    ...volumeOverlayPaneKeys(instances, cs),
    ...paneFollowerKeys(instances, cs),
  ]),
  keepKeys: paneOwnersNeeded(instances, cs),
  includeKeys: paneOwnKeys(instances, cs),
})

const layoutFor = (instances, { chartHeight = CHART_H } = {}) => {
  const cs = csOf(instances)
  return computePaneLayout(instances, {
    chartHeight, hasVolumeBand: false, separatorPx: SEPARATOR_PX, firstPaneIndex: 1,
    ...layoutOptsFor(instances, cs),
  })
}

/** `resolvePlacement` with the ctx the chart hands it — `targetOf` included,
 *  because a DERIVED target is computed from the rest of the chart and the
 *  resolver is not allowed to guess it from stored fields alone. */
const placeOf = (instance, instances, layout) => {
  const cs = csOf(instances)
  return resolvePlacement(instance, engineRegistry.getDefinition(instance.defId), {
    cs,
    paneLayout: layout,
    paneMargins: layout.bands,
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
    targetOf: (i) => resolveDisplayTarget(i, cs),
  })
}

const keysOf = (layout) => layout.panes.map((p) => p.key)
const indexOf = (layout, key) => {
  const row = layout.panes.find((p) => p.key === key)
  return row ? row.index : null
}

beforeAll(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest('panes') })

// ─────────────────────────────────────────────────────────────────────────────

describe('§P10 · Own pane, for a definition that declares `price`', () => {
  it('1 · a price-declared instance asking for its own pane GETS one', () => {
    const insts = [avg('i:ma', 'close', 'pane')]
    const layout = layoutFor(insts)

    // ⛔ THE DEFINITION STILL DECLARES `price` — nothing was edited to make this
    // pass, which was the forbidden fix. The INSTANCE's active placement is what
    // makes it pane-eligible.
    expect(engineRegistry.getDefinition('movingAverage').placement.target).toBe('price')
    expect(keysOf(layout)).toEqual(['i:ma'])
    expect(placeOf(insts[0], insts, layout).paneIndex).toBe(indexOf(layout, 'i:ma'))
  })

  it('2 · …and with no such placement it stays on the candles, as it always did', () => {
    const insts = [avg('i:ma', 'close')]
    const layout = layoutFor(insts)
    expect(keysOf(layout)).toEqual([])
    const p = placeOf(insts[0], insts, layout)
    expect(p.paneIndex).toBe(0)
    // A price overlay asserts nothing on the candles' scale — unchanged.
    expect(p.scaleOptions).toBeNull()
    expect(p.autoscale).toBe('exclude')
  })

  it('3 · two own-pane instances of ONE definition are TWO panes, not one', () => {
    const insts = [series('i:a', 'QQQ'), series('i:b', 'NVDA')]
    const layout = layoutFor(insts)
    expect(keysOf(layout)).toEqual(['i:a', 'i:b'])
    expect(indexOf(layout, 'i:a')).not.toBe(indexOf(layout, 'i:b'))
  })
})

describe('§P10 · a guest draws in its host’s pane', () => {
  const host = series('i:qqq', 'QQQ')
  const guest = avg('i:ma', symbolSource('QQQ', 'close'), paneOfTarget('i:qqq'))
  const insts = [host, guest]

  it('4 · the guest resolves to the HOST’s pane index', () => {
    const layout = layoutFor(insts)
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq'))
  })

  it('5 · and reserves NO pane of its own', () => {
    const layout = layoutFor(insts)
    expect(keysOf(layout)).toEqual(['i:qqq'])
    expect(indexOf(layout, 'i:ma')).toBeNull()
  })

  it('6 · it shares the host’s scale and asserts nothing on it', () => {
    const layout = layoutFor(insts)
    const p = placeOf(guest, insts, layout)
    // ⭐ THE POINT OF JOINING A PANE is being read against the host's ladder.
    expect(p.scaleId).toBe('right')
    // ⛔ …and the host's margins are the host's. A guest that re-wrote them would
    // move the line it is drawn beside.
    expect(p.scaleOptions).toBeNull()
    expect(p.lastValue).toBe(false)
  })

  it('7 · a guest joining or leaving does not REORDER the host panes', () => {
    const two = [series('i:a', 'QQQ'), series('i:b', 'NVDA')]
    const before = layoutFor(two)
    const withGuest = layoutFor([...two, avg('i:ma', 'close', paneOfTarget('i:a'))])
    expect(keysOf(withGuest)).toEqual(keysOf(before))
    expect(withGuest.panes.map((p) => p.index)).toEqual(before.panes.map((p) => p.index))
  })
})

describe('§P10 · identity survives what a label does not', () => {
  it('8 · DUPLICATE HOSTS stay distinct, and a guest keeps the one it named', () => {
    const a = series('i:qqq1', 'QQQ')
    const b = series('i:qqq2', 'QQQ')          // same ticker, same label, same def
    const guest = avg('i:ma', 'close', paneOfTarget('i:qqq1'))
    const insts = [a, b, guest]
    const layout = layoutFor(insts)

    expect(keysOf(layout)).toEqual(['i:qqq1', 'i:qqq2'])
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq1'))
    // ⛔ NOT THE OTHER ONE. Two hosts that a LABEL cannot tell apart are exactly
    // the case a label-keyed pane would have got wrong, silently.
    expect(placeOf(guest, insts, layout).paneIndex).not.toBe(indexOf(layout, 'i:qqq2'))
  })

  it('9 · deleting the OTHER duplicate leaves the guest where it was', () => {
    const a = series('i:qqq1', 'QQQ')
    const guest = avg('i:ma', 'close', paneOfTarget('i:qqq1'))
    const insts = [a, guest]                    // `i:qqq2` removed
    const layout = layoutFor(insts)
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq1'))
  })

  it('10 · a HOST SOURCE CHANGE keeps the pane and the guest — identity is not the name', () => {
    const before = [series('i:qqq', 'QQQ'), avg('i:ma', 'close', paneOfTarget('i:qqq'))]
    const lBefore = layoutFor(before)

    // The member re-points the HOST at another instrument. Its label will read
    // NVDA; its identity is unchanged, so the pane and its guest are unchanged.
    const after = [series('i:qqq', 'NVDA'), avg('i:ma', 'close', paneOfTarget('i:qqq'))]
    const lAfter = layoutFor(after)

    expect(keysOf(lAfter)).toEqual(keysOf(lBefore))
    expect(placeOf(after[1], after, lAfter).paneIndex)
      .toBe(placeOf(before[1], before, lBefore).paneIndex)
    // ⛔ AND THE GUEST'S OWN SOURCE DID NOT MOVE WITH IT. Source and destination
    // are separate axes; re-pointing a host must not re-point its guests.
    expect(after[1].inputs.source).toBe('close')
  })
})

describe('§P10 · a host that is gone, and a host that is merely hidden', () => {
  it('11 · a DELETED host fails the guest closed — no pane 0, no other pane', () => {
    const guest = avg('i:ma', 'close', paneOfTarget('i:gone'))
    const other = series('i:other', 'NVDA')
    const insts = [other, guest]
    const layout = layoutFor(insts)

    // ⛔⛔ `null`, NOT A GUESS. Landing in pane 0 would paint it over the candles
    // on their own scale; landing in `i:other` would read the guest against a
    // ladder nobody chose. Both are worse than drawing nothing, because both
    // look like a chart that works.
    expect(placeOf(guest, insts, layout)).toBeNull()
    expect(keysOf(layout)).toEqual(['i:other'])
  })

  it('12 · and a NEW instance with the same ticker and label does NOT adopt it', () => {
    // The member deleted QQQ and added another QQQ. Same source, same name, same
    // definition — a different instance, so the orphan stays an orphan until they
    // say otherwise.
    const guest = avg('i:ma', 'close', paneOfTarget('i:qqq1'))
    const replacement = series('i:qqq2', 'QQQ')
    const insts = [replacement, guest]
    expect(placeOf(guest, insts, layoutFor(insts))).toBeNull()
  })

  it('13 · an explicit repair to Own pane brings it back', () => {
    const guest = avg('i:ma', 'close', 'pane')
    const insts = [series('i:qqq2', 'QQQ'), guest]
    const layout = layoutFor(insts)
    expect(keysOf(layout)).toContain('i:ma')
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:ma'))
  })

  it('14 · a HIDDEN host KEEPS its pane while a visible guest draws in it', () => {
    const host = series('i:qqq', 'QQQ', { hidden: true })
    const guest = avg('i:ma', 'close', paneOfTarget('i:qqq'))
    const insts = [host, guest]
    const layout = layoutFor(insts)

    // ⭐ VISIBILITY IS INK, NOT EXISTENCE. Hiding the host must not take its
    // guest with it, so the rectangle stays allocated.
    expect(keysOf(layout)).toEqual(['i:qqq'])
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq'))
  })

  it('15 · …and a hidden host with NOTHING in it reserves nothing', () => {
    const insts = [series('i:qqq', 'QQQ', { hidden: true })]
    expect(keysOf(layoutFor(insts))).toEqual([])
  })
})

describe('§P10 · source and destination are separate axes', () => {
  it('16 · an average OF QQQ may be displayed in NVDA’s pane', () => {
    const q = series('i:qqq', 'QQQ')
    const n = series('i:nvda', 'NVDA')
    // Reads QQQ, draws in NVDA's rectangle. Strange chart, the member's chart.
    const guest = avg('i:ma', symbolSource('QQQ', 'close'), paneOfTarget('i:nvda'))
    const insts = [q, n, guest]
    const layout = layoutFor(insts)

    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:nvda'))
    expect(placeOf(guest, insts, layout).paneIndex).not.toBe(indexOf(layout, 'i:qqq'))
    // ⛔ THE SOURCE IS UNTOUCHED BY THE DESTINATION.
    expect(guest.inputs.source).toBe(symbolSource('QQQ', 'close'))
  })

  it('17b · a DERIVED target needs no stored placement — MA(QQQ-series) defaults into QQQ’s pane', () => {
    const host = series('i:qqq', 'QQQ')
    // ⭐⭐ NO `placement` AT ALL. Where this draws is computed from its SOURCE:
    // an average OF an instance belongs where that instance already is. Neither
    // the instance nor the definition says so — `resolveDisplayTarget` does —
    // which is why `resolvePlacement` has to be handed that answer (`ctx.targetOf`)
    // rather than reading the stored fields and concluding `price`.
    // ⚠️ BUILT BY `instanceSource`, NOT TYPED. `parseSource` takes everything
    // between the mark and `::` as the instance id, so a hand-written
    // `@inst:<id>::value` names `inst:<id>` — a different instance that does not
    // exist, which resolves to no source and quietly falls back to the definition's
    // own default. One writer for the grammar, here as everywhere else.
    const derived = avg('i:ma', instanceSource('i:qqq', 'value'))
    expect(derived.placement).toBeUndefined()

    const insts = [host, derived]
    const layout = layoutFor(insts)
    expect(resolveDisplayTarget(derived, csOf(insts))).toBe(paneOfTarget('i:qqq'))
    expect(placeOf(derived, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq'))
    // ⛔ AND IT RESERVES NO PANE: a derived follower is a guest like any other.
    expect(keysOf(layout)).toEqual(['i:qqq'])
  })

  it('17 · a host drawn as CANDLES is the same host — presentation is not identity', () => {
    const host = series('i:qqq', 'QQQ', { presentation: { plotStyle: 'candles' } })
    const guest = avg('i:ma', symbolSource('QQQ', 'close'), paneOfTarget('i:qqq'))
    const insts = [host, guest]
    const layout = layoutFor(insts)

    expect(keysOf(layout)).toEqual(['i:qqq'])
    expect(placeOf(guest, insts, layout).paneIndex).toBe(indexOf(layout, 'i:qqq'))
  })

  it('18 · an unknown host is refused; a LEGACY `@<defId>` target still resolves', () => {
    const insts = [series('i:qqq', 'QQQ'), avg('i:ma', 'close', '@nobody')]
    const layout = layoutFor(insts)
    expect(placeOf(insts[1], insts, layout)).toBeNull()

    // ⚠️ READ COMPATIBILITY, NOT A SECOND VOCABULARY. Nothing shipped stores a
    // `@<defId>` target — a target equal to the default has its key deleted — but
    // interpreting one costs three lines and removes a silent-disappearance class.
    // An instance id always contains ':', so the two cannot be confused.
    const legacy = [series('i:qqq', 'QQQ'), avg('i:ma', 'close', '@dataSeries')]
    const lLegacy = layoutFor(legacy)
    expect(placeOf(legacy[1], legacy, lLegacy).paneIndex).toBe(indexOf(lLegacy, 'i:qqq'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE INTEGRATED HALF. Everything above resolves; this one DRAWS — a real
// `createChart`, the real binder, the real placement, and the pane a series
// actually ended up in read back off the renderer. That is the gap Phase 9 was
// caught by: every seam can be individually right while the picture is wrong.
// ─────────────────────────────────────────────────────────────────────────────

const LWC = { LineSeries, HistogramSeries, AreaSeries, BaselineSeries, LineStyle, LineType }
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
const openCharts = []

function openChart() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const raw = createChart(el, { width: 600, height: CHART_H, timeScale: { visible: false } })
  // ⛔ PANE 0 NEEDS AN OCCUPANT: LWC drops a pane the moment its last series goes,
  // so a chart whose pane 0 held only the subject would delete pane 0 on a
  // relocation and every index below would shift under the assertion.
  raw.addSeries(LineSeries, {}, 0).setData(bars.map((b) => ({ time: b.t, value: b.c })))
  const binder = createBinder({ chart: raw, LWC, registry: engineRegistry })
  const h = { el, raw, binder }
  openCharts.push(h)
  return h
}

afterEach(() => {
  while (openCharts.length) {
    const h = openCharts.pop()
    try { h.binder.teardown() } catch { /* the chart is going anyway */ }
    try { h.raw.remove() } catch { /* idem */ }
    try { h.el.remove() } catch { /* idem */ }
  }
})

async function drawInstances(h, instances) {
  const cs = csOf(instances)
  const layout = computePaneLayout(instances, {
    chartHeight: paneStackHeightPx(h.raw),
    hasVolumeBand: false,
    separatorPx: SEPARATOR_PX,
    firstPaneIndex: 1,
    ...layoutOptsFor(instances, cs),
  })
  h.binder.sync({
    enabled: true,
    cs,
    instances,
    registry: engineRegistry,
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    paneMargins: layout.bands,
    paneLayout: layout,
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
    // ⭐ BARS FOR THE SYMBOLS THESE INSTANCES NAME. A `dataSeries` whose source
    // has not resolved computes an EMPTY column, binds nothing and hosts no pane
    // — correct behaviour, and it would make every case below vacuous. The offset
    // keeps the two instruments apart in any readout.
    secondary: new Map([
      ['QQQ', { bars: bars.map((b) => ({ ...b, c: b.c + 500 })) }],
      ['NVDA', { bars: bars.map((b) => ({ ...b, c: b.c + 100 })) }],
    ]),
    targetOf: (i) => resolveDisplayTarget(i, cs),
    resolvePlacement,
  })
  await frame()
  return layout
}

/** The pane each binding's series ACTUALLY lives in, read off the renderer. */
const livePanes = (h) => {
  const out = new Map()
  for (const b of h.binder.bindings()) {
    if (!b || !b.series) continue
    let idx = null
    try { idx = b.series.getPane().paneIndex() } catch { idx = null }
    out.set(b.instanceId || (b.inst && b.inst.instanceId), idx)
  }
  return out
}

describe('§P10 · INTEGRATED — the pane a series really lands in', () => {
  it('19 · Own pane on a price-declared definition CREATES a pane and draws in it', async () => {
    const h = openChart()
    const insts = [avg('i:ma', 'close', 'pane')]
    await drawInstances(h, insts)

    const at = livePanes(h).get('i:ma')
    expect(at, 'the average was never bound at all').not.toBeNull()
    // ⛔ NOT THE CANDLES. Pane 0 is where it went for the whole of Phase 9 — by
    // drawing nothing — and where an index-0 fallback would silently put it.
    expect(at).toBeGreaterThan(0)
    expect(h.raw.panes().length).toBeGreaterThan(1)
  })

  it('20 · a guest lands in the HOST’s live pane, and adds no pane of its own', async () => {
    const h = openChart()
    const host = series('i:qqq', 'QQQ')
    const guest = avg('i:ma', 'close', paneOfTarget('i:qqq'))
    await drawInstances(h, [host, guest])

    const live = livePanes(h)
    expect(live.get('i:ma'), 'the guest was never bound').not.toBeNull()
    expect(live.get('i:ma')).toBe(live.get('i:qqq'))

    // ⭐ ONE RECTANGLE FOR THE TWO OF THEM. A guest that opened its own pane is
    // the failure this whole phase is the other half of.
    const hostOnly = openChart()
    await drawInstances(hostOnly, [series('i:qqq', 'QQQ')])
    expect(h.raw.panes().length).toBe(hostOnly.raw.panes().length)
  })

  it('21 · a DELETED host draws the guest NOWHERE — fail closed, on a real chart', async () => {
    const h = openChart()
    const before = h.raw.panes().length
    await drawInstances(h, [series('i:other', 'NVDA'), avg('i:ma', 'close', paneOfTarget('i:gone'))])

    const live = livePanes(h)
    expect(live.has('i:ma'), 'the orphaned guest was bound to SOMETHING').toBe(false)
    // …and it did not quietly become a price overlay either.
    expect(h.raw.panes().length).toBe(before + 1)   // NVDA's pane, and only that
  })
})
