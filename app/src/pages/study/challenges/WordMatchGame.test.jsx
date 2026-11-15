/**
 * Word Match rails (docs/study/GAMES.md §1 rule 6): the start arena with its stakes, its three steps, the best on this
 * device and the draw (the pool, and each pair checked against its own question so "timeframe" is never paired with
 * "True"); a right pair by tap or by key, either way round, locking gold then fading to an empty slot; a wrong pair
 * shaking red, adding three seconds, then taking over the screen with both pairs whole and the unit they come from,
 * the clock held until the member is back on the board; the round breaks; the end screen with the time, the misses,
 * the best and every pair; the run reported once to POST /api/study/game-runs and the level bar on the server's answer,
 * or a note that the XP did not save; a thin, empty, failed, refused or silent draw shown honestly with a way back; a
 * hidden page holding the clock; StrictMode; an unmount mid-run; a phone. Time is faked, so the seed (Date.now() at
 * start) and the whole deal are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import WordMatchGame, { GAME } from './WordMatchGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import {
  EMPTY_LINE, MATCH_END_BEAT_MS, MATCH_ITEM_URL, MATCH_LOCK_MS, MATCH_MISS_FLASH_MS, MATCH_POOL_URL, MATCH_ROUND_GAP_MS,
  MATCH_RUNS_URL, MATCH_TAKEOVER_GUARD_MS, MEANING_KEYS, pairOf, pairsOf, planRounds, startRun, unitOf, verifyPairs,
} from './games/wordMatch'

const SEED = 1731100000000
// real vocabulary pairs and their real questions (docs/study/courses/V)
const GOOD = [
  ['wm_up', 'uptrend', 'On a chart, what makes an uptrend?', 'Higher highs and higher lows', 'vocab.chart_terms'],
  ['wm_sup', 'support', 'On a chart, what is support?', 'Where buyers tend to stop a fall', 'vocab.chart_terms'],
  ['wm_bo', 'breakout', 'What is a breakout?', 'A move through resistance or support', 'vocab.chart_terms'],
  ['wm_pb', 'pullback', 'What is a pullback?', 'A short dip inside an uptrend', 'vocab.chart_terms'],
  ['wm_doji', 'doji', 'In candle terms, what is a doji?', 'Open and close about equal', 'vocab.candle_terms'],
  ['wm_ham', 'hammer', 'What makes a candle a hammer?', 'Long lower shadow after a decline', 'vocab.candle_terms'],
  ['wm_in', 'inside day', 'What is an inside day?', 'High and low inside the prior range', 'vocab.candle_terms'],
  ['wm_mkt', 'Market order', 'What does a market order tell your broker?', 'Trade now at the best price available', 'vocab.order_terms'],
  ['wm_slip', 'Slippage', 'What is slippage on a trade?', 'Your fill vs. the price you expected', 'vocab.order_terms'],
  ['wm_sq', 'Short squeeze', 'What is a short squeeze?', 'Shorts rushing to cover lift the price', 'vocab.order_terms'],
  ['wm_dd', 'Drawdown', 'What is a drawdown?', 'A drop from a peak to a low', 'vocab.risk_terms'],
  ['wm_heat', 'Portfolio heat', 'What is portfolio heat?', 'Total open risk across your trades', 'vocab.risk_terms'],
  ['wm_gap', 'Gap risk', 'What is gap risk for a position with a stop?', 'Price opens past your stop', 'vocab.risk_terms'],
  ['wm_eps', 'EPS', 'What does EPS mean?', 'Net income per share', 'vocab.fund_terms'],
  ['wm_float', 'Float', 'What does float mean for a stock?', 'Shares free for the public to trade', 'vocab.fund_terms'],
  ['wm_fomo', 'FOMO', 'In trading talk, what does FOMO stand for?', 'Fear of missing out', 'vocab.psych_terms'],
  ['wm_anch', 'Anchoring', 'What is anchoring?', 'Over-relying on the first number you saw', 'vocab.psych_terms'],
  ['wm_win', 'Win rate', 'What is win rate?', 'Share of trades that made money', 'vocab.process_terms'],
]
// what the pool can also hold (games/wordMatch.js): none of it may ever reach the board
const BAD = {
  tf: { id: 'wm_tf', term: 'timeframe', meaning: 'True' },
  rb: { id: 'wm_rb', term: 'rounding bottom', meaning: 'The weekly chart' },
  ec: { id: 'wm_ec', term: 'Earnings call', meaning: 'The earnings call' },
  n: { id: 'wm_n', term: 'Morning star', meaning: '3' },
  dup: { id: 'wm_dup', term: 'Uptrend', meaning: 'Price rising over time' },
}
const poolItem = ([id, term, , meaning]) => ({ id, term, meaning })
const G = Object.fromEntries(GOOD.map((g) => [g[0], poolItem(g)]))
const POOL = [G.wm_up, BAD.tf, G.wm_sup, BAD.rb, G.wm_bo, BAD.ec, G.wm_pb, G.wm_doji, BAD.n, G.wm_ham, G.wm_in, BAD.dup,
  ...GOOD.slice(7).map(poolItem)]
const others = (meaning) => GOOD.map((g) => g[3]).filter((m) => m !== meaning).slice(0, 3)
const PROMPTS = Object.fromEntries([
  ...GOOD.map(([id, , q, meaning, skill]) => [id, { id, version: 1, type: 'recall', skill_id: skill, module: 'V', difficulty: 1, has_chart: false, tier_scale_id: null, prompt_json: { q, kind: 'mcq', choices: [meaning, ...others(meaning)] } }]),
  ['wm_rb', { id: 'wm_rb', version: 1, type: 'recall', skill_id: 'vocab.pattern_terms', has_chart: false, prompt_json: { q: 'Which chart shows a rounding bottom best?', kind: 'mcq', choices: ['The weekly chart', 'The daily chart', 'The hourly chart', 'The 5-minute chart'] } }],
])
const RUN_REPLY = { xp_gained: 26, duplicate: false, capped: false, progress: { xp_gained: 26, xp: 1026, level: 3, weekly_xp: 80, badges_new: [] }, badges_new: [] }
const err = (status) => Object.assign(new Error(`answered ${status}`), { status })

function gameFetcher({ items = POOL, prompts = PROMPTS, getFail = null, runs = null } = {}) {
  const calls = []
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url, method: opts.method, body: opts.body })
    if (url === MATCH_POOL_URL) return { kind: 'match', items }
    if (url.startsWith(`${MATCH_ITEM_URL}/`)) {
      const id = decodeURIComponent(url.slice(MATCH_ITEM_URL.length + 1))
      const st = getFail ? getFail(id) : 0
      if (st) throw err(st)
      if (!prompts[id]) throw err(404)
      return prompts[id]
    }
    if (url === MATCH_RUNS_URL) return runs ? runs(opts.body) : RUN_REPLY
    throw new Error(`unexpected ${url}`)
  })
  fn.calls = calls
  return fn
}

/** The run the component deals at SEED from this pool: the pure module's own answer, worked out the same way. */
async function dealFor(items = POOL) {
  const { pairs } = await verifyPairs(pairsOf(items), async (id) => { if (!PROMPTS[id]) throw err(404); return PROMPTS[id] })
  return startRun(planRounds(pairs), SEED, 1)
}

