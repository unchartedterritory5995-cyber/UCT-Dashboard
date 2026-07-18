import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import GroupHeatHeader, { summarizeHeat } from './GroupHeatHeader'

describe('summarizeHeat', () => {
  it('counts greens, averages %, finds the leader', () => {
    const h = [{ sym: 'RKLB', changePct: 8 }, { sym: 'ASTS', changePct: -2 }, { sym: 'LUNR', changePct: 4 }]
    expect(summarizeHeat(h)).toEqual({ green: 2, count: 3, avg: 3.33, leader: { sym: 'RKLB', changePct: 8 } })
  })
  it('handles an empty set', () => {
    expect(summarizeHeat([])).toEqual({ green: 0, count: 0, avg: 0, leader: null })
  })
})

describe('GroupHeatHeader', () => {
  it('renders the summary line and the N-of-total note', () => {
    render(<GroupHeatHeader groupName="Space" total={13} shown={9}
      holdings={[{ sym: 'RKLB', changePct: 8 }, { sym: 'ASTS', changePct: -2 }]} />)
    expect(screen.getByText(/Space/)).toBeTruthy()
    expect(screen.getByText(/1\/2 green/)).toBeTruthy()
    expect(screen.getByText(/9 of 13/)).toBeTruthy()
  })
})
