// Settings pass (2026-11-28, gap audit C6): the per-stock panels that had no kept settings. All are VIEW settings
// (the answer already holds what they choose between), so each: defaults to today's panel and stores nothing,
// changes what it should, and survives a remount from the saved record.
//   STAT  the drawdown list: every decline listed (the server's 20% floor), or 30%+ / 50%+ only
//   VFP   the gap list: up and down / up / down; every size / 5%+ / 10%+; not filled yet
//   SHINT "show more reports" and "show all days" (were component state, lost on reload)
//   DILU  "show all filings" and "also list employee plan and agreement filings" (likewise)
//   CACT  "show all splits" / "show all dividends" (likewise)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext } from '../../../components/terminal'
import { ViewHost, savedView } from '../__tests__/panelViewHarness'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import StockStatsPanel from './StockStatsPanel'
import { STAT_DEPTHS, deeperThan, statUrl } from './stockStatsModel'
import VolumeFootprintPanel from './VolumeFootprintPanel'
import { filterGaps, gapFilterWords, vfpUrl } from './volumeFootprintModel'
import ShortInterestPanel from './ShortInterestPanel'
import DilutionPanel from './DilutionPanel'
import CorporateActionsPanel from './CorporateActionsPanel'
import { statAnswer } from './__fixtures__/stockStatsFixture'
import { vfpAnswer } from './__fixtures__/volumeFootprintFixture'

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
function serve(routes) {
  jsonFetcher.mockImplementation((u) => (routes[u] === undefined ? Promise.reject(fail(500)) : Promise.resolve(routes[u])))
}
function mount(node, saved = savedView()) {
  const view = render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={vi.fn()}>
          <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
            <ViewHost saved={saved}>{node}</ViewHost>
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
  return { saved, ...view }
}
const pressed = (id) => screen.getByTestId(id).getAttribute('aria-pressed')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// ── STAT ──
describe('STAT drawdown depth (view)', () => {
  const episodes = statAnswer().drawdowns.episodes
  const deep = (z) => episodes.filter((e) => Math.abs(e.depth_pct) >= z).length

  it('pure: 0 is every listed decline; a floor keeps the deeper ones by size, whatever the sign', () => {
    const list = [{ depthPct: -78 }, { depthPct: -20.7 }, { depthPct: null }, { depthPct: -31 }]
    expect(deeperThan(list, 0)).toBe(list)
    expect(deeperThan(list, 30)).toEqual([{ depthPct: -78 }, { depthPct: -31 }])
    expect(deeperThan(list, 50)).toEqual([{ depthPct: -78 }])
    expect(deeperThan(list, 7)).toBe(list)                      // not offered: every decline
    expect(STAT_DEPTHS).toEqual([0, 30, 50])
  })

  it('lists every decline by default; 30%+ narrows it, says so, and survives a remount', async () => {
    serve({ [statUrl('NVDA')]: statAnswer() })
    const first = mount(<StockStatsPanel sym="NVDA" />)
    await screen.findByTestId('terminal-stat-drawdown-table')
    expect(screen.getAllByTestId('terminal-stat-drawdown')).toHaveLength(episodes.length)
    expect(pressed('terminal-stat-depth-0')).toBe('true')
    expect(screen.getByTestId('terminal-stat-depth-0').textContent).toBe('20%+')
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-stat-depth-30'))
    expect(screen.getAllByTestId('terminal-stat-drawdown')).toHaveLength(deep(30))
    expect(deep(30)).toBeLessThan(episodes.length)
    expect(screen.getByTestId('terminal-stat-depth-shown').textContent).toBe(`Showing the ${deep(30)} of ${episodes.length} declines listed that were 30% or deeper.`)
    expect(first.saved.view).toEqual({ filters: { depth: 30 } })
    first.unmount()
    mount(<StockStatsPanel sym="NVDA" />, first.saved)
    await screen.findByTestId('terminal-stat-drawdown-table')
    expect(screen.getAllByTestId('terminal-stat-drawdown')).toHaveLength(deep(30))
  })

  it('a floor no listed decline reaches says so, with a way back', async () => {
    const body = statAnswer()
    body.drawdowns.episodes = body.drawdowns.episodes.filter((e) => Math.abs(e.depth_pct) < 30)
    serve({ [statUrl('NVDA')]: body })
    mount(<StockStatsPanel sym="NVDA" />, savedView({ filters: { depth: 50 } }))
    const empty = await screen.findByTestId('terminal-stat-depth-empty')
    expect(empty.textContent).toContain(`None of the ${body.drawdowns.episodes.length} declines listed for NVDA was 50% or deeper.`)
    fireEvent.click(within(empty).getByRole('button'))
    expect(screen.getAllByTestId('terminal-stat-drawdown')).toHaveLength(body.drawdowns.episodes.length)
  })
})

