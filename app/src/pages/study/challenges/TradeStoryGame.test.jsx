/**
 * Trade Story rails (docs/study/GAMES.md, kind `story`). It registers from one export as a chart challenge; the start
 * arena carries the stakes and the three steps and asks the server for the Spot the Setup pool with `need_plan`; the entry
 * question posts Hard mode's answer (the chart's own setup is the bank's Yes, another name is posted as itself) and its
 * verdict takes over the screen with the plan; the replay stops ONLY where the plan defines a call (2R, 3R, the trail,
 * the stop) and holds there; a call on the plan says why, a miss takes over the screen and then shows the working; the
 * chart carries the plan's lines, the trail's line once it trails, and the marks of what has already happened; each
 * trade ends with every call and its R and the exits beside the plan's; the end screen counts the calls, logs each one,
 * reports them once through POST /api/study/game-runs (kind 'story') and fills the level bar from before the first
 * answer to the grant; an empty pool, a failed pool, a refused answer and a refused report each say so honestly.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart" data-bars={(props.barsOverride || []).length} data-sym={props.sym}
      data-callouts={(props.callouts || []).map((c) => `${c.index}:${c.text}`).join('|')}
      data-lines={(props.annotations || []).map((a) => a.id).join('|')}
      data-marks={(props.markers || []).map((m) => m.text).join('|')} />
  ),
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: null }) }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const StockChart = (await import('../../../components/StockChart')).default
  return { default: (props) => <div data-testid="chart-pane">{props.identityLabel}<StockChart sym={props.sym} {...(props.stockChartProps || {})} /></div> }
})
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { chart_settings: {} } }) }))

import TradeStoryGame, { GAME } from './TradeStoryGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { EMPTY_LINE, FAILED_LINE, HVC_NOTE, PGH_NOTE, TRAIL_RULE } from './games/tradeStory'

const day = (i) => new Date(Date.UTC(2025, 0, 2) + i * 86400000).toISOString().slice(0, 10)
const mk = (i, o, h, l, c) => ({ t: day(i), o, h, l, c, v: 1000 })
// 30 sessions on the chart; the last is the setup's candle (closed at 10.00, low 9.60)
const VIS = [...Array.from({ length: 29 }, (_, i) => mk(i, 9.4, 9.6, 9.3, 9.5)), mk(29, 9.7, 10.05, 9.6, 10)]
const N = VIS.length
const LAST = N - 1
// a Launchpad's plan (api/services/study_trade.py): entry 10.00, stop 9.50, 2R 11.00, 3R 11.50, trailing under the higher lows
const LP_PLAN = { skill: 'setup.family1.launchpad', direction: 'bullish', entry: 10, stop: 9.5, t1: 11, t2: 11.5, enters_intraday: false,
  entry_note: 'the close out of the tight cluster of averages', stop_note: 'under the 21-day and 50-day averages',
  trail: 'under the rising 21-day average, or under each higher low', source: 'uct_launch_pad.py' }
// what followed: a higher low on day 3, 2R on day 4, 3R on day 6, a higher low on day 8 (11.20), under it on day 11
const LP_FWD = [
  mk(30, 10.0, 10.3, 9.8, 10.2), mk(31, 10.2, 10.6, 10.1, 10.5), mk(32, 10.5, 10.7, 10.0, 10.3), mk(33, 10.3, 11.1, 10.25, 11.0),
  mk(34, 11.0, 11.3, 10.8, 11.2), mk(35, 11.2, 11.6, 11.1, 11.5), mk(36, 11.5, 11.8, 11.3, 11.4), mk(37, 11.4, 11.5, 11.2, 11.3),
  mk(38, 11.3, 11.9, 11.25, 11.8), mk(39, 11.8, 12.0, 11.6, 11.7), mk(40, 11.7, 11.75, 11.1, 11.2), mk(41, 11.2, 11.4, 10.9, 11.0),
]
// a High Volume Edge: no trail named; the stop trades on day 2
const HV_PLAN = { ...LP_PLAN, skill: 'setup.family3.hve', trail: null, entry_note: 'the high-volume close', stop_note: "the edge bar's low", source: 'uct_hve.py' }
const HV_FWD = [mk(30, 10, 10.2, 9.7, 9.9), mk(31, 9.8, 9.85, 9.4, 9.45)]
// the Gap Support chart: 70 quiet days at 10.00 on 1,000 shares, the gap day (3,000 shares), the run, the pullback, the test
const mkv = (i, o, h, l, c, v) => ({ t: day(i), o, h, l, c, v })
const GS_VIS = [...Array.from({ length: 70 }, (_, i) => mkv(i, 9.95, 10.05, 9.9, 10.0, 1000)),
  mkv(70, 10.6, 10.9, 10.55, 10.85, 3000), mkv(71, 10.85, 11.4, 10.8, 11.3, 1500), mkv(72, 11.3, 11.6, 11.2, 11.5, 1500),
  mkv(73, 11.5, 11.55, 11.0, 11.05, 1200), mkv(74, 11.05, 11.1, 10.6, 10.65, 1200), mkv(75, 10.6, 10.7, 10.1, 10.6, 1400)]

const CHARTS = {
  lp1: { skill: 'setup.family1.launchpad', sym: 'NVDA', plan: LP_PLAN, fwd: LP_FWD, first: 3, lesson: 'Launchpad: the averages pinch together, then price closes out of the cluster. Here the close cleared all three.' },
  hv1: { skill: 'setup.family3.hve', sym: 'AMD', plan: HV_PLAN, fwd: HV_FWD, first: 2, lesson: 'High Volume Edge: the heaviest volume in a year, on a close at the top of the range.' },
  // the same stop on day 2, with more bars after it that are slow to come back
  hv2: { skill: 'setup.family3.hve', sym: 'AMD', plan: HV_PLAN, first: 2, lesson: 'High Volume Edge.',
    fwd: [...HV_FWD, mk(32, 9.4, 9.6, 9.2, 9.5), mk(33, 9.5, 9.7, 9.3, 9.6), mk(34, 9.6, 9.8, 9.4, 9.7)] },
  // a scored chart whose reveal came back with no plan
  np1: { skill: 'setup.family4.slingshot', sym: 'TSLA', plan: null, fwd: LP_FWD, first: 3, lesson: 'Slingshot: back over the 4-day average of the highs.' },
  // a Gap Support: its trail is a judgment the bars cannot place, so what is left stays on the plan's stop
  gs1: { skill: 'setup.family3.gap_support', sym: 'META', first: 3, lesson: 'Gap Support: the gap holds and the stock closes over it.', fwd: LP_FWD,
    plan: { ...LP_PLAN, skill: 'setup.family3.gap_support', trail: 'if it drifts sideways at the gap, a tighter stop just under the gap top', entry_note: 'the close, as the gap holds', stop_note: 'the gap top or the day\'s low, whichever is lower' } },
  // a Gap Support the real detector fires on (games/tradeStory.test.js, checked against uct_gap_support.py): the gap on
  // day 70, the run's high 11.60 on day 72, the test and entry on day 75; then the post-gap high on day 2, 2R on day 3, 3R
  // on day 4, the stop on day 6
  gs2: { skill: 'setup.family3.gap_support', sym: 'META', first: 3, lesson: 'Gap Support: the gap holds and the stock closes over it.', vis: GS_VIS,
    plan: { skill: 'setup.family3.gap_support', direction: 'bullish', entry: 10.6, stop: 10.05, t1: 11.7, t2: 12.25, enters_intraday: false,
      entry_note: 'the close, as the gap holds', stop_note: 'the gap top or the day\'s low, whichever is lower', trim_note: PGH_NOTE,
      trail: 'if it drifts sideways at the gap, a tighter stop just under the gap top', source: 'uct_gap_support.py' },
    fwd: [mk(76, 10.6, 10.9, 10.4, 10.8), mk(77, 10.8, 11.65, 10.75, 11.5), mk(78, 11.5, 11.8, 11.3, 11.75), mk(79, 11.75, 12.3, 11.6, 12.2),
      mk(80, 12.2, 12.4, 11.9, 12.0), mk(81, 12.0, 12.1, 9.9, 10.0)] },
  // a High Volume Edge: day 2 closes over the 10.00 high-volume close, day 4 comes back to it, day 5 hits the stop
  hv3: { skill: 'setup.family3.hve', sym: 'AMD', plan: { ...HV_PLAN, trim_note: HVC_NOTE }, first: 3, lesson: 'High Volume Edge.',
    fwd: [mk(30, 10.0, 10.3, 9.9, 9.95), mk(31, 9.95, 10.4, 9.8, 10.3), mk(32, 10.3, 10.6, 10.2, 10.5), mk(33, 10.5, 10.55, 9.98, 10.1), mk(34, 10.1, 10.2, 9.45, 9.5)] },
  // the same, never back to the stop: the only call is the member's own
  hv4: { skill: 'setup.family3.hve', sym: 'AMD', plan: { ...HV_PLAN, trim_note: HVC_NOTE }, first: 2, lesson: 'High Volume Edge.',
    fwd: [mk(30, 10.0, 10.3, 9.9, 10.2), mk(31, 10.2, 10.4, 9.98, 10.3), mk(32, 10.3, 10.6, 10.2, 10.5)] },
}

function makeFetcher({ posts = [], pools = [], ids = ['lp1', 'hv1'], xpStart = 990, failAttempt = new Set(), failRun = null, poolError = null, stepHangs = false } = {}) {
  let xp = xpStart
  let seq = 40
  const byAttempt = {}
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/spot-setup') {
      pools.push(opts.body)
      if (poolError) { const e = poolError(); if (e) throw e }
      return { session_id: 'sess-story', items: ids.map((id) => ({ id, type: 'spot', skill_id: CHARTS[id].skill, prompt_json: { q: 'Does the setup fire on the last bar?', choices: ['Yes', 'No'] },
        bars: { symbol: id, tf: 'D', bars: CHARTS[id].vis || VIS }, look: { real: (CHARTS[id].vis || VIS).length - 1, lookalikes: [] } })) }
    }
    if (url === '/api/study/attempts') {
      posts.push({ url, body: opts.body })
      const c = CHARTS[opts.body.item_id]
      if (failAttempt.has(opts.body.item_id)) { const e = new Error('POST /api/study/attempts answered 500'); e.status = 500; throw e }
      const correct = opts.body.answer.choice === 'Yes'
      const gained = correct ? 10 : 0
      xp += gained
      const id = (seq += 1)
      byAttempt[id] = c
      return { attempt_id: id, correct, reveal: { answer: { answer: 'yes' }, sym: c.sym, asof: '2025-01-31', lesson: c.lesson, trade: c.plan,
        forward_bars: c.fwd.slice(0, c.first), forward_total: c.fwd.length, setup_rule: null }, progress: { xp_gained: gained, xp } }
    }
    const step = /^\/api\/study\/attempts\/(\d+)\/step$/.exec(url)
    if (step) {
      posts.push({ url, body: opts.body })
      if (stepHangs) return new Promise(() => {})
      const c = byAttempt[Number(step[1])]
      return { bars: c.fwd.slice(opts.body.offset, opts.body.offset + opts.body.n) }
    }
    if (/^\/api\/study\/attempts\/\d+\/intraday$/.test(url)) return { tf: 30, days: {} }
    if (url === '/api/study/game-runs') {
      posts.push({ url, body: opts.body })
      if (failRun) throw failRun()
      const gained = Math.min(30, opts.body.right * 2)
      xp += gained
      return { xp_gained: gained, duplicate: false, capped: false, progress: { xp_gained: gained, xp, level: 1 + Math.floor(xp / 500) }, badges_new: [] }
    }
    throw new Error(`unexpected ${url}`)
  })
}

const reduce = () => vi.stubGlobal('matchMedia', vi.fn((q) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })))
const chart = () => screen.getByTestId('stock-chart')
const bars = () => Number(chart().getAttribute('data-bars'))
const tile = (name) => within(screen.getByTestId('story-cards')).getAllByRole('button').find((b) => b.textContent.includes(name))
const wrongTile = (name) => within(screen.getByTestId('story-cards')).getAllByRole('button').find((b) => !b.textContent.includes(name))
const q = () => screen.getByTestId('story-stop-q').textContent
async function begin(fetcher, props = {}) {
  const view = render(<TradeStoryGame fetcher={fetcher} onClose={() => {}} {...props} />)
  const go = screen.getByTestId('story-start')
  await waitFor(() => expect(go).not.toBeDisabled())
  fireEvent.click(go)
  return view
}

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('TradeStoryGame', () => {
  it('registers from one export as a chart challenge, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'story', title: 'Trade Story', sub: expect.any(String), icon: 'compass', plate: 'Story', accent: 'green', group: 'chart' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b|\bthird\b|\bhalf\b/i)
  })

  it('opens on the arena with the stakes and three steps, and asks for real setups that come with a plan', async () => {
    const pools = []
    render(<TradeStoryGame fetcher={makeFetcher({ pools })} onClose={() => {}} />)
    const intro = screen.getByTestId('story-intro')
    expect(intro).toHaveTextContent('Trade Story')
    expect(intro).toHaveTextContent('real trades')
    expect(intro).toHaveTextContent('ticker')
    expect(intro).toHaveTextContent('2R · 3R')
    expect(intro).toHaveTextContent('Every call on the plan lights the Legendary medal')
    expect(intro.textContent.match(/Loading the bank/g)).toHaveLength(1)
    const how = screen.getByTestId('story-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Name the setup', 'Take the trade', 'Make the calls']) expect(how).toHaveTextContent(t)
    expect(await screen.findByTestId('story-bank')).toHaveTextContent('2 real trades from the UCT bank, a fresh deal every run')
    expect(screen.getByTestId('story-start')).toHaveTextContent('Take the first trade')
    expect(pools).toEqual([{ rounds: 4, need_plan: true, seed: expect.stringMatching(/^story-\d+$/) }])
    expect(intro.textContent).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('plays a run: names the setup, stops at 2R, 3R and the trail, teaches on a miss, reads the trade back, and reports the calls once', async () => {
    reduce()
    const posts = []
    const onClose = vi.fn()
    const fetcher = makeFetcher({ posts })
    await begin(fetcher, { onClose })

    // trade 1: the chart, ticker hidden, the last candle pointed at; four setup names
    expect(screen.getByTestId('sym-label')).toHaveTextContent('••••')
    expect(chart().getAttribute('data-callouts')).toBe(`${LAST}:What fired here?`)
    expect(screen.getByTestId('story-step')).toHaveTextContent('trade 1 of 2')
    const names = within(screen.getByTestId('story-cards')).getAllByRole('button')
    expect(names).toHaveLength(4)
    expect(names.some((b) => b.textContent.includes('Launchpad'))).toBe(true)
    expect(names.some((b) => b.textContent.includes('Bear gap'))).toBe(false)
    fireEvent.click(tile('Launchpad'))
    fireEvent.click(screen.getByTestId('story-check'))

    // the entry's verdict takes the screen: named, the ticker and the plan, the XP the answer earned
    const entry = await screen.findByTestId('story-entry')
    expect(entry.getAttribute('data-correct')).toBe('1')
    expect(entry).toHaveTextContent('Named it.')
    expect(screen.getByTestId('story-entry-sub')).toHaveTextContent('NVDA · Bought at 10.00 · stop 9.50 · 5.0% risk')
    expect(entry).toHaveTextContent('+10 XP')
    expect(posts[0].body).toEqual({ item_id: 'lp1', answer: { choice: 'Yes', picked_setup: 'Launchpad' }, time_ms: expect.any(Number), session_id: 'sess-story' })
    expect(screen.getByTestId('story-entry-go')).toHaveTextContent('Take the trade')
    fireEvent.click(screen.getByTestId('story-entry-go'))

    // the replay holds at 2R (day 4): nothing past it is drawn or marked
    await waitFor(() => expect(q()).toBe('2R just traded, at 11.00. What do you do?'))
    expect(posts.filter((p) => /step$/.test(p.url)).map((p) => p.body)).toEqual([{ offset: 3, n: 9 }])
    expect(bars()).toBe(N + 4)
    expect(screen.getByTestId('story-stop-where')).toHaveTextContent('You hold the full position.')
    expect(chart().getAttribute('data-lines').split('|')).toEqual(['hard-ENTRY', 'hard-STOP', 'hard-2R', 'hard-3R'])
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|2R')
    expect(within(chart().closest('[data-testid="chart-pane"]')).getByTestId('sym-label')).toHaveTextContent('NVDA')
    expect(screen.getByTestId('story-position-word')).toHaveTextContent('Full')
    expect(screen.getByTestId('story-r')).toHaveTextContent('+2.0R')
    expect(screen.getByTestId('story-stop-level')).toHaveTextContent('9.50')
    const key = screen.getByTestId('story-plan')
    expect(key).toHaveTextContent('reached on day 4')
    expect(key).not.toHaveTextContent('reached on day 6')
    expect(key).toHaveTextContent('5.0% risk from the entry')

    // a call on the plan, by its number key: green, and why
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByTestId('story-stop').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('story-why')).toHaveTextContent('That is the plan. 2R is the first target: take some off.')
    expect(screen.queryByTestId('story-miss')).toBeNull()
    expect(screen.queryByTestId('story-working')).toBeNull()
    fireEvent.keyDown(window, { key: '3' })                                            // a second key scores nothing
    expect(screen.getByTestId('story-call-trim').getAttribute('data-state')).toBe('right')
    expect(screen.getByTestId('story-go')).toHaveTextContent('Keep playing')
    fireEvent.click(screen.getByTestId('story-go'))

    // 3R (day 6): a miss takes the screen with the plan's call, then the working on the plan's prices
    await waitFor(() => expect(q()).toBe('3R just traded, at 11.50. What do you do?'))
    expect(bars()).toBe(N + 6)
    expect(screen.getByTestId('story-stop-where')).toHaveTextContent('You took some off at 2R. The rest is still on.')
    expect(screen.getByTestId('story-position-word')).toHaveTextContent('Some off')
    // from 3R the stop on what is left trails under the last higher low (day 3, 10.00)
    expect(screen.getByTestId('story-plan')).toHaveTextContent('under day 3')
    expect(screen.getByTestId('story-stop-level')).toHaveTextContent('10.00')
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|2R|3R')
    fireEvent.click(screen.getByTestId('story-call-hold'))
    const miss = screen.getByTestId('story-miss')
    expect(miss.getAttribute('data-correct')).toBe('0')
    expect(miss).toHaveTextContent('Not the plan.')
    expect(miss).toHaveTextContent('Take some off')
    expect(screen.getByTestId('story-miss-why')).toHaveTextContent('At 3R the plan takes some off again: 3R is the second target. What is left now trails under each higher low.')
    expect(screen.getByTestId('story-miss-go')).toHaveTextContent('See the working')
    fireEvent.keyDown(window, { key: 'Enter' })                                        // opens the working, once
    expect(screen.queryByTestId('story-miss')).toBeNull()
    expect(screen.getByTestId('story-stop')).toBeInTheDocument()
    expect(screen.getByTestId('story-step-risk')).toHaveTextContent('Risk a share: 10.00 − 9.50 = 0.50.')
    expect(screen.getByTestId('story-step-level')).toHaveTextContent('3R: 10.00 + 3 × 0.50 = 11.50.')
    expect(screen.getByTestId('story-step-next')).toHaveTextContent(TRAIL_RULE)
    expect(screen.getByTestId('story-working')).toHaveTextContent('Our trade plans · course unit F10.05, Scaling in and out')
    expect(screen.getByTestId('story-why')).toHaveTextContent('Not the plan.')
    expect(screen.getByTestId('story-call-hold').getAttribute('data-state')).toBe('wrong')
    expect(screen.getByTestId('story-call-trim').getAttribute('data-state')).toBe('right')
    expect(bars()).toBe(N + 6)                                                          // still held while the working is read
    fireEvent.keyDown(window, { key: 'Enter' })                                        // Keep playing

    // the trail breaks (day 11): the trail's line and level are on the chart and in the position line
    await waitFor(() => expect(q()).toBe('Price just traded under 11.20, the higher low of day 8. What do you do?'))
    expect(bars()).toBe(N + 11)
    expect(chart().getAttribute('data-lines')).toContain('story-TRAIL')
    expect(screen.getByTestId('story-position')).toHaveTextContent('Trail')
    expect(screen.getByTestId('story-stop-level')).toHaveTextContent('11.20')
    expect(screen.getByTestId('story-plan')).toHaveTextContent('hit on day 11')
    fireEvent.click(screen.getByTestId('story-call-all'))
    expect(screen.getByTestId('story-why')).toHaveTextContent('That is the plan. The trail is the stop on what is left.')
    expect(screen.getByTestId('story-go')).toHaveTextContent('See the trade')
    fireEvent.click(screen.getByTestId('story-go'))

    // the trade read back: every call, its R, the exits beside the plan's, no fraction invented
    const res = await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-result-title')).toHaveTextContent('2 of 3 calls on the plan.')
    const rows = within(screen.getByTestId('story-result-calls')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['1', '0', '1'])
    expect(rows[0]).toHaveTextContent('2R · Take some off')
    expect(rows[0]).toHaveTextContent('+2.0R')
    expect(rows[1]).toHaveTextContent('you said hold')
    expect(rows[2]).toHaveTextContent('Trail · Sell the rest')
    expect(rows[2]).toHaveTextContent('+2.4R')
    expect(screen.getByTestId('story-mine')).toHaveTextContent('Some off at 2R. The rest out at +2.4R on the trail.')
    expect(screen.getByTestId('story-plan-exits')).toHaveTextContent('Some off at 2R and 3R. The rest out at +2.4R on the trail.')
    expect(res).toHaveTextContent('The plan names each level, not how much to sell there')
    expect(res.textContent).not.toMatch(/[—–]|\bfirm\b|\bthird\b|\bhalf\b|NaN|undefined/i)
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|2R|3R|TRAIL HIT')
    expect(screen.getByTestId('story-lesson')).toBeInTheDocument()
    expect(screen.getByTestId('story-next')).toHaveTextContent('Next trade')
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)   // nothing reported mid-run
    fireEvent.click(screen.getByTestId('story-next'))

    // trade 2: a wrong name; the verdict names the setup, and its lesson stays up through the trade
    await waitFor(() => expect(screen.getByTestId('story-step')).toHaveTextContent('trade 2 of 2'))
    const wrong = wrongTile('High Volume Edge')
    const said = ['Kicker', 'Launchpad', 'Slingshot', 'Oops Reversal', 'Gap Support'].find((x) => wrong.textContent.includes(x))
    fireEvent.click(wrong)
    fireEvent.click(screen.getByTestId('story-check'))
    const entry2 = await screen.findByTestId('story-entry')
    expect(entry2.getAttribute('data-correct')).toBe('0')
    expect(entry2).toHaveTextContent('It was a High Volume Edge.')
    expect(entry2).toHaveTextContent('The answerHigh Volume Edge')
    expect(screen.getByTestId('story-entry-sub')).toHaveTextContent(`AMD · Bought at 10.00 · stop 9.50 · 5.0% risk · you said ${said}`)
    expect(entry2).not.toHaveTextContent('XP')
    expect(posts.filter((p) => p.url === '/api/study/attempts')[1].body.answer).toEqual({ choice: said, picked_setup: said })
    fireEvent.click(screen.getByTestId('story-entry-go'))
    expect(screen.getByTestId('story-lesson')).toBeInTheDocument()
    await waitFor(() => expect(q()).toBe('Price just traded down through your stop, 9.50. What do you do?'))
    expect(screen.queryByTestId('story-plan').textContent).not.toContain('Trail')     // this plan names no trail
    fireEvent.click(screen.getByTestId('story-call-all'))
    expect(screen.getByTestId('story-why')).toHaveTextContent('The stop is an appointment, not a debate. Out at −1.0R.')
    fireEvent.click(screen.getByTestId('story-go'))
    await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-result-title')).toHaveTextContent('On the plan.')
    expect(screen.getByTestId('story-mine')).toHaveTextContent('Out at −1.0R on the stop.')
    expect(screen.getByTestId('story-next')).toHaveTextContent('See the run')
    fireEvent.click(screen.getByTestId('story-next'))

    // the end: the calls counted and logged, each trade in a line, the calls reported once, the level bar
    const done = await screen.findByTestId('story-done')
    expect(done).toHaveTextContent('Disciplined')
    expect(screen.getByTestId('story-right')).toHaveTextContent('3/4')
    const log = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(log).toHaveLength(4)
    expect(log[1]).toHaveTextContent('3R · Take some off')
    expect(log[1]).toHaveTextContent('NVDA · Launchpad')
    expect(log[1]).toHaveTextContent('you said hold')
    expect(log[3]).toHaveTextContent('Stop · Sell the rest')
    expect(screen.getByTestId('story-named')).toHaveTextContent('You named 1 of 2 setups before the trade.')
    expect(screen.getAllByTestId('story-end-trade').map((x) => x.textContent)).toEqual([
      'NVDA · Launchpad: some off at 2R. The rest out at +2.4R on the trail.', 'AMD · High Volume Edge: out at −1.0R on the stop.'])
    await waitFor(() => expect(screen.getByTestId('story-level')).toHaveTextContent('+16 XP this run'))
    expect(screen.getByTestId('story-level-up')).toHaveTextContent('Level 3')
    await waitFor(() => expect(screen.getByTestId('story-xp')).toHaveTextContent('+16'))
    const runs = posts.filter((p) => p.url === '/api/study/game-runs')
    expect(runs).toEqual([{ url: '/api/study/game-runs', body: { kind: 'story', run_id: expect.stringMatching(/^story-[0-9a-z]+-1$/), right: 3, total: 4 } }])
    expect(screen.queryByTestId('story-not-saved')).toBeNull()
    expect(done.textContent).not.toMatch(/[—–]|\bfirm\b|NaN|undefined/i)

    // Back to Study closes; New trades deals afresh and reports nothing more
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('story-again'))
    expect(await screen.findByTestId('story-intro')).toBeInTheDocument()
    await waitFor(() => expect(fetcher.mock.calls.filter(([u]) => u === '/api/study/spot-setup')).toHaveLength(2))
    expect(posts.filter((p) => p.url === '/api/study/game-runs')).toHaveLength(1)
  }, 15000)

  it('on real timers the replay runs on and holds at the first stop, drawing nothing past it', async () => {
    const posts = []
    await begin(makeFetcher({ posts, ids: ['lp1'] }))
    fireEvent.click(tile('Launchpad'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(screen.getByTestId('story-stop-q')).toHaveTextContent('2R just traded'), { timeout: 4000 })
    expect(bars()).toBe(N + 4)
    await act(async () => { await new Promise((r) => setTimeout(r, 900)) })
    expect(bars()).toBe(N + 4)
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|2R')
  }, 10000)

  it('says the calls did not save when the report fails, and keeps the level bar the answers earned', async () => {
    reduce()
    const posts = []
    await begin(makeFetcher({ posts, ids: ['hv1'], failRun: () => { const e = new Error('500'); e.status = 500; return e } }))
    fireEvent.click(tile('High Volume Edge'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(screen.getByTestId('story-stop-q')).toHaveTextContent('through your stop'))
    fireEvent.click(screen.getByTestId('story-call-hold'))
    fireEvent.click(screen.getByTestId('story-miss-go'))
    expect(screen.getByTestId('story-step-r')).toHaveTextContent('Out at 9.50: (9.50 − 10.00) ÷ 0.50 = −1.0R.')
    fireEvent.click(screen.getByTestId('story-go'))
    await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-mine')).toHaveTextContent('All of it still held when the plan was out.')
    fireEvent.click(screen.getByTestId('story-next'))
    await screen.findByTestId('story-done')
    expect(await screen.findByTestId('story-not-saved')).toHaveTextContent('The XP for your calls did not save.')
    expect(screen.getByTestId('story-level')).toHaveTextContent('+10 XP this run')
    expect(screen.getByTestId('story-right')).toHaveTextContent('0/1')
    expect(posts.filter((p) => p.url === '/api/study/game-runs')).toHaveLength(1)
  })

  it('a trade the stop ended reads back at once, never waiting on the rest of the strip', async () => {
    reduce()
    const posts = []
    await begin(makeFetcher({ posts, ids: ['hv2'], stepHangs: true }))
    fireEvent.click(tile('High Volume Edge'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(q()).toBe('Price just traded down through your stop, 9.50. What do you do?'))
    expect(posts.some((p) => /step$/.test(p.url))).toBe(true)                         // asked, and it never answers
    fireEvent.click(screen.getByTestId('story-call-all'))
    fireEvent.click(screen.getByTestId('story-go'))
    expect(await screen.findByTestId('story-result')).toBeInTheDocument()
    expect(screen.getByTestId('story-mine')).toHaveTextContent('Out at −1.0R on the stop.')
    fireEvent.click(screen.getByTestId('story-next'))
    expect(await screen.findByTestId('story-done')).toBeInTheDocument()
  })

  it('a scored chart whose reveal brought no plan says so, counts its name, and asks no call', async () => {
    reduce()
    const posts = []
    const fetcher = makeFetcher({ posts, ids: ['np1'] })
    await begin(fetcher)
    fireEvent.click(tile('Slingshot'))
    fireEvent.click(screen.getByTestId('story-check'))
    const entry = await screen.findByTestId('story-entry')
    expect(entry).toHaveTextContent('Named it.')
    expect(screen.getByTestId('story-entry-sub')).toHaveTextContent('TSLA · No trade plan came back for this chart, so there is nothing to manage.')
    expect(screen.getByTestId('story-entry-go')).toHaveTextContent('Continue')
    fireEvent.click(screen.getByTestId('story-entry-go'))
    expect(screen.getByTestId('story-no-plan')).toBeInTheDocument()
    expect(screen.queryByTestId('story-stop')).toBeNull()
    fireEvent.click(screen.getByTestId('story-next'))
    await screen.findByTestId('story-done')
    expect(screen.getByTestId('story-named')).toHaveTextContent('You named 1 of 1 setup before the trade.')
    expect(screen.getAllByTestId('story-end-trade')[0]).toHaveTextContent('TSLA · Slingshot: no trade plan came back, so there was nothing to manage.')
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)
  })

  it('a chart that could not be scored says so and skips on; a run with no calls reports nothing', async () => {
    reduce()
    const posts = []
    const fetcher = makeFetcher({ posts, ids: ['lp1'], failAttempt: new Set(['lp1']) })
    await begin(fetcher)
    fireEvent.click(tile('Launchpad'))
    fireEvent.click(screen.getByTestId('story-check'))
    expect(await screen.findByTestId('story-failed')).toHaveTextContent('This chart could not be scored. Skip it and the next one loads.')
    expect(screen.queryByTestId('story-entry')).toBeNull()
    fireEvent.click(screen.getByTestId('story-skip'))
    const done = await screen.findByTestId('story-done')
    expect(done).toHaveTextContent('Nothing to manage')
    expect(screen.getAllByTestId('story-end-trade')[0]).toHaveTextContent('Launchpad: not scored, so not played.')
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)
  })

  it('keeps what is left on the plan stop when the trail is not a level the bars can place, and closed mid-run reports nothing', async () => {
    reduce()
    const posts = []
    const fetcher = makeFetcher({ posts, ids: ['gs1'] })
    const view = await begin(fetcher)
    fireEvent.click(tile('Gap Support'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(q()).toBe('2R just traded, at 11.00. What do you do?'))
    expect(screen.getByTestId('story-plan')).toHaveTextContent("if it drifts sideways at the gap, a tighter stop just under the gap top. This replay keeps the plan's stop on what is left.")
    fireEvent.click(screen.getByTestId('story-call-trim'))
    fireEvent.click(screen.getByTestId('story-go'))
    await waitFor(() => expect(q()).toBe('3R just traded, at 11.50. What do you do?'))
    fireEvent.click(screen.getByTestId('story-call-trim'))
    expect(screen.getByTestId('story-why')).toHaveTextContent('3R is the second target: take some off. What is left rides on the stop.')
    expect(screen.getByTestId('story-stop-level')).toHaveTextContent('9.50')
    expect(chart().getAttribute('data-lines')).not.toContain('story-TRAIL')
    view.unmount()
    fireEvent.keyDown(window, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)
  })

  it('an empty pool says so honestly, with a way back, never a spinner', async () => {
    const onClose = vi.fn()
    render(<TradeStoryGame fetcher={makeFetcher({ ids: [] })} onClose={onClose} />)
    expect(await screen.findByTestId('story-empty')).toBeInTheDocument()
    expect(screen.getByTestId('story-intro')).toHaveTextContent(EMPTY_LINE)
    expect(screen.getByTestId('story-start')).toBeDisabled()
    expect(screen.getByTestId('story-start')).toHaveTextContent('No trades yet')
    fireEvent.click(screen.getByTestId('story-back'))
    expect(onClose).toHaveBeenCalled()
  })

  it('a pool that failed to load offers a second try; a signed-out member is asked to sign in', async () => {
    let fails = 1
    const pools = []
    render(<TradeStoryGame fetcher={makeFetcher({ pools, poolError: () => (fails-- > 0 ? Object.assign(new Error('500'), { status: 500 }) : null) })} onClose={() => {}} />)
    expect(await screen.findByTestId('story-load-failed')).toBeInTheDocument()
    expect(screen.getByTestId('story-intro')).toHaveTextContent(FAILED_LINE)
    fireEvent.click(screen.getByTestId('story-retry'))
    await waitFor(() => expect(screen.getByTestId('story-start')).not.toBeDisabled())
    expect(pools).toHaveLength(2)
    cleanup()
    render(<TradeStoryGame fetcher={makeFetcher({ poolError: () => Object.assign(new Error('401'), { status: 401 }) })} onClose={() => {}}
      signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    expect(await screen.findByTestId('sign-in')).toBeInTheDocument()
  })

  it('reports the calls exactly once under StrictMode', async () => {
    reduce()
    const posts = []
    render(<StrictMode><TradeStoryGame fetcher={makeFetcher({ posts, ids: ['hv1'] })} onClose={() => {}} /></StrictMode>)
    const go = screen.getByTestId('story-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    fireEvent.click(tile('High Volume Edge'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(screen.getByTestId('story-stop-q')).toHaveTextContent('through your stop'))
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.getByTestId('story-stop').getAttribute('data-state')).toBe('ok')
    fireEvent.keyDown(window, { key: 'Enter' })
    await screen.findByTestId('story-result')
    fireEvent.keyDown(window, { key: 'Enter' })
    await screen.findByTestId('story-done')
    await waitFor(() => expect(screen.getByTestId('story-level')).toBeInTheDocument())
    expect(posts.filter((p) => p.url === '/api/study/attempts')).toHaveLength(1)
    expect(posts.filter((p) => p.url === '/api/study/game-runs').map((p) => p.body)).toEqual([{ kind: 'story', run_id: expect.any(String), right: 1, total: 1 }])
  })

  it('stops at the Gap Support\'s post-gap high before 2R: its line from the start, its row in the key, the working, and the log', async () => {
    reduce()
    const posts = []
    await begin(makeFetcher({ posts, ids: ['gs2'] }))
    fireEvent.click(tile('Gap Support'))
    fireEvent.click(screen.getByTestId('story-check'))
    expect(await screen.findByTestId('story-entry-sub')).toHaveTextContent('META · Bought at 10.60 · stop 10.05 · 5.2% risk')
    fireEvent.click(screen.getByTestId('story-entry-go'))

    // the post-gap high (11.60, the run's high after the gap) is drawn with the plan's levels, dotted, from the start
    await waitFor(() => expect(q()).toBe('Price just traded up to the post-gap high, 11.60. What do you do?'))
    expect(bars()).toBe(76 + 2)
    expect(screen.getByTestId('story-stop')).toHaveTextContent('The replay stops · Post-gap high')
    expect(screen.getByTestId('story-stop').getAttribute('data-at')).toBe('pgh')
    expect(chart().getAttribute('data-lines').split('|')).toEqual(['hard-ENTRY', 'hard-STOP', 'hard-2R', 'hard-3R', 'story-PGH'])
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|POST-GAP HIGH')
    const row = screen.getByTestId('story-plan').querySelector('[data-row="Post-gap high"]')
    expect(row).toHaveTextContent('11.60')
    expect(row).toHaveTextContent('The post-gap high is the first place to take some off')
    expect(row).toHaveTextContent('reached on day 2')
    expect(screen.getByTestId('story-plan')).not.toHaveTextContent('reached on day 3')

    // Hold is a miss: the plan's call takes the screen, then the working on the plan's prices
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByTestId('story-miss')).toHaveTextContent('Take some off')
    expect(screen.getByTestId('story-miss-why')).toHaveTextContent('At the post-gap high the plan takes some off. It names the level, not how much to sell.')
    fireEvent.click(screen.getByTestId('story-miss-go'))
    expect(screen.getByTestId('story-step-level-pgh')).toHaveTextContent('The post-gap high: 11.60, the highest price from the gap day through the entry day.')
    expect(screen.getByTestId('story-step-fill-pgh')).toHaveTextContent('At 11.60: (11.60 − 10.60) ÷ 0.55 = +1.8R.')
    fireEvent.keyDown(window, { key: 'Enter' })

    // then 2R, 3R and the stop, as before
    await waitFor(() => expect(q()).toBe('2R just traded, at 11.70. What do you do?'))
    fireEvent.click(screen.getByTestId('story-call-trim')); fireEvent.click(screen.getByTestId('story-go'))
    await waitFor(() => expect(q()).toBe('3R just traded, at 12.25. What do you do?'))
    fireEvent.click(screen.getByTestId('story-call-trim')); fireEvent.click(screen.getByTestId('story-go'))
    await waitFor(() => expect(q()).toBe('Price just traded down through your stop, 10.05. What do you do?'))
    fireEvent.click(screen.getByTestId('story-call-all'))
    expect(screen.getByTestId('story-go')).toHaveTextContent('See the trade')
    fireEvent.click(screen.getByTestId('story-go'))

    await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-result-title')).toHaveTextContent('3 of 4 calls on the plan.')
    const rows = within(screen.getByTestId('story-result-calls')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['0', '1', '1', '1'])
    expect(rows[0]).toHaveTextContent('Post-gap high · Take some off')
    expect(rows[0]).toHaveTextContent('day 2 · you said hold')
    expect(rows[0]).toHaveTextContent('+1.8R')
    expect(screen.getByTestId('story-mine')).toHaveTextContent('Some off at 2R and 3R. The rest out at −1.0R on the stop.')
    expect(screen.getByTestId('story-plan-exits')).toHaveTextContent('Some off at the post-gap high, 2R and 3R. The rest out at −1.0R on the stop.')
    fireEvent.click(screen.getByTestId('story-next'))

    await screen.findByTestId('story-done')
    const log = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(log).toHaveLength(4)
    expect(log[0]).toHaveTextContent('Post-gap high · Take some off')
    expect(log[0]).toHaveTextContent('you said hold')
    expect(screen.getByTestId('story-right')).toHaveTextContent('3/4')
    expect(screen.getAllByTestId('story-end-trade')[0]).toHaveTextContent('META · Gap Support: some off at 2R and 3R. The rest out at −1.0R on the stop.')
    expect(screen.queryByTestId('story-end-yours')).toBeNull()
    await waitFor(() => expect(posts.filter((p) => p.url === '/api/study/game-runs').map((p) => p.body)).toEqual([{ kind: 'story', run_id: expect.any(String), right: 3, total: 4 }]))
  }, 15000)

  it('stops at the High Volume Edge\'s first return as the member\'s own call: no score, the plan\'s words and stop, and said at the end (StrictMode)', async () => {
    reduce()
    const posts = []
    render(<StrictMode><TradeStoryGame fetcher={makeFetcher({ posts, ids: ['hv3'] })} onClose={() => {}} /></StrictMode>)
    const go = screen.getByTestId('story-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    fireEvent.click(tile('High Volume Edge'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))

    // day 2 closed over the 10.00 high-volume close; day 4 is back at it
    await waitFor(() => expect(q()).toBe('Price just came back to the high-volume close, 10.00. What do you do?'))
    expect(bars()).toBe(N + 4)
    expect(screen.getByTestId('story-stop')).toHaveTextContent('The replay stops · High-volume close')
    expect(chart().getAttribute('data-marks')).toBe('BOUGHT|FIRST RETURN')
    // the high-volume close is the entry line itself: named in the key, never drawn twice
    expect(chart().getAttribute('data-lines').split('|')).toEqual(['hard-ENTRY', 'hard-STOP', 'hard-2R', 'hard-3R'])
    const row = screen.getByTestId('story-plan').querySelector('[data-row="High-volume close"]')
    expect(row).toHaveTextContent('10.00')
    expect(row).toHaveTextContent('The first return to the high-volume close, often weeks later, is the cleanest decision point. It is the entry line.')
    expect(row).toHaveTextContent('back on day 4')

    // the member's call: no takeover, neither right nor wrong, the plan's words, its stop, the working
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.queryByTestId('story-miss')).toBeNull()
    expect(screen.getByTestId('story-stop').getAttribute('data-state')).toBe('yours')
    expect(screen.getByTestId('story-call-trim').getAttribute('data-state')).toBe('sel')
    expect(screen.getByTestId('story-call-hold').getAttribute('data-state')).toBe('quiet')
    expect(screen.getByTestId('story-why')).toHaveTextContent("Your call. The plan calls the first return to the high-volume close the cleanest decision point, and leaves the call to you. The stop is still under it, at 9.50, the edge bar's low. You took some off at 0.0R. This one is not scored.")
    expect(screen.getByTestId('story-step-return')).toHaveTextContent('It closed over it on day 2, and day 4 came back to it.')
    expect(screen.getByTestId('story-step-call')).toHaveTextContent('The plan calls this the cleanest decision point and leaves the call to you.')
    fireEvent.keyDown(window, { key: '3' })                                            // a second key moves nothing
    expect(screen.getByTestId('story-call-trim').getAttribute('data-state')).toBe('sel')
    expect(screen.getByTestId('story-position-word')).toHaveTextContent('Some off')
    fireEvent.keyDown(window, { key: 'Enter' })

    await waitFor(() => expect(q()).toBe('Price just traded down through your stop, 9.50. What do you do?'))
    expect(screen.getByTestId('story-stop-where')).toHaveTextContent('You took some off at the high-volume close. The rest is still on.')
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.getByTestId('story-stop').getAttribute('data-state')).toBe('ok')
    fireEvent.keyDown(window, { key: 'Enter' })

    await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-result-title')).toHaveTextContent('On the plan.')
    const rows = within(screen.getByTestId('story-result-calls')).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-ok'))).toEqual(['free', '1'])
    expect(rows[0]).toHaveTextContent('High-volume close · Your call')
    expect(rows[0]).toHaveTextContent('day 4 · the plan leaves this one to you · you said take some off')
    expect(rows[0]).toHaveTextContent('0.0R')
    expect(screen.getByTestId('story-mine')).toHaveTextContent('Some off at the high-volume close. The rest out at −1.0R on the stop.')
    expect(screen.getByTestId('story-plan-exits')).toHaveTextContent('Out at −1.0R on the stop.')
    fireEvent.keyDown(window, { key: 'Enter' })

    const done = await screen.findByTestId('story-done')
    expect(screen.getByTestId('story-right')).toHaveTextContent('1/1')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem').map((x) => x.textContent)).toEqual([expect.stringContaining('Stop · Sell the rest')])
    expect(screen.getByTestId('story-end-yours')).toHaveTextContent('AMD · High Volume Edge: the first return to the high-volume close, day 4, was a decision point the plan leaves to you. You took some off at 0.0R.')
    await waitFor(() => expect(screen.getByTestId('story-level')).toBeInTheDocument())
    expect(posts.filter((p) => p.url === '/api/study/game-runs').map((p) => p.body)).toEqual([{ kind: 'story', run_id: expect.any(String), right: 1, total: 1 }])
    expect(done.textContent).not.toMatch(/[—–]|\bfirm\b|NaN|undefined/i)
  }, 15000)

  it('a run whose only call was the member\'s own reports nothing and says so', async () => {
    reduce()
    const posts = []
    const fetcher = makeFetcher({ posts, ids: ['hv4'] })
    await begin(fetcher)
    fireEvent.click(tile('High Volume Edge'))
    fireEvent.click(screen.getByTestId('story-check'))
    fireEvent.click(await screen.findByTestId('story-entry-go'))
    await waitFor(() => expect(q()).toBe('Price just came back to the high-volume close, 10.00. What do you do?'))
    fireEvent.click(screen.getByTestId('story-call-hold'))
    expect(screen.getByTestId('story-go')).toHaveTextContent('Keep playing')
    fireEvent.click(screen.getByTestId('story-go'))
    await screen.findByTestId('story-result')
    expect(screen.getByTestId('story-result-title')).toHaveTextContent('Your call on this one, not scored.')
    fireEvent.click(screen.getByTestId('story-next'))
    await screen.findByTestId('story-done')
    expect(screen.getByTestId('story-right')).toHaveTextContent('0/0')
    expect(screen.getByTestId('story-end-yours')).toHaveTextContent('was a decision point the plan leaves to you. You held.')
    expect(fetcher.mock.calls.some(([u]) => u === '/api/study/game-runs')).toBe(false)
  })
})
