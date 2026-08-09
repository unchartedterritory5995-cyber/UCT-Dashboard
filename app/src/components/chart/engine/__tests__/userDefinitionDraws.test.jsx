// app/src/components/chart/engine/__tests__/userDefinitionDraws.test.jsx
//
// ─── 🔴 THE DELIVERABLE: A USER'S FORMULA REACHES THE RENDERER ──────────────
//
// Phase D Task 16. Everything else in this task is supporting; this file is the
// claim. It mounts the REAL `StockChart` on REAL bars, serves a REAL stored
// definition from `/api/user-definitions` exactly as the store does, and asserts
// that the numbers the user's formula computes are HANDED TO A SERIES.
//
// ⛔ WHY NONE OF THE ~6,100 EXISTING TESTS COULD SEE THE BUG. Every component
// was correct alone. `parseFormula` parsed, `checkBudget` budgeted, `lintRepaint`
// linted, `validateUserDefinitions` (then called `registerUserDefinitions`)
// validated, `interpret` interpreted, `binder.sync` bound, `normalizeInstances`
// normalised — and each of those has its own green suite. The defect lived in
// the CONTRACT between them: `validateUserDefinitions` RETURNED a checked
// definition and installed it NOWHERE, so `getDefinition('u_…')` answered null
// and the instance was dropped before it ever reached the binder. Adding more
// unit tests of the same shape proves nothing; the only test that can see a
// contract defect is one that drives the whole contract. This is that test, and
// `tools/chart_parity.py --cases ast_user_formula_sma20` is its pixel twin.
//
// ⛔ THE ORACLE IS INDEPENDENT. The expected column is a twenty-bar mean computed
// with plain arithmetic over the fixture, in this file. It is NOT `interpret(ast,
// bars)` — running the engine to produce the expectation for the engine is true
// by construction and would survive the interpreter returning anything at all,
// as long as it returned it twice.
//
// ⚠️ THE DOUBLE IS `stockChartWiring.test.jsx`'s, VERBATIM IN SHAPE — the smoke
// stub with recording `addSeries` / `setData` — because the thing this file
// asserts is WHICH DATA REACHED WHICH SERIES, and a no-op stub cannot express it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  setDataCalls: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.setDataCalls.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: (data) => { H.setDataCalls.push({ series: s, ctor, data }) },
      update: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      moveToPane: () => {},
      getPane: () => ({ getHeight: () => 300 }),
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0, timeToCoordinate: () => 0,
    coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_impl, options, paneIndex) => {
      const s = makeSeries('custom')
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))

// ⚠️ A SIGNED-IN USER, because `useUserDefinitions` hands SWR a NULL KEY without
// one and never fetches. A test that mocked this as signed-out would assert the
// paywall, not the feature — and would pass with the install door deleted.
//
// ⛔ A REAL `createContext`, NOT THE `{Provider}` PLACEHOLDER THE OTHER CHART
// SUITES USE. `useUserDefinitions` reads `useContext(AuthContext)` (the same
// posture `useIsPaid` takes, so a chart can render with no provider), and
// `useContext` on a plain object answers `undefined` — which reads as SIGNED
// OUT and would have made every case in this file measure the paywall. That is
// exactly what the first run of this file did, and it is why the default value
// is the user rather than a Provider anyone has to remember to mount.
vi.mock('../../../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  const value = { user: { id: 7 }, plan: 'premium', isPaid: true, loading: false }
  return {
    AuthContext: createContext(value),
    useAuth: () => value,
    useIsPaid: () => true,
  }
})

const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = {
    canvas: null, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: [] }),
  }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}

const { default: StockChart } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
const { parseFormula, astHash } = await import('../ast/parse')
const { SCHEMA_VERSION } = await import('../defSchema')
const { mutate } = await import('swr')
const { USER_DEFINITIONS_KEY } = await import('../../../../hooks/useUserDefinitions')

const BARS = bars200.bars
const PERIOD = 20