const flush = async () => { await act(async () => { for (let k = 0; k < 60; k++) await Promise.resolve() }) }
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const clock = () => screen.getByTestId('match-clock').textContent
const words = () => within(screen.getByTestId('match-words'))
const meanings = () => within(screen.getByTestId('match-meanings'))

function board(deal) {
  const term = (id) => pairOf(deal, id).term
  const meaning = (id) => pairOf(deal, id).meaning
  const wordTile = (id) => words().getByText(term(id), { exact: true }).closest('button')
  const meaningTile = (id) => meanings().getByText(meaning(id), { exact: true }).closest('button')
  const pairUp = (id, first = 'word') => {
    if (first === 'word') { fireEvent.click(wordTile(id)); fireEvent.click(meaningTile(id)) } else { fireEvent.click(meaningTile(id)); fireEvent.click(wordTile(id)) }
  }
  return { term, meaning, wordTile, meaningTile, pairUp }
}

async function started(fetcher, props = {}) {
  const view = render(<WordMatchGame fetcher={fetcher} {...props} />)
  await flush()
  fireEvent.click(screen.getByTestId('match-start'))
  return view
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); document.body.style.overflow = '' })

describe('WordMatchGame', () => {
  it('registers itself with a real icon, one of the landing accents and the skill group', () => {
    expect(GAME).toEqual({ kind: 'match', title: 'Word Match', sub: expect.any(String), icon: 'link', plate: 'Match', accent: 'amber', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('opens on the start arena: the stakes, the three steps, the best, and a draw checked pair by pair', async () => {
    localStorage.setItem('study.match.best.15', '45300')
    const fetcher = gameFetcher()
    render(<WordMatchGame fetcher={fetcher} />)
    expect(screen.getByTestId('match-start')).toBeDisabled()                          // the draw is still loading
    expect(screen.getByTestId('match-start')).toHaveTextContent('Loading the words')
    expect(screen.getByTestId('match-pool-line')).toHaveTextContent('Drawing the words')
    await flush()
    expect(fetcher.calls[0]).toEqual({ url: MATCH_POOL_URL, method: 'POST', body: { kind: 'match', size: 60 } })
    expect(fetcher.calls.filter((c) => c.url === MATCH_POOL_URL)).toHaveLength(1)        // one draw filled the three rounds
    // every pair the plain checks keep is checked against its own question; the true/false, the backwards item, the
    // number and the repeated word never are
    const asked = fetcher.calls.filter((c) => c.url.startsWith(`${MATCH_ITEM_URL}/`)).map((c) => c.url.split('/').pop())
    expect(asked.sort()).toEqual([...GOOD.map((g) => g[0]), 'wm_rb'].sort())
    expect(fetcher.calls.filter((c) => c.url.startsWith(`${MATCH_ITEM_URL}/`)).every((c) => c.method === 'GET')).toBe(true)
    const intro = screen.getByTestId('match-intro')
    expect(intro).toHaveTextContent('Word Match')
    expect(intro).toHaveTextContent('15pairs')
    expect(intro).toHaveTextContent('3rounds')
    expect(intro).toHaveTextContent('+3sa miss')
    expect(screen.getByTestId('match-best')).toHaveTextContent('0:45.3')
    expect(screen.getByTestId('match-pool-line')).toHaveTextContent('15 pairs in this draw · 3 rounds of 5')
    const how = screen.getByTestId('match-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the board', 'Pair them', 'Beat your time']) expect(how).toHaveTextContent(t)
    expect(how).toHaveTextContent('Three rounds against the clock.')
    expect(intro.textContent).not.toMatch(/[—–]|the firm/i)
    expect(screen.getByTestId('match-start')).toHaveTextContent('Start the clock')
    expect(screen.getByTestId('match-start')).not.toBeDisabled()
  })

  it('plays a run: right pairs either way round, two misses that teach, round breaks, and the end with the time and the XP', async () => {
    localStorage.setItem('study.match.best.15', '45300')
    const deal = await dealFor()
    const b = board(deal)
    const fetcher = gameFetcher()
    const onClose = vi.fn()
    render(<WordMatchGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    fireEvent.keyDown(window, { key: 'Enter' })                                         // Enter starts the clock
    expect(screen.getByTestId('match-play')).toBeInTheDocument()

    // round 1, as dealt: the words in one column with keys 1 to 5, the meanings in the other with A to E
    const [w0, w1, w2, w3, w4] = deal.order[0].words
    expect(words().getAllByTestId('match-word').map((t) => t.textContent)).toEqual(deal.order[0].words.map((id, i) => `${i + 1}${b.term(id)}`))
    expect(meanings().getAllByTestId('match-meaning').map((t) => t.textContent)).toEqual(deal.order[0].meanings.map((id, i) => `${MEANING_KEYS[i]}${b.meaning(id)}`))
    expect(screen.getByTestId('match-board').textContent).not.toMatch(/True|The weekly chart|The earnings call|Price rising over time/)
    expect(screen.getByTestId('match-round')).toHaveTextContent('Round 1 of 3 · 5 pairs left')
    expect(screen.getByTestId('match-step')).toHaveTextContent('pair 1 of 15')
    expect(clock()).toBe('0:00.0')
    expect(screen.getByTestId('match-watch-best')).toHaveTextContent('0:45.3')
    tick(2000)
    expect(clock()).toBe('0:02.0')

    // a right pair, word first: the word is picked, the meanings column says what comes next, the pair locks gold
    fireEvent.click(b.wordTile(w0))
    expect(b.wordTile(w0)).toHaveAttribute('data-state', 'sel')
    expect(screen.getByTestId('match-meanings')).toHaveTextContent('Now its meaning')
    fireEvent.click(b.meaningTile(w0))
    expect(b.wordTile(w0)).toHaveAttribute('data-state', 'sel')
    expect(b.wordTile(w0)).toBeDisabled()
    expect(screen.getByTestId('match-live')).toHaveTextContent(`${b.term(w0)} matched.`)
    expect(screen.getByTestId('match-step')).toHaveTextContent('pair 2 of 15')
    expect(screen.getByTestId('match-round')).toHaveTextContent('4 pairs left')
    tick(MATCH_LOCK_MS)                                                                  // then it fades to an empty slot
    expect(b.wordTile(w0)).toHaveAttribute('data-state', 'quiet')
    expect(b.meaningTile(w0)).toHaveAttribute('data-state', 'quiet')
    expect(clock()).toBe('0:02.6')
    fireEvent.click(b.wordTile(w0))                                                      // a matched tile takes no tap
    expect(screen.queryByText('Now its meaning')).toBeNull()

    // a right pair by key, meaning first: its letter, then its number
    fireEvent.keyDown(window, { key: MEANING_KEYS[deal.order[0].meanings.indexOf(w1)].toLowerCase() })
    expect(screen.getByTestId('match-words')).toHaveTextContent('Now its word')
    fireEvent.keyDown(window, { key: String(deal.order[0].words.indexOf(w1) + 1) })
    expect(screen.getByTestId('match-step')).toHaveTextContent('pair 3 of 15')

    // a wrong pair, word first: both tiles shake red, three seconds go on, the board takes no taps
    fireEvent.click(b.wordTile(w2))
    fireEvent.click(b.meaningTile(w3))
    expect(b.wordTile(w2)).toHaveAttribute('data-state', 'wrong')
    expect(b.meaningTile(w3)).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByTestId('match-play')).toHaveAttribute('data-state', 'bad')
    expect(clock()).toBe('0:05.6')
    expect(screen.getByTestId('match-penalty')).toHaveTextContent('+3s')
    expect(screen.queryByTestId('match-takeover')).toBeNull()
    fireEvent.click(b.wordTile(w4))
    expect(b.wordTile(w4)).toHaveAttribute('data-state', 'idle')
    // then the lesson takes the screen: the pair the member started from, whole, and the one it was mixed up with
    tick(MATCH_MISS_FLASH_MS)
    const tk = screen.getByTestId('match-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent('Not a pair.')
    expect(screen.getByTestId('match-why')).toHaveTextContent(`That meaning goes with ${b.term(w3)}.`)
    expect(screen.getByTestId('match-lesson-right')).toHaveTextContent(`The pair${b.term(w2)}${b.meaning(w2)}`)
    expect(screen.getByTestId('match-lesson-mixed')).toHaveTextContent(`You mixed it up with${b.term(w3)}${b.meaning(w3)}`)
    expect(screen.getByTestId('match-cost')).toHaveTextContent('+3 seconds on the clock')
    expect(screen.getByTestId('match-from')).toHaveTextContent(`From our ${unitOf(pairOf(deal, w2).skill)} unit`)
    expect(screen.getByTestId('match-takeover-go')).toHaveTextContent('Back to the board')
    expect(tk.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)
    expect(clock()).toBe('0:05.6')
    // a second tap the moment it shows never skips it; the clock waits while it shows; Enter goes back once
    fireEvent.click(screen.getByTestId('match-takeover-go'))
    expect(screen.getByTestId('match-takeover')).toBeInTheDocument()
    tick(MATCH_TAKEOVER_GUARD_MS)
    expect(clock()).toBe('0:05.6')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('match-takeover')).toBeNull()
    expect(screen.getByTestId('match-play')).toHaveAttribute('data-state', 'ask')
    expect(document.body.style.overflow).toBe('')
    tick(1000)
    expect(clock()).toBe('0:06.6')

    // the rest of round 1, then the break: the clock holds and the next round deals in
    b.pairUp(w2); b.pairUp(w3, 'meaning'); b.pairUp(w4)
    expect(screen.getByTestId('match-round-clear')).toHaveTextContent('Round 1 clear0:06.6Round 2 of 3 next')
    tick(MATCH_ROUND_GAP_MS)
    expect(screen.queryByTestId('match-round-clear')).toBeNull()
    expect(clock()).toBe('0:06.6')
    expect(screen.getByTestId('match-round')).toHaveTextContent('Round 2 of 3 · 5 pairs left')
    expect(words().getAllByTestId('match-word').map((t) => t.textContent)).toEqual(deal.order[1].words.map((id, i) => `${i + 1}${b.term(id)}`))

    // round 2: a wrong pair, meaning first, is charged to the meaning's own word
    const [x0, x1, x2, x3, x4] = deal.order[1].words
    tick(500)
    expect(clock()).toBe('0:07.1')
    fireEvent.click(b.meaningTile(x0))
    fireEvent.click(b.wordTile(x1))
    expect(clock()).toBe('0:10.1')
    tick(MATCH_MISS_FLASH_MS)
    expect(screen.getByTestId('match-why')).toHaveTextContent(`That meaning goes with ${b.term(x0)}, not ${b.term(x1)}.`)
    expect(screen.getByTestId('match-lesson-right')).toHaveTextContent(`${b.term(x0)}${b.meaning(x0)}`)
    tick(MATCH_TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('match-takeover-go'))
    expect(screen.queryByTestId('match-takeover')).toBeNull()
    for (const id of [x0, x1, x2, x3, x4]) b.pairUp(id)
    tick(MATCH_ROUND_GAP_MS)

    // round 3, clean; the clock stops on the last pair and the board clears
    tick(1500)
    for (const id of deal.order[2].words) b.pairUp(id)
    expect(screen.getByTestId('match-round-clear')).toHaveTextContent('Board clear0:11.6Every pair matched')
    tick(MATCH_END_BEAT_MS)

    // the end: the time, right on the first try, the misses, the best, every pair
    const done = screen.getByTestId('match-done')
    expect(screen.getByTestId('match-time')).toHaveTextContent('0:11.6')
    await flush()
    tick(2000)                                                                           // the XP counts up
    expect(screen.getByTestId('match-right')).toHaveTextContent('13/15')
    expect(done).toHaveTextContent('13 of 15 matched on the first try')
    expect(screen.getByTestId('match-xp')).toHaveTextContent('+26 XP')
    expect(screen.getByTestId('match-best-line')).toHaveTextContent('A new best. You beat 0:45.3.')
    expect(localStorage.getItem('study.match.best.15')).toBe('11600')
    expect(screen.getByTestId('match-miss-line')).toHaveTextContent('2 misses added 6 seconds.')
    const cards = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(cards).toHaveLength(15)
    const cardOf = (id) => cards.find((c) => c.querySelector('b')?.textContent === b.term(id))
    expect(cardOf(w2)).toHaveTextContent(`${b.meaning(w2)}Mixed up with ${b.term(w3)}`)
    expect(cardOf(x0)).toHaveTextContent(`Mixed up with ${b.term(x1)}`)
    expect(cardOf(w3)).not.toHaveTextContent('Mixed up with')                           // never charged: it was the other half
    expect(cardOf(w0)).toHaveTextContent(b.meaning(w0))
    // reported once, as a computed game; never as attempts
    expect(fetcher.calls.filter((c) => c.url === MATCH_RUNS_URL)).toEqual([{ url: MATCH_RUNS_URL, method: 'POST', body: { kind: 'match', run_id: 'match-m3988sn4-1', right: 13, total: 15 } }])
    expect(fetcher.calls.some((c) => c.url.includes('/attempts'))).toBe(false)
    expect(screen.getByTestId('match-level')).toHaveTextContent('+26 XP this run')
    expect(screen.queryByTestId('match-not-saved')).toBeNull()
    expect(done.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // Back to Study closes; Again draws fresh
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('match-again'))
    await flush()
    expect(screen.getByTestId('match-intro')).toBeInTheDocument()
    expect(fetcher.calls.filter((c) => c.url === MATCH_POOL_URL)).toHaveLength(2)
    expect(screen.getByTestId('match-best')).toHaveTextContent('0:11.6')
  })

  it('asks the pool again when the first draw comes up short, and checks no pair twice', async () => {
    const base = gameFetcher()
    let posts = 0
    const fetcher = vi.fn(async (url, opts) => {
      if (url === MATCH_POOL_URL) { posts += 1; return { kind: 'match', items: posts === 1 ? GOOD.slice(0, 8).map(poolItem) : POOL } }
      return base(url, opts)
    })
    render(<WordMatchGame fetcher={fetcher} />)
    await flush()
    await flush()
    expect(posts).toBe(2)                                                                // eight pairs fill one round: ask again
    expect(screen.getByTestId('match-pool-line')).toHaveTextContent('15 pairs in this draw · 3 rounds of 5')
    const asked = base.calls.filter((c) => c.url.startsWith(`${MATCH_ITEM_URL}/`)).map((c) => c.url.split('/').pop())
    expect(asked.length).toBeGreaterThan(8)
    expect(new Set(asked).size).toBe(asked.length)
  })

  it('drops a pick when its tile is tapped again, and moves it when another of the same side is tapped', async () => {
    const deal = await dealFor()
    const b = board(deal)
    await started(gameFetcher())
    const [w0, w1] = deal.order[0].words
    fireEvent.click(b.wordTile(w0))
    fireEvent.click(b.wordTile(w0))
    expect(b.wordTile(w0)).toHaveAttribute('data-state', 'idle')
    expect(screen.getByTestId('match-live')).toHaveTextContent('Pick dropped.')
    fireEvent.click(b.wordTile(w0))
    fireEvent.click(b.wordTile(w1))
    expect(b.wordTile(w0)).toHaveAttribute('data-state', 'idle')
    expect(b.wordTile(w1)).toHaveAttribute('data-state', 'sel')
    fireEvent.keyDown(window, { key: String(deal.order[0].words.indexOf(w1) + 1) })     // its own key drops it too
    expect(b.wordTile(w1)).toHaveAttribute('data-state', 'idle')
  })

  it('a perfect small board: the first time on it, the medal, and a run that says its XP did not save', async () => {
    const five = GOOD.slice(0, 5).map(poolItem)
    const deal = await dealFor(five)
    const b = board(deal)
    const fetcher = gameFetcher({ items: five, runs: () => { throw err(500) } })
    render(<WordMatchGame fetcher={fetcher} />)
    await flush()
    expect(screen.getByTestId('match-intro')).toHaveTextContent('5pairs')
    expect(screen.getByTestId('match-intro')).toHaveTextContent('1round')
    expect(screen.getByTestId('match-intro')).toHaveTextContent('Set your first time on this board')
    expect(screen.getByTestId('match-pool-line')).toHaveTextContent('5 pairs in this draw · 1 round of 5')
    expect(screen.getByTestId('match-howto')).toHaveTextContent('One round against the clock.')   // never "Three" on a thin draw
    fireEvent.click(screen.getByTestId('match-start'))
    expect(screen.getByTestId('match-watch')).toHaveTextContent('No best yet')
    tick(3000)
    for (const id of deal.order[0].words) b.pairUp(id)
    tick(MATCH_END_BEAT_MS)
    await flush()
    expect(screen.getByTestId('match-time')).toHaveTextContent('0:03.0')
    expect(screen.getByTestId('match-best-line')).toHaveTextContent("Your first time on this board. That's the one to beat.")
    expect(localStorage.getItem('study.match.best.5')).toBe('3000')
    expect(screen.getByTestId('match-miss-line')).toHaveTextContent('No misses. Every pair went in on the first try.')
    expect(screen.getByTestId('match-done')).toHaveTextContent('5 for 5')
    expect(screen.getByTestId('match-not-saved')).toHaveTextContent("This run's XP did not save. Your time and your best still count here.")
    expect(screen.queryByTestId('match-level')).toBeNull()
    expect(fetcher.calls.filter((c) => c.url === MATCH_RUNS_URL)).toHaveLength(1)
  })

  it('a signed-out report says so and offers the sign-in', async () => {
    const five = GOOD.slice(0, 5).map(poolItem)
    const deal = await dealFor(five)
    const b = board(deal)
    await started(gameFetcher({ items: five, runs: () => { throw err(401) } }), { signedOut: <a data-testid="sign-in" href="/login">Sign in</a> })
    for (const id of deal.order[0].words) b.pairUp(id, 'meaning')
    tick(MATCH_END_BEAT_MS)
    await flush()
    expect(screen.getByTestId('match-not-saved')).toHaveTextContent("You are signed out, so this run's XP did not save.")
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('says plainly when today\'s XP for the game is used up, and the level bar shows what was granted', async () => {
    const five = GOOD.slice(0, 5).map(poolItem)
    const deal = await dealFor(five)
    const b = board(deal)
    const capped = { xp_gained: 0, duplicate: false, capped: true, progress: { xp_gained: 0, xp: 900, level: 2, weekly_xp: 40, badges_new: [] }, badges_new: [] }
    await started(gameFetcher({ items: five, runs: () => capped }))
    for (const id of deal.order[0].words) b.pairUp(id)
    tick(MATCH_END_BEAT_MS)
    await flush()
    expect(screen.getByTestId('match-capped')).toHaveTextContent("You have earned all of today's Word Match XP. Your time and your best still count.")
    expect(screen.getByTestId('match-level')).toHaveTextContent('+0 XP this run')
    expect(screen.queryByTestId('match-not-saved')).toBeNull()
  })

  it('says so honestly when the draw cannot fill one round, with a way back', async () => {
    const notMeanings = { wm_a: { id: 'wm_a', skill_id: 'vocab.chart_terms', has_chart: false, prompt_json: { q: 'Which chart shows it best?', kind: 'mcq', choices: [] } } }
    const draws = [
      { items: [] },
      { items: null },
      { items: Object.values(BAD) },                                                    // nothing in it is a word and its meaning
      { items: GOOD.slice(0, 4).map(poolItem) },                                         // four is not a round
      { items: GOOD.slice(0, 6).map(poolItem), prompts: notMeanings },                   // every question asks something else
    ]
    for (const d of draws) {
      const onClose = vi.fn()
      render(<WordMatchGame fetcher={gameFetcher(d)} onClose={onClose} />)
      await flush()
      const empty = screen.getByTestId('match-empty')
      expect(screen.getByTestId('match-empty-line')).toHaveTextContent(EMPTY_LINE)
      expect(EMPTY_LINE).toBe('No questions in this game yet. They arrive as the courses are approved.')
      expect(screen.getByTestId('match-start')).toBeDisabled()
      expect(screen.getByTestId('match-start')).toHaveTextContent('No pairs yet')
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByTestId('match-play')).toBeNull()
      expect(empty.textContent).not.toMatch(/[—–]|the firm/i)
      fireEvent.click(screen.getByTestId('match-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('shows a failed draw with a retry and a way back, never a spinner forever', async () => {
    // the pool fails
    let fail = true
    const flaky = gameFetcher()
    const fetcher = vi.fn(async (url, opts) => { if (fail && url === MATCH_POOL_URL) throw err(500); return flaky(url, opts) })
    const onClose = vi.fn()
    render(<WordMatchGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('match-failed')).toHaveTextContent("Couldn't load the Word Match words.")
    fireEvent.click(screen.getByTestId('match-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await flush()
    expect(screen.getByTestId('match-intro')).toBeInTheDocument()
    cleanup()

    // every check fails: a load failure, never "no questions yet"
    render(<WordMatchGame fetcher={gameFetcher({ getFail: () => 500 })} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('match-failed')).toBeInTheDocument()
    expect(screen.queryByTestId('match-empty')).toBeNull()
    cleanup()

    // a draw that never answers fails at fifteen seconds
    render(<WordMatchGame fetcher={vi.fn(() => new Promise(() => {}))} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('match-start')).toHaveTextContent('Loading the words')
    tick(15000)
    expect(screen.getByTestId('match-failed')).toBeInTheDocument()
    cleanup()

    // signed out, at the pool or at a check: the sign-in, not a retry
    render(<WordMatchGame fetcher={vi.fn(async () => { throw err(401) })} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    await flush()
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
    cleanup()
    render(<WordMatchGame fetcher={gameFetcher({ getFail: (id) => (id === 'wm_bo' ? 401 : 0) })} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    await flush()
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('holds the clock while the page is hidden', async () => {
    await started(gameFetcher())
    tick(1000)
    expect(clock()).toBe('0:01.0')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    tick(5000)
    expect(clock()).toBe('0:01.0')
    hidden.mockReturnValue(false)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    tick(1000)
    expect(clock()).toBe('0:02.0')
    hidden.mockRestore()
  })

  it('runs one clock, one key handler and one report under StrictMode', async () => {
    const five = GOOD.slice(0, 5).map(poolItem)
    const deal = await dealFor(five)
    const b = board(deal)
    const fetcher = gameFetcher({ items: five })
    render(<StrictMode><WordMatchGame fetcher={fetcher} /></StrictMode>)
    await flush()
    fireEvent.click(screen.getByTestId('match-start'))
    tick(1000)
    expect(clock()).toBe('0:01.0')                                                      // one clock, not two
    const [w0, ...rest] = deal.order[0].words
    fireEvent.keyDown(window, { key: String(deal.order[0].words.indexOf(w0) + 1) })
    fireEvent.keyDown(window, { key: MEANING_KEYS[deal.order[0].meanings.indexOf(w0)] })
    expect(screen.getByTestId('match-step')).toHaveTextContent('pair 2 of 5')            // one key, one pick
    for (const id of rest) b.pairUp(id)
    tick(MATCH_END_BEAT_MS)
    await flush()
    expect(screen.getByTestId('match-time')).toHaveTextContent('0:01.0')
    expect(fetcher.calls.filter((c) => c.url === MATCH_RUNS_URL)).toHaveLength(1)
  })

  it('closed mid-run, it stops its clock, its timers and its keys, and gives the page back', async () => {
    const deal = await dealFor()
    const b = board(deal)
    const fetcher = gameFetcher()
    const { unmount } = await started(fetcher)
    const [w0, w1] = deal.order[0].words
    b.pairUp(w0)
    fireEvent.click(b.wordTile(w0 === w1 ? w0 : w1))
    fireEvent.click(b.meaningTile(deal.order[0].words[2]))                             // a miss: its flash timer is pending
    tick(MATCH_MISS_FLASH_MS)
    expect(screen.getByTestId('match-takeover')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(document.body.style.overflow).toBe('')
    tick(60000)
    fireEvent.keyDown(window, { key: '1' })
    expect(fetcher.calls.filter((c) => c.url === MATCH_RUNS_URL)).toHaveLength(0)
  })

  it('on a phone: no key caps, no key hint, and the meaning tiles still carry their whole text', async () => {
    const before = window.matchMedia
    window.matchMedia = vi.fn((q) => ({ matches: q === '(max-width: 640px)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    try {
      const deal = await dealFor()
      const b = board(deal)
      await started(gameFetcher())
      const [w0] = deal.order[0].words
      expect(b.wordTile(w0).textContent).toBe(b.term(w0))
      expect(b.meaningTile(w0).textContent).toBe(b.meaning(w0))
      expect(screen.getByTestId('match-play').textContent).not.toMatch(/Keys work too/)
    } finally {
      window.matchMedia = before
    }
  })
})
