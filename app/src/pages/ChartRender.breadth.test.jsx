import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?breadth=1&bname=` makes this page paint a UCT breadth metric the way the
// app's ChartPane does: symbol + metric-name watermark, the single-ink line
// (`breadthLine`), a blank volume pane. Absent, nothing about a stock changes.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart"
    data-breadth={JSON.stringify({ breadthLine: props.breadthLine ?? null, blankVolume: props.blankVolume ?? null,
      watermark: props.watermark ?? null, watermarkName: props.watermarkName ?? null })} width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const props = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-breadth'))

afterEach(() => cleanup())

describe('ChartRender ?breadth=', () => {
  it('paints a breadth metric like ChartPane does', () => {
    mount('sym=UCTA50&tf=D&breadth=1&bname=' + encodeURIComponent('% of Stocks Above 50-Day MA'))
    expect(props()).toEqual({ breadthLine: true, blankVolume: true, watermark: 'UCTA50', watermarkName: '% of Stocks Above 50-Day MA' })
  })

  it('changes nothing for a stock', () => {
    mount('sym=NVDA&tf=D')
    expect(props()).toEqual({ breadthLine: null, blankVolume: null, watermark: null, watermarkName: null })
  })
})
