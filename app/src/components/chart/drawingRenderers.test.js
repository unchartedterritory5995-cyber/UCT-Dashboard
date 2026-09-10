/* The drawing layer's painters, executed against a recording context.
 *
 * ⛔ WHY A RECORDING FAKE AND NOT A REAL CANVAS. jsdom has no 2D context, and
 * adding the `canvas` native package to get one would buy pixels nobody can
 * assert on anyway. What actually needs pinning here is not colour values on a
 * bitmap — it is the CALL SEQUENCE and the CONTEXT STATE each painter leaves
 * behind, because canvas is a state machine and Phase 0's whole promise is
 * "nothing about that changed". A recorder gives exact answers to exactly those
 * questions, with no dependency and no platform variance.
 *
 * ⭐ THE STATE ASSERTIONS ARE THE POINT OF THIS FILE. A painter that sets
 * `globalAlpha` and forgets to put it back changes the NEXT drawing, in a
 * different tool, in a way no screenshot of the first drawing would show. Three
 * painters do exactly that today (documented in drawingRenderers.js). They are
 * pinned here as-is: `renderPitchfork` really does write `globalAlpha = 1`
 * rather than restoring what it found, and a Phase 1 that tightens this has to
 * come and change a test that says so out loud.
 *
 * Blocks marked ⚠️ CHARACTERISATION describe shipped behaviour a later phase is
 * expected to change. Everything else is a contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetCoarsePointerForTest, HANDLE_FINE, HANDLE_COARSE, HIT_COARSE } from './coarsePointer'
import { UCT_DRAW_GOLD } from './drawingColors'
import { _clearLabelCache } from './drawingLabels'
import {
  drawArrowhead, renderTrendline, renderRay, renderExtended, renderHorizontal,
  renderHRay, renderVertical, renderRect, renderCircle, renderArrow, renderCup,
  wrapTextLines, renderText, renderAdvance, renderFib, renderFibExtension,
  renderPitchfork, renderChannel, renderMeasure, renderBarsTime, renderPosition,
  renderAnchoredVwap, renderSelectionHandles, renderCrosshair,
  FIB_LEVELS, FIB_COLORS, FIB_EXT_LEVELS,
} from './drawingRenderers'
import { ARROW_SIZES } from './drawingStyle'

// ── the recorder ────────────────────────────────────────────────────────────
/** A CanvasRenderingContext2D stand-in that remembers everything.
 *  `save()` / `restore()` model the real state stack (dash array included), so
 *  an unbalanced painter shows up as a non-zero depth rather than as a mystery
 *  three drawings later. */
function makeCtx(initial = {}) {
  const calls = []
  const state = {
    strokeStyle: '#000000', fillStyle: '#000000', lineWidth: 1,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    globalAlpha: 1, lineDash: [], ...initial,
  }
  const stack = []
  const ctx = {}
  const VOID_METHODS = [
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'ellipse',
    'rect', 'clip', 'fillRect', 'strokeRect', 'quadraticCurveTo', 'roundRect',
    'fillText', 'clearRect', 'setTransform', 'translate', 'scale',
  ]
  for (const m of VOID_METHODS) ctx[m] = (...args) => { calls.push({ op: m, args }) }
  ctx.setLineDash = (arr) => { state.lineDash = (arr || []).slice(); calls.push({ op: 'setLineDash', args: [state.lineDash] }) }
  ctx.getLineDash = () => state.lineDash.slice()
  ctx.save = () => { stack.push({ ...state, lineDash: state.lineDash.slice() }); calls.push({ op: 'save' }) }
  ctx.restore = () => {
    const s = stack.pop()
    if (s) Object.assign(state, s)
    calls.push({ op: 'restore' })
  }
  // Deterministic and monospace-ish, so label maths is arithmetic, not a font.
  ctx.measureText = (t) => { calls.push({ op: 'measureText', args: [t] }); return { width: String(t).length * 6 } }
  for (const key of Object.keys(state)) {
    if (key === 'lineDash') continue    // owned by setLineDash
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (v) => { state[key] = v; calls.push({ op: `set:${key}`, args: [v] }) },
      enumerable: true, configurable: true,
    })
  }
  ctx.__calls = calls
  ctx.__state = state
  ctx.__ops = () => calls.map((c) => c.op)
  ctx.__depth = () => stack.length
  ctx.__find = (op) => calls.filter((c) => c.op === op)
  return ctx
}

// ── pointer control (selection handles are pointer-sensitive) ───────────────
const origMatchMedia = window.matchMedia
function setPointer(coarse) {
  window.matchMedia = vi.fn(() => ({
    matches: coarse, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }))
  __resetCoarsePointerForTest()
}
beforeEach(() => {
  setPointer(false)
  // The label module caches `measureText` results by font+string, and each test
  // brings a fresh recorder — without this, a later test's "did it measure?"
  // assertion could be answered by an earlier test's cache entry.
  _clearLabelCache()
})
afterEach(() => {
  if (origMatchMedia) window.matchMedia = origMatchMedia
  else delete window.matchMedia
  __resetCoarsePointerForTest()
})

