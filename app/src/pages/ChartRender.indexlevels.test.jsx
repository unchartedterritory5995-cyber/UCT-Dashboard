import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The Morning Wire's KEY INDEX LEVELS charts pass `?res=&piv=&sup=` (owner 9/26:
// "levels and lines"). They draw as three titled dashed lines, only when passed;
// a chart without them is unchanged.

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

describe('ChartRender ?res= ?piv= ?sup=', () => {
  it('draws Resistance, Pivot and Support at their prices', () => {
    mount('sym=SPY&tf=D&res=772.97&piv=769.97&sup=766.3')
    expect(lines().map((l) => [l.title, l.price])).toEqual(
      [['Resistance', 772.97], ['Pivot', 769.97], ['Support', 766.3]])
  })

  it('draws the major levels as a second, dotted Resistance/Support line (owner 9/30)', () => {
    mount('sym=SPY&tf=D&res=766.69&res2=775.14&piv=764.51&sup=762.28&sup2=749.6')
    const got = lines().map((l) => [l.title, l.price, l.lineStyle])
    expect(got).toEqual([
      ['Resistance 2', 775.14, 1], ['Resistance', 766.69, 2], ['Pivot', 764.51, 2],
      ['Support', 762.28, 2], ['Support 2', 749.6, 1]])
  })

  it('draws nothing extra when they are absent or invalid', () => {
    mount('sym=SPY&tf=D&entry=100')
    expect(lines().map((l) => l.title)).toEqual(['Entry'])
    cleanup()
    mount('sym=SPY&tf=D&res=abc&sup=-5')
    expect(lines()).toEqual([])
  })
})
