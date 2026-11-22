// GRP's two sections, "Fundamentals" and "Breadth" (GroupStatsSections.jsx). Rails:
//   * one read for a sector or an industry, by the name GRP shows; a UCT theme reads nothing and says so;
//   * both sections closed, each saying its headline numbers; a section's table is drawn only once opened;
//   * the fundamentals: each median with its middle half, a year and three years ago (too few members gives the
//     count and no median, never 0), the rank among its peers, the method; switched off it says so;
//   * the breadth: each share now with the 1-week and 1-month change and the rank, the day's highs and lows and
//     advance / decline, the year's line in words; no closes says so;
//   * loading, not built, the first build running, a group the build does not hold, a failed read (Retry, and the
//     list below is not affected), a paywall, an answer it cannot read; axe.
// The fixtures are the route's real shape (api/services/group_stats.py) with invented figures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import GroupStatsSections from './GroupStatsSections'
import { groupStatsUrl } from './groupStatsModel'
import { COMPUTING, NOT_BUILT, SECTOR_BOARD, SEMIS_DETAIL, TECH_DETAIL } from './__fixtures__/groupStatsFixture'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const TECH_URL = groupStatsUrl('sector', 'Technology')
const SEMIS_URL = groupStatsUrl('industry', 'Semiconductors')
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
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
const renderSections = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><GroupStatsSections {...props} /></SWRConfig>,
)
const open = (testId) => fireEvent.click(screen.getByTestId(testId).querySelector('summary'))
const rowText = (testId) => [...screen.getByTestId(testId).querySelectorAll('td')]
  .map((td) => [...td.childNodes].filter((n) => !(n.classList && n.classList.contains('sr-only'))).map((n) => n.textContent).join(' | ').trim()
    .replace(/\u00a0/g, ' '))   // a rank keeps "of 11" together with a no-break space

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('what is read', () => {
  it('a sector and an industry are read by the name GRP shows; a theme reads nothing and says why', async () => {
    serve({ [TECH_URL]: TECH_DETAIL, [SEMIS_URL]: SEMIS_DETAIL })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    expect(TECH_URL).toBe('/api/research/group-stats?kind=sector&name=Technology')
    cleanup()
    renderSections({ kind: 'industry', name: 'Semiconductors' })
    await screen.findByTestId('terminal-grp-stats')
    expect(asked()).toEqual([TECH_URL, SEMIS_URL])
    cleanup()
    jsonFetcher.mockReset()
    renderSections({ kind: 'theme', name: 'AI / GPU Chips' })
    expect(screen.getByTestId('terminal-grp-stats-theme').textContent).toContain('not for UCT themes')
    expect(asked()).toEqual([])
  })

  it('a line while it loads', () => {
    serve({ [TECH_URL]: PENDING })
    renderSections({ kind: 'sector', name: 'Technology' })
    expect(screen.getByTestId('terminal-grp-stats-loading').textContent).toBe('Loading the fundamentals and breadth of Technology.')
  })
})

