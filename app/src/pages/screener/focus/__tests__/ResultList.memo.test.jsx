import { render, screen } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'

// Probe: setupLine runs once per row render, so counting its calls by ticker counts row renders.
const calls = vi.hoisted(() => ({ byTicker: {} }))
vi.mock('../setupLine', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    setupLine: (row) => {
      calls.byTicker[row.ticker] = (calls.byTicker[row.ticker] || 0) + 1
      return real.setupLine(row)
    },
  }
})
import ResultList from '../ResultList'

const rows = [
  { ticker: 'AAA', price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 },
  { ticker: 'BBB', price: 20, chg_pct_1d: 2, base_render: 'Flat Base', vol_ratio: 1 },
]
const onSelect = vi.fn()
const onKeyDown = vi.fn()
// The hub cursor's itemProps is a new function whenever its index moves, but it always returns
// one of two constant objects (hub/useHubCursor.js).
const ACTIVE = { 'data-hub-cursor': 'active' }
const NONE = {}
const itemPropsAt = at => i => (i === at ? ACTIVE : NONE)

const props = (livePrices, extra = {}) => ({
  rows, index: 0, onSelect, onKeyDown, livePrices, radar: new Set(['AAA']), sortLabel: 'RS rank',
  total: 2, hasMore: false, onLoadMore: vi.fn(), isLoading: false, itemProps: itemPropsAt(0), ...extra,
})

beforeEach(() => { calls.byTicker = {} })

test('a live price for one ticker re-renders that row only', () => {
  // The price hook hands back a FRESH object for every ticker on every message.
  const { rerender } = render(<ResultList {...props({ AAA: { price: 10, change_pct: 1 }, BBB: { price: 20, change_pct: 2 } })} />)
  expect(calls.byTicker).toEqual({ AAA: 1, BBB: 1 })
  rerender(<ResultList {...props({ AAA: { price: 11, change_pct: 3 }, BBB: { price: 20, change_pct: 2 } })} />)
  expect(calls.byTicker).toEqual({ AAA: 2, BBB: 1 })
  expect(screen.getByTestId('focus-row-AAA')).toHaveTextContent('11.00')
  expect(screen.getByTestId('focus-row-BBB')).toHaveTextContent('20.00')
})

test('moving the selection re-renders only the two rows whose selected state changed', () => {
  const live = { AAA: { price: 10, change_pct: 1 }, BBB: { price: 20, change_pct: 2 } }
  const three = [...rows, { ticker: 'CCC', price: 30, chg_pct_1d: 0.5, base_render: 'Flat Base', vol_ratio: 1 }]
  const { rerender } = render(<ResultList {...props(live, { rows: three })} />)
  calls.byTicker = {}
  rerender(<ResultList {...props(live, { rows: three, index: 1, itemProps: itemPropsAt(1) })} />)
  expect(calls.byTicker).toEqual({ AAA: 1, BBB: 1 })
  expect(screen.getByTestId('focus-row-BBB')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('focus-row-BBB')).toHaveAttribute('data-hub-cursor', 'active')
  expect(screen.getByTestId('focus-row-AAA')).not.toHaveAttribute('data-hub-cursor')
})
