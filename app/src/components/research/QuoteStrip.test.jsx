import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fmtPrice, fmtVol, rangePct } from './QuoteStrip'

let quote = {
  sym: 'AAPL', price: 313.33, change: 0.92, change_pct: 0.29448,
  open: 311.32, high: 314.81, low: 310.74, prev_close: 312.41,
  volume: 34437191, year_high: 344.57, year_low: 223.78,
}
vi.mock('swr', () => ({ default: (key) => ({ data: key ? quote : null }) }))
import QuoteStrip from './QuoteStrip'

describe('formatters', () => {
  it('prices to two decimals', () => {
    expect(fmtPrice(313.3)).toBe('$313.30')
    expect(fmtPrice(null)).toBe('—')
  })

  it('volume scales, and 0 is not "—"', () => {
    expect(fmtVol(34437191)).toBe('34.44M')
    expect(fmtVol(1.2e9)).toBe('1.20B')
    expect(fmtVol(0)).toBe('0')      // a halted name traded zero; that is a fact
    expect(fmtVol(null)).toBe('—')
  })
})

describe('rangePct — where today sits in the 52-week range', () => {
  it('maps low to 0 and high to 100', () => {
    expect(rangePct(10, 10, 20)).toBe(0)
    expect(rangePct(20, 10, 20)).toBe(100)
    expect(rangePct(15, 10, 20)).toBe(50)
  })

  it('clamps a price outside its own range rather than overflowing the track', () => {
    // A fresh 52-week high can print before the range field updates.
    expect(rangePct(25, 10, 20)).toBe(100)
    expect(rangePct(5, 10, 20)).toBe(0)
  })

  it('is null when the range is degenerate or missing', () => {
    expect(rangePct(10, 20, 20)).toBeNull()   // hi == lo would divide by zero
    expect(rangePct(10, null, 20)).toBeNull()
    expect(rangePct(null, 10, 20)).toBeNull()
  })
})

describe('QuoteStrip', () => {
  it('shows the session numbers, not just the price', () => {
    render(<QuoteStrip sym="AAPL" />)
    const t = document.body.textContent
    expect(t).toContain('$313.33')
    expect(t).toContain('$311.32')   // open
    expect(t).toContain('$314.81')   // high
    expect(t).toContain('$310.74')   // low
    expect(t).toContain('34.44M')    // volume
  })

  it('shows the change as an absolute value with its own direction marker', () => {
    render(<QuoteStrip sym="AAPL" />)
    // The arrow carries the sign; "▲ -$0.92" would be a contradiction.
    expect(document.body.textContent).toContain('▲ $0.92')
    expect(document.body.textContent).toContain('(+0.29%)')
  })

  it('renders nothing without a symbol or a price', () => {
    const { container } = render(<QuoteStrip sym={null} />)
    expect(container.firstChild).toBeNull()
    const prev = quote
    quote = { sym: 'X', price: null }
    const { container: c2 } = render(<QuoteStrip sym="X" />)
    expect(c2.firstChild).toBeNull()
    quote = prev
  })
})
