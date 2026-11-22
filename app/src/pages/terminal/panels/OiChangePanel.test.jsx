// OIC: one stock's open interest, contract by contract, against the recorded day before. Rails:
//   * no ticker, loading, a failed read (error with Retry), signed out, no paid plan, a
//     switched-off route, a bad ticker and an answer that is not the route's shape: none is "no change";
//   * "computing" is a working state; no recorded day, one recorded day and an unknown stock each
//     say which, and none carries rows;
//   * the two days in words with the clearing-house sentence, the totals, the table (two-line
//     cells, the change's sign as colour and as a character), 15 rows then the rest, the cut line;
//   * a new contract is "New", a change from 0 has no percent, a side with nothing has no total;
//   * a missing day is named; volume is the earlier day's and its column goes when the log has none;
//   * the chips ask the server for one side and write it into the command; no row is called
//     bullish or bearish; no hard-coded color; axe.
// Every number is invented; the fixtures are the route's real shape with a made-up ticker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import OiChangePanel, { COMPUTING_POLL_MS, HELD_POLL_MS, OI_CHANGE_CODE, OI_CHANGE_SOURCE, OI_ROWS_SHOWN, oiChangeUrl } from './OiChangePanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const URL = '/api/options-screener/oi-change/ZZA'
const row = (over = {}) => ({
  contract: 'O:ZZA261120C00100000', expiration: '2026-11-20', strike: 100, type: 'call', oi: 1600, kind: 'change',
  prior_oi: 1000, change: 600, change_pct: 60, volume: 700, ...over,
})
const PUT = row({ contract: 'O:ZZA261120P00090000', strike: 90, type: 'put', oi: 1500, prior_oi: 2000, change: -500, change_pct: -25, volume: 450 })
const NEW = row({ contract: 'O:ZZA270115C00105000', expiration: '2027-01-15', strike: 105, oi: 900, kind: 'new', prior_oi: null, change: null, change_pct: null, volume: null })
const answer = (over = {}) => ({
  symbol: 'ZZA', side: 'any', status: 'ok', session: '2026-11-18', prior_session: '2026-11-17', skipped_sessions: [],
  known: true, has_symbol: true, prior_has_symbol: true, source: 'x', coverage: 'x',
  rows: [row(), PUT], matched: 2, shown: 2, max_rows: 50,
  summary: { call: { contracts: 2, oi: 1900, prior_oi: 1300, change: 600 }, put: { contracts: 1, oi: 1500, prior_oi: 2000, change: -500 }, contracts: 3, unchanged: 1 },
  new: { contracts: 0, oi: 0 }, gone: { contracts: 0, prior_oi: 0, expired: 0 }, not_reported: 0,
  volume_present: true, volume_session: '2026-11-17', built_at: '2026-11-18T21:40:00+00:00', ...over,
})
const many = (n, matched = n) => answer({
  rows: Array.from({ length: n }, (_, i) => row({ contract: `O:ZZA261120C${String(100 + i).padStart(8, '0')}`, strike: 100 + i, change: 1000 - i })), matched,
})

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

/** Re-reads every key the panel holds, as its poll would (set by the mounted tree). */
let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  revalidateAll = () => mutate(() => true)
  return null
}

