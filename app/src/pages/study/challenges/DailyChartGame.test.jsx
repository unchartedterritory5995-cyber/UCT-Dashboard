/**
 * Daily Chart rails (docs/study/GAMES.md, kind `daily`). It registers from one export as a chart challenge; the start
 * arena carries the stakes, the day and the three steps; the draw is the shared one (rounds 3, shared, a fixed view, no
 * seed); each chart is the member's own chart with the ticker hidden and four setup names dealt from the day; a pick posts
 * Hard mode's answer through /attempts (XP flows there, no game run is ever posted); the verdict takes over the screen,
 * and on a miss it names the setup, what was said and the setup's rule; the end screen counts the day, logs each chart's
 * ticker, date and what fired, fills the level bar from the attempts, shares a plain line through the Clipboard API, keeps
 * the streak and counts down to midnight New York time; the day is written after every answer, so a second open shows the
 * result and a closed sheet resumes at the next chart; an empty pool, a failed pool and a failed answer each say so.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart" data-bars={(props.barsOverride || []).length} data-sym={props.sym}
      data-callouts={(props.callouts || []).map((c) => `${c.index}:${c.text}`).join('|')} data-look={props.calloutLook ? '1' : '0'}
      data-lines={(props.annotations || []).map((a) => a.id).join('|')} />
  ),
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: null }) }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const StockChart = (await import('../../../components/StockChart')).default
  return { default: (props) => <div data-testid="chart-pane">{props.identityLabel}<StockChart sym={props.sym} {...(props.stockChartProps || {})} /></div> }
})
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { chart_settings: {} } }) }))

import UIcon from '../../../components/ui/UIcon'
import DailyChartGame, { GAME } from './DailyChartGame'
import { ANSWER_FAILED, EMPTY_LINE, FAILED_LINE } from './games/dailyChart'

const TODAY = '2026-11-09'                         // a Monday; 10:00 AM in New York
const NOW = new Date('2026-11-09T15:00:00Z')
const KEY = `study.daily.${TODAY}`
const day = (i) => new Date(Date.UTC(2025, 0, 2) + i * 86400000).toISOString().slice(0, 10)
const bar = (i, c) => ({ t: day(i), o: c - 0.2, h: c + 0.3, l: c - 0.4, c, v: 1000 })
const BARS = Array.from({ length: 70 }, (_, i) => bar(i, 10 + i * 0.05))   // the last candle is Mar 12, 2025
const LAST = BARS.length - 1

// the day's three charts: each one's last candle is its setup and nothing else (the server's premise; every key is Yes)
const CHARTS = [
  { id: 'k1', skill: 'setup.family3.kicker', name: 'Kicker', sym: 'JBI' },
  { id: 'o1', skill: 'setup.family4.oops', name: 'Oops Reversal', sym: 'NVDA' },
  { id: 'g1', skill: 'setup.family3.gap_support', name: 'Gap Support', sym: 'ZM' },
]
const BY_ID = Object.fromEntries(CHARTS.map((c) => [c.id, c]))
const KICKER_PLAN = { skill: 'setup.family3.kicker', direction: 'bullish', entry: 13.76, stop: 13.28, t1: 14.72, t2: 15.2, enters_intraday: false,
  entry_note: "over the red day's high", stop_note: "under the Kicker's low", trail: 'under each higher low' }
const lessonOf = (c) => `${c.name}: the day before closes red; then the next day gaps up and closes near its high. Here the stock gapped 2.4% over the red day.`
const forward = (n, from = 13.9) => Array.from({ length: n }, (_, i) => bar(70 + i, from + i * 0.4))

/** The server, shaped as the routes answer: the shared draw, each answer scored against a Yes key the browser never saw,
 *  the reveal with the ticker, the lesson, the setup's rule and three forward bars of five, and the XP with the member's
 *  running total. `pool` swaps the draw; `failOn` makes one answer fail once. */
