/**
 * V2-2 rails: the panel split (W2-1) and sticky colours (W2-5).
 *
 * ⛔ THE TABLE IS THE AUTHORITY. Both modules derive from `chartMetrics`, so these
 * tests ask the registry what a metric's unit and tone ARE rather than hard-coding the
 * expected answer — a fixture that restates the source cannot catch the source moving.
 */
import { describe, it, expect } from 'vitest'
import { ALL_METRICS, UNIT, unitOf, resolveColors } from '../chartMetrics'
import { panelsFor, gridFor, panelIndexByKey, PANEL_ORDER } from './panels'
import { stickyColour, stickyColours, collisionsWithin, STICKY_COLOURS } from './stickyColours'

/** Two real metrics from different unit families, found from the registry. */
function twoFamilies() {
  const byUnit = {}
  for (const m of ALL_METRICS) (byUnit[unitOf(m.key)] ??= []).push(m.key)
  const units = Object.keys(byUnit).filter(u => byUnit[u].length >= 2)
  expect(units.length, 'the registry must hold at least two populated families').toBeGreaterThan(1)
  return [byUnit[units[0]], byUnit[units[1]]]
}

describe('W2-1 · one panel per unit family (A-05)', () => {
  it('never puts two unit families in one panel', () => {
    const [famA, famB] = twoFamilies()
    const selected = [famA[0], famB[0], famA[1]]
    const panels = panelsFor(selected)
    for (const p of panels) {
      const units = new Set(p.keys.map(unitOf))
      expect(units.size, `panel ${p.unit} mixes ${[...units]}`).toBe(1)
    }
  })

  it('⛔ every selected metric lands in exactly one panel — none dropped, none doubled', () => {
    const selected = ALL_METRICS.slice(0, 12).map(m => m.key)
    const panels = panelsFor(selected)
    const placed = panels.flatMap(p => p.keys)
    expect([...placed].sort()).toEqual([...selected].sort())
    expect(new Set(placed).size).toBe(selected.length)
  })

  it('⛔ a metric whose unit is not in PANEL_ORDER still gets a panel', () => {
    // A projection drops what it does not name, and a dropped series looks FLAT, not
    // absent — so an unlisted unit must append rather than vanish.
    const unlisted = ALL_METRICS.map(m => m.key).find(k => !PANEL_ORDER.includes(unitOf(k)))
    if (!unlisted) return            // every unit is listed today; the guard still stands
    const panels = panelsFor([unlisted])
    expect(panels.flatMap(p => p.keys)).toContain(unlisted)
  })

  it('panel ORDER does not depend on the order the metrics were picked', () => {
    const [famA, famB] = twoFamilies()
    const sel = [famA[0], famB[0]]
    const a = panelsFor(sel).map(p => p.unit)
    const b = panelsFor([...sel].reverse()).map(p => p.unit)
    expect(b).toEqual(a)
  })

  it('an empty selection produces no panels and no grid', () => {
    expect(panelsFor([])).toEqual([])
    expect(gridFor([])).toEqual([])
    expect(panelsFor(undefined)).toEqual([])
  })

  it('panelIndexByKey returns -1 for an unknown key, never 0', () => {
    // Defaulting to 0 would draw a ratio on the percentage axis — the dual-axis bug
    // wearing a different hat.
    const panels = panelsFor([ALL_METRICS[0].key])
    expect(panelIndexByKey(panels).indexOf('not_a_metric')).toBe(-1)
    expect(panelIndexByKey(panels).indexOf(ALL_METRICS[0].key)).toBe(0)
  })
})

