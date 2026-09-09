// @vitest-environment jsdom
/* The mount-surface / override-prop safety matrix.
 *
 * ⛔ WHY THIS EXISTS. `ChartDrawingOverlay` is mounted by EIGHT surfaces, not
 * one: the /charts ChartWidget, multi-chart grid cells, Model Book setups, the
 * Model Book INDEX pane (which has no candles at all), Review feed cards,
 * pop-out windows, the mobile shell, and the Notebook ChartEmbed. Seven props
 * exist purely to bend it for those surfaces — `textFadeRef`, `fadeWholeLayer`,
 * `hidePriceLabels`, `measurePctOnly`, `lineData`, `rightBoundTime`, `readOnly`
 * — and a shared-infrastructure change that quietly ignores one of them breaks a
 * surface nobody is looking at.
 *
 * ⛔ AND IT IS DELIBERATELY NOT A PIXEL TEST. jsdom's canvas maps no
 * coordinates, which is exactly why this layer's older tests read source text —
 * a behavioural assertion driven through the component would pass vacuously
 * against a canvas that never painted. So this file asserts the two things that
 * CAN be asserted honestly at the component boundary:
 *
 *   1. MOUNT SAFETY — every surface's real prop combination mounts, renders and
 *      unmounts without throwing. That is not a triviality: Phase 1 added
 *      `measurePanes()`, which reaches into `chart.panes()`,
 *      `series.priceScale()` and `volumeSeriesRef` — three things that are
 *      absent, null or disposed on most of these surfaces.
 *   2. OVERRIDE ROUTING — that each override prop still reaches the decision it
 *      governs, read from the source at the exact call site, so a refactor that
 *      drops one fails by name here rather than in Model Book three weeks later.
 *
 * The pixels are the device pass's job, and the report says so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ChartDrawingOverlay from './ChartDrawingOverlay'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'ChartDrawingOverlay.jsx'), 'utf8')

// ── fakes ───────────────────────────────────────────────────────────────────
const bars = [
  { t: '2026-01-02', o: 10, h: 12, l: 9, c: 11, v: 100 },
  { t: '2026-01-05', o: 11, h: 14, l: 10, c: 13, v: 120 },
  { t: '2026-01-06', o: 13, h: 15, l: 12, c: 14, v: 90 },
]

function fakePane(height) {
  return { getHeight: () => height, getHTMLElement: () => null }
}

/** A chart/series pair shaped like lightweight-charts. `opts` bends it into the
 *  broken states the real surfaces actually produce. */
function fakeChart({ panes = [400, 100], axisWidth = 56, timeAxisHeight = 30, throws = false } = {}) {
  const paneObjs = panes.map(fakePane)
  const chart = {
    panes: () => { if (throws) throw new Error('disposed'); return paneObjs },
    timeScale: () => ({
      height: () => timeAxisHeight,
      coordinateToLogical: () => 1,
      logicalToCoordinate: () => 100,
      timeToCoordinate: () => 100,
      getVisibleLogicalRange: () => ({ from: 0, to: 2 }),
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    options: () => ({ layout: { background: { color: '#0f0f0f' } } }),
    priceScale: () => ({ width: () => axisWidth }),
  }
  const series = {
    priceScale: () => ({ width: () => axisWidth, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.22 } }) }),
    priceToCoordinate: (p) => 400 - p * 10,
    coordinateToPrice: (y) => (400 - y) / 10,
    getPane: () => paneObjs[0],
  }
  return { chart, series, paneObjs }
}

function refs(opts) {
  const { chart, series, paneObjs } = fakeChart(opts)
  const chartRef = createRef(); chartRef.current = chart
  const seriesRef = createRef(); seriesRef.current = series
  return { chartRef, seriesRef, paneObjs, series }
}

/** Volume in its OWN pane (grid cells, Review) vs an overlay BAND (the default). */
function volumeRef(paneObjs, { separate }) {
  const ref = createRef()
  ref.current = {
    getPane: () => (separate ? paneObjs[1] : paneObjs[0]),
    priceScale: () => ({ options: () => ({ scaleMargins: { top: 0.78, bottom: 0 } }) }),
  }
  return ref
}

const NOOP = () => {}
const baseProps = (o = {}) => {
  const { chartRef, seriesRef, paneObjs } = refs(o.chartOpts)
  return {
    chartRef, seriesRef, bars,
    activeTool: null, setActiveTool: NOOP,
    color: '#c9a84c', lineWidth: 1,
    drawings: o.drawings ?? [],
    addDrawing: () => 'id', updateDrawing: NOOP, removeDrawing: NOOP,
    selectedId: null, setSelectedId: NOOP,
    __paneObjs: paneObjs,
  }
}

