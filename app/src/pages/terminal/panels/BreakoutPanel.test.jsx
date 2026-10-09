// BRKO: the breakout-ready list. Rails:
//   * ONE read: POST /api/screener/scan with the frozen spec (no new route, no per-request scan);
//   * closest to its pivot first, sortable, aria-sort says which way, a reset returns to that order;
//   * a ticker loads into the linked panels; Plan opens PLAN on that name;
//   * the as-of date is shown, the empty answer says the scan found nothing today;
//   * a failed read is an error with Retry, never "nothing today"; a 402 is locked;
//   * the registry: `BRKO` resolves to this panel, market-only, and is not a ticker in the universe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import BreakoutPanel, { BRKO_SPEC, BRKO_URL, breakoutRows, pivotText, planCmd, setupLabel } from './BreakoutPanel'
import { BY_CODE, CODE_ALIASES, RETIRED, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'

const SCAN = {
  total: 3,
  snapshot_date: '2026-10-08',
  rows: [
    { ticker: 'AMD', company: 'Advanced Micro', price: 100, rs_rank: 91, close_cv_pct: 2.5,
      pattern_engine_ids: ',bull_flag,', pattern_entry_dist_pct: 4, snapshot_date: '2026-10-08' },
    { ticker: 'NVDA', company: 'Nvidia', price: 200, rs_rank: 98, close_cv_pct: 1.2,
      pattern_engine_ids: ',flat_base,vcp,', pattern_entry_dist_pct: 1.5, snapshot_date: '2026-10-08' },
    { ticker: 'CRWD', company: 'CrowdStrike', price: 300, rs_rank: 85, close_cv_pct: 3.1,
      pattern_engine_ids: null, base_render: 'Cup', pattern_entry_dist_pct: -0.8, snapshot_date: '2026-10-08' },
  ],
}

function renderPanel({ open = vi.fn(), run = vi.fn(), publishRows = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={{ open, run, publish: vi.fn(), publishRows }}>
        <BreakoutPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, run, publishRows }
}
const symsInTable = () => within(screen.getByTestId('terminal-brko-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-brko-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('BRKO model', () => {
  it('names VCP and flat base first, then the engine order, then the base shape', () => {
    expect(setupLabel(',flat_base,vcp,')).toBe('VCP, Flat base')
    expect(setupLabel(',bull_flag,')).toBe('Bull flag')
    expect(setupLabel(',some_new_thing,')).toBe('Some new thing')
    expect(setupLabel(null, 'Cup')).toBe('Cup')
    expect(setupLabel('', null)).toBe('Pattern')
  })

  it('derives the pivot from price and distance, and orders closest first', () => {
    const b = breakoutRows(SCAN)
    expect(b.rows.map((r) => r.sym)).toEqual(['CRWD', 'NVDA', 'AMD'])
    expect(b.rows.find((r) => r.sym === 'NVDA').pivot).toBeCloseTo(203, 6)
    expect(b.asOf).toBe('2026-10-08')
    expect(b.total).toBe(3)
  })

  it('Plan prefills the pivot as the buy point, or opens a bare PLAN without one', () => {
    expect(planCmd({ sym: 'NVDA', pivot: 203 })).toBe('NVDA PLAN 203.00')
    expect(planCmd({ sym: 'NVDA', pivot: null })).toBe('NVDA PLAN')
  })

  it('a row with no pivot distance is not listed', () => {
    expect(breakoutRows({ rows: [{ ticker: 'X', pattern_entry_dist_pct: null }] }).rows).toEqual([])
  })

  it('says below or through in words', () => {
    expect(pivotText(3.24)).toBe('3.2% below')
    expect(pivotText(-1.04)).toBe('1.0% through')
    expect(pivotText(0.01)).toBe('At pivot')
    expect(pivotText(null)).toBe('n/a')
  })

  it('the spec reads the precomputed snapshot with bounded, existing screener filters', () => {
    const keys = BRKO_SPEC.filters.map((f) => f.key)
    expect(keys).toEqual(['pattern_engine_dir', 'pattern_entry_dist_pct', 'close_cv_pct', 'rs_line_trend', 'rs_rank'])
    expect(BRKO_SPEC.page_size).toBeLessThanOrEqual(500)
    // Every filter key is a real screener filter (api/services/screener/filters.py), read as text.
    const filtersPy = fs.readFileSync(path.join(process.cwd(), '..', 'api', 'services', 'screener', 'filters.py'), 'utf8')
    for (const k of keys) expect(filtersPy, `${k} is a screener filter`).toMatch(new RegExp(`"${k}"`))
  })
})

describe('BRKO panel', () => {
  it('lists closest to pivot first with setup, distance, RS, tightness and as-of; a ticker loads and PLAN opens', async () => {
    jsonFetcher.mockResolvedValue(SCAN)
    const { open, run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-brko-table')
    expect(symsInTable()).toEqual(['CRWD', 'NVDA', 'AMD'])
    const nvda = screen.getByTestId('terminal-brko-row-NVDA').textContent
    for (const s of ['VCP, Flat base', '1.5% below', '$203.00', '98', '1.2%', '2026-10-08']) expect(nvda).toContain(s)
    expect(screen.getByTestId('terminal-brko-row-CRWD').textContent).toContain('0.8% through')
    // Linked panels (2026-10-09): a ticker LOADS into the list's group, like its row number.
    fireEvent.click(screen.getByTestId('panel-symbol-NVDA'))
    expect(run).toHaveBeenCalledWith('$NVDA')
    fireEvent.click(screen.getByTestId('panel-command-NVDA-PLAN-203.00'))
    expect(open).toHaveBeenCalledWith('NVDA PLAN 203.00')
    expect(publishRows).toHaveBeenLastCalledWith(['$CRWD', '$NVDA', '$AMD'])
    expect(screen.getByTestId('terminal-brko-method').textContent).toContain('as of 2026-10-08')
    const [url, init] = jsonFetcher.mock.calls[0]
    expect(url).toBe(BRKO_URL)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(JSON.parse(JSON.stringify(BRKO_SPEC)))
  })

  it('renders the scan\'s own four-count receipt when the server sends one, and nothing invented when not', async () => {
    jsonFetcher.mockResolvedValue({ ...SCAN, coverage: { evaluated: 10, answered: 8, dropped: 0, not_computable: 2, withheld: 0, dropped_symbols: [] } })
    renderPanel()
    expect((await screen.findByTestId('coverage-line')).textContent).toContain('evaluated')
    cleanup()
    jsonFetcher.mockResolvedValue(SCAN)
    renderPanel()
    await screen.findByTestId('terminal-brko-table')
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })

  it('sorts by a column and resets to closest-first', async () => {
    jsonFetcher.mockResolvedValue(SCAN)
    renderPanel()
    await screen.findByTestId('terminal-brko-table')
    fireEvent.click(screen.getByTestId('terminal-brko-sort-rs'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD', 'CRWD'])
    expect(screen.getByTestId('terminal-brko-sort-rs').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-brko-sort-tight'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD', 'CRWD'])
    fireEvent.click(screen.getByTestId('terminal-brko-sort-reset'))
    expect(symsInTable()).toEqual(['CRWD', 'NVDA', 'AMD'])
  })

  it('an empty scan says nothing passed today, not that the read failed', async () => {
    jsonFetcher.mockResolvedValue({ total: 0, rows: [], snapshot_date: '2026-10-08' })
    renderPanel()
    expect((await screen.findByTestId('terminal-brko-empty')).textContent).toContain("No breakout-ready names in today's scan.")
    expect(screen.queryByTestId('terminal-brko-error')).toBeNull()
  })

  it('a failed read is an error with Retry, never empty; a 402 says paid plan', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-brko-error')).textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-brko-empty')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(SCAN)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-brko-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('pay'), { status: 402 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-brko-error')).textContent).toContain('needs a paid plan')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a 400 (a snapshot column not built yet) says so', async () => {
    jsonFetcher.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 400 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-brko-error')).textContent).toContain('missing a column')
  })
})

describe('BRKO registry', () => {
  it('is a market-only panel code backed by this module', async () => {
    expect(BY_CODE.BRKO.market.panel).toBe('Breakout')
    expect(BY_CODE.BRKO.ticker).toBeUndefined()
    expect(variantFor('BRKO', false).variant.panel).toBe('Breakout')
    const mod = await PANEL_IMPORTERS.Breakout()
    expect(mod.default).toBe(BreakoutPanel)
  })

  it('collides with no alias, retired code or tracked ticker', () => {
    expect(CODE_ALIASES.BRKO).toBeUndefined()
    expect(RETIRED.BRKO).toBeUndefined()
    const uni = fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')
    expect(uni).not.toMatch(/"BRKO"/)
  })
})