// ── VFP ──
describe('VFP gap list (view)', () => {
  const raw = vfpAnswer().gaps.rows
  const count = (f) => raw.filter(f).length
  const dirs = () => screen.getAllByTestId('terminal-vfp-gap').map((r) => r.dataset.dir)

  it('pure: side, size and not filled combine; the default is every listed gap; the words say the filters', () => {
    const rows = [{ up: true, gapPct: 3.5, filled: null }, { up: false, gapPct: -12, filled: '2026-01-02' }, { up: true, gapPct: 11, filled: '2026-01-03' }]
    expect(filterGaps(rows)).toHaveLength(3)
    expect(filterGaps(rows, { side: 'up' })).toHaveLength(2)
    expect(filterGaps(rows, { size: 10 })).toHaveLength(2)          // a down gap counts by its size
    expect(filterGaps(rows, { side: 'up', size: 10 })).toEqual([rows[2]])
    expect(filterGaps(rows, { open: true })).toEqual([rows[0]])
    expect(gapFilterWords({ side: 'up', size: 5, open: true })).toBe('up gaps of 5% or more, not filled yet')
    expect(gapFilterWords({})).toBe('gaps')
  })

  it('lists every gap by default; Up and 10%+ narrow it, say so, and survive a remount', async () => {
    serve({ [vfpUrl('NVDA')]: vfpAnswer() })
    const first = mount(<VolumeFootprintPanel sym="NVDA" />)
    await screen.findByTestId('terminal-vfp-gaps-table')
    expect(dirs()).toHaveLength(raw.length)
    expect(screen.getByTestId('terminal-vfp-gap-size-0').textContent).toBe('3%+')
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-vfp-gap-side-up'))
    expect(dirs()).toHaveLength(count((r) => r.up))
    expect(new Set(dirs())).toEqual(new Set(['up']))
    fireEvent.click(screen.getByTestId('terminal-vfp-gap-size-10'))
    const want = count((r) => r.up && Math.abs(r.gap_pct) >= 10)
    expect(dirs()).toHaveLength(want)
    expect(screen.getByTestId('terminal-vfp-gaps-filtered').textContent).toContain(`Showing ${want} of the ${raw.length} newest gaps listed: up gaps of 10% or more.`)
    expect(first.saved.view).toEqual({ filters: { gapSide: 'up', gapSize: 10 } })
    first.unmount()
    mount(<VolumeFootprintPanel sym="NVDA" />, first.saved)
    await screen.findByTestId('terminal-vfp-gaps-table')
    expect(dirs()).toHaveLength(want)
    // the counts above the list always take in every gap
    expect(screen.getByTestId('terminal-vfp-fills')).toBeTruthy()
  })

  it('not filled yet keeps only the open gaps; a filter nothing passes says so with a way back', async () => {
    serve({ [vfpUrl('NVDA')]: vfpAnswer() })
    mount(<VolumeFootprintPanel sym="NVDA" />, savedView({ filters: { gapOpen: true } }))
    await screen.findByTestId('terminal-vfp-gaps-table')
    expect(screen.getAllByTestId('terminal-vfp-gap')).toHaveLength(count((r) => !r.filled))
    expect(screen.getAllByTestId('terminal-vfp-gap').every((r) => r.dataset.fill !== 'filled')).toBe(true)
    cleanup()
    const body = vfpAnswer()
    body.gaps.rows = body.gaps.rows.filter((r) => Math.abs(r.gap_pct) < 10)
    serve({ [vfpUrl('NVDA')]: body })
    mount(<VolumeFootprintPanel sym="NVDA" />, savedView({ filters: { gapSize: 10 } }))
    const empty = await screen.findByTestId('terminal-vfp-gaps-filtered-empty')
    expect(empty.textContent).toContain('matches: gaps of 10% or more.')
    fireEvent.click(within(empty).getByRole('button'))
    expect(screen.getAllByTestId('terminal-vfp-gap')).toHaveLength(body.gaps.rows.length)
  })
})

