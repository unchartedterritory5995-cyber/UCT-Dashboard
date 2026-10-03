// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f4SpyDrawings.test.js
//
// ─── F4 (2026-10-03, step 85) — the CAP3 SPY 1D drawing and table divergences ───
//
// CAP3 captured AMEX:SPY 1D (1,800 bars from 2019-08-06, NOT from SPY's 1993
// listing) for the census attaches and pinned what diverges. This file says, per
// script, WHY each drawing divergence exists, and proves it from the capture's own
// record — never from our output alone:
//
//   (a) WINDOW — TradingView ran the script over SPY's whole history, so objects it
//       made before our first bar exist on its side. Proved by TradingView's own
//       creation counter (the capture's `id` is one counter across lines, labels and
//       boxes, and so is ours, `nextId`): every object we hold is TradingView's at
//       one fixed id offset, and the ones we lack carry ids BELOW that offset, i.e.
//       were made before our bar 0. Where a script makes one object per bar the
//       offset is exact arithmetic: SPY's bar_index of our bar 0 is read off
//       `vw-offset-na-spy-1d-2026-09-30` (its `bar_index` control row reads 8175 on
//       2025-07-23), and Pine's collector (cap + 5, oldest go until cap) then
//       predicts BOTH sides' counts from creation totals alone.
//   (b) COLLECTOR — counts that differ only by where the collector's cycle stands;
//       with a window not from the listing that is the same history-length cause.
//   (c) ENGINE — a step this door cannot serve; withheld by name in the door
//       (`objectDiagnostics`), owned by the lane named beside it.
//
// The two engine bugs F4 FIXED are railed where they live
// (`ast/pineLibraryValueFnName.test.js`, `objectTextNa` below) and graded here on
// all-chart-patterns SPY (the library store, opt-in PINE_LIBRARY_STORE).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { loadPineLibraryStore } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { clearPineLibraries } from '../../ast/pineLibraryStore'
import { translatePine } from '../../ast/pine.js'

afterEach(() => { vi.unstubAllEnvs(); clearPineLibraries() })
const T = 600000
const STORE_DIR = process.env.PINE_LIBRARY_STORE || ''

const cap = (id) => {
  const c = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
  expect(c, `${id} is a v1 capture`).toBeTruthy()
  return c
}
const objectsPane = () => vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
const graded = (id) => { objectsPane(); return gradeCapture(cap(id)).verdict }
const ours = (id) => { objectsPane(); const o = runOurSide(cap(id)); expect(o.ok, o.refusal).toBe(true); return o }
const family = (v, f) => v.objects.counts.find((c) => c.family === f)