// ─── the independent oracle ──────────────────────────────────────────────────

/** A trailing `n`-bar arithmetic mean of `close`, computed HERE with `+` and `/`.
 *
 *  ⛔ NOT `interpret(ast, bars)`. An expectation produced by the subject is true
 *  by construction: it would agree with an interpreter that returned the wrong
 *  number, the same wrong number, twice. */
function trailingMean(bars, n) {
  const out = []
  for (let i = 0; i < bars.length; i++) {
    if (i + 1 < n) { out.push(null); continue }
    let sum = 0
    for (let k = i - n + 1; k <= i; k++) sum += bars[k].c
    out.push(sum / n)
  }
  return out
}

const EXPECTED = trailingMean(BARS, PERIOD)

// ─── the fixtures ────────────────────────────────────────────────────────────

const DEF_ID = 'u_5ea7c0de1234'

/** The document `builder/BuilderSheet.buildDefinition` produces, for
 *  `sma(close, 20)`. Built through the real parser and the real hash so a change
 *  to either is visible here rather than silently accommodated. */
function userDoc({ id = DEF_ID, repaint = 'non-repainting', source = `sma(close, ${PERIOD})` } = {}) {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`fixture formula does not parse: ${parsed.error}`)
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    version: 1,
    compute: { kind: 'ast', fn: astHash(parsed.ast), rev: 1, ast: parsed.ast, source },
    meta: {
      name: 'SMA 20', shortName: 'SMA 20', category: 'Custom',
      description: `the ${PERIOD}-bar average of close`,
      // ⚠️ `freshness` IS REQUIRED ON THIS LANE (Phase E Task 1, GATE 6) and
      // this fixture is pure OHLCV, so the MEASURED value is `live`.
      tags: ['custom'], tier: 'premium', repaint, freshness: 'live',
    },
    placement: { target: 'pane', pane: { height: 0.15 } },
    inputs: [
      { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
      { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
    ],
    plots: [{ key: 'value', label: 'SMA 20', style: 'line', color: '$color', width: '$lineWidth', role: 'primary' }],
  }
}

/** A store ROW, in the shape `user_definitions.list_for_user` returns. */
const rowFor = (doc) => ({
  def_id: doc.id, version: 1, rev: 1, ast_hash: doc.compute.fn,
  definition: doc, repaint: {}, created_at: 0,
})

const instanceFor = (defId) => ({
  instanceId: `inst:${defId}:0`,
  defId,
  defVersion: 1,
  inputs: { color: '#c9a84c', lineWidth: 1 },
  placement: { target: 'pane' },
  hidden: false,
})

/** Serve `/api/user-definitions` with these rows; everything else answers `{}`,
 *  which every other call site on this path already treats as "no data". */
