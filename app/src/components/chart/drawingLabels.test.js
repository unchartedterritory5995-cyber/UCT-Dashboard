/* The label primitive, and the fill resolver beside it.
 *
 * ⛔ NEITHER IS WIRED INTO A TOOL YET, AND THAT IS THE POINT OF TESTING THEM NOW.
 * Seven later items want a label and five want a fill; if the rules are settled
 * and pinned here, Phase 4/5/7 add a label by choosing a placement rather than by
 * writing canvas text for the eighth time. The defaults below reproduce today's
 * numbers exactly, so routing a painter through them later is a visual no-op.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  measuredWidth, _clearLabelCache, formatPrice, formatPercent, formatDelta,
  inkOn, labelBox, drawLabel, LABEL_FONT, avoidOverlap, priceFormatterFor,
} from './drawingLabels'
import { fillFor, borderFor } from './drawingStyle'

/** Minimal recording ctx — 6px per character, so label maths is arithmetic. */
function makeCtx() {
  const calls = []
  const state = { font: '10px sans-serif', fillStyle: '#000', textAlign: 'start', textBaseline: 'alphabetic' }
  const ctx = {
    measureText: (t) => { calls.push({ op: 'measureText', args: [t] }); return { width: String(t).length * 6 } },
    save: () => calls.push({ op: 'save' }),
    restore: () => calls.push({ op: 'restore' }),
    beginPath: () => calls.push({ op: 'beginPath' }),
    roundRect: (...a) => calls.push({ op: 'roundRect', args: a }),
    rect: (...a) => calls.push({ op: 'rect', args: a }),
    fill: () => calls.push({ op: 'fill' }),
    fillText: (...a) => calls.push({ op: 'fillText', args: a }),
  }
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, {
      get: () => state[k], set: (v) => { state[k] = v; calls.push({ op: `set:${k}`, args: [v] }) },
      configurable: true,
    })
  }
  ctx.__calls = calls
  ctx.__ops = () => calls.map((c) => c.op)
  ctx.__find = (op) => calls.filter((c) => c.op === op)
  return ctx
}

beforeEach(() => _clearLabelCache())

describe('measuredWidth — the cache that keeps 50 labels off the hot path', () => {
  it('measures once and reuses the answer', () => {
    // `redraw` runs on every frame the visible range changes. The same label text
    // in the same font is re-measured every one of those frames, per drawing, for
    // the life of the chart — the single most repeated call in a canvas label.
    const ctx = makeCtx()
    expect(measuredWidth(ctx, 'hello', LABEL_FONT)).toBe(30)
    expect(measuredWidth(ctx, 'hello', LABEL_FONT)).toBe(30)
    expect(measuredWidth(ctx, 'hello', LABEL_FONT)).toBe(30)
    expect(ctx.__find('measureText')).toHaveLength(1)
  })

  it('keys on the FONT too — a measurement is only valid for the font that made it', () => {
    const ctx = makeCtx()
    measuredWidth(ctx, 'hello', '11px A')
    measuredWidth(ctx, 'hello', '20px B')
    expect(ctx.__find('measureText')).toHaveLength(2)
  })

  it('restores the context font it borrowed', () => {
    const ctx = makeCtx()
    ctx.font = '13px original'
    measuredWidth(ctx, 'hi', '30px other')
    expect(ctx.font).toBe('13px original')
  })

  it('does not touch the font at all when it is already the right one', () => {
    const ctx = makeCtx()
    ctx.font = LABEL_FONT
    const before = ctx.__find('set:font').length
    measuredWidth(ctx, 'hi', LABEL_FONT)
    expect(ctx.__find('set:font')).toHaveLength(before)
  })

  it('is bounded — a chart cycling through thousands of prices cannot grow it forever', () => {
    const ctx = makeCtx()
    for (let i = 0; i < 700; i++) measuredWidth(ctx, `p${i}`, LABEL_FONT)
    const after = ctx.__find('measureText').length
    measuredWidth(ctx, 'p699', LABEL_FONT)
    // The cap dropped the map wholesale at 600; the tail is still warm.
    expect(ctx.__find('measureText').length).toBe(after)
  })
})