function makeFetcher({ calls = [], posts = [], pool = CHARTS, poolError = null, failOn = new Set(), xpStart = 990 } = {}) {
  let xp = xpStart
  let seq = 100
  return vi.fn(async (url, opts = {}) => {
    calls.push({ url, body: opts.body })
    if (url === '/api/study/spot-setup') {
      if (poolError) throw poolError
      return { session_id: 'sess-d', items: pool.map((c) => ({ id: c.id, type: 'spot', skill_id: c.skill, prompt_json: { q: `Does the firm's ${c.name} setup fire on the last bar?`, choices: ['Yes', 'No'] }, bars: { symbol: c.id, tf: 'D', bars: BARS }, look: { real: LAST, lookalikes: [] } })) }
    }
    if (url === '/api/study/attempts') {
      posts.push(opts.body)
      const c = BY_ID[opts.body.item_id]
      if (failOn.has(c.id)) { failOn.delete(c.id); const e = new Error('POST /api/study/attempts answered 500'); e.status = 500; throw e }
      const correct = opts.body.answer.choice === 'Yes'
      const gained = correct ? 10 : 0
      xp += gained
      return {
        attempt_id: (seq += 1), correct,
        reveal: { answer: { answer: 'yes' }, sym: c.sym, asof: '2025-03-12', lesson: lessonOf(c), forward_bars: forward(3), forward_total: 5,
          setup_rule: { name: c.name, text: 'the day before closes red; then the next day gaps up.' }, ...(c.id === 'k1' ? { trade: KICKER_PLAN } : {}) },
        progress: { xp_gained: gained, xp },
      }
    }
    if (/^\/api\/study\/attempts\/\d+\/step$/.test(url)) return { bars: [bar(73, 14.9), bar(74, 14.6)] }
    if (/^\/api\/study\/attempts\/\d+\/intraday$/.test(url)) return { tf: 30, days: {} }
    throw new Error(`unexpected ${url}`)
  })
}

const tiles = () => within(screen.getByTestId('daily-cards')).getAllByRole('button')
const labelOf = (b) => b.textContent.replace(/^\d/, '').trim()
/** Pick a tile (by its setup name, or the first that is not `notName`), Check, and wait for the verdict. */
async function answer({ name = null, notName = null } = {}) {
  await screen.findByTestId('daily-cards')
  const tile = name ? tiles().find((b) => labelOf(b) === name) : tiles().find((b) => labelOf(b) !== notName)
  fireEvent.click(tile)
  fireEvent.click(screen.getByTestId('daily-check'))
  return { picked: labelOf(tile), takeover: await screen.findByTestId('daily-takeover') }
}
async function begin(fetcher, props = {}) {
  render(<DailyChartGame fetcher={fetcher} onClose={() => {}} {...props} />)
  const go = await screen.findByTestId('daily-start')
  await waitFor(() => expect(go).not.toBeDisabled())
  fireEvent.click(go)
}
const stored = (k = KEY) => JSON.parse(localStorage.getItem(k))

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); delete navigator.clipboard })

