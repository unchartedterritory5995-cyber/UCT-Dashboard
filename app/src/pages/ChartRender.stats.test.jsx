import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?stats=` is a Discord-/chart-only strip under the branded header. Two
// things are pinned: (1) with the param the numbers land in the export node
// and the chart gives up exactly STATS_STRIP_H of height for them; (2) without
// the param NOTHING changes — that is what keeps the Sunday Scans / Substack
// renderer out of the blast radius.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart" data-height={props.height}
                              data-brand={String(props.showBrandMark)} width={8} height={8} />,
}))

const { default: ChartRender, STATS_STRIP_H } = await import('./ChartRender')

function b64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('ChartRender ?stats=', () => {
  it('renders the strip from the payload and shortens the chart by STATS_STRIP_H', () => {
    const stats = { open: 210.12, high: 214.3, low: 209.8, close: 212.98, day_pct: 2.19, gap_pct: -0.4,
      hi_52w: 240.1, lo_52w: 168.4, from_52w_high_pct: -11.3, volume: 182400000, avg_vol_50: 201100000,
      rvol: 1.62, dollar_vol: 38900000000, adr_pct: 3.41 }
    mount(`sym=NVDA&tf=D&h=698&stats=${b64url(stats)}`)
    const strip = screen.getByTestId('stats-strip')
    const text = strip.textContent
    expect(text).toContain('212.98')
    expect(text).toContain('+2.2%')
    expect(text).toContain('-0.4%')
    expect(text).toContain('240.10 (-11.3%)')
    expect(text).toContain('182.4M')
    expect(text).toContain('1.62x')
    expect(text).toContain('38.9B')
    expect(text).toContain('3.4%')
    expect(screen.getByTestId('stock-chart').getAttribute('data-height')).toBe(`${698 - 60 - STATS_STRIP_H}px`)
  })

  it('labels a WEEKLY strip as the week: "Wk" and the 10-week average, never "Day"', () => {
    // compute_stats(daily, "W") fills the same keys with the WEEK's numbers and says so.
    const stats = { period: 'W', avg_bars: 10, open: 727.89, high: 748.35, low: 727.81, close: 744.5,
      day_pct: 3.19, gap_pct: 0.1, hi_52w: 748.65, lo_52w: 555.6, from_52w_high_pct: -0.6,
      volume: 179363392, avg_vol: 181000000, avg_vol_50: null, rvol: 0.99, dollar_vol: 133500000000, adr_pct: 1.0 }
    mount(`sym=QQQ&tf=W&h=698&stats=${b64url(stats)}`)
    const text = screen.getByTestId('stats-strip').textContent
    expect(text).toContain('Wk')
    expect(text).not.toContain('Day')
    expect(text).toContain('Avg10w')
    expect(text).toContain('181.0M')
    expect(text).toContain('+3.2%')
  })

  it('keeps "Day" and "Avg50" for a strip that names no period (every daily/intraday render)', () => {
    mount(`sym=NVDA&tf=D&h=698&stats=${b64url({ close: 5, day_pct: 1, avg_vol_50: 2000000 })}`)
    const text = screen.getByTestId('stats-strip').textContent
    expect(text).toContain('Day')
    expect(text).toContain('Avg50')
    expect(text).toContain('2.0M')
  })

  it('turns off the chart\'s own bottom-left brand mark (the header carries it)', () => {
    mount('sym=NVDA&tf=W&h=670')
    expect(screen.getByTestId('stock-chart').getAttribute('data-brand')).toBe('false')
  })

  it('prints an em dash for a missing value instead of dropping the cell', () => {
    mount(`sym=NVDA&tf=D&h=698&stats=${b64url({ close: 5, rvol: null })}`)
    const text = screen.getByTestId('stats-strip').textContent
    expect(text).toContain('—')
    expect(text).toContain('5.00')
  })

  it('renders nothing extra without the param, and ignores a malformed one', () => {
    mount('sym=NVDA&tf=D&h=670')
    expect(screen.queryByTestId('stats-strip')).toBeNull()
    expect(screen.getByTestId('stock-chart').getAttribute('data-height')).toBe('610px')
    cleanup()
    mount('sym=NVDA&tf=D&h=670&stats=%%%not-b64')
    expect(screen.queryByTestId('stats-strip')).toBeNull()
    expect(screen.getByTestId('stock-chart').getAttribute('data-height')).toBe('610px')
  })
})
