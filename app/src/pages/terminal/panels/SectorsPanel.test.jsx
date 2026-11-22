// SCTR: the 11 sector funds ranked by return. Rails:
//   * the pure shaping: strongest first, a fund with no return is dropped (never 0), the bar share,
//     how many funds are missing, the answer's own period echo;
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry);
//   * an EMPTY sectors list is "not available" with Retry, never an empty table or a flat market;
//   * a populated board: every fund, its return with a sign, a bar, the read time in the header;
//   * a fund loads into the linked panels like every other ticker; row numbers load it too;
//   * a period chip asks for that period, never shows the previous period's rows as this one's,
//     and writes itself into the command only where the registry takes a window.
// The fixture is the route's real shape (api/routers/sector_strength.py): { period, sectors: [...] }.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import SectorsPanel, {
  DEFAULT_SECTOR_PERIOD, SECTORS_URL, SECTOR_FUND_COUNT, SECTOR_PERIODS, normPeriod, sectorRows, sectorsCommandArgs, sectorsUrl,
} from './SectorsPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const sectors = (pairs) => pairs.map(([sector, ticker, change_pct]) => ({ sector, ticker, change_pct }))
const TODAY = {
  period: 'Today',
  sectors: sectors([
    ['Technology', 'XLK', 2.0], ['Communication Services', 'XLC', 1.25], ['Consumer Discretionary', 'XLY', 0.8],
    ['Industrials', 'XLI', 0.5], ['Financials', 'XLF', 0.31], ['Materials', 'XLB', 0.0], ['Healthcare', 'XLV', -0.2],
    ['Real Estate', 'XLRE', -0.45], ['Consumer Staples', 'XLP', -0.6], ['Utilities', 'XLU', -0.9], ['Energy', 'XLE', -1.0],
  ]),
}
const MONTH = {
  period: '1M',
  sectors: sectors([
    ['Energy', 'XLE', 6.4], ['Financials', 'XLF', 3.1], ['Technology', 'XLK', -4.2],
  ]),
}
const byUrl = (map) => async (url) => {
  if (url in map) return map[url]
  throw Object.assign(new Error(`unserved ${url}`), { status: 500 })
}

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), open = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <SectorsPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, open, publishRows, setFreshness }
}
const symsInTable = () => within(screen.getByTestId('terminal-sectors-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-sectors-row-', ''))
const fail = (status) => Object.assign(new Error('x'), { status })
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('SCTR pure shaping', () => {
  it('normPeriod: the route\'s four periods; 1D, TODAY and anything unknown mean Today', () => {
    expect(Object.keys(SECTOR_PERIODS)).toEqual(['Today', '1W', '1M', '3M'])
    expect(DEFAULT_SECTOR_PERIOD).toBe('Today')
    for (const [raw, want] of [['1w', '1W'], ['1M', '1M'], [' 3m ', '3M'], ['1D', 'Today'], ['TODAY', 'Today'],
      ['today', 'Today'], [null, 'Today'], [undefined, 'Today'], ['', 'Today'], ['6M', 'Today'], ['YTD', 'Today']]) {
      expect(normPeriod(raw), String(raw)).toBe(want)
    }
  })

  it('the URL and the command arguments follow the period', () => {
    expect(SECTORS_URL).toBe('/api/sector-strength?period=Today')
    expect(sectorsUrl('1M')).toBe('/api/sector-strength?period=1M')
    expect(sectorsUrl('1D')).toBe('/api/sector-strength?period=Today')
    expect(sectorsUrl('nonsense')).toBe('/api/sector-strength?period=Today')
    expect(sectorsCommandArgs('Today')).toEqual([])
    expect(sectorsCommandArgs('1D')).toEqual([])
    expect(sectorsCommandArgs('3M')).toEqual(['3M'])
    // its own SWR key: the stamped one, never the Dashboard tile's raw URL key
    expect(stampedKey(SECTORS_URL)).toEqual(['/api/sector-strength?period=Today', 'terminal-stamped'])
  })

  it('sectorRows: strongest first, with the bar share against the biggest move', () => {
    const board = sectorRows(TODAY)
    expect(board.period).toBe('Today')
    expect(board.missing).toBe(0)
    expect(board.rows).toHaveLength(SECTOR_FUND_COUNT)
    expect(board.rows.map((r) => r.sym)).toEqual(['XLK', 'XLC', 'XLY', 'XLI', 'XLF', 'XLB', 'XLV', 'XLRE', 'XLP', 'XLU', 'XLE'])
    expect(board.rows[0]).toEqual({ sym: 'XLK', name: 'Technology', pct: 2, order: 0, share: 1 })
    expect(board.rows.find((r) => r.sym === 'XLE').share).toBe(0.5)
    expect(board.rows.find((r) => r.sym === 'XLB').share).toBe(0)
  })

  it('sectorRows: re-ranks an unsorted answer, drops a fund with no return or no ticker, never invents 0', () => {
    const board = sectorRows({
      period: '1W',
      sectors: [
        { sector: 'Energy', ticker: 'xle', change_pct: -3 },
        { sector: 'Utilities', ticker: 'XLU', change_pct: null },
        { sector: 'Technology', ticker: 'XLK', change_pct: '4.5' },
        { sector: 'Nameless', change_pct: 9 },
        { sector: 'Financials', ticker: 'XLF', change_pct: Number.NaN },
        { ticker: 'XLB', change_pct: 1 },
        { sector: 'Technology again', ticker: 'XLK', change_pct: 99 },
        null,
      ],
    })
    expect(board.rows.map((r) => [r.sym, r.pct])).toEqual([['XLK', 4.5], ['XLB', 1], ['XLE', -3]])
    expect(board.rows[1].name).toBe('XLB')
    expect(board.missing).toBe(SECTOR_FUND_COUNT - 3)
    expect(board.rows.every((r) => r.pct !== 0)).toBe(true)
  })

  it('sectorRows: an empty, missing or malformed body is no rows and all 11 missing', () => {
    for (const body of [undefined, null, {}, { period: 'Today', sectors: [] }, { sectors: 'no' }, { detail: 'Sector strength requires a paid plan' }]) {
      const board = sectorRows(body)
      expect(board.rows).toEqual([])
      expect(board.missing).toBe(SECTOR_FUND_COUNT)
    }
    expect(sectorRows({ period: 'Today', sectors: sectors([['A', 'AAA', 0], ['B', 'BBB', 0]]) }).rows.map((r) => r.share)).toEqual([0, 0])
  })
})