// ── SHINT ──
const SHINT_URL = '/api/research/short-data/ZZA'
const DATES = Array.from({ length: 14 }, (_, i) => `2026-${String(11 - Math.floor(i / 2)).padStart(2, '0')}-${i % 2 ? '15' : '28'}`)
const shint = () => ({
  status: 'ok', sym: 'ZZA', settlement_date: DATES[0], published: null, publication_estimate: '2026-11-10', read_at: '2026-11-18T15:02:11+00:00', source: 'FINRA',
  interest: { state: 'ok', http_status: 200, reason: null, count: 14, cut: false, first_date: DATES[13],
    reports: DATES.map((d) => ({ settlement_date: d, short_interest: 1e6, avg_daily_volume: 5e5, days_to_cover: 2, change_shares: 0, change_pct: 0 })) },
  volume: { state: 'ok', http_status: 200, reason: null, count: 12, window_days: 60,
    days: Array.from({ length: 12 }, (_, i) => ({ date: `2026-11-${String(17 - i).padStart(2, '0')}`, short_volume: 4e5, total_volume: 1e6, short_volume_ratio: 40 })) },
  float: { shares: 1e7, pct_float: 10, withheld: false, state: 'ok', source: 'x' },
})

describe('SHINT kept switches (view)', () => {
  it('12 reports and 10 days by default; both "show more" switches are kept with the board', async () => {
    serve({ [SHINT_URL]: shint() })
    const first = mount(<ShortInterestPanel sym="zza" />)
    const table = await screen.findByTestId('terminal-short-reports')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-short-more-reports'))
    fireEvent.click(screen.getByTestId('terminal-short-more-days'))
    expect(first.saved.view).toEqual({ filters: { moreReports: true, allDays: true } })
    first.unmount()
    mount(<ShortInterestPanel sym="zza" />, first.saved)
    expect((await screen.findByTestId('terminal-short-reports')).querySelectorAll('tbody tr')).toHaveLength(14)
    expect(pressed('terminal-short-more-reports')).toBe('true')
    expect(pressed('terminal-short-more-days')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-short-more-reports'))
    fireEvent.click(screen.getByTestId('terminal-short-more-days'))
    expect(first.saved.view).toBeNull()
  })
})

// ── DILU ──
const DILU_URL = '/api/research/dilution-watch/ZZA'
let seq = 0
const drow = (date, form, kind, what) => { seq += 1; return { date, form, kind, what, accession: `a-${seq}`, url: `https://www.sec.gov/x/${seq}`, file_number: '333-1', items: [], under: null } }
const dilu = () => {
  const rows = Array.from({ length: 24 }, (_, i) => drow(`2026-${String(10 - Math.floor(i / 3)).padStart(2, '0')}-${String(28 - (i % 3)).padStart(2, '0')}`, '424B2', 'offering', 'Prospectus supplement'))
  rows.push(drow('2024-02-01', 'S-8', 'plan', 'Employee plan registration'))
  const z = { m12: 0, y3: 0, latest: null }
  return {
    status: 'ok', sym: 'ZZA', cik: '1', company: 'Acme', entity_type: 'operating', fund_like: false,
    window: { years: 3, from: '2023-11-18', to: '2026-11-18', recent_months: 12, recent_from: '2025-11-18' },
    coverage: { complete: true, from: '2023-11-18', requests: 1, pages_unread: 0 }, newest_filing: '2026-10-28',
    summary: { live_shelves: 0, newest_live_shelf: null, pending_shelves: 0, newest_pending_shelf: null, offerings: { m12: 24, y3: 24, latest: '2026-10-28' }, unregistered: z, registrations: z },
    shelves: [], shelf_life_years: 3, rows, rows_total: rows.length, cut: false, counts: {}, read_at: '2026-11-18T15:02:11+00:00', source: 'SEC EDGAR filings',
  }
}
const diluRows = () => screen.getByTestId('terminal-dilution-table').querySelectorAll('tbody tr').length

describe('DILU kept switches (view)', () => {
  it('20 filings without the minor ones by default; "show all" and "also list" are kept with the board', async () => {
    serve({ [DILU_URL]: dilu() })
    const first = mount(<DilutionPanel sym="zza" />)
    await screen.findByTestId('terminal-dilution-table')
    expect(diluRows()).toBe(20)
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-dilution-more'))
    fireEvent.click(screen.getByTestId('terminal-dilution-minor'))
    expect(diluRows()).toBe(25)
    expect(first.saved.view).toEqual({ filters: { allRows: true, withMinor: true } })
    first.unmount()
    mount(<DilutionPanel sym="zza" />, first.saved)
    await screen.findByTestId('terminal-dilution-table')
    expect(diluRows()).toBe(25)
    expect(pressed('terminal-dilution-minor')).toBe('true')
  })
})

// ── CACT ──
const CACT_URL = '/api/research/corporate-actions/ZZA'
const CACT_NAMES = '/api/research/rename-notice/ZZA'
const cact = () => ({
  sym: 'ZZA', status: 'ok', held_at: '2026-11-17T14:02:11+00:00', source: 'massive', row_cap: 60,
  splits: { rows: [{ date: '2024-06-10', ratio: '10:1', to_factor: 10 }], total: 1, window_years: 45 },
  dividends: { rows: Array.from({ length: 14 }, (_, i) => ({ date: `20${25 - Math.floor(i / 12)}-${String(12 - (i % 12)).padStart(2, '0')}-10`, amount: 0.5 })), total: 14, window_years: 5, basis: 'split_adjusted' },
})
const CLEAN = { sym: 'ZZA', state: 'ok', source: 'entity_master', current: { entity_id: 'e', ambiguous: false, formerly: [] }, previous_holders: [] }
const divRows = () => screen.getByTestId('terminal-cact-dividends').querySelectorAll('tbody tr').length

describe('CACT kept switches (view)', () => {
  it('12 dividends by default; "show all" is kept with the board, per list', async () => {
    serve({ [CACT_URL]: cact(), [CACT_NAMES]: CLEAN })
    const first = mount(<CorporateActionsPanel sym="zza" />)
    await screen.findByTestId('terminal-cact-dividends')
    expect(divRows()).toBe(12)
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-cact-dividends-more'))
    expect(divRows()).toBe(14)
    expect(first.saved.view).toEqual({ filters: { allDividends: true } })
    first.unmount()
    const again = mount(<CorporateActionsPanel sym="zza" />, first.saved)
    await screen.findByTestId('terminal-cact-dividends')
    expect(divRows()).toBe(14)
    await expectNoAxeViolations(again.container)
  })
})

describe('the settings pass a11y (per stock)', () => {
  it('the STAT and VFP pickers have no axe violations', async () => {
    serve({ [statUrl('NVDA')]: statAnswer(), [vfpUrl('NVDA')]: vfpAnswer() })
    const { container } = mount(<><StockStatsPanel sym="NVDA" /><VolumeFootprintPanel sym="NVDA" /></>)
    await screen.findByTestId('terminal-stat-drawdown-table')
    await screen.findByTestId('terminal-vfp-gaps-table')
    await expectNoAxeViolations(container)
  })
})
