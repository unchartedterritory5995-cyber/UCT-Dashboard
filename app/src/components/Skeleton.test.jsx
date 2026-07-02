import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SkeletonLine, SkeletonCircle, SkeletonPill } from './Skeleton'

describe('Skeleton primitives', () => {
  it('SkeletonLine renders with the given size', () => {
    const { container } = render(<SkeletonLine width="120px" height={20} />)
    const el = container.firstChild
    expect(el.style.width).toBe('120px')
    expect(el.style.height).toBe('20px')
  })

  it('SkeletonCircle renders square with circle class', () => {
    const { container } = render(<SkeletonCircle size={40} />)
    const el = container.firstChild
    expect(el.style.width).toBe('40px')
    expect(el.style.height).toBe('40px')
    expect(el.className).toMatch(/circle/)
  })

  it('SkeletonPill renders with pill class', () => {
    const { container } = render(<SkeletonPill />)
    expect(container.firstChild.className).toMatch(/pill/)
  })
})
