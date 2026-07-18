import { describe, it, expect } from 'vitest'
import { humanizeGroupId } from './groupLabel'

describe('humanizeGroupId', () => {
  it('title-cases a snake_case id', () => {
    expect(humanizeGroupId('additive_manufacturing')).toBe('Additive Manufacturing')
    expect(humanizeGroupId('oil_gas_ep')).toBe('Oil Gas Ep')
  })
  it('handles hyphens/spaces and collapses repeats', () => {
    expect(humanizeGroupId('memory-chips')).toBe('Memory Chips')
    expect(humanizeGroupId('a__b')).toBe('A B')
  })
  it('single word', () => {
    expect(humanizeGroupId('space')).toBe('Space')
  })
  it('empty / non-string → empty string', () => {
    expect(humanizeGroupId('')).toBe('')
    expect(humanizeGroupId(null)).toBe('')
    expect(humanizeGroupId(undefined)).toBe('')
  })
})
