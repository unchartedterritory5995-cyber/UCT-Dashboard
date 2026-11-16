/**
 * Weekend Watchlist rails (docs/study/GAMES.md, kind `watchlist`). It registers from one export; the start arena carries
 * the stakes and the three steps; the pool is Hard mode's swept pool (every skill session asked with `hard: true`); the
 * board is the member's own chart eight times over, tickers hidden, the last candle pointed at, and the prompt honest
 * that there is no set number; a flag posts Hard mode's Yes for the chart's own setup and a pass its "Nothing fired",
 * one chart at a time, and no game run is ever posted (the XP is the attempts'); the verdict takes over the screen with a
 * chip per chart; a clean board plays the week out with what fired, the ticker, the date and the move; a miss opens on
 * the missed chart with the coach's lesson; the end screen counts the calls, logs every chart, shows the attempts' XP
 * and the level bar; an empty pool, a failed pool and a failed attempt each say so honestly, with a way on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
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
import Sheet from '../../../components/mobile/Sheet'
import WatchlistGame, { GAME } from './WatchlistGame'
import { NOTHING } from './hardMode'

const day = (i) => new Date(Date.UTC(2025, 0, 2) + i * 86400000).toISOString().slice(0, 10)
const bar = (i, c) => ({ t: day(i), o: c - 0.2, h: c + 0.3, l: c - 0.4, c, v: 1000 })
const BARS = Array.from({ length: 70 }, (_, i) => bar(i, 10 + i * 0.05))   // the last close is 13.45
const LAST = BARS.length - 1

// the board: three charts where a setup fired (key Yes), five where nothing did (key No), across five setups
const CHARTS = [
  { id: 'k1', skill: 'setup.family3.kicker', key: 'yes', sym: 'JBI' },
  { id: 'k2', skill: 'setup.family3.kicker', key: 'no', sym: 'AAPL' },
  { id: 'o1', skill: 'setup.family4.oops', key: 'yes', sym: 'NVDA' },
  { id: 'o2', skill: 'setup.family4.oops', key: 'no', sym: 'MSFT' },
  { id: 'b1', skill: 'setup.family3.bear_gap', key: 'yes', sym: 'ZM' },
  { id: 'b2', skill: 'setup.family3.bear_gap', key: 'no', sym: 'PANW' },
  { id: 'l1', skill: 'setup.family1.launchpad', key: 'no', sym: 'CRWD' },
  { id: 's1', skill: 'setup.family4.slingshot', key: 'no', sym: 'META' },
]
const BY_ID = Object.fromEntries(CHARTS.map((c) => [c.id, c]))
const FIRED = new Set(CHARTS.filter((c) => c.key === 'yes').map((c) => c.id))
const NAME = { 'setup.family3.kicker': 'Kicker', 'setup.family4.oops': 'Oops Reversal', 'setup.family3.bear_gap': 'Bear gap', 'setup.family1.launchpad': 'Launchpad', 'setup.family4.slingshot': 'Slingshot' }
// the plan api/services/study_trade.py sends with a fired Kicker's reveal
const KICKER_PLAN = { skill: 'setup.family3.kicker', direction: 'bullish', entry: 13.76, stop: 13.28, t1: 14.72, t2: 15.2, enters_intraday: false,
  entry_note: "over the red day's high", stop_note: "under the Kicker's low", trail: 'under each higher low' }
const lessonOf = (c) => (c.key === 'yes'
  ? `${NAME[c.skill]}: the day before closes red; then the next day gaps up and closes near its high. Here the stock gapped 2.4% over the red day and closed in the top tenth of its range.`
  : `${NAME[c.skill]}: the firm's detector does not fire on the last bar of this chart. the gap was 0.3%, under the 1% the rule asks for.`)
// the week after: closes 13.90, 14.30, 14.70 (the reveal's three), then 14.90 and 14.60 (the rest, through /step); every
// low stays over the Kicker plan's stop
const forward = (n, from = 13.9) => Array.from({ length: n }, (_, i) => bar(70 + i, from + i * 0.4))

/** The sandbox-shaped fetcher: each setup's hard session hands over its charts; an attempt is scored against the key the
 *  browser never saw, the reveal carrying the ticker, the date, the lesson, three forward bars of five, and the XP the
 *  server granted with the member's running total. */
