// GRPS CROWDING (2026-11-22): the positioning view of the GRPS board, and one group's stocks. Rails:
//   * one lean read (`part=positioning`), never the default answer; the pick writes `GRPS CROWDING`;
//   * every figure says how many stocks it rests on, too few gives the count, the lists name each stock through the
//     kit's symbol cell (a click loads the linked panels), every column sorts (a blank last), a name still opens GRP;
//   * each part's date, cadence and coverage above the table (13F says why it is left out); a part not on hand, an
//     incomplete insider read and an answer from before positioning each said in words;
//   * a group's stock count opens its stocks with their own figures (their own read, sortable, each symbol the kit's
//     cell, row numbers published), and the way back; not found, an error with Retry;
//   * axe on the table and the stocks; no hard-coded colour in the new files.
// The fixtures are the route's real shape (api/services/group_stats.py `get_group_positioning`) with invented figures.
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
import { SECTOR_BOARD } from './__fixtures__/groupStatsFixture'
import {
  MEMBERS_NOT_FOUND, SECTOR_POSITIONING, SECTOR_POSITIONING_PARTS_DOWN, SECTOR_POSITIONING_PENDING, TECH_MEMBERS,
} from './__fixtures__/groupPositioningFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SECTORS = groupStatsUrl('sector')
const POS = groupStatsUrl('sector', null, 'positioning')
const TECH = groupStatsUrl('sector', 'Technology', 'positioning')
const HERE = path.dirname(fileURLToPath(import.meta.url))
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

