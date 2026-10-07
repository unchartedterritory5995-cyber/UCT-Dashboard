/* Company Info's two states (ADDED via Add to Chart, EXPANDED via the panel's own
   chevron / edge rail), the narrow-widget fit rule, and the Earnings Strip's
   honest unavailable state. The tab contents are stubbed — this file is about
   the dock's presentation lifecycle, never what a tab shows. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect, useState } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('./DockProfile', () => ({ default: () => <div data-testid="tab-overview" /> }))
vi.mock('./DockFinancials', () => ({ default: () => <div data-testid="tab-financials" /> }))
vi.mock('./DockEarnings', () => ({ default: () => <div data-testid="tab-earnings" /> }))
vi.mock('./DockOwnership', () => ({ default: () => <div data-testid="tab-ownership" /> }))
vi.mock('./DockNews', () => ({ default: () => <div data-testid="tab-news" /> }))
vi.mock('./dockPrefetch', () => ({ prefetchPanel: () => {}, clearNewsPrefetch: () => {} }))

import ChartDetailDock from './ChartDetailDock'
import { normalizeDock, companyPanelFit, DEFAULT_RIGHT_W, MIN_RIGHT_W, MAX_RIGHT_FRAC, MIN_CHART_KEEP_W } from './chartDock'
import { addFeature, removeFeature, COMPANY_INFO } from './chartFeatures'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// A host that owns the dock the way ChartWidget does: normalize on read,
// updater-or-value on write. `seen` records every committed dock.
function Host({ initial, seen, sym = 'AAPL', driveRef }) {
  const [raw, setRaw] = useState(initial)
  const dock = normalizeDock(raw)
  const setDock = (u) => setRaw(prev => {
    const next = typeof u === 'function' ? u(normalizeDock(prev)) : u
    seen?.push(next)
    return next
  })
  useEffect(() => { if (driveRef) driveRef.current = { setDock } })
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChartDetailDock sym={sym} dock={dock} setDock={setDock}>
        <div data-testid="chart" />
      </ChartDetailDock>
    </SWRConfig>
  )
}

const panel = () => screen.queryByTestId('company-panel')
const rail = () => screen.queryByTestId('company-rail')

function stubFetch(byUrl) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const hit = Object.entries(byUrl).find(([k]) => String(url).includes(k))
    if (!hit) return { ok: false, status: 404, json: async () => null }
    const [, v] = hit
    if (v === 'fail') return { ok: false, status: 500, json: async () => null }
    if (v === 'reject') throw new Error('network')
    return { ok: true, status: 200, json: async () => v }
  })
}

describe('Company Info — added vs expanded', () => {
  it('removed (company=false, open=false): no panel, no rail', () => {
    render(<Host initial={{ company: false, open: false }} />)
    expect(panel()).toBeNull()
    expect(rail()).toBeNull()
  })

  it('an explicitly removed panel with a stale open flag stays removed', () => {
    render(<Host initial={{ company: false, open: true }} />)
    expect(panel()).toBeNull()
    expect(rail()).toBeNull()
  })

  it('a legacy open panel (no company key) migrates to added + expanded', () => {
    render(<Host initial={{ open: true }} />)
    expect(panel()).not.toBeNull()
    expect(rail()).toBeNull()
  })

  it('added + expanded: the full panel with its five tabs', () => {
    render(<Host initial={{ company: true, open: true }} />)
    expect(panel()).not.toBeNull()
    for (const t of ['Overview', 'Financials', 'Earnings', 'Ownership', 'News']) {
      expect(screen.getByRole('button', { name: t })).toBeTruthy()
    }
  })

  it('added + collapsed: the rail only', () => {
    render(<Host initial={{ company: true, open: false }} />)
    expect(panel()).toBeNull()
    expect(rail()).not.toBeNull()
    expect(rail().getAttribute('title')).toBe('Show company info')
  })

  it('the chevron collapses to the rail, the rail expands — company stays added', () => {
    const seen = []
    render(<Host initial={{ company: true, open: true, rightW: 520 }} seen={seen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse company info' }))
    expect(panel()).toBeNull()
    expect(rail()).not.toBeNull()
    expect(seen.at(-1)).toMatchObject({ company: true, open: false, rightW: 520 })

    fireEvent.click(rail())
    expect(panel()).not.toBeNull()
    expect(seen.at(-1)).toMatchObject({ company: true, open: true, rightW: 520 })
    // The width the member chose is the width it comes back at.
    expect(panel().style.width).toBe('520px')
  })

  it('a NEW add after a remove lands at the default width', () => {
    const driveRef = { current: null }
    render(<Host initial={{ company: true, open: true, rightW: 520 }} driveRef={driveRef} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse company info' }))
    driveRef.current.setDock(d => removeFeature(d, COMPANY_INFO))
    return waitFor(() => expect(rail()).toBeNull()).then(() => {
      driveRef.current.setDock(d => addFeature(d, COMPANY_INFO))
      return waitFor(() => expect(panel()?.style.width).toBe(`${DEFAULT_RIGHT_W}px`))
    })
  })

  it('advertises no Ctrl+K shortcut (the global palette owns that chord)', () => {
    render(<Host initial={{ company: true, open: true }} />)
    const search = screen.getByRole('button', { name: 'Search company information' })
    expect(search.getAttribute('title')).not.toMatch(/ctrl|⌘|\+k/i)
    // ...and pressing it does not open the panel's search either.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByLabelText('Search company information', { selector: 'input' })).toBeNull()
  })
})

describe('Company Info — narrow-widget fit rule', () => {
  it('is pure: caps at MAX_RIGHT_FRAC and at the chart floor, rails below the panel floor, assumes fit when unmeasured', () => {
    expect(companyPanelFit(400, null)).toEqual({ fits: true, width: 400 })
    expect(companyPanelFit(400, 2000)).toEqual({ fits: true, width: 400 })
    // 1000px: 62% = 620, chart floor leaves 700 → the member's 400 stands.
    expect(companyPanelFit(400, 1000)).toEqual({ fits: true, width: 400 })
    // 700px: 62% = 434 but the chart must keep 300 → 400.
    expect(companyPanelFit(520, 700)).toEqual({ fits: true, width: 700 - MIN_CHART_KEEP_W - 1 })
    // The narrowest widget that shows the panel at all: both sides at their floor.
    const floorW = MIN_RIGHT_W + MIN_CHART_KEEP_W + 1   // + the panel's 1px divider
    expect(companyPanelFit(400, floorW)).toEqual({ fits: true, width: MIN_RIGHT_W })
    expect(companyPanelFit(400, floorW - 1).fits).toBe(false)
  })

  it('the chart always keeps the larger of its share and its floor', () => {
    for (const w of [601, 640, 700, 800, 1200, 1920]) {
      const f = companyPanelFit(1000, w)
      expect(f.fits).toBe(true)
      expect(w - f.width - 1).toBeGreaterThanOrEqual(Math.max(MIN_CHART_KEEP_W, Math.floor(w * (1 - MAX_RIGHT_FRAC)) - 1))
    }
  })

  it('a too-narrow widget shows the rail, writes nothing, and recovers when widened', () => {
    let width = 420
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return { width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0 }
    })
    const seen = []
    render(<Host initial={{ company: true, open: true, rightW: 400 }} seen={seen} />)
    expect(panel()).toBeNull()
    expect(rail()).not.toBeNull()
    expect(rail().disabled).toBe(true)
    expect(rail().getAttribute('title')).toBe('Widen this chart to show company info')
    expect(seen).toEqual([])                      // company/open untouched

    width = 1400
    // A remount re-measures (jsdom has no live ResizeObserver).
    cleanup()
    render(<Host initial={{ company: true, open: true, rightW: 400 }} seen={seen} />)
    expect(panel()).not.toBeNull()
    expect(panel().style.width).toBe('400px')
    expect(seen).toEqual([])
  })
})

describe('Earnings Strip — presence and honest states', () => {
  it('renders below the chart only when added', () => {
    stubFetch({})
    const { unmount } = render(<Host initial={{ strip: false }} />)
    expect(screen.queryByTitle('Drag to resize the earnings strip')).toBeNull()
    unmount()
    render(<Host initial={{ strip: true }} />)
    expect(screen.getByTitle('Drag to resize the earnings strip')).toBeTruthy()
  })

  it('a failed request says unavailable instead of loading forever, and stays added', async () => {
    stubFetch({ '/api/earnings-intel/SPY': 'fail' })
    const seen = []
    render(<Host initial={{ strip: true }} sym="SPY" seen={seen} />)
    expect(await screen.findByText('Earnings data is unavailable for SPY.')).toBeTruthy()
    expect(seen).toEqual([])
  })

  it('a network error reads the same', async () => {
    stubFetch({ '/api/earnings-intel/$IDX': 'reject' })
    render(<Host initial={{ strip: true }} sym="$IDX:ai" />)
    expect(await screen.findByText('Earnings data is unavailable for $IDX:ai.')).toBeTruthy()
  })

  it('a symbol with no reports says so', async () => {
    stubFetch({ '/api/earnings-intel/QQQ': { quarters: [] } })
    render(<Host initial={{ strip: true }} sym="QQQ" />)
    expect(await screen.findByText('No quarterly earnings for QQQ.')).toBeTruthy()
  })
})
