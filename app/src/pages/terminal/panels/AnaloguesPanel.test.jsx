// ANLG: days like today, the past sessions whose breadth looked most like the newest one. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, a 503 and an answer that
//     is not the route's shape: none is "no similar day";
//   * too little history and no match are each said in words, never a failed read;
//   * the lede is the record sentence, the count is in every statistic, a window the calendar has
//     not reached reads "not yet" and is never 0;
//   * the picker asks the server for that many and writes the count into the command;
//   * no forecast wording; no hard-coded color; axe.
// Every number is invented; the fixtures are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { useEffect } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import AnaloguesPanel from './AnaloguesPanel'
import { ANLG_CODE, ANLG_POLL_MS, ANLG_RECORD_LINE, ANLG_SOURCE, anlgUrl } from './analoguesModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const URL = '/api/breadth-monitor/analogues?top_n=5'
const url = (n) => `/api/breadth-monitor/analogues?top_n=${n}`
const match = (date, similarity, forward_returns) => ({
  date, similarity, distance: 0.03, metrics_then: { breadth_score: 61, vix: 17.2, sp500_close: 5120.4 }, forward_returns,
})
const A = match('2025-03-04', 97.3, { fwd_5d: 1.2, fwd_10d: 2.4, fwd_20d: -0.8, fwd_60d: 6.1 })
const B = match('2024-09-12', 95.8, { fwd_5d: -0.6, fwd_10d: 0.4, fwd_20d: 1.9, fwd_60d: 4.4 })
const C = match('2026-10-21', 94.1, { fwd_5d: 0.9, fwd_10d: -1.1, fwd_20d: 2.6 })              // 60 days not reached
const D = match('2026-11-03', 93.6, { fwd_5d: 0, fwd_10d: 1.5 })                                // 20 and 60 not reached
const E = match('2025-06-18', 92.2, {})                                                          // no stored close
const FIVE = [A, B, C, D, E]
const answer = (analogues, over = {}) => ({ reference_date: '2026-11-19', reference_metrics: { breadth_score: 63 }, analogues, ...over })

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = routes[u]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

/** Re-reads every key the panel holds, as its poll would (set by the mounted tree). */
let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  useEffect(() => { revalidateAll = () => mutate(() => true) }, [mutate])
  return null
}

