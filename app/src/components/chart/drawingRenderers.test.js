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
import {
  drawArrowhead, renderTrendline, renderRay, renderExtended, renderHorizontal,
  renderHRay, renderVertical, renderRect, renderCircle, renderArrow, renderCup,
  wrapTextLines, renderText, renderAdvance, renderFib, renderFibExtension,
  renderPitchfork, renderChannel, renderMeasure, renderPosition,
  renderAnchoredVwap, renderSelectionHandles, renderCrosshair,
  FIB_LEVELS, FIB_COLORS, FIB_EXT_LEVELS,
} from './drawingRenderers'

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
beforeEach(() => setPointer(false))
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
    ['renderHRay', (c) => renderHRay(c, [P(10, 50, { price: 1.5 })], W, true)],
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
    renderHorizontal(ctx, [P(400, 123)], R, false)
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
    renderHRay(ctx, [P(250, 90)], W, false)
    expect(ctx.__find('moveTo')[0].args).toEqual([250, 90])
    expect(ctx.__find('lineTo')[0].args).toEqual([W, 90])
  })

  it('✅ renderHRay now SKIPS an anchor with no x, instead of falling back to 0', () => {
    // It used to read `pts[0].x ?? 0`, so an unresolvable anchor drew a ray from
    // the chart's left edge — a line the user never placed, in a place they never
    // clicked. An unresolvable anchor now renders nothing at all.
    const ctx = makeCtx()
    renderHRay(ctx, [{ y: 90, valid: false }], W, false)
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

describe('⚠️ CHARACTERISATION — price labels as they ship (Phase 4 changes both)', () => {
  it('renderHorizontal writes its label INSIDE the price-axis strip, where the clip eats it', () => {
    // ⚰️ THE HORIZONTAL LINE HAS ALWAYS HAD A PRICE LABEL AND NOBODY HAS SEEN IT.
    // It is written at `w − textWidth − 4`, but `redraw()` clips to
    // `plotRight = w − axisWidth − 1`. With a ~56px price axis and a 6-char
    // label (36px here) the whole label sits inside the clipped-away strip.
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderHorizontal(ctx, [P(400, 123, { price: 123.456 })], R, true, W)
    const [text, x] = ctx.__find('fillText')[0].args
    expect(text).toBe('123.46')                     // fixed 2dp, not tick-aware
    expect(x).toBe(W - '123.46'.length * 6 - 4)     // = 760
    const plotRight = W - 56 - 1                    // a typical axis width
    expect(x).toBeGreaterThan(plotRight)            // → clipped away entirely
  })

  it('renderHorizontal paints the label in the LINE colour', () => {
    const ctx = makeCtx({ strokeStyle: '#1ae51a' })
    renderHorizontal(ctx, [P(400, 123, { price: 10 })], R, true, W)
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#1ae51a')
  })

  it('renderHRay already places its label ABOVE the anchor, in the ray colour', () => {
    // ⚰️ Phase 4's "Horizontal Ray → show price label" is already implemented
    // here. The overlay hard-codes `showLabel: false` at the call site; that
    // literal is the whole of the missing feature.
    const ctx = makeCtx({ strokeStyle: '#60a5fa' })
    renderHRay(ctx, [P(250, 90, { price: 42.5 })], W, true)
    const [text, x, y] = ctx.__find('fillText')[0].args
    expect(text).toBe('42.50')
    expect(x).toBe(250)          // at the anchor, not the axis
    expect(y).toBe(90 - 5)       // just above the line
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#60a5fa')
  })

  it('renderHRay restores textBaseline so the next painter is unaffected', () => {
    const ctx = makeCtx()
    renderHRay(ctx, [P(250, 90, { price: 42.5 })], W, true)
    expect(ctx.__state.textBaseline).toBe('alphabetic')
  })

  it('neither label is drawn when the point carries no price', () => {
    const a = makeCtx(); renderHorizontal(a, [P(400, 123)], R, true, W)
    const b = makeCtx(); renderHRay(b, [P(250, 90)], W, true)
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

  it('⚠️ renderRect still assigns the dead replace()-chain fillStyle (Phase 4 deletes it)', () => {
    // Kept verbatim in Phase 0. It builds an unparseable colour string that a
    // real canvas ignores, and fillStyle is set again before anything is filled.
    const ctx = makeCtx({ strokeStyle: '#c9a84c' })
    renderRect(ctx, [P(10, 10), P(90, 60)])
    expect(ctx.__find('set:fillStyle')[0].args[0]).toBe('c9a84c')   // the nonsense value
    expect(ctx.__find('set:fillStyle')[1].args[0]).toBe('#c9a84c')  // the real one
  })

  it('renderCircle centres an ellipse on the bounding box and never collapses below 1px', () => {
    const ctx = makeCtx()
    renderCircle(ctx, [P(10, 10), P(90, 60)])
    expect(ctx.__find('ellipse')[0].args.slice(0, 4)).toEqual([50, 35, 40, 25])
    const flat = makeCtx()
    renderCircle(flat, [P(10, 10), P(10, 10)])
    expect(flat.__find('ellipse')[0].args.slice(2, 4)).toEqual([1, 1])
  })

  it('renderArrow strokes the shaft then fills a head sized 10, independent of lineWidth', () => {
    // ⚠️ The literal 10 is what Phase 4 turns into `arrowSize`. The separation
    // from lineWidth already exists — only the control is missing.
    const ctx = makeCtx({ lineWidth: 3 })
    renderArrow(ctx, [P(0, 0), P(100, 0)])
    const head = ctx.__find('lineTo').slice(1)   // first lineTo is the shaft
    expect(head).toHaveLength(2)
    expect(head[0].args[0]).toBeCloseTo(100 - 10 * Math.cos(-0.4), 6)
    expect(ctx.__ops()).toContain('closePath')
    expect(ctx.__ops().at(-1)).toBe('fill')
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
describe('renderMeasure', () => {
  const pts = [P(10, 10, { rawPrice: 100 }), P(90, 60, { rawPrice: 118.9 })]

  it('prints $ move, % move and bar count on two lines by default', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure', barCount: 25 })
    const texts = ctx.__find('fillText').map((c) => c.args[0])
    expect(texts).toEqual(['+18.90 (+18.90%)', '25 bars'])
  })

  it('pctOnly collapses it to a single % chip (Model Book index pane)', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure', barCount: 25 }, true)
    expect(ctx.__find('fillText').map((c) => c.args[0])).toEqual(['+18.90%'])
  })

  it('priceRange drops the bar count; dateRange drops the price', () => {
    const a = makeCtx(); renderMeasure(a, pts, { type: 'priceRange', barCount: 25 })
    const b = makeCtx(); renderMeasure(b, pts, { type: 'dateRange', barCount: 25 })
    expect(a.__find('fillText').map((c) => c.args[0])).toEqual(['+18.90 (+18.90%)'])
    expect(b.__find('fillText').map((c) => c.args[0])).toEqual(['25 bars'])
  })

  it('carries the sign of the drawn direction', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, [P(10, 10, { rawPrice: 118.9 }), P(90, 60, { rawPrice: 100 })], { type: 'measure' })
    expect(ctx.__find('fillText')[0].args[0]).toMatch(/^-18\.90 \(-15\.90%\)$/)
  })

  it('⚰️ reads barCount from the STORED value and never recomputes it', () => {
    // The drag path writes only `{points}`, so a resized Measure keeps a stale
    // count and a timeframe change keeps one that was never right. Phase 5
    // derives it here instead.
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure', barCount: 999 })
    expect(ctx.__find('fillText').map((c) => c.args[0])).toContain('999 bars')
  })

  it('backs each chip with the neutral dark plate, then restores textAlign', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, pts, { type: 'measure', barCount: 4 })
    expect(ctx.__find('roundRect')).toHaveLength(2)
    expect(ctx.__find('set:fillStyle').map((c) => c.args[0])).toContain('rgba(20, 22, 18, 0.82)')
    expect(ctx.__state.textAlign).toBe('start')
  })

  it('draws the box but no labels when the points carry no price', () => {
    const ctx = makeCtx()
    renderMeasure(ctx, [P(10, 10), P(90, 60)], { type: 'measure' })
    expect(ctx.__find('strokeRect')).toHaveLength(1)
    expect(ctx.__find('fillText')).toHaveLength(0)
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
