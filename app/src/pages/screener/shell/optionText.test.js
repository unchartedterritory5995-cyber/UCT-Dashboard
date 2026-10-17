import { expect, test } from 'vitest'
import { optionText, regionName } from './optionText'
import { chipLabel } from '../chipLabel'

test('country codes read as country names; the option keeps its code as identity', () => {
  expect(optionText('country', 'BM')).toBe('Bermuda')
  expect(optionText('country', 'KY')).toBe('Cayman Islands')
  expect(optionText('country', 'US')).toBe('United States')
  expect(optionText('country', 'Any')).toBe('Any')
})

test('other filters and unknown codes are left exactly as they are', () => {
  expect(optionText('exchange', 'NYSE')).toBe('NYSE')
  expect(regionName('ZZ')).toBe('ZZ')
  expect(regionName('')).toBe('')
})

test('the active-filter chip names the country too', () => {
  const def = { key: 'country', label: 'Country', presets: [{ label: 'Any' }, { label: 'BM', op: 'eq', value: 'BM' }] }
  expect(chipLabel(def, { op: 'eq', value: 'BM' })).toBe('Country: Bermuda')
})
