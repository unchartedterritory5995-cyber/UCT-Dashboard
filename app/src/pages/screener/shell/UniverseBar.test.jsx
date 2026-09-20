import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import UniverseBar from './UniverseBar'

const META = {
  filters: [{
    key: 'list', label: 'My Lists', type: 'enum',
    presets: [
      { label: 'Any' },
      { label: 'Flagged (18)', op: 'in', value: 'flagged' },
      { label: 'Momentum plays (42)', op: 'in', value: 'wl:7' },
      { label: 'Green tag (5)', op: 'in', value: 'tag:green' },
    ],
  }],
}

describe('UniverseBar', () => {
  it('renders UCT Universe, Watchlist and Combo when the member has lists', () => {
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={() => {}} />)
    expect(screen.getByText('UCT Universe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Watchlist/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Combo/ })).toBeInTheDocument()
  })

  it('shows only UCT Universe when there are no lists (absence contract)', () => {
    render(<UniverseBar meta={{ filters: [] }} activeList={undefined} onSetFilter={() => {}} />)
    expect(screen.getByText('UCT Universe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Watchlist/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Combo/ })).not.toBeInTheDocument()
  })

  it('emits the `list` filter with the bare name when a watchlist is picked', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByRole('button', { name: /Watchlist/ }))
    fireEvent.click(screen.getByText('Momentum plays (42)'))
    expect(onSetFilter).toHaveBeenCalledWith('list', {
      op: 'in', value: 'wl:7', label: 'Momentum plays',
    })
  })

  it('clears the `list` filter when UCT Universe is chosen', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeList={{ op: 'in', value: 'wl:7' }} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByText('UCT Universe'))
    expect(onSetFilter).toHaveBeenCalledWith('list', null)
  })

  it('unions selected lists into one array-valued `list` filter (Combo = any-of)', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByRole('button', { name: /Combo/ }))
    fireEvent.click(screen.getByText('Flagged (18)'))
    fireEvent.click(screen.getByText('Momentum plays (42)'))
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    expect(onSetFilter).toHaveBeenCalledWith('list', {
      op: 'in', value: ['flagged', 'wl:7'], label: 'Combo · 2 lists',
    })
  })
})