function renderPanel(props = {}) {
  const ctl = { rerun: vi.fn(), open: vi.fn(), run: vi.fn(), publishRows: vi.fn(), publish: vi.fn() }
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={vi.fn()}>
        <PanelListContext.Provider value={ctl}>
          <TerminalPanelContext.Provider value={{ code: 'GRPS', density: 'comfortable', inset: true }}>
            <GroupTablePanel {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return ctl
}
const rows = () => within(screen.getByTestId('terminal-grps-table')).getAllByRole('row').slice(1)
const names = () => rows().map((r) => r.getAttribute('data-testid').replace('terminal-grps-row-', ''))
const heads = () => within(screen.getByTestId('terminal-grps-table')).getAllByRole('columnheader').map((th) => th.textContent.replace(/ [▲▼]$/, ''))
const visible = (td) => [...td.querySelectorAll('span[aria-hidden="true"], button')].map((s) => s.textContent).join(' | ')
const cellsOf = (name) => [...screen.getByTestId(`terminal-grps-row-${name}`).querySelectorAll('td')].slice(1).map(visible)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('GRPS CROWDING: what is read', () => {
  it('one lean read, never the default answer, with a skeleton while it loads', () => {
    serve({ [POS]: PENDING })
    renderPanel({ view: 'crowding' })
    expect(POS).toBe('/api/research/group-stats?kind=sector&part=positioning')
    expect(screen.getByTestId('terminal-grps-loading')).toBeTruthy()
    expect(asked()).toEqual([POS])
  })

  it('the pick reads the part and writes GRPS CROWDING; the default answer is never drawn as positioning', async () => {
    serve({ [SECTORS]: SECTOR_BOARD, [POS]: SECTOR_POSITIONING })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-grps-table')
    fireEvent.change(screen.getByTestId('terminal-grps-view'), { target: { value: 'crowding' } })
    expect(rerun).toHaveBeenLastCalledWith('GRPS CROWDING')
    await waitFor(() => expect(heads()).toContain('Short % float'))
    expect(asked()).toEqual([SECTORS, POS])
    expect(screen.getByTestId('terminal-grps').getAttribute('data-view')).toBe('crowding')
  })

  it('an answer for the other part is not drawn as this view (it waits for its own)', async () => {
    serve({ [POS]: SECTOR_BOARD })
    renderPanel({ view: 'crowding' })
    await waitFor(() => expect(jsonFetcher).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('terminal-grps-table')).toBeNull()
  })
})

describe('GRPS CROWDING populated', () => {
  it('⭐ each figure with how many stocks it rests on; too few gives the count; the lists name each stock', async () => {
    serve({ [POS]: SECTOR_POSITIONING })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    expect(heads()).toEqual(['Sector', 'Short % float', 'Days to cover', 'Short change', 'Most shorted', 'Insider buyers', 'Insider buying',
      'Funds adding', 'Fund shares'])
    expect(names()).toEqual(['Energy', 'Technology', 'Utilities'])
    const tech = cellsOf('Technology')
    expect(tech[0]).toBe('4.2% | of 50')
    expect(tech[1]).toBe('2.6 | of 50')
    expect(tech[2]).toBe('+3.5% | of 48')
    expect(tech[3]).toContain('QTKA')
    expect(tech[4]).toBe('9 | of 52, 17.3%')
    expect(tech[5]).toBe('$6.4M | 14 buys, some unpriced | QTKD | $2.5M | QTKD | $1.1M | QTKE | $900K')
    expect(tech[6]).toBe('62.0% | of 50')
    expect(cellsOf('Utilities')[0]).toBe('3 with data')
    expect(cellsOf('Utilities')[5]).toBe('No price | 1 buy')
    expect(cellsOf('Energy')[5]).toBe('None')
  })

  it('a listed stock is the kit\'s symbol cell: a click loads it into the linked panels', async () => {
    serve({ [POS]: SECTOR_POSITIONING })
    const { run } = renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    const row = screen.getByTestId('terminal-grps-row-Technology')
    fireEvent.click(within(row).getByRole('button', { name: 'Load QTKA' }))
    expect(run).toHaveBeenLastCalledWith('$QTKA')
    expect(within(row).getAllByRole('button', { name: 'Load QTKD' })).toHaveLength(2)        // two of the largest buys
  })

  it('every column sorts, highest first then lowest, a blank last either way; a name still opens GRP', async () => {
    serve({ [POS]: SECTOR_POSITIONING })
    const { open } = renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(screen.getByTestId('terminal-grps-sort-p:short_pct'))
    expect(names()).toEqual(['Energy', 'Technology', 'Utilities'])
    fireEvent.click(screen.getByTestId('terminal-grps-sort-p:short_pct'))
    expect(names()).toEqual(['Technology', 'Energy', 'Utilities'])
    fireEvent.click(screen.getByTestId('terminal-grps-sort-p:ins_value'))
    expect(names()).toEqual(['Technology', 'Energy', 'Utilities'])
    expect(screen.getByTestId('terminal-grps-table').getAttribute('aria-label')).toBe('Every sector, crowding (shorts, insiders, funds), by Insider buying, highest first')
    fireEvent.click(within(screen.getByTestId('terminal-grps-row-Energy')).getByRole('button', { name: /Open the stocks of Energy/ }))
    expect(open).toHaveBeenLastCalledWith('GRP SECTOR ENERGY')
  })

  it('each part\'s date, cadence and coverage sit above the table; 13F says why it is left out', async () => {
    serve({ [POS]: SECTOR_POSITIONING })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    // the dates and reach in one plain line; the full notes in a section that opens (closed at first, still read out)
    expect(screen.getByTestId('terminal-grps-pos-asof').textContent).toContain('FINRA settlement May 15, 2031 (2,950 of 3,051 stocks)')
    expect(screen.getByTestId('terminal-grps-pos-notes').tagName).toBe('DETAILS')
    expect(screen.getByTestId('terminal-grps-pos-notes').open).toBe(false)
    expect(screen.getByTestId('terminal-grps-pos-note-short').textContent).toContain('settlement May 15, 2031')
    expect(screen.getByTestId('terminal-grps-pos-note-insider').textContent).toContain('no sales total or net')
    expect(screen.getByTestId('terminal-grps-pos-note-funds').textContent).toContain('N-PORT data set 2031Q1')
    expect(screen.getByTestId('terminal-grps-pos-note-institutions').textContent).toContain('Institutions (13F): not shown.')
    expect(screen.getByTestId('terminal-grps-lede').textContent).toContain('each part has its own date, below')
    expect(screen.getByTestId('terminal-grps-method').textContent).toContain('A median or a share needs at least 5 stocks with a figure')
    expect(screen.queryByTestId('terminal-grps-fund-state')).toBeNull()
  })

  it('a part not on hand, an incomplete insider read and an answer from before positioning are said in words', async () => {
    serve({ [POS]: SECTOR_POSITIONING_PARTS_DOWN })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    expect(screen.getByTestId('terminal-grps-pos-note-short').textContent).toContain('the data plan did not answer')
    expect(screen.getByTestId('terminal-grps-pos-note-funds').textContent).toContain('has not built its N-PORT index yet')
    expect(screen.getByTestId('terminal-grps-pos-note-insider').textContent).toContain('the counts may be short')
    const tech = screen.getByTestId('terminal-grps-row-Technology').querySelectorAll('td')
    expect(tech[1].textContent).toBe('Short interest: not on hand.')
    cleanup()
    serve({ [POS]: SECTOR_POSITIONING_PENDING })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    expect(screen.getByTestId('terminal-grps-pos-note-pending').textContent).toContain('appears after the next evening build')
  })
})

describe('GRPS CROWDING: one group\'s stocks', () => {
  it('⭐ the stock count opens its stocks with their own figures, each the kit\'s symbol cell, and the way back', async () => {
    serve({ [POS]: SECTOR_POSITIONING, [TECH]: TECH_MEMBERS })
    const { run, publishRows } = renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(screen.getByTestId('terminal-grps-members-Technology'))
    await screen.findByTestId('terminal-grps-members-table')
    expect(asked()).toEqual([POS, TECH])
    expect(screen.getByTestId('terminal-grps-members-title').textContent).toBe('Technology')
    const syms = within(screen.getByTestId('terminal-grps-members-table')).getAllByRole('row').slice(1)
      .map((r) => r.getAttribute('data-testid').replace('terminal-grps-member-', ''))
    expect(syms).toEqual(['QTKA', 'QTKD', 'QTKF', 'QTKG'])                                    // the most shorted first
    const qtkf = [...screen.getByTestId('terminal-grps-member-QTKF').querySelectorAll('td')].slice(1).map(visible)
    expect(qtkf).toEqual(['No float | 0.9 days', 'No change', 'No price | 1 buy, last May 30, 2031', 'No earlier report', ''])
    fireEvent.click(within(screen.getByTestId('terminal-grps-member-QTKD')).getByRole('button', { name: 'Load QTKD' }))
    expect(run).toHaveBeenLastCalledWith('$QTKD')
    await waitFor(() => expect(publishRows).toHaveBeenCalledWith(['$QTKA', '$QTKD', '$QTKF', '$QTKG']))
    fireEvent.click(screen.getByTestId('terminal-grps-members-sort-buy_value'))
    expect(within(screen.getByTestId('terminal-grps-members-table')).getAllByRole('row')[1].getAttribute('data-testid')).toBe('terminal-grps-member-QTKD')
    fireEvent.click(screen.getByTestId('terminal-grps-members-back'))
    expect(await screen.findByTestId('terminal-grps-table')).toBeTruthy()
  })

  it('a group not in the evening\'s figures, and a failed read with Retry', async () => {
    serve({ [POS]: SECTOR_POSITIONING, [TECH]: MEMBERS_NOT_FOUND })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(screen.getByTestId('terminal-grps-members-Technology'))
    await screen.findByTestId('terminal-grps-members-not-found')
    cleanup()
    serve({ [POS]: SECTOR_POSITIONING, [TECH]: fail(500) })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    fireEvent.click(screen.getByTestId('terminal-grps-members-Technology'))
    const err = await screen.findByTestId('terminal-grps-members-error')
    expect(within(err).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('GRPS CROWDING follows the member\'s theme and passes axe', () => {
  it('the new files hold no hard-coded colour', () => {
    for (const f of ['GroupPositioningMembers.jsx', 'groupPositioningModel.js', 'groupPositioning.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the table and one group\'s stocks pass axe (WCAG A and AA)', async () => {
    serve({ [POS]: SECTOR_POSITIONING, [TECH]: TECH_MEMBERS })
    renderPanel({ view: 'crowding' })
    await screen.findByTestId('terminal-grps-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-grps-members-Technology'))
    await screen.findByTestId('terminal-grps-members-table')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
