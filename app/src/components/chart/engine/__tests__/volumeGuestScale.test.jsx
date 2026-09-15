// app/src/components/chart/engine/__tests__/volumeGuestScale.test.jsx
//
// ─── SAME PANE IS NOT SAME SCALE ────────────────────────────────────────────
//
// ⚰️ LIVE 2026-09-15, FAILURE 1. A member sent a QQQ data series into the Volume
// pane and QQQ's value appeared on VOLUME'S OWN LADDER — ~704 against an axis
// running to hundreds of millions, i.e. a flat line pinned to the floor.
//
// ⭐⭐ THE PRODUCT RULE THIS PINS: a pane is a PLACE, a scale is a UNIT. Putting
// a $704 security in the same rectangle as a 45M-share volume histogram says
// where to draw it, not what to measure it against. `placement.js` answers that
// with a LEFT axis for a volume-pane guest, so Volume keeps the right axis and
// the guest gets its own — and the two must never collapse into one scale.
//
// ⛔ DRIVEN THROUGH THE REAL BINDER AND A REAL lightweight-charts CHART, because
// `priceScaleId` is decided at series creation and then mutated on reuse
// (`applyOptions` → `moveSeriesToScale` on 5.2.0). A pure `resolvePlacement`
// assertion would prove what the engine INTENDED and say nothing about what the
// renderer is actually holding, which is the whole gap this failure lives in.

import { describe, it, expect, afterEach } from 'vitest'
import * as LWC from 'lightweight-charts'
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import * as engineRegistry from '../nativeRegistry'
import { computePaneLayout, defaultPaneKeys, paneStackHeightPx } from '../paneLayout'
import { resolvePaneOrder } from '../paneOrder'
import { addInstance, setInstanceDisplayTarget } from '../instanceControls'
import { paneOwnKeys, paneFollowerKeys, volumeOverlayPaneKeys } from '../displayTarget'
import { makeBars } from './fakeChart'

const QQQ = 'sym:QQQ:close'
const bars = makeBars(120)
const frame = () => new Promise((r) => setTimeout(r, 0))
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])

const openCharts = []
afterEach(() => {
  while (openCharts.length) {
    const h = openCharts.pop()
    try { h.binder.teardown() } catch { /* noop */ }
    try { h.raw.remove() } catch { /* noop */ }
    try { h.el.remove() } catch { /* noop */ }
  }
})

/** The shipped configuration: candles in pane 0, a REAL volume pane at 1. */
function openChart() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const raw = createChart(el, { width: 600, height: 600, timeScale: { visible: false } })
  // ⚠️ THESE EXIST TO OCCUPY THEIR PANES, and they carry data because LWC drops
  // a pane whose last series goes. `makeBars` speaks the ENGINE's shape (`t/o/h/
  // l/c/v`), so it is converted here rather than handed over raw — the binder
  // does its own conversion for the series it owns.
  const lwc = bars.map((b) => ({ time: b.t, value: b.c }))
  const candles = raw.addSeries(LineSeries, {}, 0)
  candles.setData(lwc)
  // Volume owns the RIGHT axis of its own pane — exactly what StockChart creates.
  const volume = raw.addSeries(HistogramSeries, { priceScaleId: 'right' }, 1)
  volume.setData(bars.map((b) => ({ time: b.t, value: b.v })))
  const chart = {
    addSeries: (...a) => raw.addSeries(...a),
    removeSeries: (s) => raw.removeSeries(s),
    panes: () => raw.panes(),
    options: () => raw.options(),
  }
  const binder = createBinder({ chart, LWC })
  const h = { el, raw, chart, binder, candles, volume }
  openCharts.push(h)
  return h
}

