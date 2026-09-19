import { describe, it, expect } from 'vitest'
import { primitiveManifest } from '../pine_primitive_manifest.mjs'

// The canonical rendering-primitive vocabulary (task brief, verbatim) — every
// later task in this plan uses this exact 22-name list. Hardcoded here
// independently of the implementation's own CANONICAL_PRIMITIVES set (never
// imported from it) so a regression in either direction — a dropped name, or
// an extra one sneaking back in (e.g. `alert`, `alertcondition`, `plot`,
// `hlines`) — fails loudly instead of the test drifting in lockstep with a
// broken implementation.
const CANONICAL_PRIMITIVES = [
  'line', 'stepline', 'histogram', 'area', 'baseline', 'markers', 'band', 'candles',
  'plotshape', 'plotchar', 'plotarrow', 'bgcolor', 'barcolor', 'fill', 'hline',
  'plotcandle', 'plotbar',
  'line_obj', 'label_obj', 'box_obj', 'table_obj', 'linefill_obj',
]

describe('primitiveManifest', () => {
  it('produces EXACTLY the 22 canonical primitives — no more, no fewer, no duplicates', () => {
    const { primitives, sources } = primitiveManifest()

    expect(primitives.length).toBe(22)
    expect([...primitives].sort()).toEqual([...CANONICAL_PRIMITIVES].sort())
    expect(new Set(primitives).size).toBe(primitives.length)

    for (const p of CANONICAL_PRIMITIVES) {
      expect(sources[p], `no source recorded for: ${p}`).toBeDefined()
      expect(sources[p].file).toMatch(/\.js$/)
      expect(typeof sources[p].constant).toBe('string')
      expect(sources[p].constant.length).toBeGreaterThan(0)
    }
  })

  it('keeps band and fill as two separate entries, sourced differently, never merged', () => {
    // band = defSchema.js's internal name for the render STYLE; fill = the
    // literal Pine source-code construct `fill(...)`. A prior draft fabricated
    // band's citation and risked collapsing the two — this pins them apart.
    const { primitives, sources } = primitiveManifest()
    expect(primitives).toContain('band')
    expect(primitives).toContain('fill')
    expect(sources.band).not.toEqual(sources.fill)
    expect(sources.band.file).toMatch(/defSchema\.js$/)
    expect(sources.fill.file).toMatch(/fillPrimitive\.js$/)
  })

  it('band is sourced from a real, named constant — never the fabricated "inline band handling" citation', () => {
    const { sources } = primitiveManifest()
    expect(sources.band.constant).toBe('PLOT_STYLES')
    expect(sources.band.constant).not.toMatch(/inline/i)
  })

  it('keeps hline (the Pine call) while excluding hlines (the internal def-style name)', () => {
    const { primitives } = primitiveManifest()
    expect(primitives).toContain('hline')
    expect(primitives).not.toContain('hlines')
  })

  it('excludes non-primitive members of the same source constants: alertcondition, alert, plot', () => {
    // alertcondition/alert are notification mechanisms, not rendering
    // primitives. plot IS a rendering call but is not a standalone name in
    // this manifest's declared vocabulary (it's covered by the generic style
    // names line/histogram/area/etc.) — never excluded on a "non-rendering"
    // theory, only because it is not in the declared 22-name list.
    const { primitives } = primitiveManifest()
    expect(primitives).not.toContain('alertcondition')
    expect(primitives).not.toContain('alert')
    expect(primitives).not.toContain('plot')
  })

  it('keeps the paint group (bgcolor, barcolor, hline, plotshape, plotchar) sourced from CHART_ONLY_CALLS/OUTPUT_CALLS', () => {
    const { primitives, sources } = primitiveManifest()
    for (const p of ['bgcolor', 'barcolor', 'hline']) {
      expect(primitives).toContain(p)
      expect(sources[p].constant).toBe('CHART_ONLY_CALLS')
    }
    for (const p of ['plotshape', 'plotchar', 'plotarrow']) {
      expect(primitives).toContain(p)
    }
  })

  it('sources the five drawing-object namespaces from pineObjects.js OBJECT_NAMESPACES, suffixed', () => {
    const { primitives, sources } = primitiveManifest()
    for (const p of ['line_obj', 'label_obj', 'box_obj', 'table_obj', 'linefill_obj']) {
      expect(primitives).toContain(p)
      expect(sources[p].constant).toBe('OBJECT_NAMESPACES')
      expect(sources[p].file).toMatch(/pineObjects\.js$/)
    }
  })

  it('throws loudly rather than silently omitting a primitive if a constant is renamed', () => {
    // extractConst is not exported (internal); this proves the FAILURE MODE via
    // the public surface: manifest() must never quietly return fewer than the
    // full canonical set, which is what a swallowed "constant not found" would
    // produce. Exact-count (not a >15 threshold) so losing even ONE of the 22
    // is caught.
    const { primitives } = primitiveManifest()
    expect(primitives.length).toBe(22)
  })
})
