import { describe, it, expect } from 'vitest'
import { tooltipLines, tooltipRows } from './cotTooltip'

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

  it('appends a price line when a proxy close is supplied', () => {
    const lines = tooltipLines(row, 'commercials', { ticker: 'SPY', close: 645.123 })
    expect(lines).toHaveLength(5)
    expect(lines[4]).toBe('Price (SPY): 645.12')
  })

  it('puts the price line first when the price pane is hovered', () => {
    const lines = tooltipLines(row, 'price', { ticker: 'SPY', close: 645.123 })
    expect(lines[0]).toBe('Price (SPY): 645.12')
    expect(lines).toHaveLength(5)
  })

  it('omits the price line when the close is missing', () => {
    expect(tooltipLines(row, 'price', { ticker: 'SPY', close: null })).toHaveLength(4)
  })
})

describe('tooltipRows', () => {
  it('returns keyed rows in the same order as the lines, flagging the hovered one', () => {
    const rows = tooltipRows(row, 'largeSpecs', { ticker: 'SPY', close: 645.123 })
    expect(rows.map(r => r.key)).toEqual(['largeSpecs', 'commercials', 'smallSpecs', 'openInterest', 'price'])
    expect(rows[0]).toEqual({ key: 'largeSpecs', label: 'Large Speculators', value: '(10,560)', hot: true })
    expect(rows[4]).toEqual({ key: 'price', label: 'Price (SPY)', value: '645.12', hot: false })
    expect(tooltipLines(row, 'largeSpecs', { ticker: 'SPY', close: 645.123 })).toEqual(rows.map(r => `${r.label}: ${r.value}`))
  })
})
