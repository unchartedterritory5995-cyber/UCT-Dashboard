// app/src/components/chart/ChartSettingsIndicators.economic.test.jsx
//
// ─── THE ECONOMIC TAB, THROUGH THE MEMBER'S REAL DOOR ───────────────────────
//
// ⭐ ChartSettingsModal → Indicators → ＋ Add Indicator (ChartSettingsIndicators),
// never the library dialog: the lesson of presentation-semantics was that a
// harness driving a surface the member does not use cannot accept a feature.
// ⭐ BROWSE **AND** SEARCH, both — the browse-add lesson (20k tests all typed).
// ⛔ DARK BY CONSTRUCTION: catalogue 404 / 401 / 403 -> five tabs, no econ row,
// nothing new anywhere; the Add surface behaves exactly as before.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { parseSource } from './engine/sourceRef'
import { _resetEconomicForTests } from './engine/economicSeries'
import { CATALOG } from './economic/__fixtures__/econCatalog'

let calls = []
function stubFetch(catalogStatus) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/econ/catalog')) {
      return catalogStatus === 200
        ? { ok: true, status: 200, json: async () => CATALOG }
        : { ok: false, status: catalogStatus, json: async () => ({}) }
    }
    if (u.startsWith('/api/ticker-search')) return { ok: true, status: 200, json: async () => ({ results: [] }) }
    if (u.startsWith('/api/breadth-symbols')) return { ok: true, status: 200, json: async () => ({ symbols: [] }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
}

function Host({ initial, onWrite }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { onWrite(next); setCs(next) }}
      onClose={() => {}}
    />
  )
}
const fresh = () => mergeChartSettings(JSON.stringify({}))
const show = (seen) => render(<Host initial={fresh()} onWrite={(next) => { seen.cs = next; seen.writes = (seen.writes || 0) + 1 }} />)
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const openAdd = () => {
  if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
}
const tabKeys = () => [...document.body.querySelectorAll('[role="tab"][data-tab]')].map((b) => b.dataset.tab)
const rows = () => screen.queryAllByRole('option')
const econRows = () => rows().filter((o) => o.dataset.resultKind === 'economic')
const live = (cs) => (Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []).filter((i) => i && !i.deleted && !i.removed)

beforeEach(() => { _resetEconomicForTests() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe.each([404, 401, 403])('catalogue %i — the Add surface is exactly what it was', (status) => {
  it('five tabs, no economic row in browse or search', async () => {
    stubFetch(status)
    show({}); openIndicators(); openAdd()
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/econ/catalog'))).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(tabKeys()).toEqual(['technical', 'fundamentals', 'breadth', 'symbols', 'positioning'])
    expect(econRows()).toHaveLength(0)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CPI' } })
    await new Promise((r) => setTimeout(r, 50))
    expect(econRows()).toHaveLength(0)
  })
})

describe('catalogue 200 — the sixth tab', () => {
  it('Economic tab appears after Positioning', async () => {
    stubFetch(200)
    show({}); openIndicators(); openAdd()
    await waitFor(() => expect(tabKeys()).toEqual(['technical', 'fundamentals', 'breadth', 'symbols', 'positioning', 'economic']))
  })

  it('BROWSE: click the tab, click a row -> one dataSeries over econ:USFEDFUNDSU, step, own pane', async () => {
    stubFetch(200)
    const seen = {}
    show(seen); openIndicators(); openAdd()
    await waitFor(() => expect(tabKeys()).toContain('economic'))
    fireEvent.click(document.body.querySelector('[role="tab"][data-tab="economic"]'))
    await waitFor(() => expect(econRows().length).toBe(CATALOG.series.length))
    // each economic row carries its agency · frequency · units line
    const ff = econRows().find((o) => o.dataset.resultKey === 'economic:USFEDFUNDSU')
    expect(ff.querySelector('[data-testid="econ-row-sub"]').textContent).toBe('NY Fed · Daily · Percent')
    const before = live(fresh()).length
    fireEvent.click(ff)
    await waitFor(() => expect(seen.cs).toBeTruthy())
    const added = live(seen.cs).slice(before)
    expect(added).toHaveLength(1)
    expect(added[0].defId).toBe('dataSeries')
    expect(added[0].inputs.source).toBe('econ:USFEDFUNDSU')
    expect(parseSource(added[0].inputs.source).kind).toBe('economic')   // never a candle-capable symbol
    expect(added[0].presentation).toEqual({ plotStyle: 'step' })       // registry style, not the 'area' family default
    expect(added[0].placement && added[0].placement.target).not.toBe('price')
  })

  it('SEARCH: type "inflation" (a synonym) -> the CPI row; click creates econ:USCPI', async () => {
    stubFetch(200)
    const seen = {}
    show(seen); openIndicators(); openAdd()
    await waitFor(() => expect(tabKeys()).toContain('economic'))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'inflation' } })
    await waitFor(() => expect(econRows().map((o) => o.dataset.resultKey)).toContain('economic:USCPI'))
    fireEvent.click(econRows().find((o) => o.dataset.resultKey === 'economic:USCPI'))
    await waitFor(() => expect(seen.cs).toBeTruthy())
    const inst = live(seen.cs).find((i) => i.inputs && i.inputs.source === 'econ:USCPI')
    expect(inst).toBeTruthy()
    expect(inst.presentation).toEqual({ plotStyle: 'line' })
  })

  it('SEARCH: "10-year treasury" finds UST10Y; "gdp growth" finds the histogram series', async () => {
    stubFetch(200)
    show({}); openIndicators(); openAdd()
    await waitFor(() => expect(tabKeys()).toContain('economic'))
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: '10-year treasury' } })
    await waitFor(() => expect(econRows().map((o) => o.dataset.resultKey)).toContain('economic:UST10Y'))
    fireEvent.change(box, { target: { value: 'gdp growth' } })
    await waitFor(() => expect(econRows().map((o) => o.dataset.resultKey)).toContain('economic:USRGDPQA'))
  })
})
