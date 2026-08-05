// app/src/components/chart/engine/__tests__/flipCGeometry.test.jsx
//
// ─── FLIP C, DRIVEN ON A REAL RENDERER ──────────────────────────────────────
//
// B5 Task 10 lands the whole cutover INERT: `paneMode()` is `'bands'`, so every
// path a user is on is byte-for-byte the one they were on, and the 46-case
// zero-changed-pixel gate is what says so. That leaves one obligation this file
// exists to discharge:
//
//   ⛔ DARK CODE THAT NO TEST DRIVES IS INDISTINGUISHABLE FROM DEAD CODE.
//
// So the `'panes'` half below is not a jsdom double. It builds a REAL
// lightweight-charts 5.2.0 chart, runs the REAL binder through the REAL
// `resolvePlacement` with a REAL `computePaneLayout`, and then READS THE
// RENDERER BACK — pane count, each pane's height in pixels, each series' pane
// index and `priceScaleId`, and the order they sit in. `autoscaleOnARealScale`
// and `paneSeparatorPin` are the precedent: the one thing a double cannot tell
// you is whether lightweight-charts actually built the panes you asked for.
//
// ⚠️⚠️ THE HEIGHTS ARE rAF-SCHEDULED AND THIS IS THE THIRD TIME IT HAS MATTERED.
// `_private__adjustSizeImpl` runs from `_private__syncGuiWithModel`, which the
// invalidate handler defers to `requestAnimationFrame`. MEASURED on the installed
// bundle: a two-pane chart reads `[400, 0]` synchronously after `addSeries`, and
// reads the PREVIOUS heights synchronously after `setStretchFactor`. B5 Task 3
// nearly pinned `SEPARATOR_PX` at 0 for this reason; the plan's inline height
// assertion in `binder.js` would have thrown on every first sync for the same
// one. Every read below is behind `await frame()`.

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  createChart, LineSeries, HistogramSeries, AreaSeries, BaselineSeries,
  LineStyle, LineType,
} from 'lightweight-charts'

import { createBinder, paneHeightAlerts, __resetPaneHeightAlerts } from '../binder'
import { resolvePlacement } from '../placement'
import * as engineRegistry from '../nativeRegistry'
import { computePaneMargins } from '../../paneMargins'
import { resolveChartRegionFromPanes } from '../../chartRegion'
import {
  PANE_MODE, paneMode, __setPaneModeForTest,
  computePaneLayout, paneManifest, paneStackHeightPx, paneStretchPlan,
  SEPARATOR_PX,
} from '../paneLayout'
import { makeBars } from './fakeChart'

const CHART_H = 400
const bars = makeBars()

// ─── jsdom needs a 2D context and a non-zero layout ──────────────────────────
// The file-scoped recipe from `paneSeparatorPin.test.js`. vitest gives every test
// file its own jsdom, so these patches cannot reach another suite. Nothing here
// draws: the assertions are on the pane LAYOUT, which needs a height, not paint.
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

const frame = () => new Promise((r) => requestAnimationFrame(() => r()))

const LWC = { LineSeries, HistogramSeries, AreaSeries, BaselineSeries, LineStyle, LineType }

/** Every definition whose `placement.target` is `'pane'` — the ones that stack. */
const oscillatorIds = () => engineRegistry.listDefinitions()
  .filter((d) => d && d.placement && d.placement.target === 'pane')
  .map((d) => d.id)

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

/** A settings blob that says these oscillators are on — what `computePaneMargins`
 *  reads, and therefore what the BANDS half of every comparison is built from. */
const csWith = (ids) => ({
  indicators: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
})

// ─── the real-chart harness ──────────────────────────────────────────────────

const openCharts = []

/**
 * A live chart plus a binder, with the two chart-level calls RECORDED.
 *
 * ⛔ THE SERIES OBJECTS ARE NEVER WRAPPED. A proxy would make
 * `binder.bindings()[i].series` a different object from the one
 * `pane.getSeries()` hands back, which is exactly the identity `paneManifest`
 * matches its pool keys on and exactly the identity the #2049 case asserts with
 * `toBe`. Only `addSeries` / `removeSeries` are intercepted, and a relocation is
 * asserted by its RESULT — the same series object, in a different pane — which is
 * a stronger claim than counting a `moveToPane` call anyway.
 */
