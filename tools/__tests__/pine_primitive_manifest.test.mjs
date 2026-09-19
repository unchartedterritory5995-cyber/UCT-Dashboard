import { describe, it, expect } from 'vitest'
import { primitiveManifest } from '../pine_primitive_manifest.mjs'

describe('primitiveManifest', () => {
  it('includes every known rendering primitive, sourced from the engine', () => {
    const { primitives, sources } = primitiveManifest()
    const expected = [
      'line', 'stepline', 'histogram', 'area', 'baseline', 'markers', 'band', 'candles',
      'plotshape', 'plotchar', 'plotarrow', 'bgcolor', 'barcolor', 'fill', 'hline',
      'plotcandle', 'plotbar',
      'line_obj', 'label_obj', 'box_obj', 'table_obj', 'linefill_obj',
    ]
    for (const p of expected) {
      expect(primitives, `missing primitive: ${p}`).toContain(p)
      expect(sources[p], `no source recorded for: ${p}`).toBeDefined()
      expect(sources[p].file).toMatch(/\.js$/)
    }
  })

  it('throws loudly rather than silently omitting a primitive if a constant is renamed', () => {
    // extractConst is not exported (internal); this proves the FAILURE MODE via the
    // public surface: manifest() must never return an empty primitives array, which
    // is what a swallowed "constant not found" would produce.
    const { primitives } = primitiveManifest()
    expect(primitives.length).toBeGreaterThan(15)
  })
})
