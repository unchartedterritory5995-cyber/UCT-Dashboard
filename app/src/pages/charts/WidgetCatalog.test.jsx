import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import WidgetCatalog from './WidgetCatalog'

describe('WidgetCatalog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<WidgetCatalog open={false} onAdd={() => {}} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Add a Widget')).not.toBeInTheDocument()
  })

  it('shows grouped sections with widget cards when open', () => {
    render(<WidgetCatalog open onAdd={() => {}} onClose={() => {}} />)
    expect(screen.getByText('Add a Widget')).toBeInTheDocument()
    // Category names appear as both a filter pill and a section header (by-function
    // grouping incl. the renamed Market Internals) — so ≥1 each.
    expect(screen.getAllByText('Charts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Market Internals').length).toBeGreaterThanOrEqual(1)
    // Widget cards from different groups.
    expect(screen.getByText('Chart')).toBeInTheDocument()
    expect(screen.getByText('Volume Surge')).toBeInTheDocument()
    expect(screen.getByText('New Highs / Lows')).toBeInTheDocument()
  })

  it('a real-time widget shows a LIVE tag', () => {
    render(<WidgetCatalog open onAdd={() => {}} onClose={() => {}} />)
    expect(screen.getAllByText('LIVE').length).toBeGreaterThanOrEqual(1)
  })

  it('filtering to a category shows only that group', () => {
    render(<WidgetCatalog open onAdd={() => {}} onClose={() => {}} />)
    // Two "Market Internals" nodes: the pill + the section header. Click the pill.
    fireEvent.click(screen.getAllByText('Market Internals')[0])
    expect(screen.getByText('Volume Surge')).toBeInTheDocument()
    expect(screen.queryByText('Chart')).not.toBeInTheDocument()      // Charts group filtered out
  })

  it('search matches label and blurb', () => {
    render(<WidgetCatalog open onAdd={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Search widgets'), { target: { value: 'surge' } })
    expect(screen.getByText('Volume Surge')).toBeInTheDocument()
    expect(screen.queryByText('Chart')).not.toBeInTheDocument()
  })

  it('clicking a card calls onAdd with the widget id', () => {
    const onAdd = vi.fn()
    render(<WidgetCatalog open onAdd={onAdd} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Volume Surge'))
    expect(onAdd).toHaveBeenCalledWith('volumescan')
  })

  it('shows an on-board count badge from the onBoard map', () => {
    render(<WidgetCatalog open onAdd={() => {}} onClose={() => {}} onBoard={new Map([['chart', 2]])} />)
    expect(screen.getByTitle('2 on your board')).toBeInTheDocument()
  })
})