function makeFetcher({ posts = [], sessions = [], failOn = new Set(), xpStart = 990 } = {}) {
  let xp = xpStart
  let seq = 100
  const byAttempt = {}
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/sessions') {
      sessions.push(opts.body)
      const items = CHARTS.filter((c) => c.skill === opts.body.skill_id).map((c) => ({
        id: c.id, type: 'spot', skill_id: c.skill, difficulty: 3,
        prompt_json: { q: `Does the firm's ${NAME[c.skill]} setup fire on the last bar of this chart?`, choices: ['Yes', 'No'] },
        bars: { symbol: c.id, tf: 'D', bars: BARS },
      }))
      return { session_id: 'sess-w', items }
    }
    if (url === '/api/study/attempts') {
      posts.push(opts.body)
      const c = BY_ID[opts.body.item_id]
      if (failOn.has(c.id)) { failOn.delete(c.id); const e = new Error('POST /api/study/attempts answered 500'); e.status = 500; throw e }
      const correct = (opts.body.answer.choice === 'Yes') === (c.key === 'yes')
      const gained = correct ? 10 : 0
      xp += gained
      const id = (seq += 1)
      byAttempt[id] = c
      return {
        attempt_id: id, correct,
        reveal: { answer: { answer: c.key }, sym: c.sym, asof: '2025-03-14', lesson: lessonOf(c), forward_bars: forward(3), forward_total: 5,
          setup_rule: { name: NAME[c.skill], text: 'the day before closes red; then the next day gaps up.' }, ...(c.id === 'k1' ? { trade: KICKER_PLAN } : {}) },
        progress: { xp_gained: gained, xp },
      }
    }
    const step = /^\/api\/study\/attempts\/(\d+)\/step$/.exec(url)
    if (step) { posts.push({ step: Number(step[1]), body: opts.body }); return { bars: [bar(73, 14.9), bar(74, 14.6)] } }
    if (/^\/api\/study\/attempts\/\d+\/intraday$/.test(url)) return { tf: 30, days: {} }
    throw new Error(`unexpected ${url}`)
  })
}

