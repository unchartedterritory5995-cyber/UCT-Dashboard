// app/src/components/chart/engine/__tests__/paintRender.test.js
//
// ─── B1 — `bgcolor` / `barcolor` on the chart: geometry, lifecycle, cost ───────
//
// The colour each bar takes is graded against TradingView in
// `vendorHarness.b1Paints.test.js`. This file is the drawing half, and what it
// guards is the lifecycle of a thing attached to a SHARED chart:
//   · one background primitive per `bgcolor`, attached ONCE, re-fed only when its
//     colours change, detached when the instance leaves (or its host changes);
//   · the candle overrides handed to the host ONLY when they change — a pass that
//     moves nothing calls nothing, which is the whole "no extra re-render" claim;
//   · two `barcolor`s that disagree on a bar leave that bar alone (no capture says
//     which one TradingView shows).
import { describe, it, expect } from 'vitest'
import { createBinder, paintRenderColours } from '../binder'
import { createFakeChart } from './fakeChart'
import { backgroundRuns, isClearColour, isNaColour, createBackgroundPrimitive } from '../paintPrimitive'
import { applyBarColour, applyBarColours, wrapSeriesForBarColours, reapplyBarColours, changedBarKeys } from '../barColours'

describe('backgroundRuns — the pure geometry', () => {
  const x = (t) => t * 10
  it('merges adjacent bars of one colour into one run, split where the colour changes', () => {
    const runs = backgroundRuns([0, 1, 2, 3, 4], ['red', 'red', 'blue', 'blue', 'red'], x, 10)
    expect(runs).toEqual([
      { x0: -5, x1: 15, color: 'red' },
      { x0: 15, x1: 35, color: 'blue' },
      { x0: 35, x1: 45, color: 'red' },
    ])
  })
  it('a bar with no colour — null, or the transparent `na` entry — ends a run and draws nothing', () => {
    const runs = backgroundRuns([0, 1, 2, 3], ['red', null, 'rgba(0, 0, 0, 0)', 'red'], x, 10)
    expect(runs).toEqual([{ x0: -5, x1: 5, color: 'red' }, { x0: 25, x1: 35, color: 'red' }])
  })
  it('a bar the chart cannot place (off-screen) splits a run rather than bridging it', () => {
    const runs = backgroundRuns([0, 1, 2], ['red', 'red', 'red'], (t) => (t === 1 ? null : t * 10), 10)
    expect(runs).toHaveLength(2)
  })
  it('two bars far apart on screen are never one run', () => {
    const runs = backgroundRuns([0, 1], ['red', 'red'], (t) => (t === 0 ? 0 : 100), 10)
    expect(runs).toHaveLength(2)
  })
  it('isClearColour / isNaColour — transparent draws nothing; only transparent BLACK is `na` for a bar', () => {
    expect(isClearColour('rgba(0, 0, 0, 0)')).toBe(true)
    expect(isClearColour('rgba(255, 0, 0, 0)')).toBe(true)
    expect(isClearColour('#ff000000')).toBe(true)
    expect(isClearColour('rgba(255, 0, 0, 0.3)')).toBe(false)
    expect(isNaColour('rgba(0, 0, 0, 0)')).toBe(true)
    expect(isNaColour('rgba(255, 0, 0, 0)')).toBe(false)
  })
})