const P = (x, y, extra = {}) => ({ x, y, ...extra })
const W = 800, H = 400
// Painters take a pane RECT now, not a bare width/height.
const R = { x0: 0, y0: 0, x1: W, y1: H }
const VOL = { x0: 0, y0: 300, x1: W, y1: H }

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ save/restore balance — the invariant that protects the screenshot', () => {
  // ⛔ WHY THIS MATTERS BEYOND TIDINESS. `chartScreenshot.js` composites this
  // overlay canvas into the branded share PNG. One unmatched `save()` leaves the
  // clip stack dirty and the capture comes out blank or half-drawn — a failure
  // that appears nowhere on screen and only in what the user shares. Phase 1
  // adds a `ctx.clip()` per drawing for pane clipping, which makes an imbalance
  // strictly worse, so the invariant is nailed down BEFORE that lands.
  const toPixelY = (_, price) => 200 - price
  const toPixel = (_, price) => 200 - price
  const CASES = [
    ['renderTrendline', (c) => renderTrendline(c, [P(0, 0), P(10, 10)])],
    ['renderRay', (c) => renderRay(c, [P(10, 10), P(20, 20)], R)],
    ['renderExtended', (c) => renderExtended(c, [P(10, 10), P(20, 20)], R)],
    ['renderHorizontal', (c) => renderHorizontal(c, [P(10, 50, { price: 1.5 })], R, true, W)],
    ['renderHRay', (c) => renderHRay(c, [P(10, 50, { price: 1.5 })], W, { showLabel: true, ink: '#c9a84c' })],
    ['renderVertical', (c) => renderVertical(c, [P(10, 50)], R)],
    ['renderRect', (c) => renderRect(c, [P(10, 10), P(90, 60)])],
    ['renderCircle', (c) => renderCircle(c, [P(10, 10), P(90, 60)])],
    ['renderArrow', (c) => renderArrow(c, [P(10, 10), P(90, 60)])],
    ['renderCup', (c) => renderCup(c, [P(0, 0), P(50, 80), P(100, 0)])],
    ['renderText', (c) => renderText(c, [P(10, 10)], { text: 'hi\nthere', fontSize: 13 })],
    ['renderAdvance', (c) => renderAdvance(c, [P(10, 10), P(90, 60)], { advPct: 12, advHigh: 5 }, toPixelY, 16, W)],
    ['renderFib', (c) => renderFib(c, [P(0, 0, { rawPrice: 10 }), P(100, 100, { rawPrice: 20 })], R, toPixel)],
    ['renderFibExtension', (c) => renderFibExtension(c, [P(0, 0, { rawPrice: 10 }), P(100, 100, { rawPrice: 20 })], R, toPixel)],
    ['renderPitchfork', (c) => renderPitchfork(c, [P(50, 300), P(200, 100), P(200, 200)], R)],
    ['renderChannel', (c) => renderChannel(c, [P(50, 300), P(200, 100), P(60, 350)], R)],
    ['renderMeasure', (c) => renderMeasure(c, [P(10, 10, { rawPrice: 100 }), P(90, 60, { rawPrice: 110 })], { barCount: 4 })],
    ['renderPosition', (c) => renderPosition(c, [P(10, 10, { rawPrice: 100 }), P(20, 40, { rawPrice: 95 }), P(30, 0, { rawPrice: 115 })])],
    ['renderSelectionHandles', (c) => renderSelectionHandles(c, [P(10, 10), P(90, 60)])],
    ['renderCrosshair', (c) => renderCrosshair(c, 10, 10, 100, R)],
  ]

  for (const [name, run] of CASES) {
    it(`${name} leaves the save/restore stack balanced`, () => {
      const ctx = makeCtx()
      run(ctx)
      expect(ctx.__depth()).toBe(0)
    })
  }

  it('every painter is exercised by this suite', () => {
    // Fails by name when a painter is added and nobody balanced it.
    expect(CASES.length).toBe(20)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('lines', () => {
  it('renderTrendline strokes exactly one segment between the two points', () => {
    const ctx = makeCtx()
    renderTrendline(ctx, [P(10, 20), P(30, 40)])
    expect(ctx.__ops()).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
    expect(ctx.__find('moveTo')[0].args).toEqual([10, 20])
    expect(ctx.__find('lineTo')[0].args).toEqual([30, 40])
  })

  it('renderTrendline draws NOTHING with fewer than two points', () => {
    const ctx = makeCtx()
    renderTrendline(ctx, [P(10, 20)])
    expect(ctx.__ops()).toEqual([])
  })

  it('renderHorizontal spans 0 → w at the point’s y', () => {
    const ctx = makeCtx()
    renderHorizontal(ctx, [P(400, 123)], R)
    expect(ctx.__find('moveTo')[0].args).toEqual([0, 123])
    expect(ctx.__find('lineTo')[0].args).toEqual([W, 123])
  })

  it('renderVertical spans 0 → h at the point’s x', () => {
    const ctx = makeCtx()
    renderVertical(ctx, [P(321, 50)], R)
    expect(ctx.__find('moveTo')[0].args).toEqual([321, 0])
    expect(ctx.__find('lineTo')[0].args).toEqual([321, H])
  })

  it('renderHRay starts AT its anchor, not at the canvas edge', () => {
    const ctx = makeCtx()
    renderHRay(ctx, [P(250, 90)], W)
    expect(ctx.__find('moveTo')[0].args).toEqual([250, 90])
    expect(ctx.__find('lineTo')[0].args).toEqual([W, 90])
  })

  it('✅ renderHRay now SKIPS an anchor with no x, instead of falling back to 0', () => {
    // It used to read `pts[0].x ?? 0`, so an unresolvable anchor drew a ray from
    // the chart's left edge — a line the user never placed, in a place they never
    // clicked. An unresolvable anchor now renders nothing at all.
    const ctx = makeCtx()
    renderHRay(ctx, [{ y: 90, valid: false }], W)
    expect(ctx.__ops()).toEqual([])
  })

  it('every painter skips a drawing whose anchors cannot be resolved', () => {
    const bad = [{ x: null, y: 10, valid: false }, P(90, 60)]
    for (const run of [
      (c) => renderTrendline(c, bad),
      (c) => renderRay(c, bad, R),
      (c) => renderExtended(c, bad, R),
      (c) => renderRect(c, bad),
      (c) => renderCircle(c, bad),
      (c) => renderArrow(c, bad),
      (c) => renderMeasure(c, bad, { type: 'measure' }),
    ]) {
      const ctx = makeCtx()
      run(ctx)
      expect(ctx.__ops()).toEqual([])
    }
  })
})

describe('⭐ PRICE LABELS — the Phase 4 feature, on both flat-line tools', () => {
  // ⚰️ WHAT THESE REPLACE. Both labels used to be bare 10px `toFixed(2)` text.
  // The Horizontal Line's went at `canvasWidth − textWidth − 4`, i.e. INSIDE the
  // price-axis strip that `redraw()` clips away, so it had never been visible on
  // any chart with an axis. The Ray's was already in the right place but the
  // overlay hard-coded `showLabel: false`, so it had never run at all.
  const LBL = { showLabel: true, ink: '#c9a84c' }

  it('⛔ OFF BY DEFAULT — no label, and not one wasted measureText', () => {
    // The legacy path, and the common one. An old drawing carries no
    // `showPriceLabel`, so the overlay passes `showLabel: false` — and this must
    // cost nothing at all, on every frame, for every line on the chart.
    for (const paint of [
      (c) => renderHorizontal(c, [P(400, 123, { price: 10 })], R),
      (c) => renderHorizontal(c, [P(400, 123, { price: 10 })], R, { showLabel: false }),
      (c) => renderHRay(c, [P(250, 90, { price: 10 })], W),
      (c) => renderHRay(c, [P(250, 90, { price: 10 })], W, { showLabel: false }),
    ]) {
      const ctx = makeCtx({ strokeStyle: '#c9a84c' })
      paint(ctx)
      expect(ctx.__find('fillText')).toHaveLength(0)
      expect(ctx.__find('measureText')).toHaveLength(0)
      expect(ctx.__find('fillRect')).toHaveLength(0)
      expect(ctx.__find('roundRect')).toHaveLength(0)
      // …and the LINE itself is still drawn, exactly as before.
      expect(ctx.__find('stroke')).toHaveLength(1)
    }
  })

  it('the horizontal line\u2019s chip hugs the PRICE SCALE, inside the plot', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderHorizontal(ctx, [P(400, 123, { price: 123.456 })], R, LBL)
    const [text, tx, ty] = ctx.__find('fillText')[0].args
    expect(text).toBe('123.46')
    // Right edge of the chip lands on the plot's right edge, NOT the canvas
    // width — which is the whole reason it is now visible.
    const w = '123.46'.length * 6 + 10          // padX 5 either side
    expect(tx).toBeCloseTo(R.x1 - 1 - w + 5, 6)
    expect(tx + '123.46'.length * 6).toBeLessThanOrEqual(R.x1)
    expect(ty).toBeCloseTo(123, 6)              // vertically centred on the line
  })

  it('the chip is the LINE\u2019S colour with auto-contrast ink', () => {
    const dark = makeCtx({ strokeStyle: '#3f7fe0' })
    renderHorizontal(dark, [P(400, 123, { price: 10 })], R, { showLabel: true, ink: '#3f7fe0' })
    const fills = dark.__find('set:fillStyle').map((c) => c.args[0])
    expect(fills[0]).toBe('#3f7fe0')            // the plate
    expect(fills[1]).toBe('#ffffff')            // readable ink on a dark plate

    const light = makeCtx({ strokeStyle: '#e3cf4a' })
    renderHorizontal(light, [P(400, 123, { price: 10 })], R, { showLabel: true, ink: '#e3cf4a' })
    expect(light.__find('set:fillStyle').map((c) => c.args[0])[1]).toBe('#000000')
  })

  it('⭐ the RAY\u2019S label tags its own anchor instead — two tools, two questions', () => {
    const ctx = makeCtx({ strokeStyle: '#60a5fa' })
    renderHRay(ctx, [P(250, 90, { price: 42.5 })], W, { showLabel: true, ink: '#60a5fa' })
    const [text, tx, ty] = ctx.__find('fillText')[0].args
    expect(text).toBe('42.50')
    expect(tx).toBeCloseTo(250 + 5, 6)          // starts AT the anchor (+ padding)
    expect(ty).toBeLessThan(90)                 // above the line
    expect(ctx.__find('set:fillStyle')[0].args[0]).toBe('#60a5fa')
  })

  it('⛔ NO MORE toFixed(2) — the caller\u2019s formatter decides the precision', () => {
    // The series' own formatter is what the overlay passes, so a drawing's price
    // reads exactly like the axis tag beside it on any instrument.
    const ctx = makeCtx()
    renderHorizontal(ctx, [P(400, 123, { price: 0.004213 })], R,
      { showLabel: true, ink: '#c9a84c', fmt: (v) => `$${v.toFixed(5)}` })
    expect(ctx.__find('fillText')[0].args[0]).toBe('$0.00421')
    // …and with no formatter, the shared magnitude-aware default — not 2dp.
    const d = makeCtx()
    renderHorizontal(d, [P(400, 123, { price: 0.004213 })], R, LBL)
    expect(d.__find('fillText')[0].args[0]).toBe('0.0042')
  })

  it('two labels at the same level step apart instead of printing on top', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    const avoid = []
    renderHorizontal(ctx, [P(400, 200, { price: 10 })], R, { ...LBL, avoid })
    renderHorizontal(ctx, [P(400, 201, { price: 11 })], R, { ...LBL, avoid })
    const ys = ctx.__find('fillText').map((c) => c.args[2])
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThan(10)
    expect(avoid).toHaveLength(2)
  })

  it('the chip stays inside its pane, so a label cannot cross the divider', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderHorizontal(ctx, [P(400, VOL.y0 + 1, { price: 10 })], VOL, LBL)
    const box = ctx.__find('roundRect')[0] || ctx.__find('rect')[0]
    expect(box.args[1]).toBeGreaterThanOrEqual(VOL.y0)
    expect(box.args[1] + box.args[3]).toBeLessThanOrEqual(VOL.y1)
  })

  it('neither label is drawn when the point carries no price', () => {
    const a = makeCtx(); renderHorizontal(a, [P(400, 123)], R, LBL)
    const b = makeCtx(); renderHRay(b, [P(250, 90)], W, LBL)
    expect(a.__find('fillText')).toHaveLength(0)
    expect(b.__find('fillText')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('shapes', () => {
  it('renderRect fills at alpha 0.08 inside save/restore, then strokes at full alpha', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(90, 60), P(10, 10)])          // reversed corners on purpose
    const ops = ctx.__ops()
    expect(ops.filter((o) => o === 'save')).toHaveLength(1)
    expect(ctx.__find('fillRect')[0].args).toEqual([10, 10, 80, 50])   // normalised
    expect(ctx.__find('strokeRect')[0].args).toEqual([10, 10, 80, 50])
    // The stroke happens AFTER the restore, so the border is never faded.
    expect(ops.indexOf('strokeRect')).toBeGreaterThan(ops.lastIndexOf('restore'))
    expect(ctx.__state.globalAlpha).toBe(1)
  })

  it('✅ the dead replace()-chain fillStyle is GONE', () => {
    // ⚰️ It built an unparseable colour string ('c9a84c') and assigned it; canvas
    // ignored it and fillStyle was set again before anything was filled. Phase 0
    // kept it to stay behaviour-neutral. Nothing writes it now.
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(10, 10), P(90, 60)])
    const fills = ctx.__find('set:fillStyle').map((c) => c.args[0])
    expect(fills).not.toContain('c9a84c')
    expect(fills[0]).toBe('#c9a84c')
  })

  it('⛔ A RECTANGLE WITH NO FILL OF ITS OWN IS PIXEL-IDENTICAL TO BEFORE', () => {
    // Every rectangle anyone has ever drawn is in this case. Border colour =
    // stroke, fill colour = stroke, alpha = the shipped 0.08.
    for (const d of [null, {}, { fillColor: null }, { type: 'rect', color: '#c9a84c' }]) {
      const ctx = makeCtx({ strokeStyle: '#c9a84c' })
      renderRect(ctx, [P(10, 10), P(90, 60)], d)
      expect(ctx.__find('set:globalAlpha')[0].args[0]).toBe(0.08)
      expect(ctx.__find('set:fillStyle')[0].args[0]).toBe('#c9a84c')
      expect(ctx.__find('fillRect')[0].args).toEqual([10, 10, 80, 50])
      expect(ctx.__state.globalAlpha).toBe(1)
    }
  })

  it('⭐ BORDER AND FILL ARE INDEPENDENT — outline one colour, inside another', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(10, 10), P(90, 60)], { fillColor: '#3f7fe0', borderColor: '#ff5b5b' })
    expect(ctx.__find('set:fillStyle')[0].args[0]).toBe('#3f7fe0')
    // …and an EXPLICIT fill is not dimmed to 8% — the colour carries its own
    // alpha from the picker, so the opacity slider means what it says.
    expect(ctx.__find('set:globalAlpha')[0].args[0]).toBe(1)
    expect(ctx.__find('set:strokeStyle').at(-1).args[0]).toBe('#ff5b5b')
  })

  it('the percent label is OFF unless asked, and reads the ANCHOR ORDER', () => {
    const off = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(off, [P(10, 10, { price: 100 }), P(190, 160, { price: 110 })], {})
    expect(off.__find('fillText')).toHaveLength(0)

    // ⛔ NOT `boundsOf`. Drawn top-down (100 → 110) it is a rise; drawn the other
    // way round the SAME rectangle is a fall. Normalised bounds would print +10%
    // for both, which is the bug this test exists to prevent.
    const up = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(up, [P(10, 160, { price: 100 }), P(190, 10, { price: 110 })], {}, { showPercent: true })
    expect(up.__find('fillText')[0].args[0]).toBe('+10.00%')

    const down = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(down, [P(190, 10, { price: 110 }), P(10, 160, { price: 100 })], {}, { showPercent: true })
    expect(down.__find('fillText')[0].args[0]).toBe('-9.09%')
  })

  it('the percent label sits in the CENTRE of the box, wherever the box is', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(100, 300, { price: 50 }), P(400, 100, { price: 60 })], {}, { showPercent: true })
    const [, tx, ty] = ctx.__find('fillText')[0].args
    const text = '+20.00%'
    expect(tx + (text.length * 6) / 2).toBeCloseTo(250, 6)   // (100+400)/2
    expect(ty).toBeCloseTo(200, 6)                            // (300+100)/2
  })

  it('⛔ a box too small to hold the chip gets NO chip', () => {
    const tiny = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(tiny, [P(10, 10, { price: 100 }), P(30, 20, { price: 110 })], {}, { showPercent: true })
    expect(tiny.__find('fillText')).toHaveLength(0)
    // …but the rectangle itself still draws.
    expect(tiny.__find('strokeRect')).toHaveLength(1)
  })

  it('no percent label without two real prices — a volume-pane box says nothing', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(10, 10), P(190, 160)], {}, { showPercent: true })
    expect(ctx.__find('fillText')).toHaveLength(0)
    const zero = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(zero, [P(10, 10, { price: 0 }), P(190, 160, { price: 5 })], {}, { showPercent: true })
    expect(zero.__find('fillText')).toHaveLength(0)
  })

  it('renderCircle centres an ellipse on the bounding box and never collapses below 1px', () => {
    const ctx = makeCtx()
    renderCircle(ctx, [P(10, 10), P(90, 60)])
    expect(ctx.__find('ellipse')[0].args.slice(0, 4)).toEqual([50, 35, 40, 25])
    const flat = makeCtx()
    renderCircle(flat, [P(10, 10), P(10, 10)])
    expect(flat.__find('ellipse')[0].args.slice(2, 4)).toEqual([1, 1])
  })

  it('⛔ AN ARROW THAT NAMES NO SIZE IS STILL THE SHIPPED 10px ARROW', () => {
    // Every arrow drawn before Phase 4 is in this case, and Medium is 10 for
    // exactly this reason — so legacy arrows are unchanged AND show up correctly
    // as Medium the first time someone opens the picker.
    for (const d of [null, {}, { arrowSize: undefined }, { arrowSize: 0 }, { arrowSize: 'big' }]) {
      const ctx = makeCtx({ lineWidth: 3 })
      renderArrow(ctx, [P(0, 0), P(100, 0)], d)
      const head = ctx.__find('lineTo').slice(1)
      expect(head).toHaveLength(2)
      expect(head[0].args[0]).toBeCloseTo(100 - 10 * Math.cos(-0.4), 6)
    }
    expect(ARROW_SIZES.medium).toBe(10)
  })

  it('⭐ three sizes, and the head is the only thing that changes', () => {
    for (const size of [ARROW_SIZES.small, ARROW_SIZES.medium, ARROW_SIZES.large]) {
      const ctx = makeCtx({ lineWidth: 1 })
      renderArrow(ctx, [P(0, 0), P(200, 0)], { arrowSize: size })
      const head = ctx.__find('lineTo').slice(1)
      expect(head[0].args[0]).toBeCloseTo(200 - size * Math.cos(-0.4), 6)
      // The head still lands exactly on the anchor: the arrow points where the
      // user clicked, whatever size it is.
      expect(ctx.__find('moveTo').at(-1).args).toEqual([200, 0])
      expect(ctx.__ops()).toContain('closePath')
      expect(ctx.__ops().at(-1)).toBe('fill')
    }
  })

  it('head size is independent of line width, at every combination', () => {
    for (const lw of [1, 2, 3, 4]) {
      for (const size of Object.values(ARROW_SIZES)) {
        const ctx = makeCtx({ lineWidth: lw })
        renderArrow(ctx, [P(0, 0), P(200, 0)], { arrowSize: size })
        expect(ctx.__find('lineTo')[1].args[0]).toBeCloseTo(200 - size * Math.cos(-0.4), 6)
      }
    }
  })

  it('⛔ THE SHAFT STOPS SHORT SO IT CANNOT POKE THROUGH THE TIP', () => {
    // A thick shaft under a big head used to stick a stub out of the arrow's
    // point. The shaft now ends behind the head; the head still reaches the tip.
    const ctx = makeCtx({ lineWidth: 4 })
    renderArrow(ctx, [P(0, 0), P(200, 0)], { arrowSize: ARROW_SIZES.large })
    const shaftEnd = ctx.__find('lineTo')[0].args
    expect(shaftEnd[0]).toBeLessThan(200)
    expect(200 - shaftEnd[0]).toBeCloseTo(ARROW_SIZES.large * 0.8, 6)
    expect(shaftEnd[1]).toBeCloseTo(0, 6)
  })

  it('a very short arrow keeps a visible shaft rather than vanishing', () => {
    const ctx = makeCtx()
    renderArrow(ctx, [P(0, 0), P(6, 0)], { arrowSize: ARROW_SIZES.large })
    const shaftEnd = ctx.__find('lineTo')[0].args
    expect(shaftEnd[0]).toBeCloseTo(6 * 0.4, 6)     // 60% eaten, 40% left
    expect(shaftEnd[0]).toBeGreaterThan(0)
  })

  it('a zero-length arrow does not divide by zero', () => {
    const ctx = makeCtx()
    expect(() => renderArrow(ctx, [P(50, 50), P(50, 50)], { arrowSize: 16 })).not.toThrow()
    expect(ctx.__find('lineTo')[0].args).toEqual([50, 50])
  })

  it('drawArrowhead points along the from → to vector', () => {
    const ctx = makeCtx()
    drawArrowhead(ctx, P(0, 0), P(0, 100), 10)     // straight down
    // moveTo(tip) then two lineTo barbs — the head is a closed triangle.
    const barbs = ctx.__find('lineTo').map((k) => k.args)
    expect(ctx.__find('moveTo')[0].args).toEqual([0, 100])   // tip
    expect(barbs).toHaveLength(2)
    expect(barbs[0][1]).toBeLessThan(100)          // both barbs behind the tip
    expect(barbs[1][1]).toBeLessThan(100)
  })

  it('renderCup falls back to a straight guide line with only two points', () => {
    const ctx = makeCtx()
    renderCup(ctx, [P(0, 0), P(100, 0)])
    expect(ctx.__ops()).toEqual(['beginPath', 'moveTo', 'lineTo', 'stroke'])
  })

  it('renderCup draws one quadratic through the bottom anchor with three', () => {
    const ctx = makeCtx()
    renderCup(ctx, [P(0, 0), P(50, 80), P(100, 0)])
    // C = 2·B − ½(L+R) = (2·50 − ½·100, 2·80 − 0) = (50, 160), which is what
    // makes the curve pass exactly through the bottom anchor at t = 0.5.
    expect(ctx.__find('quadraticCurveTo')[0].args).toEqual([50, 160, 100, 0])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('text', () => {
  it('wrapTextLines honours explicit newlines with no wrap width', () => {
    const ctx = makeCtx()
    expect(wrapTextLines(ctx, 'one\ntwo', 0)).toEqual(['one', 'two'])
  })

  it('wrapTextLines soft-wraps on words at the box width', () => {
    const ctx = makeCtx()   // 6px per char
    // ⚠️ NOTE THE LEADING SPACE on the wrapped line. The splitter keeps
    // whitespace tokens so words can rejoin, and a flush trims the TRAILING
    // space but the next line then starts with the separator token. Shipped
    // behaviour, pinned rather than fixed: it shifts every wrapped line of a
    // Text Note right by one space, and it belongs to Phase 6 with the rest of
    // the note's layout, not to a behaviour-neutral extraction.
    expect(wrapTextLines(ctx, 'aaa bbb ccc', 42)).toEqual(['aaa bbb', ' ccc'])
  })

  it('wrapTextLines breaks a single token wider than the box, by character', () => {
    const ctx = makeCtx()
    expect(wrapTextLines(ctx, 'aaaaaaaaaa', 30)).toEqual(['aaaaa', 'aaaaa'])
  })

  it('wrapTextLines survives null / undefined text', () => {
    const ctx = makeCtx()
    expect(wrapTextLines(ctx, null, 100)).toEqual([''])
    expect(wrapTextLines(ctx, undefined, 100)).toEqual([''])
  })

  it('renderText draws one fillText per wrapped line at lineHeight 1.4', () => {
    const ctx = makeCtx()
    renderText(ctx, [P(10, 20)], { text: 'a\nb', fontSize: 10 })
    const ys = ctx.__find('fillText').map((c) => c.args[2])
    expect(ys).toEqual([20 + 14, 20 + 28])
  })

  it('⚠️ renderText puts its FIRST baseline a whole line-height below the anchor', () => {
    // ⚰️ One of the three causes of "the text note moves after I place it": the
    // edit textarea puts its first line ~6px below the same anchor, the canvas
    // puts it ~18px below. Phase 6 reconciles them; Phase 0 pins the gap.
    const ctx = makeCtx()
    renderText(ctx, [P(10, 20)], { text: 'x', fontSize: 13 })
    expect(ctx.__find('fillText')[0].args[2]).toBeCloseTo(20 + 13 * 1.4, 6)
  })

  it('renderText multiplies the incoming alpha rather than overwriting it', () => {
    // The Model Book focus-zoom fade sets a layer alpha; a note fading in on top
    // of a faded layer must compound, not reset.
    const ctx = makeCtx({ globalAlpha: 0.5 })
    renderText(ctx, [P(10, 20)], { text: 'x', fontSize: 13 }, 0.4)
    const alphas = ctx.__find('set:globalAlpha').map((c) => c.args[0])
    expect(alphas[0]).toBeCloseTo(0.2, 6)
    expect(alphas.at(-1)).toBe(0.5)      // and puts the layer alpha back
    expect(ctx.__state.globalAlpha).toBe(0.5)
  })

  it('renderText draws nothing for empty text or a fully faded layer', () => {
    const a = makeCtx(); renderText(a, [P(0, 0)], { text: '' })
    const b = makeCtx(); renderText(b, [P(0, 0)], { text: 'x' }, 0.01)
    expect(a.__find('fillText')).toHaveLength(0)
    expect(b.__find('fillText')).toHaveLength(0)
  })
})

describe('renderAdvance', () => {
  const toPixelY = (_, price) => 300 - price

  it('anchors an ADVANCE above the high and reads the sign from advPct', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, [P(100, 250), P(200, 250)], { advPct: 18.6, advHigh: 40 }, toPixelY, 16, W)
    const [text, , y] = ctx.__find('fillText')[0].args
    expect(text).toBe('+19%')
    expect(y).toBe(300 - 40 - 16)
    expect(ctx.__state.textBaseline).toBe('alphabetic')   // restored
  })

  it('anchors a DECLINE below the LOW, not below the high', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, [P(100, 250), P(200, 250)], { advPct: -24, advHigh: 40, advLow: 10 }, toPixelY, 16, W)
    const [text, , y] = ctx.__find('fillText')[0].args
    expect(text).toBe('-24%')
    expect(y).toBe(300 - 10 + 16)
  })

  it('adds a thousands separator to a big move', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, [P(100, 250)], { advPct: 1156.4, advHigh: 40 }, toPixelY, 16, W)
    expect(ctx.__find('fillText')[0].args[0]).toBe('+1,156%')
  })

  it('clamps a label that would overflow the plot edge, and skips one whose candle is off-screen', () => {
    const near = makeCtx()
    renderAdvance(near, [P(W - 2, 250)], { advPct: 5, advHigh: 40 }, toPixelY, 16, W)
    expect(near.__find('fillText')[0].args[1]).toBeLessThan(W - 2)
    const gone = makeCtx()
    renderAdvance(gone, [P(W + 50, 250)], { advPct: 5, advHigh: 40 }, toPixelY, 16, W)
    expect(gone.__find('fillText')).toHaveLength(0)
  })

  it('a user-chosen labelColor beats the auto-ink', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, [P(100, 250)], { advPct: 5, advHigh: 40, labelColor: '#ff5b5b' }, toPixelY, 16, W, '#ffffff')
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#ff5b5b')
  })

  it('draws nothing when advPct is absent', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, [P(100, 250)], {}, toPixelY, 16, W)
    expect(ctx.__find('fillText')).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ CHARACTERISATION — Fibonacci as it ships (Phase 7 rebuilds this)', () => {
  const toPixel = (_, price) => 400 - price * 10

  it('renderFib draws one full-width line per level, ignoring the drawing’s own colour', () => {
    const ctx = makeCtx({ strokeStyle: '#ff00ff' })
    renderFib(ctx, [P(0, 0, { rawPrice: 10 }), P(100, 100, { rawPrice: 20 })], W, toPixel)
    expect(ctx.__find('stroke')).toHaveLength(FIB_LEVELS.length)
    const strokes = ctx.__find('set:strokeStyle').map((c) => c.args[0])
    expect(strokes).toEqual(FIB_COLORS)               // the drawing colour never appears
    expect(strokes).not.toContain('#ff00ff')
  })

  it('renderFib places 0% at the HIGH and 100% at the LOW, whichever way it was drawn', () => {
    const up = makeCtx(); renderFib(up, [P(0, 0, { rawPrice: 10 }), P(1, 1, { rawPrice: 20 })], R, toPixel)
    const down = makeCtx(); renderFib(down, [P(0, 0, { rawPrice: 20 }), P(1, 1, { rawPrice: 10 })], R, toPixel)
    const labels = (c) => c.__find('fillText').map((k) => k.args[0])
    expect(labels(up)).toEqual(labels(down))
    expect(labels(up)[0]).toBe('0.0% — $20.00')
    expect(labels(up).at(-1)).toBe('100.0% — $10.00')
  })

  it('renderFib leaves the dash array clean for the next painter', () => {
    const ctx = makeCtx()
    renderFib(ctx, [P(0, 0, { rawPrice: 10 }), P(1, 1, { rawPrice: 20 })], R, toPixel)
    expect(ctx.__state.lineDash).toEqual([])
  })

  it('renderFib bails on a zero or inverted range instead of dividing by it', () => {
    const ctx = makeCtx()
    renderFib(ctx, [P(0, 0, { rawPrice: 10 }), P(1, 1, { rawPrice: 10 })], R, toPixel)
    expect(ctx.__ops()).toEqual([])
  })

  it('renderFibExtension projects BEYOND the swing and dashes those levels differently', () => {
    const ctx = makeCtx()
    renderFibExtension(ctx, [P(0, 0, { rawPrice: 10 }), P(1, 1, { rawPrice: 20 })], R, toPixel)
    expect(ctx.__find('stroke')).toHaveLength(FIB_EXT_LEVELS.length)
    const dashes = ctx.__find('setLineDash').map((c) => c.args[0])
    expect(dashes[0]).toEqual([])          // 0    → solid
    expect(dashes[1]).toEqual([4, 3])      // .236 → retracement dash
    expect(dashes[7]).toEqual([6, 3])      // 1.272 → extension dash
    expect(ctx.__find('fillText').at(-1).args[0]).toBe('261.8% — $36.18')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ CHARACTERISATION — multi-line tools (Phase 2 rebuilds the geometry)', () => {
  it('renderPitchfork draws median + two prongs + handle bar + one fill', () => {
    const ctx = makeCtx()
    renderPitchfork(ctx, [P(50, 300), P(200, 100), P(200, 200)], R)
    expect(ctx.__find('stroke')).toHaveLength(4)
    expect(ctx.__find('fill')).toHaveLength(1)
  })

  it('✅ renderPitchfork now MULTIPLIES the layer alpha instead of overwriting it', () => {
    // WAS: after the handle bar it wrote `globalAlpha = 1` — not the value it
    // found. On the normal chart the layer alpha IS 1, so nothing looked wrong;
    // under Model Book's focus-zoom fade everything after that point (the bar,
    // then the prong fill) painted at full strength while the rest of the drawing
    // faded around it.
    const ctx = makeCtx({ globalAlpha: 0.3 })
    renderPitchfork(ctx, [P(50, 300), P(200, 100), P(200, 200)], R)
    const alphas = ctx.__find('set:globalAlpha').map((c) => c.args[0])
    expect(alphas).toContain(0.3 * 0.4)     // handle bar, faded
    expect(alphas).toContain(0.3 * 0.04)    // prong fill, faded
    expect(alphas).not.toContain(1)         // never hard-resets the layer
    expect(ctx.__state.globalAlpha).toBe(0.3)
  })

  it('✅ renderChannel’s fill fades with the layer too', () => {
    const ctx = makeCtx({ globalAlpha: 0.5 })
    renderChannel(ctx, [P(50, 300), P(200, 100), P(60, 350)], R)
    expect(ctx.__find('set:globalAlpha').map((c) => c.args[0])).toContain(0.5 * 0.04)
    expect(ctx.__state.globalAlpha).toBe(0.5)
  })

  it('on the normal chart (layer alpha 1) both are byte-identical to the shipped values', () => {
    const f = makeCtx(); renderPitchfork(f, [P(50, 300), P(200, 100), P(200, 200)], R)
    expect(f.__find('set:globalAlpha').map((c) => c.args[0])).toEqual([0.4, 1, 0.04])
    const c = makeCtx(); renderChannel(c, [P(50, 300), P(200, 100), P(60, 350)], R)
    expect(c.__find('set:globalAlpha').map((c2) => c2.args[0])).toEqual([0.04])
  })

  it('renderChannel draws only the first line until the third point exists', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(50, 300), P(200, 100)], R)
    expect(ctx.__find('stroke')).toHaveLength(1)
    expect(ctx.__find('fill')).toHaveLength(0)
  })

  it('✅ renderChannel’s fill is now built OUTSIDE the rect and trimmed by the clip', () => {
    // WAS: a 4-gon built from CLIPPED endpoints, which assumed the band is always
    // a quadrilateral (it is a pentagon when its edges leave through different
    // sides — hence the missing corner) and that both edges come back traversed
    // the same way (they did not — hence the bow-tie).
    // NOW: both edges are extended well past the pane and `ctx.clip()` does the
    // trimming, which is correct for every case by construction.
    const ctx = makeCtx()
    renderChannel(ctx, [P(50, 300), P(200, 100), P(60, 350)], R)
    const closeIdx = ctx.__ops().lastIndexOf('closePath')
    const verts = ctx.__calls
      .slice(ctx.__ops().lastIndexOf('beginPath'), closeIdx)
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
    expect(verts).toHaveLength(4)
    // At least one vertex is OUTSIDE the pane — that is the whole point.
    const outside = verts.filter((v) => {
      const [x, y] = v.args
      return x < R.x0 || x > R.x1 || y < R.y0 || y > R.y1
    })
    expect(outside.length).toBeGreaterThan(0)
    expect(closeIdx).toBeLessThan(ctx.__ops().lastIndexOf('fill'))
  })

  it('✅ the fill quad is SIMPLE — its edges never cross (no bow-tie)', () => {
    const ctx = makeCtx()
    // The exact geometry Phase 0 pinned as producing reversed traversal.
    renderChannel(ctx, [P(100, 20), P(120, -60), P(100, 120)], R)
    const closeIdx = ctx.__ops().lastIndexOf('closePath')
    const q = ctx.__calls
      .slice(ctx.__ops().lastIndexOf('beginPath'), closeIdx)
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => ({ x: c.args[0], y: c.args[1] }))
    expect(q).toHaveLength(4)
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    const signs = q.map((_, i) => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]))).filter(Boolean)
    expect(new Set(signs).size).toBe(1)      // convex ⇒ simple ⇒ nothing cancels
  })

  it('renders a channel inside a VOLUME pane without reaching the candles', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(50, 380), P(200, 340), P(60, 395)], VOL)
    const strokes = ctx.__find('moveTo').concat(ctx.__find('lineTo'))
    // Stroked geometry is clipped analytically to the volume rect. (The FILL is
    // deliberately outside it — ctx.clip() trims that, which the recorder cannot
    // model, so only the strokes are asserted here.)
    const strokeVerts = strokes.slice(0, 4)
    for (const v of strokeVerts) expect(v.args[1]).toBeGreaterThanOrEqual(VOL.y0 - 1e-6)
  })

  it('renderChannel leaves the dash array clean', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(50, 300), P(200, 100), P(60, 350)], R)
    expect(ctx.__state.lineDash).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('renderMeasure — the box, and whatever the caller says goes in it', () => {
  const pts = [P(10, 10, { rawPrice: 100 }), P(90, 60, { rawPrice: 118.9 })]
  const L = (lines) => ({ lines })

  it('⛔ THE PAINTER NO LONGER CHOOSES THE TEXT', () => {
    // ⚰️ It used to branch on `d.type` across four hard-coded layouts and read a
    // bar count the overlay had frozen at creation. Content is resolved before
    // the call now, which is the whole reason a Measure can show any of the
    // sixteen field combinations instead of the one its type implied.
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure', barCount: 999 }, L(['+18.90 (+18.90%)', '25 bars · 6w 2d']))
    expect(ctx.__find('fillText').map((c) => c.args[0]))
      .toEqual(['+18.90 (+18.90%)', '25 bars · 6w 2d'])
    // …and the stale stored count is not consulted, even when it is sitting there.
    expect(ctx.__find('fillText').map((c) => c.args[0]).join()).not.toContain('999')
  })

  it('⭐ ONE CHIP BEHIND BOTH ROWS, not two plates four pixels apart', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure' }, L(['+18.90 (+18.90%)', '25 bars']))
    expect(ctx.__find('roundRect')).toHaveLength(1)
    expect(ctx.__find('set:fillStyle').map((c) => c.args[0])).toContain('rgba(20, 22, 18, 0.82)')
  })

  it('the chip is as wide as its WIDEST row', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure' }, L(['short', 'a much longer second row']))
    const [, , w] = ctx.__find('roundRect')[0].args
    expect(w).toBe('a much longer second row'.length * 6 + 10)
  })

  it('the box is drawn whatever the label says — including nothing at all', () => {
    for (const o of [null, L([]), L(['x'])]) {
      const ctx = makeCtx()
      renderMeasure(ctx, pts, { type: 'measure' }, o)
      expect(ctx.__find('strokeRect')).toHaveLength(1)
      expect(ctx.__find('fillRect')).toHaveLength(1)      // the 6% tint
    }
    const bare = makeCtx()
    renderMeasure(bare, pts, { type: 'measure' }, L([]))
    expect(bare.__find('fillText')).toHaveLength(0)
    expect(bare.__find('roundRect')).toHaveLength(0)      // no empty chip
  })

  it('⭐ LABEL POSITION MOVES THE CHIP INSIDE THE BOX', () => {
    const y = (pos) => {
      const ctx = makeCtx()
      renderMeasure(ctx, pts, { type: 'measure', labelPos: pos }, L(['a']))
      return ctx.__find('roundRect')[0].args[1]
    }
    expect(y('top')).toBeLessThan(y('center'))
    expect(y('center')).toBeLessThan(y('bottom'))
    // …and the default is centre, for a drawing that names no position.
    const dflt = makeCtx()
    renderMeasure(dflt, pts, { type: 'measure' }, L(['a']))
    expect(dflt.__find('roundRect')[0].args[1]).toBe(y('center'))
  })

  it('⛔ FLIP, DON\u2019T CLIP — a position that would leave the pane takes the other end', () => {
    // A measure box hard against the top of its pane cannot honour "top": the
    // chip would be painted into the pane above. It flips to the bottom rather
    // than being cut in half, because the number IS the tool.
    const bounds = { x0: 0, y0: 8, x1: W, y1: 300 }
    const ctx = makeCtx()
    renderMeasure(ctx, [P(10, 10, { rawPrice: 100 }), P(90, 120, { rawPrice: 110 })],
      { type: 'measure', labelPos: 'top' }, { lines: ['a'], bounds })
    const [, by, , bh] = ctx.__find('roundRect')[0].args
    expect(by).toBeGreaterThanOrEqual(bounds.y0)
    expect(by + bh).toBeLessThanOrEqual(bounds.y1)
  })

  it('the dashed box and its 6% tint are exactly what shipped', () => {
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderMeasure(ctx, pts, { type: 'measure' }, L(['a']))
    expect(ctx.__find('setLineDash')[0].args[0]).toEqual([3, 3])
    expect(ctx.__find('strokeRect')[0].args).toEqual([10, 10, 80, 50])
    expect(ctx.__find('set:globalAlpha')[0].args[0]).toBe(0.06)
    expect(ctx.__state.globalAlpha).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ renderBarsTime — a ruler, deliberately not a box', () => {
  const pts = [P(100, 200, { rawPrice: 50 }), P(300, 200, { rawPrice: 50 })]

  it('draws a span with two end caps, and NO box and NO fill', () => {
    const ctx = makeCtx()
    renderBarsTime(ctx, pts, { type: 'dateRange' }, { lines: ['25 bars'] })
    expect(ctx.__find('strokeRect')).toHaveLength(0)
    expect(ctx.__find('fillRect')).toHaveLength(0)
    // one horizontal + two vertical caps, in a single path
    const moves = ctx.__find('moveTo').map((c) => c.args)
    const lines = ctx.__find('lineTo').map((c) => c.args)
    expect(moves).toEqual([[100, 200], [100, 195], [300, 195]])
    expect(lines).toEqual([[300, 200], [100, 205], [300, 205]])
  })

  it('⛔ ONE PRICE ROW — a legacy dateRange with two prices still reads level', () => {
    const ctx = makeCtx()
    renderBarsTime(ctx, [P(100, 200), P(300, 260)], { type: 'dateRange' }, { lines: ['25 bars'] })
    const ys = [...ctx.__find('moveTo'), ...ctx.__find('lineTo')].map((c) => c.args[1])
    // Every y is within a cap of the FIRST anchor's row; none is near 260.
    for (const y of ys) expect(Math.abs(y - 200)).toBeLessThanOrEqual(5)
  })

  it('is drawn left-to-right whichever way it was placed', () => {
    const a = makeCtx(); renderBarsTime(a, pts, {}, { lines: ['x'] })
    const b = makeCtx(); renderBarsTime(b, [pts[1], pts[0]], {}, { lines: ['x'] })
    expect(a.__find('moveTo')[0].args[0]).toBe(b.__find('moveTo')[0].args[0])
  })

  it('centres its readout on the span, and can sit above or below it', () => {
    const y = (pos) => {
      const ctx = makeCtx()
      renderBarsTime(ctx, pts, { type: 'dateRange', labelPos: pos }, { lines: ['25 bars'] })
      const [bx, by] = ctx.__find('roundRect')[0].args
      return { bx, by }
    }
    expect(y('center').bx + ('25 bars'.length * 6 + 10) / 2).toBeCloseTo(200, 6)
    expect(y('top').by).toBeLessThan(y('center').by)
    expect(y('bottom').by).toBeGreaterThan(y('center').by)
  })

  it('draws the rule even with nothing to say', () => {
    const ctx = makeCtx()
    renderBarsTime(ctx, pts, {}, { lines: [] })
    expect(ctx.__find('stroke')).toHaveLength(1)
    expect(ctx.__find('roundRect')).toHaveLength(0)
  })

  it('skips a ruler whose anchors cannot be resolved', () => {
    const ctx = makeCtx()
    renderBarsTime(ctx, [P(100, 200), { valid: false }], {}, { lines: ['x'] })
    expect(ctx.__ops()).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ renderAdvance — the label IS the drawing', () => {
  const pts = [P(100, 300, { rawPrice: 100 }), P(400, 200, { rawPrice: 118 })]
  const toPixelY = (_, price) => 500 - price * 2

  it('⛔ NOTHING IS DRAWN BETWEEN THE ANCHORS — no persistent construction line', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, pts, { advPct: 18 }, toPixelY, 16, W)
    expect(ctx.__ops()).not.toContain('stroke')
    expect(ctx.__find('lineTo')).toHaveLength(0)
    expect(ctx.__find('fillText')).toHaveLength(1)
  })

  it('keeps the shipped rounded percent, with its thousands separator', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, pts, { advPct: 1156.4, advHigh: 118 }, toPixelY, 16, W)
    expect(ctx.__find('fillText')[0].args[0]).toBe('+1,156%')
  })

  it('an advance sits ABOVE the high; a decline BELOW the low', () => {
    // Read the baseline the painter SET, not the one left behind: it draws
    // inside save/restore, so the end state is the one it was handed.
    const baseline = (c) => c.__find('set:textBaseline').at(-1).args[0]
    const up = makeCtx()
    renderAdvance(up, pts, { advPct: 18, advHigh: 118 }, toPixelY, 16, W)
    expect(baseline(up)).toBe('bottom')
    const down = makeCtx()
    renderAdvance(down, pts, { advPct: -18, advLow: 90 }, toPixelY, 16, W)
    expect(baseline(down)).toBe('top')
    expect(down.__find('fillText')[0].args[2]).toBeGreaterThan(toPixelY(null, 90))
  })

  it('⭐ AN EXPLICIT LABEL POSITION IS HONOURED EXACTLY', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, pts, { advPct: 18, advHigh: 118 }, toPixelY, 16, W, '#fff', { at: { x: 250, y: 120 } })
    const [, tx, ty] = ctx.__find('fillText')[0].args
    expect(tx).toBe(250)
    expect(ty).toBe(120)
  })

  it('…and a drawing that has never been moved falls back to the derived spot', () => {
    const a = makeCtx(); renderAdvance(a, pts, { advPct: 18, advHigh: 118 }, toPixelY, 16, W)
    const b = makeCtx(); renderAdvance(b, pts, { advPct: 18, advHigh: 118 }, toPixelY, 16, W, '#fff', { at: null })
    expect(a.__find('fillText')[0].args).toEqual(b.__find('fillText')[0].args)
  })

  it('⭐ RETURNS THE BOX IT DREW, so the hit test and the handle use the ink', () => {
    const ctx = makeCtx()
    const box = renderAdvance(ctx, pts, { advPct: 18, advHigh: 118 }, toPixelY, 16, W)
    const [text, tx, ty] = ctx.__find('fillText')[0].args
    expect(box.w).toBeCloseTo(text.length * 6 + 6, 6)
    expect(box.cx).toBe(tx)
    // the box brackets the text it drew
    expect(box.y).toBeLessThan(ty)
    expect(box.y + box.h).toBeGreaterThan(ty - 11)
  })

  it('draws both figures on ONE line when the caller asks for both', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, pts, { advPct: 18 }, toPixelY, 16, W, '#fff', { lines: ['+18.00 (+18%)'] })
    expect(ctx.__find('fillText').map((c) => c.args[0])).toEqual(['+18.00 (+18%)'])
  })

  it('an anchor scrolled off the plot takes its label with it — unless it was placed', () => {
    const off = makeCtx()
    expect(renderAdvance(off, [P(-40, 300), P(-30, 200)], { advPct: 18 }, toPixelY, 16, W)).toBeNull()
    expect(off.__find('fillText')).toHaveLength(0)
    // A label the user positioned is its own fact and stays put.
    const placed = makeCtx()
    expect(renderAdvance(placed, [P(-40, 300), P(-30, 200)], { advPct: 18 }, toPixelY, 16, W, '#fff', { at: { x: 200, y: 100 } })).toBeTruthy()
  })

  it('a user colour wins over the auto ink', () => {
    const ctx = makeCtx()
    renderAdvance(ctx, pts, { advPct: 18, labelColor: '#1ae51a' }, toPixelY, 16, W, '#000000')
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#1ae51a')
  })
})

