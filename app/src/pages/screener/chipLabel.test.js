import { chipLabel } from './chipLabel'

const rsi = { key: 'rsi14', label: 'RSI (14)', unit: '',
  presets: [{ label: 'Any' }, { label: '40–60', op: 'between', min: 40, max: 60 }] }
const cap = { key: 'market_cap', label: 'Market Cap', unit: '$', presets: [{ label: 'Any' }] }
const sector = { key: 'sector', label: 'Sector', unit: null, presets: [{ label: 'Any' }] }

test('matches a preset label', () => {
  expect(chipLabel(rsi, { op: 'between', min: 40, max: 60 })).toBe('RSI (14): 40–60')
})

test('formats a custom range with money prefix', () => {
  expect(chipLabel(cap, { op: 'gte', min: 2000000000 })).toBe('Market Cap: ≥ $2000000000')
})

test('formats lte and eq', () => {
  expect(chipLabel(rsi, { op: 'lte', max: 30 })).toBe('RSI (14): ≤ 30')
  expect(chipLabel(sector, { op: 'eq', value: 'Technology' })).toBe('Sector: Technology')
})
