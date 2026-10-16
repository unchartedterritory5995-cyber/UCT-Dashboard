// CHK: the pre-trade check. Rails:
//   * every section loads and fails on its own: a failed risk read is an error with Retry while the
//     checklist, win rate and past trades still render; a 402 says paid plan;
//   * the engine's own "not loaded" answer is said in words, never drawn as data;
//   * entry and stop go through sizeMath.checkLevels: a stop on the wrong side is refused in the
//     SIZE sentence and no checklist is asked for;
//   * the entry is prefilled from the live price; the member's typing wins;
//   * the reads carry the setup, phase, entry and stop the routes take, under CHK's own SWR key;
//   * the panel links GRADE and SIZE for the same ticker;
//   * the registry: `NVDA CHK` opens this panel, ticker-only;
//   * the team archive is its OWN labelled section, never merged into the engine's rows; switched
//     off (404) it draws nothing; with no engine setup list the picker offers the archive's setups.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
const live = vi.hoisted(() => ({ prices: {} }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: () => ({ prices: live.prices, isLoading: false, error: null }),
}))

import jsonFetcher from '../../../utils/jsonFetcher'
import CheckPanel, { chkKey } from './CheckPanel'
import {
  ARCHIVE_PLAYBOOKS_URL, RISK_URL, TEMPLATES_URL, analogRows, analogsUrl, archiveCallRows, archiveCheckUrl,
  archiveSetupOptions, bookChecks, checklistChecks, checklistUrl, phaseOf, perfUrl, riskEngineMissing,
  setupOptions, tickerAnalogsUrl, tickerAnalogView, journalTradesUrl, journalRows,
} from './checkModel'
import { checkLevels, computeSize } from './sizeMath'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const TEMPLATES = { templates: [
  { name: 'VCP', family: 'Breakout' }, { name: 'Episodic Pivot', family: 'Gap' }, { name: 'VCP', family: 'Breakout' },
], count: 3 }
const RISK = {
  heat: { total_heat_pct: 2.5, position_count: 2, per_position: [], warnings: [] },
  sectors: {}, protocol: {}, limits: { exposure: 70, max_position: 15, max_positions: 8 },
  regime_phase: 'Pullback', regime_exposure_pct: 70, current_exposure_pct: 60, open_position_count: 3,
}
const CHECKLIST = {
  symbol: 'NVDA', setup_type: 'VCP', template_found: true,
  regime: { phase: 'Pullback', trend_score: 6, exposure_pct: 70, regime_compatible: false },
  risk: { entry_price: 100, stop_price: 95, stop_distance_pct: 5, position_size_pct: 20, account_risk_pct: 1,
    max_stop_pct: 8, stop_within_max: true },
  setup_performance: {},
  template_rules: { entry_trigger: 'Break of the pivot on volume', stop_method: 'Below the last contraction', invalidation: 'Closes back in the base' },
}
const PERF = { win_rate_pct: 61.5, total_trades: 26, avg_gain_pct: 14.2, avg_loss_pct: -5.1, expectancy: 6.8 }
const ANALOGS = { analogs: [
  { symbol: 'smci', date_flagged: '2024-01-18', setup_type: 'VCP', status: 'CLOSED', entry_price: 300, pct_change: 42.5, days_held: 21 },
  { symbol: 'ANF', date_flagged: '2023-11-02', setup_type: 'VCP', status: 'STOPPED', entry_price: 70, pct_change: -6.2, days_held: 4 },
], count: 2 }
const MINE = { analogs: [
  { symbol: 'NVDA', date_flagged: '2024-05-22', setup_type: 'VCP', status: 'CLOSED', entry_price: 950, pct_change: 18.4, days_held: 9 },
], count: 1, symbol: 'NVDA', scanned: 37, complete: true }
const JOURNAL = { trades: [
  { id: 't1', symbol: 'NVDA', side: 'Long', entryDate: '2026-08-03T00:00:00Z', exitDate: '2026-08-10T00:00:00Z', setup: 'VCP', pnlPercent: 0.081, rMultiple: 2.4 },
  { id: 't2', symbol: 'NVDAX', side: 'Long', entryDate: '2026-07-01', exitDate: '2026-07-02', setup: 'VCP', pnlPercent: 0.5, rMultiple: 9 },
  { id: 't3', symbol: 'NVDA', side: 'Short', entryDate: '2026-05-04', exitDate: '2026-05-06', setup: '', pnlPercent: -0.032, rMultiple: -1 },
], total: 3, limit: 50, offset: 0 }

