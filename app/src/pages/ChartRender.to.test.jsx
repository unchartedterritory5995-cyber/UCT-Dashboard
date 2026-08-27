import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?to=YYYY-MM-DD` is the Discord chart's "Earlier" step: it becomes
// StockChart's replayCutoff. Malformed or absent -> no cutoff, chart unchanged.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart" data-cutoff={props.replayCutoff ?? 'none'} width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(<MemoryRouter initialEntries={[`/r/chart?${query}`]}><ChartRender /></MemoryRouter>)
}
afterEach(() => cleanup())

describe('ChartRender ?to=', () => {
  it('passes a valid end date as replayCutoff', () => {
    mount('sym=NVDA&tf=D&to=2026-05-15')
    expect(screen.getByTestId('stock-chart').getAttribute('data-cutoff')).toBe('2026-05-15')
  })
  it('ignores a malformed or absent one', () => {
    mount('sym=NVDA&tf=D&to=yesterday')
    expect(screen.getByTestId('stock-chart').getAttribute('data-cutoff')).toBe('none')
    cleanup()
    mount('sym=NVDA&tf=D')
    expect(screen.getByTestId('stock-chart').getAttribute('data-cutoff')).toBe('none')
  })
})
