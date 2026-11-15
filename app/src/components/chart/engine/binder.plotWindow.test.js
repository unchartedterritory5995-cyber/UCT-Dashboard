// app/src/components/chart/engine/binder.plotWindow.test.js
//
// ─── THE INDICATOR WINDOW THROUGH THE BINDER: WHAT THE RENDERER IS HANDED ────────
//
// `plotWindow.test.js` pins the arithmetic; this file pins the CALLS the binder makes
// on a recording chart. Measured on production 2026-11-13: one flip onto an
// 11,762-bar daily chart spent about 205 ms in `setData` and about 165 ms turning
// every row of every line series into a render item. With `ctx.plotWindowFrom` set,
// a series is handed the rows from that bar onward; everything that READS the series
// (the legend's last value, the binding itself) still sees every bar.
//
// The control is in every test: the same instances on the same bars with no window.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from './binder'
import { resolvePlacement } from './placement'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from './paneLayout'
import * as nativeRegistry from './nativeRegistry'

const N = 3200
const START = 1200                       // the window's first row: 2,000 rows drawn
const bars = makeBars(N)
const inst = (defId) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false })
const INSTANCES = [inst('rsi'), inst('macd'), inst('atr')]

const ctxFor = (extra = {}) => ({
  enabled: true,
  registry: nativeRegistry,
  instances: INSTANCES,
  bars,
  adjustTime: (t) => t,
  resolvePlacement,
  paneMargins: {},
  paneLayout: computePaneLayout(INSTANCES, { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX }),
  volOverlaySet: new Set(),
  volSeparatePane: false,
  VOL_PANE_INDEX: 1,
  plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  ...extra,
})

const bind = (extra) => {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  binder.sync(ctxFor(extra))
  return { fake, binder }
}
/** The LAST array each series was handed, by the plot it draws. */
const handed = ({ fake, binder }) => {
  const out = new Map()
  for (const b of binder.bindings()) {
    const sets = fake.calls.filter((c) => c.on === 'series' && c.id === b.series.__id && c.method === 'setData')
    out.set(`${b.instanceId}::${b.plotKey}`, sets.length ? sets[sets.length - 1].args[0] : null)
  }
  return out
}

beforeEach(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest(null) })

describe('with no window', () => {
  it('every series is handed a point for every bar (the control)', () => {
    const whole = handed(bind())
    expect(whole.size, 'nothing bound: the rest is vacuous').toBeGreaterThanOrEqual(5)
    for (const [key, pts] of whole) {
      expect(pts, key).toHaveLength(N)
      expect(pts[0].time, key).toBe(bars[0].t)
    }
  })
  it('null and undefined are both "every row"', () => {
    const a = handed(bind({ plotWindowFrom: null }))
    const b = handed(bind({ plotWindowFrom: undefined }))
    for (const [key, pts] of a) { expect(pts, key).toHaveLength(N); expect(b.get(key), key).toHaveLength(N) }
  })
})

describe('with a window', () => {
  it('every series is handed exactly the rows from the window start on, unchanged', () => {
    const whole = handed(bind())
    const cut = handed(bind({ plotWindowFrom: bars[START].t }))
    expect([...cut.keys()].sort()).toEqual([...whole.keys()].sort())
    for (const [key, pts] of cut) {
      expect(pts, key).toHaveLength(N - START)
      expect(pts[0].time, key).toBe(bars[START].t)
      expect(pts[pts.length - 1].time, key).toBe(bars[N - 1].t)
      expect(pts, key).toEqual(whole.get(key).slice(START))          // the same points, value and colour
    }
  })
  it('what READS the series still sees every bar: the legend value is the whole chart\'s', () => {
    const a = bind()
    const b = bind({ plotWindowFrom: bars[START].t })
    const read = (x) => x.binder.bindings().map((n) => [`${n.instanceId}::${n.plotKey}`, n.lastValue, n.prevValue])
    expect(read(b)).toEqual(read(a))
    expect(read(a).some(([, v]) => Number.isFinite(v)), 'no finite legend value: vacuous').toBe(true)
  })
  it('a second pass is as stable as it is with no window: the same slice whenever the points are the same array', () => {
    // The binder's own point memo decides whether a pass hands back the same ARRAY (it is keyed
    // on the column's identity). The window must not make that worse: wherever the whole chart
    // gets the same array twice, the windowed one gets the same slice twice.
    const whole = bind()
    const w1 = handed(whole)
    whole.binder.sync(ctxFor())
    const w2 = handed(whole)
    const cut = bind({ plotWindowFrom: bars[START].t })
    const c1 = handed(cut)
    cut.binder.sync(ctxFor({ plotWindowFrom: bars[START].t }))
    const c2 = handed(cut)
    for (const [key, pts] of c2) {
      expect(pts, key).toEqual(c1.get(key))
      expect(pts === c1.get(key), key).toBe(w2.get(key) === w1.get(key))
    }
  })
  it('moving the window start hands the new rows', () => {
    const run = bind({ plotWindowFrom: bars[START].t })
    run.binder.sync(ctxFor({ plotWindowFrom: bars[START + 500].t }))
    for (const [key, pts] of handed(run)) {
      expect(pts, key).toHaveLength(N - START - 500)
      expect(pts[0].time, key).toBe(bars[START + 500].t)
    }
  })
  it('taking the window away hands every row again', () => {
    const run = bind({ plotWindowFrom: bars[START].t })
    run.binder.sync(ctxFor({ plotWindowFrom: null }))
    for (const [key, pts] of handed(run)) expect(pts, key).toHaveLength(N)
  })
  it('a start before the first bar changes nothing', () => {
    for (const [key, pts] of handed(bind({ plotWindowFrom: bars[0].t - 86400 }))) expect(pts, key).toHaveLength(N)
  })
})
