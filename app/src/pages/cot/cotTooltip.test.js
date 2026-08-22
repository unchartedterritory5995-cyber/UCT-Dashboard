import { describe, it, expect } from 'vitest'
import { tooltipLines } from './cotTooltip'

const row = {
  date: '2026-08-11',
  commercial_net: -113553,
  large_spec_net: -10560,
  small_spec_net: 124113,
  open_interest: 2072358,
}

describe('tooltipLines', () => {
  it('lists the hovered group first, then the other groups, then open interest', () => {
    expect(tooltipLines(row, 'commercials')).toEqual([
      'Commercials: (113,553)',
      'Large Speculators: (10,560)',
      'Small Speculators: 124,113',
      'Open Interest: 2,072,358',
    ])
  })

  it('moves the hovered group to the top for any group', () => {
    expect(tooltipLines(row, 'smallSpecs')[0]).toBe('Small Speculators: 124,113')
    expect(tooltipLines(row, 'smallSpecs')).toHaveLength(4)
  })

  it('puts open interest first when the OI pane is hovered', () => {
    const lines = tooltipLines(row, 'openInterest')
    expect(lines[0]).toBe('Open Interest: 2,072,358')
    expect(lines.slice(1)).toEqual([
      'Commercials: (113,553)',
      'Large Speculators: (10,560)',
      'Small Speculators: 124,113',
    ])
  })

  it('returns no lines without a row', () => {
    expect(tooltipLines(null, 'commercials')).toEqual([])
  })
})