describe('the two sections', () => {
  it('⭐ both start closed, each with its headline numbers, and no table until opened', async () => {
    serve({ [TECH_URL]: TECH_DETAIL })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    expect(screen.getByTestId('terminal-grp-fund').hasAttribute('open')).toBe(false)
    expect(screen.getByTestId('terminal-grp-fund-line').textContent)
      .toBe('median revenue growth 14.2% (of 46), net margin 14.8%, P/E 31.75x; 2nd of 11 by revenue growth')
    expect(screen.getByTestId('terminal-grp-breadth-line').textContent).toBe('58% above the 50-day (+6 pts in a week); 6 new highs, 1 new low')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByTestId('terminal-grp-stats-when').textContent).toMatch(/^Fundamentals and breadth worked out after the close of Jun 4, 2031 \(built /)
  })

  it('the fundamentals: median, middle half, a year and three years ago, the rank; too few gives the count', async () => {
    serve({ [TECH_URL]: TECH_DETAIL })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    open('terminal-grp-fund')
    expect(screen.getByTestId('terminal-grp-fund').hasAttribute('open')).toBe(true)
    const table = screen.getByTestId('terminal-grp-fund-table')
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Figure', 'Median', 'Middle half', 'A year ago', '3 years ago', 'Rank'])
    expect(rowText('terminal-grp-fund-row-revenue_growth_q')).toEqual(['Revenue Growth (Quarterly) | Year over year', '14.2% | of 46', '4.1% to 27.9%',
      '9.8% | of 44', '17.5% | of 39', '2nd of 11'])
    expect(rowText('terminal-grp-fund-row-pe_ttm')).toEqual(['P/E (TTM) | Trailing', '31.75x | of 40', '21.00x to 52.40x', '26.40x | of 38', '3 with data', '1st of 11'])
    expect(rowText('terminal-grp-fund-row-revenue_accelerating')).toEqual(['Revenue growth accelerating | Share of members', '57% | of 46', '',
      '41% | of 44', '3 with data', '3rd of 11'])
    expect(within(table).getAllByRole('row')).toHaveLength(12)
    const method = screen.getByTestId('terminal-grp-fund-method').textContent
    expect(method).toContain('in force at the close of Jun 4, 2031')
    expect(method).toContain('with fewer than 5 the count is shown and no median')
    expect(method).toContain('48 of its 52 stocks have current filing figures.')
    open('terminal-grp-fund')
    expect(screen.queryByTestId('terminal-grp-fund-table')).toBeNull()
  })

  it('the breadth: each share now, its change from a week and a month ago, the rank, the counts and the line', async () => {
    serve({ [TECH_URL]: TECH_DETAIL })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    open('terminal-grp-breadth')
    expect(rowText('terminal-grp-breadth-row-above50')).toEqual(['Above the 50-day', '58% | of 50', '+6 pts | was 52%', '-7 pts | was 65%', '3rd of 11'])
    expect(rowText('terminal-grp-breadth-row-near_high')).toEqual(['Within 5% of the 52-week high', '30% | of 47', '+2 pts | was 28%', '-5 pts | was 35%', '2nd of 11'])
    expect(screen.getByTestId('terminal-grp-breadth-counts').textContent).toBe(
      'On Jun 4, 2031: 6 new 52-week closing highs and 1 new low of 47 stocks with a year of closes (highs minus lows +5, 1st of 11). 31 closed up, 17 down, 2 unchanged.')
    const svg = within(screen.getByTestId('terminal-grp-breadth-chart')).getByRole('img')
    expect(svg.getAttribute('aria-label')).toMatch(/^Share above the 50-day average, daily, .+ now \d+%\.$/)
    expect(screen.getByTestId('terminal-grp-breadth-method').textContent).toContain('Of the 50 Technology stocks with a close on Jun 4, 2031')
  })

  it('too few stocks with a year of closes, and no line to draw, are said', async () => {
    const thin = { ...TECH_DETAIL, breadth: { ...TECH_DETAIL.breadth, net_highs: null, new_highs: { n: 3, count: 1 }, line: TECH_DETAIL.breadth.line.map(() => null) } }
    serve({ [TECH_URL]: thin })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    open('terminal-grp-breadth')
    expect(screen.getByTestId('terminal-grp-breadth-counts').textContent).toContain('Fewer than 5 of its stocks have a year of closes')
    expect(screen.getByTestId('terminal-grp-breadth-no-chart')).toBeTruthy()
  })

  it('the fundamentals switched off, or not read that evening, say so; no closes says so', async () => {
    serve({ [TECH_URL]: { ...TECH_DETAIL, sources: { ...TECH_DETAIL.sources, fundamentals: { state: 'off' } }, fund: null } })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    expect(screen.getByTestId('terminal-grp-fund-line').textContent).toBe('not shown')
    open('terminal-grp-fund')
    expect(screen.getByTestId('terminal-grp-fund-state').textContent).toContain('switched off')
    expect(screen.queryByTestId('terminal-grp-fund-table')).toBeNull()
    cleanup()
    serve({ [TECH_URL]: { ...TECH_DETAIL, breadth: null } })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    expect(screen.getByTestId('terminal-grp-breadth-line').textContent).toBe('not shown')
    open('terminal-grp-breadth')
    expect(screen.getByTestId('terminal-grp-breadth-down').textContent).toContain('No stored closes could be read for Technology')
  })
})

describe('the states', () => {
  it('not built, the first build running and a group the build does not hold are lines, never empty tables', async () => {
    for (const [body, testId, words] of [
      [NOT_BUILT, 'terminal-grp-stats-not-built', 'first evening build has not run'],
      [COMPUTING, 'terminal-grp-stats-computing', 'asks again every'],
      [{ ...SECTOR_BOARD, found: false, name: 'Technology', peers: 11 }, 'terminal-grp-stats-not-found', 'was not in the last evening build of sectors'],
      [{ status: 'ok', found: true }, 'terminal-grp-stats-error', 'cannot read'],
    ]) {
      cleanup()
      serve({ [TECH_URL]: body })
      renderSections({ kind: 'sector', name: 'Technology' })
      expect([testId, (await screen.findByTestId(testId)).textContent.includes(words)]).toEqual([testId, true])
    }
  })

  it('a failed read is one line with Retry, and the list below is not affected; a paywall has no Retry', async () => {
    serve({ [TECH_URL]: fail(500) })
    renderSections({ kind: 'sector', name: 'Technology' })
    const err = await screen.findByTestId('terminal-grp-stats-error')
    expect(err.textContent).toContain('could not be read just now. The stocks below are not affected.')
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(jsonFetcher.mock.calls.length).toBeGreaterThanOrEqual(2))
    cleanup()
    serve({ [TECH_URL]: fail(402) })
    renderSections({ kind: 'sector', name: 'Technology' })
    const paid = await screen.findByTestId('terminal-grp-stats-error')
    expect(paid.textContent).toContain('needs a paid plan')
    expect(within(paid).queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})

describe('accessibility', () => {
  it('both sections open pass axe (WCAG A and AA)', async () => {
    serve({ [TECH_URL]: TECH_DETAIL })
    renderSections({ kind: 'sector', name: 'Technology' })
    await screen.findByTestId('terminal-grp-stats')
    open('terminal-grp-fund')
    open('terminal-grp-breadth')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
