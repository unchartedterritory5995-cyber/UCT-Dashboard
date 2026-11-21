// CACT: one stock's held splits and cash dividends, and its name or ticker changes. Rails:
//   * no ticker, loading, a failed read (error with Retry), signed out, no paid plan, a timeout, a
//     symbol the route refuses and an answer that is not the route's shape: none is "no corporate actions";
//   * `not_held` is said in words with the door that makes the server hold it, and is not "none";
//   * the held record: the count sentence, splits and dividends newest first, a ratio and an
//     amount in words, a missing one never 0, 12 rows then the rest on request, and the cut said
//     when the route itself cut the answer;
//   * a held record with neither in it says it cannot tell "none" from a read that failed when it was built;
//   * the source and the time the record was written are on screen with it, and in the header;
//   * the name block fails apart from the held record: loading, not switched on (404), a failed
//     read with a re-read, a record that could not be opened, no entry, an ambiguous ticker, the
//     former tickers and earlier holders (their tickers load through the kit), and a clean record;
//   * the door to DVD; a new ticker is a new read; no hard-coded color; axe.
// Every date, ratio, amount and ticker is invented; the bodies are the two routes' real shapes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CorporateActionsPanel, { CACT_CODE, CACT_ROWS_SHOWN, CACT_SOURCE, cactNamesUrl, cactUrl, heldAtWords } from './CorporateActionsPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const URL = '/api/research/corporate-actions/ZZA'
const NAMES = '/api/research/rename-notice/ZZA'
const HELD_AT = '2026-11-17T14:02:11+00:00'
const held = (over = {}) => ({
  sym: 'ZZA', status: 'ok', held_at: HELD_AT, source: 'massive', row_cap: 60,
  splits: { rows: [{ date: '2024-06-10', ratio: '10:1', to_factor: 10 }, { date: '2021-07-20', ratio: '1:4', to_factor: 0.25 }], total: 2, window_years: 45 },
  dividends: { rows: [{ date: '2026-09-10', amount: 0.0125 }, { date: '2026-06-11', amount: 0.01 }, { date: '2026-03-12', amount: 0.25 }], total: 3, window_years: 5, basis: 'split_adjusted' },
  ...over,
})
const NOT_HELD = {
  sym: 'ZZA', status: 'not_held', held_at: null, source: 'massive', row_cap: 60,
  reason: 'No splits or dividends are held on this server for ZZA. They are held once the stock\'s chart has been opened; this route never asks the data vendor.',
  splits: { rows: [], total: 0, window_years: 45 }, dividends: { rows: [], total: 0, window_years: 5, basis: 'split_adjusted' },
}
const manyDividends = (n, total = n) => ({
  rows: Array.from({ length: n }, (_, i) => ({ date: `20${String(25 - Math.floor(i / 12)).padStart(2, '0')}-${String(12 - (i % 12)).padStart(2, '0')}-10`, amount: 0.5 })),
  total, window_years: 5, basis: 'split_adjusted',
})
const record = (over = {}) => ({
  sym: 'ZZA', state: 'ok', source: 'entity_master',
  current: { entity_id: 'ent-1', ambiguous: false, formerly: [{ alias: 'ZZO', valid_from: '2015-03-02', valid_to: '2022-06-09' }] },
  previous_holders: [
    { entity_id: 'ent-2', held_from: '2001-01-02', held_to: '2012-05-04', now_trades_as: [{ alias: 'QQZ', valid_from: '2012-05-04' }, { alias: 'QQY', valid_from: '2012-05-04' }] },
    { entity_id: 'ent-3', held_from: null, held_to: '1999-12-31', now_trades_as: [] },
  ],
  ...over,
})
const CLEAN = record({ current: { entity_id: 'ent-1', ambiguous: false, formerly: [] }, previous_holders: [] })

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