describe('formatPrice — one rule, so five tools cannot disagree', () => {
  it('⚰️ replaces the hard-coded .toFixed(2) that was wrong in both directions', () => {
    // Every shipped label does `price.toFixed(2)`: `0.00` for a sub-penny name,
    // and two meaningless digits on an index.
    expect(formatPrice(123.456)).toBe('123.46')
    expect(formatPrice(0.00421)).toBe('0.0042')     // NOT '0.00'
    expect(formatPrice(5432.1)).toBe('5432.10')
  })

  it('honours a known tick size over the magnitude guess', () => {
    expect(formatPrice(1.23456, { tick: 0.001 })).toBe('1.235')
    expect(formatPrice(1.5, { tick: 1 })).toBe('2')
  })

  it('returns an empty string for anything unusable, never NaN', () => {
    for (const bad of [null, undefined, NaN, 'abc', {}]) expect(formatPrice(bad)).toBe('')
  })

  it('formats an exact zero readably', () => {
    expect(formatPrice(0)).toBe('0.00')
  })
})

describe('formatPercent / formatDelta — the sign is always carried', () => {
  it('signs both directions, including zero', () => {
    expect(formatPercent(18.9)).toBe('+18.90%')
    expect(formatPercent(-7.421)).toBe('-7.42%')
    expect(formatPercent(0)).toBe('+0.00%')
  })

  it('signs a price delta the same way', () => {
    expect(formatDelta(50.678)).toBe('+50.68')
    expect(formatDelta(-3.2)).toBe('-3.20')
  })

  it('returns empty for junk', () => {
    expect(formatPercent(NaN)).toBe('')
    expect(formatDelta(undefined)).toBe('')
  })
})

describe('inkOn — contrast', () => {
  it('black on light, white on dark', () => {
    expect(inkOn('#ffffff')).toBe('#000000')
    expect(inkOn('#0f0f0f')).toBe('#ffffff')
  })

  it('defaults to WHITE when unreadable — the canvas is dark by default', () => {
    expect(inkOn('not-a-color')).toBe('#ffffff')
    expect(inkOn(null)).toBe('#ffffff')
  })
})

describe('labelBox — measurement without drawing', () => {
  it('pads the text on both axes', () => {
    const ctx = makeCtx()
    const b = labelBox(ctx, 'abc', { x: 100, y: 50 })
    expect(b.textW).toBe(18)
    expect(b.w).toBe(18 + 10)
    expect(b.h).toBe(11 + 6)
    expect(b).toMatchObject({ x: 100, y: 50 })
  })

  it('centres and right-aligns about the anchor', () => {
    const ctx = makeCtx()
    expect(labelBox(ctx, 'abc', { x: 100, align: 'center' }).x).toBe(100 - 14)
    expect(labelBox(ctx, 'abc', { x: 100, align: 'right' }).x).toBe(100 - 28)
  })

  it('respects the vertical baseline', () => {
    const ctx = makeCtx()
    expect(labelBox(ctx, 'a', { y: 50, baseline: 'middle' }).y).toBe(50 - 8.5)
    expect(labelBox(ctx, 'a', { y: 50, baseline: 'bottom' }).y).toBe(50 - 17)
  })
})

describe('drawLabel', () => {
  it('draws bare text with no chip when bg is null', () => {
    const ctx = makeCtx()
    drawLabel(ctx, { text: '+18.90%', x: 10, y: 20 })
    expect(ctx.__find('fill')).toHaveLength(0)
    expect(ctx.__find('fillText')).toHaveLength(1)
  })

  it('draws a rounded chip under the text when bg is set', () => {
    const ctx = makeCtx()
    drawLabel(ctx, { text: 'x', x: 10, y: 20, bg: 'rgba(20,22,18,0.82)' })
    expect(ctx.__find('roundRect')).toHaveLength(1)
    const ops = ctx.__ops()
    expect(ops.indexOf('fill')).toBeLessThan(ops.indexOf('fillText'))   // chip UNDER the ink
  })

  it('picks contrast ink automatically when a chip is drawn and no colour is given', () => {
    const ctx = makeCtx()
    drawLabel(ctx, { text: 'x', x: 0, y: 0, bg: '#ffffff' })
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#000000')
  })

  it('an explicit colour always wins', () => {
    const ctx = makeCtx()
    drawLabel(ctx, { text: 'x', x: 0, y: 0, bg: '#ffffff', color: '#1ae51a' })
    expect(ctx.__find('set:fillStyle').at(-1).args[0]).toBe('#1ae51a')
  })

  it('⭐ NUDGES a label back inside its pane rather than letting it overflow', () => {
    // The rule for the Measure "TOP would push it off the pane" case: move it,
    // never truncate it. A measurement you cannot finish reading is useless.
    const ctx = makeCtx()
    const bounds = { x0: 0, y0: 0, x1: 200, y1: 100 }
    const box = drawLabel(ctx, { text: 'a long measurement', x: 195, y: 95, bounds })
    expect(box.x + box.w).toBeLessThanOrEqual(200)
    expect(box.y + box.h).toBeLessThanOrEqual(100)
  })

  it('clamps to the LEFT edge when the label is simply wider than the pane', () => {
    const ctx = makeCtx()
    const box = drawLabel(ctx, { text: 'far too wide for this', x: 10, y: 5, bounds: { x0: 0, y0: 0, x1: 40, y1: 100 } })
    expect(box.x).toBe(0)   // reading starts at a predictable place
  })

  it('skipIfOutside DROPS a label whose subject has scrolled off the pane', () => {
    // Different from clamping on purpose: when the anchor itself is gone, pinning
    // the label to the edge is a lie about where the thing it names is.
    const ctx = makeCtx()
    const bounds = { x0: 0, y0: 0, x1: 200, y1: 100 }
    expect(drawLabel(ctx, { text: 'x', x: 500, y: 50, bounds, skipIfOutside: true })).toBeNull()
    expect(ctx.__find('fillText')).toHaveLength(0)
  })

  it('draws nothing for empty text', () => {
    const ctx = makeCtx()
    expect(drawLabel(ctx, { text: '', x: 0, y: 0 })).toBeNull()
    expect(drawLabel(ctx, { text: null, x: 0, y: 0 })).toBeNull()
  })

  it('leaves the context state as it found it', () => {
    const ctx = makeCtx()
    ctx.font = '13px mine'; ctx.textAlign = 'center'
    drawLabel(ctx, { text: 'x', x: 0, y: 0, bg: '#000' })
    const ops = ctx.__ops()
    expect(ops.filter((o) => o === 'save')).toHaveLength(1)
    expect(ops.filter((o) => o === 'restore')).toHaveLength(1)
    expect(ops.indexOf('save')).toBeLessThan(ops.indexOf('restore'))
  })
})