/** One binder sync built the way `StockChart.jsx` builds it. */
async function sync(h, cs) {
  const list = insts(cs)
  const exclude = new Set([...volumeOverlayPaneKeys(list, cs), ...paneFollowerKeys(list, cs)])
  const include = paneOwnKeys(list, cs)
  const order = resolvePaneOrder(cs, defaultPaneKeys(list, { excludeKeys: exclude, includeKeys: include }),
    { volumePane: true })
  const paneLayout = computePaneLayout(list, {
    order,
    chartHeight: paneStackHeightPx(h.raw),
    hasVolumeBand: false,
    excludeKeys: exclude,
    includeKeys: include,
    separatorPx: 1,
    firstPaneIndex: 2,
    abovePct: [78, 22],
  })
  const result = h.binder.sync({
    enabled: list.length > 0,
    cs,
    instances: list,
    registry: engineRegistry,
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    paneMargins: computePaneLayout(list, { hasVolumeBand: false }).bands,
    paneLayout,
    // ⭐ THE LEGACY MIRROR, AS THE COMPONENT BUILDS IT — straight off the blob.
    volOverlaySet: new Set(Array.isArray(cs.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : []),
    volSeparatePane: true,
    VOL_PANE_INDEX: 1,
    resolvePlacement,
  })
  await frame()
  return { paneLayout, result }
}

/** What the RENDERER is actually holding for this instance. */
function readBack(h, instanceId) {
  const b = h.binder.bindings().find((x) => x.key && x.key.includes(instanceId))
  if (!b || !b.series) return null
  const paneOf = (s) => h.raw.panes().indexOf(s.getPane())
  return {
    scaleId: b.series.options().priceScaleId,
    paneIndex: paneOf(b.series),
    series: b.series,
  }
}
const volumeScaleId = (h) => h.volume.options().priceScaleId
const volumePaneIndex = (h) => h.raw.panes().indexOf(h.volume.getPane())

/**
 * A data series the binder can actually COMPUTE here.
 *
 * ⚠️ PRIMARY CLOSE, NOT `sym:QQQ:close`, AND IT IS THE SAME TEST. A foreign
 * symbol needs secondary-instrument bars this harness has no way to supply —
 * measured: the layout allocates the pane and the binder reports `bound: 0`. The
 * defect under test is about SCALE OWNERSHIP, which `placement.js` decides from
 * the resolved TARGET and never from the symbol, and the unit mismatch that makes
 * the failure visible is present either way: a price near 100 against a volume
 * near 1,000,000.
 */
function qqqChart() {
  let cs = addInstance({ indicatorInstances: [] }, 'dataSeries', engineRegistry)
  const id = insts(cs)[0].instanceId
  // Its own pane, explicitly — primary close would otherwise resolve to Price.
  cs = setInstanceDisplayTarget(cs, id, 'pane', engineRegistry)
  return [cs, id]
}

describe('⭐⭐ a guest in the Volume pane keeps its OWN ladder', () => {
  it('own pane → Volume: same pane as Volume, DIFFERENT scale', async () => {
    const h = openChart()
    let [cs, id] = qqqChart()

    await sync(h, cs)
    const own = readBack(h, id)
    expect(own, 'QQQ never bound in its own pane').toBeTruthy()

    // The member sends it into the Volume pane through the canonical writer.
    cs = setInstanceDisplayTarget(cs, id, 'volume', engineRegistry)
    await sync(h, cs)
    const guest = readBack(h, id)

    expect(guest, 'QQQ vanished when it was sent to Volume').toBeTruthy()
    expect(guest.paneIndex, 'QQQ is not in the Volume pane').toBe(volumePaneIndex(h))
    // ⛔⛔ THE FAILURE: same pane AND same scale would put ~704 on a ladder that
    // runs to hundreds of millions.
    expect(guest.scaleId, 'QQQ is sharing Volume’s scale — the live failure')
      .not.toBe(volumeScaleId(h))
    expect(guest.scaleId, 'the volume-pane guest axis is the LEFT one').toBe('left')
    expect(volumeScaleId(h), 'Volume lost its own right axis').toBe('right')
  })

  it('⛔ and back again — Volume → own pane restores its own right axis', async () => {
    const h = openChart()
    let [cs, id] = qqqChart()
    await sync(h, cs)

    cs = setInstanceDisplayTarget(cs, id, 'volume', engineRegistry)
    await sync(h, cs)
    expect(readBack(h, id).scaleId).toBe('left')

    cs = setInstanceDisplayTarget(cs, id, 'pane', engineRegistry)
    await sync(h, cs)
    const back = readBack(h, id)
    expect(back, 'QQQ vanished on the way home').toBeTruthy()
    expect(back.paneIndex, 'QQQ did not get a pane of its own back')
      .not.toBe(volumePaneIndex(h))
    expect(back.scaleId).toBe('right')
  })

  it('⚰️ and the round trip does not leave a STALE series behind', async () => {
    // A second QQQ series surviving on its old scale would draw the failure even
    // when the current binding is correct.
    const h = openChart()
    let [cs, id] = qqqChart()
    await sync(h, cs)
    cs = setInstanceDisplayTarget(cs, id, 'volume', engineRegistry)
    await sync(h, cs)

    const volPane = h.raw.panes()[volumePaneIndex(h)]
    const inVolume = volPane.getSeries()
    expect(inVolume.length, `the volume pane holds ${inVolume.length} series`).toBe(2)
    expect(inVolume).toContain(h.volume)
    expect(inVolume).toContain(readBack(h, id).series)
  })

  it('⛔ a RECONSTRUCTED blob lands on the same scale as a live move', async () => {
    // The live chart came from a saved workspace, so the state that matters is
    // the one rebuilt from JSON rather than the one reached by clicking.
    const h = openChart()
    let [cs, id] = qqqChart()
    cs = setInstanceDisplayTarget(cs, id, 'volume', engineRegistry)
    const rebuilt = JSON.parse(JSON.stringify(cs))

    await sync(h, rebuilt)
    const guest = readBack(h, id)
    expect(guest, 'QQQ vanished on cold reconstruction').toBeTruthy()
    expect(guest.paneIndex).toBe(volumePaneIndex(h))
    expect(guest.scaleId, 'a reconstructed guest shares Volume’s scale')
      .not.toBe(volumeScaleId(h))
  })

  it('⛔⛔ …even when the LEGACY mirror is absent from the blob', async () => {
    // `volumeOverlayIndicators` is the old way of saying the same thing, and
    // `placement.js` reads it to choose the left axis. A blob carrying the modern
    // `placement.target: 'volume'` WITHOUT the legacy list is a shape the writers
    // can produce, and it must not fall through to a shared ladder — or to
    // nothing at all.
    const h = openChart()
    let [cs, id] = qqqChart()
    cs = setInstanceDisplayTarget(cs, id, 'volume', engineRegistry)
    const stripped = { ...JSON.parse(JSON.stringify(cs)), volumeOverlayIndicators: [] }

    await sync(h, stripped)
    const guest = readBack(h, id)
    expect(guest, 'QQQ vanished when the legacy mirror was missing').toBeTruthy()
    expect(guest.paneIndex).toBe(volumePaneIndex(h))
    expect(guest.scaleId, 'QQQ shares Volume’s scale without the legacy mirror')
      .not.toBe(volumeScaleId(h))
  })
})
