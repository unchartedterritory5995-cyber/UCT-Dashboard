// Owner rulings 2026-09-29 for the market-internals letter panel (/r/internals):
//   - ?spy=&qqq=&label= override the SPY/QQQ prints with the letter's own
//     (pre-market) numbers, with a small label; absent = unchanged (control);
//   - a zero exposure-rating change shows NO arrow ("100 ↑0" in the letter).
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import InternalsRender, { parsePriceOverride } from '../InternalsRender'
import MarketBreadth from '../../components/tiles/MarketBreadth'

const BREADTH = {
  exposure: { score: 100, score_delta: 0, note: '', bonus: 0 },
  ma_data: {
    spy: { price: 760.1, ema9_pct: 0.8, ema20_pct: 1.9, sma50_pct: 4.2, sma200_pct: 11.3 },
    qqq: { price: 730.2, ema9_pct: 1.1, ema20_pct: 2.4, sma50_pct: 5.0, sma200_pct: 14.8 },
  },
}
const SNAPSHOT = {
  etfs: {
    SPY: { price: '765.61', chg: '+0.42%', css: 'pos' },
    QQQ: { price: '736.53', chg: '+0.61%', css: 'pos' },
  },
}

function mockApi(breadth = BREADTH) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const body = u.startsWith('/api/r/breadth') ? breadth
      : u.startsWith('/api/snapshot') ? SNAPSHOT
        : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }))
}

const renderAt = (qs) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={[`/r/internals?variant=exposure&w=728${qs}`]}>
      <InternalsRender />
    </MemoryRouter>
  </SWRConfig>)

beforeEach(() => mockApi())
afterEach(() => vi.unstubAllGlobals())

describe('parsePriceOverride', () => {
  const sp = (s) => new URLSearchParams(s)
  it('absent = null (the old behaviour)', () => {
    expect(parsePriceOverride(sp(''))).toBeNull()
    expect(parsePriceOverride(sp('label=pre-market'))).toBeNull()
    expect(parsePriceOverride(sp('spy=abc&qqq=-3'))).toBeNull()
  })
  it('reads prices, defaults the label to pre-market, sanitises and caps it', () => {
    expect(parsePriceOverride(sp('spy=765.30&qqq=739.28'))).toEqual({
      SPY: { price: 765.3, label: 'pre-market' }, QQQ: { price: 739.28, label: 'pre-market' },
    })
    expect(parsePriceOverride(sp('qqq=739.28&label=<b>as of 8:45</b>'))).toEqual({
      QQQ: { price: 739.28, label: 'bas of 8:45/b' },
    })
    expect(parsePriceOverride(sp(`spy=1&label=${'x'.repeat(60)}`)).SPY.label).toHaveLength(24)
  })
})

describe('InternalsRender', () => {
  it('shows the override prices with a pre-market label, not the live snapshot', async () => {
    renderAt('&spy=765.30&qqq=739.28&label=pre-market')
    expect(await screen.findByText('$765.30')).toBeInTheDocument()
    expect(screen.getByText('$739.28')).toBeInTheDocument()
    expect(screen.getByTestId('price-label-SPY')).toHaveTextContent('pre-market')
    expect(screen.getByTestId('price-label-QQQ')).toHaveTextContent('pre-market')
    // give the snapshot fetch a chance to land; it must not replace the override
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/snapshot'))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByText('$765.61')).not.toBeInTheDocument()
    expect(screen.queryByText(/\+0\.42%/)).not.toBeInTheDocument()
  })

  it('CONTROL: without params the live snapshot price and change show, no label', async () => {
    renderAt('')
    expect(await screen.findByText('$765.61')).toBeInTheDocument()
    expect(screen.getByText('$736.53')).toBeInTheDocument()
    expect(screen.queryByTestId('price-label-SPY')).not.toBeInTheDocument()
  })

  it('a zero rating change shows no arrow', async () => {
    renderAt('')
    await screen.findByText('100')
    expect(document.body.textContent).not.toMatch(/[↑↓]0\b/)
    expect(document.body.textContent).not.toMatch(/↑/)
  })
})

describe('MarketBreadth delta (shared with the Dashboard tile)', () => {
  const tile = (delta) => render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MarketBreadth data={{ exposure: { score: 78, score_delta: delta, bonus: 0 }, ma_data: null }} />
    </SWRConfig>)
  it('CONTROL: a real move keeps its arrow', () => {
    tile(5)
    expect(screen.getByText('↑5')).toBeInTheDocument()
  })
  it('a negative move keeps its arrow', () => {
    tile(-3)
    expect(screen.getByText('↓3')).toBeInTheDocument()
  })
  it('zero renders no delta at all', () => {
    tile(0)
    expect(document.body.textContent).not.toMatch(/[↑↓]/)
  })
})
