import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

const starters = [
  { id: 's1', name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'overview' } },
  { id: 's2', name: 'Tight bases', spec: { filters: [{ key: 'base_structure', op: 'contains', value: ',tight,' }], view: 'bases' } },
]
vi.mock('../hooks/useSavedScreens', () => ({ default: () => ({ starters }) }))
import PresetChips from './PresetChips'

describe('PresetChips', () => {
  it('renders a chip per starter and applies its spec on click', () => {
    const onApply = vi.fn()
    render(<PresetChips currentSpec={{ filters: [] }} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leaders' }))
    expect(onApply).toHaveBeenCalledWith(starters[0].spec)
  })

  it('marks a chip active when its conditions are on screen — POOL-BLIND', () => {
    // the current spec = Leaders' conditions PLUS a UCT pool → still Leaders.
    const currentSpec = { filters: [
      { key: 'rs_rank', op: 'gte', min: 90 },
      { key: 'universe', op: 'eq', value: 'uct' },
    ], view: 'overview' }
    render(<PresetChips currentSpec={currentSpec} onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'Leaders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tight bases' })).toHaveAttribute('aria-pressed', 'false')
  })
})