describe('gridFor · the stack', () => {
  it('panels do not overlap and stay inside the box', () => {
    const panels = panelsFor(ALL_METRICS.slice(0, 8).map(m => m.key))
    const rects = gridFor(panels)
    expect(rects.length).toBe(panels.length)
    const num = s => parseFloat(String(s))
    let prevBottom = 0
    for (const r of rects) {
      const top = num(r.top), h = num(r.height)
      expect(top, 'a panel starts above the one before it').toBeGreaterThanOrEqual(prevBottom)
      expect(h).toBeGreaterThan(0)
      prevBottom = top + h
    }
    expect(prevBottom, 'the stack overflows the chart box').toBeLessThanOrEqual(100)
  })

  it('⛔ there is a real GAP between panels — two families must not read as one plot', () => {
    const panels = panelsFor(twoFamilies().map(f => f[0]))
    expect(panels.length).toBe(2)
    const [a, b] = gridFor(panels, { gap: 4 })
    const gap = parseFloat(b.top) - (parseFloat(a.top) + parseFloat(a.height))
    expect(gap).toBeCloseTo(4, 1)
  })

  it('a single panel still leaves room for the axis and the zoom', () => {
    const [r] = gridFor(panelsFor([ALL_METRICS[0].key]))
    expect(parseFloat(r.top)).toBeGreaterThan(0)
    expect(parseFloat(r.top) + parseFloat(r.height)).toBeLessThan(100)
  })
})

describe('W2-5 · sticky colours (dataviz: colour follows the entity, never its rank)', () => {
  it('⛔⛔ THE SHUFFLE RAIL — reordering the selection repaints nothing', () => {
    const sel = ALL_METRICS.slice(0, 6).map(m => m.key)
    const straight = stickyColours(sel)
    const reversed = stickyColours([...sel].reverse())
    for (const k of sel) expect(reversed[k], `${k} moved on reorder`).toBe(straight[k])
  })

  it('⛔⛔ DESELECTING ONE METRIC REPAINTS NO SURVIVOR', () => {
    // This is the measured V1 defect, stated as a test: on 2026-09-17
    // `resolveColors` moved pct_above_50sma from #f59e0b to #60a5fa when the metric
    // BEFORE it was deselected.
    const sel = ALL_METRICS.slice(0, 6).map(m => m.key)
    const before = stickyColours(sel)
    const after = stickyColours(sel.slice(1))
    for (const k of sel.slice(1)) expect(after[k], `${k} was repainted`).toBe(before[k])
  })

  it('⭐ CONTROL — V1 really does repaint, so the two rails above are not vacuous', () => {
    // If `resolveColors` were already entity-stable, the tests above would pass for the
    // wrong reason and V2-2 would be fixing nothing.
    const sel = ALL_METRICS.slice(0, 6).map(m => m.key)
    const v1Before = resolveColors(sel)
    const v1After = resolveColors(sel.slice(1))
    const moved = sel.slice(1).filter(k => v1Before[k] !== v1After[k])
    expect(moved.length,
      'V1 no longer repaints on deselect — re-check whether this module is still needed')
      .toBeGreaterThan(0)
  })

  it('the colour of a metric does not depend on a selection at all', () => {
    const k = ALL_METRICS[3].key
    expect(stickyColour(k)).toBe(stickyColours([k])[k])
    expect(stickyColour(k)).toBe(stickyColours(ALL_METRICS.map(m => m.key))[k])
  })

  it('every registry metric has a colour, and the map is frozen', () => {
    for (const m of ALL_METRICS) expect(stickyColour(m.key), m.key).toMatch(/^#[0-9a-f]{6}$/i)
    expect(Object.isFrozen(STICKY_COLOURS)).toBe(true)
  })

  it('an unknown key gets a colour rather than undefined', () => {
    // A missing colour renders as ECharts' own palette, which is off-brand AND
    // rank-dependent — the defect back through the side door.
    expect(stickyColour('not_a_metric')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('collisions are REPORTED for a selection, and are stable', () => {
    const sel = ALL_METRICS.map(m => m.key)
    const a = collisionsWithin(sel)
    const b = collisionsWithin([...sel].reverse())
    // Same pairs either way round — a stable collision is visible; a moving one is not.
    const norm = c => c.map(x => [...x.keys].sort().join(',')).sort()
    expect(norm(b)).toEqual(norm(a))
    expect(collisionsWithin([sel[0]])).toEqual([])
  })
})
