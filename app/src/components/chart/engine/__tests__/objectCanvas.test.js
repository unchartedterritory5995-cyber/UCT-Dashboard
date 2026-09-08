// app/src/components/chart/engine/__tests__/objectCanvas.test.js
//
// ─── C3B — THE PAINTER, TESTED BECAUSE IT IS PURE ──────────────────────────
//
// ⛔ THE POINT OF EXTRACTING THIS FROM A REACT COMPONENT: a painter inside a
// `useEffect` is the one layer nobody can assert on, and it is exactly where a
// drawing goes wrong quietly — an off-screen line clamped to the edge, an
// extended trend line flattened to horizontal, a fill drawn with one edge. Each
// of those has a case here, and each fails LOUDLY under the wrong implementation.
import { describe, it, expect } from 'vitest'
import { paintObjects, layoutTables, TABLE_ANCHORS } from '../objectCanvas'

/** A recording 2D context: every call, in order, with its arguments. */
function recorder() {
  const calls = []
  const rec = (name) => (...args) => calls.push([name, ...args])
  const ctx = {
    calls,
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    fillText: rec('fillText'),
    setLineDash: rec('setLineDash'),
    measureText: (s) => ({ width: s.length * 6 }),
  }
  return ctx
}

/** Bars at x = t, prices at y = 500 - p. A deliberately trivial mapping so the
 *  assertions are about the PAINTER, not about arithmetic. */
const mapping = (over = {}) => ({
  timeToX: (t) => t,
  priceToY: (p) => 500 - p,
  width: 1000,
  height: 500,
  ...over,
})

const of = (calls, name) => calls.filter((c) => c[0] === name)

describe('C3B — painting lines', () => {
  it('⭐ a plain line is one moveTo/lineTo at its own coordinates', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, { lines: [{ id: 1, x1: 10, y1: 100, x2: 40, y2: 200, color: '#f00', width: 2, style: 'solid' }] }, mapping())
    expect(r.drawn.line).toBe(1)
    expect(of(ctx.calls, 'moveTo')[0]).toEqual(['moveTo', 10, 400])
    expect(of(ctx.calls, 'lineTo')[0]).toEqual(['lineTo', 40, 300])
    expect(ctx.lineWidth).toBe(2)
  })

  it('⭐⭐ EXTENDING A LINE KEEPS ITS SLOPE — a trend line does not become horizontal', () => {
    // rise 100 over run 30 → at x=1000 it must be far above, not level with y2.
    const ctx = recorder()
    paintObjects(ctx, { lines: [{ id: 1, x1: 10, y1: 100, x2: 40, y2: 200, color: '#f00', width: 1, style: 'solid', extend: 'right' }] }, mapping())
    const to = of(ctx.calls, 'lineTo')[0]
    expect(to[1]).toBe(1000)
    // slope in pixels is (300-400)/(40-10) = -10/3 per px; at x=1000 → 300 - 3200
    expect(to[2]).toBeCloseTo(300 + ((1000 - 40) * (300 - 400)) / (40 - 10), 6)
    expect(to[2]).not.toBe(300)
  })

  it('⛔⛔ A LINE WHOSE COORDINATE THE CHART CANNOT PLACE IS SKIPPED, never clamped', () => {
    // Clamping would pile every off-screen object onto one edge and read as a
    // cluster the author never drew.
    const ctx = recorder()
    const r = paintObjects(ctx, {
      lines: [
        { id: 1, x1: 10, y1: 100, x2: 40, y2: 200, color: '#f00', width: 1, style: 'solid' },
        { id: 2, x1: 99, y1: 100, x2: 40, y2: 200, color: '#f00', width: 1, style: 'solid' },
      ],
    }, mapping({ timeToX: (t) => (t === 99 ? null : t) }))
    expect(r.drawn.line).toBe(1)
    expect(r.skipped.line).toBe(1)
    expect(of(ctx.calls, 'moveTo')).toHaveLength(1)
  })

  it('⭐ the line style becomes a real dash pattern', () => {
    const ctx = recorder()
    paintObjects(ctx, { lines: [{ id: 1, x1: 1, y1: 1, x2: 2, y2: 2, color: '#fff', width: 1, style: 'dotted' }] }, mapping())
    expect(of(ctx.calls, 'setLineDash')[0][1]).toEqual([2, 3])
  })
})

