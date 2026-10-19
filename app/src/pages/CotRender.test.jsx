// The Discord /cot render page: the real CotData page in its render mode.
//
// What it must do, and why each line here exists:
//  - read ONLY through the token-gated /api/r/cot doors. The renderer is logged out,
//    and every /api/cot/* read (and /api/bars for most proxies) answers 401/402 there;
//    one stray paid fetch is a blank or half-drawn image.
//  - draw with animation OFF, or the screenshot catches bars mid-grow.
//  - say when it is done (window.__cotReady), and say 'error' rather than hang.
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-chartjs-2', () => ({
  Chart: ({ type, data, options }) => (
    <div data-testid="chart" data-type={type} data-points={data?.labels?.length ?? 0}
      data-anim={options?.animation === false ? 'off' : 'on'} />
  ),
}))
vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false, useIsPhone: () => false }))

import CotRender, { COT_EXPORT_W } from './CotRender'

function mkRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2016, 0, 5 + i * 7)).toISOString().slice(0, 10),
    commercial_net: -100_000 + i * 100, large_spec_net: 50_000 - i * 50,
    small_spec_net: 10_000, open_interest: 1_500_000 + i * 500,
  }))
}
function mkBars(n) {
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(Date.UTC(2016, 0, 8 + i * 7)).toISOString().slice(0, 10),
    o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i * 0.5, v: 1000,
  }))
}

const READ = 'Commercials are pressing their short as price climbs.'
const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

function routeFetch(url, { rows = mkRows(520) } = {}) {
  if (url.startsWith('/api/r/cot-symbols')) return ok({ groups: { INDICES: [{ symbol: 'ES', name: 'S&P 500 E-Mini' }] } })
  if (/^\/api\/r\/cot\/[A-Z0-9]+\/price/.test(url)) return ok({ ticker: 'SPY', bars: mkBars(600) })
  if (/^\/api\/r\/cot\/[A-Z0-9]+\/narrative/.test(url)) return ok({ status: 'ok', text: READ })
  if (/^\/api\/r\/cot\/[A-Z0-9]+\?/.test(url)) {
    return rows ? ok(rows) : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  }
  return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
}

function mount(qs) {
  return render(
    <MemoryRouter initialEntries={[`/r/cot?${qs}`]}>
      <Routes><Route path="/r/cot" element={<CotRender />} /></Routes>
    </MemoryRouter>,
  )
}

describe('/r/cot — the Discord /cot render page', () => {
  let fetchMock
  beforeEach(() => {
    delete window.__cotReady
    fetchMock = vi.fn((url) => routeFetch(String(url)))
    globalThis.fetch = fetchMock
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('draws the whole page through the token doors only, unanimated, and says when it is done', async () => {
    const { container } = mount('symbol=ES&token=tkn')
    await waitFor(() => expect(window.__cotReady).toBe(true), { timeout: 4000 })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((u) => !u.startsWith('/api/r/'))).toEqual([])
    expect(urls).toContain('/api/r/cot/ES?weeks=520&token=tkn')
    expect(urls).toContain('/api/r/cot/ES/price?token=tkn')
    expect(urls.some((u) => u.startsWith('/api/r/cot/ES/narrative?report_date=') && u.endsWith('&token=tkn'))).toBe(true)

    const charts = screen.getAllByTestId('chart')
    expect(charts).toHaveLength(5)                                  // price + 3 groups + open interest
    expect(charts.map((c) => c.dataset.anim)).toEqual(['off', 'off', 'off', 'off', 'off'])
    expect(charts[0].dataset.points).toBe('52')                     // 1Y by default

    expect(screen.getByText(READ)).toBeInTheDocument()              // the written read is in the image
    expect(screen.queryByText('2Y')).toBeNull()                     // no lookback buttons
    expect(screen.queryByText(/Save/)).toBeNull()                   // no save-to-notebook button

    const box = container.querySelector('#cot-export')
    expect(box.style.width).toBe(`${COT_EXPORT_W}px`)
    expect(window.__cotBoardW).toBe(COT_EXPORT_W)
  })

  it('honours the lookback', async () => {
    mount('symbol=ES&lookback=2y&token=tkn')
    await waitFor(() => expect(window.__cotReady).toBe(true), { timeout: 4000 })
    expect(screen.getAllByTestId('chart')[0].dataset.points).toBe('104')
  })

  it("answers 'error' instead of hanging when the market has no data", async () => {
    fetchMock = vi.fn((url) => routeFetch(String(url), { rows: null }))
    globalThis.fetch = fetchMock
    mount('symbol=ES&token=tkn')
    await waitFor(() => expect(window.__cotReady).toBe('error'), { timeout: 4000 })
  })

  it("answers 'error' for a malformed symbol without fetching anything", async () => {
    mount('symbol=ES%3Bdrop&token=tkn')
    await waitFor(() => expect(window.__cotReady).toBe('error'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
