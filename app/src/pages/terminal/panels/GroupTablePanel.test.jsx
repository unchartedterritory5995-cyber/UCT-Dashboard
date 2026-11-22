// GRPS: every sector (or industry) one row, sortable by any column. Rails:
//   * one read, by kind; the industries are one pick away and the pick writes the command;
//   * the rows: each name opens GRP on that group; each figure says how many stocks it rests on, and a group
//     with too few gives its count and no figure (never 0);
//   * sortable by name and by any column, a blank last either way, with aria-sort; column sets;
//   * loading, not built yet, the first build running, a failed read (Retry), a paywall, signed out, an answer
//     it cannot read, nothing in it; the fundamentals switched off (only breadth is left, and a set of only
//     fundamentals says so with a way out); closes that stopped short; a build running;
//   * the as-of is the session the figures were worked out for; axe; no hard-coded colour.
// The fixtures are the route's real shape (api/services/group_stats.py) with invented figures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import GroupTablePanel from './GroupTablePanel'
import { groupStatsUrl } from './groupStatsModel'
import { COMPUTING, INDUSTRY_BOARD, NOT_BUILT, SECTOR_BOARD } from './__fixtures__/groupStatsFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SECTORS = groupStatsUrl('sector')
const INDUSTRIES = groupStatsUrl('industry')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