describe('DailyChartGame', () => {
  it('registers from one export as a chart challenge, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'daily', title: 'Daily Chart', sub: expect.any(String), icon: 'calendar', plate: 'Daily', accent: 'amber', group: 'chart' })
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
    const { container } = render(<UIcon name={GAME.icon} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it("opens on the arena with the day, the stakes and the three steps, and asks for the shared draw", async () => {
    const calls = []
    render(<DailyChartGame fetcher={makeFetcher({ calls })} onClose={() => {}} />)
    const intro = screen.getByTestId('daily-intro')
    expect(intro).toHaveTextContent('Daily Chart')
    expect(intro).toHaveTextContent('charts today')
    expect(intro).toHaveTextContent('go a day')
    expect(intro).toHaveTextContent('day streak')
    expect(screen.getByTestId('daily-start')).toHaveTextContent("Loading today's charts")
    const howto = screen.getByTestId('daily-howto')
    expect(howto).toHaveTextContent("Today's three charts")
    expect(howto).toHaveTextContent('Name what fired')
    expect(howto).toHaveTextContent('Watch it, then share')
    await waitFor(() => expect(screen.getByTestId('daily-start')).not.toBeDisabled())
    expect(screen.getByTestId('daily-start')).toHaveTextContent("Play today's charts")
    expect(screen.getByTestId('daily-day')).toHaveTextContent('Monday, Nov 9')
    expect(intro).toHaveTextContent('The same three charts for every member today')
    // the same three for every member: shared, a fixed view, and never a per-member seed
    const draw = calls.filter((c) => c.url === '/api/study/spot-setup')
    expect(draw).toHaveLength(1)
    expect(draw[0].body).toEqual({ rounds: 3, shared: true, view: 90 })
    expect(intro.textContent).not.toMatch(/[—–]|\bthe firm\b/i)
  })

  it('a right answer: the chart hides its ticker, the pick posts Yes, the verdict takes over with the XP, the day is written', async () => {
    const posts = []
    await begin(makeFetcher({ posts }))
    expect(screen.getByTestId('daily-step')).toHaveTextContent('chart 1 of 3')
    // four setup names, the chart's own among them, and no "Nothing fired" (something always fired here)
    expect(tiles()).toHaveLength(4)
    expect(tiles().map(labelOf)).toContain('Kicker')
    expect(screen.getByTestId('daily-cards').textContent).not.toContain('Nothing fired')
    const chart = screen.getByTestId('stock-chart')
    expect(chart.getAttribute('data-sym')).toBe('k1')                  // the item id, never the ticker
    expect(chart.getAttribute('data-callouts')).toBe(`${LAST}:What fired here?`)
    expect(screen.getByTestId('sym-label').textContent).not.toContain('JBI')
    expect(screen.getByText('What fired on the last candle?')).toBeInTheDocument()

    const { takeover } = await answer({ name: 'Kicker' })
    expect(posts[0]).toMatchObject({ item_id: 'k1', session_id: 'sess-d', answer: { choice: 'Yes', picked_setup: 'Kicker' } })
    expect(takeover).toHaveAttribute('data-correct', '1')
    expect(takeover).toHaveTextContent('Named it.')
    expect(takeover).toHaveTextContent('Kicker on JBI · Mar 12, 2025')
    expect(takeover).toHaveTextContent('+10 XP')
    // written on the device the moment it was scored, before the member reads anything
    expect(stored()).toMatchObject({ day: TODAY, total: 3, done: false, charts: [{ id: 'k1', ok: true, ticker: 'JBI', date: '2025-03-12', xp: 10 }] })

    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    expect(screen.getByTestId('sym-label')).toHaveTextContent('JBI')
    await waitFor(() => expect(screen.getByTestId('stock-chart').getAttribute('data-callouts')).toMatch(new RegExp(`^${LAST}:Kicker`)))
    const lesson = screen.getByTestId('daily-lesson')
    expect(lesson).toHaveTextContent('Why it’s a Kicker')
    expect(lesson).toHaveTextContent('$13.76')                           // the plan the reveal sent, drawn and reviewed
    expect(screen.getByTestId('daily-key')).toBeInTheDocument()
    expect(screen.getByTestId('daily-next')).toHaveTextContent('Next chart')
  })

  it("a wrong answer posts the name as itself, then takes over with what it was, what was said and the setup's rule", async () => {
    const posts = []
    await begin(makeFetcher({ posts }))
    await answer({ name: 'Kicker' })
    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    fireEvent.click(screen.getByTestId('daily-next'))
    await waitFor(() => expect(screen.getByTestId('daily-step')).toHaveTextContent('chart 2 of 3'))
    const { picked, takeover } = await answer({ notName: 'Oops Reversal' })
    expect(posts[1]).toMatchObject({ item_id: 'o1', answer: { choice: picked, picked_setup: picked } })
    expect(takeover).toHaveAttribute('data-correct', '0')
    expect(takeover).toHaveTextContent('It was an Oops Reversal.')
    expect(takeover).toHaveTextContent(`NVDA · Mar 12, 2025 · you said ${picked}`)
    expect(screen.getByTestId('daily-takeover-rule')).toHaveTextContent('The Oops Reversal rule: The day before closes red; then the next day gaps up and closes near its high.')
    expect(takeover).not.toHaveTextContent('XP')
    expect(screen.getByTestId('daily-takeover-go')).toHaveTextContent('See the lesson')
    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    // the right tile lights, the pick is marked, the lesson stays on the screen
    expect(tiles().find((b) => labelOf(b) === 'Oops Reversal')).toHaveAttribute('data-state', 'right')
    expect(tiles().find((b) => labelOf(b) === picked)).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByTestId('daily-lesson')).toHaveTextContent('Why it’s an Oops Reversal')
    expect(screen.getByTestId('daily-lesson')).toHaveTextContent('Here the stock gapped 2.4% over the red day.')
    expect(stored().charts.map((r) => [r.id, r.ok, r.said])).toEqual([['k1', true, 'Kicker'], ['o1', false, picked]])
  })

  it('the end screen: the score, the run log, the XP and level bar from the attempts, the share line copied, the streak and the countdown', async () => {
    const calls = []
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await begin(makeFetcher({ calls }))
    await answer({ name: 'Kicker' })
    fireEvent.click(screen.getByTestId('daily-takeover-go')); fireEvent.click(screen.getByTestId('daily-next'))
    const miss = await answer({ notName: 'Oops Reversal' })
    fireEvent.click(screen.getByTestId('daily-takeover-go')); fireEvent.click(screen.getByTestId('daily-next'))
    await answer({ name: 'Gap Support' })
    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    expect(screen.getByTestId('daily-next')).toHaveTextContent('See your score')
    fireEvent.click(screen.getByTestId('daily-next'))

    const end = await screen.findByTestId('daily-done')
    expect(screen.getByTestId('daily-score')).toHaveAttribute('aria-label', '2 of 3 named')
    expect(screen.getByTestId('daily-right')).toHaveTextContent('2/3')
    const log = screen.getByTestId('run-log')
    expect(log).toHaveTextContent('Kicker')
    expect(log).toHaveTextContent('JBI · Mar 12, 2025')
    expect(log).toHaveTextContent('Oops Reversal')
    expect(log).toHaveTextContent('NVDA · Mar 12, 2025')
    expect(log).toHaveTextContent(`you said ${miss.picked}`)
    expect(log).toHaveTextContent('ZM · Mar 12, 2025')
    // the XP is the attempts' (990 before, 1010 after: a level crossed), never a game run
    await waitFor(() => expect(screen.getByTestId('daily-xp')).toHaveTextContent('+20'))
    expect(screen.getByTestId('daily-level')).toHaveTextContent('+20 XP this run')
    expect(screen.getByTestId('daily-level-up')).toHaveTextContent('Level 3')
    expect(calls.some((c) => c.url === '/api/study/game-runs')).toBe(false)
    expect(calls.filter((c) => c.url === '/api/study/attempts')).toHaveLength(3)
    // the share line, plain characters, copied with the Clipboard API
    expect(screen.getByTestId('daily-share')).toHaveTextContent(`UCT Daily Chart ${TODAY}: 2/3 X - X`)
    expect(screen.getByTestId('daily-copy-note')).toHaveTextContent('no tickers, no spoilers')
    fireEvent.click(screen.getByTestId('daily-again'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`UCT Daily Chart ${TODAY}: 2/3 X - X`))
    expect(await screen.findByText('Copied. Paste it anywhere.')).toBeInTheDocument()
    expect(screen.getByTestId('daily-again')).toHaveTextContent('Copied')
    // the streak and the countdown to midnight in New York (10:00 AM EST: fourteen hours)
    expect(screen.getByTestId('daily-days')).toHaveTextContent('1 day in a row')
    expect(screen.getByTestId('daily-countdown')).toHaveTextContent('Next charts in 14:00:00')
    expect(end).toHaveTextContent("Today's card · Monday, Nov 9")
    // the day and the streak are on the device
    expect(stored()).toMatchObject({ day: TODAY, total: 3, done: true })
    expect(stored('study.daily.streak')).toEqual({ last: TODAY, count: 1, best: 1 })
    expect(end.textContent).not.toMatch(/[—–]|\bthe firm\b/i)
  })

  it('a second open the same day shows the result from the device and draws nothing', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 3, done: true, charts: [
      { id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, fired: true, ticker: 'JBI', date: '2025-03-12', xp: 10 },
      { id: 'o1', name: 'Oops Reversal', said: 'Slingshot', ok: false, fired: true, ticker: 'NVDA', date: '2025-03-12', xp: 0 },
      { id: 'g1', name: 'Gap Support', said: 'Gap Support', ok: true, fired: true, ticker: 'ZM', date: '2025-03-12', xp: 10 },
    ] }))
    localStorage.setItem('study.daily.streak', JSON.stringify({ last: TODAY, count: 5, best: 7 }))
    const fetcher = makeFetcher()
    const onClose = vi.fn()
    render(<DailyChartGame fetcher={fetcher} onClose={onClose} />)
    expect(screen.getByTestId('daily-done')).toBeInTheDocument()
    expect(screen.queryByTestId('daily-intro')).toBeNull()
    expect(screen.getByTestId('daily-card')).toHaveTextContent('You played today · Monday, Nov 9')
    expect(screen.getByTestId('daily-share')).toHaveTextContent(`UCT Daily Chart ${TODAY}: 2/3 X - X`)
    expect(screen.getByTestId('run-log')).toHaveTextContent('you said Slingshot')
    expect(screen.getByTestId('daily-days')).toHaveTextContent('5 days in a row · best 7')
    expect(screen.getByTestId('daily-countdown')).toHaveTextContent('Next charts in 14:00:00')
    expect(screen.queryByTestId('daily-level')).toBeNull()                // no run was played: no level bar
    await new Promise((r) => setTimeout(r, 20))
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Study' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('a sheet closed mid-run resumes at the next chart; the answers given stand', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 3, charts: [
      { id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, fired: true, ticker: 'JBI', date: '2025-03-12', xp: 10 },
    ] }))
    const posts = []
    render(<DailyChartGame fetcher={makeFetcher({ posts })} onClose={() => {}} />)
    const go = await screen.findByTestId('daily-start')
    await waitFor(() => expect(go).toHaveTextContent('Pick up at chart 2'))
    expect(screen.getByTestId('daily-intro')).toHaveTextContent('You named 1 of 1 so far today. Pick up at chart 2 of 3.')
    fireEvent.click(go)
    expect(await screen.findByTestId('daily-step')).toHaveTextContent('chart 2 of 3')
    expect(screen.getByTestId('stock-chart').getAttribute('data-sym')).toBe('o1')
    await answer({ name: 'Oops Reversal' })
    fireEvent.click(screen.getByTestId('daily-takeover-go')); fireEvent.click(screen.getByTestId('daily-next'))
    await answer({ name: 'Gap Support' })
    fireEvent.click(screen.getByTestId('daily-takeover-go')); fireEvent.click(screen.getByTestId('daily-next'))
    await screen.findByTestId('daily-done')
    expect(posts.map((p) => p.item_id)).toEqual(['o1', 'g1'])               // the first chart is never asked again
    expect(screen.getByTestId('daily-share')).toHaveTextContent(`UCT Daily Chart ${TODAY}: 3/3 X X X`)
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('1')
  })

  it('carries a streak on from yesterday', async () => {
    localStorage.setItem('study.daily.streak', JSON.stringify({ last: '2026-11-08', count: 4, best: 4 }))
    render(<DailyChartGame fetcher={makeFetcher({ pool: CHARTS.slice(0, 1) })} onClose={() => {}} />)
    expect(screen.getByTestId('daily-intro')).toHaveTextContent('4day streak')
    const go = await screen.findByTestId('daily-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    // a thin bank deals what it has, and says so, the steps too
    expect(screen.getByTestId('daily-intro')).toHaveTextContent('The same chart for every member today')
    expect(screen.getByTestId('daily-howto')).toHaveTextContent("Today's chart")
    expect(screen.getByTestId('daily-howto')).not.toHaveTextContent('three')
    fireEvent.click(go)
    await answer({ name: 'Kicker' })
    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    expect(screen.getByTestId('daily-next')).toHaveTextContent('See your score')
    fireEvent.click(screen.getByTestId('daily-next'))
    await screen.findByTestId('daily-done')
    expect(screen.getByTestId('daily-days')).toHaveTextContent('5 days in a row')
    expect(screen.getByTestId('daily-share')).toHaveTextContent(`UCT Daily Chart ${TODAY}: 1/1 X`)
    expect(stored('study.daily.streak')).toEqual({ last: TODAY, count: 5, best: 5 })
  })

  it('an answer that does not land is not a miss: it says so, keeps the pick, records nothing, and Check tries again', async () => {
    const posts = []
    await begin(makeFetcher({ posts, failOn: new Set(['k1']) }))
    await screen.findByTestId('daily-cards')
    fireEvent.click(tiles().find((b) => labelOf(b) === 'Kicker'))
    fireEvent.click(screen.getByTestId('daily-check'))
    expect(await screen.findByTestId('daily-fail')).toHaveTextContent(ANSWER_FAILED)
    expect(screen.queryByTestId('daily-takeover')).toBeNull()
    expect(tiles().find((b) => labelOf(b) === 'Kicker')).toHaveAttribute('data-state', 'sel')
    expect(localStorage.getItem(KEY) == null || stored().charts.length === 0).toBe(true)
    fireEvent.click(screen.getByTestId('daily-check'))
    expect(await screen.findByTestId('daily-takeover')).toHaveTextContent('Named it.')
    expect(screen.queryByTestId('daily-fail')).toBeNull()
    expect(posts).toHaveLength(2)
    expect(stored().charts).toHaveLength(1)
  })

  it('a second tab never writes over an answer already given: the first answer to a chart stands', async () => {
    const posts = []
    await begin(makeFetcher({ posts }))
    await screen.findByTestId('daily-cards')
    // while this screen was open, another tab answered the first chart (a miss) and the device holds it
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 3, charts: [
      { id: 'k1', name: 'Kicker', said: 'Slingshot', ok: false, fired: true, ticker: 'JBI', date: '2025-03-12', xp: 0 },
    ] }))
    await answer({ name: 'Kicker' })
    expect(stored().charts.map((r) => [r.id, r.ok, r.said])).toEqual([['k1', false, 'Slingshot']])
    fireEvent.click(screen.getByTestId('daily-takeover-go')); fireEvent.click(screen.getByTestId('daily-next'))
    await answer({ name: 'Oops Reversal' })
    expect(stored().charts.map((r) => [r.id, r.ok])).toEqual([['k1', false], ['o1', true]])
  })

  it('a day finished in another tab opens on its result when Start is pressed, and plays nothing', async () => {
    const posts = []
    render(<DailyChartGame fetcher={makeFetcher({ posts })} onClose={() => {}} />)
    const go = await screen.findByTestId('daily-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 3, charts: [
      { id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, fired: true, ticker: 'JBI', date: '2025-03-12', xp: 10 },
      { id: 'o1', name: 'Oops Reversal', said: 'Oops Reversal', ok: true, fired: true, ticker: 'NVDA', date: '2025-03-12', xp: 10 },
      { id: 'g1', name: 'Gap Support', said: 'Kicker', ok: false, fired: true, ticker: 'ZM', date: '2025-03-12', xp: 0 },
    ] }))
    fireEvent.click(go)
    expect(await screen.findByTestId('daily-done')).toBeInTheDocument()
    expect(screen.getByTestId('daily-share')).toHaveTextContent(`UCT Daily Chart ${TODAY}: 2/3 X X -`)
    expect(posts).toHaveLength(0)
    expect(stored('study.daily.streak')).toEqual({ last: TODAY, count: 1, best: 1 })
  })

  it('plays under StrictMode: the double mount never leaves an answer unshown', async () => {
    const posts = []
    render(<StrictMode><DailyChartGame fetcher={makeFetcher({ posts })} onClose={() => {}} /></StrictMode>)
    const go = await screen.findByTestId('daily-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    const { takeover } = await answer({ name: 'Kicker' })
    expect(takeover).toHaveTextContent('Named it.')
    expect(posts).toHaveLength(1)
    fireEvent.click(screen.getByTestId('daily-takeover-go'))
    expect(screen.getByTestId('daily-lesson')).toBeInTheDocument()
  })

  it('plays from the keyboard: a number picks, Enter checks, Enter opens the review, Enter moves on', async () => {
    const posts = []
    await begin(makeFetcher({ posts }))
    await screen.findByTestId('daily-cards')
    const n = tiles().findIndex((b) => labelOf(b) === 'Kicker') + 1
    fireEvent.keyDown(window, { key: String(n) })
    expect(tiles()[n - 1]).toHaveAttribute('data-state', 'sel')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(await screen.findByTestId('daily-takeover')).toHaveTextContent('Named it.')
    expect(posts[0].answer).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('daily-takeover')).toBeNull())
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('daily-step')).toHaveTextContent('chart 2 of 3'))
    expect(posts).toHaveLength(1)                                            // one Enter, one action: nothing posted twice
  })

  it('an empty pool says so honestly, with a way back', async () => {
    const onClose = vi.fn()
    render(<DailyChartGame fetcher={makeFetcher({ pool: [] })} onClose={onClose} />)
    expect(await screen.findByTestId('daily-empty')).toBeInTheDocument()
    expect(screen.getByTestId('daily-intro')).toHaveTextContent(EMPTY_LINE)
    expect(screen.getByTestId('daily-start')).toBeDisabled()
    expect(screen.getByTestId('daily-start')).toHaveTextContent('No charts yet')
    fireEvent.click(screen.getByTestId('daily-back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('a pool that fails to load says so and tries again', async () => {
    const err = Object.assign(new Error('POST /api/study/spot-setup answered 500'), { status: 500 })
    let fail = true
    const ok = makeFetcher()
    const fetcher = vi.fn(async (url, opts) => { if (url === '/api/study/spot-setup' && fail) { fail = false; throw err } return ok(url, opts) })
    render(<DailyChartGame fetcher={fetcher} onClose={() => {}} />)
    expect(await screen.findByTestId('daily-failed')).toBeInTheDocument()
    expect(screen.getByTestId('daily-intro')).toHaveTextContent(FAILED_LINE)
    expect(screen.getByTestId('daily-start')).toBeDisabled()
    fireEvent.click(screen.getByTestId('daily-retry'))
    await waitFor(() => expect(screen.getByTestId('daily-start')).not.toBeDisabled())
    expect(screen.getByTestId('daily-start')).toHaveTextContent("Play today's charts")
  })

  it('a signed-out member is offered the sign-in, never a broken page', async () => {
    const err = Object.assign(new Error('401'), { status: 401 })
    render(<DailyChartGame fetcher={makeFetcher({ poolError: err })} onClose={() => {}} signedOut={<div data-testid="signed-out">sign in</div>} />)
    expect(await screen.findByTestId('signed-out')).toBeInTheDocument()
  })

  it('a browser that blocks the copy leaves the line selectable and says how', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 1, charts: [{ id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, ticker: 'JBI', date: '2025-03-12', xp: 10 }] }))
    render(<DailyChartGame fetcher={makeFetcher()} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('daily-again'))
    expect(await screen.findByText('This browser blocked the copy. Select the line above and copy it.')).toBeInTheDocument()
    expect(screen.getByTestId('daily-again')).toHaveTextContent('Copy your score')
  })

  it("at midnight in New York the result screen offers the new day's charts", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, day: TODAY, total: 1, charts: [{ id: 'k1', name: 'Kicker', said: 'Kicker', ok: true, ticker: 'JBI', date: '2025-03-12', xp: 10 }] }))
    const calls = []
    render(<DailyChartGame fetcher={makeFetcher({ calls })} onClose={() => {}} />)
    expect(screen.getByTestId('daily-countdown')).toBeInTheDocument()
    vi.setSystemTime(new Date('2026-11-10T05:00:01Z'))                        // 12:00:01 AM EST, Tuesday
    expect(await screen.findByTestId('daily-ready', {}, { timeout: 2500 })).toHaveTextContent("Today's charts are ready")
    fireEvent.click(screen.getByTestId('daily-new-day'))
    expect(await screen.findByTestId('daily-intro')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('daily-day')).toHaveTextContent('Tuesday, Nov 10'))
    expect(calls.filter((c) => c.url === '/api/study/spot-setup')).toHaveLength(1)
  })
})