function serveDefinitions(rows) {
  vi.stubGlobal('fetch', vi.fn((input) => {
    const url = String(typeof input === 'string' ? input : (input && input.url) || '')
    if (url.includes('/api/user-definitions')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ definitions: rows }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

function draw(instances) {
  return render(
    <StockChart
      sym="PARITY"
      tf="D"
      barsOverride={BARS}
      settingsOverride={{ indicatorInstances: instances }}
      liveUpdates={false}
    />,
  )
}

/** Force the definitions fetch to resolve into the hook.
 *
 *  ⚠️ AN EXPLICIT `mutate`, NOT A `waitFor` ON THE MOUNT FETCH. The hook declares
 *  `dedupingInterval: 10000`, so the second case in this file would otherwise be
 *  served the FIRST case's response and "it drew" would be a statement about
 *  test order. An explicit revalidation bypasses dedup and always re-reads the
 *  stub. It changes nothing this file is measuring: the rows still arrive AFTER
 *  the first paint, which is the ordering the last case is about. */
async function settleDefinitions() {
  await act(async () => { await mutate(USER_DEFINITIONS_KEY) })
}

const TAIL = 40

/** Every `setData` payload whose TAIL is the independent oracle's tail.
 *
 *  ⚠️ THE HEAD IS IGNORED ON PURPOSE, AND IT IS NOT A LOOSENING. `interpret`
 *  NaN-pads a formula's warm-up and the binder emits those points as `{time}`
 *  with no `value`, so a "every point is finite" filter rejects the very series
 *  this file exists to find — measured on the first run of this file, where the
 *  user's 200-point payload was thrown away by its own matcher. The tail is
 *  where the oracle is defined for every bar, and it is also where a wrong
 *  formula is most visible.
 *
 *  ⛔ IT IS A VALUE MATCH, NOT A COUNT OR A CONSTRUCTOR MATCH. This chart's
 *  default settings already draw several `LineSeries` MA overlays — one of them
 *  a TWENTY-period one — so "a line was created" and even "a line with 181
 *  points was created" are both satisfied by a chart carrying no user formula at
 *  all. Only the numbers tell them apart. */
function seriesMatchingOracle() {
  const want = EXPECTED.slice(-TAIL)
  return H.setDataCalls.filter(({ data }) => {
    if (!Array.isArray(data) || data.length < 50) return false
    const got = data.slice(-TAIL).map(p => (p && typeof p === 'object' ? p.value : undefined))
    if (got.length !== want.length) return false
    if (got.some(v => typeof v !== 'number' || !Number.isFinite(v))) return false
    return want.every((w, i) => Math.abs(w - got[i]) < 1e-6)
  })
}

beforeEach(() => {
  cleanup()
  H.reset()
  registry.clearUserDefinitions()
  serveDefinitions([])
  return mutate(USER_DEFINITIONS_KEY, undefined, { revalidate: false })
})

afterEach(() => {
  cleanup()
  registry.clearUserDefinitions()
})

describe('🔴 a USER-AUTHORED formula reaches the renderer', () => {
  it('the oracle is not vacuous — it describes the fixture, and it is not the candles', () => {
    // ⛔ THE ORACLE'S OWN CONTROL. `seriesMatchingOracle` is the discriminator
    // every case below rests on, so it has to be shown to (a) have something to
    // match and (b) not match just anything. A `.filter` over an empty log
    // returns `[]` and satisfies a negative expectation perfectly.
    expect(BARS.length).toBeGreaterThan(120)
    expect(EXPECTED.slice(0, PERIOD - 1).every(v => v === null)).toBe(true)
    expect(EXPECTED.slice(-40).every(v => typeof v === 'number' && Number.isFinite(v))).toBe(true)
    // The mean is not the close: a matcher that accepted the CLOSE column would
    // "find" the formula on the candle series of a chart with no formula at all.
    const closes = BARS.slice(-40).map(b => b.c)
    const means = EXPECTED.slice(-40)
    expect(means.some((m, i) => Math.abs(m - closes[i]) > 1e-6)).toBe(true)
  })

  it('🔴 THE CLAIM — a stored definition is installed and its column reaches a series', async () => {
    serveDefinitions([rowFor(userDoc())])
    draw([instanceFor(DEF_ID)])
    await settleDefinitions()

    await waitFor(() => {
      expect(registry.getDefinition(DEF_ID), 'the stored definition never installed').toBeTruthy()
    })
    await waitFor(() => {
      expect(seriesMatchingOracle().length,
        'no series was ever handed the twenty-bar mean this formula computes — the '
        + 'definition installed but the chart did not draw it',
      ).toBeGreaterThan(0)
    })

    // …and it drew ONE line, not two. A double-draw is the other failure this
    // phase spends its pixel budget on.
    expect(seriesMatchingOracle().length).toBe(1)
  })

  it('⛔ THE NEGATIVE — with NOTHING stored, the same instance draws nothing', async () => {
    // The pre-Task-16 behaviour, reproduced deliberately: the instance is
    // identical, the chart is identical, and the only difference is that no
    // definition is installed. `normalizeInstances` drops it with "names no
    // registered definition" and the renderer is handed nothing.
    serveDefinitions([])
    draw([instanceFor(DEF_ID)])
    await settleDefinitions()

    await waitFor(() => expect(H.setDataCalls.length).toBeGreaterThan(0))
    expect(registry.getDefinition(DEF_ID)).toBeNull()
    expect(seriesMatchingOracle(),
      'a series received the formula\'s column with no definition installed — then the '
      + 'positive case above is not measuring the install').toEqual([])
  })

  it('⛔ THE OTHER NEGATIVE — a definition that no longer VALIDATES does not install, and does not draw', async () => {
    // A stored badge that disagrees with the linter. Task 10 named this exactly:
    // stored verdicts go STALE, and a definition legal the day it was written can
    // stop being legal. It is refused in BOTH directions, so this over-claim is
    // as fatal as an under-claim — and the chart's honest answer is silence.
    const stale = userDoc({ repaint: 'repaints' })
    serveDefinitions([rowFor(stale)])
    draw([instanceFor(DEF_ID)])
    await settleDefinitions()

    await waitFor(() => expect(H.setDataCalls.length).toBeGreaterThan(0))
    // Give the SWR round-trip the same room the positive case gets, so this is
    // not passing merely because it looked too early.
    await waitFor(() => expect(H.addSeriesCalls.length).toBeGreaterThan(0))
    expect(registry.getDefinition(DEF_ID),
      'an invalid definition INSTALLED — the install door is not running the gates').toBeNull()
    expect(seriesMatchingOracle()).toEqual([])
  })

  it('⭐ THE POSITIVE CONTROL — the same harness detects a SHIPPED definition drawing', async () => {
    // Proof that `H.setDataCalls` + a value-column matcher is a discriminator at
    // all on this chart, using a definition whose install is not in question.
    // Without it, every "drew nothing" above could be a harness that never sees
    // anything draw.
    serveDefinitions([])
    draw([{
      instanceId: 'inst:rsi:0', defId: 'rsi', defVersion: 1,
      inputs: { period: 14, color: '#7b68ee' }, hidden: false,
    }])
    await waitFor(() => {
      // RSI is bounded 0-100 by construction, which is a property no other
      // column on this chart has (the candles and the SMA sit near 100-110 but
      // exceed it, and the volume histogram is in the millions).
      const lines = H.setDataCalls.filter(({ data }) => {
        if (!Array.isArray(data) || data.length < 50) return false
        const v = data.map(p => (p && typeof p === 'object' ? p.value : undefined))
          .filter(x => typeof x === 'number' && Number.isFinite(x))
        return v.length > 40 && v.every(x => x >= 0 && x <= 100)
      })
      expect(lines.length, 'the harness cannot see a SHIPPED indicator draw either — it is '
        + 'blind, and every negative above proves nothing').toBeGreaterThan(0)
    })
  })

  it('⛔ THE ORDERING — a definition installed AFTER the first paint still draws', async () => {
    // 🔴 THE "WORKS ON THE SECOND RENDER ONLY" DEFECT, ARMED. The rows arrive
    // from SWR *after* the first paint, always — so the repaint that already
    // dropped this instance has to run again. `useInstalledUserDefinitions`
    // returns a GENERATION and `StockChart` carries it in `updateChart`'s
    // dependency list; delete either and the install is still correct and the
    // chart never uses it. This case starts with an EMPTY store, renders, and
    // only then serves the definition — so nothing else in that dependency list
    // moves and the generation is the only thing that can bring the line back.
    serveDefinitions([])
    draw([instanceFor(DEF_ID)])
    await waitFor(() => expect(H.setDataCalls.length).toBeGreaterThan(0))
    expect(seriesMatchingOracle()).toEqual([])

    serveDefinitions([rowFor(userDoc())])
    await settleDefinitions()

    await waitFor(() => {
      expect(seriesMatchingOracle().length,
        'the definition arrived after the first paint and the chart never repainted to use '
        + 'it — this is the ordering bug, not the install bug').toBeGreaterThan(0)
    })
  })
})