function renderPanel(props = { sym: 'zza' }, { rerun = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><OiChangePanel {...p} /></TerminalPanelContext.Provider>
            : <OiChangePanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { rerun, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-oic-row')
const cells = (tr) => [...tr.querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('OIC states', () => {
  it('with no ticker it asks for one and reads nothing', () => {
    serve({})
    renderPanel({ sym: '' }, { code: 'OIC' })
    expect(OI_CHANGE_CODE).toBe('OIC')
    expect(screen.getByText('OIC needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route, with the ticker in capitals', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(oiChangeUrl('ZZA')).toBe(URL)
    expect(screen.getByTestId('terminal-oic-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-oic')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no change"', async () => {
    serve({})
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'OIC' })
    const err = await screen.findByTestId('terminal-oic-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Open interest change could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no change. Retry, or run ZZA OIC again.')
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-oic-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so open interest change cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Open interest change did not answer within 30 seconds.'],
      [fail(503), 'error', 'Open interest change could not be read just now.'],
      [fail(402), 'locked', 'Open interest change needs a paid plan.'],
      [fail(404), 'locked', 'Open interest change is not switched on for this server yet.'],
    ]) {
      serve({ [URL]: err })
      renderPanel()
      const box = await screen.findByTestId('terminal-oic-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent).toContain(words)
      expect(!!within(box).queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
      cleanup()
    }
  })

  it('a ticker the server cannot read asks for another, with no Retry', async () => {
    serve({ [URL]: fail(422) })
    renderPanel({ sym: 'ZZA' }, { code: 'OIC' })
    const box = await screen.findByTestId('terminal-oic-bad-ticker')
    expect(box.getAttribute('data-kind')).toBe('input')
    expect(box.textContent).toContain('ZZA is not a ticker this panel can read.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('an answer that is not the route\'s shape is a failed read, never an empty table', async () => {
    serve({ [URL]: { status: 'ok', rows: [] } })
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-oic-error')
    expect(err.textContent).toContain('Open interest change for ZZA could not be read just now.')
    expect(within(err).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('"computing" is a working state that says it will fill in, with no date and no rows', async () => {
    serve({ [URL]: { symbol: 'ZZA', side: 'any', status: 'computing' } })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-oic-computing')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(box.textContent).toContain('asks again every 5 seconds')
    expect(box.textContent).toContain('That is not the same as no change.')
    expect(screen.getByTestId('terminal-oic').getAttribute('data-state')).toBe('computing')
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    expect([COMPUTING_POLL_MS, HELD_POLL_MS]).toEqual([5000, 600000])
  })

  it('while the server is working the panel asks again by itself and fills in', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing' } : answer() })
    renderPanel()
    await screen.findByTestId('terminal-oic-computing')
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-oic-table', {}, { timeout: 9000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('no recorded day, and one recorded day, each say which', async () => {
    serve({ [URL]: { status: 'no_sessions' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-oic-no-sessions')).textContent).toContain('The options log has no recorded day to read yet.')
    expect(screen.getByTestId('terminal-oic-no-sessions').textContent).toContain('not the same as no change in ZZA')
    cleanup()
    serve({ [URL]: { status: 'one_session', session: '2026-11-18' } })
    const { setFreshness } = renderPanel()
    const one = await screen.findByTestId('terminal-oic-one-session')
    expect(one.textContent).toContain('Only one day is recorded so far (Wed Nov 18).')
    expect(one.textContent).toContain('A change needs two recorded days.')
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('a stock in neither record says so, names both days, and is dated', async () => {
    serve({ [URL]: answer({ known: false, rows: [], matched: 0 }) })
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'OIC' })
    const box = await screen.findByTestId('terminal-oic-unknown')
    expect(box.textContent).toContain('ZZA has no option contract in the Wed Nov 18 or the Tue Nov 17 record.')
    expect(screen.queryByTestId('terminal-oic-summary')).toBeNull()
    expect(lastReport(setFreshness)).toMatchObject({ source: OI_CHANGE_SOURCE })
  })
})

describe('OIC the answer', () => {
  it('names the two days in words, says once that the figure is daily and never live, and dates the header', async () => {
    serve({ [URL]: answer() })
    const { setFreshness } = renderPanel()
    const asOf = await screen.findByTestId('terminal-oic-asof')
    expect(asOf.textContent).toContain('Open interest recorded Wed Nov 18 against Tue Nov 17. The change is from trading on Tue Nov 17. Open interest is published once a day')
    expect(asOf.textContent).toContain('Open interest is published once a day by the clearing house, for the previous session, so it is never live.')
    expect(document.body.textContent.match(/published once a day by the clearing house/g)).toHaveLength(1)
    const report = lastReport(setFreshness)
    expect(report.source).toBe(OI_CHANGE_SOURCE)
    expect(JSON.stringify(report)).toContain('2026-11-18')
  })

  it('totals each side with both figures and the contracts counted', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    expect((await screen.findByTestId('terminal-oic-total-call')).textContent).toBe('+600 (1,300 to 1,900, over 2 calls)')
    expect(screen.getByTestId('terminal-oic-total-put').textContent).toBe('-500 (2,000 to 1,500, over 1 put)')
    expect(screen.getByTestId('terminal-oic-compared').textContent).toBe('3 in both records, 1 of them unchanged')
    // the sign is a character and a colour class, never a colour alone
    expect(screen.getByTestId('terminal-oic-total-call').firstElementChild.className).toMatch(/up/)
    expect(screen.getByTestId('terminal-oic-total-put').firstElementChild.className).toMatch(/down/)
  })

  it('a side with no contract in both records has words, never a total of 0', async () => {
    serve({ [URL]: answer({ rows: [row()], matched: 1, summary: { call: { contracts: 1, oi: 1600, prior_oi: 1000, change: 600 }, put: { contracts: 0, oi: 0, prior_oi: 0, change: 0 }, contracts: 1, unchanged: 0 } }) })
    renderPanel()
    const put = await screen.findByTestId('terminal-oic-total-put')
    expect(put.textContent).toBe('no put is in both records')
    expect(put.textContent).not.toMatch(/\d/)
    expect(put.firstElementChild.className || '').not.toMatch(/up|down/)
  })

  it('each row: the contract over its expiry, the figure over what it was, the change over its percent, the earlier day\'s volume', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    const [up, down] = rows()
    expect(cells(up).map(lines)).toEqual([['$100 call', 'Nov 20'], ['1,600', 'was 1,000'], ['+600', '+60.0%'], ['700']])
    expect(cells(down).map(lines)).toEqual([['$90 put', 'Nov 20'], ['1,500', 'was 2,000'], ['-500', '-25.0%'], ['450']])
    expect(within(up).getByTestId('terminal-oic-change').firstElementChild.className).toMatch(/up/)
    expect(within(down).getByTestId('terminal-oic-change').firstElementChild.className).toMatch(/down/)
    const heads = [...screen.getByTestId('terminal-oic-table').querySelectorAll('th')]
    expect(heads.map((h) => h.textContent)).toEqual(['Contract', 'Open interest', 'Change', 'Volume'])
    expect(heads[3].getAttribute('title')).toBe('Contracts traded on Tue Nov 17')
    expect(screen.getByTestId('terminal-oic-method').textContent).toContain('Volume is the contracts traded on Tue Nov 17.')
    // the low-value column is the one that folds on a narrow panel
    expect(heads[3].className).toMatch(/phoneHide/)
    expect(cells(up)[3].className).toMatch(/phoneHide/)
    expect(heads.slice(0, 3).some((h) => /phoneHide/.test(h.className))).toBe(false)
  })

  it('a new contract reads New with no sign, no percent and no colour, and its expiry carries its year', async () => {
    serve({ [URL]: answer({ rows: [NEW, row()], matched: 2, new: { contracts: 1, oi: 900 } }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    const fresh = rows()[0]
    expect(fresh.getAttribute('data-kind')).toBe('new')
    expect(cells(fresh).map(lines)).toEqual([['$105 call', 'Jan 15, 2027'], ['900', 'no earlier figure'], ['New', 'not in the earlier record'], ['n/a']])
    expect(within(fresh).getByTestId('terminal-oic-change').firstElementChild.className || '').not.toMatch(/up|down/)
    expect(screen.getByTestId('terminal-oic-note-new').textContent).toContain('1 contract is new: not in the Tue Nov 17 record, holding 900 open interest now.')
    expect(screen.getByTestId('terminal-oic-note-new').textContent).toContain('never as a change from 0')
  })

  it('a change from 0 shows the contracts and "from 0", never a percent', async () => {
    serve({ [URL]: answer({ rows: [row({ prior_oi: 0, oi: 250, change: 250, change_pct: null })], matched: 1 }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect(cells(rows()[0]).slice(1, 3).map(lines)).toEqual([['250', 'was 0'], ['+250', 'from 0']])
  })

  it('a missing day is named in a note, with the day compared against', async () => {
    serve({ [URL]: answer({ prior_session: '2026-11-13', skipped_sessions: ['2026-11-16', '2026-11-17'], volume_session: '2026-11-13' }) })
    renderPanel()
    const note = await screen.findByTestId('terminal-oic-note-skipped')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toBe('No record was stored for Mon Nov 16, Tue Nov 17, so this compares against Fri Nov 13, the last stored day, and the change covers more than one session.')
    expect(screen.getByTestId('terminal-oic-asof').textContent).toContain('Open interest recorded Wed Nov 18 against Fri Nov 13. Open interest is published once a day')
  })

  it('contracts left out are counted on the panel: gone, and not reported', async () => {
    serve({ [URL]: answer({ gone: { contracts: 2, prior_oi: 740, expired: 1 }, not_reported: 3 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-oic-note-gone')).textContent).toContain('2 contracts from the Tue Nov 17 record are not in the newer one (1 expired)')
    expect(screen.getByTestId('terminal-oic-note-not-reported').textContent).toContain('3 contracts have no open interest figure in one of the two records and are left out, not counted as 0.')
  })

  it('when the log carried no volume there is no volume column, and the panel says why', async () => {
    serve({ [URL]: answer({ volume_present: false, rows: [row({ volume: null })], matched: 1 }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect([...screen.getByTestId('terminal-oic-table').querySelectorAll('th')].map((h) => h.textContent)).toEqual(['Contract', 'Open interest', 'Change'])
    expect(cells(rows()[0])).toHaveLength(3)
    expect(screen.getByTestId('terminal-oic-method').textContent).toContain('The log carried no traded volume for these days, so there is no volume column.')
  })

  it('says what is covered, where it comes from, and that a change names no buyer, seller or direction', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const method = (await screen.findByTestId('terminal-oic-method')).textContent
    expect(method).toContain('Covered: every listed ZZA contract that had an ask, open interest or volume in the day\'s record, not only contracts with recent flow.')
    expect(method).toContain('A change in open interest does not say who opened or closed, or in which direction')
    expect(method).toContain('Source: UCT\'s options log')
    expect(screen.getByTestId('terminal-oic').textContent).not.toMatch(/bullish|bearish/i)
  })

  it('no contract changed: the totals stay and the table gives way to a sentence', async () => {
    serve({ [URL]: answer({ rows: [], matched: 0, summary: { call: { contracts: 2, oi: 1300, prior_oi: 1300, change: 0 }, put: { contracts: 1, oi: 2000, prior_oi: 2000, change: 0 }, contracts: 3, unchanged: 3 } }) })
    renderPanel()
    const none = await screen.findByTestId('terminal-oic-none')
    expect(none.textContent).toContain('No contract of ZZA changed between the two records.')
    expect(none.textContent).toContain('Every contract in both records holds the same open interest in each.')
    expect(screen.getByTestId('terminal-oic-total-call').textContent).toBe('0 (1,300 to 1,300, over 2 calls)')
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    expect(screen.queryByTestId('terminal-oic-cut')).toBeNull()
  })

  it('a failed re-read keeps the last answer on screen and says so', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect(screen.queryByTestId('terminal-oic-stale-read')).toBeNull()
    serve({})
    await act(async () => { await revalidateAll() })
    const stale = await screen.findByTestId('terminal-oic-stale-read')
    expect(stale.textContent).toBe('Open interest change could not be read just now. Showing the last read.')
    expect(rows()).toHaveLength(2)
  })

  it('a side whose read fails is an error with Retry, never the last side\'s rows under the new chip', async () => {
    serve({ [URL]: answer() })
    renderPanel({ sym: 'ZZA' }, { code: null })
    await screen.findByTestId('terminal-oic-table')
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    const err = await screen.findByTestId('terminal-oic-error')
    expect(err.textContent).toContain('Open interest change could not be read just now.')
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    serve({ [`${URL}?side=put`]: answer({ side: 'put', rows: [PUT], matched: 1 }) })
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByLabelText('Open interest change for ZZA, puts only, biggest change in contracts first')
    expect(rows().map((r) => r.getAttribute('data-type'))).toEqual(['put'])
  })
})

describe('OIC the cut', () => {
  it('draws 15 rows, says how many there are and which end is cut, and shows the rest on request', async () => {
    serve({ [URL]: many(40) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect(rows()).toHaveLength(OI_ROWS_SHOWN)
    expect(rows()[0].getAttribute('data-contract')).toBe('O:ZZA261120C00000100')         // the server's order is kept
    const cut = screen.getByTestId('terminal-oic-cut')
    expect(cut.textContent).toContain('Showing the 15 biggest of 40 changed or new contracts, by number of contracts. The smaller ones are cut from the bottom.')
    fireEvent.click(within(cut).getByRole('button', { name: 'Show 25 more' }))
    expect(rows()).toHaveLength(40)
    expect(screen.queryByTestId('terminal-oic-cut')).toBeNull()
  })

  it('past the server\'s cap the line stays and says how many were never sent', async () => {
    serve({ [URL]: many(50, 83) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    fireEvent.click(screen.getByTestId('terminal-oic-more'))
    expect(rows()).toHaveLength(50)
    const cut = screen.getByTestId('terminal-oic-cut')
    expect(cut.textContent).toContain('Showing the 50 biggest of 83 changed or new contracts, by number of contracts. The 33 smallest are not listed: the server sends the 50 biggest.')
    expect(within(cut).queryByRole('button')).toBeNull()
  })

  it('15 or fewer rows carry no cut line', async () => {
    serve({ [URL]: many(15) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect(rows()).toHaveLength(15)
    expect(screen.queryByTestId('terminal-oic-cut')).toBeNull()
  })
})

describe('OIC sides', () => {
  const PUTS = `${URL}?side=put`
  const CALLS = `${URL}?side=call`

  it('the chips ask the server for one side and say which is pressed', async () => {
    serve({ [URL]: answer(), [PUTS]: answer({ side: 'put', rows: [PUT], matched: 1 }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    expect(screen.getByTestId('terminal-oic-side-any').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    await screen.findByLabelText('Open interest change for ZZA, puts only, biggest change in contracts first')
    expect(rows().map((r) => r.getAttribute('data-type'))).toEqual(['put'])
    expect(screen.getByTestId('terminal-oic-side-put').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-oic-side-any').getAttribute('aria-pressed')).toBe('false')
    expect(asked()).toEqual([URL, PUTS])
    // the totals are the stock's, whatever side is listed
    expect(screen.getByTestId('terminal-oic-total-call').textContent).toContain('+600')
  })

  it('a typed side opens on that side: NVDA OIC C', async () => {
    serve({ [CALLS]: answer({ side: 'call', rows: [row()], matched: 1 }) })
    renderPanel({ sym: 'ZZA', side: 'call' })
    await screen.findByTestId('terminal-oic-table')
    expect(asked()).toEqual([CALLS])
    expect(screen.getByTestId('terminal-oic-side-call').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-oic').getAttribute('data-side')).toBe('call')
  })

  it('inside the terminal a chip writes the side into the panel\'s own command, with its stock', async () => {
    serve({ [URL]: answer(), [PUTS]: answer({ side: 'put', rows: [PUT], matched: 1 }), [CALLS]: answer({ side: 'call', rows: [row()], matched: 1 }) })
    const { rerun } = renderPanel({ sym: 'zza' }, { code: 'OIC' })
    await screen.findByTestId('terminal-oic-table')
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    expect(rerun).toHaveBeenLastCalledWith('ZZA OIC P')
    fireEvent.click(await screen.findByRole('button', { name: 'Calls' }))
    expect(rerun).toHaveBeenLastCalledWith('ZZA OIC C')
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))
    expect(rerun).toHaveBeenLastCalledWith('ZZA OIC')
    expect(rerun).toHaveBeenCalledTimes(3)
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))     // the pressed chip is not a new command
    expect(rerun).toHaveBeenCalledTimes(3)
  })

  it('outside the terminal the chip still works and writes nothing', async () => {
    serve({ [URL]: answer(), [PUTS]: answer({ side: 'put', rows: [PUT], matched: 1 }) })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-oic-table')
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    await screen.findByLabelText('Open interest change for ZZA, puts only, biggest change in contracts first')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a side with nothing changed says so for that side and offers both', async () => {
    serve({ [URL]: answer(), [PUTS]: answer({ side: 'put', rows: [], matched: 0 }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-table')
    fireEvent.click(screen.getByRole('button', { name: 'Puts' }))
    const none = await screen.findByTestId('terminal-oic-none')
    expect(none.textContent).toContain('No put of ZZA changed between the two records.')
    fireEvent.click(within(none).getByRole('button', { name: 'Show calls and puts' }))
    expect(await screen.findByTestId('terminal-oic-table')).toBeTruthy()
  })

  it('a new ticker is a new read: one stock\'s contracts are never drawn under another\'s name', async () => {
    serve({ [URL]: answer(), '/api/options-screener/oi-change/ZZB': PENDING })
    const { rerender } = renderPanel()
    await screen.findByTestId('terminal-oic-table')
    rerender({ sym: 'ZZB' })
    expect(screen.getByTestId('terminal-oic-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-oic-table')).toBeNull()
    expect(asked()).toEqual([URL, '/api/options-screener/oi-change/ZZB'])
  })
})

describe('OIC follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['OiChangePanel.jsx', 'oiChangeModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('OIC accessibility', () => {
  it('the full panel, a filtered side, the working state and an unknown stock pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer({ rows: [NEW, row(), PUT], matched: 3, new: { contracts: 1, oi: 900 }, skipped_sessions: ['2026-11-16'], prior_session: '2026-11-13' }) })
    renderPanel({ sym: 'ZZA' }, { code: 'OIC' })
    await screen.findByTestId('terminal-oic-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: many(40) })
    renderPanel()
    await screen.findByTestId('terminal-oic-cut')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { status: 'computing' } })
    renderPanel()
    await screen.findByTestId('terminal-oic-computing')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer({ known: false, rows: [], matched: 0 }) })
    renderPanel()
    await screen.findByTestId('terminal-oic-unknown')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
