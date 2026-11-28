// Bare FTD (2026-11-27): the biggest fails-to-deliver across the market, and its pure half.
//   * ranked by one day's balance, never a sum; the period is named; price is the SEC file's own;
//   * a cut list says so from which end; nothing read, nothing reported and a failed read are three states;
//   * the rank dropdown writes FTD VALUE back; a symbol loads into the linked panels; axe finds nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import FtdMarketPanel from './FtdMarketPanel'
import { PANEL_IMPORTERS } from '../panels'
import { ftdCommandArgs, ftdCutNote, ftdMarketRead, ftdMarketUrl, normFtdRank, parseFtdRank } from './ftdMarketModel'

const pt = (d, q, px) => ({ settle_date: d, quantity: q, price: px, value: px == null ? null : q * px })
const BODY = (over = {}) => ({
  state: 'ok', rank: 'shares', cap: 50, file: 'cnsfails202610b', period: { from: '2026-10-16', through: '2026-10-31' },
  settle_dates: 11, securities: 812, total: 812, cut: true, no_price: 3, count_mismatch: false,
  rows: [
    { symbol: 'ZBIG', description: 'BIG FAILS INC', days_listed: 9, peak: pt('2026-10-20', 4200000, 2.5), peak_value: pt('2026-10-20', 4200000, 2.5), latest: pt('2026-10-31', 1000000, 2) },
    { symbol: 'ZNOP', description: 'NO PRICE TRUST', days_listed: 2, peak: pt('2026-10-22', 300000, null), peak_value: null, latest: pt('2026-10-22', 300000, null) },
  ],
  ...over,
})

function renderPanel(props = {}) {
  const api = { open: vi.fn(), run: vi.fn(), publish: vi.fn(), publishRows: vi.fn(), rerun: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}>
        <TerminalPanelContext.Provider value={{ code: 'FTD', density: 'comfortable', inset: true }}>
          <FtdMarketPanel {...props} />
        </TerminalPanelContext.Provider>
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { ...view, api }
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('the pure half', () => {
  it('words, URL and write-back', () => {
    expect(parseFtdRank('dollars')).toBe('value')
    expect(normFtdRank(undefined)).toBe('shares')
    expect(ftdMarketUrl()).toBe('/api/research/ftd-market?rank=shares')
    expect(ftdMarketUrl('value')).toBe('/api/research/ftd-market?rank=value')
    expect(ftdCommandArgs('shares')).toEqual([])
    expect(ftdCommandArgs('value')).toEqual(['VALUE'])
  })

  it('reads the body; a missing price stays missing; the cut note names the end', () => {
    const v = ftdMarketRead(BODY())
    expect(v.state).toBe('ok')
    expect(v.rows[1].peak).toEqual({ date: '2026-10-22', shares: 300000, price: null, value: null })
    expect(v.rows[1].peakValue).toBeNull()
    expect(ftdCutNote(v)).toBe('Showing the 2 largest of 812 securities by shares failed.')
    expect(ftdCutNote(ftdMarketRead(BODY({ cut: false })))).toBeNull()
    expect(ftdMarketRead(null).state).toBe('unknown')
    expect(ftdMarketRead({ state: 'not_ingested', rows: [] }).state).toBe('not_ingested')
  })
})

describe('FTD, the whole market', () => {
  it('lists the largest fails with the day, the SEC price and the days listed, and names the period', async () => {
    jsonFetcher.mockResolvedValue(BODY())
    const { api } = renderPanel()
    await screen.findByTestId('terminal-ftdm-table')
    expect(jsonFetcher.mock.calls[0][0]).toBe('/api/research/ftd-market?rank=shares')
    const big = screen.getByTestId('terminal-ftdm-row-ZBIG').textContent
    for (const s of ['ZBIG', 'BIG FAILS INC', '4.2M', '2026-10-20', '$10.5M', 'at $2.50', '1.0M', '2026-10-31', '9 of 11']) expect(big).toContain(s)
    const nop = screen.getByTestId('terminal-ftdm-row-ZNOP').textContent
    expect(nop).toContain('no price in the file')
    expect(nop).not.toContain('$0')
    expect(screen.getByTestId('terminal-ftdm-cut').textContent).toBe('Showing the 2 largest of 812 securities by shares failed.')
    const method = screen.getByTestId('terminal-ftdm-method').textContent
    expect(method).toContain('2026-10-16 to 2026-10-31')
    expect(method).toContain('never a sum of days')
    const headers = within(screen.getByTestId('terminal-ftdm-table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Symbol', 'Largest fail', 'Value', 'Newest', 'Days listed'])
    expect(api.publishRows).toHaveBeenLastCalledWith(['$ZBIG', '$ZNOP'])
  })

  it('FTD VALUE reads the value order and says what has no price', async () => {
    jsonFetcher.mockResolvedValue(BODY({ rank: 'value', rows: [BODY().rows[0]], total: 809 }))
    renderPanel({ rank: 'value' })
    await screen.findByTestId('terminal-ftdm-table')
    expect(jsonFetcher.mock.calls[0][0]).toBe('/api/research/ftd-market?rank=value')
    expect(screen.getByTestId('terminal-ftdm-method').textContent).toContain('3 with no price in the file are left out of this order.')
  })

  it('the rank dropdown writes FTD VALUE back', async () => {
    jsonFetcher.mockResolvedValue(BODY())
    const { api } = renderPanel()
    await screen.findByTestId('terminal-ftdm-table')
    fireEvent.change(screen.getByTestId('terminal-ftdm-rank'), { target: { value: 'value' } })
    expect(api.rerun).toHaveBeenLastCalledWith('FTD VALUE')
  })

  it('nothing read yet, nothing reported and a failed read are three different sentences', async () => {
    jsonFetcher.mockResolvedValue({ state: 'not_ingested', rows: [] })
    renderPanel()
    expect((await screen.findByTestId('terminal-ftdm-none-read')).textContent).toContain('not the same as no fails')
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue({ state: 'none_reported', rows: [], period: { from: '2026-10-16', through: '2026-10-31' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-ftdm-empty')).textContent).toContain('between 2026-10-16 and 2026-10-31')
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    const err = await screen.findByTestId('terminal-ftdm-error')
    expect(err.textContent).toContain('could not be read just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('off'), { status: 404 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-ftdm-error')).textContent).toContain('not switched on')
  })

  it('is registered, and passes axe with rows and when nothing is read', async () => {
    expect((await PANEL_IMPORTERS.FtdMarket()).default).toBe(FtdMarketPanel)
    jsonFetcher.mockResolvedValue(BODY())
    const a = renderPanel()
    await screen.findByTestId('terminal-ftdm-table')
    await expectNoAxeViolations(a.container)
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue({ state: 'not_ingested', rows: [] })
    const b = renderPanel()
    await screen.findByTestId('terminal-ftdm-none-read')
    await expectNoAxeViolations(b.container)
  })
})
