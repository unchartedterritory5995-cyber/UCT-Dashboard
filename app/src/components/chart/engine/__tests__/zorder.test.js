// app/src/components/chart/engine/__tests__/zorder.test.js
//
// ─── R0.5 — THE Z-ORDER MAP, DERIVED FROM THE CAPABILITY MAP ─────────────────
//
// ⭐ THE NINE BUCKETS ARE PARSED OUT OF `docs/pine/lwc5-capability-map.md`, which
// quotes Pine's own Visuals / Overview. Retyping an ordered list of nine things
// beside the document that owns it is the defect this repo keeps paying for, and
// an ORDERING is the worst case of it: a transposed pair produces a chart that is
// wrong in a way no test of any individual primitive can see.
//
// The behaviour claims are railed as sentences too — the "plot can never appear
// on top of a table" rule and the attach-order guarantee are the two premises the
// whole module rests on.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  PINE_BUCKETS,
  BUCKET_SOURCES,
  LWC_ASSIGNMENT,
  ATTACH_SEQUENCE,
  KNOWN_LOSSES,
  bucketOf,
  rankOf,
  paintOrder,
  placementFor,
  validate,
} from '../zorder'

const SRC = path.resolve(__dirname, '../../../..')
const REPO = path.resolve(SRC, '../..')
const MAP = path.join(REPO, 'docs/pine/lwc5-capability-map.md')
const MODULE = path.join(SRC, 'components/chart/engine/zorder.js')
// ⚠️ NORMALISE LINE ENDINGS BEFORE MATCHING ANYTHING. Git checks this file out
// CRLF on Windows, so every regex spanning a line break silently fails here while
// passing wherever the checkout is LF — a test that is green on one machine and
// red on another for reasons having nothing to do with the code.
const doc = fs.readFileSync(MAP, 'utf8').replace(/\r\n/g, '\n')

/** §3.1 states the nine buckets as one interpunct-separated ascending list,
 *  wrapped across two lines:
 *  "1 Background colors · 2 Fills · … · 7 Boxes ·\n8 Labels · 9 **Tables**." */