function tree(props, { open, run, setFreshness, code }) {
  const panel = <CorporateActionsPanel {...props} />
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{panel}</TerminalPanelContext.Provider> : panel}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
}
function renderPanel(props = { sym: 'zza' }, { open = vi.fn(), run = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const ctx = { open, run, setFreshness, code }
  const view = render(tree(props, ctx))
  return { ...ctx, rerender: (next) => view.rerender(tree(next, ctx)) }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const bodyRows = (testId) => [...screen.getByTestId(testId).querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup() })

describe('CACT states', () => {
  it('with no ticker it asks for one and reads nothing', () => {
    serve({})
    renderPanel({ sym: '' }, { code: 'CACT' })
    expect(CACT_CODE).toBe('CACT')
    expect(screen.getByText('CACT needs a ticker.')).toBeTruthy()
    expect(document.querySelector('kbd').textContent).toBe('NVDA CACT')
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton for the stock, in capitals, and reads the held record first', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(cactUrl('ZZA')).toBe(URL)
    expect(cactNamesUrl('ZZA')).toBe(NAMES)
    expect(screen.getByTestId('terminal-cact-loading').textContent).toContain('Loading corporate actions for ZZA')
    expect(screen.queryByTestId('terminal-cact')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no corporate actions"', async () => {
    serve({})
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    const err = await screen.findByTestId('terminal-cact-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Corporate actions could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no corporate actions. Retry, or run ZZA CACT again.')
    expect(screen.queryByTestId('terminal-cact-not-held')).toBeNull()
    expect(screen.queryByTestId('terminal-cact-names')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: held(), [NAMES]: CLEAN })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-cact-splits')).toBeTruthy()
  })

  it('signed out and a timeout say so and can be retried; no paid plan is locked with no Retry', async () => {
    for (const [hit, kind, words] of [
      [fail(401), 'error', 'You are signed out, so corporate actions cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Corporate actions did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Corporate actions needs a paid plan.'],
      [fail(404), 'locked', 'Corporate actions is not switched on for this server yet.'],
    ]) {
      serve({ [URL]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-cact-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a symbol the route refuses (400) asks for a real one, with no Retry', async () => {
    serve({ [URL]: fail(400) })
    renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    const box = await screen.findByTestId('terminal-cact-bad-symbol')
    expect(box.getAttribute('data-kind')).toBe('input')
    expect(box.textContent).toContain('ZZA is not a stock or fund symbol this screen can read.')
    expect(screen.getByTestId('terminal-cact').getAttribute('data-state')).toBe('bad-symbol')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('an answer that is not the route\'s shape is a failed read, never an empty record', async () => {
    serve({ [URL]: { status: 'computing' } })
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-cact-error')
    expect(err.textContent).toContain('Corporate actions for ZZA could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no corporate actions.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(noDated(setFreshness)).toBe(true)
  })
})

describe('CACT nothing held', () => {
  it('says the server holds nothing, how it comes to hold it, and that this is not "none"', async () => {
    serve({ [URL]: NOT_HELD, [NAMES]: CLEAN })
    const { open, setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    const box = await screen.findByTestId('terminal-cact-not-held')
    expect(box.getAttribute('data-kind')).toBe('empty')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.textContent).toContain('No splits or dividends are held on the server for ZZA.')
    expect(box.textContent).toContain('This panel reads only what the server already holds and never asks the data vendor.')
    expect(box.textContent).toContain('then run ZZA CACT again.')
    expect(box.textContent).toContain('That is not the same as ZZA having had no split or dividend.')
    expect(screen.getByTestId('terminal-cact').getAttribute('data-state')).toBe('not_held')
    expect(screen.queryByTestId('terminal-cact-splits')).toBeNull()
    expect(screen.queryByTestId('terminal-cact-splits-none')).toBeNull()
    fireEvent.click(screen.getByTestId('panel-command-ZZA-GP'))
    expect(open).toHaveBeenCalledWith('ZZA GP')
    // the name record is its own read and is still shown
    expect(await screen.findByTestId('terminal-cact-names-clear')).toBeTruthy()
    expect(noDated(setFreshness)).toBe(true)
  })
})

describe('CACT the held record', () => {
  it('counts what is held and reports the source and the time it was written to the header', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-cact-headline')).textContent).toBe('ZZA: 2 splits and 3 cash dividends held.')
    expect(screen.getByTestId('terminal-cact').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-cact').getAttribute('data-sym')).toBe('ZZA')
    const report = lastReport(setFreshness)
    expect(report.source).toBe(CACT_SOURCE)
    expect(report.observedAt).toBe('2026-11-17T14:02:11.000Z')
  })

  it('draws the splits newest first, each ratio in words', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    renderPanel()
    const table = await screen.findByTestId('terminal-cact-splits')
    expect(table.getAttribute('aria-label')).toBe('ZZA splits, newest first, 2 of 2 held')
    expect(table.querySelector('caption').textContent).toBe('Splits')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Date', 'Split'])
    expect(bodyRows('terminal-cact-splits')).toEqual([['Jun 10, 2024', '10 for 1'], ['Jul 20, 2021', '1 for 4 (reverse split)']])
    expect(screen.queryByTestId('terminal-cact-splits-more')).toBeNull()
    expect(screen.queryByTestId('terminal-cact-splits-cut')).toBeNull()
  })

  it('draws the cash dividends by ex-date, newest first, and says the amounts are split-adjusted', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    renderPanel()
    const table = await screen.findByTestId('terminal-cact-dividends')
    expect(table.getAttribute('aria-label')).toBe('ZZA cash dividends by ex-date, newest first, 3 of 3 held')
    expect(table.querySelector('caption').textContent).toBe('Cash dividends')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Ex-date', 'Per share, split-adjusted'])
    expect(bodyRows('terminal-cact-dividends')).toEqual([['Sep 10, 2026', '$0.0125'], ['Jun 11, 2026', '$0.01'], ['Mar 12, 2026', '$0.25']])
  })

  it('says where the record comes from, when it was written, how far back it reaches and what it does not hold', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    renderPanel()
    const source = (await screen.findByTestId('terminal-cact-source')).textContent
    expect(heldAtWords(HELD_AT)).toBe('Nov 17, 2026, 9:02 AM ET')
    expect(heldAtWords(null)).toBe('')
    expect(heldAtWords('nope')).toBe('')
    expect(source).toContain('Source: Massive reference data, as the server holds it beside the chart.')
    expect(source).toContain('Held since Nov 17, 2026, 9:02 AM ET.')
    expect(source).toContain('This panel never asks the data vendor')
    expect(source).toContain('Splits reach back up to 45 years and dividends up to 5 years, by ex-date.')
    expect(source).toContain('Dividend amounts are split-adjusted')
    expect(source).toContain('No pay date is held.')
  })

  it('a record with no write time says so, and the header names the source alone', async () => {
    serve({ [URL]: held({ held_at: null }), [NAMES]: CLEAN })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-cact-source')).textContent).toContain('The held record carries no time.')
    const report = lastReport(setFreshness)
    expect(report.source).toBe(CACT_SOURCE)
    expect(report.observedAt).toBeUndefined()
  })

  it('a missing ratio or amount is said in words, never 0', async () => {
    serve({ [URL]: held({ splits: { rows: [{ date: '2024-06-10', ratio: null }], total: 1 }, dividends: { rows: [{ date: '2026-09-10', amount: null }, { date: '2026-06-11', amount: 0 }], total: 2 } }), [NAMES]: CLEAN })
    renderPanel()
    await screen.findByTestId('terminal-cact-splits')
    expect(bodyRows('terminal-cact-splits')).toEqual([['Jun 10, 2024', 'Ratio not given']])
    expect(bodyRows('terminal-cact-dividends')).toEqual([['Sep 10, 2026', 'Amount not given'], ['Jun 11, 2026', 'Amount not given']])
  })

  it('one kind missing from the record is said for that kind, and the other is still drawn', async () => {
    serve({ [URL]: held({ splits: { rows: [], total: 0, window_years: 45 } }), [NAMES]: CLEAN })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-splits-none')).textContent).toBe('No split is in the held record for ZZA.')
    expect(screen.getByTestId('terminal-cact-dividends')).toBeTruthy()
    cleanup()
    serve({ [URL]: held({ dividends: { rows: [], total: 0, window_years: 5 } }), [NAMES]: CLEAN })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-dividends-none')).textContent).toBe('No cash dividend is in the held record for ZZA.')
    expect(screen.getByTestId('terminal-cact-splits')).toBeTruthy()
  })

  it('a held record with neither in it cannot tell "none" from a read that failed, and says so', async () => {
    serve({ [URL]: held({ splits: { rows: [], total: 0 }, dividends: { rows: [], total: 0 } }), [NAMES]: CLEAN })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-headline')).textContent).toBe('The record held for ZZA has no split and no dividend in it.')
    expect(screen.getByTestId('terminal-cact-empty').textContent)
      .toBe('The held record does not say whether that is because there were none or because a read failed when it was built. That is not the same as none.')
    expect(screen.queryByTestId('terminal-cact-splits-none')).toBeNull()
    expect(screen.getByTestId('terminal-cact-source')).toBeTruthy()
  })

  it('opens the dividends and splits ahead on DVD beside it', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    const { open } = renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    await screen.findByTestId('terminal-cact-links')
    fireEvent.click(screen.getByTestId('panel-command-ZZA-DVD'))
    expect(open).toHaveBeenCalledWith('ZZA DVD')
  })

  it('a failed re-read of the name record leaves the held record on screen', async () => {
    serve({ [URL]: held(), [NAMES]: fail(500) })
    renderPanel()
    const names = await screen.findByTestId('terminal-cact-names-error')
    serve({})
    fireEvent.click(within(names).getByRole('button', { name: 'Read it again' }))
    await screen.findByTestId('terminal-cact-names-error')
    expect(screen.getByTestId('terminal-cact-splits')).toBeTruthy()
  })
})

describe('CACT the cut', () => {
  it('draws 12 rows, says how many are held, and shows the rest on request', async () => {
    serve({ [URL]: held({ dividends: manyDividends(14) }), [NAMES]: CLEAN })
    renderPanel()
    await screen.findByTestId('terminal-cact-dividends')
    expect(CACT_ROWS_SHOWN).toBe(12)
    expect(bodyRows('terminal-cact-dividends')).toHaveLength(12)
    expect(screen.getByTestId('terminal-cact-dividends').getAttribute('aria-label')).toBe('ZZA cash dividends by ex-date, newest first, 12 of 14 held')
    expect(screen.getByTestId('terminal-cact-dividends-cut').textContent).toBe('Showing the newest 12 of 14 dividends held.')
    const more = screen.getByTestId('terminal-cact-dividends-more')
    expect(more.textContent).toBe('Show all 14')
    expect(more.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(more)
    expect(bodyRows('terminal-cact-dividends')).toHaveLength(14)
    expect(screen.getByTestId('terminal-cact-dividends-more').textContent).toBe('Show 12')
    expect(screen.getByTestId('terminal-cact-dividends-more').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-cact-dividends-cut')).toBeNull()
  })

  it('when the route itself cut the answer, the panel says how many are held and that it reads no more', async () => {
    serve({ [URL]: held({ dividends: manyDividends(60, 84) }), [NAMES]: CLEAN })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-headline')).textContent).toBe('ZZA: 2 splits and 84 cash dividends held.')
    expect(screen.getByTestId('terminal-cact-dividends-cut').textContent).toBe('Showing the newest 12 of 84 dividends held.')
    fireEvent.click(screen.getByTestId('terminal-cact-dividends-more'))
    expect(bodyRows('terminal-cact-dividends')).toHaveLength(60)
    expect(screen.getByTestId('terminal-cact-dividends-cut').textContent).toBe('Showing the newest 60 of 84 dividends held; this panel reads at most 60.')
  })
})

describe('CACT name and ticker changes', () => {
  it('reads the record beside the held one, and says it is reading while it waits', async () => {
    serve({ [URL]: held(), [NAMES]: PENDING })
    renderPanel()
    const names = await screen.findByTestId('terminal-cact-names')
    expect(names.getAttribute('aria-label')).toBe('Name and ticker changes for ZZA')
    expect(names.textContent).toContain('Reading the name and ticker record for ZZA.')
    expect(asked()).toEqual([URL, NAMES])
    expect(screen.getByTestId('terminal-cact-splits')).toBeTruthy()          // the held record does not wait for it
  })

  it('lists the tickers this company used before and the companies that used this ticker before', async () => {
    serve({ [URL]: held(), [NAMES]: record() })
    const { run } = renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    const list = await screen.findByTestId('terminal-cact-names-list')
    expect(within(list).getByTestId('terminal-cact-formerly').textContent).toBe('ZZA traded as ZZO from Mar 2, 2015 until Jun 9, 2022.')
    const [first, second] = within(list).getAllByTestId('terminal-cact-previous')
    expect(first.textContent).toBe('A different company used ZZA from Jan 2, 2001 until May 4, 2012. It now trades as QQZ, QQY.')
    expect(second.textContent).toBe('A different company used ZZA until Dec 31, 1999. It holds no ticker in the record today.')
    fireEvent.click(screen.getByTestId('panel-symbol-QQY'))
    expect(run).toHaveBeenCalledWith('$QQY')
    expect(screen.queryByTestId('panel-symbol-ZZO')).toBeNull()               // a ticker no longer in use is plain text
    expect(screen.queryByTestId('terminal-cact-names-clear')).toBeNull()
  })

  it('a clean record says nothing earlier is on record', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-names-clear')).textContent)
      .toBe('No earlier ticker is on record for ZZA, and no other company is on record as having used ZZA.')
    expect(screen.getByTestId('terminal-cact-names-source').textContent).toContain("Source: UCT's dated ticker history.")
    expect(screen.getByTestId('terminal-cact-names-source').textContent).toContain('never inferred')
  })

  it('more than one company under the ticker today is said, and no earlier ticker is claimed for it', async () => {
    serve({ [URL]: held(), [NAMES]: record({ current: { ambiguous: true, formerly: [] }, previous_holders: [] }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-names-ambiguous')).textContent)
      .toBe('More than one company is on record under ZZA today, so no earlier ticker is listed for it.')
    expect(screen.queryByTestId('terminal-cact-names-clear')).toBeNull()
    expect(screen.queryByTestId('terminal-cact-names-list')).toBeNull()
  })

  it('no entry for the ticker is not "no change"', async () => {
    serve({ [URL]: held(), [NAMES]: { sym: 'ZZA', state: 'not_in_store', current: null, previous_holders: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-cact-names-none')).textContent)
      .toBe('The record has no entry for ZZA, so it cannot say whether its name or ticker changed.')
  })

  it('a record the server could not open says so, with a re-read', async () => {
    serve({ [URL]: held(), [NAMES]: { sym: 'ZZA', state: 'store_unavailable', reason: 'x' } })
    renderPanel()
    const note = await screen.findByTestId('terminal-cact-names-unavailable')
    expect(note.textContent).toContain('The name and ticker record could not be opened on the server just now. That is not the same as no name or ticker change.')
    serve({ [URL]: held(), [NAMES]: CLEAN })
    fireEvent.click(within(note).getByRole('button', { name: 'Read it again' }))
    expect(await screen.findByTestId('terminal-cact-names-clear')).toBeTruthy()
  })

  it('a server that has not switched the record on says that, with no re-read; the held record is still drawn', async () => {
    serve({ [URL]: held(), [NAMES]: fail(404) })
    renderPanel()
    const note = await screen.findByTestId('terminal-cact-names-error')
    expect(note.textContent).toContain('The name and ticker record is not switched on for this server yet. That is not the same as no name or ticker change.')
    expect(within(note).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('terminal-cact-splits')).toBeTruthy()
    expect(screen.getByTestId('terminal-cact-dividends')).toBeTruthy()
  })

  it('a failed read of the record, or an answer that is not its shape, can be read again and is never "no change"', async () => {
    serve({ [URL]: held(), [NAMES]: fail(500) })
    renderPanel()
    const note = await screen.findByTestId('terminal-cact-names-error')
    expect(note.textContent).toContain('The name and ticker record could not be read just now. That is not the same as no name or ticker change.')
    serve({ [URL]: held(), [NAMES]: record() })
    fireEvent.click(within(note).getByRole('button', { name: 'Read it again' }))
    expect(await screen.findByTestId('terminal-cact-names-list')).toBeTruthy()
    cleanup()
    serve({ [URL]: held(), [NAMES]: { state: 'weird' } })
    renderPanel()
    const odd = await screen.findByTestId('terminal-cact-names-error')
    expect(odd.textContent).toContain('The name and ticker record could not be read just now.')
    expect(within(odd).getByRole('button', { name: 'Read it again' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-cact-names-clear')).toBeNull()
  })
})

describe('CACT one stock at a time', () => {
  it('a new ticker is a new read: one stock\'s record is never drawn under another\'s name', async () => {
    serve({ [URL]: held(), [NAMES]: CLEAN, '/api/research/corporate-actions/ZZB': PENDING })
    const view = renderPanel({ sym: 'ZZA' })
    await screen.findByTestId('terminal-cact-splits')
    view.rerender({ sym: 'ZZB' })
    expect(screen.getByTestId('terminal-cact-loading').textContent).toContain('Loading corporate actions for ZZB')
    expect(screen.queryByTestId('terminal-cact-splits')).toBeNull()
    expect(asked()).toContain('/api/research/corporate-actions/ZZB')
  })
})

describe('CACT follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['CorporateActionsPanel.jsx', 'corporateActionsModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('CACT accessibility', () => {
  it('the full panel, the cut, nothing held, an empty record, no ticker and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: held(), [NAMES]: record() })
    renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    await screen.findByTestId('terminal-cact-names-list')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: held({ dividends: manyDividends(60, 84) }), [NAMES]: fail(404) })
    renderPanel()
    await screen.findByTestId('terminal-cact-names-error')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: NOT_HELD, [NAMES]: CLEAN })
    renderPanel({ sym: 'ZZA' }, { code: 'CACT' })
    await screen.findByTestId('terminal-cact-names-clear')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: held({ splits: null, dividends: null }), [NAMES]: CLEAN })
    renderPanel()
    await screen.findByTestId('terminal-cact-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    renderPanel({ sym: '' })
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: fail(402) })
    renderPanel()
    await screen.findByTestId('terminal-cact-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
