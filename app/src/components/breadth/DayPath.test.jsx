/**
 * The path exists to corroborate the number printed beside it. If its last
 * point isn't the current reading, or its direction disagrees with the delta,
 * it is worse than absent.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DayPath from './DayPath'

const pts = vals => vals.map((v, i) => [1_000 + i * 60, v])

describe('DayPath', () => {
  it('draws nothing until there is a path to draw', () => {
    // One sample is a reading, not a session. A flat line across the panel
    // would imply a session that hasn't happened.
    const { container: none } = render(<DayPath points={[]} />)
    expect(none.querySelector('svg')).toBeNull()
    const { container: one } = render(<DayPath points={pts([61])} />)
    expect(one.querySelector('svg')).toBeNull()
    const { container: two } = render(<DayPath points={pts([61, 63])} />)
    expect(two.querySelector('svg')).not.toBeNull()
  })

  it('reports the move since the open, not since yesterday', () => {
    render(<DayPath points={pts([58.0, 61.4, 65.3])} />)
    expect(screen.getByText('+7.3')).toBeInTheDocument()
    expect(screen.getByTitle(/opened 58.0, now 65.3 \(\+7.3 since the open\)/))
      .toBeInTheDocument()
  })

  it('signs a decline', () => {
    render(<DayPath points={pts([71.0, 66.0])} />)
    expect(screen.getByText('-5.0')).toBeInTheDocument()
  })

  it('ends its line on the latest reading', () => {
    const { container } = render(
      <DayPath points={pts([10, 90, 50])} width={100} height={20} />)
    const d = container.querySelector('path').getAttribute('d')
    const lastX = Number(d.split('L').at(-1).split(',')[0])
    expect(lastX).toBeCloseTo(100, 1)
    // …and the dot marks it, so the eye lands on "now" rather than the peak.
    const dot = container.querySelector('circle')
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(100, 1)
  })

  it('survives a dead-flat session without dividing by zero', () => {
    const { container } = render(<DayPath points={pts([50, 50, 50])} />)
    const d = container.querySelector('path').getAttribute('d')
    expect(d).not.toMatch(/NaN|Infinity/)
    expect(screen.getByText('0.0')).toBeInTheDocument()
  })

  it('ignores samples that are not numbers', () => {
    const { container } = render(
      <DayPath points={[[1, 60], [2, null], [3, 'x'], [4, 64]]} />)
    const d = container.querySelector('path').getAttribute('d')
    expect(d.match(/[ML]/g)).toHaveLength(2)
    expect(screen.getByText('+4.0')).toBeInTheDocument()
  })
})