function bucketsFromDoc() {
  const m = /1 Background colors ·[\s\S]*?9 \*\*Tables\*\*\./.exec(doc)
  if (!m) return []
  const out = []
  const rx = /(\d)\s+\*{0,2}([A-Za-z][A-Za-z ]*?)\*{0,2}\s*(?:·|\.)/g
  let g
  while ((g = rx.exec(m[0]))) {
    const n = Number(g[1])
    const name = g[2].trim().toLowerCase()
    if (n >= 1 && n <= 9 && name) out[n - 1] = name
  }
  return out.filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the bucket order is derived from the capability map, not typed here', () => {
  it('the doc still states all nine buckets in order', () => {
    // ⭐ THE NON-VACUITY CONTROL. A regex that silently matched nothing would
    // make the comparison below `[] vs []`-ish and pass for the wrong reason.
    const parsed = bucketsFromDoc()
    expect(parsed).toHaveLength(9)
    expect(parsed[0]).toBe('background colors')
    expect(parsed[8]).toBe('tables')
  })

  it('the module carries the doc\'s nine buckets, in the doc\'s order', () => {
    expect(PINE_BUCKETS).toEqual(bucketsFromDoc())
  })

  it('nine buckets collapse onto exactly six physical positions', () => {
    const physical = new Set(PINE_BUCKETS.map((b) => LWC_ASSIGNMENT[b].physical))
    expect(physical.size).toBe(6)
    expect(doc).toMatch(/Nine buckets land on \*\*six distinct physical positions\*\*/)
  })

  it('the two premises the module rests on are still in the doc', () => {
    // Pine's non-negotiable rule.
    expect(doc).toMatch(/a plot can never appear on top of a table/)
    // The attach-order guarantee that separates buckets 5-8.
    expect(doc).toMatch(/draw order within one zOrder layer is attach\norder/)
    // The trap that makes tables structural rather than conventional.
    expect(doc).toMatch(/all pane primitives are drawn before all series sources/)
  })

  it('every bucket has an assignment and at least one Pine construct', () => {
    for (const b of PINE_BUCKETS) {
      expect(LWC_ASSIGNMENT[b], `assignment for ${b}`).toBeTruthy()
      expect(BUCKET_SOURCES[b] && BUCKET_SOURCES[b].length, `sources for ${b}`).toBeGreaterThan(0)
    }
    expect(Object.keys(LWC_ASSIGNMENT).sort()).toEqual([...PINE_BUCKETS].sort())
  })

  it('the module names its provenance', () => {
    expect(fs.readFileSync(MODULE, 'utf8')).toContain('lwc5-capability-map.md')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the attach sequence', () => {
  it('is exactly the four layers separated by attach order alone', () => {
    const byAttach = PINE_BUCKETS
      .filter((b) => LWC_ASSIGNMENT[b].attachSeq !== null)
      .sort((a, b) => LWC_ASSIGNMENT[a].attachSeq - LWC_ASSIGNMENT[b].attachSeq)
    expect(byAttach).toEqual([...ATTACH_SEQUENCE])
  })

  it('runs low bucket to high bucket, because attach order IS paint order', () => {
    // ⛔ Reversed, this silently inverts linefills/lines/boxes/labels — four
    // documented Pine orderings, with nothing on screen to say which is wrong.
    const ranks = ATTACH_SEQUENCE.map(rankOf)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('every attach-ordered layer shares one slot and one subpass', () => {
    // If they did not, attach order would not be what separates them and the
    // sequence above would be decoration.
    const slots = new Set(ATTACH_SEQUENCE.map((b) => `${LWC_ASSIGNMENT[b].slot}/${LWC_ASSIGNMENT[b].subpass}`))
    expect([...slots]).toEqual(['normal/draw'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('paintOrder', () => {
  const el = (bucket, seq) => ({ bucket, seq })

  it('paints Pine\'s buckets low to high whatever order they arrive in', () => {
    const shuffled = [el('tables'), el('plots'), el('background colors'), el('labels'), el('fills')]
    expect(paintOrder(shuffled).map((e) => e.bucket))
      .toEqual(['background colors', 'fills', 'plots', 'labels', 'tables'])
  })

  it('⛔ a plot can never paint above a table', () => {
    // The one ordering Pine calls out by name.
    const out = paintOrder([el('tables', 1), el('plots', 99)]).map((e) => e.bucket)
    expect(out.indexOf('plots')).toBeLessThan(out.indexOf('tables'))
  })

  it('within a bucket, the element created last paints on top', () => {
    const out = paintOrder([el('lines', 3), el('lines', 1), el('lines', 2)])
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('is stable when creation order is not given', () => {
    // ⛔ THE ELEMENTS MUST BE DISTINGUISHABLE. Three `el('boxes')` objects are
    // structurally identical, so `toEqual` cannot tell a reversed array from an
    // unchanged one and the assertion passes for a sort that shuffles freely —
    // a mutation flipping the tiebreak to `b.i - a.i` left this green. Tag them.
    const a = { ...el('boxes'), id: 'a' }
    const b = { ...el('boxes'), id: 'b' }
    const c = { ...el('boxes'), id: 'c' }
    expect(paintOrder([a, b, c]).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('a stable tiebreak survives across bucket boundaries too', () => {
    // Same trap, one level up: equal-rank elements from different buckets must
    // not be reordered relative to each other either.
    const els = [
      { bucket: 'lines', id: 'first' },
      { bucket: 'lines', id: 'second' },
      { bucket: 'fills', id: 'below' },
    ]
    expect(paintOrder(els).map((e) => e.id)).toEqual(['below', 'first', 'second'])
  })

  it('a fill paints below the plots and a linefill above them', () => {
    // The correction the capability map makes to the generic advice: only fill()
    // belongs in drawBackground. A linefill there would sink below every plot.
    const out = paintOrder([el('linefills'), el('plots'), el('fills')]).map((e) => e.bucket)
    expect(out).toEqual(['fills', 'plots', 'linefills'])
  })

  it('explicit_plot_zorder collapses fills, plots and hlines into call order', () => {
    const els = [el('horizontal levels', 1), el('plots', 2), el('fills', 3)]
    const normal = paintOrder(els).map((e) => e.bucket)
    expect(normal).toEqual(['fills', 'plots', 'horizontal levels'])

    const explicit = paintOrder(els, { explicitPlotZorder: true }).map((e) => e.bucket)
    expect(explicit).toEqual(['horizontal levels', 'plots', 'fills'])
  })

  it('explicit_plot_zorder leaves everything outside that trio alone', () => {
    const out = paintOrder(
      [el('tables', 1), el('plots', 2), el('background colors', 3), el('labels', 4)],
      { explicitPlotZorder: true },
    ).map((e) => e.bucket)
    expect(out).toEqual(['background colors', 'plots', 'labels', 'tables'])
  })

  it('names an unknown bucket instead of dropping the element', () => {
    expect(() => paintOrder([{ bucket: 'shadows' }])).toThrow(/shadows/)
  })

  it('handles nothing to paint', () => {
    expect(paintOrder([])).toEqual([])
    expect(paintOrder(undefined)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('bucketOf', () => {
  it('maps the Pine constructs to their buckets', () => {
    expect(bucketOf('bgcolor')).toBe('background colors')
    expect(bucketOf('fill')).toBe('fills')
    expect(bucketOf('plot')).toBe('plots')
    expect(bucketOf('plotshape')).toBe('plots')
    expect(bucketOf('hline')).toBe('horizontal levels')
    expect(bucketOf('box.new')).toBe('boxes')
    expect(bucketOf('table.cell')).toBe('tables')
  })

  it('puts the whole plot family in the plots bucket', () => {
    // plotshape/plotchar/plotcandle are plots for z-order purposes even though
    // they render through different mechanisms.
    for (const s of BUCKET_SOURCES.plots) expect(bucketOf(s)).toBe('plots')
  })

  it('names a construct it does not know', () => {
    expect(() => bucketOf('polyline.new')).toThrow(/polyline\.new/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('placementFor — and what it refuses', () => {
  it('gives each bucket its slot and subpass', () => {
    expect(placementFor('background colors')).toMatchObject({ slot: 'bottom', subpass: 'drawBackground' })
    expect(placementFor('fills')).toMatchObject({ slot: 'normal', subpass: 'drawBackground' })
    expect(placementFor('linefills')).toMatchObject({ slot: 'normal', subpass: 'draw' })
    expect(placementFor('boxes')).toMatchObject({ slot: 'normal', subpass: 'draw' })
    expect(placementFor('tables')).toMatchObject({ slot: 'dom' })
  })

  it('⛔ only fill() goes in drawBackground; linefills and boxes do not', () => {
    // The capability map's explicit correction to the generic advice.
    expect(placementFor('fills').subpass).toBe('drawBackground')
    expect(placementFor('linefills').subpass).toBe('draw')
    expect(placementFor('boxes').subpass).toBe('draw')
    expect(doc).toMatch(/Linefills go in `draw\(\)`/)
  })

  it('refuses to lower an hline under explicit_plot_zorder, by name', () => {
    const off = placementFor('horizontal levels')
    expect(off.refusals).toEqual([])
    const on = placementFor('horizontal levels', { explicitPlotZorder: true })
    expect(on.refusals.join(' ')).toMatch(/pine:explicit-zorder-hline/)
    expect(on.refusals.join(' ')).toMatch(/createPriceLine/)
  })

  it('flags behind_chart as depending on unverified series-order semantics', () => {
    const on = placementFor('plots', { behindChart: true })
    expect(on.refusals.join(' ')).toMatch(/pine:behind-chart/)
    expect(on.refusals.join(' ')).toMatch(/UNVERIFIED/)
    // behind_chart defaults to TRUE, so the default call must carry it.
    expect(placementFor('plots').refusals.length).toBe(1)
    expect(placementFor('plots', { behindChart: false }).refusals).toEqual([])
  })

  it('records the losses the capability map names, under its own ids', () => {
    for (const id of Object.keys(KNOWN_LOSSES)) {
      expect(doc, `loss ${id} should still be in the map`).toMatch(new RegExp(`\\*\\*${id}\\*\\*`))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('validate', () => {
  const correct = Object.fromEntries(
    PINE_BUCKETS.map((b) => [b, { slot: LWC_ASSIGNMENT[b].slot, subpass: LWC_ASSIGNMENT[b].subpass }]),
  )

  it('accepts the assignment this module specifies', () => {
    expect(validate(correct)).toEqual({ ok: true, violations: [] })
  })

  it('⛔ catches a table demoted out of the top slot', () => {
    // L5: a pane primitive at 'normal' always paints beneath every series
    // primitive, so a table at 'normal' inverts Pine's named rule.
    const bad = { ...correct, tables: { slot: 'normal', subpass: 'draw' } }
    const r = validate(bad)
    expect(r.ok).toBe(false)
    expect(r.violations.join(' ')).toMatch(/tables: slot 'normal' should be 'dom'/)
  })

  it('⛔ catches a linefill sunk into drawBackground', () => {
    const bad = { ...correct, linefills: { slot: 'normal', subpass: 'drawBackground' } }
    const r = validate(bad)
    expect(r.ok).toBe(false)
    expect(r.violations.join(' ')).toMatch(/linefills: subpass 'drawBackground' should be 'draw'/)
  })

  it('names an unknown bucket rather than ignoring it', () => {
    expect(validate({ glow: { slot: 'top', subpass: 'draw' } }).violations.join(' ')).toMatch(/unknown bucket: glow/)
  })

  it('accepts a partial placement — a script need not use every bucket', () => {
    expect(validate({ plots: correct.plots, labels: correct.labels }).ok).toBe(true)
  })
})
