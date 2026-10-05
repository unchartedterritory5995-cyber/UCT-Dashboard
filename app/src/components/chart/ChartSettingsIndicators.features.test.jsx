/* HOST FEATURES IN INDICATORS — the Earnings Strip and Company Info, offered by
   a /charts ChartWidget, discovered and managed through Add to Chart.
   ⛔ The contract under test is that they share the DISCOVERY and MANAGEMENT
   surface and nothing else: their writes go to the host's dock, never to chart
   settings, and they never enter a pane group. */
import { useMemo, useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { normalizeDock } from '../../pages/charts/widgets/chartDock'
import {
  chartFeaturesOf, addFeature, removeFeature, setFeatureOpen, EARNINGS_STRIP, COMPANY_INFO,
} from '../../pages/charts/widgets/chartFeatures'
import {
  featureResults, libraryTabsFor, LIBRARY_TABS, RESEARCH_TAB, ECONOMIC_TAB, tabOf, resultsForTab,
  liveDiscoveryRows, fundamentalResults,
} from './discoveryCatalog'
import { matches } from './IndicatorLibraryDialog'

afterEach(() => { cleanup() })

/* A host shaped like ChartWidget: chart settings in one state, the dock in
   another, and `chartFeatures` derived from the dock. `seen` records every
   chart-settings write so a test can prove a feature never made one. */
function Host({ dock: initialDock = {}, seen, scrollTo = null, withFeatures = true, onDock }) {
  const [cs, setCs] = useState(() => mergeChartSettings({}))
  const [dock, setDockRaw] = useState(() => normalizeDock(initialDock))
  const setDock = (fn) => setDockRaw((d) => { const n = fn(d); onDock?.(n); return n })
  const chartFeatures = useMemo(() => ({
    items: chartFeaturesOf(dock),
    add: (id) => setDock((d) => addFeature(d, id)),
    remove: (id) => setDock((d) => removeFeature(d, id)),
    setOpen: (id, open) => setDock((d) => setFeatureOpen(d, id, open)),
  }), [dock]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ChartSettingsModal
      open settings={cs} scrollTo={scrollTo}
      onChange={(next) => { seen?.push(next); setCs(next) }}
      onClose={() => {}}
      chartFeatures={withFeatures ? chartFeatures : null}
    />
  )
}

const openTab = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const catTabs = () => within(screen.getByRole('tablist', { name: 'Indicator categories' }))
  .getAllByRole('tab').map((t) => t.textContent.trim())
const result = (key) => document.body.querySelector(`[data-result-key="${key}"]`)
const searchBox = () => screen.getByPlaceholderText(/Search indicators/i)
const featureRow = (id) => document.body.querySelector(`[data-feature-row="${id}"]`)
const featureGroups = () => [...document.body.querySelectorAll('[data-feature-group]')]
  .map((g) => g.querySelector('[class*="insGroupHead"]').textContent.trim())
const inspector = () => document.body.querySelector('[data-inspector-for]')

describe('discovery catalog — the Research tab and its rows (pure)', () => {
  it('Research exists only when a host passes features; otherwise the arrays are unchanged BY IDENTITY', () => {
    expect(libraryTabsFor()).toBe(LIBRARY_TABS)
    expect(libraryTabsFor({ economic: false, research: false })).toBe(LIBRARY_TABS)
    expect(libraryTabsFor({ research: true }).map((t) => t.key)).toEqual([...LIBRARY_TABS.map((t) => t.key), 'research'])
    expect(libraryTabsFor({ economic: true, research: true }).slice(-2)).toEqual([ECONOMIC_TAB, RESEARCH_TAB])
    expect(RESEARCH_TAB.label).toBe('Research')
  })

  it('feature rows file under Research, are singletons, and carry no create descriptor', () => {
    const rows = featureResults(chartFeaturesOf(normalizeDock({})))
    expect(rows.map((r) => r.name)).toEqual(['Earnings Strip', 'Company Info'])
    for (const r of rows) {
      expect(tabOf(r)).toBe('research')
      expect(r.singleton).toBe(true)
      expect(r.create).toBeUndefined()
    }
    expect(resultsForTab(rows, 'research')).toHaveLength(2)
    expect(resultsForTab(rows, 'technical')).toHaveLength(0)
  })

  it('the catalogue’s own `matches` finds them — `earnings` and `company` with no special case', () => {
    const rows = featureResults(chartFeaturesOf(normalizeDock({})))
    expect(liveDiscoveryRows('earnings', [], rows, matches).map((r) => r.id)).toEqual([EARNINGS_STRIP])
    expect(liveDiscoveryRows('company', [], rows, matches).map((r) => r.id)).toEqual([COMPANY_INFO])
    expect(liveDiscoveryRows('eps', [], rows, matches).map((r) => r.id)).toEqual([EARNINGS_STRIP])
    expect(liveDiscoveryRows('ownership', [], rows, matches).map((r) => r.id)).toEqual([COMPANY_INFO])
  })

  it('"earnings" returns the Fundamentals earnings series AND the Earnings Strip, each under its own tab', () => {
    const fund = fundamentalResults([
      { id: 'eps_diluted', name: 'EPS', status: 'READY', cadence: 'quarterly', presentation: 'step', aliases: ['earnings per share', 'eps', 'earnings'] },
      { id: 'revenue', name: 'Revenue', status: 'READY', cadence: 'quarterly', presentation: 'step' },
    ])
    const browsed = [...fund, ...featureResults(chartFeaturesOf(normalizeDock({})))]
    const hits = liveDiscoveryRows('eps', [], browsed, matches)
    expect(hits.map((r) => tabOf(r)).sort()).toEqual(['fundamentals', 'research'])
    const earn = liveDiscoveryRows('earnings', [], browsed, matches)
    expect(earn.some((r) => r.id === EARNINGS_STRIP)).toBe(true)
    expect(earn.some((r) => tabOf(r) === 'fundamentals')).toBe(true)
  })
})

describe('Add to Chart — Research in the Indicators surface', () => {
  it('shows a Research tab only when the host provides features', () => {
    render(<Host withFeatures={false} />); openTab()
    expect(catTabs()).not.toContain('Research')
    cleanup()
    render(<Host />); openTab()
    expect(catTabs()).toContain('Research')
  })

  it('the Research tab lists both features with ＋ Add, and their descriptions as the row tooltip', () => {
    render(<Host />); openTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    const es = result('feature:earningsStrip')
    const ci = result('feature:companyInfo')
    expect(es.getAttribute('title')).toBe('Quarterly EPS and revenue, with growth and estimates, in a strip below the chart.')
    expect(ci.getAttribute('title')).toBe("Overview, financials, earnings, ownership and news for the company you're charting.")
    expect(es.textContent).toMatch(/＋ Add/)
    expect(ci.textContent).toMatch(/＋ Add/)
  })

  it('search "earnings" returns the Earnings Strip alongside the other results; "company" returns Company Info', () => {
    render(<Host />); openTab()
    fireEvent.change(searchBox(), { target: { value: 'earnings' } })
    expect(result('feature:earningsStrip')).toBeTruthy()
    fireEvent.change(searchBox(), { target: { value: 'company' } })
    expect(result('feature:companyInfo')).toBeTruthy()
  })

  it('adding the Earnings Strip writes the DOCK, never chart settings, and lands on its management row', () => {
    const seen = []
    const docks = []
    render(<Host seen={seen} onDock={(d) => docks.push(d)} />); openTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    fireEvent.click(result('feature:earningsStrip'))
    expect(docks.at(-1).strip).toBe(true)
    expect(seen).toEqual([])                                 // no chart-settings write
    expect(featureRow(EARNINGS_STRIP)).toBeTruthy()
    expect(featureGroups()).toEqual(['Below chart'])
    expect(inspector().getAttribute('data-inspector-for')).toBe('feature:earningsStrip')
  })

  it('an added feature reads Active, offers no Add another, and clicking it selects its row instead of adding again', () => {
    const docks = []
    render(<Host dock={{ strip: true }} onDock={(d) => docks.push(d)} />); openTab()
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }))
    const es = result('feature:earningsStrip')
    expect(within(es).getByText('Active')).toBeTruthy()
    expect(within(es).queryByRole('button', { name: /Add another/ })).toBeNull()
    fireEvent.click(es)
    expect(docks).toEqual([])                                // duplicate add refused: nothing written
    expect(inspector().getAttribute('data-inspector-for')).toBe('feature:earningsStrip')
  })

  it('the left list files added features after the panes under their destination, not in any pane', () => {
    render(<Host dock={{ strip: true, company: true, open: true }} />); openTab()
    expect(featureGroups()).toEqual(['Below chart', 'Side panel'])
    for (const id of [EARNINGS_STRIP, COMPANY_INFO]) {
      expect(featureRow(id).closest('[data-pane-group]')).toBeNull()
      expect(featureRow(id).querySelector('[data-row-grip]')).toBeNull()
    }
    // ...and they come AFTER every pane group.
    const all = [...document.body.querySelectorAll('[data-pane-group], [data-feature-group]')]
    const firstFeature = all.findIndex((g) => g.hasAttribute('data-feature-group'))
    expect(all.slice(firstFeature).every((g) => g.hasAttribute('data-feature-group'))).toBe(true)
  })

  it('only destinations holding an added feature are listed', () => {
    render(<Host dock={{ company: true, open: false }} />); openTab()
    expect(featureGroups()).toEqual(['Side panel'])
    expect(within(featureRow(COMPANY_INFO)).getByText('Collapsed')).toBeTruthy()
  })

  it('the Earnings Strip inspector: name, destination, description, Remove — nothing else', () => {
    const docks = []
    render(<Host dock={{ strip: true }} onDock={(d) => docks.push(d)} />); openTab()
    fireEvent.click(featureRow(EARNINGS_STRIP))
    const ins = inspector()
    expect(within(ins).getByText('Earnings Strip')).toBeTruthy()
    expect(within(ins).getByText('Below the chart')).toBeTruthy()
    expect(within(ins).getByText(/Quarterly EPS and revenue/)).toBeTruthy()
    expect(within(ins).queryByRole('switch')).toBeNull()
    for (const gone of ['Duplicate', 'Display in', 'Core', 'Appearance']) {
      expect(within(ins).queryByText(gone)).toBeNull()
    }
    fireEvent.click(within(ins).getByRole('button', { name: 'Remove Earnings Strip' }))
    expect(docks.at(-1).strip).toBe(false)
    expect(featureRow(EARNINGS_STRIP)).toBeNull()
  })

  it('the Company Info inspector: Show / Collapse drives `open`, Remove clears `company`', () => {
    const docks = []
    render(<Host dock={{ company: true, open: true, rightW: 520 }} onDock={(d) => docks.push(d)} />); openTab()
    fireEvent.click(featureRow(COMPANY_INFO))
    const ins = inspector()
    expect(within(ins).getByText('Side panel')).toBeTruthy()
    const sw = within(ins).getByRole('switch', { name: 'Collapse Company Info' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(docks.at(-1)).toMatchObject({ company: true, open: false, rightW: 520 })
    expect(within(inspector()).getByRole('switch', { name: 'Show Company Info' }).getAttribute('aria-checked')).toBe('false')
    expect(within(inspector()).queryByText('Duplicate')).toBeNull()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Remove Company Info' }))
    expect(docks.at(-1)).toMatchObject({ company: false })
    expect(featureRow(COMPANY_INFO)).toBeNull()
  })

  it('a chart with only features is not "Nothing on this chart yet"', () => {
    render(<Host dock={{ strip: true }} />); openTab()
    expect(screen.queryByText(/Nothing on this chart yet/)).toBeNull()
  })

  it('the door at the foot of the list reads ＋ Add to Chart', () => {
    render(<Host />); openTab()
    expect(screen.getByTestId('add-enter').textContent.replace(/\s+/g, '')).toBe('＋AddtoChart')
  })

  it('opened from the chart’s Add to Chart control it lands IN the add surface, on Indicators, not Price Style', () => {
    render(<Host scrollTo="add" />)
    expect(screen.getByRole('tab', { name: /Indicators/i }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(searchBox())
    expect(screen.getByRole('tab', { name: 'Research' })).toBeTruthy()
  })
})
