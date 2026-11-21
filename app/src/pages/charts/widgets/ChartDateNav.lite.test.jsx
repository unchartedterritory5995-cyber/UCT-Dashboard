// The date navigator polls the chart 4×/s for the life of the page. It asks for the light read-back (its five
// fields), never the UCT Agent's full one (default view geometry, zoom limits, price scale, replay) — that ran on
// every poll of every chart on the board (production profile, 2026-11-20).
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import ChartDateNav from './ChartDateNav'

describe('ChartDateNav · the poll asks for the light read-back', () => {
  it('every poll passes { lite: true }', async () => {
    vi.useFakeTimers()
    try {
      const getDateMeta = vi.fn(() => ({ rightMs: Date.UTC(2026, 10, 13), firstMs: Date.UTC(2010, 0, 4), lastMs: Date.UTC(2026, 10, 13), firstYear: 2010, lastYear: 2026, fullyLoaded: true, loading: false }))
      render(<ChartDateNav paneRef={{ current: { getDateMeta, goToDate: vi.fn(), goToYear: vi.fn(), stepBar: vi.fn(), ensureFullHistory: vi.fn() } }} />)
      vi.advanceTimersByTime(1000)
      expect(getDateMeta.mock.calls.length).toBeGreaterThanOrEqual(4)
      for (const args of getDateMeta.mock.calls) expect(args).toEqual([{ lite: true }])
    } finally { vi.useRealTimers() }
  })
})