function openChart({ height = CHART_H, volumePane = false, volPct = 22 } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  // `timeScale.visible: false` takes the time-axis strip out of the height
  // budget, so the pane stack is exactly `height` and the arithmetic below is
  // readable. `paneStackHeightPx` is what the component uses either way.
  const raw = createChart(el, { width: 600, height, timeScale: { visible: false } })
  // ⛔ PANE 0 NEEDS AN OCCUPANT, AND LEAVING IT OUT IS A REAL TRAP: LWC drops a
  // pane the moment its LAST series goes, so a chart whose pane 0 holds only the
  // oscillator would DELETE pane 0 on the relocation and the stack would never
  // grow. Every real chart has candles there. Created on `raw`, so it is not in
  // `rec.addSeries` and the "nothing new was created" counts stay honest.
  const candles = raw.addSeries(LineSeries, {}, 0)
  // ⭐ THE SHIPPED CONFIGURATION. `volumeSeparatePane` is passed UNCONDITIONALLY
  // by every surface that draws a chart — ChartWidget, GridChartCell,
  // IntradayDayPopover, BottomsView and ChartRender (the parity route itself) —
  // so `firstPaneIndex` is 2 on every chart a user looks at and 1 on none of
  // them. B5 Task 10's real-LWC tests were all at 1, which is the whole reason
  // three defects reached a measurement task: a real renderer driven in a
  // configuration nobody ships is not coverage.
  const volume = volumePane ? raw.addSeries(HistogramSeries, {}, 1) : null
  if (volumePane) {
    // The same two calls StockChart's volume block makes, with the same clamped
    // percentages — which is what `abovePct` reconstructs.
    raw.panes()[0].setStretchFactor(100 - volPct)
    raw.panes()[1].setStretchFactor(volPct)
  }
  const rec = { addSeries: [], removeSeries: [] }
  const chart = {
    addSeries: (...a) => { rec.addSeries.push(a); return raw.addSeries(...a) },
    removeSeries: (s) => { rec.removeSeries.push(s); return raw.removeSeries(s) },
    panes: () => raw.panes(),
    options: () => raw.options(),
  }
  const binder = createBinder({ chart, LWC })
  const h = {
    el, raw, chart, rec, binder, candles, volume, volPct,
    firstPaneIndex: volumePane ? 2 : 1,
    abovePct: volumePane ? [100 - volPct, volPct] : [100],
    heights: () => raw.panes().map((p) => p.getHeight()),
    manifest: () => paneManifest(raw, binder.bindings()),
    seriesFor: (key) => (binder.bindings().find((b) => b.key === key) || {}).series,
    close: () => { try { binder.teardown() } catch { /* noop */ } raw.remove(); el.remove() },
  }
  openCharts.push(h)
  return h
}

/**
 * One `binder.sync` for a set of definitions, in list order, plus a frame.
 *
 * The layout is built exactly the way `StockChart.jsx` builds it — from the live
 * pane-stack height, the same `csMargins`, the same separator constant — so a
 * drift between this harness and the component is a drift in one line, not in a
 * re-implementation.
 */
async function sync(h, ids, { hasVolumeBand = false, plan = { fresh: true }, layoutOverride } = {}) {
  const instances = ids.map((id) => inst(id))
  const cs = csWith(ids)
  const paneLayout = paneMode() === 'panes'
    ? (layoutOverride !== undefined ? layoutOverride : computePaneLayout(cs, instances, {
      chartHeight: paneStackHeightPx(h.raw),
      hasVolumeBand,
      separatorPx: SEPARATOR_PX,
      // ⛔ THE TWO ARGUMENTS TASK 10's HARNESS NEVER PASSED, transcribed from
      // `StockChart.jsx`'s own call site. Defaulted to the one-pane chart, so
      // every case written before this reads exactly as it did.
      firstPaneIndex: h.firstPaneIndex,
      abovePct: h.abovePct,
    }))
    : null
  const result = h.binder.sync({
    enabled: instances.length > 0,
    cs,
    instances,
    registry: engineRegistry,
    bars,
    adjustTime: (t) => t,
    plan,
    paneMargins: computePaneMargins(cs, hasVolumeBand),
    paneLayout,
    volOverlaySet: new Set(),
    volSeparatePane: h.firstPaneIndex > 1,
    VOL_PANE_INDEX: 1,
    resolvePlacement,
  })
  await frame()
  return { paneLayout, result }
}

afterEach(() => {
  __setPaneModeForTest(null)
  while (openCharts.length) openCharts.pop().close()
})

// ─────────────────────────────────────────────────────────────────────────────
// PANE_MODE bands — the DEFAULT path is byte-identical to today
// ─────────────────────────────────────────────────────────────────────────────

