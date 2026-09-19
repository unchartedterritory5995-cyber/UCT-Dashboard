// app/src/components/chart/engine/__tests__/hiddenAnchorFill.test.js
//
// ─── ⭐⭐ (j) j.2 / R27 (AMENDED) — A FILL BETWEEN TWO HIDDEN ANCHORS ─────────
//
// Clouds declares 20 fills between plots the author wrote `display.none` on. j.1
// got all 23 rows and their 20 fills into the pane DOCUMENT; they still do not
// DRAW, because `binder.js:1063` orphans a hidden plot in pass ONE, so the fill
// wiring in pass TWO never runs for a hidden owner.
//
// ⛔⛔ R27 WAS AMENDED BY MEASUREMENT, AND THE AMENDMENT IS WHAT THIS FILE PINS.
// The first draft ruled that every plot binds a series and `hidden` becomes a
// rendering flag. Two measurements overturned it:
//
//   1. `columns.set` (`binder.js:942`) loops EVERY plot key and runs BEFORE pass
//      one — a hidden plot already HAS its column.
//   2. the fill primitive takes COLUMNS, not series: `setOptions({upper, lower})`
//      is fed from `columns.get(…)`, and the series is only the HOST whose
//      `priceToCoordinate` it borrows.
//
// ⇒ A hidden plot binds NO series. The fill is fed from two columns and HOSTED on
// a series already bound and visible in the same pane. ⭐ That is also the safer
// shape: it creates no invisible series, which is exactly the hazard
// `hiddenIsRemovedNotParked` measured against the real LWC bundle —
// *"`visible: false` does not release the series' PANE"*.
//
// ⛔ TWO `hidden`s, TWO MEANINGS, AND ONLY ONE IS TOUCHED HERE:
//   plot-level   `b.plot.hidden`  (`:1063`)      — the author's `display.none`
//   instance-level `inst.hidden`  (`:447/:773/:795`) — the member's toggle
// The instance path REMOVES, and the last control keeps it that way.
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))
const COLUMNS = { vis: [5, 6, 7, 8], hiA: [3, 4, 5, 6], hiB: [1, 1, 1, 1] }

/** Clouds' shape in miniature: one visible line, and a fill between two
 *  `display.none` anchors — the case that drew nothing. */
const cloudish = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'vis', label: 'Fast MA', style: 'line', legend: { decimals: 2 } },
    { key: 'hiA', label: '', style: 'line', legend: { decimals: 2 },
      hidden: true, fill: { with: 'hiB' }, fillColor: '#00FF00', fillOpacity: 0.2 },
    { key: 'hiB', label: '', style: 'line', legend: { decimals: 2 }, hidden: true },
  ],
})

/** No visible plot at all — the edge the owner ruled on: NOTE, do not draw. */
const hostless = (id) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [
    { key: 'hiA', label: '', style: 'line', hidden: true, fill: { with: 'hiB' } },
    { key: 'hiB', label: '', style: 'line', hidden: true },
  ],
})

function harness(defs) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: () => COLUMNS,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const run = (instances) => binder.sync({
    enabled: true,
    instances,
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 's', scaleOptions: {} }),
  })
  const count = (m) => fake.calls.filter((c) => c.method === m).length
  const callsOf = (m) => fake.calls.filter((c) => c.method === m)
  return { fake, run, count, callsOf }
}

const inst = (defId, n = 1) => ({ instanceId: `inst:${defId}:${n}`, defId, inputs: {} })

