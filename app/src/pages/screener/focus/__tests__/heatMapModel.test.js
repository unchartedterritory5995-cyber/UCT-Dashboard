import { expect, test } from 'vitest'
import { chgTier, buildHeatMap, GROUP_BYS } from '../heatMapModel'

test('the colour tier reads the day change on a symmetric ladder; flat and unknown have no heat', () => {
  expect([4.2, 2.1, 0.6, 0.2, 0, -0.3, -0.6, -2.5, -7].map(chgTier)).toEqual(['g3', 'g2', 'g1', '', '', '', 'r1', 'r2', 'r3'])
  expect(chgTier(null)).toBe('')
  expect(chgTier(undefined)).toBe('')
  expect(chgTier(NaN)).toBe('')
})

const rows = [
  { ticker: 'NVDA', company: 'NVIDIA', sector: 'Technology', industry: 'Semiconductors', market_cap: 4.5e12, chg_pct_1d: 1.1 },
  { ticker: 'MU', sector: 'Technology', industry: 'Semiconductors', market_cap: 1.0e11, chg_pct_1d: -3.7 },
  { ticker: 'XOM', sector: 'Energy', industry: 'Oil & Gas', market_cap: 4.8e11, chg_pct_1d: 0.1 },
  { ticker: 'TINY', sector: null, industry: null, market_cap: null, chg_pct_1d: 9 },
]

test('tiles are sized by market cap and grouped by sector, biggest group first', () => {
  const { groups } = buildHeatMap(rows, { groupBy: 'sector' })
  expect(groups.map(g => g.name)).toEqual(['Technology', 'Energy', 'Other'])
  const tech = groups[0]
  expect(tech.children.map(c => c.ticker)).toEqual(['NVDA', 'MU'])
  expect(tech.children[0].value).toBe(4.5e12)
  expect(tech.children[1]).toMatchObject({ ticker: 'MU', chg: -3.7, tier: 'r2' })
})

test('a stock with no market cap is still on the map, at the smallest size, never dropped', () => {
  const { groups, missingCap } = buildHeatMap(rows, { groupBy: 'sector' })
  const tiny = groups.find(g => g.name === 'Other').children[0]
  expect(tiny.ticker).toBe('TINY')
  expect(tiny.value).toBe(1.0e11)
  expect(missingCap).toBe(1)
})

test('the live change wins over the snapshot change when the stock has one', () => {
  const { groups } = buildHeatMap(rows, { groupBy: 'sector', livePrices: { MU: { change_pct: 0.7 } } })
  expect(groups[0].children.find(c => c.ticker === 'MU')).toMatchObject({ chg: 0.7, tier: 'g1' })
})

test('grouping by industry and by theme', () => {
  expect(buildHeatMap(rows, { groupBy: 'industry' }).groups.map(g => g.name)).toEqual(['Semiconductors', 'Oil & Gas', 'Other'])
  const byTheme = buildHeatMap(rows, { groupBy: 'theme', themeData: { NVDA: 'AI Compute', MU: 'AI Compute', XOM: null } })
  expect(byTheme.groups.map(g => g.name)).toEqual(['AI Compute', 'No theme'])
  expect(GROUP_BYS.map(g => g.key)).toEqual(['sector', 'industry', 'theme'])
})

test('no rows, no groups', () => {
  expect(buildHeatMap([], { groupBy: 'sector' }).groups).toEqual([])
})
