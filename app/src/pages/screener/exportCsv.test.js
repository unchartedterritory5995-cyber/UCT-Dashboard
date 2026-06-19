import { toCsv } from './exportCsv'

test('builds csv with header and rows', () => {
  const csv = toCsv([{ ticker: 'AAA', price: 10 }], ['ticker', 'price'],
    { ticker: 'Ticker', price: 'Price' })
  const lines = csv.split('\n')
  expect(lines[0]).toBe('Ticker,Price')
  expect(lines[1]).toBe('AAA,10')
})

test('escapes commas and quotes', () => {
  const csv = toCsv([{ ticker: 'AAA', company: 'Alpha, Inc "X"' }],
    ['ticker', 'company'], {})
  expect(csv.split('\n')[1]).toBe('AAA,"Alpha, Inc ""X"""')
})

test('header-only when no rows', () => {
  expect(toCsv([], ['ticker'], { ticker: 'Ticker' })).toBe('Ticker')
})
