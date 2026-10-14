import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: props => <div data-testid="stockchart" data-sym={props.sym} data-tf={props.tf} data-lines={JSON.stringify(props.priceLines || [])} /> }))
import ChartPane from '../ChartPane'

const row = { ticker: 'MU', company: 'Micron Technology', industry: 'Semiconductors', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, adr_pct: 3.1 }
const why = { items: [{ kind: 'check', label: 'RS Rank ≥ 80', value: '94' }, { kind: 'pool', label: 'In UCT Universe' }], more: 0 }

test('header names the stock and the setup', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByRole('heading', { name: /MU/ })).toBeInTheDocument()
  const company = screen.getByTestId('pane-company')
  const industry = screen.getByTestId('pane-industry')
  expect(company).toHaveTextContent('Micron Technology')
  expect(industry).toHaveTextContent('· Semiconductors')
  expect(company).not.toBe(industry)
  expect(company.contains(industry)).toBe(false)
  // the <=1024 media rule hides only the industry element, never the company
  expect(industry.className).toMatch(/paneIndustry/)
  expect(company.className).not.toMatch(/paneIndustry/)
  expect(screen.getByText('Flat Base')).toBeInTheDocument()
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'MU')
})
test('why-it-here shows checks and pools differently', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  const strip = screen.getByRole('list', { name: "Why it's here" })
  expect(strip).toHaveTextContent('RS Rank ≥ 80')
  expect(strip).toHaveTextContent('94')
  expect(strip).toHaveTextContent('In UCT Universe')
})
test('a note with a missing value shows the pool mark, never a check', () => {
  const w = { items: [{ kind: 'note', label: 'RS Rank ≥ 80', value: '—' }, { kind: 'check', label: 'Price ≥ 10', value: '956' }], more: 0 }
  render(<ChartPane row={row} why={w} onFlag={vi.fn()} onWatch={vi.fn()} />)
  const items = screen.getByRole('list', { name: "Why it's here" }).querySelectorAll('li')
  expect(items[0]).toHaveTextContent('○')
  expect(items[0]).not.toHaveTextContent('✓')
  expect(items[1]).toHaveTextContent('✓')
})
test('no pivot line without a pivot', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-lines', '[]')
})
test('pivot line when the row has one', () => {
  render(<ChartPane row={{ ...row, base_pivot_px: 988 }} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(JSON.parse(screen.getByTestId('stockchart').dataset.lines)[0].price).toBe(988)
})
test('buttons call back', () => {
  const onFlag = vi.fn(), onWatch = vi.fn()
  render(<ChartPane row={row} why={why} onFlag={onFlag} onWatch={onWatch} />)
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add to watchlist' }))
  expect(onFlag).toHaveBeenCalledWith(row)
  expect(onWatch).toHaveBeenCalledWith(row)
})
test('nothing selected shows a placeholder, no chart', () => {
  render(<ChartPane row={null} why={{ items: [], more: 0 }} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.queryByTestId('stockchart')).toBeNull()
  expect(screen.getByText('Pick a stock from the list')).toBeInTheDocument()
})

test('live price overrides the shown price', () => {
  render(<ChartPane row={row} livePrice={{ price: 960.5, change_pct: 1.2 }} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByText('960.50')).toBeInTheDocument()
  expect(screen.getByText('+1.2%')).toBeInTheDocument()
})
test('isFlagged sets aria-pressed and keeps the label', () => {
  render(<ChartPane row={row} isFlagged why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Flag' })).toHaveAttribute('aria-pressed', 'true')
})
test('the W button passes tf W to the chart', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'W' }))
  expect(screen.getByRole('button', { name: 'W' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-tf', 'W')
})

test('plain words: the fact line says what the numbers are (owner decision 5)', () => {
  render(<ChartPane row={{ ...row, vol_ratio: 0.6, adr_pct: 4.1 }} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByText('Volume 0.6× avg · Avg daily range 4.1%')).toBeInTheDocument()
  expect(screen.queryByText(/ADR|Vol \d/)).toBeNull()
})
test('B2: a structure screen leads the setup tag with the matched structure; the pivot is named for the head', () => {
  const structures = { matched: [{ value: ',pocket-pivot,', label: 'Pocket Pivot', title: 'Pocket Pivot' }], labels: ['Pocket Pivot', 'Ugly Double Bottom'] }
  render(<ChartPane row={{ ...row, base_render: 'Ugly Double Bottom (Pocket Pivot)', price: 97, base_pivot_px: 100 }} structures={structures}
    why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  const tag = screen.getByTestId('pane-setup')
  expect(tag).toHaveTextContent('Pocket Pivot · also Ugly Double Bottom')
  expect(tag).toHaveAttribute('title', 'Pocket Pivot')
  expect(screen.getByText('Ugly Double Bottom: 3.0% below pivot 100')).toBeInTheDocument()
})
test('the setup tag always carries a tooltip', () => {
  render(<ChartPane row={row} why={why} onFlag={vi.fn()} onWatch={vi.fn()} />)
  expect(screen.getByTestId('pane-setup')).toHaveAttribute('title', 'Flat Base')
})