describe('the candles\' own data, recoloured', () => {
  const map = new Map([['2', '#ff0000']])
  it('recolours the named bar — body, border and wick — and nothing else', () => {
    const out = applyBarColours([{ time: 1, open: 1, close: 2 }, { time: 2, open: 1, close: 2 }], map)
    expect(out[0]).toEqual({ time: 1, open: 1, close: 2 })
    expect(out[1]).toEqual({ time: 2, open: 1, close: 2, color: '#ff0000', borderColor: '#ff0000', wickColor: '#ff0000' })
  })
  it('hands back the SAME array when nothing is recoloured (no map, or no hit)', () => {
    const data = [{ time: 1, open: 1, close: 2 }]
    expect(applyBarColours(data, null)).toBe(data)
    expect(applyBarColours(data, map)).toBe(data)
  })
  it('an explicit colour already on the bar wins (a highlight the member asked for)', () => {
    expect(applyBarColour({ time: 2, open: 1, close: 2, color: '#c9a84c' }, map).color).toBe('#c9a84c')
  })
  it('a line chart\'s point is not a bar and passes untouched', () => {
    const p = { time: 2, value: 3 }
    expect(applyBarColour(p, map)).toBe(p)
  })
  it('the wrap remembers the UNcoloured payload, tracks live updates, and re-applies a changed map cheaply', () => {
    const writes = []
    const s = { setData: (d) => writes.push(['setData', d]), update: (b) => writes.push(['update', b]) }
    let current = null
    expect(wrapSeriesForBarColours(s, () => current)).toBe(true)
    expect(wrapSeriesForBarColours(s, () => current)).toBe(false) // once per series
    s.setData([{ time: 1, open: 1, close: 2 }, { time: 2, open: 1, close: 2 }])
    s.update({ time: 3, open: 1, close: 2 })                     // a live bar
    expect(s.__uctBarRaw.map((b) => b.time)).toEqual([1, 2, 3])
    // only the LAST bar's override changed → one update, never a full setData
    writes.length = 0
    let prev = current
    current = new Map([['3', '#00ff00']])
    expect(reapplyBarColours(s, prev, current)).toBe('update')
    expect(writes).toEqual([['update', { time: 3, open: 1, close: 2, color: '#00ff00', borderColor: '#00ff00', wickColor: '#00ff00' }]])
    // an older bar changed → one setData of the remembered (uncoloured) payload, recoloured
    writes.length = 0
    prev = current
    current = new Map([['1', '#0000ff'], ['3', '#00ff00']])
    expect(reapplyBarColours(s, prev, current)).toBe('setData')
    expect(writes).toHaveLength(1)
    expect(writes[0][1][0].color).toBe('#0000ff')
    expect(writes[0][1][1].color).toBeUndefined()
    // nothing changed → nothing written
    writes.length = 0
    expect(reapplyBarColours(s, current, new Map(current))).toBe('none')
    expect(writes).toEqual([])
    expect([...changedBarKeys(null, current)].sort()).toEqual(['1', '3'])
  })
})

describe('a background primitive', () => {
  it('draws one rectangle per run, full pane height, in bitmap pixels', () => {
    const h = createBackgroundPrimitive({ times: [0, 1, 2], colors: ['red', 'red', null] })
    h.primitive.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t * 10, options: () => ({ barSpacing: 10 }) }) } })
    const rects = []
    const ctx = { save() {}, restore() {}, fillRect: (...a) => rects.push([ctx.fillStyle, ...a]), fillStyle: null }
    h.primitive.paneViews()[0].renderer().draw({
      useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 300, height: 200 }, horizontalPixelRatio: 2 }),
    })
    expect(rects).toEqual([['red', -10, 0, 40, 200]])
    expect(h.primitive.paneViews()[0].zOrder()).toBe('bottom')
  })
})

// ── the binder: one primitive per bgcolor, overrides only on change ──────────

const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0, c: 1 + (i % 2) }))
const COLS = { value: [1, 2, 3, 4], cond: [1, 0, 1, 0] }

const def = (id, paints, { overlay = true, plots } = {}) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  placement: overlay ? { target: 'price' } : { target: 'pane' },
  plots: plots || [
    { key: 'value', label: 'V', style: 'line', legend: { decimals: 2 } },
    { key: 'cond', label: '', style: 'line', hidden: true },
  ],
  paints,
})

const BG = { kind: 'bgcolor', colorMode: 'column:cond', colorPalette: ['#00ff00', 'rgba(0, 0, 0, 0)'] }
const BAR = { kind: 'barcolor', color: '#ff0000' }

function harness(defs) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  const handed = []
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: () => COLS,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const run = (instances, bars = BARS, extra = {}) => binder.sync({
    enabled: instances.length > 0,
    instances,
    registry,
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }),
    priceSeries: () => candles,
    setBarColours: (m) => handed.push(m),
    ...extra,
  })
  const calls = (m) => fake.calls.filter((c) => c.method === m)
  return { fake, binder, run, calls, handed, candles }
}
const inst = (defId) => ({ instanceId: `i:${defId}`, defId, inputs: {} })

