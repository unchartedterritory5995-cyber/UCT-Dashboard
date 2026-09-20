import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../hooks/useSavedScreens', () => ({ default: vi.fn() }))
import useSavedScreens from '../hooks/useSavedScreens'
import QuickScreens from './QuickScreens'

const LEADERS = {
  id: 's1', name: 'Leaders · RS ≥ 90',
  spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'overview', sort: { key: 'rs_rank', dir: 'desc' } },
}
const TIGHT = {
  id: 's2', name: 'Tight bases',
  spec: { filters: [{ key: 'tight_consolidation', op: 'eq', value: 1 }], view: 'overview', sort: { key: 'uct_composite', dir: 'desc' } },
}

beforeEach(() => useSavedScreens.mockReturnValue({ starters: [LEADERS, TIGHT] }))

describe('QuickScreens', () => {
  it('renders a chip per starter', () => {
    render(<QuickScreens baseSpec={{ filters: [], view: 'overview', sort: null }} onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'Leaders · RS ≥ 90' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tight bases' })).toBeInTheDocument()
  })

  it('applies the starter spec on click', () => {
    const onApply = vi.fn()
    render(<QuickScreens baseSpec={{ filters: [], view: 'overview', sort: null }} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tight bases' }))
    expect(onApply).toHaveBeenCalledWith(TIGHT.spec)
  })

  it('highlights the chip matching the current spec (order-independent)', () => {
    // Same filters/view/sort as LEADERS but arriving as the shell would re-emit them.
    render(<QuickScreens
      baseSpec={{ filters: [{ key: 'rs_rank', op: 'gte', min: 90 }], view: 'overview', sort: { key: 'rs_rank', dir: 'desc' }, columns: ['ticker', 'rs_rank'] }}
      onApply={() => {}} />)
    expect(screen.getByRole('button', { name: 'Leaders · RS ≥ 90' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tight bases' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders nothing when there are no starters', () => {
    useSavedScreens.mockReturnValue({ starters: [] })
    const { container } = render(<QuickScreens baseSpec={{}} onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