describe('SCTR panel states', () => {
  it('shows a loading skeleton, with the period chips already there', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-sectors-loading')).toBeTruthy()
    expect(screen.getByTestId('terminal-sectors-period-Today').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-sectors-table')).toBeNull()
  })

  it('a failed read is an error with Retry, and says it is not a flat market', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(500))
    renderPanel()
    const err = await screen.findByTestId('terminal-sectors-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Sector performance could not be read just now.')
    expect(err.textContent).toContain('not the same as a flat market')
    expect(screen.queryByTestId('terminal-sectors-table')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(TODAY)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-sectors-table')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-sectors-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('Sector performance needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-sectors-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('Sector performance is not switched on for this server yet.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('an empty answer is "not available" with Retry, never an empty table', async () => {
    jsonFetcher.mockResolvedValueOnce({ period: 'Today', sectors: [] })
    const { setFreshness } = renderPanel()
    const none = await screen.findByTestId('terminal-sectors-unavailable')
    expect(none.textContent).toContain('Sector returns are not available right now.')
    expect(none.textContent).toContain('not the same as a flat market')
    expect(screen.queryByTestId('terminal-sectors-table')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    jsonFetcher.mockResolvedValueOnce(TODAY)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-sectors-table')).toBeTruthy()
  })
})

describe('SCTR panel, populated', () => {
  it('ranks all 11 funds with a signed return and a bar, and reports its read time to the header', async () => {
    jsonFetcher.mockResolvedValue(TODAY)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/sector-strength?period=Today')
    expect(symsInTable()).toEqual(['XLK', 'XLC', 'XLY', 'XLI', 'XLF', 'XLB', 'XLV', 'XLRE', 'XLP', 'XLU', 'XLE'])
    const xlk = screen.getByTestId('terminal-sectors-row-XLK').textContent
    for (const s of ['1', 'Technology', 'XLK', '+2.00%']) expect(xlk).toContain(s)
    expect(screen.getByTestId('terminal-sectors-row-XLE').textContent).toContain('-1.00%')
    expect(screen.getByTestId('terminal-sectors-row-XLB').textContent).toContain('+0.00%')
    // the bar: half the track for the biggest move, a quarter for half of it, nothing for a flat fund
    expect(screen.getByTestId('terminal-sectors-bar-XLK').style.width).toBe('50%')
    expect(screen.getByTestId('terminal-sectors-bar-XLE').style.width).toBe('25%')
    expect(screen.getByTestId('terminal-sectors-bar-XLB').style.width).toBe('0%')
    expect(screen.getByRole('columnheader', { name: 'Change today' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-sectors-missing')).toBeNull()
    // the as-of: the header gets the source and an Eastern time; the method sentence repeats the read time
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({
      source: 'UCT sector ranking (daily closes)',
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      age: { asOfDate: expect.stringMatching(/ ET$/) },
    })))
    const method = screen.getByTestId('terminal-sectors-method').textContent
    expect(method).toContain('The 11 SPDR sector funds, strongest first.')
    expect(method).toContain('look back 5, 21 and 63 trading days')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a fund loads into the linked panels, by click and by row number', async () => {
    jsonFetcher.mockResolvedValue(TODAY)
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    fireEvent.click(screen.getByTestId('panel-symbol-XLF'))
    expect(run).toHaveBeenCalledWith('$XLF')
    expect(publishRows).toHaveBeenLastCalledWith(['$XLK', '$XLC', '$XLY', '$XLI', '$XLF', '$XLB', '$XLV', '$XLRE', '$XLP', '$XLU', '$XLE'])
  })

  it('a sector opens its stocks, ranked, beside the panel (GRP); 1 month and 3 months carry over', async () => {
    jsonFetcher.mockResolvedValue(TODAY)
    const { open, run } = renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    // every one of the 11 sectors is a door, by its fund (the ranking spells some sectors differently)
    expect(screen.getAllByRole('button', { name: /^Open the stocks of .+, ranked \(GRP XL[A-Z]+\)$/ })).toHaveLength(11)
    fireEvent.click(within(screen.getByTestId('terminal-sectors-row-XLY')).getByRole('button', { name: 'Open the stocks of Consumer Discretionary, ranked (GRP XLY)' }))
    expect(open).toHaveBeenLastCalledWith('GRP XLY')
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByTestId('terminal-sectors-method').textContent).toContain('Click a sector to open its stocks, ranked.')
    cleanup()
    jsonFetcher.mockResolvedValue(MONTH)
    const month = renderPanel({ period: '1M' })
    await screen.findByTestId('terminal-sectors-table')
    fireEvent.click(within(screen.getByTestId('terminal-sectors-row-XLE')).getByRole('button', { name: /^Open the stocks of Energy, ranked/ }))
    expect(month.open).toHaveBeenLastCalledWith('GRP XLE 1M')
  })

  it('a fund the drill-down does not know keeps its sector as plain text, never a door to nothing', async () => {
    jsonFetcher.mockResolvedValue({ period: 'Today', sectors: sectors([['Mystery', 'ZZZ', 1.0], ['Technology', 'XLK', 0.5]]) })
    renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    const row = screen.getByTestId('terminal-sectors-row-ZZZ')
    expect(row.textContent).toContain('Mystery')
    expect(within(row).queryByRole('button', { name: /^Open the stocks of/ })).toBeNull()
    expect(within(screen.getByTestId('terminal-sectors-row-XLK')).getByRole('button', { name: /^Open the stocks of Technology/ })).toBeTruthy()
  })

  it('a short answer says how many funds are missing instead of passing for the whole board', async () => {
    jsonFetcher.mockResolvedValue(MONTH)
    renderPanel({ period: '1M' })
    await screen.findByTestId('terminal-sectors-table')
    expect(symsInTable()).toEqual(['XLE', 'XLF', 'XLK'])
    expect(screen.getByTestId('terminal-sectors-missing').textContent).toContain('Only 3 of the 11 sector funds could be priced')
    expect(screen.getByRole('columnheader', { name: 'Change, 1 month' })).toBeTruthy()
  })
})

describe('SCTR period chips', () => {
  it('the period prop seeds the chip and the read (1D means Today)', async () => {
    jsonFetcher.mockImplementation(byUrl({ [sectorsUrl('1M')]: MONTH, [SECTORS_URL]: TODAY }))
    renderPanel({ period: '1M' })
    await screen.findByTestId('terminal-sectors-table')
    expect(screen.getByTestId('terminal-sectors').getAttribute('data-period')).toBe('1M')
    expect(screen.getByTestId('terminal-sectors-period-1M').getAttribute('aria-pressed')).toBe('true')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/sector-strength?period=1M')
    cleanup()
    renderPanel({ period: '1D' })
    await screen.findByTestId('terminal-sectors-table')
    expect(screen.getByTestId('terminal-sectors-period-Today').getAttribute('aria-pressed')).toBe('true')
  })

  it('a chip asks for that period and never shows the last period\'s rows as this one\'s', async () => {
    let releaseMonth
    jsonFetcher.mockImplementation((url) => (url === sectorsUrl('1M')
      ? new Promise((resolve) => { releaseMonth = () => resolve(MONTH) })
      : Promise.resolve(TODAY)))
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    expect(symsInTable()[0]).toBe('XLK')
    fireEvent.click(screen.getByTestId('terminal-sectors-period-1M'))
    // the 1M read is still out: Today's rows are gone, the skeleton is up, the chip is pressed
    expect(screen.getByTestId('terminal-sectors-period-1M').getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByTestId('terminal-sectors-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-sectors-table')).toBeNull()
    releaseMonth()
    await screen.findByTestId('terminal-sectors-table')
    expect(symsInTable()).toEqual(['XLE', 'XLF', 'XLK'])
    expect(jsonFetcher).toHaveBeenCalledWith('/api/sector-strength?period=1M')
    // outside a registered panel nothing is written back: the chip is plain component state
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a period that fails says so and keeps the chips, so the member can go back', async () => {
    jsonFetcher.mockImplementation(byUrl({ [SECTORS_URL]: TODAY }))
    renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    fireEvent.click(screen.getByTestId('terminal-sectors-period-3M'))
    expect((await screen.findByTestId('terminal-sectors-error')).textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-sectors-table')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-sectors-period-Today'))
    await screen.findByTestId('terminal-sectors-table')
    expect(symsInTable()[0]).toBe('XLK')
  })

  it('inside a panel whose code takes a window, the chip writes itself into the command', async () => {
    // THMS is an existing code whose market variant takes the same window argument SCTR will.
    jsonFetcher.mockImplementation(byUrl({ [sectorsUrl('1M')]: MONTH, [SECTORS_URL]: TODAY }))
    const { rerun } = renderPanel({}, { code: 'THMS' })
    await screen.findByTestId('terminal-sectors-table')
    fireEvent.click(screen.getByTestId('terminal-sectors-period-1M'))
    expect(rerun).toHaveBeenLastCalledWith('THMS 1M')
    fireEvent.click(screen.getByTestId('terminal-sectors-period-Today'))
    expect(rerun).toHaveBeenLastCalledWith('THMS')
    cleanup()
    // INS takes no argument: a period is not written back, and the chip still works
    const second = renderPanel({}, { code: 'INS' })
    await screen.findByTestId('terminal-sectors-table')
    fireEvent.click(screen.getByTestId('terminal-sectors-period-1M'))
    expect(second.rerun).not.toHaveBeenCalled()
    await waitFor(() => expect(symsInTable()).toEqual(['XLE', 'XLF', 'XLK']))
  })
})

describe('SCTR follows the member\'s theme', () => {
  it('the panel and its bar stylesheet hold no hard-coded color', () => {
    for (const file of ['SectorsPanel.jsx', 'barCells.module.css']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
    // CONTROL: the detector sees a literal in the same kind of file
    expect(colourLiteralsIn('x.css', '.barUp { background: #2faf68; }')).toHaveLength(1)
  })
})

describe('SCTR accessibility', () => {
  it('the ranked board passes axe (WCAG A and AA)', async () => {
    jsonFetcher.mockResolvedValue(TODAY)
    renderPanel()
    await screen.findByTestId('terminal-sectors-table')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)

  it('the error state passes axe too', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(500))
    renderPanel()
    await screen.findByTestId('terminal-sectors-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