/** Serve each URL; `over` replaces a body by a URL prefix (an Error is thrown). */
function serve(over = {}) {
  jsonFetcher.mockImplementation(async (url) => {
    for (const [prefix, v] of Object.entries(over)) {
      if (url.startsWith(prefix)) { if (v instanceof Error) throw v; return v }
    }
    if (url === TEMPLATES_URL) return TEMPLATES
    if (url === RISK_URL) return RISK
    if (url.startsWith('/api/pre-trade-checklist')) return CHECKLIST
    if (url.startsWith('/api/setup-performance/')) return { setup_type: 'VCP', regime: 'x', data: PERF }
    if (url.startsWith('/api/analogs') && url.includes('&symbol=')) return MINE
    if (url.startsWith('/api/analogs')) return ANALOGS
    if (url.startsWith('/api/j2/trades')) return JOURNAL
    // The team archive is switched off unless a test turns it on.
    if (url.startsWith('/api/wisdom/archive/')) throw Object.assign(new Error('404'), { status: 404 })
    throw Object.assign(new Error(`unserved ${url}`), { status: 500 })
  })
}
const err = (status) => Object.assign(new Error(String(status)), { status })
function renderPanel(sym = 'NVDA') {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CheckPanel sym={sym} /></SWRConfig>)
}
const asked = (prefix) => jsonFetcher.mock.calls.map(([u]) => u).filter((u) => u.startsWith(prefix))

async function plan({ setup = 'VCP', entry = '100', stop = '95' } = {}) {
  const select = await screen.findByTestId('terminal-chk-setup-pick')
  fireEvent.change(select, { target: { value: setup } })
  fireEvent.change(screen.getByTestId('terminal-chk-entry'), { target: { value: entry } })
  fireEvent.change(screen.getByTestId('terminal-chk-stop'), { target: { value: stop } })
}

beforeEach(() => { jsonFetcher.mockReset(); live.prices = {} })
afterEach(cleanup)

