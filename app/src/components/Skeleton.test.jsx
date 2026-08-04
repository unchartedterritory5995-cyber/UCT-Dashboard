import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SkeletonLine, SkeletonCircle, SkeletonPill, SkeletonBlock, SkeletonChart } from './Skeleton'

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

// ── SkeletonBlock size contract (spec §3.4) ────────────────────────────────
// §3.4: "each chart component exports its rendered dimensions; SkeletonBlock
// reserves exactly that box (no layout shift on load)". The `size` prop is that
// contract. The width/height props are LOAD-BEARING for five existing call
// sites and their behaviour must not move.
describe('SkeletonBlock — existing API (regression)', () => {
  it('keeps its defaults when called bare', () => {
    const { container } = render(<SkeletonBlock />)
    const el = container.firstChild
    expect(el.className).toMatch(/block/)
    expect(el.style.width).toBe('100%')
    expect(el.style.height).toBe('80px')
  })

  it('honours the DeskSectionSkeleton call pattern: width="100%" height={150}', () => {
    const { container } = render(<SkeletonBlock width="100%" height={150} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('150px')
  })

  it('honours the HoldingsListSkeleton call pattern: width="96px" height={26}', () => {
    const { container } = render(<SkeletonBlock width="96px" height={26} />)
    expect(container.firstChild.style.width).toBe('96px')
    expect(container.firstChild.style.height).toBe('26px')
  })

  it('SkeletonChart still forwards its height', () => {
    const { container } = render(<SkeletonChart height={200} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('200px')
  })
})

describe('SkeletonBlock — size contract', () => {
  it('reserves exactly the box a size contract declares', () => {
    const CHART_SIZE = { width: '100%', height: 220 }
    const { container } = render(<SkeletonBlock size={CHART_SIZE} />)
    expect(container.firstChild.style.width).toBe('100%')
    expect(container.firstChild.style.height).toBe('220px')
  })

  it('lets size win over width/height when both are passed', () => {
    const { container } = render(
      <SkeletonBlock width="10px" height={10} size={{ width: '300px', height: 90 }} />,
    )
    expect(container.firstChild.style.width).toBe('300px')
    expect(container.firstChild.style.height).toBe('90px')
  })

  it('falls back per-axis when a size contract is partial', () => {
    const { container } = render(<SkeletonBlock height={44} size={{ width: '250px' }} />)
    expect(container.firstChild.style.width).toBe('250px')
    expect(container.firstChild.style.height).toBe('44px')
  })

  it('ignores a null size', () => {
    const { container } = render(<SkeletonBlock size={null} width="70px" height={12} />)
    expect(container.firstChild.style.width).toBe('70px')
    expect(container.firstChild.style.height).toBe('12px')
  })
})