describe('C3B — painting boxes', () => {
  it('⭐ a box is a filled rect plus a stroked border', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, {
      boxes: [{ id: 1, left: 10, right: 50, top: 200, bottom: 100, bgcolor: '#0f08', border_color: '#0f0', border_width: 2, border_style: 'solid' }],
    }, mapping())
    expect(r.drawn.box).toBe(1)
    expect(of(ctx.calls, 'fillRect')[0]).toEqual(['fillRect', 10, 300, 40, 100])
    expect(of(ctx.calls, 'strokeRect')).toHaveLength(1)
  })

  it('⭐ a zero-width border is not stroked at all', () => {
    const ctx = recorder()
    paintObjects(ctx, {
      boxes: [{ id: 1, left: 10, right: 50, top: 200, bottom: 100, bgcolor: '#0f08', border_width: 0 }],
    }, mapping())
    expect(of(ctx.calls, 'strokeRect')).toHaveLength(0)
  })

  it('⭐ `extend = right` runs the box to the pane edge', () => {
    const ctx = recorder()
    paintObjects(ctx, {
      boxes: [{ id: 1, left: 10, right: 50, top: 200, bottom: 100, bgcolor: '#0f08', border_width: 0, extend: 'right' }],
    }, mapping())
    const [, x, , w] = of(ctx.calls, 'fillRect')[0]
    expect(x).toBe(10)
    expect(w).toBe(990)
  })
})

describe('C3B — painting labels', () => {
  it('⭐ a price-anchored label draws a body and its text', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, {
      labels: [{ id: 1, x: 20, y: 300, yloc: 'price', text: 'BRK', style: 'label_down', color: '#0f0', textcolor: '#fff', size: 'small', textalign: 'center' }],
    }, mapping())
    expect(r.drawn.label).toBe(1)
    expect(of(ctx.calls, 'fillRect')).toHaveLength(1)
    expect(of(ctx.calls, 'fillText')[0][1]).toBe('BRK')
  })

  it('⭐⭐ a BAR-anchored label carries no price and is placed by its anchor, not at zero', () => {
    const ctx = recorder()
    paintObjects(ctx, {
      labels: [{ id: 1, x: 20, y: null, yloc: 'abovebar', text: 'U', style: 'label_down', color: '#0f0', textcolor: '#fff', size: 'small' }],
    }, mapping())
    const rect = of(ctx.calls, 'fillRect')[0]
    // 12% down the pane for an above-bar anchor — near the top, and NOT y=500
    expect(rect[2]).toBeLessThan(120)
    expect(rect[2]).toBeGreaterThan(0)
  })

  it('⛔ an unknown label style draws a plain box rather than guessing a direction', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, {
      labels: [{ id: 1, x: 20, y: 300, yloc: 'price', text: 'x', style: 'not_a_pine_style', color: '#0f0', textcolor: '#fff', size: 'normal' }],
    }, mapping())
    expect(r.drawn.label).toBe(1)
  })
})

describe('C3B — fills', () => {
  it('⭐ a fill between two lines is the quadrilateral they bound', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, {
      lines: [
        { id: 1, x1: 10, y1: 100, x2: 40, y2: 100, color: '#fff', width: 1, style: 'solid' },
        { id: 2, x1: 10, y1: 200, x2: 40, y2: 200, color: '#fff', width: 1, style: 'solid' },
      ],
      fills: [{ id: 3, a: 1, b: 2, color: '#00f4' }],
    }, mapping())
    expect(r.drawn.linefill).toBe(1)
    expect(of(ctx.calls, 'lineTo').length).toBeGreaterThanOrEqual(3)
    expect(of(ctx.calls, 'fill')).toHaveLength(1)
  })

  it('⛔ a fill whose line was SKIPPED is skipped too — never half-drawn', () => {
    const ctx = recorder()
    const r = paintObjects(ctx, {
      lines: [{ id: 1, x1: 10, y1: 100, x2: 40, y2: 100, color: '#fff', width: 1, style: 'solid' }],
      fills: [{ id: 3, a: 1, b: 2, color: '#00f4' }],
    }, mapping())
    expect(r.drawn.linefill).toBe(0)
    expect(r.skipped.linefill).toBe(1)
  })
})

describe('C3B — tables stay viewport-anchored', () => {
  it('⭐⭐ a table is laid out as a GRID with a pane-fraction anchor, not a price', () => {
    const grid = layoutTables({
      tables: [{
        id: 1,
        position: 'bottom_left',
        cells: [
          { col: 0, row: 0, text: 'A' },
          { col: 1, row: 0, text: 'B' },
          { col: 0, row: 1, text: 'C' },
        ],
      }],
    })
    expect(grid).toHaveLength(1)
    expect(grid[0].anchor).toEqual(TABLE_ANCHORS.bottom_left)
    expect(grid[0].cols).toBe(2)
    expect(grid[0].rows).toBe(2)
    expect(grid[0].grid[0].map((c) => c && c.text)).toEqual(['A', 'B'])
    expect(grid[0].grid[1].map((c) => c && c.text)).toEqual(['C', null])
    // ⛔ no price, no time, anywhere in the result
    expect(JSON.stringify(grid)).not.toContain('"x"')
  })

  it('⭐ an unknown position falls back to top_right rather than to 0,0', () => {
    const grid = layoutTables({ tables: [{ id: 1, position: 'nowhere', cells: [] }] })
    expect(grid[0].anchor).toEqual(TABLE_ANCHORS.top_right)
  })
})