describe('PANE_MODE bands — the DEFAULT path is byte-identical to today', () => {
  it('ships as the default, so the cutover is DARK until one constant moves', () => {
    // The one line Task 12 edits. If this ever reads `'panes'` on master, the
    // 46-case zero stopped being the phase's safety net and nobody said so.
    expect(PANE_MODE).toBe('bands')
    expect(paneMode()).toBe('bands')
  })

  it('resolvePlacement returns exactly what it returned before Flip C, for every pane oscillator', () => {
    const ids = oscillatorIds()
    const cs = csWith(ids)
    const bands = computePaneMargins(cs, false)
    // A layout that puts every oscillator in a pane of its own, HANDED IN on
    // purpose: in `'bands'` mode it must change nothing at all.
    const paneLayout = computePaneLayout(cs, ids.map((id) => inst(id)), {
      chartHeight: CHART_H, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    })

    let checked = 0
    for (const id of ids) {
      const def = engineRegistry.getDefinition(id)
      const scale = def.placement && def.placement.scale
      // The pre-Flip-C body, transcribed: band from `computePaneMargins`, fixed
      // range from the definition, pane 0, the definition's own scale id.
      const range = (scale && Number.isFinite(scale.min) && Number.isFinite(scale.max))
        ? { autoScale: false, minimum: scale.min, maximum: scale.max }
        : { autoScale: true }
      const before = {
        paneIndex: 0,
        scaleId: id,
        scaleOptions: { borderVisible: false, scaleMargins: { ...bands[id] }, ...range },
        autoscale: 'default',
      }
      const ctx = { paneMargins: bands, volOverlaySet: new Set(), volSeparatePane: false }
      expect(resolvePlacement(inst(id), def, { ...ctx, paneLayout }), id).toEqual(before)
      // …and the layout is IGNORED, not merely harmless: with and without it the
      // answer is the same object value.
      expect(resolvePlacement(inst(id), def, ctx), id)
        .toEqual(resolvePlacement(inst(id), def, { ...ctx, paneLayout }))
      checked++
    }
    // ⛔ NON-VACUITY. An `oscillatorIds()` that returned `[]` would pass every
    // line above without executing one of them.
    expect(checked).toBe(9)
    expect(ids).toHaveLength(9)
  })

  it('and the chart really has ONE pane, with three oscillators on it', async () => {
    const h = openChart()
    await sync(h, ['rsi', 'macd', 'stoch'])
    expect(h.raw.panes()).toHaveLength(1)
    const m = h.manifest()
    expect(m.panes).toHaveLength(1)
    // Every series on pane 0, each on its OWN named scale — the bands.
    expect(m.panes[0].series.map((s) => s.scaleId))
      .toEqual(['right', 'rsi', 'macd', 'macd', 'macd', 'stoch', 'stoch'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PANE_MODE panes — the cutover, exercised
// ─────────────────────────────────────────────────────────────────────────────

describe('PANE_MODE panes — the cutover, exercised', () => {
  it('each oscillator gets its OWN pane, in instance-list order', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['rsi', 'macd', 'stoch'])

    expect(h.raw.panes()).toHaveLength(4)            // price + three
    const m = h.manifest()
    expect(m.panes.map((p) => p.series.map((s) => s.key))).toEqual([
      [null],                                         // pane 0: the candles are not the engine's
      ['legacy:rsi::rsi'],
      ['legacy:macd::macd', 'legacy:macd::signal', 'legacy:macd::histogram'],
      ['legacy:stoch::k', 'legacy:stoch::d'],
    ])
    // Pane INDEX and price scale, read off the renderer rather than predicted.
    expect(m.panes.map((p) => p.index)).toEqual([0, 1, 2, 3])
    expect(m.panes.map((p) => p.series.map((s) => s.scaleId)))
      .toEqual([['right'], ['rsi'], ['macd', 'macd', 'macd'], ['stoch', 'stoch']])
  })

  it('a DIFFERENT instance order gives a DIFFERENT pane order — the list is the authority', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['stoch', 'rsi', 'macd'])
    expect(h.manifest().panes.map((p) => p.series.map((s) => s.key))).toEqual([
      [null],
      ['legacy:stoch::k', 'legacy:stoch::d'],
      ['legacy:rsi::rsi'],
      ['legacy:macd::macd', 'legacy:macd::signal', 'legacy:macd::histogram'],
    ])
  })

  it('INSERTION ORDER inside a pane is preserved, because insertion order IS z-order', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['macd'])
    // The definition declares macd, signal, hist in that order and the renderer
    // holds them in that order. B5 Task 9 measured a `scaleId` regression at ZERO
    // PIXELS from getting this wrong on the other axis.
    expect(h.manifest().panes[1].series.map((s) => s.key))
      .toEqual(['legacy:macd::macd', 'legacy:macd::signal', 'legacy:macd::histogram'])
    expect(h.manifest().panes[1].series.map((s) => s.type))
      .toEqual(['Line', 'Line', 'Histogram'])
  })

  it('the pane heights are the LAYOUT s heights, to the pixel', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    const { paneLayout } = await sync(h, ['rsi', 'macd'])

    expect(h.heights()).toEqual([paneLayout.pane0.heightPx, ...paneLayout.panes.map((p) => p.heightPx)])
    // …and the whole stack still adds up to the chart, separators included.
    const total = h.heights().reduce((s, x) => s + x, 0) + 2 * SEPARATOR_PX
    expect(total).toBe(CHART_H)
    // Not vacuous: the panes are real sizes, not zeros.
    expect(paneLayout.panes.map((p) => p.heightPx).every((x) => x > SEPARATOR_PX)).toBe(true)
  })

  it('the pane-0 rectangle is the SAME ABSOLUTE PIXELS the bands gave it', async () => {
    // ⭐ THE §A6 IDENTITY, on a live chart. `mainMargins` are fractions of pane
    // 0's OWN height now, and pane 0 is shorter — so the only thing that can be
    // compared is where the candles' rectangle LANDS, in chart pixels.
    __setPaneModeForTest('panes')
    const h = openChart()
    const { paneLayout } = await sync(h, ['rsi', 'macd'])

    const cs = csWith(['rsi', 'macd'])
    const bands = computePaneMargins(cs, false).main
    const pane0 = h.heights()[0]
    expect(pane0).toBe(paneLayout.pane0.heightPx)

    const topPx = Math.round(paneLayout.pane0.mainMargins.top * pane0)
    const bottomPx = Math.round((1 - paneLayout.pane0.mainMargins.bottom) * pane0)
    expect(topPx).toBe(Math.round(bands.top * CHART_H))
    expect(bottomPx).toBe(CHART_H - Math.round(bands.bottom * CHART_H))
  })

  it('a redistribution CONVERGES instead of blanking the chart — D2', async () => {
    // 🔴 THIS USED TO ASSERT A THROW, AND THE THROW WAS THE DEFECT. B5 Task 11
    // measured `paneLayout: pane 2 is 77px, expected 78px` reaching StockChart's
    // ErrorBoundary on 3 of 14 then 1 of 8 COLD LOADS while the same build minus
    // the throw produced 15 identical manifests out of 15 — the geometry was
    // right every time. So: re-apply once, and never take the chart down.
    __setPaneModeForTest('panes')
    __resetPaneHeightAlerts()
    const h = openChart()
    const { paneLayout } = await sync(h, ['rsi'])
    expect(h.heights()).toEqual([paneLayout.pane0.heightPx, paneLayout.panes[0].heightPx])

    // A layout the renderer will NOT honour: hand-drag the divider behind the
    // binder's back and then ask for the same heights again. `setStretchFactor`
    // is what the binder writes, so the only way to fake a redistribution is to
    // ask for one thing and let the chart hold another — which is exactly what a
    // renderer that stopped honouring stretch factors would look like.
    const wrong = {
      ...paneLayout,
      panes: [{ ...paneLayout.panes[0], heightPx: 7, stretchFactor: 7 }],
      pane0: { ...paneLayout.pane0, heightPx: CHART_H - 8, stretchFactor: CHART_H - 8 },
    }
    // Pass one sync that ARMS the check with `wrong` while the renderer is
    // actually told nothing new…
    h.binder.sync({
      enabled: true,
      instances: [inst('rsi')],
      registry: engineRegistry,
      bars,
      adjustTime: (t) => t,
      plan: { noop: true },
      paneMargins: computePaneMargins(csWith(['rsi']), false),
      // ⛔ the layout the binder will VERIFY, with the stretch write neutered by
      // handing it factors the renderer already holds.
      paneLayout: { ...wrong, panes: [{ ...wrong.panes[0], stretchFactor: paneLayout.panes[0].stretchFactor }] },
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      resolvePlacement,
    })
    await frame()

    // ⛔ IT RESOLVES. A one-pixel disagreement is not worth a blank chart.
    await expect(sync(h, ['rsi'])).resolves.toBeTruthy()
    await frame()
    // …and the re-apply took: the renderer is back on the layout's heights, and
    // nothing was reported, because a transient that self-corrects is not a bug.
    const after = await sync(h, ['rsi'])
    expect(h.heights()).toEqual([after.paneLayout.pane0.heightPx, after.paneLayout.panes[0].heightPx])
    expect(paneHeightAlerts()).toEqual({})
    // The chart is still a chart — the failure mode this replaced was a blank one.
    expect(h.raw.panes()).toHaveLength(2)
  })

  it('a drift that SURVIVES its own re-apply is reported by name, not swallowed', async () => {
    // ⛔ THE CONTROL FOR THE CONVERGENCE ABOVE. "Do not throw" must not become
    // "do not notice": a layout whose factors do not sum to the available height
    // can never be honoured (stretch factors are RELATIVE — LWC rescales them),
    // so it survives any number of re-applies and has to surface.
    __setPaneModeForTest('panes')
    __resetPaneHeightAlerts()
    const h = openChart()
    const { paneLayout } = await sync(h, ['rsi'])
    const impossible = {
      ...paneLayout,
      above: [200],
      panes: [{ ...paneLayout.panes[0], heightPx: 100, stretchFactor: 100 }],
      pane0: { ...paneLayout.pane0, heightPx: 200, stretchFactor: 200 },
    }
    await sync(h, ['rsi'], { layoutOverride: impossible })   // arms the check
    await sync(h, ['rsi'], { layoutOverride: impossible })   // check → re-apply
    await sync(h, ['rsi'], { layoutOverride: impossible })   // check → report
    const alerts = Object.keys(paneHeightAlerts())
    expect(alerts, 'a surviving drift must be recorded').toHaveLength(1)
    expect(alerts[0]).toMatch(/^paneLayout: pane \d+ is \d+px, expected \d+px$/)
    expect(h.raw.panes()).toHaveLength(2)                    // still drawn
  })

  it('and the height check does NOT fire when the renderer honoured the layout', async () => {
    // ⛔ THE CONTROL FOR THE CASE ABOVE. A check that throws on everything is not
    // a check; a check that can never throw is not one either. Five consecutive
    // syncs, each verifying its predecessor, none of them throwing.
    __setPaneModeForTest('panes')
    const h = openChart()
    for (let i = 0; i < 5; i++) await sync(h, ['rsi', 'macd'])
    expect(h.raw.panes()).toHaveLength(3)
  })

  it('#2049 — moving a series to a new pane REUSES it; nothing is removed', async () => {
    // ⛔ MASS `removeSeries` IS THE 2-4 s MAIN-THREAD BLOCK OF lightweight-charts
    // #2049, WHICH IS STILL OPEN. A real-panes cutover that destroyed and
    // recreated every series on the flip would BE that block, on every user's
    // first paint after Task 12.
    __setPaneModeForTest('bands')
    const h = openChart()
    await sync(h, ['rsi'])
    const before = h.seriesFor('legacy:rsi::rsi')
    expect(before).toBeTruthy()
    expect(h.raw.panes()).toHaveLength(1)
    const created = h.rec.addSeries.length
    h.rec.removeSeries.length = 0

    __setPaneModeForTest('panes')
    await sync(h, ['rsi'])

    expect(h.seriesFor('legacy:rsi::rsi')).toBe(before)      // toBe, not toEqual
    expect(h.rec.removeSeries).toEqual([])
    expect(h.rec.addSeries).toHaveLength(created)            // nothing new created
    // The control that the mode really changed — and that the SAME object is the
    // one now sitting in the new pane.
    expect(h.raw.panes()).toHaveLength(2)
    expect(h.raw.panes()[1].getSeries()).toEqual([before])
  })

  it('an oscillator turned OFF removes its pane; the stack is RE-SQUEEZED, deliberately', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['rsi', 'macd'])
    const macdH = h.heights()[2]
    expect(h.raw.panes()).toHaveLength(3)

    const { paneLayout } = await sync(h, ['macd'])
    expect(h.raw.panes()).toHaveLength(2)
    // The stack aims at 72% of WHATEVER IS IN IT, exactly as the bands did, so
    // the survivor is re-sized rather than keeping its old height.
    expect(h.heights()[1]).not.toBe(macdH)
    expect(h.heights()[1]).toBe(paneLayout.panes[0].heightPx)
    expect(h.manifest().panes[1].series.map((s) => s.key))
      .toEqual(['legacy:macd::macd', 'legacy:macd::signal', 'legacy:macd::histogram'])
  })

  it('the divider is draggable, because spec 6 requires it', async () => {
    // MEASURED against the installed renderer rather than asserted about our own
    // option object: `enableResize` defaults to true in 5.2.0, and what matters
    // is what the chart ends up holding.
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['rsi'])
    expect(h.raw.panes()).toHaveLength(2)
    expect(h.raw.options().layout.panes.enableResize).toBe(true)
  })

  it('the right-click region resolver reads REAL pane rectangles, not margin bands', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    const { paneLayout } = await sync(h, ['rsi', 'macd'])

    const keyAt = new Map(paneLayout.panes.map((p) => [p.index, p.key]))
    const panes = h.raw.panes().map((p, i) => ({ key: keyAt.get(i) || null, height: p.getHeight() }))
    const at = (y) => resolveChartRegionFromPanes({
      x: 300, y, width: 600, height: CHART_H, axisWidth: 0, timeAxisHeight: 0,
      panes, separatorHeight: SEPARATOR_PX,
    })

    // Scan the canvas and read back the regions IN ORDER.
    const seen = []
    for (let y = 0; y < CHART_H; y++) {
      const r = at(y)
      const label = r.type === 'indicator' ? r.key : r.type
      if (seen[seen.length - 1] !== label) seen.push(label)
    }
    expect(seen).toEqual(['price', 'rsi', 'macd'])

    // The middle of each REAL pane names that pane.
    const h0 = panes[0].height
    const h1 = panes[1].height
    expect(at(h0 + SEPARATOR_PX + Math.floor(h1 / 2))).toEqual({ type: 'indicator', key: 'rsi' })
    expect(at(Math.floor(h0 / 2))).toEqual({ type: 'price' })
  })

  it('an oscillator the layout gave NO pane binds nothing, rather than painting over the candles', () => {
    // Fail-closed, and it is the reason the branch returns `null`: a pane
    // oscillator that reached pane 0 with `scaleMargins: {top: 0, bottom: 0}`
    // would draw across the whole price area.
    __setPaneModeForTest('panes')
    const def = engineRegistry.getDefinition('rsi')
    const empty = computePaneLayout({}, [], { chartHeight: CHART_H, hasVolumeBand: false })
    expect(resolvePlacement(inst('rsi'), def, { paneLayout: empty })).toBeNull()
    expect(resolvePlacement(inst('rsi'), def, {})).toBeNull()
    // …and the control: with its pane present it resolves.
    const layout = computePaneLayout(csWith(['rsi']), [inst('rsi')], { chartHeight: CHART_H, hasVolumeBand: false })
    expect(resolvePlacement(inst('rsi'), def, { paneLayout: layout })).toEqual({
      paneIndex: 1,
      scaleId: 'rsi',
      scaleOptions: { borderVisible: false, scaleMargins: { top: 0, bottom: 0 }, autoScale: false, minimum: 0, maximum: 100 },
      autoscale: 'default',
    })
  })

  it('a price overlay stays in pane 0 and asserts nothing, in EITHER mode', async () => {
    __setPaneModeForTest('panes')
    const h = openChart()
    await sync(h, ['bb', 'rsi'])
    const m = h.manifest()
    expect(m.panes).toHaveLength(2)
    expect(m.panes[0].series.map((s) => s.key))
      .toEqual([null, 'legacy:bb::upper', 'legacy:bb::middle', 'legacy:bb::lower'])
    expect(m.panes[0].series.map((s) => s.scaleId)).toEqual(['right', 'right', 'right', 'right'])
    expect(m.panes[1].series.map((s) => s.key)).toEqual(['legacy:rsi::rsi'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// the stretch plan — the arithmetic behind the heights
// ─────────────────────────────────────────────────────────────────────────────

describe('paneStretchPlan', () => {
  const layout = (panes, above, firstPaneIndex = above.length) => ({
    firstPaneIndex,
    above,
    panes: panes.map((heightPx, i) => ({ key: `k${i}`, index: firstPaneIndex + i, heightPx, stretchFactor: heightPx })),
    pane0: { heightPx: above[0], stretchFactor: above[0] },
  })

  it('the factors ARE the pixel heights, and every pane gets the layout s own', () => {
    expect(paneStretchPlan(layout([60, 40], [299]), [100, 1, 1])).toEqual([299, 60, 40])
  })

  it('panes BETWEEN pane 0 and the stack take the heights the LAYOUT computed', () => {
    // 🔴 IT USED TO SPLIT A BUDGET BY THE FACTORS ALREADY ON THE CHART, and that
    // could not survive its own output: this function WRITES pixel counts, so the
    // next sync read `[353, 99]` back as if it were the 78/22 the settings say
    // and re-derived a different reference every pass. The heights are computed
    // ONCE, from settings, in `computePaneLayout`.
    const plan = paneStretchPlan(layout([60], [234, 66], 2), [78, 22, 1])
    expect(plan).toEqual([234, 66, 60])
  })

  it('it is a FIXED POINT — feeding its own output back changes nothing', () => {
    // ⛔ THE PROPERTY THE OLD PROPORTIONAL SPLIT DID NOT HAVE, and the reason the
    // volume pane could not keep its height through the cutover.
    const l = layout([60], [234, 66], 2)
    const once = paneStretchPlan(l, [78, 22, 1])
    expect(paneStretchPlan(l, once)).toEqual(once)
    expect(paneStretchPlan(l, paneStretchPlan(l, once))).toEqual(once)
  })

  it('a pane BELOW the stack is left alone — a future pane must not be crushed to zero', () => {
    expect(paneStretchPlan(layout([60], [300]), [100, 1, 42])).toEqual([300, 60, 42])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SHIPPED CONFIGURATION — firstPaneIndex > 1, on a REAL renderer
//
// B5 Task 10 said "the panes path is genuinely exercised". It was — at
// `firstPaneIndex === 1`, which is a chart this app never draws, and the first
// thing a browser did with `'panes'` was throw. Everything below builds a chart
// with a SEPARATE VOLUME PANE, which is what every surface passes.
// ─────────────────────────────────────────────────────────────────────────────

describe('the shipped configuration — a separate volume pane', () => {
  it('the layout TOTALS EXACTLY, which is the whole of D1', async () => {
    // `paneLayout: panes 0-1 total is 451px, expected 452px` — the throw that
    // blanked all 46 parity cases — is this assertion, one pixel out.
    __setPaneModeForTest('panes')
    __resetPaneHeightAlerts()
    const h = openChart({ volumePane: true })
    expect(h.firstPaneIndex).toBe(2)
    // ⚠️ TWICE, AND THE SECOND ONE IS NOT CEREMONY. `paneStackHeightPx` is itself
    // rAF-stale, so the FIRST layout of any chart is computed against a height
    // that is a pixel out — a real 400 px chart reads 401 before the renderer has
    // sized its panes. The binder converges on the next sync; the old code threw.
    await sync(h, ['rsi'])
    const { paneLayout } = await sync(h, ['rsi'])

    const heights = h.heights()
    expect(heights).toHaveLength(3)                        // candles, volume, rsi
    const total = heights.reduce((s, x) => s + x, 0) + (heights.length - 1) * SEPARATOR_PX
    expect(total).toBe(paneStackHeightPx(h.raw))
    // Every pane is the number the layout named, read off the renderer.
    expect(heights).toEqual([...paneLayout.above, ...paneLayout.panes.map((p) => p.heightPx)])
    expect(paneHeightAlerts()).toEqual({})
  })

  it('a chart with NO OSCILLATOR AT ALL totals exactly too — the other half of D1', async () => {
    // `pane0Only` had the same off-by-one with no oscillator to shave it off, so
    // a price-overlay-only chart threw as well. `bb` is a price overlay.
    __setPaneModeForTest('panes')
    __resetPaneHeightAlerts()
    const h = openChart({ volumePane: true })
    await sync(h, ['bb'])
    const { paneLayout } = await sync(h, ['bb'])
    expect(paneLayout.panes).toEqual([])
    const heights = h.heights()
    expect(heights).toHaveLength(2)
    expect(heights.reduce((s, x) => s + x, 0) + SEPARATOR_PX).toBe(paneStackHeightPx(h.raw))
    expect(heights).toEqual(paneLayout.above)
    expect(paneHeightAlerts()).toEqual({})
  })

  it('the bands-mode reference is MEASURED against the renderer, not assumed', async () => {
    // ⛔ `bandsAboveHeights` reconstructs what lightweight-charts gives a 78/22
    // two-pane chart. If that reconstruction is wrong the whole frame of
    // reference is wrong and nothing downstream can be trusted, so it is pinned
    // against the real thing rather than reasoned about.
    __setPaneModeForTest('bands')
    const h = openChart({ volumePane: true })
    await sync(h, [])
    await frame()
    const real = h.heights()
    // The layout's own reconstruction, with no oscillator: `above` IS the
    // bands-mode split.
    const reconstructed = computePaneLayout({}, [], {
      chartHeight: paneStackHeightPx(h.raw),
      hasVolumeBand: false,
      separatorPx: SEPARATOR_PX,
      firstPaneIndex: 2,
      abovePct: [78, 22],
    }).above
    expect(reconstructed).toEqual(real)
    expect(real[1]).toBeGreaterThan(0)                     // not vacuously [H, 0]
  })

  it('the VOLUME PANE KEEPS ITS HEIGHT through the cutover', async () => {
    // ⚠️ IT DID NOT BEFORE: the record's own loss list said "the volume pane
    // shrinks 117 → 99 px", because the oscillator stack was carved out of the
    // WHOLE CHART and the remainder re-split proportionally. Carved out of the
    // candle pane — which is where the band actually lived — the volume pane is
    // untouched.
    __setPaneModeForTest('bands')
    const h = openChart({ volumePane: true })
    await sync(h, ['rsi'])
    await frame()
    const bands = h.heights()
    expect(bands).toHaveLength(2)

    __setPaneModeForTest('panes')
    await sync(h, ['rsi'])
    await frame()
    const panes = h.heights()
    expect(panes).toHaveLength(3)
    expect(panes[1], 'the volume pane').toBe(bands[1])
  })

  it('the CANDLE RECTANGLE lands on the same absolute pixels — the §A6 identity, at last', async () => {
    // 🔴 D3. `pane0.mainMargins` were fractions of the price-pane BUDGET (pane 0
    // PLUS the volume pane) and were applied to the candles' OWN scale, so the
    // candle rectangle was re-fitted on every chart this app draws and
    // `price_plot` could not read 0. Both edges, to the pixel, in both modes.
    const H = 400
    const cs = csWith(['rsi'])
    const instances = [inst('rsi')]

    __setPaneModeForTest('bands')
    const h = openChart({ height: H, volumePane: true })
    await sync(h, ['rsi'])
    await frame()
    const bandsHeights = h.heights()
    const bandsMain = computePaneMargins(cs, false).main
    const bandsRect = [bandsMain.top * bandsHeights[0], (1 - bandsMain.bottom) * bandsHeights[0]]

    __setPaneModeForTest('panes')
    const layout = computePaneLayout(cs, instances, {
      chartHeight: paneStackHeightPx(h.raw),
      hasVolumeBand: false,
      separatorPx: SEPARATOR_PX,
      firstPaneIndex: 2,
      abovePct: [78, 22],
    })
    const own = layout.pane0.heightPx
    const panesRect = [
      layout.pane0.mainMargins.top * own,
      (1 - layout.pane0.mainMargins.bottom) * own,
    ]
    // Sub-pixel: the pane's own height is an integer and the band edge is not, so
    // the bottom edge can differ by the rounding and by nothing else.
    expect(Math.abs(panesRect[0] - bandsRect[0])).toBeLessThan(1)
    expect(Math.abs(panesRect[1] - bandsRect[1])).toBeLessThan(1)
    // ⛔ NON-VACUITY — and this is the number that used to be wrong. The OLD
    // divisor was the price-pane budget; using it here puts the bottom edge past
    // the pane and lightweight-charts refuses a negative margin outright.
    const budget = own + bandsHeights[1]
    expect(budget).toBeGreaterThan(own)
    expect(1 - (budget / own)).toBeLessThan(0)
    expect(bandsRect[1] - bandsRect[0]).toBeGreaterThan(50)
  })

  it('a THREE-pane-above chart (Model Book s index pane) totals exactly as well', async () => {
    // `firstPaneIndex` reaches 3 in Model Book, whose index-comparison pane is
    // hoisted to pane 0, so the candles are pane 1 — `mainPaneIndex`.
    const layout = computePaneLayout(csWith(['rsi', 'macd']), [inst('rsi'), inst('macd')], {
      chartHeight: 532,
      hasVolumeBand: false,
      separatorPx: SEPARATOR_PX,
      firstPaneIndex: 3,
      abovePct: [18, 60, 22],
      mainPaneIndex: 1,
    })
    const all = [...layout.above, ...layout.panes.map((p) => p.heightPx)]
    expect(all).toHaveLength(5)
    expect(all.reduce((s, x) => s + x, 0) + 4 * SEPARATOR_PX).toBe(532)
    expect(layout.pane0.heightPx).toBe(layout.above[1])
    expect(layout.pane0.mainMargins.top + layout.pane0.mainMargins.bottom).toBeLessThanOrEqual(1)
    expect(layout.pane0.mainMargins.bottom).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// the seam
// ─────────────────────────────────────────────────────────────────────────────

describe('the mode is read through ONE function, and nothing ships that flips it', () => {
  it('production never calls the test override, and nobody compares the constant directly', async () => {
    // ⛔ A DIRECT `PANE_MODE === 'panes'` IN A CONSUMER IS A READER THE SEAM
    // CANNOT REACH — i.e. a branch this file could never drive, which is the
    // definition of the dead code the task exists to avoid.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../../../..')      // app/src
    const offenders = { override: [], direct: [] }
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!/\.jsx?$/.test(e.name)) continue
        const rel = full.slice(root.length + 1).replace(/\\/g, '/')
        const isTest = rel.includes('__tests__') || /\.test\.jsx?$/.test(rel)
        const src = fs.readFileSync(full, 'utf8')
        const DEFINES_THE_SEAM = 'components/chart/engine/paneLayout.js'
        if (!isTest && rel !== DEFINES_THE_SEAM && src.includes('__setPaneModeForTest')) offenders.override.push(rel)
        if (!isTest && rel !== DEFINES_THE_SEAM && /PANE_MODE\s*===/.test(src)) offenders.direct.push(rel)
      }
    }
    walk(root)
    expect(offenders.override, 'production code must not reach the test seam').toEqual([])
    expect(offenders.direct, 'read the mode through paneMode(), not the constant').toEqual([])
    // ⛔ NON-VACUITY, AND IT IS THE POSITIVE HALF: the scan really walked the
    // tree, and all three consumers really do read the mode through the seam. An
    // empty walk would satisfy both `toEqual([])` above and prove nothing.
    const reads = ['components/chart/engine/placement.js',
      'components/chart/engine/binder.js',
      'components/StockChart.jsx']
    for (const rel of reads) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
      expect(src, rel).toMatch(/paneMode\(\)\s*===\s*'panes'/)
    }
  })
})
