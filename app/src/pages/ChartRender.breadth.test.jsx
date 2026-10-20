import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// `?breadth=1&bname=` makes this page paint a UCT breadth metric the way the
// app's ChartPane does: symbol + metric-name watermark, the single-ink line
// (`breadthLine`), a blank volume pane. Absent, nothing about a stock changes.

vi.mock('../components/StockChart', () => ({
  default: (props) => <canvas data-testid="stock-chart"
    data-breadth={JSON.stringify({ breadthLine: props.breadthLine ?? null, blankVolume: props.blankVolume ?? null,
      watermark: props.watermark ?? null, watermarkName: props.watermarkName ?? null })}
    data-override={JSON.stringify({ bars: props.barsOverride ?? null, pending: !!props.barsOverridePending })}
    data-bottom-margin={String(props.priceScaleBottomMargin ?? '')}
    data-price-format={props.priceFormat ? String(props.priceFormat.formatter(810197.4)) : ''}
    width={8} height={8} />,
}))

const BREADTH_BARS = [
  { t: '2026-10-15', o: 33.2, h: 33.2, l: 33.2, c: 33.2, v: 0 },
  { t: '2026-10-16', o: 31.4, h: 31.4, l: 31.4, c: 31.4, v: 0 },
]
const fetched = []
let doorBars = BREADTH_BARS
beforeEach(() => {
  fetched.length = 0
  doorBars = BREADTH_BARS
  vi.stubGlobal('fetch', vi.fn((url) => {
    fetched.push(String(url))
    const body = String(url).startsWith('/api/r/breadth-bars/') ? { ticker: 'UCTA50', tf: 'D', bars: doorBars } : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const { default: ChartRender } = await import('./ChartRender')

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const props = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-breadth'))

afterEach(() => cleanup())

describe('ChartRender ?breadth=', () => {
  it('paints a breadth metric like ChartPane does', () => {
    mount('sym=UCTA50&tf=D&breadth=1&bname=' + encodeURIComponent('% of Stocks Above 50-Day MA'))
    expect(props()).toEqual({ breadthLine: true, blankVolume: true, watermark: 'UCTA50', watermarkName: '% of Stocks Above 50-Day MA' })
  })

  it('changes nothing for a stock', () => {
    mount('sym=NVDA&tf=D')
    expect(props()).toEqual({ breadthLine: null, blankVolume: null, watermark: null, watermarkName: null })
  })

  // 2026-10-18: `/api/bars/UCTA50` is paid-gated and this page runs logged OUT, so
  // StockChart's own fetch drew nothing and every breadth /chart shipped the
  // mplfinance candle stand-in. The page reads the series through the render-token
  // door and hands it to the chart.
  const override = () => JSON.parse(screen.getByTestId('stock-chart').getAttribute('data-override'))

  it('feeds a breadth chart its bars from the render-token door', async () => {
    mount('sym=UCTA50&tf=D&token=tok&breadth=1&bname=x')
    expect(override().pending).toBe(true)          // no StockChart fetch while the door answers
    await waitFor(() => expect(override().bars).toEqual(BREADTH_BARS))
    expect(override().pending).toBe(false)
    const door = fetched.find((u) => u.startsWith('/api/r/breadth-bars/'))
    expect(door).toMatch(/^\/api\/r\/breadth-bars\/UCTA50\?/)
    expect(door).toContain('token=tok')
    expect(door).toContain('tf=D')
    // the header reads price and change off those bars, never the paid /api/bars
    expect(fetched.some((u) => u.startsWith('/api/bars/'))).toBe(false)
    await waitFor(() => expect(screen.getByText('31.40')).toBeTruthy())   // a percentage: no "$"
    expect(screen.getByText('-1.80')).toBeTruthy()                        // the move in POINTS leads
    expect(screen.getByText('(-5.42%)')).toBeTruthy()
  })

  it('reads the header on the "Earlier" day, not today', async () => {
    mount('sym=UCTA50&tf=D&token=tok&breadth=1&bname=x&to=2026-10-15')
    await waitFor(() => expect(screen.getByText('33.20')).toBeTruthy())   // the 10-15 close, not 10-16's 31.40
    expect(screen.queryByText('31.40')).toBeNull()
  })

  it('leaves a gap under a breadth line, and none under a stock', () => {
    mount('sym=UCTA50&tf=D&breadth=1&bname=x')
    expect(screen.getByTestId('stock-chart').getAttribute('data-bottom-margin')).toBe('0.08')
    cleanup()
    mount('sym=NVDA&tf=D')
    expect(screen.getByTestId('stock-chart').getAttribute('data-bottom-margin')).toBe('')
  })

  it('never calls the breadth door for a stock', async () => {
    mount('sym=NVDA&tf=D&token=tok')
    await waitFor(() => expect(fetched.length).toBeGreaterThan(0))   // control: the page did fetch
    expect(fetched.some((u) => u.startsWith('/api/r/breadth-bars/'))).toBe(false)
    expect(override()).toEqual({ bars: null, pending: false })
  })

  // 2026-10-19: the A/D line read "810197.00 -806.00" in the header and "825000.00" on
  // the axis. A count prints whole, with commas; a percentage keeps its decimals.
  const priceFormat = () => screen.getByTestId('stock-chart').getAttribute('data-price-format')

  it('prints a breadth COUNT as a whole number, header and axis', async () => {
    doorBars = [
      { t: '2026-10-15', o: 811003, h: 811003, l: 811003, c: 811003, v: 0 },
      { t: '2026-10-16', o: 810197, h: 810197, l: 810197, c: 810197, v: 0 },
    ]
    mount('sym=UCTAD&tf=D&token=tok&breadth=1&bname=x')
    await waitFor(() => expect(screen.getByText('810,197')).toBeTruthy())
    expect(screen.getByText('-806')).toBeTruthy()
    expect(screen.getByText('(-0.10%)')).toBeTruthy()                     // the percent keeps two places
    expect(priceFormat()).toBe('810,197')                                   // the axis: whole, with commas
  })

  // 2026-10-19: UCTNAMO -37.21 -> -29.98 printed "+7.23 (-19.43%)": a rise read as a fall.
  it('shows points alone, no percent, off a reading at or below zero', async () => {
    doorBars = [
      { t: '2026-10-15', o: -37.21, h: -37.21, l: -37.21, c: -37.21, v: 0 },
      { t: '2026-10-16', o: -29.98, h: -29.98, l: -29.98, c: -29.98, v: 0 },
    ]
    mount('sym=UCTNAMO&tf=D&token=tok&breadth=1&bname=x')
    await waitFor(() => expect(screen.getByText('-29.98')).toBeTruthy())
    expect(screen.getByText('+7.23')).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('keeps two decimals on a percentage metric and on a stock', async () => {
    mount('sym=UCTA50&tf=D&token=tok&breadth=1&bname=x')
    await waitFor(() => expect(screen.getByText('31.40')).toBeTruthy())    // control: the header did paint
    expect(priceFormat()).toBe('')
    cleanup()
    mount('sym=NVDA&tf=D')
    expect(priceFormat()).toBe('')
  })
})
