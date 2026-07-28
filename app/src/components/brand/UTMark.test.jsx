import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import UTMark from './UTMark'

/* These lock the mark's IDENTITY, not its pixels. The whole reason this
   component exists is that a header, a favicon and a Playwright social card all
   have to show the SAME logo — so what is worth asserting is that it still has
   the parts the logo is made of, in the colours it is made of. */

const paths = (c) => [...c.querySelectorAll('path')]

describe('UTMark', () => {
  it('draws the whole mark: four ring arcs, four cardinal points, a split candle', () => {
    const { container } = render(<UTMark />)

    const arcs = paths(container).filter(p => p.getAttribute('d').includes('A 27.5 27.5'))
    expect(arcs).toHaveLength(4)

    // The four points are one path repeated at 0/90/180/270.
    const pts = paths(container).filter(p => p.getAttribute('d').startsWith('M 50 1.75'))
    expect(pts).toHaveLength(4)
    expect(pts.map(p => p.getAttribute('transform'))).toEqual([
      null, 'rotate(90 50 50)', 'rotate(180 50 50)', 'rotate(270 50 50)',
    ])

    // Candle: two body triangles split corner to corner, plus a two-tone wick.
    expect(paths(container).filter(p => /33\.5 L 57\.1|57\.1 33\.5 L/.test(p.getAttribute('d')))).toHaveLength(2)
    expect(container.querySelectorAll('rect')).toHaveLength(2)
  })

  it('uses the real bull/bear colours by default', () => {
    const { container } = render(<UTMark />)
    const fills = new Set([...container.querySelectorAll('path, rect')]
      .flatMap(el => [el.getAttribute('fill'), el.getAttribute('stroke')])
      .filter(Boolean))
    expect(fills).toContain('#67DB44')
    expect(fills).toContain('#E23E23')
  })

  it('restates itself in gold without falling back to the brand colours', () => {
    const { container } = render(<UTMark tone="gold" />)
    const painted = [...container.querySelectorAll('path, rect')]
      .flatMap(el => [el.getAttribute('fill'), el.getAttribute('stroke')])
      .filter(Boolean)

    // Every painted edge routes through a gradient — no red or green survives.
    expect(painted.every(v => v.startsWith('url(#'))).toBe(true)
    expect(painted.join(' ')).not.toMatch(/#67DB44|#E23E23/i)
    expect(container.querySelectorAll('linearGradient')).toHaveLength(2)
  })

  it('scopes its gradient ids so two marks on one page cannot collide', () => {
    const { container } = render(
      <>
        <UTMark tone="gold" />
        <UTMark tone="gold" />
      </>,
    )
    const ids = [...container.querySelectorAll('linearGradient')].map(g => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is a named image when it stands in for the brand, and silent when decorative', () => {
    const { getByRole } = render(<UTMark title="Uncharted Territory" />)
    expect(getByRole('img', { name: 'Uncharted Territory' })).toBeInTheDocument()

    const { container } = render(<UTMark />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg')).not.toHaveAttribute('role')
  })

  it('turns the bearing ring only when asked — never the needle', () => {
    const { container: still } = render(<UTMark />)
    expect(still.querySelector('g').className.baseVal).toBe('')

    const { container: spun } = render(<UTMark spin />)
    const groups = [...spun.querySelectorAll('svg > g')]
    // First group is the ring; the points and candle groups stay unclassed, so
    // exactly one group can ever rotate.
    expect(groups[0].getAttribute('class')).toBeTruthy()
    expect(groups.slice(1).every(g => !g.getAttribute('class'))).toBe(true)
  })
})
