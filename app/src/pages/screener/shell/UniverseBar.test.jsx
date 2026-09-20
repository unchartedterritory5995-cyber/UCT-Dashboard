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
  it('renders All Market, UCT Universe, Watchlist and Combo when the member has lists', () => {
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={() => {}} />)
    expect(screen.getByRole('button', { name: 'All Market' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /UCT Universe/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Watchlist/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Combo/ })).toBeInTheDocument()
  })

  it('shows All Market + UCT Universe when there are no lists (absence contract)', () => {
    render(<UniverseBar meta={{ filters: [] }} activeList={undefined} onSetFilter={() => {}} />)
    expect(screen.getByRole('button', { name: 'All Market' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /UCT Universe/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Watchlist/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Combo/ })).not.toBeInTheDocument()
  })

  it('picking a watchlist sets `list` (bare name) and clears `universe`', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByRole('button', { name: /Watchlist/ }))
    fireEvent.click(screen.getByText('Momentum plays (42)'))
    expect(onSetFilter).toHaveBeenCalledWith('list', { op: 'in', value: 'wl:7', label: 'Momentum plays' })
    expect(onSetFilter).toHaveBeenCalledWith('universe', null)
  })

  it('UCT Universe sets the curated `universe` gate and clears any list', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeList={{ op: 'in', value: 'wl:7' }} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByRole('button', { name: /UCT Universe/ }))
    expect(onSetFilter).toHaveBeenCalledWith('universe', { op: 'eq', value: 'uct', label: 'UCT Universe' })
    expect(onSetFilter).toHaveBeenCalledWith('list', null)
  })

  it('All Market clears both universe and list', () => {
    const onSetFilter = vi.fn()
    render(<UniverseBar meta={META} activeUniverse={{ op: 'eq', value: 'uct' }} onSetFilter={onSetFilter} />)
    fireEvent.click(screen.getByRole('button', { name: 'All Market' }))
    expect(onSetFilter).toHaveBeenCalledWith('universe', null)
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

  it('shows the live count as "names" when unfiltered', () => {
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={() => {}}
      total={3745} isLoading={false} hasFilters={false} />)
    expect(screen.getByText('3,745')).toBeInTheDocument()
    expect(screen.getByText(/names/)).toBeInTheDocument()
  })

  it('labels the count "matches" once filters are applied', () => {
    render(<UniverseBar meta={META} activeList={undefined} onSetFilter={() => {}}
      total={120} isLoading={false} hasFilters />)
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText(/matches/)).toBeInTheDocument()
  })
})
