// Wave 8 consolidation (C2): ONE drawing of the nine views, at the builder's size and at the My tools row size (the
// old myTools/ViewThumb). Pins what each size drew before the two copies were merged, so the merge changed nothing.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ViewGlyph } from './ViewGlyph'
import { VIEW_LABELS } from '../builderCatalog'

const svgOf = (view, size) => render(<ViewGlyph view={view} size={size} />).container.querySelector('svg')

describe('ViewGlyph', () => {
  it('draws every view at both sizes, decorative, on the same 40x28 grid', () => {
    for (const [view] of VIEW_LABELS) {
      for (const [size, w, h] of [['section', '40', '28'], ['row', '32', '22']]) {
        const svg = svgOf(view, size)
        expect(svg, `${view} ${size}`).not.toBeNull()
        expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual([w, h])
        expect(svg.getAttribute('viewBox')).toBe('0 0 40 28')
        expect(svg.getAttribute('aria-hidden')).toBe('true')
      }
    }
    expect(svgOf('number').getAttribute('width')).toBe('40')                    // the builder's size is the default
  })

  it('the row size keeps its heavier strokes and dots (what ViewThumb drew)', () => {
    expect(svgOf('table', 'row').getAttribute('stroke-width')).toBe('1.8')
    expect(svgOf('table', 'section').getAttribute('stroke-width')).toBe('1.6')
    expect(svgOf('line', 'row').getAttribute('stroke-width')).toBe('2.2')
    expect(svgOf('line', 'section').getAttribute('stroke-width')).toBe('2')
    const dots = (size) => [...svgOf('scatter', size).querySelectorAll('circle')].map((c) => c.getAttribute('r'))
    expect(dots('row')).toEqual(['2.4', '2.4', '2.4', '2.4', '2.4'])
    expect(dots('section')).toEqual(['2.2', '2.2', '2.2', '2.2', '2.2'])
  })

  it('a view it does not know: an empty frame in a row (a row always has a thumbnail), nothing in the builder', () => {
    const row = svgOf('future_view', 'row')
    expect(row.querySelectorAll('rect')).toHaveLength(1)
    expect(row.getAttribute('stroke-width')).toBe('1.8')
    expect(svgOf(null, 'row')).not.toBeNull()
    expect(svgOf('future_view', 'section')).toBeNull()
  })
})