describe('renderPosition — retired in Phase 9, still readable forever', () => {
  it('shades risk red, reward green, and labels the R multiple', () => {
    const ctx = makeCtx()
    renderPosition(ctx, [
      P(10, 100, { rawPrice: 100 }), P(20, 140, { rawPrice: 95 }), P(30, 20, { rawPrice: 115 }),
    ])
    const fills = ctx.__find('set:fillStyle').map((c) => c.args[0])
    expect(fills).toContain('#ef4444')
    expect(fills).toContain('#22c55e')
    expect(ctx.__find('fillText')[0].args[0]).toBe('R:R 3.00 · risk 5.00 · reward 15.00')
  })

  it('uses the shared drawing gold for the entry line', () => {
    const ctx = makeCtx()
    renderPosition(ctx, [P(10, 100, { rawPrice: 1 }), P(20, 140, { rawPrice: 1 }), P(30, 20, { rawPrice: 1 })])
    expect(ctx.__find('set:strokeStyle').map((c) => c.args[0])).toContain(UCT_DRAW_GOLD)
  })

  it('reports ∞ rather than dividing by a zero-width stop', () => {
    const ctx = makeCtx()
    renderPosition(ctx, [P(10, 100, { rawPrice: 100 }), P(20, 100, { rawPrice: 100 }), P(30, 20, { rawPrice: 115 })])
    expect(ctx.__find('fillText')[0].args[0]).toMatch(/R:R ∞/)
  })
})

