import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { fmtPrice, fmtVol } from './QuoteStrip'

let quote = {
  sym: 'AAPL', price: 313.33, change: 0.92, change_pct: 0.29448,
  open: 311.32, high: 314.81, low: 310.74, prev_close: 312.41,
  volume: 34437191, year_high: 344.57, year_low: 223.78,
}
vi.mock('../../hooks/useMobileSWR', () => ({
  default: (key) => ({ data: key ? quote : null }),
}))
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

describe('QuoteStrip', () => {
  it('shows the session numbers the banner cannot', () => {
    render(<QuoteStrip sym="AAPL" />)
    const t = document.body.textContent
    expect(t).toContain('$311.32')   // open
    expect(t).toContain('$314.81')   // high
    expect(t).toContain('$310.74')   // low
    expect(t).toContain('$312.41')   // prev close
    expect(t).toContain('34.44M')    // volume
  })

  it('does NOT print the price or the change — the banner is the one authority', () => {
    // Two live-price readers on one modal (this strip's /api/research/quote and
    // the banner's useLivePrices) rendered the same quote 20px apart, rounded
    // two ways ("▼8.1%" over "▼$1.56 (-8.07%)"). Whatever this endpoint says
    // about price must not reach the screen from here.
    render(<QuoteStrip sym="AAPL" />)
    const t = document.body.textContent
    expect(t).not.toContain('$313.33')   // the price itself
    expect(t).not.toContain('$0.92')     // the absolute change
    expect(t).not.toContain('0.29%')     // the percent change
    expect(t).not.toMatch(/[▲▼]/)        // and no direction marker to carry it
  })

  it('renders nothing without a symbol or a price', () => {
    const { container } = render(<QuoteStrip sym={null} />)
    expect(container.firstChild).toBeNull()
    const prev = quote
    // `price` still GATES the row even though it is never drawn — it is the
    // field that says this payload is a real quote rather than an empty shell.
    quote = { sym: 'X', price: null, open: 1, high: 2, low: 0.5, volume: 10 }
    const { container: c2 } = render(<QuoteStrip sym="X" />)
    expect(c2.firstChild).toBeNull()
    quote = prev
  })
})