function renderPanel(props = {}, { rerun = vi.fn(), open = vi.fn(), setFreshness = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          <TerminalPanelContext.Provider value={{ code: 'GRPS', density: 'comfortable', inset: true }}>
            <GroupTablePanel {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, open, setFreshness }
}
const rows = () => within(screen.getByTestId('terminal-grps-table')).getAllByRole('row').slice(1)
const names = () => rows().map((r) => r.getAttribute('data-testid').replace('terminal-grps-row-', ''))
const heads = () => within(screen.getByTestId('terminal-grps-table')).getAllByRole('columnheader').map((th) => th.textContent.replace(/ [▲▼]$/, ''))
const visible = (td) => [...td.querySelectorAll('span[aria-hidden="true"], span:not(.sr-only)')].filter((s) => !s.classList.contains('sr-only')).map((s) => s.textContent).join(' | ')
const cellsOf = (name) => [...screen.getByTestId(`terminal-grps-row-${name}`).querySelectorAll('td')].map(visible)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('GRPS: what is read', () => {
  it('reads the sectors once, and shows a skeleton while it loads', () => {
    serve({ [SECTORS]: PENDING })
    renderPanel()
    expect(SECTORS).toBe('/api/research/group-stats?kind=sector')
    expect(screen.getByTestId('terminal-grps-loading')).toBeTruthy()
    expect(asked()).toEqual([SECTORS])
  })

  it('a typed kind and column set seed the panel', async () => {
    serve({ [INDUSTRIES]: INDUSTRY_BOARD })
    renderPanel({ kind: 'industry', view: 'breadth' })
    await screen.findByTestId('terminal-grps-table')
    expect(asked()).toEqual([INDUSTRIES])
    expect(screen.getByTestId('terminal-grps').getAttribute('data-view')).toBe('breadth')
    expect(names()).toEqual(['Oil & Gas E&P', 'Semiconductors'])
    expect(heads()[0]).toBe('Industry')
  })
})

describe('GRPS populated: every sector', () => {
  it('⭐ one row per sector: each figure with how many stocks it rests on; too few gives the count, never 0', async () => {
    serve({ [SECTORS]: SECTOR_BOARD })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    expect(heads()).toEqual(['Sector', 'Revenue growth', 'EPS growth', 'Net margin', 'P/E', 'Above 50-day', 'Highs minus lows'])
    expect(names()).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(cellsOf('Technology')).toEqual(['Technology | 52 stocks', '14.2% | of 48', '21.5% | of 48', '14.8% | of 48', '31.75x | of 48',
      '58% | of 50', '+5 | 6 highs, 1 low'])
    expect(cellsOf('Utilities').slice(1)).toEqual(['3 with data', '3 with data', '3 with data', '3 with data', '3 with data', '3 with data'])
    expect(screen.getByTestId('terminal-grps-lede').textContent).toMatch(/^3 sectors, after the close of Jun 4, 2031 \(built \d{1,2}:\d{2} [AP]M ET\)\./)
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: 'UCT group figures (SEC filings, stored closes)' })))
    expect(JSON.stringify(setFreshness.mock.calls.map((c) => c[0]).filter(Boolean).pop())).toContain('2031-06-04')
    const method = screen.getByTestId('terminal-grps-method').textContent
    expect(method).toContain('with fewer than 5 stocks the count is shown and no median')
    expect(method).toContain('point in time, no look-ahead')
  })

  it('a name opens GRP on that group beside this panel', async () => {
    serve({ [SECTORS]: SECTOR_BOARD })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(within(screen.getByTestId('terminal-grps-row-Technology')).getByRole('button', { name: /Open the stocks of Technology/ }))
    expect(open).toHaveBeenLastCalledWith('GRP SECTOR TECHNOLOGY')
  })

  it('sorts by any column, highest first, then lowest; a blank sorts last either way; by name back again', async () => {
    serve({ [SECTORS]: SECTOR_BOARD })
    renderPanel()
    await screen.findByTestId('terminal-grps-table')
    const th = (key) => screen.getByTestId(`terminal-grps-sort-${key}`).closest('th')
    expect(th('name').getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByTestId('terminal-grps-sort-f:pe_ttm'))
    expect(names()).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(th('f:pe_ttm').getAttribute('aria-sort')).toBe('descending')
    expect(th('name').getAttribute('aria-sort')).toBe('none')
    fireEvent.click(screen.getByTestId('terminal-grps-sort-f:pe_ttm'))
    expect(names()).toEqual(['Energy', 'Technology', 'Utilities'])
    expect(screen.getByTestId('terminal-grps-table').getAttribute('aria-label')).toBe('Every sector, overview, by P/E, lowest first')
    fireEvent.click(screen.getByTestId('terminal-grps-sort-b:net_highs'))
    expect(names()).toEqual(['Technology', 'Energy', 'Utilities'])
    fireEvent.click(screen.getByTestId('terminal-grps-sort-name'))
    expect(names()).toEqual(['Energy', 'Technology', 'Utilities'])
  })

  it('a column set picks the columns and writes the command; a sort its set lacks goes back to the name', async () => {
    serve({ [SECTORS]: SECTOR_BOARD })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(screen.getByTestId('terminal-grps-sort-f:pe_ttm'))
    fireEvent.change(screen.getByTestId('terminal-grps-view'), { target: { value: 'margins' } })
    expect(rerun).toHaveBeenLastCalledWith('GRPS MARGINS')
    expect(heads()).toEqual(['Sector', 'Gross margin', 'Operating margin', 'Net margin', 'FCF margin', 'ROE'])
    expect(screen.getByTestId('terminal-grps-table').getAttribute('data-sort')).toBe('name:asc')
    fireEvent.change(screen.getByTestId('terminal-grps-view'), { target: { value: 'breadth' } })
    expect(heads()).toEqual(['Sector', 'Above 20-day', 'Above 50-day', 'Above 50-day, 1 wk', 'Above 50-day, 1 mo', 'Above 200-day',
      'Near 52-wk high', 'Highs minus lows', 'Up / down'])
    expect(cellsOf('Energy').slice(3, 5)).toEqual(['-4 pts', '-10 pts'])
    expect(cellsOf('Technology')[8]).toBe('31 / 17 | 2 flat')
    fireEvent.change(screen.getByTestId('terminal-grps-view'), { target: { value: 'growth' } })
    expect(heads()).toEqual(['Sector', 'Revenue growth', 'Revenue growth, a year ago', 'EPS growth', 'EPS growth, a year ago', 'Accelerating'])
    expect(cellsOf('Technology')[2]).toBe('9.8% | of 45')
  })

  it('the industries are one pick away: a new read, the command written', async () => {
    serve({ [SECTORS]: SECTOR_BOARD, [INDUSTRIES]: INDUSTRY_BOARD })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    fireEvent.change(screen.getByTestId('terminal-grps-kind'), { target: { value: 'industry' } })
    expect(rerun).toHaveBeenLastCalledWith('GRPS INDUSTRIES')
    await waitFor(() => expect(names()).toEqual(['Oil & Gas E&P', 'Semiconductors']))
    expect(asked()).toEqual([SECTORS, INDUSTRIES])
    expect(cellsOf('Semiconductors')[4]).toBe('38.00x | of 17')
    expect(screen.getByTestId('terminal-grps-lede').textContent).toMatch(/^2 industries/)
  })
})

