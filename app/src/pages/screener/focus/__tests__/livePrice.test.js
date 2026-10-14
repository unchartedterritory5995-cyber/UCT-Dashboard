import { expect, test } from 'vitest'
import { livePriceOf } from '../livePrice'

const row = { ticker: 'MU', price: 100, chg_pct_1d: -3.7, vol_ratio: 0.8 }
test('a live price comes with its own change', () => {
  expect(livePriceOf(row, { price: 104, change_pct: 1.2 })).toEqual({ price: 104, chg: 1.2, live: true })
})
test('a live price with no change never borrows the snapshot change', () => {
  expect(livePriceOf(row, { price: 104 })).toEqual({ price: 104, chg: null, live: true })
})
test('no live price: the snapshot price and change', () => {
  expect(livePriceOf(row, undefined)).toEqual({ price: 100, chg: -3.7, live: false })
})
test('a stock that did not trade shows no change', () => {
  expect(livePriceOf({ ...row, vol_ratio: 0 }, { price: 104, change_pct: 1.2 }).chg).toBeNull()
})
