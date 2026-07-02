import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Sparkline, { sparkPaths } from './Sparkline'

describe('sparkPaths', () => {
  it('returns null for fewer than 2 finite values', () => {
    expect(sparkPaths([])).toBeNull()
    expect(sparkPaths([5])).toBeNull()
    expect(sparkPaths([NaN, null])).toBeNull()
  })

  it('builds a line spanning x 0..100 and flags up-trend', () => {
    const res = sparkPaths([1, 2, 3])
    expect(res.up).toBe(true)
    expect(res.line.startsWith('M0.00')).toBe(true)
    expect(res.line).toContain('L100.00')
    expect(res.area.endsWith('L100 100 L0 100 Z')).toBe(true)
  })

  it('flags down-trend', () => {
    expect(sparkPaths([3, 2, 1]).up).toBe(false)
  })

  it('skips non-finite values', () => {
    expect(sparkPaths([1, NaN, 3]).up).toBe(true)
  })
})

describe('Sparkline', () => {
  it('renders nothing without enough data', () => {
    const { container } = render(<Sparkline values={[1]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders an svg with line and area paths', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(container.querySelectorAll('path').length).toBe(2)
  })

  it('omits the area path when fill is false', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} fill={false} />)
    expect(container.querySelectorAll('path').length).toBe(1)
  })
})
