import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GroupSummaryStrip from './GroupSummaryStrip'

describe('GroupSummaryStrip', () => {
  it('renders nothing without summary', () => {
    const { container } = render(<GroupSummaryStrip summary={null} dimension="industry" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders top groups and excludes Unclassified', () => {
    const summary = [
      { key: 'Semiconductors', count: 14, avgPct: 6.4 },
      { key: 'Biotech', count: 11, avgPct: 9.1 },
      { key: 'Unclassified', count: 3, avgPct: 2 },
    ]
    render(<GroupSummaryStrip summary={summary} dimension="industry" />)
    expect(screen.getByText('Semiconductors')).toBeInTheDocument()
    expect(screen.getByText('Biotech')).toBeInTheDocument()
    expect(screen.queryByText('Unclassified')).not.toBeInTheDocument()
    expect(screen.getByText('Top industries')).toBeInTheDocument()
  })

  it('calls onPick when a chip is clicked', () => {
    const onPick = vi.fn()
    render(<GroupSummaryStrip
      summary={[{ key: 'Energy', count: 5, avgPct: -3 }]}
      dimension="sector"
      onPick={onPick}
    />)
    fireEvent.click(screen.getByText('Energy'))
    expect(onPick).toHaveBeenCalledWith('Energy')
  })
})
