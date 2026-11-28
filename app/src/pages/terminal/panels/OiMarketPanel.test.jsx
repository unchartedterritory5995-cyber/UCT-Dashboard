// Bare OIC (2026-11-27): the biggest open-interest changes across the whole options log, and its words.
//   * by stock (net change, calls and puts apart) and by contract (the earlier day's volume);
//   * `computing` asks again and is never "no change"; one recorded day is said; a failed read has Retry;
//   * a cut list says so; the dropdowns write `OIC CONTRACTS P` back; axe finds nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import OiMarketPanel from './OiMarketPanel'
import { PANEL_IMPORTERS } from '../panels'
import { ARG_KINDS, OI_VIEW_WORDS, applyArgs } from '../args'
import { BY_CODE } from '../functions'
import { writeBackCommand } from './commandWriteBack'
import {
  OI_VIEWS, OI_VIEW_ARG_WORDS, changeText, oiMarketCommandArgs, oiMarketCutNote, oiMarketRead, oiMarketUrl, parseOiView,
} from './oiMarketModel'

const STOCKS = {
  status: 'ok', view: 'stocks', side: 'any', session: '2026-11-25', prior_session: '2026-11-24', skipped_sessions: [],
  rows: [
    { symbol: 'BBB', contracts: 40, oi: 30000, prior_oi: 10000, change: 20000, change_pct: 200, call_change: 21000, put_change: -1000 },
    { symbol: 'AAA', contracts: 3, oi: 3400, prior_oi: 3300, change: 100, change_pct: 3, call_change: 600, put_change: -500 },
  ],
  shown: 2, matched: 1834, underlyings: 4021, new: { contracts: 120, oi: 9000 }, gone: { contracts: 80, prior_oi: 700 },
  volume_present: true, volume_session: '2026-11-24', built_at: 1795700000, refreshing: false,
}
const CONTRACTS = {
  ...STOCKS, view: 'contracts', matched: 2,
  rows: [{ contract: 'O:BBB261218C00050000', symbol: 'BBB', expiration: '2026-12-18', strike: 50, type: 'call', oi: 3000, prior_oi: 1000, change: 2000, change_pct: 200, volume: 9 }],
}