/** What the door carried for a corpus script's drawing (diagnostics only). */
function doorDiagnostics(c) {
  objectsPane()
  const door = enterMemberDoor(c.source.text)
  try {
    return (door.built && door.built.translation && door.built.translation.objectDiagnostics) || {}
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

const r4 = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'na' : String(Math.round(v * 1e4) / 1e4))
/** Every vendor object as {f, id, y, x, t}, in creation order. */
const vendorObjects = (c) => {
  const r = c.objects.records
  return [
    ...(r.lines || []).map((l) => ({ f: 'line', id: l.id, y: [l.y1, l.y2], x: [l.x1, l.x2], t: '' })),
    ...(r.labels || []).map((l) => ({ f: 'label', id: l.id, y: [l.y], x: [l.x], t: String(l.t ?? '') })),
    ...(r.boxes || []).map((b) => ({ f: 'box', id: b.id, y: [b.y1, b.y2], x: [b.x1, b.x2], t: String(b.t ?? '') })),
  ].sort((a, b) => a.id - b.id)
}
/** Every object our object lane holds at the last bar, same shape. */
const ourObjects = (o) => (o.objects.held || []).filter((h) => ['line', 'label', 'box'].includes(h.family)).map((h) => {
  const p = h.props
  if (h.family === 'line') return { f: 'line', id: h.id, y: [p.y1, p.y2], x: [p.x1, p.x2], t: '' }
  if (h.family === 'label') return { f: 'label', id: h.id, y: [p.y], x: [p.x], t: String(p.text ?? '') }
  return { f: 'box', id: h.id, y: [p.top, p.bottom], x: [p.left, p.right], t: String(p.text ?? '') }
}).sort((a, b) => a.id - b.id)
const key = (o) => `${o.f}|${o.t}|${o.y.map(r4).join(',')}`
const windowRange = (c) => {
  const lo = c.bars.fields.indexOf('low')
  const hi = c.bars.fields.indexOf('high')
  return { minLow: Math.min(...c.bars.rows.map((r) => r[lo])), maxHigh: Math.max(...c.bars.rows.map((r) => r[hi])) }
}
const outsideWindow = (v, { minLow, maxHigh }) => {
  const ys = v.y.filter((y) => y !== null && y !== undefined && !Number.isNaN(y))
  return ys.length > 0 && (Math.max(...ys) < minLow || Math.min(...ys) > maxHigh)
}
/** Pine's collector on one family that creates `k` objects, none spared: nothing
 *  goes until a create takes it past cap + 5, then the oldest go until cap remain
 *  (`objectRuntime.js::collect`, triage C7). */
const heldAfter = (k, cap5) => (k <= cap5 + 5 ? k : cap5 + ((k - cap5 - 6) % 6))

/** SPY's bar_index of a capture's first bar, from TradingView's own `bar_index`
 *  control row in `vw-offset-na-spy-1d-2026-09-30` (8175 on 2025-07-23). */
function spyBarIndexOfFirstBar(c) {
  const w = cap('vw-offset-na-spy-1d-2026-09-30')
  const at = w.plotValues.fields.indexOf('plot_0')
  expect(w.study.plots[0].title).toBe('E00_bar_index_CONTROL')
  const [t0, bi0] = [w.plotValues.rows[0][0], w.plotValues.rows[0][at]]
  // the witness reads 0, 1, 2 … on consecutive bars: it IS TradingView's counter
  w.plotValues.rows.forEach((r, k) => expect(r[at]).toBe(bi0 + k))
  const i = c.bars.rows.findIndex((r) => r[0] === t0)
  expect(i, 'the witness bar is inside this capture').toBeGreaterThan(0)
  // the two captures hold the same bars from there on
  w.bars.rows.forEach((r, k) => expect(c.bars.rows[i + k][0]).toBe(r[0]))
  return bi0 - i
}

// ─── (a) WINDOW — proved exactly ────────────────────────────────────────────────
describe('F4 — contraction-box-doji-lines SPY: lines 204/178, boxes 53/54 are the WINDOW, to the object', () => {
  const ID = 'contraction-box-doji-lines-spy-1d-2026-10-03'

  it('every object we hold is TradingView\'s at id + 7345, but one box the collector\'s cycle keeps on our side only', () => {
    const c = cap(ID)
    const V = new Map(vendorObjects(c).map((v) => [v.id, v]))
    const O = ourObjects(ours(ID))
    const OFF = 7345
    const misses = O.filter((o) => !(V.has(o.id + OFF) && key(V.get(o.id + OFF)) === key(o)))
    expect(O.length).toBe(232)
    expect(misses.map((o) => o.f)).toEqual(['box'])
    // …and it is the OLDEST box we hold: the one TradingView's collector, at its
    // own point in the cycle, has already taken
    expect(misses[0].id).toBe(Math.min(...O.filter((o) => o.f === 'box').map((o) => o.id)))
    // non-vacuity: the offset is a real pairing — on the 178 doji LINES (each at its
    // own price; an `na` box pairs with any `na` box) a neighbouring offset pairs none
    const lines = O.filter((o) => o.f === 'line')
    expect(lines.length).toBe(178)
    expect(lines.filter((o) => V.has(o.id + OFF + 1) && key(V.get(o.id + OFF + 1)) === key(o)).length).toBe(0)
  }, T)

  it('TradingView\'s 26 objects we lack were all created BEFORE our bar 0 (ids <= 7345), all lines', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const pre = V.filter((v) => v.id <= 7345)
    expect(pre.length).toBe(26)
    expect(new Set(pre.map((v) => v.f))).toEqual(new Set(['line']))
  }, T)

  it('⭐ the arithmetic: SPY bar 6677 is our bar 0; one box per bar ⇒ 668 doji lines before it; the collector predicts all four counts', () => {
    const c = cap(ID)
    const B0 = spyBarIndexOfFirstBar(c)
    expect(B0).toBe(6677)
    // `box.new` runs on EVERY bar, so of the 7345 objects TradingView made before
    // our window, exactly B0 are boxes and the rest are doji lines
    const linesBefore = 7345 - B0
    expect(linesBefore).toBe(668)
    const v = graded(ID)
    const oursLines = family(v, 'lines').ours
    expect(family(v, 'lines')).toMatchObject({ vendor: heldAfter(linesBefore + oursLines, 200), ours: heldAfter(oursLines, 200) })
    expect(family(v, 'boxes')).toMatchObject({ vendor: heldAfter(B0 + c.bars.count, 50), ours: heldAfter(c.bars.count, 50) })
    // the numbers those formulas give, written once so the rail cannot pass vacuously
    expect([family(v, 'lines').vendor, family(v, 'lines').ours, family(v, 'boxes').vendor, family(v, 'boxes').ours]).toEqual([204, 178, 53, 54])
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('contraction-box-doji-lines-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})

describe('F4 — high-low-open-mid-ranges SPY: labels 504/502 is the collector\'s cycle (a WINDOW)', () => {
  const ID = 'high-low-open-mid-ranges-spy-1d-2026-10-03'

  it('all 1005 objects we hold are TradingView\'s at id + 92609; the 2 it holds beyond ours are its two OLDEST labels', () => {
    const c = cap(ID)
    const Vs = vendorObjects(c)
    const V = new Map(Vs.map((v) => [v.id, v]))
    const O = ourObjects(ours(ID))
    const OFF = 92609
    expect(O.length).toBe(1005)
    expect(O.filter((o) => !(V.has(o.id + OFF) && key(V.get(o.id + OFF)) === key(o)))).toEqual([])
    const ourIds = new Set(O.map((o) => o.id + OFF))
    const extra = Vs.filter((v) => !ourIds.has(v.id))
    expect(extra.map((v) => v.t)).toEqual(['LO | 529.57', 'LM | 528.895'])
    expect(Math.max(...extra.map((v) => v.id))).toBeLessThan(Math.min(...[...ourIds]))
  }, T)

  it('both label counts sit inside Pine\'s collector band [500, 505] (max_labels_count = 500): where the cycle stands depends on how many labels came before', () => {
    const v = graded(ID)
    for (const n of [family(v, 'labels').vendor, family(v, 'labels').ours]) {
      expect(n).toBeGreaterThanOrEqual(500)
      expect(n).toBeLessThanOrEqual(505)
    }
    expect(family(v, 'lines').agree).toBe(true)
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES, labels 504/504', () => {
    const v = graded('high-low-open-mid-ranges-rddt-1d-2026-09-28')
    expect(v.objects.verdict).toBe('MATCH')
    expect(family(v, 'labels')).toMatchObject({ vendor: 504, ours: 504 })
  }, T)
})

describe('F4 — artemis-oscillator-pro SPY: lines 171/33, labels 198/38 are the WINDOW', () => {
  const ID = 'artemis-oscillator-pro-spy-1d-2026-10-03'

  it('our 71 objects are TradingView\'s 299..369 exactly; its 298 others were made first AND lie wholly below the window\'s lowest low', () => {
    const c = cap(ID)
    const Vs = vendorObjects(c)
    const V = new Map(Vs.map((v) => [v.id, v]))
    const O = ourObjects(ours(ID))
    expect(O.length).toBe(71)
    expect(O.every((o) => V.has(o.id + 298) && key(V.get(o.id + 298)) === key(o))).toBe(true)
    const pre = Vs.filter((v) => v.id <= 298)
    expect(pre.length).toBe(298)
    const range = windowRange(c)
    expect(pre.filter((v) => outsideWindow(v, range)).length).toBe(298)
  }, T)

  it('control: RDDT (from the listing) lines 13/13, labels 17/17; the table cells are a different cause (below)', () => {
    const v = graded('artemis-oscillator-pro-rddt-1d-2026-09-28')
    expect(family(v, 'lines')).toMatchObject({ vendor: 13, ours: 13 })
    expect(family(v, 'labels')).toMatchObject({ vendor: 17, ours: 17 })
  }, T)
})

describe('F4 — institutional-smc SPY: lines 198/34, labels 449/81 are the WINDOW (+ the owner-gated warm-up, + a converging ATR)', () => {
  const ID = 'institutional-smc-order-flow-matrix-pro-spy-1d-2026-10-03'

  it('nothing we lack was made after the warm-up: every vendor object we lack is outside the window\'s price range (pre-window) or ranked before our bar 250 (pre-window, or inside the owner-gated 250-bar curtain)', () => {
    const c = cap(ID)
    const V = vendorObjects(c)
    const O = ourObjects(ours(ID))
    // in-order pairing by value (family, caption, price)
    let j = 0
    const paired = new Map()
    const unpaired = []
    for (const o of O) {
      let k = j
      while (k < V.length && key(V[k]) !== key(o)) k += 1
      if (k < V.length) { paired.set(k, o); j = k + 1 } else unpaired.push(o)
    }
    expect(paired.size).toBe(116)
    // the two we hold unpaired are ITH/ITL badges at `high[k] + atr * 0.25` on bars
    // 31 and 41 — the ATR (an RMA) seeded at our bar 0 has not converged yet; the
    // vendor holds the same badge a hair away (a converging prefix, F2's class)
    expect(unpaired.map((o) => o.t)).toEqual(['ITH', 'ITL'])
    for (const o of unpaired) {
      const twin = V.find((v) => v.t === o.t && Math.abs(v.y[0] - o.y[0]) < 0.01)
      expect(twin, `${o.t} ${o.y[0]}`).toBeTruthy()
    }
    // the vendor's x is a dense rank over the x positions it holds; map our bar
    // positions onto it through the pairs
    const rankOf = new Map()
    for (const [k, o] of paired) o.x.forEach((x, i) => { if (Number.isFinite(x)) rankOf.set(x, V[k].x[i]) })
    const ourXs = [...rankOf.keys()].sort((a, b) => a - b)
    const firstX = ourXs[0]
    // ⚠️ the dense rank cannot separate "before our bar 0" from "our bars 0 … 249":
    // both are BEFORE the curtain lifts, and neither is a drawing we make wrong
    expect(firstX).toBeGreaterThan(0)
    const warmX = ourXs.find((x) => x >= 250)
    const warmRank = rankOf.get(warmX)
    const range = windowRange(c)
    const twins = new Set(unpaired.map((o) => V.find((v) => v.t === o.t && Math.abs(v.y[0] - o.y[0]) < 0.01).id))
    const extras = V.filter((v, k) => !paired.has(k) && !twins.has(v.id))
    const maxRank = (v) => Math.max(...v.x.filter((x) => x !== null && x !== undefined))
    const outside = extras.filter((v) => outsideWindow(v, range))
    const early = extras.filter((v) => !outsideWindow(v, range) && maxRank(v) < warmRank)
    const late = extras.filter((v) => !outsideWindow(v, range) && maxRank(v) >= warmRank)
    expect(late.map(key)).toEqual([])
    expect([extras.length, outside.length, early.length]).toEqual([532, 474, 58])
    // (C16 pins the same curtain on RDDT: `PINE_STATE_WARMUP`, owner-gated)
  }, T)

  it('control: on RDDT (from the listing) the same script MATCHES', () => {
    expect(graded('institutional-smc-order-flow-matrix-pro-rddt-1d-2026-09-28').objects.verdict).toBe('MATCH')
  }, T)
})

// ─── (c) ENGINE — fixed by F4 ───────────────────────────────────────────────────
describe('F4 — all-chart-patterns-theeccentrictrader SPY: lines 100/42, labels 56/22 were TWO engine bugs, both fixed', () => {
  it('`text = na` on a label is the empty string, as TradingView holds it (it printed "NaN")', () => {
    const src = '//@version=6\nindicator("t", overlay=true)\nvar l = label.new(na, na, text = na)\nvar m = label.new(na, na, text = str.tostring(na))\nplot(close)\n'
    const t = translatePine(src, { mode: 'host' })
    const creates = (t.objects.ops || []).filter((o) => o.k === 'create' && o.family === 'label')
    expect(creates.length).toBe(2)
    expect(creates[0].props.text).toEqual({ v: 'text', node: { t: 'lit', s: '' } })
    // control: `str.tostring(na)` is a number's text and still prints "NaN" (F3)
    expect(creates[1].props.text.node.t).toBe('num')
  })

  describe.skipIf(!STORE_DIR)('with the library store (opt-in PINE_LIBRARY_STORE)', () => {
    const ID = 'all-chart-patterns-theeccentrictrader-spy-1d-2026-10-03'
    const withStore = (fn) => { loadPineLibraryStore(STORE_DIR); try { return fn() } finally { clearPineLibraries() } }

    it('the door carries every pattern\'s guard (no `pine:function __lib3_rlut` refusal)', () => {
      const d = withStore(() => doorDiagnostics(cap(ID)))
      expect(d.dropReasons).toEqual({})
      expect(d.attemptedOps).toBeGreaterThan(400)
    }, T)

    it('⭐ the whole capture MATCHES, and every one of the 156 objects is TradingView\'s, id for id', () => {
      const v = withStore(() => graded(ID))
      expect(v.verdict, v.objects && v.objects.reason).toBe('MATCH')
      const o = withStore(() => ours(ID))
      const V = new Map(vendorObjects(cap(ID)).map((x) => [x.id, x]))
      const O = ourObjects(o)
      expect(O.length).toBe(156)
      expect(O.filter((x) => !(V.has(x.id) && key(V.get(x.id)) === key(x))).map(key)).toEqual([])
    }, T)
  })
})

// ─── (c) ENGINE — withheld by name, owned elsewhere ─────────────────────────────
describe('F4 — what is withheld by name on the SPY captures, and whose it is', () => {
  it('atr-support-and-resistance: the four extend/break loops read a float array (`pine:block`) — every zone withheld (C45); RDDT 20/0 + 20/0 is the same cause; 219 of SPY\'s 306 lines are pre-window anyway', () => {
    const c = cap('atr-support-and-resistance-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.dropReasons).toEqual({ 'guard:loop': 4, 'coll:diverged': 12, 'geometry:lost': 4, 'geometry:withheld': 4 })
    expect(d.guardRefusals.every((g) => / pine:block /.test(g))).toBe(true)
    const range = windowRange(c)
    expect(vendorObjects(c).filter((v) => v.f === 'line' && outsideWindow(v, range)).length).toBe(219)
    const r = graded('atr-support-and-resistance-rddt-1d-2026-09-28')
    expect([family(r, 'lines').ours, family(r, 'boxes').ours]).toEqual([0, 0])
  }, T)

  it('liquidity-heatmap: all 14 label creates read a request the door cannot serve (`pine:request`, lower timeframes); 305 of SPY\'s 421 labels are pre-window anyway', () => {
    const c = cap('liquidity-heatmap-nephew-sam-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.dropReasons).toEqual({ 'guard:create': 14 })
    expect(d.guardRefusals.every((g) => / pine:request$/.test(g))).toBe(true)
    const range = windowRange(c)
    expect(vendorObjects(c).filter((v) => v.f === 'label' && outsideWindow(v, range)).length).toBe(305)
  }, T)

  it('htf-candle-footprint: the levels read a user-defined type (`pine:type` `HL.size`); the 3 boxes we draw are TradingView\'s, id + 5', () => {
    const c = cap('htf-candle-footprint-cartel-console-spy-1d-2026-10-03')
    const d = doorDiagnostics(c)
    expect(d.createDropWhy.every((w) => /pine:type .*`HL\.size`/.test(w))).toBe(true)
    const V = new Map(vendorObjects(c).map((v) => [v.id, v]))
    const O = ourObjects(ours('htf-candle-footprint-cartel-console-spy-1d-2026-10-03'))
    expect(O.map((o) => o.f)).toEqual(['box', 'box', 'box'])
    expect(O.every((o) => V.has(o.id + 5) && key(V.get(o.id + 5)) === key(o))).toBe(true)
  }, T)

  it('artemis tables: five cells read the KNN state (`cell:text`, runtime:call-windowed-state); htf-liquidity: 27 cells read other symbols (`pine:request`); ema-ribbon: 11 cells read 15/60/240-minute requests (`cell:text`)', () => {
    const a = doorDiagnostics(cap('artemis-oscillator-pro-spy-1d-2026-10-03'))
    expect(a.dropReasons).toEqual({ 'cell:text': 5 })
    const h = doorDiagnostics(cap('htf-liquidity-dashboard-tfo-spy-1d-2026-10-03'))
    expect(h.guardPartial.filter((g) => /^cell@\d+: pine:request$/.test(g)).length).toBe(3)
    const e = doorDiagnostics(cap('ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03'))
    expect(e.dropReasons).toEqual({ 'cell:text': 11 })
    expect(e.runtimeRefused).toBe('lower-tf:store-unmeasured')
  }, T)

  it('heat-map-seasons: the gauge cell\'s colour runs `ta.highest` inside one arm of `?:` (C45 held colour) — the cell is held, not painted', () => {
    const d = doorDiagnostics(cap('heat-map-seasons-spy-1d-2026-10-03'))
    expect(d.heldColours).toEqual(['fn:conditional-history `ta.highest`@43'])
    const v = graded('heat-map-seasons-spy-1d-2026-10-03')
    expect(v.objects.texts.find((t) => t.family === 'tableCells text').onlyVendor).toEqual(['𖦹'])
  }, T)

  it('auto-trendline and dual-view: the door already withholds the whole drawing by name (`pine:object-removal-lost`)', () => {
    for (const id of ['auto-trendline-dojiemoji-spy-1d-2026-10-03', 'dual-view-htf-candlestick-patterns-theultimator5-spy-1d-2026-10-03']) {
      const v = graded(id)
      expect(v.objects.withheld, id).toBe('pine:object-removal-lost')
    }
  }, T)
})