describe('fillFor / borderFor — an unnamed fill changes no pixels', () => {
  it('defaults ARE the shipped hard-coded alphas', () => {
    // renderRect / renderCircle 0.08, renderMeasure 0.06, pitchfork + channel 0.04.
    expect(fillFor({}, '#c9a84c').opacity).toBe(0.08)
    expect(fillFor({}, '#c9a84c', 0.06).opacity).toBe(0.06)
    expect(fillFor({}, '#c9a84c', 0.04).opacity).toBe(0.04)
  })

  it('follows the drawing’s rendered ink when it names no fill colour', () => {
    // The BRIGHTENED value, so a fill can never drift a shade from its own border.
    expect(fillFor({}, '#1ae51a').color).toBe('#1ae51a')
    expect(fillFor({ fillColor: null }, '#1ae51a').color).toBe('#1ae51a')
  })

  it('an explicit fill colour wins (Phase 4 Rectangle)', () => {
    expect(fillFor({ fillColor: '#60a5fa' }, '#1ae51a').color).toBe('#60a5fa')
  })

  it('⭐ AN EXPLICIT FILL IS NOT DIMMED TO 8% — the slider would look broken', () => {
    // ColorPanel emits `#rrggbbaa`, so the alpha the user chose is already IN
    // the colour. Multiplying it by the shipped 0.08 again would mean dragging
    // the opacity slider to 100% and getting 8%.
    expect(fillFor({ fillColor: '#60a5fa' }, '#1ae51a').opacity).toBe(1)
    expect(fillFor({ fillColor: '#60a5fa80' }, '#1ae51a').opacity).toBe(1)
    // …while a rectangle that names no fill keeps the shipped tint exactly.
    expect(fillFor({}, '#1ae51a').opacity).toBe(0.08)
  })

  it('an explicit fillOpacity still overrides, for either kind of fill', () => {
    expect(fillFor({ fillColor: '#60a5fa', fillOpacity: 0.5 }, '#111').opacity).toBe(0.5)
    expect(fillFor({ fillOpacity: 0.5 }, '#111').opacity).toBe(0.5)
  })

  it('respects an explicit 0 opacity — "no fill" is a real choice', () => {
    expect(fillFor({ fillOpacity: 0 }, '#fff').opacity).toBe(0)
  })

  it('clamps a nonsense opacity instead of handing canvas an invalid alpha', () => {
    expect(fillFor({ fillOpacity: 5 }, '#fff').opacity).toBe(1)
    expect(fillFor({ fillOpacity: -2 }, '#fff').opacity).toBe(0)
    expect(fillFor({ fillOpacity: NaN }, '#fff').opacity).toBe(0.08)
  })

  it('borderFor follows the line unless the drawing names its own', () => {
    expect(borderFor({}, '#c9a84c')).toBe('#c9a84c')
    expect(borderFor({ borderColor: '#ff5b5b' }, '#c9a84c')).toBe('#ff5b5b')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('priceFormatterFor — the series is the authority on precision', () => {
  const seriesWith = (format) => ({ priceFormatter: () => ({ format }) })

  it('⭐ USES THE SERIES\u2019 OWN FORMATTER, so a label matches the axis tag', () => {
    const fmt = priceFormatterFor(seriesWith((v) => `${v.toFixed(4)}`))
    expect(fmt(1.5)).toBe('1.5000')          // a 4dp instrument, not our 2dp guess
  })

  it('falls back to formatPrice when there is no series at all', () => {
    for (const s of [null, undefined, {}, { priceFormatter: null }]) {
      expect(priceFormatterFor(s)(412.5)).toBe('412.50')
      expect(priceFormatterFor(s)(0.004213)).toBe('0.0042')
    }
  })

  it('falls back when the series\u2019 formatter throws or returns nothing', () => {
    expect(priceFormatterFor(seriesWith(() => { throw new Error('nope') }))(5)).toBe('5.00')
    expect(priceFormatterFor(seriesWith(() => ''))(5)).toBe('5.00')
    expect(priceFormatterFor(seriesWith(() => null))(5)).toBe('5.00')
    expect(priceFormatterFor({ priceFormatter: () => { throw new Error('x') } })(5)).toBe('5.00')
  })

  it('never prints a number for a non-number', () => {
    const fmt = priceFormatterFor(seriesWith((v) => String(v)))
    for (const bad of [null, undefined, '', NaN, Infinity]) expect(fmt(bad)).toBe('')
  })

  it('works across the magnitudes a trader actually sees', () => {
    const f = priceFormatterFor(null)
    expect(f(5000)).toBe('5000.00')          // an index
    expect(f(412.5)).toBe('412.50')          // a large-cap
    expect(f(4.2)).toBe('4.20')              // a small-cap
    expect(f(0.0421)).toBe('0.0421')         // sub-dollar: more decimals, not fewer
    expect(f(0)).toBe('0.00')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('avoidOverlap — a placement rule, deliberately not a solver', () => {
  const box = (y, h = 17, x = 0, w = 40) => ({ x, y, w, h })

  it('leaves a box alone when nothing is in its way', () => {
    const b = box(100)
    expect(avoidOverlap(b, []).y).toBe(100)
    expect(avoidOverlap(b, [box(300)]).y).toBe(100)
    expect(avoidOverlap(b, [box(100, 17, 500)]).y).toBe(100)   // same row, far away
  })

  it('drops a colliding box CLEAR of the one it hit, not by a fixed step', () => {
    // A fixed "one row down" step assumes every label is the same height and on
    // the same grid — a `+10.00%` chip beside a `4,213.50` one is neither, and a
    // fixed step would leave them still touching. The move is measured off the
    // box it actually collided with.
    const b = box(100)
    avoidOverlap(b, [box(102)])
    expect(b.y).toBe(102 + 17 + 2)
    const tall = box(100)
    avoidOverlap(tall, [box(100, 40)])
    expect(tall.y).toBe(100 + 40 + 2)
  })

  it('steps UP when down is also taken', () => {
    const b = box(100)
    avoidOverlap(b, [box(100), box(119)])
    expect(b.y).toBe(100 - 19)
  })

  it('⛔ DRAWS ANYWAY WHEN IT IS TRULY CROWDED — a hidden price is worse', () => {
    const taken = [-2, -1, 0, 1, 2].map((k) => box(100 + k * 19))
    const b = box(100)
    avoidOverlap(b, taken)
    expect(b.y).toBe(100)          // gave up and kept its place
  })

  it('never steps outside the pane it was given', () => {
    const bounds = { x0: 0, y0: 0, x1: 800, y1: 120 }
    const b = box(100)
    avoidOverlap(b, [box(100)], { bounds })
    // Down would leave the pane (119 + 17 > 120), so it goes up instead.
    expect(b.y).toBe(81)
    expect(b.y).toBeGreaterThanOrEqual(bounds.y0)
    expect(b.y + b.h).toBeLessThanOrEqual(bounds.y1)
  })

  it('drawLabel reserves what it draws, so the NEXT label sees it', () => {
    const ctx = makeCtx()
    const avoid = []
    const a = drawLabel(ctx, { text: '100.00', x: 700, y: 200, align: 'right', baseline: 'middle', bg: '#c9a84c', avoid })
    const b = drawLabel(ctx, { text: '100.10', x: 700, y: 201, align: 'right', baseline: 'middle', bg: '#c9a84c', avoid })
    expect(avoid).toHaveLength(2)
    expect(Math.abs(b.y - a.y)).toBeGreaterThanOrEqual(a.h)
  })
})