describe('GRPS states', () => {
  it('not built yet and the first build running are working states, never an empty table', async () => {
    serve({ [SECTORS]: NOT_BUILT })
    renderPanel()
    const nb = await screen.findByTestId('terminal-grps-not-built')
    expect(nb.textContent).toContain('once each evening after the close')
    expect(nb.textContent).toContain('not the same as a sector with no figures')
    cleanup()
    serve({ [SECTORS]: COMPUTING })
    renderPanel()
    expect((await screen.findByTestId('terminal-grps-computing')).textContent).toContain('asks again every minute')
  })

  it('a failed read is an error with Retry; a paywall and signed out say so; Retry asks again', async () => {
    for (const [status, retry, words] of [[500, true, 'could not be read just now'], [402, false, 'needs a paid plan'], [401, true, 'signed out']]) {
      cleanup()
      jsonFetcher.mockReset()
      serve({ [SECTORS]: fail(status) })
      renderPanel()
      const err = await screen.findByTestId('terminal-grps-error')
      expect([status, err.textContent.includes(words)]).toEqual([status, true])
      expect([status, !!within(err).queryByRole('button', { name: 'Retry' })]).toEqual([status, retry])
    }
    cleanup()
    jsonFetcher.mockReset()
    serve({ [SECTORS]: fail(500) })
    renderPanel()
    fireEvent.click(within(await screen.findByTestId('terminal-grps-error')).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(jsonFetcher.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('an answer it cannot read, and a build that found no sectors', async () => {
    serve({ [SECTORS]: { status: 'ok' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-grps-error')).textContent).toContain('cannot read')
    cleanup()
    serve({ [SECTORS]: { ...SECTOR_BOARD, groups: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-grps-empty')).textContent).toContain('not the same as a market with no sectors')
  })

  it('the fundamentals switched off: a note, breadth only; a set of only fundamentals offers breadth', async () => {
    const off = { ...SECTOR_BOARD, sources: { ...SECTOR_BOARD.sources, fundamentals: { state: 'off' } },
      groups: SECTOR_BOARD.groups.map((g) => ({ ...g, fund: null, fund_members: null })) }
    serve({ [SECTORS]: off })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    expect(screen.getByTestId('terminal-grps-fund-state').textContent).toContain('switched off')
    expect(heads()).toEqual(['Sector', 'Above 50-day', 'Highs minus lows'])
    fireEvent.change(screen.getByTestId('terminal-grps-view'), { target: { value: 'valuation' } })
    const none = screen.getByTestId('terminal-grps-no-columns')
    expect(none.textContent).toContain('shows only fundamentals')
    fireEvent.click(within(none).getByRole('button', { name: 'Show breadth' }))
    expect(rerun).toHaveBeenLastCalledWith('GRPS BREADTH')
    expect(heads()).toHaveLength(9)
  })

  it('closes that stopped short of the evening, and a build running, are said', async () => {
    serve({ [SECTORS]: { ...SECTOR_BOARD, lagging: ['prices'], refreshing: true } })
    renderPanel()
    await screen.findByTestId('terminal-grps-table')
    expect(screen.getByTestId('terminal-grps-lagging').textContent).toContain('stopped short')
    expect(screen.getByTestId('terminal-grps-refreshing').textContent).toContain('these are the last figures')
  })
})

describe('GRPS follows the member\'s theme and passes axe', () => {
  it('the panel, its sections, the model and its sheet hold no hard-coded colour', () => {
    for (const f of ['GroupTablePanel.jsx', 'GroupStatsSections.jsx', 'groupStatsModel.js', 'groupStats.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('populated, not built and an error pass axe (WCAG A and AA)', async () => {
    serve({ [SECTORS]: SECTOR_BOARD })
    renderPanel()
    await screen.findByTestId('terminal-grps-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [SECTORS]: NOT_BUILT })
    renderPanel()
    await screen.findByTestId('terminal-grps-not-built')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [SECTORS]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-grps-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