/** The cards, each with the chart it holds (the chart is mounted under the item id, never the ticker). */
const cards = () => CHARTS.map((_, i) => {
  const card = screen.getByTestId(`watch-card-${i}`)
  return { i, card, id: within(card).getByTestId('stock-chart').getAttribute('data-sym') }
})
async function deal(fetcher, props = {}) {
  render(<WatchlistGame fetcher={fetcher} onClose={() => {}} {...props} />)
  const go = await screen.findByTestId('watch-start')
  await waitFor(() => expect(go).not.toBeDisabled())
  fireEvent.click(go)
  return screen.findByTestId('watch-board')
}
const attempts = (posts) => posts.filter((p) => p.item_id)

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('WatchlistGame', () => {
  it('registers from one export as a chart challenge, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'watchlist', title: 'Weekend Watchlist', sub: expect.any(String), icon: 'bookmark', plate: 'Watchlist', accent: 'gold', group: 'chart' })
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
    const { container } = render(<UIcon name={GAME.icon} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it("opens on the arena, asks for Hard mode's swept pool, and says what the bank holds", async () => {
    const sessions = []
    render(<WatchlistGame fetcher={makeFetcher({ sessions })} onClose={() => {}} />)
    const intro = screen.getByTestId('watch-intro')
    expect(intro).toHaveTextContent('Weekend Watchlist')
    expect(intro).toHaveTextContent('tickers')
    expect(intro).toHaveTextContent('hearts')
    // while the bank loads, the button says so once (no second line repeating it)
    expect(intro.textContent.match(/Loading the bank/g)).toHaveLength(1)
    const howto = screen.getByTestId('watch-howto')
    expect(howto).toHaveTextContent('Scan the board')
    expect(howto).toHaveTextContent('Flag what fired')
    expect(howto).toHaveTextContent('one of our setups fired on its last candle')
    expect(howto).toHaveTextContent('See what came next')
    expect(await screen.findByTestId('watch-bank')).toHaveTextContent('8 charts from the UCT bank, a fresh board every run')
    expect(screen.getByTestId('watch-start')).toHaveTextContent('Deal the charts')
    expect(sessions).toHaveLength(7)
    expect(sessions.every((b) => b.kind === 'skill' && b.hard === true)).toBe(true)
    expect(intro.textContent).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('a clean scan: flags the three that fired, posts one chart at a time, plays the week out, ends Legendary on the XP the attempts earned', async () => {
    const posts = []
    const fetcher = makeFetcher({ posts })
    await deal(fetcher)
    // the board: eight of the member's own charts, tickers hidden, the last candle pointed at; the prompt honest about the count
    expect(screen.getByTestId('watch-detail')).toHaveTextContent('There is no set number: it could be none of them, or all 8.')
    const board = cards()
    expect(new Set(board.map((b) => b.id))).toEqual(new Set(CHARTS.map((c) => c.id)))
    for (const { card } of board) {
      expect(within(card).getByTestId('sym-label')).toHaveTextContent('••••')
      expect(within(card).getByTestId('stock-chart').getAttribute('data-callouts')).toBe(`${LAST}:Last candle`)
    }
    // flag the three that fired: two by tapping the flag, one by its number key
    const fired = board.filter((b) => FIRED.has(b.id))
    fireEvent.click(screen.getByTestId(`watch-flag-${fired[0].i}`))
    fireEvent.click(screen.getByTestId(`watch-flag-${fired[1].i}`))
    fireEvent.keyDown(window, { key: String(fired[2].i + 1) })
    expect(screen.getByTestId('watch-score')).toHaveTextContent('3')
    expect(screen.getByTestId(`watch-card-${fired[2].i}`).getAttribute('data-flagged')).toBe('1')
    expect(screen.getByTestId('watch-lock')).toHaveTextContent('3 flagged · 5 passed')
    // a flag toggles off and on again
    fireEvent.click(screen.getByTestId(`watch-flag-${fired[0].i}`))
    expect(screen.getByTestId('watch-score')).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId(`watch-flag-${fired[0].i}`))

    fireEvent.click(screen.getByTestId('watch-lock'))
    const take = await screen.findByTestId('watch-takeover')
    // every chart posted once, in board order, each with Hard mode's answer for it; never a game run
    const sent = attempts(posts)
    expect(sent.map((p) => p.item_id)).toEqual(board.map((b) => b.id))
    for (const p of sent) {
      const name = NAME[BY_ID[p.item_id].skill]
      expect(p.session_id).toBe('sess-w')
      expect(p.answer).toEqual(FIRED.has(p.item_id) ? { choice: 'Yes', picked_setup: name } : { choice: 'No', picked_setup: NOTHING })
    }
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)
    // the verdict takes the screen: clean, a chip per chart, the attempts' XP
    expect(take.getAttribute('data-correct')).toBe('1')
    expect(take).toHaveTextContent('Clean scan. You caught all 3.')
    expect(take).toHaveTextContent('Your list: 3 picks, 3 fired.')
    expect(take).toHaveTextContent('+80 XP')
    expect(within(take).getByTestId('watch-takeover-chips').querySelectorAll('[data-ok="1"]')).toHaveLength(8)
    expect(screen.getByTestId('watch-takeover-go')).toHaveTextContent('See what came next')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))

    // the board revealed: what fired, the ticker and the date, the move, the bank's own line, the call marked right
    const k1 = board.find((b) => b.id === 'k1')
    expect(screen.getByTestId(`watch-truth-${k1.i}`)).toHaveTextContent('Kicker fired')
    expect(screen.getByTestId(`watch-where-${k1.i}`)).toHaveTextContent('JBI · Mar 14, 2025')
    expect(within(k1.card).getByTestId('sym-label')).toHaveTextContent('JBI')
    expect(screen.getByTestId(`watch-note-${k1.i}`)).toHaveTextContent('Here the stock gapped 2.4% over the red day and closed in the top tenth of its range.')
    expect(k1.card.getAttribute('data-result')).toBe('right')
    const k2 = board.find((b) => b.id === 'k2')
    expect(screen.getByTestId(`watch-truth-${k2.i}`)).toHaveTextContent(NOTHING)
    expect(screen.getByTestId(`watch-note-${k2.i}`)).toHaveTextContent('Not a Kicker: the gap was 0.3%, under the 1% the rule asks for.')
    expect(screen.getByTestId(`watch-note-${k2.i}`).textContent).not.toMatch(/firm/i)
    expect(within(k2.card).getByTestId('stock-chart').getAttribute('data-callouts')).toBe(`${LAST}:${NOTHING}`)
    // the way into each chart names what is behind it: a trade where the setup fired, why where nothing did
    expect(screen.getByTestId(`watch-open-${k1.i}`)).toHaveTextContent('See the trade')
    expect(screen.getByTestId(`watch-open-${k2.i}`)).toHaveTextContent('See why')
    // the week plays out: the rest of each strip is fetched, and the forward bars run on to the end of the strip
    await waitFor(() => expect(posts.filter((p) => p.step)).toHaveLength(8))
    expect(posts.find((p) => p.step).body).toEqual({ offset: 3, n: 2 })
    await waitFor(() => expect(Number(within(k1.card).getByTestId('stock-chart').getAttribute('data-bars'))).toBe(BARS.length + 5), { timeout: 4000 })
    // the Kicker's plan reviewed against the five bars: the best high, 15.20 on the fourth session, against the 13.76 entry
    expect(screen.getByTestId(`watch-move-${k1.i}`)).toHaveTextContent('Best move: +10.5% from entry in 4 sessions')
    // nothing fired: the plain change from the 13.45 close to the 14.60 close five sessions on
    await waitFor(() => expect(screen.getByTestId(`watch-move-${k2.i}`)).toHaveTextContent('Next 5 sessions: +8.6%'))

    fireEvent.click(screen.getByTestId('watch-next'))
    const done = await screen.findByTestId('watch-done')
    expect(done).toHaveTextContent('Legendary')
    expect(screen.getByTestId('watch-right')).toHaveTextContent('8/8')
    await waitFor(() => expect(screen.getByTestId('watch-xp')).toHaveTextContent('+80'))
    expect(screen.getByTestId('watch-end-note')).toHaveTextContent('Picks right: 3 of 3. 3 fired on the board and you caught 3.')
    const log = screen.getByTestId('run-log')
    expect(log).toHaveTextContent('Kicker')
    expect(log).toHaveTextContent('JBI · Mar 14, 2025')
    expect(log).toHaveTextContent(NOTHING)
    // the level bar reads the server's totals: 990 before the run, 1070 after it (a level up at 1000)
    const level = screen.getByTestId('watch-level')
    expect(level).toHaveTextContent('+80 XP this run')
    expect(screen.getByTestId('watch-level-up')).toHaveTextContent('Level 3')
    expect(screen.getByTestId('watch-again')).toHaveTextContent('Another weekend')
  }, 15000)   // the week plays out on real timers: the wave, the run-on and the end screen's count-up

  it('under reduced motion the whole board plays the week out at once', async () => {
    const mm = vi.fn((q) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('matchMedia', mm)
    try {
      const posts = []
      await deal(makeFetcher({ posts }))
      for (const b of cards().filter((x) => FIRED.has(x.id))) fireEvent.click(screen.getByTestId(`watch-flag-${b.i}`))
      fireEvent.click(screen.getByTestId('watch-lock'))
      fireEvent.click(await screen.findByTestId('watch-takeover-go'))   // a clean board: the review is the board itself
      await waitFor(() => expect(posts.filter((p) => p.step)).toHaveLength(8))
      // no wave, no run-on: every chart carries its whole strip the moment the verdict is read
      await waitFor(() => {
        for (const { card } of cards()) expect(Number(within(card).getByTestId('stock-chart').getAttribute('data-bars'))).toBe(BARS.length + 5)
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a miss takes the screen with the misses named, then opens on the missed chart with the lesson', async () => {
    const posts = []
    await deal(makeFetcher({ posts }))
    const board = cards()
    const k1 = board.find((b) => b.id === 'k1')
    const k2 = board.find((b) => b.id === 'k2')
    // flag a chart where nothing fired (k2) and pass the Kicker that fired (k1); flag the other two that fired
    fireEvent.click(screen.getByTestId(`watch-flag-${k2.i}`))
    for (const b of board.filter((x) => FIRED.has(x.id) && x.id !== 'k1')) fireEvent.click(screen.getByTestId(`watch-flag-${b.i}`))
    fireEvent.click(screen.getByTestId('watch-lock'))
    const take = await screen.findByTestId('watch-takeover')
    expect(take.getAttribute('data-correct')).toBe('0')
    expect(take).toHaveTextContent('6 of 8 called right.')
    expect(take).toHaveTextContent('Your list: 3 picks, 2 fired.')
    expect(take).toHaveTextContent('3 of 8 fired on this board. You caught 2.')
    const misses = within(take).getAllByTestId('watch-takeover-miss').map((m) => m.textContent)
    const expected = [k1, k2].sort((a, b) => a.i - b.i).map((b) => (b.id === 'k1' ? `Chart ${b.i + 1}: a Kicker fired, you passed.` : `Chart ${b.i + 1}: nothing fired, you flagged it.`))
    expect(misses).toEqual(expected)
    expect(take).toHaveTextContent('+60 XP')
    expect(attempts(posts).find((p) => p.item_id === 'k1').answer).toEqual({ choice: 'No', picked_setup: NOTHING })
    expect(attempts(posts).find((p) => p.item_id === 'k2').answer).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    expect(screen.getByTestId('watch-takeover-go')).toHaveTextContent('See the misses')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))

    // the review opens on the first miss, with the working: what it was, the call, the chart, the key and the lesson
    const first = [k1, k2].sort((a, b) => a.i - b.i)[0]
    const focus = await screen.findByTestId('watch-focus')
    expect(focus.getAttribute('data-chart')).toBe(String(first.i))
    const showMiss = (b) => {
      const f = screen.getByTestId('watch-focus')
      const lesson = screen.getByTestId('watch-lesson')
      if (b.id === 'k1') {
        expect(f).toHaveTextContent('A Kicker fired.')
        expect(f).toHaveTextContent('You passed, but it fired.')
        expect(f).toHaveTextContent('JBI · Mar 14, 2025')
        expect(lesson).toHaveTextContent('Why it’s a Kicker')
        expect(screen.getByTestId('watch-key')).toBeInTheDocument()
        expect(within(f).getByTestId('stock-chart').getAttribute('data-lines')).toContain('hard-ENTRY')
      } else {
        expect(f).toHaveTextContent('Nothing fired.')
        expect(f).toHaveTextContent('You flagged it, but nothing fired.')
        expect(lesson).toHaveTextContent('Why nothing fired')
        expect(lesson).toHaveTextContent('Not a Kicker: the gap was 0.3%')
        expect(lesson.textContent).not.toMatch(/the firm/i)
      }
      expect(within(f).getByTestId('stock-chart').getAttribute('data-callouts')).toMatch(new RegExp(`^${LAST}:`))
    }
    showMiss(first)
    // the arrows walk the board; Escape goes back to it
    const second = [k1, k2].sort((a, b) => a.i - b.i)[1]
    for (let i = first.i; i < second.i; i++) fireEvent.click(screen.getByTestId('watch-focus-next'))
    expect(screen.getByTestId('watch-focus').getAttribute('data-chart')).toBe(String(second.i))
    showMiss(second)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('watch-focus')).toBeNull()
    expect(screen.getByTestId(`watch-card-${k2.i}`).getAttribute('data-result')).toBe('wrong')
    // and any chart opens from the board
    fireEvent.click(screen.getByTestId(`watch-open-${k2.i}`))
    expect(screen.getByTestId('watch-focus').getAttribute('data-chart')).toBe(String(k2.i))
    fireEvent.click(screen.getByTestId('watch-back-board'))

    fireEvent.click(screen.getByTestId('watch-next'))
    await screen.findByTestId('watch-done')
    expect(screen.getByTestId('watch-right')).toHaveTextContent('6/8')
    expect(screen.getByTestId('watch-end-note')).toHaveTextContent('Picks right: 2 of 3. 3 fired on the board and you caught 2.')
    expect(screen.getByTestId('run-log')).toHaveTextContent('you said nothing fired')
    expect(screen.getByTestId('run-log')).toHaveTextContent('you said a setup fired')
  })

  it('an empty pool says so honestly, offers no Start, and the way back works', async () => {
    const onClose = vi.fn()
    render(<WatchlistGame fetcher={vi.fn(async () => ({ session_id: 's', items: [] }))} onClose={onClose} />)
    const empty = await screen.findByTestId('watch-empty')
    expect(screen.getByTestId('watch-intro')).toHaveTextContent('No questions in this game yet. They arrive as the courses are approved.')
    expect(screen.getByTestId('watch-start')).toBeDisabled()
    expect(screen.getByTestId('watch-start')).toHaveTextContent('No charts yet')
    fireEvent.click(within(empty).getByTestId('watch-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a pool that fails to load says so, and Try again asks again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})   // the bank logs each skipped skill session
    let fail = true
    const ok = makeFetcher()
    const fetcher = vi.fn(async (url, opts) => {
      if (fail) { const e = new Error('POST /api/study/sessions answered 500'); e.status = 500; throw e }
      return ok(url, opts)
    })
    render(<WatchlistGame fetcher={fetcher} onClose={() => {}} />)
    await screen.findByTestId('watch-failed')
    expect(screen.getByTestId('watch-intro')).toHaveTextContent('The charts did not load. Check your connection and try again.')
    expect(screen.getByTestId('watch-start')).toBeDisabled()
    fail = false
    fireEvent.click(screen.getByTestId('watch-retry'))
    await waitFor(() => expect(screen.getByTestId('watch-start')).not.toBeDisabled())
    expect(screen.getByTestId('watch-bank')).toHaveTextContent('8 charts')
  })

  it('a chart whose attempt fails is left out of the score, never counted as a miss, and can be checked again', async () => {
    const posts = []
    await deal(makeFetcher({ posts, failOn: new Set(['o1']) }))
    const board = cards()
    for (const b of board.filter((x) => FIRED.has(x.id))) fireEvent.click(screen.getByTestId(`watch-flag-${b.i}`))
    fireEvent.click(screen.getByTestId('watch-lock'))
    const take = await screen.findByTestId('watch-takeover')
    expect(take).toHaveTextContent('Clean scan. You caught all 2.')
    expect(take).toHaveTextContent('1 chart could not be checked and is left out.')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))
    const o1 = board.find((b) => b.id === 'o1')
    expect(screen.getByTestId(`watch-unchecked-${o1.i}`)).toHaveTextContent('This chart could not be checked.')
    expect(screen.getByTestId('watch-score')).toHaveTextContent('7')
    // check the rest: only the chart that failed is posted again, and the board is whole
    const before = attempts(posts).length
    fireEvent.click(screen.getByTestId('watch-recheck'))
    const again = await screen.findByTestId('watch-takeover')
    expect(attempts(posts).slice(before).map((p) => p.item_id)).toEqual(['o1'])
    // its time is the board's share at the lock, never the time spent reading the verdict
    expect(attempts(posts).slice(before)[0].time_ms).toBe(attempts(posts)[0].time_ms)
    expect(again).toHaveTextContent('Clean scan. You caught all 3.')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))
    expect(screen.queryByTestId('watch-recheck')).toBeNull()
    expect(screen.getByTestId(`watch-truth-${o1.i}`)).toHaveTextContent('Oops Reversal fired')
  })

  it('inside the challenge Sheet, Escape goes back to the board first and only then closes the sheet', async () => {
    // the Sheet closes itself on Escape from a document capture listener that stops the event; the review must be heard
    // before it, or Escape throws the whole board away
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} variant="fullscreen" ariaLabel="Weekend Watchlist">
        <WatchlistGame fetcher={makeFetcher()} onClose={onClose} />
      </Sheet>,
    )
    const go = await screen.findByTestId('watch-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    await screen.findByTestId('watch-board')
    fireEvent.click(screen.getByTestId('watch-lock'))   // nothing flagged: the three that fired are misses
    fireEvent.click(await screen.findByTestId('watch-takeover-go'))
    await screen.findByTestId('watch-focus')
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(screen.queryByTestId('watch-focus')).toBeNull()
    expect(screen.getByTestId('watch-grid')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // on the board, Escape is the sheet's own again
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the review walks only the charts that were checked', async () => {
    await deal(makeFetcher({ failOn: new Set(['l1']) }))
    const board = cards()
    fireEvent.click(screen.getByTestId('watch-lock'))
    fireEvent.click(await screen.findByTestId('watch-takeover-go'))
    await screen.findByTestId('watch-focus')
    fireEvent.keyDown(window, { key: 'Escape' })
    const failed = board.find((b) => b.id === 'l1').i
    const scored = board.map((b) => b.i).filter((i) => i !== failed)
    fireEvent.click(screen.getByTestId(`watch-open-${scored[0]}`))
    const seen = [Number(screen.getByTestId('watch-focus').getAttribute('data-chart'))]
    for (let k = 1; k < scored.length + 1; k++) {
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      seen.push(Number(screen.getByTestId('watch-focus').getAttribute('data-chart')))
    }
    // every checked chart once, in board order, never the one that failed; the last press stays on the last chart
    expect(seen).toEqual([...scored, scored[scored.length - 1]])
    for (let k = 0; k < scored.length - 1; k++) fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(Number(screen.getByTestId('watch-focus').getAttribute('data-chart'))).toBe(scored[0])
    // an arrow with a modifier is the browser's (Alt+Left is "back"), never ours
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true })
    expect(Number(screen.getByTestId('watch-focus').getAttribute('data-chart'))).toBe(scored[0])
  })

  it('when no chart could be checked it says so and offers the list again, never a "0 of 0" end screen', async () => {
    const posts = []
    await deal(makeFetcher({ posts, failOn: new Set(CHARTS.map((c) => c.id)) }))
    for (const b of cards().filter((x) => FIRED.has(x.id))) fireEvent.click(screen.getByTestId(`watch-flag-${b.i}`))
    fireEvent.click(screen.getByTestId('watch-lock'))
    const take = await screen.findByTestId('watch-takeover')
    expect(take.getAttribute('data-correct')).toBe('0')
    expect(take).toHaveTextContent('Your list could not be checked.')
    expect(take).toHaveTextContent('None of the 8 charts could be checked.')
    expect(take).not.toHaveTextContent('XP')
    expect(screen.getByTestId('watch-takeover-go')).toHaveTextContent('Back to the board')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))
    expect(screen.queryByTestId('watch-focus')).toBeNull()
    expect(screen.queryByTestId('watch-next')).toBeNull()
    const again = screen.getByTestId('watch-recheck')
    expect(again).toHaveTextContent('Check the list again')
    // the same flags, posted again (Enter presses it), and the board is whole
    const before = attempts(posts).length
    fireEvent.keyDown(window, { key: 'Enter' })
    const take2 = await screen.findByTestId('watch-takeover')
    expect(attempts(posts).slice(before).map((p) => p.item_id).sort()).toEqual(CHARTS.map((c) => c.id).sort())
    expect(take2).toHaveTextContent('Clean scan. You caught all 3.')
    fireEvent.click(screen.getByTestId('watch-takeover-go'))
    expect(screen.queryByTestId('watch-recheck')).toBeNull()
    fireEvent.click(screen.getByTestId('watch-next'))
    expect(await screen.findByTestId('watch-done')).toHaveTextContent('Legendary')
    expect(screen.getByTestId('watch-right')).toHaveTextContent('8/8')
  })

  it('locks with nothing flagged: every chart posted as "Nothing fired"', async () => {
    const posts = []
    await deal(makeFetcher({ posts }))
    expect(screen.getByTestId('watch-lock')).toHaveTextContent('0 flagged · 8 passed')
    fireEvent.keyDown(window, { key: 'Enter' })
    const take = await screen.findByTestId('watch-takeover')
    expect(attempts(posts).every((p) => p.answer.choice === 'No' && p.answer.picked_setup === NOTHING)).toBe(true)
    expect(take).toHaveTextContent('5 of 8 called right.')
    expect(take).toHaveTextContent('Your list: empty. You passed on every chart.')
  })
})
