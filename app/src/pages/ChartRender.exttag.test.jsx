import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The bot passes the extended-hours print as `?exttag=pre|post:<price>`; the
// page must turn it into the SAME orange right-axis chip the Charts widget
// draws (StockChart's SESSION_EXT_COLOR, chip only, no line) and nothing else.

vi.mock('../components/StockChart', () => ({
  SESSION_EXT_COLOR: '#f5a623',
  default: (props) => <canvas data-testid="stock-chart" data-lines={JSON.stringify(props.priceLines || [])} width={8} height={8} />,
}))

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const lines = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-lines'))

afterEach(() => cleanup())

describe('ChartRender ?exttag=', () => {
  it('draws a Post chip at the price, chip only, in the widget colour', () => {
    mount('sym=SPY&tf=D&exttag=post:764.97')
    expect(lines()).toEqual([{ price: 764.97, color: '#f5a623', lineWidth: 1, lineStyle: 0,
      axisLabelVisible: true, lineVisible: false, title: 'Post' }])
  })

  it('titles a pre-market print Pre and keeps the user levels beside it', () => {
    mount('sym=SPY&tf=5&exttag=pre:102.5&entry=100')
    const L = lines()
    expect(L[0].title).toBe('Pre')
    expect(L[0].price).toBe(102.5)
    expect(L[1].title).toBe('Entry')
  })

  it('ignores a malformed or absent tag', () => {
    mount('sym=SPY&tf=D&exttag=post:abc')
    expect(lines()).toEqual([])
    cleanup()
    mount('sym=SPY&tf=D')
    expect(lines()).toEqual([])
  })
})
