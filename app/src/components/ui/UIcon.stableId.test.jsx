import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import UIcon from './UIcon'

// Wave 10 lane 10A (clause 4d, typing cost): a gold icon keeps ONE gradient id for its life.
//
// The id was numbered per RENDER, so every re-render of every gold icon wrote a new `id` on its
// gradient and a new `stroke="url(#…)"` on its <svg>: an attribute write, a style recalc and an
// SVG resource invalidation per icon per render. The Notebook page re-renders on every
// keystroke; in a traced keystroke at 2,000 paragraphs ~12.6 icons per key paid it
// (docs/notebook/perf-budgets.md §7). Asserted on the rendered DOM.

const strokeOf = (c) => c.querySelector('svg').getAttribute('stroke')
const gradientIdOf = (c) => c.querySelector('linearGradient')?.getAttribute('id')

describe('UIcon — the gold gradient id is stable across re-renders', () => {
  it('a re-render keeps the same id and the same stroke reference', () => {
    const { container, rerender } = render(<UIcon name="link" size={14} />)
    const id = gradientIdOf(container)
    expect(id).toMatch(/^uig\d+$/)                      // the shape the golden-file normalisers expect
    expect(strokeOf(container)).toBe(`url(#${id})`)
    rerender(<UIcon name="link" size={16} />)           // a real re-render: the size DID change ...
    expect(container.querySelector('svg').getAttribute('width')).toBe('16')
    expect(gradientIdOf(container)).toBe(id)             // ... and the id did not
    expect(strokeOf(container)).toBe(`url(#${id})`)
  })

  it('two icons on one page still get two different ids', () => {
    const { container } = render(<div><UIcon name="link" /><UIcon name="document" /></div>)
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.getAttribute('id'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('a non-gold icon has no gradient and strokes currentColor', () => {
    const { container } = render(<UIcon name="link" gold={false} />)
    expect(container.querySelector('linearGradient')).toBeNull()
    expect(strokeOf(container)).toBe('currentColor')
  })
})