describe('renderAnchoredVwap', () => {
  const bars = [
    { t: 1, h: 10, l: 10, c: 10, v: 100 },
    { t: 2, h: 20, l: 20, c: 20, v: 100 },
    { t: 3, h: 30, l: 30, c: 30, v: 100 },
  ]
  const timeToIndex = new Map(bars.map((b, i) => [b.t, i]))
  const toPixel = (t, v) => ({ x: t * 10, y: 400 - v })

  it('accumulates from the anchor forward and labels the running VWAP', () => {
    const ctx = makeCtx()
    renderAnchoredVwap(ctx, { time: 1 }, bars, timeToIndex, toPixel)
    expect(ctx.__find('fillText')[0].args[0]).toBe('VWAP 20.00')   // (10+20+30)/3
  })

  it('starts at the anchor bar, not at bar zero', () => {
    const ctx = makeCtx()
    renderAnchoredVwap(ctx, { time: 2 }, bars, timeToIndex, toPixel)
    expect(ctx.__find('fillText')[0].args[0]).toBe('VWAP 25.00')   // (20+30)/2
  })

  it('marks the anchor with a dot ON the vwap line plus an "A"', () => {
    const ctx = makeCtx()
    renderAnchoredVwap(ctx, { time: 1 }, bars, timeToIndex, toPixel)
    expect(ctx.__find('arc')).toHaveLength(1)
    expect(ctx.__find('fillText').map((c) => c.args[0])).toContain('A')
  })

  it('draws nothing without an anchor time or with an unknown one', () => {
    const a = makeCtx(); renderAnchoredVwap(a, null, bars, timeToIndex, toPixel)
    const b = makeCtx(); renderAnchoredVwap(b, { time: 99 }, bars, timeToIndex, toPixel)
    expect(a.__ops()).toEqual([])
    expect(b.__ops()).toEqual([])
  })

  it('skips zero-volume bars without emitting NaN', () => {
    const zero = [{ t: 1, h: 10, l: 10, c: 10, v: 0 }, { t: 2, h: 20, l: 20, c: 20, v: 5 }]
    const ctx = makeCtx()
    renderAnchoredVwap(ctx, { time: 1 }, zero, new Map(zero.map((b, i) => [b.t, i])), toPixel)
    expect(ctx.__find('fillText')[0].args[0]).toBe('VWAP 20.00')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚠️ CHARACTERISATION — selection handles (Phase 1 makes them adaptive)', () => {
  it('✅ handles now INHERIT the drawing’s rendered ink', () => {
    // WAS: gold for every tool, because this painter took only points and could
    // not see the drawing. The ink passed in is the BRIGHTENED value the stroke
    // used — not `d.color` — so a handle can never be a different shade from the
    // line it sits on.
    const ctx = makeCtx({ strokeStyle: '#1ae51a' })
    renderSelectionHandles(ctx, [P(10, 10), P(90, 60)], '#1ae51a')
    expect(ctx.__find('set:fillStyle').map((c) => c.args[0])).toEqual(['#1ae51a', '#1ae51a'])
    // The dark ring stays: it is what keeps a handle visible on top of its own
    // line at any colour.
    expect(ctx.__find('set:strokeStyle').map((c) => c.args[0])).toEqual(['#1a1c17', '#1a1c17'])
  })

  it('falls back to the drawing gold when no ink is given', () => {
    const ctx = makeCtx()
    renderSelectionHandles(ctx, [P(10, 10)])
    expect(ctx.__find('set:fillStyle')[0].args[0]).toBe(UCT_DRAW_GOLD)
  })

  it('skips an anchor that could not be resolved', () => {
    const ctx = makeCtx()
    renderSelectionHandles(ctx, [{ x: null, y: 10, valid: false }, P(90, 60)], '#60a5fa')
    expect(ctx.__find('arc')).toHaveLength(1)
  })

  it('paints one dot per point at the fine-pointer radius, with no halo', () => {
    const ctx = makeCtx()
    renderSelectionHandles(ctx, [P(10, 10), P(90, 60)])
    const radii = ctx.__find('arc').map((c) => c.args[2])
    expect(radii).toEqual([HANDLE_FINE, HANDLE_FINE])
  })

  it('adds a grab-zone halo and a bigger dot on a coarse pointer', () => {
    setPointer(true)
    const ctx = makeCtx()
    renderSelectionHandles(ctx, [P(10, 10)], '#ff5b5b')
    const radii = ctx.__find('arc').map((c) => c.args[2])
    expect(radii).toEqual([HIT_COARSE + 2, HANDLE_COARSE])
    // The touch HALO stays neutral gold: it is a readout of the grab radius —
    // chrome, not part of the shape — and at 16% alpha a dark red would vanish.
    expect(ctx.__find('set:fillStyle')[0].args[0]).toBe('rgba(201, 168, 76, 0.16)')
  })

  it('does nothing for an empty point list', () => {
    const ctx = makeCtx()
    renderSelectionHandles(ctx, [])
    expect(ctx.__ops()).toEqual([])
  })
})

describe('renderCrosshair', () => {
  it('draws a dashed full-width and full-height pair, and restores the dash', () => {
    const ctx = makeCtx()
    renderCrosshair(ctx, 100, 50, 123, R)
    expect(ctx.__find('moveTo').map((c) => c.args)).toEqual([[100, 0], [0, 50]])
    expect(ctx.__find('lineTo').map((c) => c.args)).toEqual([[100, H], [W, 50]])
    expect(ctx.__state.lineDash).toEqual([])
  })

  it('draws NO price label at the cursor', () => {
    // Deliberate: the price scale's own crosshair label already shows it, and a
    // second one read as clutter. `price` stays in the signature for the caller.
    const ctx = makeCtx()
    renderCrosshair(ctx, 100, 50, 123, R)
    expect(ctx.__find('fillText')).toHaveLength(0)
  })
})
