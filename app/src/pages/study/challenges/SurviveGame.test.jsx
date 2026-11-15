/**
 * Survive the Drawdown rails (docs/study/GAMES.md §1 rule 6): the start arena with its stakes and three steps; the pick
 * screen with the system, the five risks and our range bracketed; the curve drawing trade by trade on the component's
 * clock (the trade, the last result, the account and the fall under its peak, read from the pure module), then the
 * result and the other four; a right answer takes over the screen and the review marks it on the chart; a wrong one
 * takes over with the mistake named, and the review shows the working, the drawing and the rule; the end screen with the
 * run log, the stretch's win count and longest losing streak, the member's line and our rule; the run posts once to
 * /api/study/game-runs (StrictMode too) and the level bar reads the server's answer; a failed, malformed or signed-out
 * post never breaks the end screen; a late answer never lands on a later run; a stretch that cannot be dealt is an
 * honest empty state with a way back. Time is faked, so the seed (Date.now() at Start) and every number are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
const ctl = vi.hoisted(() => ({ deal: 'real', questions: 'real', cues: [] }))
// the reveal's feel (sound and haptics), recorded: the draw's last trade fires it once, by whether the pick survived
vi.mock('../studyFeedback', async (importOriginal) => ({ ...(await importOriginal()), revealFeedback: (ok) => { ctl.cues.push(ok) } }))
vi.mock('./games/survive', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    dealStretch: (...a) => { if (ctl.deal === 'throw') throw new Error('no stretch for this seed'); return m.dealStretch(...a) },
    questionsFor: (...a) => (ctl.questions === 'empty' ? [] : m.questionsFor(...a)),
  }
})

import SurviveGame, { GAME, TICK_MS } from './SurviveGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import {
  LESSON_RULE, LESSON_STREAK, PICKS, START, climbOf, countText, dealStretch, dollars, edgeText, fallOf, firstRisk, headlineOf, liveAt, manyPanel, pct, pickLabel,
  pickLine, pickOf, questionsFor, readoutAt, runIdOf, signedPct, stretchLine, survivalLine, survivalTitle, survived, verdictOf, whyLine, workingOf,
} from './games/survive'

const SEED = 1731100000000
const S0 = dealStretch(SEED)
const BAD_TEXT = /[–—]|the firm|NaN|undefined|Infinity/i
const flush = async () => { await act(async () => { for (let k = 0; k < 6; k++) await Promise.resolve() }) }
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
/** The x-axis labels sit 10px above the drawing's foot (T + ph + 18, with B = 28). */
const B_AXIS = 10

function fetcherWith(posts, { fail = false, status = 500, answer = null } = {}) {
  return vi.fn(async (url, opts = {}) => {
    if (url !== '/api/study/game-runs') throw new Error(`unexpected ${url}`)
    posts.push(opts.body)
    if (fail) { const e = new Error(`POST ${url} answered ${status}`); e.status = status; throw e }
    if (answer) return answer
    const xp = opts.body.right * 2
    return { xp_gained: xp, duplicate: false, progress: { xp: 1000 + xp, level: 3, xp_gained: xp }, badges_new: [] }
  })
}

/** A percent as a whole number in text ("3.2%" inside "13.2%" is another number). */
const wholePct = (t) => new RegExp(`(^|[^\\d.])${t.replace(/[.+]/g, '\\$&')}`)
const tiles = () => within(screen.getByTestId('survive-cards')).getAllByRole('button')
const tileFor = (q, label) => tiles()[q.labels.indexOf(label)]
const wrongOf = (q, prefer = []) => (prefer.map((k) => q.choices.find((c) => c.mistake === k)).find(Boolean) || q.choices.find((c) => !c.right)).label

/** From the arena to the pick screen, to a pick, and through the draw to the five-line chart. */
function playTo(bps, { skip = true } = {}) {
  fireEvent.click(screen.getByTestId('survive-start'))
  fireEvent.click(screen.getByTestId(`survive-pick-${bps}`))
  fireEvent.click(screen.getByTestId('survive-play'))
  if (skip) fireEvent.click(screen.getByTestId('survive-skip'))
  fireEvent.click(screen.getByTestId('survive-others'))
}

/** Answer the question on screen with `label`, through the takeover, into the review. */
function answer(q, label) {
  fireEvent.click(tileFor(q, label))
  fireEvent.click(screen.getByTestId('survive-check'))
  expect(screen.getByTestId('survive-takeover')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('survive-takeover-go'))
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear(); ctl.deal = 'real'; ctl.questions = 'real'; ctl.cues = [] })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); vi.restoreAllMocks() })

