// ⭐ (2026-11-22) A Compare symbol on a CUSTOM timeframe is built the way the chart builds its own custom series.
// ⚰️ `/api/bars/SPY?tf=240` answers `bars: []` (the route serves native timeframes only); `useCompareBars` asked it for
// the custom code, so a Compare overlay on a 2h / 4h / 45m / 2D chart drew nothing.
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { createElement } from 'react'
import { compareBarsRequest, useCompareBars } from './useLegacyChartBars'
import { customBaseBarsOf, resampleSpec } from './timeframes'
import { resampleForSpec } from '../../utils/resampleBars'

const at = (day, h, m) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + (h + 5) * 3600 + m * 60
const hourly = ['2026-11-19', '2026-11-20'].flatMap((d) => [0, 1, 2, 3, 4, 5, 6].map((k) => {
  const p = 600 + k
  return { t: at(d, 9 + k, 30), o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 1 }
}))

describe('what the Compare overlay asks for', () => {
  it('a native timeframe: its own code, the chart’s depth and grid query, exactly as before', () => {
    expect(compareBarsRequest('spy', '60', 900, '&session=rth')).toEqual({ url: '/api/bars/SPY?tf=60&bars=900&session=rth', spec: null })
    expect(compareBarsRequest('spy', 'D', 900).url).toBe('/api/bars/SPY?tf=D&bars=900')
  })

  it.each([['240', '60'], ['120', '60'], ['45', '15'], ['2D', 'D'], ['3M', 'M']])(
    '%s: the native base %s at the chart’s own custom depth, never the custom code', (tf, base) => {
      const r = compareBarsRequest('spy', tf, 900, '&session=rth')
      expect(r.url).toBe(`/api/bars/SPY?tf=${base}&bars=${customBaseBarsOf(base)}`)
      expect(r.url).not.toContain(`tf=${tf}&`)
      expect(r.spec).toEqual(resampleSpec(tf))
    })

  it('no symbol, no request', () => {
    expect(compareBarsRequest('', '240', 900)).toEqual({ url: null, spec: null })
  })
})

describe('the overlay’s rows on a custom timeframe', () => {
  const wrap = ({ children }) => createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)

  it('are the base rows resampled by the chart’s rule (one object per payload)', async () => {
    const asked = []
    const instFetcher = (url) => { asked.push(url); return Promise.resolve({ ticker: 'SPY', bars: hourly }) }
    const { result, rerender } = renderHook(
      () => useCompareBars({ compareSymbol: 'SPY', resolvedTf: '240', barCount: 900, _gridQ: '', instFetcher }),
      { wrapper: wrap },
    )
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(asked).toEqual(['/api/bars/SPY?tf=60&bars=5000'])
    expect(result.current.bars).toEqual(resampleForSpec(hourly, resampleSpec('240')))
    expect(result.current.bars.map((b) => b.t)).toEqual([at('2026-11-19', 9, 30), at('2026-11-19', 13, 30), at('2026-11-20', 9, 30), at('2026-11-20', 13, 30)])
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('a native timeframe hands back the payload itself', async () => {
    const payload = { ticker: 'SPY', bars: hourly }
    const instFetcher = () => Promise.resolve(payload)
    const { result } = renderHook(
      () => useCompareBars({ compareSymbol: 'SPY', resolvedTf: '60', barCount: 900, _gridQ: '', instFetcher }),
      { wrapper: wrap },
    )
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current).toBe(payload)
  })
})