function renderPanel(props = {}, { rerun = vi.fn(), setFreshness = vi.fn(), open = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><AnaloguesPanel {...p} /></TerminalPanelContext.Provider>
            : <AnaloguesPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { rerun, setFreshness, open, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-anlg-row')
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
const pickCount = (n) => fireEvent.change(screen.getByTestId('terminal-anlg-count'), { target: { value: String(n) } })

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('ANLG states', () => {
  it('shows a loading skeleton and asks the one route with the route\'s default count', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(ANLG_CODE).toBe('ANLG')
    expect(anlgUrl()).toBe(URL)
    expect(ANLG_POLL_MS).toBe(1800000)
    expect(screen.getByTestId('terminal-anlg-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-anlg')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no similar day"', async () => {
    serve({})
    const { setFreshness } = renderPanel({}, { code: 'ANLG' })
    const err = await screen.findByTestId('terminal-anlg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Days like today could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no similar day. Retry, or run ANLG again.')
    expect(screen.queryByTestId('terminal-anlg-table')).toBeNull()
    expect(screen.queryByTestId('terminal-anlg-nomatch')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer(FIVE) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-anlg-table')).toBeTruthy()
  })

  it('signed out, a timeout, a 503 and no paid plan each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so days like today cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Days like today did not answer within 30 seconds.'],
      [fail(503), 'error', 'Days like today could not be read just now.'],
      [fail(402), 'locked', 'Days like today needs a paid plan.'],
    ]) {
      serve({ [URL]: err })
      renderPanel()
      const box = await screen.findByTestId('terminal-anlg-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!within(box).queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-anlg-table')).toBeNull()
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape is a failed read, never "no match"', async () => {
    serve({ [URL]: { status: 'ok', rows: [] } })
    renderPanel()
    const err = await screen.findByTestId('terminal-anlg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Days like today could not be read just now.')
    expect(screen.queryByTestId('terminal-anlg-nomatch')).toBeNull()
    expect(screen.queryByTestId('terminal-anlg-thin')).toBeNull()
  })

  it('too little stored history says what the comparison needs, is not dated, and is not an error', async () => {
    serve({ [URL]: { reference_date: null, analogues: [], reference_metrics: {} } })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-anlg-thin')
    expect(box.getAttribute('data-kind')).toBe('empty')
    expect(box.textContent).toContain('There is not enough breadth history stored yet to compare days.')
    expect(box.textContent).toContain('at least 20 stored sessions')
    expect(screen.getByTestId('terminal-anlg').getAttribute('data-state')).toBe('thin')
    expect(screen.queryByTestId('terminal-anlg-error')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('no match is an answer: it names the day, keeps the picker and the record sentence, and is dated', async () => {
    serve({ [URL]: answer([]) })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-anlg-nomatch')
    expect(box.textContent).toContain('No past session came back as similar to Thu Nov 19.')
    expect(box.textContent).toContain('That is an answer, not a failed read.')
    expect(screen.getByTestId('terminal-anlg-record').textContent).toBe(ANLG_RECORD_LINE)
    expect(screen.getByTestId('terminal-anlg-count')).toBeTruthy()
    expect(screen.queryByTestId('terminal-anlg-table')).toBeNull()
    expect(lastReport(setFreshness)).toEqual({ source: ANLG_SOURCE, age: { asOfDate: '2026-11-19' } })
  })
})

describe('ANLG the answer', () => {
  it('leads with the record sentence, says the count and the day, and dates the header by the reference day', async () => {
    serve({ [URL]: answer(FIVE) })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    expect(screen.getByTestId('terminal-anlg').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-anlg-record').textContent).toBe('A record of what followed similar days, not a forecast.')
    expect(screen.getByTestId('terminal-anlg-count-line').textContent)
      .toBe('The 5 past sessions whose breadth looked most like Thu Nov 19, closest first, and what the S&P 500 did after each. 5 sessions is a small sample.')
    expect(lastReport(setFreshness)).toEqual({ source: 'UCT breadth history (16 weighted breadth measures)', age: { asOfDate: '2026-11-19' } })
    expect(screen.getByLabelText('The 5 sessions most like Thu Nov 19, closest first, with the S&P 500 return after each')).toBeTruthy()
  })

  it('each row: the day with its year over its closeness, then the four windows as signed percents, in the route\'s order', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    expect(rows().map((r) => r.getAttribute('data-date'))).toEqual(['2025-03-04', '2024-09-12', '2026-10-21', '2026-11-03', '2025-06-18'])
    const cells = [...rows()[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['Tue Mar 4, 202597.3% match', '+1.20%', '+2.40%', '-0.80%', '+6.10%'])
    expect([...screen.getByTestId('terminal-anlg-table').querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Session', '5 days', '10 days', '20 days', '60 days'])
  })

  it('a window the calendar has not reached reads "not yet", a session with no stored close reads n/a: neither is 0', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    const [, , c, d, e] = rows()
    expect(within(c).getByTestId('terminal-anlg-fwd_60d').textContent).toBe('not yet')
    expect(within(c).getByTestId('terminal-anlg-fwd_60d').getAttribute('data-kind')).toBe('notyet')
    expect(within(c).getByTestId('terminal-anlg-fwd_60d').getAttribute('title')).toBe('Fewer than 60 trading days have passed since this session')
    expect(within(d).getByTestId('terminal-anlg-fwd_20d').textContent).toBe('not yet')
    expect(within(d).getByTestId('terminal-anlg-fwd_5d').textContent).toBe('0.00%')       // a real zero stays a number
    expect(within(d).getByTestId('terminal-anlg-fwd_5d').getAttribute('data-kind')).toBe('value')
    expect([...e.querySelectorAll('td')].slice(1).map((td) => td.textContent)).toEqual(['n/a', 'n/a', 'n/a', 'n/a'])
    expect(within(e).getByTestId('terminal-anlg-fwd_5d').getAttribute('data-kind')).toBe('none')
    // not one cell of an unreached window is drawn as a zero
    for (const td of screen.getAllByTestId('terminal-anlg-fwd_60d').slice(2)) expect(td.textContent).not.toMatch(/0\.00|^0/)
  })

  it('every statistic carries its count, and an unreached window is left out of it', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    const sum = (key) => screen.getByTestId(`terminal-anlg-sum-${key}`)
    expect(sum('fwd_5d').textContent).toBe('2 of 4 higher, 1 lower, median +0.45% (4 sessions; 1 with no figure)')
    expect(sum('fwd_5d').getAttribute('data-n')).toBe('4')
    expect(sum('fwd_20d').textContent).toBe('2 of 3 higher, 1 lower, median +1.90% (3 sessions; 1 not yet; 1 with no figure)')
    expect(sum('fwd_60d').textContent).toBe('2 of 2 higher, 0 lower, median +5.25% (2 sessions; 2 not yet; 1 with no figure)')
    expect([...screen.getByTestId('terminal-anlg-summary').querySelectorAll('dt')].map((dt) => dt.textContent))
      .toEqual(['5 trading days later', '10 trading days later', '20 trading days later', '60 trading days later'])
  })

  it('a window no session has reached says so with the count, never a zero or an empty line', async () => {
    serve({ [URL]: answer([C, D, match('2026-11-10', 91, { fwd_5d: -2 })]) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    expect(screen.getByTestId('terminal-anlg-sum-fwd_60d').textContent).toBe('Not yet: none of the 3 sessions has 60 trading days of history after it.')
    expect(screen.getByTestId('terminal-anlg-sum-fwd_60d').getAttribute('data-n')).toBe('0')
  })

  it('fewer sessions than asked for puts the count in the sentence', async () => {
    serve({ [URL]: answer([A, B]) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    expect(screen.getByTestId('terminal-anlg-count-line').textContent)
      .toBe('Only 2 sessions came back of the 5 asked for, compared with Thu Nov 19. That is too few to read as a pattern.')
  })

  it('green and red follow the sign of each return, and zero and "not yet" have neither', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    const span = (row, key) => within(row).getByTestId(`terminal-anlg-${key}`).querySelector('span')
    const [a, , c, d] = rows()
    expect(span(a, 'fwd_5d').className).toMatch(/up/)
    expect(span(a, 'fwd_20d').className).toMatch(/down/)
    expect(span(d, 'fwd_5d').className).not.toMatch(/up|down/)
    expect(span(c, 'fwd_60d').className).not.toMatch(/up|down/)
  })

  it('says how the comparison is made, and never words a forecast', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    const method = screen.getByTestId('terminal-anlg-method').textContent
    expect(method).toContain('16 weighted breadth measures')
    expect(method).toContain('last 500 trading days')
    expect(method).toContain('leaves out the 5 newest sessions')
    expect(method).toContain('at least 10 trading days apart')
    expect(method).toContain('Returns are the S&P 500 close, counted in trading days.')
    const all = screen.getByTestId('terminal-anlg').textContent
    expect(all).not.toMatch(/\bwill\b|expect|predict|likely|probab|bullish|bearish|last time|should/i)
    expect(all).not.toMatch(/—|–/)
  })

  it('a failed re-read keeps the last answer on screen and says so', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    serve({})
    await act(async () => { await revalidateAll() })
    const note = await screen.findByTestId('terminal-anlg-stale-read')
    expect(note.textContent).toBe('Days like today could not be read just now. Showing the last read.')
    expect(rows()).toHaveLength(5)
  })

  it('inside the terminal the breadth link opens BRD beside the panel', async () => {
    serve({ [URL]: answer(FIVE) })
    const { open } = renderPanel({}, { code: 'ANLG' })
    await screen.findByTestId('terminal-anlg-table')
    fireEvent.click(within(screen.getByTestId('terminal-anlg-links')).getByRole('button'))
    expect(open).toHaveBeenCalledWith('BRD')
  })
})

describe('ANLG the count', () => {
  it('the picker offers 3 to 10 and asks the server for that many', async () => {
    serve({ [URL]: answer(FIVE), [url(8)]: answer([A, B, C, D, E, match('2023-05-02', 90.1, { fwd_5d: 1 }), match('2023-01-09', 89.4, { fwd_5d: 2 }), match('2022-08-15', 88, { fwd_5d: 3 })]) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    const select = screen.getByTestId('terminal-anlg-count')
    expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['3', '4', '5', '6', '7', '8', '9', '10'])
    expect(select.value).toBe('5')
    pickCount(8)
    await screen.findByLabelText('The 8 sessions most like Thu Nov 19, closest first, with the S&P 500 return after each')
    expect(rows()).toHaveLength(8)
    expect(asked()).toEqual([URL, url(8)])
    expect(screen.getByTestId('terminal-anlg').getAttribute('data-count')).toBe('8')
  })

  it('a typed count opens on that count: ANLG 3 ... ANLG 10', async () => {
    for (const n of [3, 4, 6, 7, 8, 9, 10]) {
      jsonFetcher.mockReset()
      serve({ [url(n)]: answer([A, B, C]) })
      renderPanel({ count: n })
      await screen.findByTestId('terminal-anlg-table')
      expect(asked(), String(n)).toEqual([url(n)])
      expect(screen.getByTestId('terminal-anlg-count').value, String(n)).toBe(String(n))
      cleanup()
    }
  })

  it('a count the route does not take reads as the default', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel({ count: 40 })
    await screen.findByTestId('terminal-anlg-table')
    expect(asked()).toEqual([URL])
  })

  it('inside the terminal the picker writes the count into the panel\'s own command; the default writes the bare code', async () => {
    serve({ [URL]: answer(FIVE), [url(8)]: answer(FIVE), [url(3)]: answer([A, B, C]) })
    const { rerun } = renderPanel({}, { code: 'ANLG' })
    await screen.findByTestId('terminal-anlg-table')
    pickCount(8)
    expect(rerun).toHaveBeenLastCalledWith('ANLG 8')
    await screen.findByTestId('terminal-anlg-table')
    pickCount(3)
    expect(rerun).toHaveBeenLastCalledWith('ANLG 3')
    await screen.findByTestId('terminal-anlg-table')
    pickCount(5)
    expect(rerun).toHaveBeenLastCalledWith('ANLG')
    expect(rerun).toHaveBeenCalledTimes(3)
    await screen.findByTestId('terminal-anlg-table')
    pickCount(5)                                         // the count already showing is not a new command
    expect(rerun).toHaveBeenCalledTimes(3)
  })

  it('outside the terminal the picker still works and writes nothing', async () => {
    serve({ [URL]: answer(FIVE), [url(3)]: answer([A, B, C]) })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    pickCount(3)
    await screen.findByLabelText('The 3 sessions most like Thu Nov 19, closest first, with the S&P 500 return after each')
    expect(rows()).toHaveLength(3)
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a count whose read fails is an error with Retry, never the last count\'s rows under the new count', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    pickCount(7)
    const err = await screen.findByTestId('terminal-anlg-error')
    expect(err.textContent).toContain('Days like today could not be read just now.')
    expect(screen.queryByTestId('terminal-anlg-table')).toBeNull()
    serve({ [url(7)]: answer([A, B, C]) })
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-anlg-table')
    expect(rows()).toHaveLength(3)
  })

  it('a new command count is a new read: one count\'s rows are never drawn under another', async () => {
    serve({ [URL]: answer(FIVE), [url(9)]: PENDING })
    const { rerender } = renderPanel()
    await screen.findByTestId('terminal-anlg-table')
    rerender({ count: 9 })
    expect(screen.getByTestId('terminal-anlg-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-anlg-table')).toBeNull()
    expect(asked()).toEqual([URL, url(9)])
  })
})

describe('ANLG follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['AnaloguesPanel.jsx', 'analoguesModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('ANLG accessibility', () => {
  it('the full panel, no match, too little history and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel({}, { code: 'ANLG' })
    await screen.findByTestId('terminal-anlg-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([]) })
    renderPanel()
    await screen.findByTestId('terminal-anlg-nomatch')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { reference_date: null, analogues: [] } })
    renderPanel()
    await screen.findByTestId('terminal-anlg-thin')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderPanel()
    await screen.findByTestId('terminal-anlg-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