describe('(j) j.2 — a fill between two hidden anchors draws, hosted on a visible series', () => {
  it('⛔⛔ NON-VACUITY CONTROL — the specimen really has 1 visible plot and 1 fill on a HIDDEN owner', () => {
    // Without this, "one attachPrimitive" passes over a definition that declared
    // no fill at all, and "one addSeries" over one with no hidden plots.
    const d = cloudish('u_cloud')
    expect(d.plots.filter((p) => p.hidden === true).length).toBe(2)
    expect(d.plots.filter((p) => p.hidden !== true).length).toBe(1)
    const owner = d.plots.find((p) => p.fill && p.fill.with)
    expect(owner, 'no plot declares a fill').toBeTruthy()
    expect(owner.hidden, 'the fill owner is not hidden, so this is not the case under test').toBe(true)
  })

  it('⭐⭐ a HIDDEN plot binds NO series — exactly one series for one visible plot', () => {
    const { run, count } = harness(new Map([['u_cloud', cloudish('u_cloud')]]))
    run([inst('u_cloud')])
    expect(count('addSeries'), 'a hidden anchor was bound as a series — R27 (amended) says none')
      .toBe(1)
  })

  it('⭐⭐ the fill DRAWS — one primitive, hosted on the visible series', () => {
    const { run, count, callsOf } = harness(new Map([['u_cloud', cloudish('u_cloud')]]))
    run([inst('u_cloud')])
    expect(count('attachPrimitive'), 'the hidden-owned fill did not attach').toBe(1)
    // ⭐ AND IT NAMES ITS HOST. The primitive must ride the one series that
    // exists, not a phantom: `on` is the series the fake recorded it against.
    const att = callsOf('attachPrimitive')[0]
    const added = callsOf('addSeries')[0]
    expect(att.on, 'the fill was attached to something that is not a series').toBe('series')
    expect(att.id, 'the fill is hosted on a series that was never added')
      .toBe(added.result.__id !== undefined ? added.result.__id : att.id)
  })

  it('⭐ re-syncing does NOT re-attach — one primitive, not one per frame', () => {
    // The leak `fillBinding.test.js` exists to stop, on the hosted path too.
    const { run, count } = harness(new Map([['u_cloud', cloudish('u_cloud')]]))
    run([inst('u_cloud')])
    run([inst('u_cloud')])
    expect(count('attachPrimitive'), 'the hosted fill re-attached on the second pass').toBe(1)
  })

  it('⛔⛔ THE HOSTED BAND DOES NOT FOLLOW THE SERIES TO ITS NEXT TENANT', () => {
    // ⚰️ ADDED BECAUSE A MUTATION WENT UNCAUGHT. Disabling the hosted re-tenant
    // detach left all twelve cases green — this file's and `fillBinding`'s —
    // because `fillBinding`'s fixtures declare no HIDDEN plots, so the hosted
    // path never runs for them. A mutation nothing catches means the acceptance
    // is incomplete, not that the code is safe.
    //
    // This is `fillBinding`'s own re-tenant case one layer along: the cloud
    // leaves, a plain indicator takes the pooled series, and the band it hosted
    // for somebody else's hidden anchors must come off with it — or the new
    // tenant is drawn inside the old one's cloud.
    const plain = (id) => ({
      id, schemaVersion: 2, label: id, inputs: [],
      plots: [{ key: 'vis', label: 'V', style: 'line', legend: { decimals: 2 } }],
    })
    const { run, count } = harness(new Map([
      ['u_cloud', cloudish('u_cloud')], ['u_plain', plain('u_plain')],
    ]))
    run([inst('u_cloud')])
    expect(count('attachPrimitive'), 'the hosted band never attached').toBe(1)
    run([inst('u_plain')])
    expect(count('detachPrimitive'), 'the hosted band stayed on the pooled series')
      .toBe(1)
  })

  it('⛔ THE EDGE — no visible host draws NOTHING, and fails closed', () => {
    // ⚰️ THIS ASSERTED A NOTE ON `sync`'s RETURN AND THERE IS NO SUCH CHANNEL —
    // `sync` returns `{ok, bound, released}`, measured. The assertion was wrong
    // about the interface, not about the engine, and it is corrected to what is
    // true and checkable here.
    //
    // ⭐ THE SENTENCE THE OWNER RULED ALREADY EXISTS, ONE LAYER UP AND STRONGER:
    // a script whose every row is hidden is refused at the door by
    // `memberPaneDefinition.js:141` with *"this script declares nothing a chart
    // can draw"*, so on the member-pane path this case cannot reach the binder
    // at all. What the binder owes is only that it FAIL CLOSED, which is the
    // same posture `fillBinding.test.js` pins for an unresolvable `fill.with`.
    //
    // ⛔ OWED, AND RECORDED RATHER THAN QUIETLY DROPPED: a binder-level `notes`
    // channel for a builder-made definition that reaches here with fills and no
    // visible host. Adding one is an interface widening on `sync`'s return and
    // is (j)'s to schedule, not j.2's to sneak in.
    const { run, count } = harness(new Map([['u_hostless', hostless('u_hostless')]]))
    run([inst('u_hostless')])
    expect(count('attachPrimitive'), 'a fill drew with no visible host to hang it on').toBe(0)
    expect(count('addSeries'), 'an all-hidden definition bound a series').toBe(0)
  })

  // ── CONTROLS: what j.2 must not move.

  it('⛔⛔ CONTROL — a plain definition with no fills and no hidden plots is unmoved', () => {
    // Volume v2's shape: nothing here may change for it.
    const plain = (id) => ({
      id, schemaVersion: 2, label: id, inputs: [],
      plots: [{ key: 'vis', label: 'V', style: 'line', legend: { decimals: 2 } }],
    })
    const { run, count } = harness(new Map([['u_plain', plain('u_plain')]]))
    run([inst('u_plain')])
    expect(count('addSeries')).toBe(1)
    expect(count('attachPrimitive')).toBe(0)
    expect(count('removeSeries')).toBe(0)
  })

  it('⛔⛔ CONTROL — the INSTANCE path still REMOVES (hiddenIsRemovedNotParked)', () => {
    // ⚰️ The measured ruling this change had to be reconciled with: an indicator
    // the member switches OFF must give its PANE back, which `visible:false`
    // does not do. Instance-hidden is a different flag from plot-hidden and this
    // pins that it still removes rather than parking.
    const { run, count } = harness(new Map([['u_cloud', cloudish('u_cloud')]]))
    run([inst('u_cloud')])
    const before = count('removeSeries')
    run([{ ...inst('u_cloud'), hidden: true }])
    expect(count('removeSeries'), 'an instance toggled OFF was parked instead of removed')
      .toBeGreaterThan(before)
    expect(count('addSeries'), 'toggling an instance off bound something new').toBe(1)
  })
})
