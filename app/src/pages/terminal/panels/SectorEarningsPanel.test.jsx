// ERNSC: earnings season by sector. Rails:
//   * one read per season; the picks write the command; typed words seed the panel; a measure is not a new read;
//   * the header says FIRST that it is only the stocks UCT holds results for, with the counts, then the season;
//   * the whole tracked market first, then one row per sector by the chosen measure's beat share: the beat / in line / miss
//     shares and the median surprise each with its count, the median reaction and the share that rose, a year earlier
//     beside it on the season that holds today; too few says so, never 0;
//   * a row opens every reporter (each a PanelSymbol that loads the board) by its own read, the biggest beats and misses
//     first, then the stocks to come and the pending ones; one sector open at a time; its reporters go to the shell's list;
//   * loading, computing, a failed read (Retry), a failed request (Retry), signed out, free plan, an answer it cannot read,
//     no results held, nothing in the season (with a way to another season); a sector read that fails or is gone;
//   * the as-of is the build; axe; no hard-coded colour.
// The fixtures are the route's real shape (api/services/sector_earnings.py) with invented figures.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import SectorEarningsPanel from './SectorEarningsPanel'
import { sectorDetailUrl, sectorEarningsUrl } from './sectorEarningsModel'
import { COMPUTING, CURRENT, EMPTY, FAILED, NONE_YET, NOT_FOUND, TECH_DETAIL, UTIL_DETAIL, YEAR_AGO } from './__fixtures__/sectorEarningsFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const CUR = sectorEarningsUrl({ season: 'current' })
const AGO = sectorEarningsUrl({ season: 'year_ago' })
const PREV = sectorEarningsUrl({ season: 'previous' })
const TECH = sectorDetailUrl({ season: 'current', sector: 'Technology' })
const UTIL = sectorDetailUrl({ season: 'current', sector: 'Utilities' })
const HEALTH = sectorDetailUrl({ season: 'current', sector: 'Healthcare' })
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