describe('the binder draws paints', () => {
  it('⭐ one background primitive per bgcolor, on the instance\'s OWN series, colours from its column', () => {
    const h = harness(new Map([['u_a', def('u_a', [BG])]]))
    h.run([inst('u_a')])
    const att = h.calls('attachPrimitive')
    expect(att).toHaveLength(1)
    expect(att[0].id).not.toBe(h.candles.__id)
    // the column holds the palette INDEX: cond = [1, 0, 1, 0] → entry 1 (`na`), entry 0 (green)
    expect(att[0].args[0].options().colors).toEqual(['rgba(0, 0, 0, 0)', '#00ff00', 'rgba(0, 0, 0, 0)', '#00ff00'])
  })

  it('⛔⛔ a second and third pass over the same bars attach nothing more and re-feed nothing', () => {
    const h = harness(new Map([['u_a', def('u_a', [BG])]]))
    h.run([inst('u_a')])
    const prim = h.calls('attachPrimitive')[0].args[0]
    const before = prim.options()
    h.run([inst('u_a')])
    h.run([inst('u_a')])
    expect(h.calls('attachPrimitive')).toHaveLength(1)
    expect(prim.options()).toBe(before) // not even a setOptions: the same object
  })

  it('a paint-only overlay instance binds no series and shades the PRICE pane, through the candles', () => {
    const d = def('u_b', [BG], { plots: [{ key: 'cond', label: '', style: 'line', hidden: true }] })
    const h = harness(new Map([['u_b', d]]))
    h.run([inst('u_b')])
    const att = h.calls('attachPrimitive')
    expect(att).toHaveLength(1)
    expect(att[0].id).toBe(h.candles.__id)
  })

  it('⛔ the paint leaves with its instance — the background is detached', () => {
    const h = harness(new Map([['u_a', def('u_a', [BG])], ['u_p', def('u_p', [])]]))
    h.run([inst('u_a')])
    h.run([inst('u_p')])
    expect(h.calls('detachPrimitive')).toHaveLength(1)
  })

  it('⛔ …and with the LAST instance gone (a disabled sync), a paint-only background and its candle colours go too', () => {
    const d = def('u_b', [BG, BAR], { plots: [{ key: 'cond', label: '', style: 'line', hidden: true }] })
    const h = harness(new Map([['u_b', d]]))
    h.run([inst('u_b')])
    expect(h.calls('attachPrimitive')).toHaveLength(1)
    h.run([])
    expect(h.calls('detachPrimitive')).toHaveLength(1)
    expect(h.handed[h.handed.length - 1]).toBeNull()
  })

  it('⭐ barcolor: the overrides are handed to the host ONCE, and a pass that changes nothing hands nothing', () => {
    const h = harness(new Map([['u_c', def('u_c', [BAR])]]))
    h.run([inst('u_c')])
    expect(h.handed).toHaveLength(1)
    expect([...h.handed[0].values()]).toEqual(['#ff0000', '#ff0000', '#ff0000', '#ff0000'])
    h.run([inst('u_c')])
    h.run([inst('u_c')])
    expect(h.handed).toHaveLength(1)
  })

  it('⛔ a chart with no paint never calls the host at all', () => {
    const h = harness(new Map([['u_p', def('u_p', [])]]))
    h.run([inst('u_p')])
    h.run([inst('u_p')])
    expect(h.handed).toEqual([])
    expect(h.calls('attachPrimitive')).toEqual([])
  })

  it('⭐ F1 — an `na` bar of the later barcolor leaves the earlier one standing (CAP round 4 P1/P2)', () => {
    // P1 red on every bar, P2 blue where cond = [1,0,1,0] picks palette entry 1:
    // TradingView paints the later call where it has a colour and the earlier one
    // where it is `na`.
    const later = { kind: 'barcolor', colorMode: 'column:cond', colorPalette: ['rgba(0, 0, 0, 0)', '#0000ff'] }
    const h = harness(new Map([['u_d', def('u_d', [BAR, later])]]))
    const res = h.run([inst('u_d')])
    expect([...h.handed[0].entries()]).toEqual([
      [String(BARS[0].t), '#0000ff'], [String(BARS[1].t), '#ff0000'],
      [String(BARS[2].t), '#0000ff'], [String(BARS[3].t), '#ff0000'],
    ])
    expect(res.paints.conflicts).toBe(0)
  })

  it('⭐ RT6 — within ONE script the LATER barcolor wins (CAP round 4 P1/P2 screenshot)', () => {
    const other = { kind: 'barcolor', colorMode: 'column:cond', colorUp: '#ff0000', colorDown: '#0000ff' }
    const h = harness(new Map([['u_d', def('u_d', [BAR, other])]]))
    const res = h.run([inst('u_d')])
    // cond = [1,0,1,0]: the later paint's colour on every bar — red, blue, red, blue
    expect([...h.handed[0].values()]).toEqual(['#ff0000', '#0000ff', '#ff0000', '#0000ff'])
    expect(res.paints.conflicts).toBe(0)
  })

  it('⭐⭐ RT6 — a plot coloured by a packed column draws each bar run colour, and an `na` colour draws NOTHING (not the series colour)', () => {
    const plots = [
      { key: 'value', label: 'V', style: 'line', color: '#c9a84c', legend: { decimals: 2 }, colorMode: 'column:pc', colorPacked: {} },
      { key: 'pc', label: '', style: 'line', hidden: true },
    ]
    const cols = { value: [1, 2, 3, 4], pc: [0x0000ff00 + 0x33, NaN, 0x000000ff, NaN] }
    const fake2 = harness(new Map([['u_k', def('u_k', [], { plots })]]))
    fake2.run([inst('u_k')], BARS, {
      registry: {
        getDefinition: (id) => (id === 'u_k' ? def('u_k', [], { plots }) : null),
        computeFor: () => cols,
        hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
        columnKeys: (d) => (d.plots || []).map((p) => p.key),
      },
    })
    const sets = fake2.calls('setData').map((c) => c.args[0]).filter((d) => Array.isArray(d) && d.length === 4 && d[0].value === 1)
    expect(sets.length).toBeGreaterThan(0)
    const pts = sets[sets.length - 1]
    expect(pts.map((x) => x.color)).toEqual(['#33FF00', 'rgba(0, 0, 0, 0)', '#FF0000', 'rgba(0, 0, 0, 0)'])
  })

  it('⛔ two DIFFERENT scripts that disagree on a bar leave THAT bar alone; where they agree it is drawn', () => {
    const other = { kind: 'barcolor', colorMode: 'column:cond', colorUp: '#ff0000', colorDown: '#0000ff' }
    const h = harness(new Map([['u_d', def('u_d', [BAR])], ['u_e', def('u_e', [other])]]))
    const res = h.run([inst('u_d'), inst('u_e')])
    // cond = [1,0,1,0]: bars 0 and 2 agree (red/red), bars 1 and 3 disagree (red/blue)
    expect([...h.handed[0].keys()]).toEqual([String(BARS[0].t), String(BARS[2].t)])
    expect(res.paints.conflicts).toBe(2)
  })

  it('⭐ F1 — `offset` and `show_last` place the colour at RENDER time (paintRenderColours)', () => {
    const c = ['a', 'b', 'c', 'd']
    expect(paintRenderColours({}, c, 4)).toBe(c)
    expect(paintRenderColours({ offset: 1 }, c, 4)).toEqual([null, 'a', 'b', 'c'])
    expect(paintRenderColours({ offset: -2 }, c, 4)).toEqual(['c', 'd', null, null])
    expect(paintRenderColours({ showLast: 2 }, c, 4)).toEqual([null, null, 'c', 'd'])
    expect(paintRenderColours({ showLast: 0 }, c, 4)).toEqual([null, null, null, null])
    const h = harness(new Map([['u_o', def('u_o', [{ ...BAR, offset: 1, showLast: 2 }])]]))
    h.run([inst('u_o')])
    expect([...h.handed[0].keys()]).toEqual([String(BARS[2].t), String(BARS[3].t)])
  })

  it('a hidden instance (and the declutter toggle) draws no paint', () => {
    const h = harness(new Map([['u_a', def('u_a', [BG, BAR])]]))
    h.run([{ ...inst('u_a'), hidden: true }, inst('u_p')])
    expect(h.calls('attachPrimitive')).toEqual([])
    const h2 = harness(new Map([['u_a', def('u_a', [BG, BAR])]]))
    h2.run([inst('u_a')], BARS, { indicatorsHidden: true })
    expect(h2.calls('attachPrimitive')).toEqual([])
  })
})
