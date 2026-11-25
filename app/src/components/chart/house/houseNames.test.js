import { describe, it, expect } from 'vitest'
import house from './housePineIndicators.json'
import { HOUSE_INDICATOR_NAMES, isHouseCopyMeta } from './houseNames'

describe('house indicator names', () => {
  it('are exactly the house set\'s own names (one authority, restated only to keep the chart light)', () => {
    expect([...HOUSE_INDICATOR_NAMES].sort()).toEqual(house.indicators.map((i) => i.name).sort())
  })
  it('recognise an unedited copy, and nothing else', () => {
    expect(isHouseCopyMeta({ name: 'Fred RS' })).toBe(true)
    expect(isHouseCopyMeta({ name: ' fred rs ' })).toBe(true)
    expect(isHouseCopyMeta({ name: 'Fred RS', scriptEdited: true })).toBe(false)
    expect(isHouseCopyMeta({ name: 'My RS' })).toBe(false)
    expect(isHouseCopyMeta(null)).toBe(false)
  })
})