// ── the eight surfaces, with the props they REALLY pass ─────────────────────
const SURFACES = {
  '/charts ChartWidget': (p) => ({
    ...p,
    volumeSeriesRef: volumeRef(p.__paneObjs, { separate: false }),   // BAND — the default
    undo: NOOP, redo: NOOP, snapshotHistory: NOOP, onSaveDefaults: NOOP,
    savedColors: [], onSetAlert: NOOP, repeatMode: false,
  }),
  'multi-chart grid cell': (p) => ({
    ...p,
    volumeSeriesRef: volumeRef(p.__paneObjs, { separate: true }),    // forced own pane
    readOnly: true,
  }),
  'Model Book setup': (p) => ({
    ...p,
    textFadeRef: { current: 0.6 },
    fadeWholeLayer: true,
    hidePriceLabels: true,
    drawings: [
      { id: 'a', type: 'hray', points: [{ time: '2026-01-02', price: 12 }], rightBoundTime: '2026-01-05' },
      { id: 'b', type: 'text', points: [{ time: '2026-01-02', price: 12 }], text: 'setup' },
    ],
  }),
  'Model Book index pane': (p) => ({
    ...p,
    // NO volume series at all, and no candles — the pane is a LINE series.
    lineData: [{ time: '2026-01-02', value: 11 }, { time: '2026-01-05', value: 13 }],
    measurePctOnly: true,
    textFadeRef: { current: 1 },
    drawings: [{ id: 'm', type: 'measure', points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-06', price: 14 }], barCount: 2 }],
  }),
  'Review feed card': (p) => ({
    ...p,
    volumeSeriesRef: volumeRef(p.__paneObjs, { separate: true }),
    readOnly: true, repeatMode: false,
  }),
  'pop-out window': (p) => ({
    ...p,
    volumeSeriesRef: volumeRef(p.__paneObjs, { separate: false }),
    undo: NOOP, redo: NOOP, snapshotHistory: NOOP,
  }),
  'mobile shell': (p) => ({
    ...p,
    volumeSeriesRef: volumeRef(p.__paneObjs, { separate: false }),
    quickBarInset: 62, repeatMode: true,
  }),
  'Notebook ChartEmbed': (p) => ({ ...p, readOnly: true }),
}

const DRAWINGS = [
  { id: 'd1', type: 'trendline', points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-06', price: 14 }], color: '#c9a84c' },
  { id: 'd2', type: 'horizontal', points: [{ price: 12 }], color: '#1ae51a' },
  { id: 'd3', type: 'rect', points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-06', price: 14 }] },
  { id: 'd4', type: 'pitchfork', points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-05', price: 13 }, { time: '2026-01-05', price: 11 }] },
  { id: 'd5', type: 'channel', points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-06', price: 14 }, { time: '2026-01-02', price: 9 }] },
  // A LEGACY volume-pane point: canvas-relative paneRelY, no `pane` field.
  { id: 'd6', type: 'text', points: [{ time: '2026-01-02', price: 10, paneRelY: 0.9 }], text: 'vol note' },
  // A drawing whose anchors cannot resolve at all.
  { id: 'd7', type: 'trendline', points: [{ time: 'nope' }, { time: 'also-nope' }] },
]

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('every mount surface survives the Phase 1 pane machinery', () => {
  for (const [name, make] of Object.entries(SURFACES)) {
    it(`${name} — mounts, renders drawings and unmounts without throwing`, () => {
      const p = make(baseProps({ drawings: DRAWINGS }))
      const { unmount, container } = render(<ChartDrawingOverlay {...p} drawings={p.drawings ?? DRAWINGS} />)
      expect(container.querySelector('canvas')).toBeTruthy()
      expect(() => unmount()).not.toThrow()
    })
  }

  it('survives a chart whose panes() THROWS — a disposed chart mid-frame', () => {
    // `measurePanes` reaches into lightweight-charts; a chart torn down between
    // frames must degrade to "no zones", not take the overlay down.
    const p = baseProps({ chartOpts: { throws: true }, drawings: DRAWINGS })
    expect(() => render(<ChartDrawingOverlay {...p} />)).not.toThrow()
  })

  it('survives null chart/series refs — the overlay can mount BEFORE the chart exists', () => {
    // SWR-cached bars render the wrapper in StockChart's first commit, and child
    // effects run before the parent effect that creates the chart.
    const empty = createRef()
    expect(() => render(
      <ChartDrawingOverlay
        chartRef={empty} seriesRef={empty} bars={bars}
        activeTool={null} setActiveTool={NOOP} color="#c9a84c" lineWidth={1}
        drawings={DRAWINGS} addDrawing={NOOP} updateDrawing={NOOP} removeDrawing={NOOP}
        selectedId={null} setSelectedId={NOOP}
      />,
    )).not.toThrow()
  })

  it('survives a volume series that throws when asked which pane it is in', () => {
    const p = baseProps({ drawings: DRAWINGS })
    const bad = createRef()
    bad.current = { getPane: () => { throw new Error('gone') }, priceScale: () => { throw new Error('gone') } }
    expect(() => render(<ChartDrawingOverlay {...p} volumeSeriesRef={bad} />)).not.toThrow()
  })

  it('renders with no drawings, and with drawings whose points are empty', () => {
    const p = baseProps()
    expect(() => render(<ChartDrawingOverlay {...p} drawings={[{ id: 'x', type: 'text', points: [] }]} />)).not.toThrow()
  })
})

// ── override routing, read at the call site ─────────────────────────────────
//
// ⛔ SOURCE-READ, AND THE REASON IS STATED. Each of these governs a decision the
// canvas makes, and jsdom's canvas records nothing. What can be gated honestly
// is that the prop still reaches the expression it governs — so a Phase-2+ edit
// that drops one fails HERE, by name, instead of silently changing Model Book.
describe('the seven Model Book / surface override props still reach their decisions', () => {
  const near = (needle, span = 400) => {
    const i = SRC.indexOf(needle)
    return i < 0 ? '' : SRC.slice(Math.max(0, i - span), i + span)
  }

  it('hidePriceLabels still gates the Horizontal Line label', () => {
    expect(SRC).toContain('renderHorizontal(ctx, pts, rect, !hidePriceLabels, w)')
  })

  it('measurePctOnly still reaches renderMeasure', () => {
    expect(SRC).toContain('renderMeasure(ctx, pts, d, measurePctOnly)')
  })

  it('lineData still selects the line-mode advance %', () => {
    expect(near('renderAdvance(ctx, pts, ad, toPixelY')).toContain('lineData')
  })

  it('rightBoundTime still bounds the horizontal ray', () => {
    const block = near('let hrayRight')
    expect(block).toContain('d.rightBoundTime')
    // and it is clamped to the PANE now, not the canvas
    expect(block).toContain('rect.x1')
  })

  it('textFadeRef still drives both fade paths', () => {
    expect(SRC).toContain('const fadeVal = textFadeRef ?')
    expect(SRC).toContain('const layerAlpha = fadeWholeLayer ? fadeVal : 1')
    expect(SRC).toContain('const textOpacity = fadeWholeLayer ? 1 : fadeVal')
  })

  it('fadeWholeLayer still chooses layer-vs-text fade', () => {
    expect(near('fadeWholeLayer ? fadeVal : 1')).toContain('layerAlpha')
  })

  it('readOnly still short-circuits the window keydown handler', () => {
    expect(near('if (readOnly) return undefined')).toContain('readOnly')
  })

  it('the off-screen guard still keys on textFadeRef (Model Book only)', () => {
    expect(near('guardActive =')).toContain('movingRef')
    expect(SRC).toContain('if (textFadeRef) {')
  })
})

describe('the Phase 1 pane machinery is wired the way the report claims', () => {
  it('pane geometry is measured ONCE per redraw, not per drawing', () => {
    // The performance contract. `measurePanes()` must appear exactly once in the
    // redraw body, with every drawing reading the cached result.
    const body = SRC.slice(SRC.indexOf('const redraw = useCallback('), SRC.indexOf('// Keep redrawRef in sync'))
    expect(body.match(/measurePanes\(\)/g) || []).toHaveLength(1)
    expect(body).toContain('paneGeomRef.current = geom')
    expect(body).toContain('rectForDrawing(d, geom)')
  })

  it('the pane clip is applied centrally, not per tool', () => {
    const body = SRC.slice(SRC.indexOf('// Draw completed drawings'), SRC.indexOf('// Placed-but-uncommitted anchors'))
    expect(body).toContain('clipToPane(ctx, rect)')
    // no per-type clipping special cases
    expect(body).not.toMatch(/if \(d\.type === '\w+'\)[\s\S]{0,80}clip/)
  })

  it('the outer plot-area clip (keeping drawings off the price scale) survives', () => {
    expect(SRC).toContain('ctx.rect(0, 0, plotRight, h)')
    expect(SRC).toContain("ctx.restore()   // end plot-area clip")
  })

  it('handles are painted with the drawing’s resolved ink', () => {
    expect(SRC).toContain('renderSelectionHandles(ctx, pts, ink)')
    expect(SRC).toContain('const ink = brightenAnnotationColor(d.color) || UCT_DRAW_GOLD')
  })

  it('a vertical-only drag does not rewrite time', () => {
    expect(SRC).toContain('if (timeDelta === 0) return { ...p, ...moveY(p) }')
  })

  it('pane ownership is stamped at creation, from the first anchor', () => {
    expect(SRC).toContain("pane: newPending[0]?.pane || PRICE")
  })

  it('the dotted style maps are total in both directions', () => {
    expect(SRC).toContain("const DRAW_STYLE_TO_NUM = { solid: 0, dotted: 1, dashed: 2 }")
    expect(SRC).toContain("const NUM_TO_DRAW_STYLE = { 0: 'solid', 1: 'dotted', 2: 'dashed' }")
  })
})