function renderPanel(props = {}) {
  const api = { open: vi.fn(), run: vi.fn(), publish: vi.fn(), publishRows: vi.fn(), rerun: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={api}>
        <TerminalPanelContext.Provider value={{ code: 'OIC', density: 'comfortable', inset: true }}>
          <OiMarketPanel {...props} />
        </TerminalPanelContext.Provider>
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { ...view, api }
}

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('the words', () => {
  it('the view copy equals the model; OIC CONTRACTS P applies and writes back', () => {
    expect(OI_VIEW_WORDS).toEqual(OI_VIEW_ARG_WORDS)
    for (const [w, v] of Object.entries(OI_VIEW_ARG_WORDS)) expect(ARG_KINDS.oicView.parse(w.toLowerCase()), w).toBe(v)
    for (const v of Object.values(OI_VIEWS)) if (v.token) expect(ARG_KINDS.oicView.parse(v.token)).not.toBeNull()
    expect(ARG_KINDS.oicView.parse('NVDA')).toBeNull()
    expect(parseOiView('strikes')).toBe('contracts')
    expect(applyArgs(BY_CODE.OIC.market, ['CONTRACTS', 'P']).props).toEqual({ view: 'contracts', side: 'put' })
    expect(applyArgs(BY_CODE.OIC.market, ['CALLS']).props).toEqual({ side: 'call' })
    expect(oiMarketCommandArgs({ view: 'contracts', side: 'put' })).toEqual(['CONTRACTS', 'P'])
    expect(oiMarketCommandArgs({})).toEqual([])
    expect(writeBackCommand('OIC', ['CONTRACTS', 'P'])).toBe('OIC CONTRACTS P')
    expect(writeBackCommand('OIC', ['P'], 'nvda')).toBe('NVDA OIC P')
    expect(oiMarketUrl({})).toBe('/api/options-screener/oi-change?view=stocks&side=any')
    expect(oiMarketUrl({ view: 'contracts', side: 'call' })).toBe('/api/options-screener/oi-change?view=contracts&side=call')
  })

  it('reads the body, keeps a missing number missing, and says a cut list', () => {
    const v = oiMarketRead(STOCKS)
    expect(v.state).toBe('ok')
    expect(v.rows[0]).toMatchObject({ sym: 'BBB', change: 20000, callChange: 21000, putChange: -1000 })
    expect(changeText({ change: -500, changePct: null })).toBe('-500')
    expect(changeText({ change: 20000, changePct: 200 })).toBe('+20,000 (+200.0%)')
    expect(oiMarketCutNote(v)).toBe('Showing the 2 biggest of 1,834 stocks whose open interest changed, by number of contracts.')
    expect(oiMarketRead({ status: 'computing' }).state).toBe('computing')
    expect(oiMarketRead(null).state).toBe('unknown')
  })
})

describe('OIC, the whole market', () => {
  it('by stock: the net change, calls and puts apart, the two recorded days and what is counted not ranked', async () => {
    jsonFetcher.mockResolvedValue(STOCKS)
    const { api } = renderPanel()
    await screen.findByTestId('terminal-oim-table')
    expect(jsonFetcher.mock.calls[0][0]).toBe('/api/options-screener/oi-change?view=stocks&side=any')
    const row = screen.getByTestId('terminal-oim-row-0').textContent
    for (const s of ['BBB', '+20,000 (+200.0%)', '30,000', 'was 10,000', '+21,000 calls', '-1,000 puts', '40']) expect(row).toContain(s)
    const headers = within(screen.getByTestId('terminal-oim-table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Symbol', 'Change', 'Open interest', 'Calls, puts', 'Contracts'])
    const notes = screen.getAllByTestId('terminal-oim-note').map((n) => n.textContent)
    expect(notes[0]).toBe('Open interest recorded Wed Nov 25 against Tue Nov 24.')
    expect(notes[1]).toContain('120 new contracts (no earlier figure) and 80 that left the log are counted, not ranked.')
    expect(screen.getByTestId('terminal-oim-cut').textContent).toContain('of 1,834 stocks')
    expect(api.publishRows).toHaveBeenLastCalledWith(['$BBB', '$AAA'])
  })

  it('by contract: the contract in words and the earlier day’s volume', async () => {
    jsonFetcher.mockResolvedValue(CONTRACTS)
    renderPanel({ view: 'contracts' })
    await screen.findByTestId('terminal-oim-table')
    const row = screen.getByTestId('terminal-oim-row-0').textContent
    for (const s of ['BBB', '$50 call, Dec 18', '+2,000', '9']) expect(row).toContain(s)
    expect(screen.getByTestId('terminal-oim-method').textContent).toContain('Volume is the earlier recorded day')
  })

  it('computing asks again and is never no change; one recorded day says so', async () => {
    jsonFetcher.mockResolvedValue({ status: 'computing', view: 'stocks', side: 'any' })
    renderPanel()
    const busy = await screen.findByTestId('terminal-oim-computing')
    expect(busy.getAttribute('role')).toBe('status')
    expect(screen.queryByTestId('terminal-oim-empty')).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue({ status: 'one_session', session: '2026-11-25' })
    renderPanel()
    expect((await screen.findByTestId('terminal-oim-not-ready')).textContent).toContain('one recorded day')
  })

  it('a failed read has Retry, a dark switch says so, and an empty list names the side', async () => {
    jsonFetcher.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-oim-error')).textContent).toContain('not the same as no change')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(Object.assign(new Error('off'), { status: 404 }))
    renderPanel()
    expect((await screen.findByTestId('terminal-oim-error')).textContent).toContain('not switched on')
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockResolvedValue({ ...STOCKS, side: 'put', rows: [], matched: 0 })
    renderPanel({ side: 'put' })
    expect((await screen.findByTestId('terminal-oim-empty')).textContent).toContain('No put open interest changed')
  })

  it('the dropdowns write the pick back into the command', async () => {
    jsonFetcher.mockResolvedValue(STOCKS)
    const { api } = renderPanel()
    await screen.findByTestId('terminal-oim-table')
    fireEvent.change(screen.getByTestId('terminal-oim-view'), { target: { value: 'contracts' } })
    expect(api.rerun).toHaveBeenLastCalledWith('OIC CONTRACTS')
    fireEvent.change(screen.getByTestId('terminal-oim-side'), { target: { value: 'put' } })
    expect(api.rerun).toHaveBeenLastCalledWith('OIC P')
  })

  it('is registered, and passes axe by stock, by contract and while computing', async () => {
    expect((await PANEL_IMPORTERS.OiMarket()).default).toBe(OiMarketPanel)
    for (const [body, props, wait] of [[STOCKS, {}, 'terminal-oim-table'], [CONTRACTS, { view: 'contracts' }, 'terminal-oim-table'],
      [{ status: 'computing' }, {}, 'terminal-oim-computing']]) {
      cleanup()
      jsonFetcher.mockReset()
      jsonFetcher.mockResolvedValue(body)
      const v = renderPanel(props)
      await screen.findByTestId(wait)
      await expectNoAxeViolations(v.container)
    }
  })
})
