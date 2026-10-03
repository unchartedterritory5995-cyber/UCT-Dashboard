import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The exported-image look (owner 2026-10-02): every /r/chart render — the
// Substack letter and Discord /chart — draws hollow candles, volume in the
// candles' own green/red (the owner's saved blob says WHITE up-volume), a slim
// volume pane, and a price scale fitted to the candles so a far-away 200-day
// line cannot squash them. A per-render choice (?indicators=, ?preset=) still
// wins, and a parity capture (?fixedbars=) never sees any of it.

vi.mock('../components/StockChart', () => ({
  default: (props) => (
    <canvas
      data-testid="stock-chart"
      data-override={JSON.stringify(props.settingsOverride ?? null)}
      data-fit={String(!!props.fitPriceToCandles)}
      width={8}
      height={8}
    />
  ),
}))

const { default: ChartRender, RENDER_VOL_PANE_PCT } = await import('./ChartRender')
const { PRESETS } = await import('../components/chart/chartDefaults')

const OWNER = {
  chartType: 'candles',
  candles: { upColor: '#2faf68', downColor: '#df4646' },
  volume: { upColor: '#ffffff', downColor: '#df4646', paneHeightPct: 22 },
}

function mount(query) {
  return render(
    <MemoryRouter initialEntries={[`/r/chart?${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}
const chart = () => screen.getByTestId('stock-chart')
const override = () => JSON.parse(chart().getAttribute('data-override'))
function b64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/r/chart-settings')) {
      return Promise.resolve(new Response(JSON.stringify({ chart_settings: OWNER }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 503 }))
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function settled(query) {
  mount(query)
  await waitFor(() => expect(override()?.candles?.upColor).toBe(OWNER.candles.upColor))
  return override()
}

describe('ChartRender render house look', () => {
  it('draws hollow candles over the owner blob', async () => {
    const o = await settled('sym=NVDA&tf=D')
    expect(o.chartType).toBe('hollow')
  })

  it('paints volume in the candle colours, never the owner blob white', async () => {
    const o = await settled('sym=NVDA&tf=D')
    expect(o.volume.upColor).toBe(OWNER.candles.upColor)
    expect(o.volume.upColor).not.toBe('#ffffff')
    expect(o.volume.downColor).toBe(OWNER.candles.downColor)
  })

  it('slims the volume pane below the site default', async () => {
    const o = await settled('sym=NVDA&tf=D')
    expect(o.volume.paneHeightPct).toBe(RENDER_VOL_PANE_PCT)
    expect(RENDER_VOL_PANE_PCT).toBeLessThan(OWNER.volume.paneHeightPct)
  })

  it('fits the price scale to the candles', async () => {
    await settled('sym=NVDA&tf=D')
    expect(chart().getAttribute('data-fit')).toBe('true')
  })

  it('a per-render chart type still wins (Discord style picker)', async () => {
    const o = await settled(`sym=NVDA&tf=D&indicators=${b64url({ chartType: 'bars' })}`)
    expect(o.chartType).toBe('bars')
  })

  it('volume follows a preset that recolours the candles', async () => {
    mount('sym=NVDA&tf=D&preset=tradingview')
    const want = PRESETS.tradingview.settings
    await waitFor(() => expect(override()?.candles?.upColor).toBe(want.candles.upColor))
    const o = override()
    expect(o.volume.upColor).toBe((want.volume && want.volume.upColor) || want.candles.upColor)
  })

  it('a parity capture (?fixedbars=) gets none of it', () => {
    mount('sym=NVDA&tf=D&fixedbars=none_such')
    expect(override()).toBeNull()
    expect(chart().getAttribute('data-fit')).toBe('false')
  })
})