describe('CHK panel', () => {
  it('counts one open position in the singular, and more in the plural', async () => {
    serve({ [RISK_URL]: { ...RISK, open_position_count: 1 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-phase')).textContent).toMatch(/1 open position\./)
    cleanup()
    serve()
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-phase')).textContent).toMatch(/3 open positions\./)
  })

  it('runs the whole check: checklist, win rate, past trades and the book with this trade added', async () => {
    serve()
    renderPanel()
    await plan()
    const checks = await screen.findByTestId('terminal-chk-checks', {}, { timeout: 2000 })
    expect(within(checks).getByTestId('terminal-chk-check-template').textContent).toContain('Pass')
    expect(within(checks).getByTestId('terminal-chk-check-regime').textContent).toMatch(/Fail.*suits this setup.*Pullback/)
    expect(within(checks).getByTestId('terminal-chk-check-stop').textContent).toMatch(/Pass.*Maximum 8%/)
    expect(screen.getByTestId('terminal-chk-sizing').textContent).toContain('20.0%')
    expect(screen.getByTestId('terminal-chk-rules').textContent).toContain('Break of the pivot on volume')

    expect(asked('/api/pre-trade-checklist')).toContain(checklistUrl({ sym: 'NVDA', setup: 'VCP', entry: 100, stop: 95 }))
    expect(asked('/api/setup-performance/')).toEqual(expect.arrayContaining([perfUrl('VCP', 'ALL'), perfUrl('VCP', 'Pullback')]))
    expect(asked('/api/analogs')).toContain(analogsUrl('VCP', 'Pullback'))

    expect((await screen.findByTestId('terminal-chk-perf-all')).textContent).toMatch(/62%.*26.*\+6\.8%/)
    expect(screen.getByTestId('terminal-chk-perf-phase').textContent).toContain('Pullback market')
    const analogs = await screen.findByTestId('terminal-chk-analogs-table')
    expect(analogs.textContent).toContain('SMCI')
    expect(analogs.textContent).toContain('+42.5%')
    expect(analogs.textContent).toContain('-6.2%')

    const book = screen.getByTestId('terminal-chk-book')
    expect(within(book).getByTestId('terminal-chk-book-exposure').textContent).toMatch(/Fail.*80\.0%.*limit 70%/)
    expect(within(book).getByTestId('terminal-chk-book-position').textContent).toMatch(/Fail.*20\.0%.*limit 15%/)
    expect(within(book).getByTestId('terminal-chk-book-count').textContent).toMatch(/Pass.*4.*limit 8/)
    expect(within(book).getByTestId('terminal-chk-book-heat').textContent).toMatch(/Pass.*3\.5%.*limit 5%/)
    expect(screen.getByTestId('terminal-chk-unheated').textContent).toContain('1 open position has no size or stop')
  })

  it('one failed source does not blank the panel: the risk read errors with Retry, the rest still render', async () => {
    serve({ [RISK_URL]: err(503) })
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-risk-error')).textContent).toContain('could not be read just now')
    await plan()
    // The phase falls back to the checklist's, so the win rate by phase and the past trades still load.
    expect(await screen.findByTestId('terminal-chk-checks', {}, { timeout: 2000 })).toBeTruthy()
    expect(await screen.findByTestId('terminal-chk-analogs-table')).toBeTruthy()
    serve()
    fireEvent.click(within(screen.getByTestId('terminal-chk-risk')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-chk-book')).toBeTruthy()
  })

  it('a 402 says paid plan and offers no Retry', async () => {
    serve({ [TEMPLATES_URL]: err(402), [RISK_URL]: err(402) })
    renderPanel()
    const setup = await screen.findByTestId('terminal-chk-setup-error')
    expect(setup.textContent).toContain('needs a paid plan')
    expect(within(setup).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect((await screen.findByTestId('terminal-chk-risk-error')).textContent).toContain('paid plan')
  })

  it('the engine not loaded is said in words, never drawn as data', async () => {
    serve({
      '/api/pre-trade-checklist': { error: 'Intelligence engine not available' },
      [RISK_URL]: { heat: {}, sectors: {}, protocol: {}, limits: {} },
      '/api/setup-performance/': { error: 'Intelligence engine not available' },
    })
    renderPanel()
    expect(await screen.findByTestId('terminal-chk-risk-off')).toBeTruthy()
    await plan()
    expect((await screen.findByTestId('terminal-chk-checklist-off', {}, { timeout: 2000 })).textContent).toContain('Not switched on')
    expect(screen.queryByTestId('terminal-chk-checks')).toBeNull()
    expect((await screen.findByTestId('terminal-chk-perf-all')).textContent).toContain('Not switched on')
    expect(screen.getByTestId('terminal-chk-analogs-waiting').textContent).toContain('market phase')
    expect(screen.queryByTestId('terminal-chk-book')).toBeNull()
  })

  it('an empty setup library says so instead of an empty picker', async () => {
    serve({ [TEMPLATES_URL]: { templates: [], count: 0 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-setup-off')).textContent).toContain('setup library is empty')
  })

  it('a stop on the wrong side is refused in the SIZE sentence and no checklist is asked for', async () => {
    serve()
    renderPanel()
    await plan({ entry: '100', stop: '105' })
    expect(screen.getByTestId('terminal-chk-levels-error').textContent)
      .toBe(computeSize({ account: 1000, riskPct: 1, entry: 100, stop: 105 }).error)
    await new Promise((r) => setTimeout(r, 600))
    expect(asked('/api/pre-trade-checklist')).toEqual([])
    fireEvent.click(screen.getByTestId('terminal-chk-side-short'))
    await screen.findByTestId('terminal-chk-checks', {}, { timeout: 2000 })
  })

  it('prefills the entry from the live price; typing over it wins', async () => {
    live.prices = { NVDA: { price: 123.456 } }
    serve()
    renderPanel()
    const entry = await screen.findByTestId('terminal-chk-entry')
    await waitFor(() => expect(entry.value).toBe('123.46'))
    fireEvent.change(entry, { target: { value: '120' } })
    live.prices = { NVDA: { price: 130 } }
    expect(entry.value).toBe('120')
  })

  it('links GRADE and SIZE for the same ticker, and needs a ticker', async () => {
    serve()
    renderPanel('AMD')
    const links = await screen.findByTestId('terminal-chk-links')
    expect(links.textContent).toContain('GRADE')
    expect(links.textContent).toContain('SIZE')
    cleanup()
    render(<CheckPanel sym="" />)
    expect(document.body.textContent).toContain('CHK needs a ticker.')
  })
})

describe('CHK this ticker', () => {
  const MINE_URL = tickerAnalogsUrl('VCP', 'Pullback', 'NVDA')

  it('shows this ticker\'s past trades of the setup and the member\'s own journal above the setup-wide list', async () => {
    serve()
    renderPanel()
    await plan()
    const mine = await screen.findByTestId('terminal-chk-mine-table', {}, { timeout: 2000 })
    expect(mine.textContent).toContain('NVDA')
    expect(mine.textContent).toContain('+18.4%')
    expect(mine.textContent).not.toContain('SMCI')
    expect(asked('/api/analogs')).toContain(MINE_URL)
    expect(asked('/api/j2/trades')).toContain(journalTradesUrl('NVDA'))

    const journal = await screen.findByTestId('terminal-chk-journal-table')
    const rows = within(journal).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)   // the NVDAX prefix neighbour is not this ticker
    expect(rows[0].textContent).toMatch(/2026-08-03.*Long.*VCP \(this setup\).*\+8\.1%.*\+2\.4R/)
    expect(rows[1].textContent).toMatch(/2026-05-04.*Short.*Not tagged.*-3\.2%.*-1\.0R/)

    const wide = await screen.findByTestId('terminal-chk-analogs-table')
    const order = [screen.getByTestId('terminal-chk-mine'), screen.getByTestId('terminal-chk-journal'), screen.getByTestId('terminal-chk-analogs')]
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wide.textContent).toContain('SMCI')
  })

  it('says none on record when the whole record holds none, and an empty journal in words', async () => {
    serve({
      [MINE_URL]: { analogs: [], count: 0, symbol: 'NVDA', scanned: 37, complete: true },
      '/api/j2/trades': { trades: [], total: 0, limit: 50, offset: 0 },
    })
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-journal-empty')).textContent).toBe('No closed trades in NVDA in your journal.')
    await plan()
    expect((await screen.findByTestId('terminal-chk-mine-empty', {}, { timeout: 2000 })).textContent)
      .toBe('None on record for NVDA in a Pullback market.')
    expect(screen.queryByTestId('terminal-chk-mine-table')).toBeNull()
  })

  it('a window that was not the whole record says how much was read, never "none on record"', async () => {
    serve({ [MINE_URL]: { analogs: [], count: 0, symbol: 'NVDA', scanned: 500, complete: false } })
    renderPanel()
    await plan()
    const empty = await screen.findByTestId('terminal-chk-mine-empty', {}, { timeout: 2000 })
    expect(empty.textContent).toContain('None for NVDA in the latest 500 VCP trades on record.')
    expect(empty.textContent).not.toContain('None on record')
  })

  it('a server that ignored the ticker filter is never shown as this ticker\'s trades', async () => {
    serve({ [MINE_URL]: ANALOGS })
    renderPanel()
    await plan()
    expect((await screen.findByTestId('terminal-chk-mine-unsupported', {}, { timeout: 2000 })).textContent)
      .toContain('cannot pick out one ticker')
    expect(screen.queryByTestId('terminal-chk-mine-table')).toBeNull()
  })

  it('each read fails on its own with Retry; the setup-wide list still renders', async () => {
    serve({ [MINE_URL]: err(503), '/api/j2/trades': err(503) })
    renderPanel()
    const jErr = await screen.findByTestId('terminal-chk-journal-error')
    expect(jErr.textContent).toContain('Your journal could not be read just now.')
    await plan()
    const mErr = await screen.findByTestId('terminal-chk-mine-error', {}, { timeout: 2000 })
    expect(mErr.textContent).toContain('could not be read just now')
    expect(await screen.findByTestId('terminal-chk-analogs-table')).toBeTruthy()
    serve()
    fireEvent.click(within(screen.getByTestId('terminal-chk-mine')).getByRole('button', { name: 'Retry' }))
    fireEvent.click(within(screen.getByTestId('terminal-chk-journal')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-chk-mine-table')).toBeTruthy()
    expect(await screen.findByTestId('terminal-chk-journal-table')).toBeTruthy()
  })

  it('the engine not loaded is said in words for this ticker too, never "none on record"', async () => {
    // What the route answers when the engine is not importable: nothing read, not complete.
    serve({ [MINE_URL]: { analogs: [], count: 0, symbol: 'NVDA', scanned: 0, complete: false } })
    renderPanel()
    await plan()
    const off = await screen.findByTestId('terminal-chk-mine-off', {}, { timeout: 2000 })
    expect(off.textContent).toContain('Not switched on')
    expect(screen.queryByTestId('terminal-chk-mine-empty')).toBeNull()
  })
})

describe('checkModel', () => {
  it('setup options de-duplicate and sort by family', () => {
    expect(setupOptions(TEMPLATES).map((o) => o.value)).toEqual(['VCP', 'Episodic Pivot'])
    expect(setupOptions(null)).toEqual([])
  })

  it('urls encode the setup and need every part', () => {
    expect(perfUrl('Red to Green', 'Rally Attempt')).toBe('/api/setup-performance/Red%20to%20Green?regime=Rally%20Attempt')
    expect(analogsUrl('VCP', null)).toBeNull()
    expect(checklistUrl({ sym: 'NVDA', setup: 'VCP', entry: null, stop: 1 })).toBeNull()
  })

  it('the phase is the risk summary\'s, else the checklist\'s, never "Unknown"', () => {
    expect(phaseOf(RISK, CHECKLIST)).toBe('Pullback')
    expect(phaseOf(null, CHECKLIST)).toBe('Pullback')
    expect(phaseOf(null, { regime: { phase: 'Unknown' } })).toBeNull()
  })

  it('book checks without a planned trade read the book as it stands', () => {
    const out = bookChecks(RISK)
    expect(out.map((b) => b.id)).toEqual(['exposure', 'count', 'heat'])
    expect(out[0]).toMatchObject({ label: 'Exposure now', value: 60, ok: true })
  })

  it('checklist checks say Unknown when a rule cannot be judged', () => {
    const c = checklistChecks({ template_found: false, regime: {}, risk: { stop_within_max: null } })
    expect(c.map((x) => x.ok)).toEqual([false, null, null])
  })

  it('an empty risk summary is the engine missing; analogs keep the engine order', () => {
    expect(riskEngineMissing({ heat: {}, limits: {} })).toBe(true)
    expect(riskEngineMissing(RISK)).toBe(false)
    expect(analogRows(ANALOGS, 1).map((a) => a.sym)).toEqual(['SMCI'])
  })

  it('this-ticker urls carry the ticker, upper-cased, and need every part', () => {
    expect(tickerAnalogsUrl('Red to Green', 'Pullback', 'nvda')).toBe('/api/analogs?setup_type=Red%20to%20Green&regime=Pullback&limit=5&symbol=NVDA')
    expect(tickerAnalogsUrl('VCP', 'Pullback', '')).toBeNull()
    expect(tickerAnalogsUrl('VCP', null, 'NVDA')).toBeNull()
    expect(journalTradesUrl('brk.b')).toBe('/api/j2/trades?symbol=BRK.B&limit=50')
    expect(journalTradesUrl('')).toBeNull()
  })

  it('the this-ticker view keeps exact rows and tells none, partial, unread and unsupported apart', () => {
    const row = (symbol) => ({ symbol, date_flagged: '2024-01-01', pct_change: 1 })
    expect(tickerAnalogView({ analogs: [row('NVDA'), row('NVDAX')], symbol: 'NVDA', scanned: 9, complete: true }, 'nvda'))
      .toMatchObject({ state: 'rows', rows: [{ sym: 'NVDA' }] })
    expect(tickerAnalogView({ analogs: [], symbol: 'NVDA', scanned: 9, complete: true }, 'NVDA')).toEqual({ state: 'none' })
    expect(tickerAnalogView({ analogs: [], symbol: 'NVDA', scanned: 500, complete: false }, 'NVDA')).toEqual({ state: 'partial', scanned: 500 })
    expect(tickerAnalogView({ analogs: [], symbol: 'NVDA', scanned: 0, complete: false }, 'NVDA')).toEqual({ state: 'unread' })
    expect(tickerAnalogView({ analogs: [row('NVDA')], count: 1 }, 'NVDA')).toEqual({ state: 'unsupported' })
    expect(tickerAnalogView(undefined, 'NVDA')).toBeNull()
  })

  it('journal rows are this ticker exactly, newest first, P&L in percent', () => {
    const rows = journalRows(JOURNAL, 'nvda')
    expect(rows.map((r) => r.side)).toEqual(['Long', 'Short'])
    expect(rows[0]).toMatchObject({ entryDate: '2026-08-03', exitDate: '2026-08-10', setup: 'VCP', r: 2.4 })
    expect(rows[0].pnlPct).toBeCloseTo(8.1)
    expect(rows[1]).toMatchObject({ setup: null, r: -1 })
    expect(journalRows({ trades: [] }, 'NVDA')).toEqual([])
    expect(journalRows(null, 'NVDA')).toEqual([])
  })

  it('SWR keys are CHK\'s own, never the bare URL', () => {
    expect(chkKey(TEMPLATES_URL)).toEqual([TEMPLATES_URL, 'terminal-chk'])
    expect(chkKey(null)).toBeNull()
  })

  it('checkLevels is the SIZE validation', () => {
    expect(checkLevels({ entry: '100', stop: '95' })).toEqual({ ok: true, entry: 100, stop: 95 })
    expect(checkLevels({ entry: '', stop: '95' }).ok).toBe(false)
    expect(checkLevels({ entry: 100, stop: 95, side: 'short' }).error).toContain('For a short')
  })
})

describe('CHK in the registry', () => {
  it('`NVDA CHK` opens the check panel; CHK needs a ticker', async () => {
    expect(BY_CODE.CHK.group).toBe('Security')
    expect(variantFor('CHK', true).variant.panel).toBe('Check')
    expect(BY_CODE.CHK.market).toBeUndefined()
    expect(BY_CODE.CHK.ticker.flag).toBeUndefined()
    expect(parseCommand('NVDA CHK').ok).toBe(true)
    expect((await PANEL_IMPORTERS.Check()).default).toBe(CheckPanel)
  })
})

// ── the team archive (wave 2a): a separate, labelled source ──────────────────

const TEAM = {
  label: 'UCT team archive (the team\'s own posted calls, outcomes measured after the fact; not advice)',
  setup: {
    source: 'team_archive', setup_id: 'vcp', name: 'Volatility contraction pattern',
    all_calls: { n_scored: 86, win20: 0.55, med_edge20: 0.012, mean_edgeR: 0.17, edgeR_z: 1.2, verdict: 'not proven' },
    today: { state: 'downtrend', cut: { n_scored: 34, win20: 0.62, med_edge20: 0.05, mean_edgeR: 0.9, edgeR_z: 3.1, verdict: 'measured edge' } },
    best: [], worst: [], teachings: [],
  },
  ticker: { ticker: 'NVDA', n_calls: 41, n_scored: 39, mean_r20: 0.034, setup_id: 'vcp', calls: [
    { call_id: 't1#0', record_id: 't1', trader: 'TSDR', posted: '2025-04-03', setup: 'vcp', direction: 'long', r5: 0.01, r20: 0.12 },
    { call_id: 't2#0', record_id: 't2', trader: 'Manrav', posted: '2025-01-09', setup: 'vcp', direction: 'long', r5: null, r20: null },
  ] },
}

describe('CHK panel: the team archive', () => {
  it('builds its read URLs and rows without price levels', () => {
    expect(archiveCheckUrl('NVDA')).toBe('/api/wisdom/archive/check?ticker=NVDA')
    expect(archiveCheckUrl('NVDA', 'Kicker Candle')).toBe('/api/wisdom/archive/check?ticker=NVDA&setup=Kicker%20Candle')
    expect(archiveCheckUrl(null)).toBeNull()
    const rows = archiveCallRows(TEAM)
    expect(rows.map((r) => r.r20)).toEqual([12, null])
    expect(Object.keys(rows[0]).sort()).toEqual(['date', 'direction', 'key', 'r20', 'setup', 'trader'])
    expect(archiveSetupOptions({ setups: [{ setup_id: 'ep', name: 'Episodic pivot (EP) / news gap', n: 213 }, { setup_id: 'ep' }] }))
      .toEqual([{ value: 'ep', label: 'Episodic pivot (EP) (213 team calls)' }])
  })

  it('switched off (404) it draws nothing, and the rest of CHK is unchanged', async () => {
    serve()
    renderPanel()
    expect(await screen.findByTestId('terminal-chk-phase')).toBeTruthy()
    await waitFor(() => expect(asked('/api/wisdom/archive/check')).toContain(archiveCheckUrl('NVDA')))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('terminal-chk-team')).toBeNull()
    expect(asked(ARCHIVE_PLAYBOOKS_URL)).toEqual([])            // the engine has setups: no archive list asked
  })

  it('on, it is its own labelled section beside the engine rows, never inside them', async () => {
    serve({ '/api/wisdom/archive/check': TEAM })
    renderPanel()
    await plan()
    await waitFor(() => expect(asked('/api/wisdom/archive/check')).toContain(archiveCheckUrl('NVDA', 'VCP')))
    const team = await screen.findByTestId('terminal-chk-team')
    expect(within(team).getByTestId('terminal-chk-team-label').textContent).toMatch(/team archive.*separate source from the setup engine/i)
    expect(within(team).getByTestId('terminal-chk-team-setup').textContent)
      .toMatch(/86 scored team calls, 55% up after 20 sessions, median \+1\.2% versus the same stock.*edge not proven/)
    expect(within(team).getByTestId('terminal-chk-team-today').textContent).toMatch(/QQQ downtrend.*34 scored.*edge measured edge/)
    expect(within(team).getByTestId('terminal-chk-team-ticker').textContent).toMatch(/NVDA: 41 team calls on record, averaging \+3\.4%/)
    const table = within(team).getByTestId('terminal-chk-team-table')
    expect(table.textContent).toContain('TSDR')
    expect(table.textContent).toContain('+12.0%')
    expect(table.textContent).toContain('Not scored yet')
    expect(table.textContent).not.toMatch(/Entry|Stop/)
    // the engine's win-rate row still says the engine's number, untouched
    expect((await screen.findByTestId('terminal-chk-perf-all')).textContent).toMatch(/62%.*26/)
  })

  it('with no engine setup list, the picker offers the archive setups and CHK still answers', async () => {
    serve({
      [TEMPLATES_URL]: { error: 'Intelligence engine not available' },
      [ARCHIVE_PLAYBOOKS_URL]: { setups: [{ setup_id: 'vcp', name: 'Volatility contraction pattern', n: 102 }] },
      '/api/wisdom/archive/check': TEAM,
      '/api/pre-trade-checklist': { error: 'Intelligence engine not available' },
      '/api/setup-performance/': { error: 'Intelligence engine not available' },
    })
    renderPanel()
    expect((await screen.findByTestId('terminal-chk-setup-archive')).textContent).toContain("team archive's setups")
    expect(screen.queryByTestId('terminal-chk-setup-off')).toBeNull()
    await plan({ setup: 'vcp' })
    await waitFor(() => expect(asked('/api/wisdom/archive/check')).toContain(archiveCheckUrl('NVDA', 'vcp')))
    expect((await screen.findByTestId('terminal-chk-team-setup')).textContent).toContain('86 scored team calls')
    expect((await screen.findByTestId('terminal-chk-perf-all')).textContent).toContain('Not switched on')
  })

  it('a failed archive read is an error with Retry in its own section only', async () => {
    serve({ '/api/wisdom/archive/check': err(503) })
    renderPanel()
    const e = await screen.findByTestId('terminal-chk-team-error')
    expect(e.textContent).toContain('The team archive could not be read just now')
    expect(within(e).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(await screen.findByTestId('terminal-chk-phase')).toBeTruthy()
  })

  it('an unresolved setup says the archive has no record, and still shows the ticker', async () => {
    serve({ '/api/wisdom/archive/check': { ...TEAM, setup: null } })
    renderPanel()
    await plan()
    expect((await screen.findByTestId('terminal-chk-team-nosetup')).textContent).toContain('no record for VCP')
    expect(screen.getByTestId('terminal-chk-team-ticker').textContent).toContain('41 team calls')
  })
})
