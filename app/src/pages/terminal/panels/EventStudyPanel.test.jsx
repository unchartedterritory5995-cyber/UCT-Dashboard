// EVST: "What happened next". Rails:
//   * loading, a failed read (error with Retry), signed out, a timeout, not on a paid plan, a switched-off
//     route, a spec the server refuses (422) and an answer that is not the route's shape: none is an empty panel;
//   * computing and busy say so and the panel asks again by itself; an unavailable study says why in words;
//   * the answer: the lead (condition, episodes, span) with the symbol through PanelSymbol, each window's
//     share up, average and median, worst and best against every session, a window with too little history
//     in words, every episode newest first ("open" before a window ends), the engine's method, the sources;
//     no episodes said in words;
//   * the form: grouped series from the menu, a category switch, inline checks before anything is sent, at
//     most four windows, Run sends the new study and keeps it in the browser, a ready-made study runs in one
//     click; the shell's ticker is the symbol measured; a broken menu leaves the study standing;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe.
// Every value is invented (__fixtures__/eventStudyFixture.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import EventStudyPanel, { EVST_CODE, EVST_SERIES_URL, EVST_STORE_KEY } from './EventStudyPanel'
import { DEFAULT_SPEC, loadStoredSpec, studyUrl } from './eventStudyModel'
import { menuAnswer, noEpisodesAnswer, studyAnswer, tooShortAnswer } from './__fixtures__/eventStudyFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
const DEFAULT_URL = studyUrl(DEFAULT_SPEC)
const isStudy = (u) => u.startsWith('/api/research/event-study?')

/** The menu answers `menu`; every study answers `study` (a function of the URL, a body, an Error or PENDING). */
function serve({ menu = menuAnswer(), study = studyAnswer() } = {}) {
  jsonFetcher.mockImplementation((u) => {
    const body = u === EVST_SERIES_URL ? menu : isStudy(u) ? (typeof study === 'function' ? study(u) : study) : fail(500)
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body)
  })
}
const studiesAsked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u).filter(isStudy))]