function renderPanel(props = {}, { rerun = vi.fn(), run = vi.fn(), publish = vi.fn(), setFreshness = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish, publishRows: vi.fn() }}>
          <TerminalPanelContext.Provider value={{ code: 'ERNSC', density: 'comfortable', inset: true }}>
            <SectorEarningsPanel {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, run, publish, setFreshness }
}
const table = () => screen.getByTestId('terminal-ernsc-table')
const rowNames = () => within(table()).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid')).filter((t) => t && t.startsWith('terminal-ernsc-row-')).map((t) => t.replace('terminal-ernsc-row-', ''))
/** A cell's text as it reads: a line break is a space. */
function textOf(el) {
  const d = document.createElement('div')
  d.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, ' ')
  return d.textContent.replace(/\s+/g, ' ').trim()
}
const cells = (testId) => [...screen.getByTestId(testId).querySelectorAll('td')].map(textOf)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('ERNSC: what is read', () => {
  it('reads the season that holds today once, and shows a skeleton while it loads', () => {
    serve({ [CUR]: PENDING })
    renderPanel()
    expect(CUR).toBe('/api/research/sector-earnings?season=current')
    expect(screen.getByTestId('terminal-ernsc-loading')).toBeTruthy()
    expect(asked()).toEqual([CUR])
  })

  it('typed words seed the panel', async () => {
    serve({ [AGO]: YEAR_AGO })
    renderPanel({ season: 'year_ago', metric: 'revenue' })
    await screen.findByTestId('terminal-ernsc-table')
    expect(asked()).toEqual([AGO])
    const root = screen.getByTestId('terminal-ernsc')
    expect([root.getAttribute('data-season'), root.getAttribute('data-metric')]).toEqual(['year_ago', 'revenue'])
    expect(screen.getByTestId('terminal-ernsc-season').value).toBe('year_ago')
    expect(screen.getByTestId('terminal-ernsc-metric').value).toBe('revenue')
  })

  it('a season pick is a new read and writes the command; a measure pick re-sorts the same answer and writes it', async () => {
    serve({ [CUR]: CURRENT, [AGO]: YEAR_AGO })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    expect(rowNames()).toEqual(['Healthcare', 'Technology', 'Energy', 'Utilities', 'Sector not on file'])
    fireEvent.change(screen.getByTestId('terminal-ernsc-metric'), { target: { value: 'revenue' } })
    expect(rerun).toHaveBeenLastCalledWith('ERNSC REVENUE')
    expect(rowNames()).toEqual(['Technology', 'Healthcare', 'Energy', 'Utilities', 'Sector not on file'])
    expect(asked()).toEqual([CUR])
    fireEvent.change(screen.getByTestId('terminal-ernsc-season'), { target: { value: 'year_ago' } })
    expect(rerun).toHaveBeenLastCalledWith('ERNSC YEARAGO REVENUE')
    await waitFor(() => expect(rowNames()).toEqual(['Technology', 'Healthcare']))
    expect(asked()).toEqual([CUR, AGO])
    // a year earlier carries no comparison column
    expect(within(table()).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Sector', 'Beat / in line / miss', 'Median surprise', 'Reaction'])
  })

  it('a pick never draws the previous season under the new choice', async () => {
    serve({ [CUR]: CURRENT, [PREV]: PENDING })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    fireEvent.change(screen.getByTestId('terminal-ernsc-season'), { target: { value: 'previous' } })
    await waitFor(() => expect(asked()).toContain(PREV))
    expect(screen.getByTestId('terminal-ernsc-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-ernsc-table')).toBeNull()
  })
})

describe('ERNSC populated', () => {
  it('⭐ the header says first: only the stocks UCT holds results for, then the season; the as-of is the build', async () => {
    serve({ [CUR]: CURRENT })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    expect(screen.getByTestId('terminal-ernsc-lede').textContent).toBe('Only the stocks UCT holds earnings results for: 24 of the 26 stocks in its '
      + 'universe, not every company that reports. The Q3 2031 season: reports dated Oct 1 to Dec 31, 2031, so far through Nov 20, 2031.')
    expect(screen.getByTestId('terminal-ernsc-lede').querySelector('strong').textContent).toMatch(/^Only the stocks UCT holds earnings results for/)
    expect(screen.getByTestId('terminal-ernsc-counts').textContent).toBe("17 stocks reported, 3 still to report later in the season, 1 past its report date with the result not in UCT's copy yet.")
    expect(setFreshness).toHaveBeenLastCalledWith(expect.objectContaining({ source: "UCT's held earnings results (the consensus from FMP and Finnhub)", observedAt: '2031-11-20T15:10:00.000Z' }))
    expect([...screen.getByTestId('terminal-ernsc-season').querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['This season (Q3 2031)', 'The season before (Q2 2031)', 'A year earlier (Q3 2030)'])
    expect(screen.getByTestId('terminal-ernsc-method').textContent).toMatch(/within 0\.5% either way is in line/)
  })

  it('⭐ the whole tracked market first, then each sector: shares and medians with their counts, too few said, never 0', async () => {
    serve({ [CUR]: CURRENT })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    expect(within(table()).getAllByRole('columnheader').map((th) => th.textContent))
      .toEqual(['Sector', 'Beat / in line / miss', 'Median surprise', 'Reaction', 'A year earlier'])
    expect(cells('terminal-ernsc-total')).toEqual(['All tracked stocks 17 reported, 3 to come, 1 pending', '71 / 6 / 24% of 17', '+1.5% of 16',
      '+0.8% 67% of 15 rose', '71 / 14 / 14% of 7'])
    expect(cells('terminal-ernsc-row-Healthcare')).toEqual(['Healthcare 5 reported', '80 / 0 / 20% of 5', '+1.0% of 5', '+0.8% 60% of 5 rose', 'too few of 1'])
    expect(cells('terminal-ernsc-row-Technology')).toEqual(['Technology 8 reported, 2 to come, 1 pending', '63 / 13 / 25% of 8', '+4.2% of 7',
      '+1.3% 67% of 6 rose', '67 / 17 / 17% of 6'])
    expect(cells('terminal-ernsc-row-Energy')).toEqual(['Energy 3 reported', 'too few of 3', 'too few of 3', 'too few 3 measured', 'none held'])
    expect(cells('terminal-ernsc-row-Utilities')).toEqual(['Utilities 0 reported, 1 to come', 'too few of 0', 'too few of 0', 'too few 0 measured', 'none held'])
    expect(screen.getByTestId('terminal-ernsc-beat-Energy').getAttribute('title')).toBe('3 reporters with an EPS consensus, fewer than 5, so no share')
    expect(screen.getByTestId('terminal-ernsc-beat-Technology').getAttribute('title')).toBe('63% beat, 13% in line, 25% missed the EPS consensus (5, 1 and 2 of 8 with a consensus)')
    expect(within(screen.getByTestId('terminal-ernsc-row-Technology')).getByText('+4.2%').className).toMatch(/up/)
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('revenue: its own shares and medians in the same rows', async () => {
    serve({ [CUR]: CURRENT })
    renderPanel({ metric: 'revenue' })
    await screen.findByTestId('terminal-ernsc-table')
    expect(cells('terminal-ernsc-row-Technology')).toEqual(['Technology 8 reported, 2 to come, 1 pending', '83 / 0 / 17% of 6', '+1.1% of 6',
      '+1.3% 67% of 6 rose', '67 / 0 / 33% of 6'])
  })

  it('⭐ a row opens every reporter by its own read: the biggest beats and misses first, each a symbol that loads the board', async () => {
    serve({ [CUR]: CURRENT, [TECH]: TECH_DETAIL, [UTIL]: UTIL_DETAIL })
    const { run, publish } = renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    const btn = screen.getByTestId('terminal-ernsc-open-Technology')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(asked()).toEqual([CUR])
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const detail = await screen.findByTestId('terminal-ernsc-detail-Technology')
    expect(btn.getAttribute('aria-controls')).toBe(detail.id)
    await waitFor(() => expect(detail.getAttribute('data-state')).toBe('ok'))
    expect(asked()).toEqual([CUR, TECH])
    const items = within(detail).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-testid').replace('terminal-ernsc-rep-', ''))).toEqual(['ZQKA', 'ZQKG', 'ZQKB', 'ZQKC', 'ZQKD', 'ZQKF', 'ZQKE', 'ZQKH'])
    expect(textOf(items[0])).toBe('ZQKA +18.0% beatOct 22 · 1.18 vs 1.00 · rev +5.1% · moved +6.1%')
    expect(textOf(items[1])).toBe('ZQKG -12.0% missedNov 18 · 0.88 vs 1.00 · rev no consensus · move not settled')
    expect(textOf(items[7])).toBe('ZQKH +$0.02 beatOct 30 · 0.04 vs 0.02 · rev no consensus · no move held')
    expect(items[0].getAttribute('title')).toMatch(/^Reported Oct 22, 2031 \(FY2031 Q3\)\. EPS 1\.18 against 1\.00 expected: \+18\.0%, a beat\./)
    expect(within(items[1]).getByText('-12.0%').className).toMatch(/down/)
    expect(screen.getByTestId('terminal-ernsc-upcoming-Technology').textContent).toBe('To come: ZQKJ Nov 25, ZQKK Dec 4')
    expect(screen.getByTestId('terminal-ernsc-late-Technology').textContent).toBe("Pending, the result not in UCT's copy yet: ZQKL Nov 12")
    // the same season a year earlier stays in reach where its column folds
    expect(screen.getByTestId('terminal-ernsc-ago-Technology').textContent).toBe('A year earlier (Q3 2030): 67% beat, 17% in line, 17% missed '
      + 'the EPS consensus (4, 1 and 1 of 6 with a consensus); median EPS surprise +2.5%, over 6 reporters with a percent surprise; median move '
      + '+0.6% from the close before the report to the close after, 67% rose (4 of 6).')
    await waitFor(() => expect(publish).toHaveBeenLastCalledWith({ syms: ['ZQKA', 'ZQKG', 'ZQKB', 'ZQKC', 'ZQKD', 'ZQKF', 'ZQKE', 'ZQKH'], label: 'earnings season by sector' }))
    // every symbol is a PanelSymbol: a click loads the board, the ones to come too
    for (const li of items) expect(within(li).getAllByRole('button', { name: /^Load ZQK[A-H]$/ })).toHaveLength(1)
    fireEvent.click(within(items[3]).getByTestId('panel-symbol-ZQKC'))
    expect(run).toHaveBeenLastCalledWith('$ZQKC')
    fireEvent.click(within(screen.getByTestId('terminal-ernsc-upcoming-Technology')).getByTestId('panel-symbol-ZQKK'))
    expect(run).toHaveBeenLastCalledWith('$ZQKK')
    // revenue re-sorts the open list without a new read
    fireEvent.change(screen.getByTestId('terminal-ernsc-metric'), { target: { value: 'revenue' } })
    expect(within(screen.getByTestId('terminal-ernsc-detail-Technology')).getAllByRole('listitem').map((li) => li.getAttribute('data-testid').slice(-4)))
      .toEqual(['ZQKA', 'ZQKB', 'ZQKF', 'ZQKC', 'ZQKD', 'ZQKE', 'ZQKG', 'ZQKH'])
    expect(textOf(within(screen.getByTestId('terminal-ernsc-detail-Technology')).getAllByRole('listitem')[0])).toBe('ZQKA +5.1% beatOct 22 · 2.10B vs 2.00B · EPS +18.0% · moved +6.1%')
    expect(asked()).toEqual([CUR, TECH])
    // one sector open at a time: another closes it; a click closes
    fireEvent.click(screen.getByTestId('terminal-ernsc-open-Utilities'))
    expect(screen.queryByTestId('terminal-ernsc-detail-Technology')).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(await screen.findByTestId('terminal-ernsc-detail-none')).toBeTruthy()
    expect(screen.getByTestId('terminal-ernsc-upcoming-Utilities').textContent).toBe('To come: ZQUA Dec 10')
    expect(screen.queryByTestId('terminal-ernsc-ago-Utilities')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-ernsc-open-Utilities'))
    expect(screen.queryByTestId('terminal-ernsc-detail-Utilities')).toBeNull()
  })

  it('a sector read that fails says so with Retry; one that is gone says so; never the previous sector\'s reporters', async () => {
    serve({ [CUR]: CURRENT, [TECH]: TECH_DETAIL, [HEALTH]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    fireEvent.click(screen.getByTestId('terminal-ernsc-open-Technology'))
    await waitFor(() => expect(screen.getByTestId('terminal-ernsc-detail-Technology').getAttribute('data-state')).toBe('ok'))
    fireEvent.click(screen.getByTestId('terminal-ernsc-open-Healthcare'))
    const box = await screen.findByTestId('terminal-ernsc-detail-error')
    expect(box.textContent).toMatch(/The reporters in Healthcare could not be read just now\./)
    expect(screen.queryByTestId('terminal-ernsc-rep-ZQKA')).toBeNull()
    serve({ [CUR]: CURRENT, [HEALTH]: { ...NOT_FOUND, asked: 'Healthcare' } })
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    expect((await screen.findByTestId('terminal-ernsc-detail-gone')).textContent).toMatch(/Healthcare is not in this season's answer any more\./)
  })

  it('a later read that did not finish is said beside the last figures', async () => {
    serve({ [CUR]: { ...CURRENT, check: { state: 'failed', reason: 'error', http_status: null, at: '2031-11-20T16:00:00+00:00' } } })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-check')
    expect(screen.getByTestId('terminal-ernsc-table')).toBeTruthy()
  })
})

describe('ERNSC states', () => {
  it('computing: said, and asked again', async () => {
    serve({ [CUR]: COMPUTING })
    renderPanel()
    expect((await screen.findByTestId('terminal-ernsc-computing')).textContent).toMatch(/asks again every 3 seconds/)
  })

  it('a failed read on the server: said, with Retry, never "no reports"', async () => {
    serve({ [CUR]: FAILED })
    renderPanel()
    const box = await screen.findByTestId('terminal-ernsc-failed')
    expect(box.textContent).toMatch(/not the same as no reports/)
    serve({ [CUR]: CURRENT })
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-ernsc-table')
  })

  it('a failed request and signed out: Retry; free plan and switched off: said, no Retry', async () => {
    for (const [status, words, retry] of [[500, /could not be read just now/, true], [401, /You are signed out/, true],
      [402, /needs a paid plan/, false], [404, /not switched on for this server yet/, false]]) {
      cleanup()
      serve({ [CUR]: fail(status) })
      renderPanel()
      const box = await screen.findByTestId('terminal-ernsc-error')
      expect([status, words.test(box.textContent)]).toEqual([status, true])
      expect([status, !!within(box).queryByRole('button', { name: 'Retry' })]).toEqual([status, retry])
    }
  })

  it('an answer it cannot read', async () => {
    serve({ [CUR]: { status: 'ok', sectors: 'x' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-ernsc-error')).textContent).toMatch(/cannot read/)
  })

  it('no results held yet: said, not "no reports"', async () => {
    serve({ [CUR]: EMPTY })
    renderPanel()
    expect((await screen.findByTestId('terminal-ernsc-empty')).textContent).toMatch(/does not hold any stock's earnings results/)
  })

  it('nothing in the season: said, with a way to another season', async () => {
    serve({ [PREV]: NONE_YET, [CUR]: CURRENT })
    const { rerun } = renderPanel({ season: 'previous' })
    const box = await screen.findByTestId('terminal-ernsc-none-yet')
    expect(box.textContent).toMatch(/No report in the Q2 2031 season is held yet\./)
    expect(screen.getByTestId('terminal-ernsc-lede').textContent).toMatch(/^Only the stocks UCT holds earnings results for/)
    fireEvent.click(within(box).getByRole('button', { name: 'Show this season' }))
    expect(rerun).toHaveBeenLastCalledWith('ERNSC')
    await screen.findByTestId('terminal-ernsc-table')
  })
})

describe('ERNSC follows the member\'s theme and passes axe', () => {
  it('the panel, the model and its sheet hold no hard-coded colour', () => {
    for (const f of ['SectorEarningsPanel.jsx', 'sectorEarningsModel.js', 'sectorEarnings.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('populated with a sector open, nothing in a season and an error pass axe (WCAG A and AA)', async () => {
    serve({ [CUR]: CURRENT, [TECH]: TECH_DETAIL })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-table')
    fireEvent.click(screen.getByTestId('terminal-ernsc-open-Technology'))
    await waitFor(() => expect(screen.getByTestId('terminal-ernsc-detail-Technology').getAttribute('data-state')).toBe('ok'))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [PREV]: NONE_YET })
    renderPanel({ season: 'previous' })
    await screen.findByTestId('terminal-ernsc-none-yet')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [CUR]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-ernsc-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
