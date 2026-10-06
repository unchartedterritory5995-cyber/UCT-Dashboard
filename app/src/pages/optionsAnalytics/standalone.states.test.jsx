// The terminal's standalone options panels (IVH, VOL, POS, OHIS, TIDE, STRS): while every read is
// in flight the panel says it is loading, and when every read answers the paid gate it says so,
// instead of a titled box with an empty body (quality pass 2026-10-05). Embedded, nothing changes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import IvHistoryPanel from '../research/tabs/IvHistoryPanel'
import { VolStatsPanel } from './VolPanels'
import PositioningPanel from './PositioningPanel'
import OptionsHistoryPanel from './OptionsHistoryPanel'
import MarketTidePanel from './MarketTidePanel'
import StrategyScreensPanel from './StrategyScreensPanel'

const wrap = (el) => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig></MemoryRouter>)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const PANELS = [
  ['IVH', (p) => <IvHistoryPanel sym="tst" {...p} />],
  ['VOL', (p) => <VolStatsPanel sym="tst" {...p} />],
  ['POS', (p) => <PositioningPanel sym="tst" {...p} />],
  ['OHIS', (p) => <OptionsHistoryPanel sym="tst" {...p} />],
  ['TIDE', (p) => <MarketTidePanel {...p} />],
  ['STRS', (p) => <StrategyScreensPanel {...p} />],
]

describe('standalone options panels', () => {
  it.each(PANELS)('%s says it is loading while every read is in flight', (_c, el) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    wrap(el({ offNotice: true }))
    expect(screen.getByTestId('feature-loading').textContent).toMatch(/^Loading /)
  })

  it.each(PANELS)('%s embedded shows no loading line', (_c, el) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    wrap(el({}))
    expect(screen.queryByTestId('feature-loading')).toBeNull()
  })

  it.each(PANELS)('%s says the paid plan when every read is 402', async (_c, el) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 402, ok: false, json: async () => ({}) })))
    wrap(el({ offNotice: true }))
    expect((await screen.findByTestId('feature-paywalled')).textContent).toMatch(/requires? a paid plan/)
  })
})