function renderPanel({ setFreshness = vi.fn(), code = null, sym } = {}) {
  const body = <EventStudyPanel sym={sym} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const answer = () => screen.getByTestId('terminal-evst-answer')

beforeEach(() => { jsonFetcher.mockReset(); window.localStorage.clear() })
afterEach(cleanup)

describe('EVST states', () => {
  it('shows a loading skeleton and asks the menu and the default study (SPY over 1, 3 and 6 months)', () => {
    serve({ study: PENDING })
    renderPanel()
    expect(EVST_CODE).toBe('EVST')
    expect(screen.getByTestId('terminal-evst-loading')).toBeTruthy()
    expect(answer().getAttribute('data-state')).toBe('loading')
    expect(studiesAsked()).toEqual([DEFAULT_URL])
    expect(DEFAULT_URL).toContain('symbol=SPY&horizons=1mo%2C3mo%2C6mo&episodes=first&entry=event_close')
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toContain(EVST_SERIES_URL)
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({ study: fail(500) })
    const { setFreshness } = renderPanel({ code: 'EVST' })
    const err = await screen.findByTestId('terminal-evst-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The study could not be read just now.')
    expect(err.textContent).toContain('Retry, or run EVST again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve()
    fireEvent.click(within(answer()).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-evst-windows-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the study cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The study did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The study needs a paid plan.'],
      [fail(404), 'locked', 'The study is not switched on for this server yet.'],
    ]) {
      serve({ study: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-evst-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!within(answer()).queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a spec the server refuses (422) and an answer that is not the route\'s shape are said, never an empty panel', async () => {
    serve({ study: fail(422) })
    renderPanel()
    expect((await screen.findByTestId('terminal-evst-refused')).textContent).toContain('The server could not take that study.')
    cleanup()
    for (const b of [{ items: [] }, { status: 'ok' }, []]) {
      serve({ study: b })
      renderPanel()
      expect((await screen.findByTestId('terminal-evst-error')).textContent).toContain('The study could not be read just now.')
      cleanup()
    }
  })

  it('a study being worked out says so, and the panel asks again by itself and fills in', async () => {
    let n = 0
    serve({ study: () => { n += 1; return n === 1 ? { status: 'computing' } : studyAnswer() } })
    renderPanel()
    const working = await screen.findByTestId('terminal-evst-computing')
    expect(working.textContent).toContain('working this study out over the whole history it holds')
    expect(answer().getAttribute('data-state')).toBe('computing')
    await screen.findByTestId('terminal-evst-windows-table', {}, { timeout: 8000 })
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('a busy server says so with Retry; an unavailable study says why in words', async () => {
    serve({ study: { status: 'busy', reason: 'busy', detail: 'The server is running other studies. Run this one again in a moment.' } })
    renderPanel()
    const busy = await screen.findByTestId('terminal-evst-busy')
    expect(busy.textContent).toContain('The server is running other studies.')
    expect(within(busy).getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ study: { status: 'unavailable', reason: 'not_enough_history', detail: 'ZZQA has too little stored history for that period.' } })
    renderPanel()
    const un = await screen.findByTestId('terminal-evst-unavailable')
    expect(un.textContent).toContain('ZZQA has too little stored history for that period.')
    expect(un.textContent).toContain('Too little history for this study')
  })
})

describe('EVST answer', () => {
  it('the lead, each window against every session, the episodes newest first, the method and the sources', async () => {
    serve()
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-evst-windows-table')
    expect(answer().getAttribute('data-state')).toBe('ok')
    const lead = screen.getByTestId('terminal-evst-lead')
    expect(lead.textContent).toContain('NASDAQ · % of Stocks Above 50-Day MA below 10.0%: 3 episodes between Jan 3, 2011 and Sep 30, 2024.')
    expect(lead.textContent).toContain("ZZQA afterwards, from the event session's close.")
    expect(within(lead).getByText('ZZQA')).toBeTruthy()
    expect(screen.getByTestId('terminal-evst-counted').textContent).toBe('The condition held on 9 sessions in 3 runs; each run counts once, on its first session.')
    expect(screen.getByTestId('terminal-evst-caveat').textContent).toMatch(/Small sample/)
    const windows = screen.getAllByTestId('terminal-evst-window')
    expect(windows.map((w) => w.getAttribute('data-token'))).toEqual(['1mo', '3mo'])
    expect(windows[0].textContent).toContain('1 month')
    expect(windows[0].textContent).toContain('3 episodes')
    expect(windows[0].textContent).toContain('67%')
    expect(windows[0].textContent).toContain('2 of 3')
    expect(windows[0].textContent).toContain('+1.5%')
    expect(windows[0].textContent).toContain('median +2.0%')
    expect(windows[0].textContent).toContain('-4.0% (Feb 8, 2018)')
    expect(windows[0].textContent).toContain('+6.5% (Aug 5, 2024)')
    const base = screen.getAllByTestId('terminal-evst-baseline')
    expect(base[0].textContent).toContain('All sessions')
    expect(base[0].textContent).toContain('5,000 sessions')
    expect(base[0].textContent).toContain('58%')
    expect(screen.getByTestId('terminal-evst-window-open').textContent).toContain('1 more episode is still open for 3 months.')
    const eps = screen.getAllByTestId('terminal-evst-episode')
    expect(eps.map((e) => e.getAttribute('data-date'))).toEqual(['2024-08-05', '2020-03-16', '2018-02-08'])
    expect(eps[0].textContent).toContain('Aug 5, 2024')
    expect(eps[0].textContent).toContain('at 8.4%')
    expect(eps[0].textContent).toContain('+6.5%')
    expect(within(eps[0]).getByText('open').getAttribute('title')).toBe('The window has not ended yet')
    expect(within(eps[1]).getByText('no close')).toBeTruthy()
    expect(screen.getByTestId('terminal-evst-episodes-heading').textContent).toBe('Every episode, newest first (3 episodes)')
    expect(screen.getByTestId('terminal-evst-method').textContent).toContain('Episodes: the first session of each run')
    expect(screen.getByTestId('terminal-evst-coverage').textContent).toContain('ZZQA closes from Jan 3, 2011 to Sep 30, 2024')
    expect(screen.getByTestId('terminal-evst-source').textContent).toContain('A record of what happened, not a forecast.')
    expect(setFreshness).toHaveBeenLastCalledWith(expect.objectContaining({ age: { asOfDate: '2024-09-30' } }))
  })

  it('no episodes and a window with too little history are said in words, never a row of zeros', async () => {
    serve({ study: noEpisodesAnswer() })
    renderPanel()
    expect((await screen.findByTestId('terminal-evst-none')).textContent).toContain('No episodes in the history held.')
    expect(screen.getByTestId('terminal-evst-lead').textContent).toBe('No episodes: NASDAQ · % of Stocks Above 50-Day MA was never below 1.0% between Jan 3, 2011 and Sep 30, 2024.')
    expect(screen.queryByTestId('terminal-evst-windows-table')).toBeNull()
    cleanup()
    serve({ study: tooShortAnswer() })
    renderPanel()
    await screen.findByTestId('terminal-evst-windows-table')
    const missing = screen.getByTestId('terminal-evst-window-missing')
    expect(missing.textContent).toBe('Too little history after the episodes for 24 months: 2 episodes are still open.')
    expect(screen.getAllByTestId('terminal-evst-window')[1].getAttribute('data-kind')).toBe('open')
  })
})

describe('EVST form', () => {
  it('opens on the form with the ready-made studies and the series grouped by category; the not-offered kinds say why', async () => {
    serve()
    renderPanel()
    const form = await screen.findByTestId('terminal-evst-form')
    const kind = within(form).getByLabelText('Series')
    expect([...kind.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Market breadth', 'Technical indicators', 'Futures positioning (COT)'])
    expect(within(form).getByLabelText('Stocks').value).toBe('nasdaq')
    expect(within(form).getByLabelText('Measure').value).toBe('pct_above_50sma')
    expect(within(form).getByLabelText('Threshold').value).toBe('10')
    expect(within(form).getByText('A share of stocks, from 0 to 100.')).toBeTruthy()
    expect(within(form).getByLabelText('Then measure').value).toBe('SPY')
    expect(['1mo', '3mo', '6mo'].every((t) => screen.getByTestId(`terminal-evst-window-${t}`).checked)).toBe(true)
    expect(within(form).getByLabelText('Count').value).toBe('first')
    expect(within(form).getByLabelText('Measure from').value).toBe('event_close')
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThanOrEqual(3)
    expect(screen.getByTestId('terminal-evst-not-offered').textContent).toContain('economic releases')
  })

  it('a category switch shows its own fields; a technical series takes a ticker and a period', async () => {
    serve()
    renderPanel()
    const form = await screen.findByTestId('terminal-evst-form')
    fireEvent.change(within(form).getByLabelText('Series'), { target: { value: 'technical' } })
    expect(within(form).getByLabelText('Ticker measured').value).toBe('SPY')
    expect(within(form).getByLabelText('Indicator').value).toBe('rsi')
    expect(within(form).getByLabelText('Period (sessions)').value).toBe('14')
    fireEvent.change(within(form).getByLabelText('Indicator'), { target: { value: 'day_pct' } })
    expect(within(form).queryByLabelText('Period (sessions)')).toBeNull()
    expect(within(form).getByText(/-3 is a 3% fall/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('Series'), { target: { value: 'cot' } })
    expect(within(form).getByLabelText('Futures market').value).toBe('ES')
    expect(within(form).getByLabelText('Traders (net contracts)').value).toBe('large_spec')
  })

  it('a threshold the measure cannot take is said beside it and nothing is sent', async () => {
    serve()
    renderPanel()
    const form = await screen.findByTestId('terminal-evst-form')
    await screen.findByTestId('terminal-evst-windows-table')
    const before = studiesAsked().length
    const box = within(form).getByLabelText('Threshold')
    fireEvent.change(box, { target: { value: '150' } })
    expect(screen.getByTestId('terminal-evst-dirty').textContent).toBe('Run to see this study.')
    fireEvent.click(screen.getByTestId('terminal-evst-run'))
    expect(within(form).getByRole('alert').textContent).toBe('This measure runs from 0 to 100.')
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(studiesAsked().length).toBe(before)
  })

  it('at most four windows; Run sends the new study and keeps it in this browser', async () => {
    serve()
    renderPanel()
    const form = await screen.findByTestId('terminal-evst-form')
    await screen.findByTestId('terminal-evst-windows-table')
    fireEvent.click(screen.getByTestId('terminal-evst-window-1w'))
    expect(screen.getByTestId('terminal-evst-window-1w').checked).toBe(true)
    expect(screen.getByTestId('terminal-evst-window-12mo').disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText('Threshold'), { target: { value: '20' } })
    fireEvent.change(within(form).getByLabelText('Then measure'), { target: { value: 'zzqb' } })
    fireEvent.click(screen.getByTestId('terminal-evst-run'))
    const want = '/api/research/event-study?kind=breadth&universe=nasdaq&metric=pct_above_50sma&op=below&threshold=20&symbol=ZZQB'
      + '&horizons=1w%2C1mo%2C3mo%2C6mo&episodes=first&entry=event_close'
    await screen.findByTestId('terminal-evst-windows-table')
    expect(studiesAsked()).toContain(want)
    expect(loadStoredSpec()).toMatchObject({ threshold: '20', symbol: 'ZZQB', horizons: ['1w', '1mo', '3mo', '6mo'] })
    expect(JSON.parse(window.localStorage.getItem(EVST_STORE_KEY)).kind).toBe('breadth')
  })

  it('a ready-made study runs in one click and shows as the one chosen', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-evst-examples')
    fireEvent.click(screen.getByTestId('terminal-evst-example-gold-specs-short'))
    expect(screen.getByTestId('terminal-evst-example-gold-specs-short').getAttribute('aria-pressed')).toBe('true')
    expect(studiesAsked()).toContain('/api/research/event-study?kind=cot&market=GC&group=large_spec&op=cross_below&threshold=0'
      + '&symbol=GLD&horizons=1mo%2C3mo%2C6mo&episodes=first&entry=event_close')
    expect(within(screen.getByTestId('terminal-evst-form')).getByLabelText('Futures market').value).toBe('GC')
  })

  it('opens on the last study kept in this browser, with the form folded; the shell\'s ticker is the symbol measured', async () => {
    window.localStorage.setItem(EVST_STORE_KEY, JSON.stringify({ kind: 'technical', series: 'ZZQA', indicator: 'rsi', period: '14',
      op: 'below', threshold: '30', symbol: 'ZZQA', horizons: ['1w'], episodes: 'all', entry: 'next_close' }))
    serve()
    renderPanel({ sym: 'nvda' })
    await screen.findByTestId('terminal-evst-windows-table')
    expect(studiesAsked()).toEqual(['/api/research/event-study?kind=technical&series=ZZQA&indicator=rsi&period=14&op=below&threshold=30'
      + '&symbol=NVDA&horizons=1w&episodes=all&entry=next_close'])
    expect(screen.queryByTestId('terminal-evst-form')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-evst-edit'))
    expect(within(screen.getByTestId('terminal-evst-form')).getByLabelText('Then measure').value).toBe('NVDA')
    cleanup()
    jsonFetcher.mockClear()
    window.localStorage.setItem(EVST_STORE_KEY, '{not json')
    serve()
    renderPanel()
    await screen.findByTestId('terminal-evst-windows-table')
    expect(studiesAsked()).toEqual([DEFAULT_URL])
  })

  it('a menu that cannot be read is said with Retry, and the study still stands', async () => {
    serve({ menu: fail(500) })
    renderPanel()
    const err = await screen.findByTestId('terminal-evst-menu-error')
    expect(err.textContent).toContain('The list of series could not be read just now.')
    expect(err.textContent).toContain('The study below still stands.')
    expect(await screen.findByTestId('terminal-evst-windows-table')).toBeTruthy()
    serve()
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-evst-form')).toBeTruthy()
  })
})

describe('EVST rails', () => {
  it('has no axe violations with the form open and an answer, while computing, and after a failed read', async () => {
    serve()
    const ok = renderPanel()
    await screen.findByTestId('terminal-evst-windows-table')
    await screen.findByTestId('terminal-evst-form')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ study: { status: 'computing' } })
    const working = renderPanel()
    await screen.findByTestId('terminal-evst-computing')
    await expectNoAxeViolations(working.container)
    cleanup()
    serve({ study: fail(500), menu: fail(500) })
    const failed = renderPanel()
    await screen.findByTestId('terminal-evst-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['EventStudyPanel.jsx', 'eventStudyModel.js', 'eventStudyPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'eventStudyPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)|infinite|data-fit|data-fold/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'EventStudyPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(EVST_SERIES_URL\)/)
    expect(src).toMatch(/useMarketRead\(url, \{ refreshInterval: pace \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(view\.source, view\.coverage\.priceLast\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