describe('SurviveGame', () => {
  it('registers itself from one place, on an existing icon, a landing accent and the skill group', () => {
    expect(GAME).toEqual({ kind: 'survive', title: 'Survive the Drawdown', sub: expect.any(String), icon: 'equity', plate: 'Survive', accent: 'red', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(BAD_TEXT)
  })

  it('opens on the start arena: the stakes, the three steps and the best run', () => {
    localStorage.setItem('study.survive.best', '2')
    render(<SurviveGame fetcher={fetcherWith([])} onClose={() => {}} />)
    const intro = screen.getByTestId('survive-intro')
    expect(intro).toHaveTextContent('Survive the Drawdown')
    expect(intro).toHaveTextContent('50trades')
    expect(intro).toHaveTextContent('5risk sizes')
    expect(intro).toHaveTextContent('3questions')
    expect(intro).toHaveTextContent('Only your risk per trade changes.')
    expect(screen.getByTestId('survive-best')).toHaveTextContent('2')
    const how = screen.getByTestId('survive-howto')
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)
    for (const t of ['Pick your risk', 'Watch 50 trades', 'Read the damage']) expect(how).toHaveTextContent(t)
    expect(intro.textContent).not.toMatch(BAD_TEXT)
    expect(screen.getByTestId('survive-start')).not.toBeDisabled()
  })

  it('the pick screen: the system, the five risks with our range bracketed, and Play waits for a pick', () => {
    render(<SurviveGame fetcher={fetcherWith([])} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    const sys = screen.getByTestId('survive-system')
    expect(sys).toHaveTextContent('+0.4R')
    expect(sys).toHaveTextContent(edgeText())
    expect(sys).toHaveTextContent(dollars(START))
    const picks = screen.getByTestId('survive-picks')
    expect(within(picks).getAllByRole('radio')).toHaveLength(5)
    for (const bps of PICKS) expect(screen.getByTestId(`survive-pick-${bps}`)).toHaveTextContent(`${pickLabel(bps)}${firstRisk(bps)} on trade one`)
    expect(picks).toHaveTextContent('Our range · 0.25% to 2%')
    expect(picks).toHaveTextContent('Over our 2% ceiling')
    const play = screen.getByTestId('survive-play')
    expect(play).toBeDisabled()
    expect(play).toHaveTextContent('Pick a risk')
    fireEvent.keyDown(window, { key: '4' })                                              // the number keys pick
    expect(screen.getByTestId('survive-pick-500')).toHaveAttribute('aria-checked', 'true')
    expect(play).not.toBeDisabled()
    expect(play).toHaveTextContent('Play 50 trades at 5%')
    expect(screen.getByTestId('survive-pick').textContent).not.toMatch(BAD_TEXT)
  })

  it('plays a run: the curve draws trade by trade, the others join, right and wrong answers teach, the end reports once', async () => {
    const posts = []
    const onClose = vi.fn()
    render(<SurviveGame fetcher={fetcherWith(posts)} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.click(screen.getByTestId('survive-pick-200'))
    fireEvent.click(screen.getByTestId('survive-play'))

    // the draw: one trade a tick, every number the pure module's
    const play = screen.getByTestId('survive-play')
    expect(play).toHaveAttribute('data-state', 'drawing')
    expect(screen.getByTestId('survive-trade')).toHaveTextContent('0 of 50')
    tick(TICK_MS * 10)
    const at10 = liveAt(S0, 200, 10)
    expect(screen.getByTestId('survive-trade')).toHaveTextContent('10 of 50')
    expect(screen.getByTestId('survive-balance')).toHaveTextContent(dollars(at10.balance))
    expect(screen.getByTestId('survive-last')).toHaveTextContent(at10.last.win ? '+2.5R' : '−1R')
    expect(screen.getByTestId('survive-under')).toHaveTextContent(at10.under > 0 ? `−${pct(at10.under)}` : 'New high')
    expect(screen.getByTestId('survive-pips')).toHaveAttribute('aria-label', '10 of 50 trades played')
    expect(screen.getByTestId('survive-chart')).toHaveAttribute('data-others', '0')
    tick(TICK_MS * 40)

    // drawn: the result, the stretch's losing streak, and the line that says whether it survived; never the pick's fall
    // as a percent, which the depth question asks for
    const p = pickOf(S0, 200)
    const FALL = pct(fallOf(p.deep.peak, p.deep.low))
    expect(screen.getByTestId('survive-play')).toHaveAttribute('data-state', 'drawn')
    expect(screen.getByTestId('survive-final')).toHaveTextContent(dollars(p.final))
    expect(screen.getByTestId('survive-run')).toHaveTextContent(`${S0.streak.length} in a row`)
    expect(screen.getByTestId('survive-verdict')).toHaveAttribute('data-verdict', verdictOf(p))
    expect(screen.getByTestId('survive-verdict')).toHaveTextContent('Survived')
    expect(screen.getByTestId('survive-line')).toHaveTextContent(survivalLine(p))
    expect(screen.getByTestId('survive-play').textContent).not.toContain(FALL)
    expect(vi.getTimerCount()).toBe(0)                                                   // the clock stops at trade 50
    fireEvent.click(screen.getByTestId('survive-others'))

    // Q1: the streak. The five lines with the streak's trades shaded; a right answer takes over, and the review marks
    // what the streak took on the line it asked about, works it and draws the account after each loss. Nothing on this
    // screen states the member's own fall, which the next question asks
    const QS = questionsFor(S0, 200, SEED)
    expect(screen.getByTestId('survive-chart')).toHaveAttribute('data-others', '1')
    for (const bps of PICKS) expect(screen.getByTestId(`survive-end-${bps}`)).toHaveTextContent(bps === 200 ? 'You 2%' : pickLabel(bps))
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-key', 'streak')
    expect(screen.getByTestId('survive-question')).toHaveTextContent(QS[0].question)
    expect(screen.getByTestId('survive-question')).toHaveTextContent(QS[0].detail)
    expect(QS[0].question).toBe(`What do ${S0.streak.length} losses in a row take at 10% a trade?`)
    expect(screen.getByTestId('survive-streak-window')).toBeInTheDocument()
    expect(screen.getByTestId('survive-chart').querySelector('svg')).toHaveAttribute('aria-label', expect.stringContaining(`trades ${S0.streak.from} to ${S0.streak.to}, is shaded`))
    expect(screen.queryByTestId('survive-streak-fall')).toBeNull()                      // the answer waits for the check
    expect(screen.getByTestId('survive-step')).toHaveTextContent('question 1 of 3')
    expect(tiles().map((b) => b.textContent)).toEqual(QS[0].labels.map((l, i) => `${i + 1}${l}`))
    answer(QS[0], QS[0].answer)
    expect(screen.queryByTestId('survive-takeover')).toBeNull()
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-state', 'ok')
    expect(screen.getByTestId('survive-streak-fall')).toHaveTextContent(`−${QS[0].answer}`)
    const w1 = workingOf(QS[0], S0)
    const work1 = screen.getByTestId('survive-working')
    expect(work1).toHaveTextContent(w1.title)
    for (const st of w1.steps) expect(work1).toHaveTextContent(st)
    expect(work1).toHaveTextContent(LESSON_STREAK)
    expect(work1).toHaveTextContent(w1.source)
    expect(screen.getByTestId('survive-loss-steps')).toHaveTextContent(`After ${S0.streak.length} losses · ${pct(QS[0].left)} left`)
    expect(screen.queryByTestId('survive-mistake')).toBeNull()
    expect(screen.getByTestId('survive-question').textContent).not.toMatch(wholePct(FALL))
    fireEvent.click(screen.getByTestId('survive-next'))

    // Q2: the member's own depth. The peak and the low are marked before the check, and nothing on the screen states the
    // fall (the board's head, the chart, the slider's readout); a wrong answer takes over with the mistake named
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-key', 'deep')
    expect(screen.getByTestId('survive-question')).toHaveTextContent(QS[1].detail)
    expect(screen.getByTestId('survive-peak-low')).toHaveTextContent(`Peak ${dollars(p.deep.peak)}`)
    expect(screen.getByTestId('survive-peak-low')).toHaveTextContent(`Low ${dollars(p.deep.low)}`)
    for (const bps of PICKS) expect(!!screen.queryByTestId(`survive-line-${bps}`)).toBe(bps === 200)   // zoomed to the member's line
    expect(screen.getByTestId('survive-window')).toBeInTheDocument()
    expect(screen.queryByTestId('survive-half')).toBeNull()                              // the 50% line belongs to the draw
    expect(screen.queryByTestId('survive-deep-fall')).toBeNull()                         // the answer waits for the check
    const svg2 = screen.getByTestId('survive-chart').querySelector('svg')
    fireEvent.keyDown(svg2, { key: 'End' })
    for (let k = S0.n; k > p.deep.lowAt; k--) fireEvent.keyDown(svg2, { key: 'ArrowLeft' })   // slide to the low
    expect(screen.getByTestId('survive-readout')).toHaveTextContent(`its peak ${dollars(p.deep.peak)}`)
    const askText = screen.getByTestId('survive-question').textContent.replace(within(screen.getByTestId('survive-cards')).getByText(FALL).textContent, '')
    expect(askText).not.toContain(FALL)                                                  // only the answer tile says it
    expect(svg2.getAttribute('aria-valuetext')).not.toContain(FALL)
    const wrong2 = wrongOf(QS[1], ['climb', 'start', 'added'])
    fireEvent.click(tileFor(QS[1], wrong2))
    fireEvent.click(screen.getByTestId('survive-check'))
    const tk = screen.getByTestId('survive-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(headlineOf(QS[1], wrong2))
    expect(tk).toHaveTextContent(QS[1].answer)
    expect(screen.getByTestId('survive-takeover-why')).toHaveTextContent(whyLine(QS[1], S0, wrong2))
    expect(within(tk).queryByTestId('survive-working')).toBeNull()                      // the working waits below
    fireEvent.click(screen.getByTestId('survive-takeover-go'))
    expect(screen.getByTestId('survive-deep-fall')).toHaveTextContent(`−${QS[1].answer}`)
    expect(screen.getByTestId('survive-mistake')).toHaveTextContent(whyLine(QS[1], S0, wrong2))
    const w2 = workingOf(QS[1], S0)
    for (const st of w2.steps) expect(screen.getByTestId('survive-working')).toHaveTextContent(st)
    const climb = screen.getByTestId('survive-climb')
    expect(climb).toHaveTextContent(`−${QS[1].answer}`)
    expect(climb).toHaveTextContent(signedPct(climbOf(p.deep.peak, p.deep.low)))
    expect(screen.getByTestId('survive-working')).toHaveTextContent(LESSON_RULE)
    fireEvent.keyDown(svg2, { key: 'End' })                                              // checked: now the slider says the fall
    for (let k = S0.n; k > p.deep.lowAt; k--) fireEvent.keyDown(svg2, { key: 'ArrowLeft' })
    expect(screen.getByTestId('survive-readout')).toHaveTextContent(`${FALL} under its peak`)
    fireEvent.click(screen.getByTestId('survive-next'))

    // Q3: a wrong answer on the 50% line; the review draws each fall and the 50% line
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-key', 'line')
    const wrong3 = wrongOf(QS[2])
    answer(QS[2], wrong3)
    expect(screen.getByTestId('survive-mistake')).toHaveTextContent(whyLine(QS[2], S0, wrong3))
    const bars = screen.getByTestId('survive-fall-bars')
    for (const bps of PICKS) expect(bars).toHaveTextContent(`−${pct(fallOf(pickOf(S0, bps).deep.peak, pickOf(S0, bps).deep.low))}`)
    expect(bars).toHaveTextContent('50% line · needs +100% back')
    for (const bps of S0.fell) expect(screen.getByTestId(`survive-fall-${bps}`)).toBeInTheDocument()
    expect(screen.getByTestId('survive-working')).toHaveTextContent('Every loss needs a bigger gain to repair it. Down 50% needs +100%.')
    expect(screen.getByTestId('survive-next')).toHaveTextContent('See the run')
    expect(screen.getByTestId('survive-question').textContent).not.toMatch(BAD_TEXT)
    fireEvent.click(screen.getByTestId('survive-next'))

    // the end: the log, the stretch, the member's line, the rule; one report, and the level bar it answered
    const done = screen.getByTestId('survive-done')
    expect(done).toHaveTextContent(survivalTitle(p))
    expect(screen.getByTestId('survive-right')).toHaveTextContent('1/3')
    const rows = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent(`The streak${QS[0].answer}`)
    expect(rows[1]).toHaveTextContent(`you said ${wrong2}`)
    expect(rows[2]).toHaveTextContent(`you said ${wrong3}`)
    expect(screen.getByTestId('survive-stretch')).toHaveTextContent(stretchLine(S0))
    expect(screen.getByTestId('survive-stretch')).toHaveTextContent(`${S0.count} wins`)
    expect(screen.getByTestId('survive-stretch')).toHaveTextContent(`longest losing streak ${S0.streak.length}`)
    expect(screen.getByTestId('survive-yours')).toHaveTextContent(`Your ${pickLine(p)}.`)
    // the same game 10,000 times: every line and every bar the pure module's
    const many = screen.getByTestId('survive-many')
    const mp = manyPanel()
    expect(many).toHaveTextContent(mp.eyebrow)
    expect(many).toHaveTextContent(mp.title)
    for (const line of mp.lines) expect(many).toHaveTextContent(line)
    expect(many).toHaveTextContent(mp.source)
    for (const r of mp.rows) expect(screen.getByTestId(`survive-many-${r.bps}`)).toHaveTextContent(`${pickLabel(r.bps)}${countText(r.big)}${countText(r.small)}`)
    expect(screen.getByTestId('survive-many-bars')).toHaveAttribute('aria-label', expect.stringContaining('10% a trade: 5,958 on 4 in 10 win, +0.4R, 9,115 on 3 in 10 win, +0.05R'))
    expect(screen.getByTestId('survive-rule')).toHaveTextContent(LESSON_RULE)
    expect(screen.getByTestId('survive-best-line')).toHaveTextContent('A new best: 1 of 3 read right.')
    expect(localStorage.getItem('study.survive.best')).toBe('1')
    await flush()
    expect(posts).toEqual([{ kind: 'survive', run_id: runIdOf(SEED, 1), right: 1, total: 3 }])
    expect(screen.getByTestId('survive-level')).toHaveTextContent('+2 XP this run')
    expect(screen.getByTestId('survive-xp')).toHaveTextContent('+')
    expect(screen.queryByTestId('survive-not-saved')).toBeNull()
    expect(done.textContent).not.toMatch(BAD_TEXT)

    // Back to Study closes; New stretch deals a fresh one straight to the pick, and nothing posts twice
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.setSystemTime(SEED + 5)
    fireEvent.click(screen.getByTestId('survive-again'))
    expect(screen.getByTestId('survive-pick')).toBeInTheDocument()
    expect(screen.getByTestId('survive-play')).toBeDisabled()
    await flush()
    expect(posts).toHaveLength(1)
  })

  it('plays from the keyboard, each Enter firing once: pick, play, skip, show, answer, review, next', () => {
    render(<SurviveGame fetcher={fetcherWith([])} />)
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Enter starts
    fireEvent.keyDown(window, { key: '5' })
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Enter plays (and does not skip)
    expect(screen.getByTestId('survive-play')).toHaveAttribute('data-state', 'drawing')
    expect(screen.getByTestId('survive-trade')).toHaveTextContent('0 of 50')
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Enter skips to trade 50
    expect(screen.getByTestId('survive-play')).toHaveAttribute('data-state', 'drawn')
    expect(screen.getByTestId('survive-final')).toHaveTextContent(dollars(pickOf(S0, 1000).final))
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Enter shows the other four
    const QS = questionsFor(S0, 1000, SEED)
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-state', 'ask')
    fireEvent.keyDown(window, { key: String(QS[0].labels.indexOf(QS[0].answer) + 1) })
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Check
    expect(screen.getByTestId('survive-takeover')).toHaveAttribute('data-correct', '1')
    fireEvent.keyDown(window, { key: 'Enter' })                                          // the takeover's own button
    expect(screen.queryByTestId('survive-takeover')).toBeNull()
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-key', 'streak') // still on Q1, reviewing
    fireEvent.keyDown(window, { key: 'Enter' })                                          // Next
    expect(screen.getByTestId('survive-question')).toHaveAttribute('data-key', 'deep')
    expect(screen.getByTestId('survive-step')).toHaveTextContent('question 2 of 3')
  })

  it('a perfect run lights the medal, posts 3 of 3 and keeps the best on this device', async () => {
    const posts = []
    render(<SurviveGame fetcher={fetcherWith(posts)} />)
    playTo(50)
    const QS = questionsFor(S0, 50, SEED)
    for (const q of QS) { answer(q, q.answer); fireEvent.click(screen.getByTestId('survive-next')) }
    expect(screen.getByTestId('survive-done')).toHaveTextContent('3 for 3')
    expect(screen.getByTestId('survive-done')).toHaveTextContent(survivalTitle(pickOf(S0, 50)))
    await flush()
    expect(posts).toEqual([{ kind: 'survive', run_id: runIdOf(SEED, 1), right: 3, total: 3 }])
    expect(screen.getByTestId('survive-level')).toHaveTextContent('+6 XP this run')
    expect(localStorage.getItem('study.survive.best')).toBe('3')
  })

  it('reports exactly once under StrictMode, with one clock and one key handler', async () => {
    const posts = []
    render(<StrictMode><SurviveGame fetcher={fetcherWith(posts)} /></StrictMode>)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByTestId('survive-pick-50')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('survive-play'))
    tick(TICK_MS * 10)
    expect(screen.getByTestId('survive-trade')).toHaveTextContent('10 of 50')             // one clock, not two
    tick(TICK_MS * 40)
    fireEvent.click(screen.getByTestId('survive-others'))
    const QS = questionsFor(S0, 50, SEED)
    for (const q of QS) {
      fireEvent.keyDown(window, { key: String(q.labels.indexOf(q.answer) + 1) })         // one key, one pick
      fireEvent.click(screen.getByTestId('survive-check'))
      fireEvent.click(screen.getByTestId('survive-takeover-go'))
      fireEvent.click(screen.getByTestId('survive-next'))
    }
    await flush()
    expect(screen.getByTestId('survive-right')).toHaveTextContent('3/3')
    expect(posts).toHaveLength(1)
    expect(screen.getByTestId('survive-level')).toBeInTheDocument()
  })

  it('a failed post never breaks the end screen; signed out, it says so and offers the sign-in', async () => {
    const fail = fetcherWith([], { fail: true, status: 401 })
    render(<SurviveGame fetcher={fail} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    playTo(100)
    for (const q of questionsFor(S0, 100, SEED)) { answer(q, q.answer); fireEvent.click(screen.getByTestId('survive-next')) }
    await flush()
    expect(fail).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('survive-done')).toBeInTheDocument()
    expect(screen.queryByTestId('survive-level')).toBeNull()
    expect(screen.getByTestId('survive-not-saved')).toHaveTextContent('You are signed out, so this run\'s XP did not save.')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('says the XP did not save on a server error or a malformed answer', async () => {
    for (const fetcher of [fetcherWith([], { fail: true, status: 500 }), fetcherWith([], { answer: {} }), vi.fn(() => { throw new Error('offline') })]) {
      vi.setSystemTime(SEED)
      render(<SurviveGame fetcher={fetcher} />)
      playTo(200)
      for (const q of questionsFor(S0, 200, SEED)) { answer(q, wrongOf(q)); fireEvent.click(screen.getByTestId('survive-next')) }
      await flush()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('survive-right')).toHaveTextContent('0/3')
      expect(screen.queryByTestId('survive-level')).toBeNull()
      expect(screen.getByTestId('survive-not-saved')).toHaveTextContent('This run\'s XP did not save.')
      expect(screen.getByTestId('survive-best-line')).toHaveTextContent('Your best run stands at 0 of 3.')
      cleanup()
    }
  })

  it("a late XP answer for the last run never lands on the next run's end screen", async () => {
    let settle = null
    const calls = []
    const fetcher = vi.fn((url, opts) => {
      calls.push(opts.body)
      return calls.length === 1 ? new Promise((res) => { settle = res }) : new Promise(() => {})
    })
    render(<SurviveGame fetcher={fetcher} />)
    playTo(200)
    for (const q of questionsFor(S0, 200, SEED)) { answer(q, q.answer); fireEvent.click(screen.getByTestId('survive-next')) }
    await flush()
    vi.setSystemTime(SEED + 9)
    fireEvent.click(screen.getByTestId('survive-again'))
    const S1 = dealStretch(SEED + 9)
    fireEvent.click(screen.getByTestId('survive-pick-200'))
    fireEvent.click(screen.getByTestId('survive-play'))
    fireEvent.click(screen.getByTestId('survive-skip'))
    fireEvent.click(screen.getByTestId('survive-others'))
    for (const q of questionsFor(S1, 200, SEED + 9)) { answer(q, q.answer); fireEvent.click(screen.getByTestId('survive-next')) }
    await flush()
    expect(calls.map((b) => b.run_id)).toEqual([runIdOf(SEED, 1), runIdOf(SEED + 9, 2)])
    settle({ xp_gained: 6, progress: { xp: 1006, level: 3, xp_gained: 6 } })
    await flush()
    expect(screen.getByTestId('survive-done')).toBeInTheDocument()
    expect(screen.queryByTestId('survive-level')).toBeNull()                             // run 2's answer is still out
  })

  it('a stretch that cannot be dealt is an honest empty state with a way back, never a crash or a spinner', () => {
    ctl.deal = 'throw'
    const onClose = vi.fn()
    render(<SurviveGame fetcher={fetcherWith([])} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    const empty = screen.getByTestId('survive-empty')
    expect(empty).toHaveTextContent('No stretch to play right now.')
    expect(empty).toHaveTextContent('Deal a fresh stretch, or head back to Study.')
    expect(empty.textContent).not.toMatch(BAD_TEXT)
    fireEvent.click(screen.getByTestId('survive-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    ctl.deal = 'real'
    fireEvent.click(screen.getByTestId('survive-retry'))
    expect(screen.getByTestId('survive-pick')).toBeInTheDocument()

    // questions that cannot be dealt for the pick land on the same note, not a blank screen
    ctl.questions = 'empty'
    fireEvent.click(screen.getByTestId('survive-pick-200'))
    fireEvent.click(screen.getByTestId('survive-play'))
    expect(screen.getByTestId('survive-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('survive-play')).toBeNull()
  })

  it('closed mid-draw, it stops its clock and its keys and reports nothing', async () => {
    const posts = []
    const { unmount } = render(<SurviveGame fetcher={fetcherWith(posts)} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.click(screen.getByTestId('survive-pick-500'))
    fireEvent.click(screen.getByTestId('survive-play'))
    tick(TICK_MS * 5)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: '1' })
    await flush()
    expect(posts).toHaveLength(0)
  })

  it('under reduced motion the curve is drawn at once and no clock runs', () => {
    const real = window.matchMedia
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
    try {
      render(<SurviveGame fetcher={fetcherWith([])} />)
      fireEvent.click(screen.getByTestId('survive-start'))
      fireEvent.click(screen.getByTestId('survive-pick-1000'))
      fireEvent.click(screen.getByTestId('survive-play'))
      expect(screen.getByTestId('survive-play')).toHaveAttribute('data-state', 'drawn')
      expect(screen.getByTestId('survive-final')).toHaveTextContent(dollars(pickOf(S0, 1000).final))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      window.matchMedia = real
    }
  })

  it('calls out a losing streak while it plays, and once drawn the chart reads any trade from the keys', () => {
    render(<SurviveGame fetcher={fetcherWith([])} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.click(screen.getByTestId('survive-pick-1000'))
    fireEvent.click(screen.getByTestId('survive-play'))
    // the first moment in this stretch with two or more losers in a row
    const at = Array.from({ length: S0.n }, (_, i) => i + 1).find((i) => liveAt(S0, 1000, i).streak >= 2)
    tick(TICK_MS * at)
    expect(screen.getByTestId('survive-streak')).toHaveTextContent(`${liveAt(S0, 1000, at).streak} losses in a row`)
    expect(screen.queryByTestId('survive-readout')).toBeNull()                           // nothing to read while it draws
    expect(screen.getByTestId('survive-chart').querySelector('svg')).toHaveAttribute('role', 'img')
    tick(TICK_MS * S0.n)

    const svg = screen.getByTestId('survive-chart').querySelector('svg')
    expect(svg).toHaveAttribute('role', 'slider')
    expect(screen.getByTestId('survive-readout')).toHaveTextContent('Slide along the chart, or use the arrow keys, to read any trade.')
    fireEvent.keyDown(svg, { key: 'Home' })
    expect(screen.getByTestId('survive-readout')).toHaveTextContent('Your 10% Start · the start · $100,000, at its high')
    fireEvent.keyDown(svg, { key: 'ArrowRight' })
    expect(screen.getByTestId('survive-readout')).toHaveTextContent(readoutAt(S0, 1000, 1, false))
    expect(svg).toHaveAttribute('aria-valuenow', '1')
    expect(svg).toHaveAttribute('aria-valuetext', readoutAt(S0, 1000, 1, false))
    expect(screen.getByTestId('survive-cross')).toBeInTheDocument()
    // at the low, before any question: the peak in dollars, never the fall as a percent (the depth question asks it)
    const deep = pickOf(S0, 1000).deep
    fireEvent.keyDown(svg, { key: 'End' })
    for (let k = S0.n; k > deep.lowAt; k--) fireEvent.keyDown(svg, { key: 'ArrowLeft' })
    expect(screen.getByTestId('survive-readout')).toHaveTextContent(readoutAt(S0, 1000, deep.lowAt, false))
    expect(readoutAt(S0, 1000, deep.lowAt, false)).toContain(`its peak ${dollars(deep.peak)}`)
    expect(screen.getByTestId('survive-readout').textContent).not.toContain(pct(deep.dd))
    fireEvent.blur(svg)
    expect(screen.queryByTestId('survive-cross')).toBeNull()
  })

  it('keeps every label inside the drawing and the line labels apart, on any stretch and pick, on a phone too', () => {
    const real = window.matchMedia
    const cases = [[SEED, 200, false], [SEED + 1, 1000, false], [SEED + 2, 50, false], [SEED + 3, 500, false], [SEED + 4, 100, true], [SEED + 7, 1000, true]]
    try {
    for (const [seed, bps, phone] of cases) {
      window.matchMedia = (q) => ({ matches: phone && q === '(max-width: 640px)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false } })
      vi.setSystemTime(seed)
      render(<SurviveGame fetcher={fetcherWith([])} />)
      playTo(bps)
      const s = dealStretch(seed)
      const qs = questionsFor(s, bps, seed)
      /** Every label inside the drawing, before a check and after it (the reveal adds its own marks). */
      const inside = () => {
        const svg = screen.getByTestId('survive-chart').querySelector('svg')
        const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number)
        for (const tx of svg.querySelectorAll('text')) {
          const x = Number(tx.getAttribute('x')), y = Number(tx.getAttribute('y'))
          expect(x, `${seed} ${bps} ${tx.textContent}`).toBeGreaterThanOrEqual(0)
          expect(x, `${seed} ${bps} ${tx.textContent}`).toBeLessThanOrEqual(W)
          expect(y, `${seed} ${bps} ${tx.textContent}`).toBeGreaterThanOrEqual(8)
          expect(y, `${seed} ${bps} ${tx.textContent}`).toBeLessThanOrEqual(H)
          expect(tx.textContent).not.toMatch(BAD_TEXT)
        }
      }
      for (let k = 0; k < 3; k++) {
        const svg = screen.getByTestId('survive-chart').querySelector('svg')
        const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number)
        inside()
        // the five lines on the finish and the 50% line; the depth question (second) zooms to the member's own line
        const shown = k === 1 ? [bps] : PICKS
        for (const b of PICKS) expect(!!screen.queryByTestId(`survive-end-${b}`), `${seed} ${bps} q${k + 1} ${b}`).toBe(shown.includes(b))
        const ys = shown.map((b) => Number(screen.getByTestId(`survive-end-${b}`).getAttribute('y'))).sort((a, b) => a - b)
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `${seed} ${bps}`).toBeGreaterThanOrEqual(14 - 1e-9)
        if (phone) expect(W).toBe(340)                                                   // the phone's drawing, labels at their size
        const xs = [...svg.querySelectorAll('text')].filter((tx) => /^(Start|\d+|50 trades)$/.test(tx.textContent) && tx.getAttribute('y') === String(H - B_AXIS))
        expect(xs.map((tx) => tx.textContent)).toEqual(['Start', '10', '20', '30', '40', phone ? '50' : '50 trades'])
        answer(qs[k], qs[k].answer)
        inside()
        if (k === 0) expect(screen.getByTestId('survive-streak-fall')).toHaveTextContent(`−${qs[0].answer}`)
        if (k < 2) fireEvent.click(screen.getByTestId('survive-next'))
      }
      cleanup()
    }
    } finally {
      window.matchMedia = real
    }
  })

  it("the last trade lands with the verdict's feel, once: success when the pick survived, the warning when it fell past 50%", () => {
    for (const bps of [200, 1000]) {
      ctl.cues = []
      vi.setSystemTime(SEED)                                                             // the fake clock moved on: deal S0 again
      render(<SurviveGame fetcher={fetcherWith([])} />)
      fireEvent.click(screen.getByTestId('survive-start'))
      fireEvent.click(screen.getByTestId(`survive-pick-${bps}`))
      fireEvent.click(screen.getByTestId('survive-play'))
      tick(TICK_MS * 49)
      expect(ctl.cues).toEqual([])
      tick(TICK_MS * 5)
      expect(ctl.cues).toEqual([verdictOf(pickOf(S0, bps)) === 'survived'])
      fireEvent.keyDown(screen.getByTestId('survive-chart').querySelector('svg'), { key: 'Home' })   // a re-render fires nothing more
      expect(ctl.cues).toHaveLength(1)
      cleanup()
    }
    expect(verdictOf(pickOf(S0, 200))).toBe('survived')
    expect(verdictOf(pickOf(S0, 1000))).not.toBe('survived')
  })

  it('draws the 50% line half the running peak below while a 10% curve plays', () => {
    render(<SurviveGame fetcher={fetcherWith([])} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.click(screen.getByTestId('survive-pick-1000'))
    fireEvent.click(screen.getByTestId('survive-play'))
    tick(TICK_MS * 50)
    // the 10% curve spans enough of the chart for half its peak to sit inside it on this stretch
    const p = pickOf(S0, 1000)
    expect(Math.log2(p.high / p.low)).toBeGreaterThan(1)
    expect(screen.getByTestId('survive-half')).toHaveTextContent('50% line')
  })

  it('10% a trade that stayed above the 50% line only held this time: never a green "Survived"', async () => {
    // a stretch where the 10% curve stayed above the line (about one run in three)
    const seed = Array.from({ length: 400 }, (_, i) => SEED + i).find((sd) => survived(pickOf(dealStretch(sd), 1000)))
    const s = dealStretch(seed)
    const p = pickOf(s, 1000)
    expect(verdictOf(p)).toBe('held')
    vi.setSystemTime(seed)
    render(<SurviveGame fetcher={fetcherWith([])} />)
    fireEvent.click(screen.getByTestId('survive-start'))
    fireEvent.click(screen.getByTestId('survive-pick-1000'))
    fireEvent.click(screen.getByTestId('survive-play'))
    tick(TICK_MS * 50)
    const chip = screen.getByTestId('survive-verdict')
    expect(chip).toHaveAttribute('data-verdict', 'held')
    expect(chip).toHaveTextContent('Held this time')
    expect(chip).not.toHaveTextContent('Survived')
    expect(screen.getByTestId('survive-line')).toHaveTextContent('It held above the 50% line this time. At 10% a trade, 7 losses in a row take 52.2% of the account.')
    expect(ctl.cues).toEqual([false])                                                    // the warning's feel, not the success's
    fireEvent.click(screen.getByTestId('survive-others'))
    for (const q of questionsFor(s, 1000, seed)) { answer(q, q.answer); fireEvent.click(screen.getByTestId('survive-next')) }
    await flush()
    expect(screen.getByTestId('survive-done')).toHaveTextContent(`Down ${pct(p.deep.dd)} at 10%`)
    expect(screen.getByTestId('survive-done')).not.toHaveTextContent('Survived at 10%')
  })

  it('a member on 10% is asked the streak at our 2% ceiling; a miss names the mistake and the review marks the 2% line', () => {
    render(<SurviveGame fetcher={fetcherWith([])} />)
    playTo(1000)
    const q = questionsFor(S0, 1000, SEED)[0]
    expect(q.at).toBe(200)
    expect(screen.getByTestId('survive-question')).toHaveTextContent(`What do ${S0.streak.length} losses in a row take at 2% a trade?`)
    const wrong = wrongOf(q, ['added', 'left', 'climb', 'fewer', 'more'])
    fireEvent.click(tileFor(q, wrong))
    fireEvent.click(screen.getByTestId('survive-check'))
    const tk = screen.getByTestId('survive-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(headlineOf(q, wrong))
    expect(screen.getByTestId('survive-takeover-why')).toHaveTextContent(whyLine(q, S0, wrong))
    fireEvent.click(screen.getByTestId('survive-takeover-go'))
    expect(screen.getByTestId('survive-mistake')).toHaveTextContent(whyLine(q, S0, wrong))
    expect(screen.getByTestId('survive-streak-fall')).toHaveTextContent(`−${q.answer}`)
    for (const st of workingOf(q, S0).steps) expect(screen.getByTestId('survive-working')).toHaveTextContent(st)
    // the member's own 10% fall is the next question: it is nowhere on this screen
    const mine = pickOf(S0, 1000)
    expect(screen.getByTestId('survive-question').textContent).not.toMatch(wholePct(pct(fallOf(mine.deep.peak, mine.deep.low))))
  })
})
