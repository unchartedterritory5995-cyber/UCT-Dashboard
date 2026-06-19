import { toCsv, fetchAllRows } from './exportCsv'

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

test('fetchAllRows pages through the full match set', async () => {
  const pages = {
    1: { rows: Array(500).fill({ ticker: 'X' }), total: 750, view_columns: ['ticker'], snapshot_date: '2026-06-19' },
    2: { rows: Array(250).fill({ ticker: 'Y' }), total: 750, view_columns: ['ticker'] },
  }
  const calls = []
  const fetcher = async spec => { calls.push(spec.page); return pages[spec.page] }
  const out = await fetchAllRows({ filters: [] }, { pageSize: 500, fetcher })
  expect(out.rows.length).toBe(750)
  expect(out.view_columns).toEqual(['ticker'])
  expect(calls).toEqual([1, 2])  // stops after the short final page
})

test('fetchAllRows respects max cap', async () => {
  const fetcher = async spec => ({ rows: Array(500).fill({ ticker: 'X' }), total: 100000, view_columns: ['ticker'] })
  const out = await fetchAllRows({ filters: [] }, { pageSize: 500, max: 1000, fetcher })
  expect(out.rows.length).toBe(1000)
})
