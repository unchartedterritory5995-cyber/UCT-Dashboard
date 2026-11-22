/**
 * Spot the Mistake rails (docs/study/GAMES.md §1 rule 6): the start arena with its stakes, its three steps and the draw
 * (one skill session of F12.07's entries); the story's four lines as the tiles; a right answer scored on the server
 * (POST /api/study/attempts) that takes over the screen with the verdict, why and the XP; a miss that takes over with
 * the broken line, why and the hearts left, then lights the broken line, marks the pick and says under every line why
 * it broke the plan or why it was fine, with the lesson card; the hearts ending a run; the end screen with the run log,
 * the XP from the attempts on the level bar and never a game run posted; a story that will not split shown whole over
 * the plain tiles; a thin, failed, refused or silent draw shown honestly with a way back; an answer that never reaches
 * the server not counted; StrictMode and an unmount mid-run. Time is faked, so the seed (Date.now() at start) and the
 * deal are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import SpotMistakeGame, { GAME } from './SpotMistakeGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { EMPTY_LINE, MISTAKE_TOTAL, deckOf, fineOf, lineOf, questionsOf, whyOf } from './games/mistake'

const SEED = 1731100000000
const SESSIONS = '/api/study/sessions'
const ATTEMPTS = '/api/study/attempts'
const GAME_RUNS = '/api/study/game-runs'
const CHOICES = ['Line 1', 'Line 2', 'Line 3', 'Line 4']
const SRC = (name) => ({ name, url: 'https://www.investor.gov/page', quote: 'quoted text' })

// F12.07's own entries, as the bank builds them (scripts/study/courses_lib.build_items), with their keys and reveals
const BANK = [
  { id: 'si_q01', difficulty: 1, story: "1. Setup: a tight flag near the highs. 2. Risk: 1% of the account. 3. Entry: over yesterday's high. 4. Stop: none, I'll watch it and decide.", key: 'Line 4',
    why: "Line 4. A plan says where you get out with a loss before you get in. With no stop, the 1% in Line 2 can't be measured or held.", line: "No stop, no plan. Decide where you're wrong before you buy.",
    wrong: { 'Line 1': "Line 1 is fine. It names the setup you're trading.", 'Line 2': 'Line 2 is fine. Risking 1% is sound; a common guide is up to 1% to 2% a trade. It just needs a stop to mean anything.', 'Line 3': 'Line 3 is fine. A clear entry rule, set before you buy.' },
    source: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)' },
  { id: 'si_q02', difficulty: 1, story: '1. Bought 300 shares at $50 with a stop at $48. 2. It fell to $47.50 and I held, sure it would come back. 3. Logged the trade with the setup name. 4. Reviewed the week on Sunday.', key: 'Line 2',
    why: 'Line 2. The stop was $48. Holding through it for a feeling turns a planned loss into an open one.', line: 'The stop is an appointment, not a debate.',
    wrong: { 'Line 1': 'Line 1 is fine. A size, a price and a stop, set before the buy.', 'Line 3': 'Line 3 is fine. The setup name lets the review group the trade.', 'Line 4': 'Line 4 is fine. A weekly review is the habit.' },
    source: 'CME Group: Building a Trade Plan (CME Group education course)' },
  { id: 'si_q03', difficulty: 2, story: '1. Entry: breakout over $82 on volume. 2. Stop: $79, under the base. 3. Risk per trade: 6% of the account. 4. Trim a third at 3R.', key: 'Line 3',
    why: 'Line 3. Six percent a trade means a few losses in a row take a big bite. A common guide keeps risk to 1% to 2%.', line: 'Small risk per trade is what lets you stay in the game.',
    wrong: { 'Line 1': 'Line 1 is fine. A clear trigger.', 'Line 2': 'Line 2 is fine. The stop sits under the structure.', 'Line 4': 'Line 4 is fine. Selling into strength on a plan.' },
    source: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)' },
  { id: 'si_q04', difficulty: 2, story: '1. Watched the open for the first 30 minutes. 2. Bought the breakout at 10:05 a.m. 3. Added twice as it fell under my entry. 4. Closed the trade before the bell.', key: 'Line 3',
    why: "Line 3. Adding to a loser raises the loss and moves the average the wrong way. A plan adds to what's working, never to what isn't.", line: 'Add to winners. Never to a loser.',
    wrong: { 'Line 1': 'Line 1 is fine. Letting the open settle is a common rule.', 'Line 2': 'Line 2 is fine. A trigger and a time.', 'Line 4': 'Line 4 is fine. A day trade closed as a day trade.' },
    source: 'CME Group: Building a Trade Plan (CME Group education course)' },
  { id: 'si_q05', difficulty: 2, story: '1. Bad news hit after the close on a stock I own. 2. My reason for owning it was gone, so I chose to sell. 3. At 7:15 a.m. I sent a market order to sell, premarket. 4. Logged the news and my exit in my journal.', key: 'Line 3',
    why: "Line 3. Selling was the right call. The order wasn't. Premarket trading is thin with wide spreads, so even an exit goes in as a limit.", line: 'Right call, wrong tool. In the premarket, even an exit needs a limit order.',
    wrong: { 'Line 1': "Line 1 is fine. It's the news, not a choice.", 'Line 2': 'Line 2 is fine. When the reason for the trade is gone, getting out is sound.', 'Line 4': 'Line 4 is fine. Writing down the news and the exit is good practice.' },
    source: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)' },
  { id: 'si_q06', difficulty: 3, story: '1. Plan: buy the pullback to the 50-day. 2. It gapped up 9% on earnings instead. 3. Chased it 6% above the open so I would not miss it. 4. Stop: 2% under my entry.', key: 'Line 3',
    why: "Line 3. The plan was a pullback. Chasing a gap is a different trade with no plan behind it, and 'so I would not miss it' is the tell.", line: "I'd rather miss it than chase it.",
    wrong: { 'Line 1': 'Line 1 is fine. A plan with a level.', 'Line 2': 'Line 2 is fine. The market did what it did.', 'Line 4': 'Line 4 is fine. A stop under the entry.' },
    source: 'CME Group: Building a Trade Plan (CME Group education course)' },
  { id: 'si_q07', difficulty: 3, story: '1. Three losses before noon. 2. Doubled the size on the fourth to get it back. 3. Stopped out again. 4. Shut the platform for the day.', key: 'Line 2',
    why: 'Line 2. Sizing up to win back a loss is revenge, not a plan. The size comes from the stop and the risk, never from the mood.', line: 'Size from the stop, never from the mood.',
    wrong: { 'Line 1': 'Line 1 is fine. Losses happen.', 'Line 3': 'Line 3 is fine. The stop did its job.', 'Line 4': 'Line 4 is fine. Walking away after a bad run is the rule.' },
    source: 'CME Group: Building a Trade Plan (CME Group education course)' },
  { id: 'si_q08', difficulty: 3, story: '1. Journal: every trade with its setup and its mistake tag. 2. Weekly: win rate and average R by setup. 3. Monthly: drop the setups with no edge. 4. Skip the review in a losing month, it only hurts.', key: 'Line 4',
    why: 'Line 4. A losing month is the one to review. The review is how a losing month becomes a lesson instead of a habit.', line: 'Review the bad months hardest.',
    wrong: { 'Line 1': 'Line 1 is fine. Fixed fields, every trade.', 'Line 2': 'Line 2 is fine. Setup stats by week.', 'Line 3': 'Line 3 is fine. The monthly cut.' },
    source: 'CME Group: Building a Trade Plan (CME Group education course)' },
  { id: 'si_q09', difficulty: 1, story: '1. Marked the stop at $18.40 before the buy. 2. Sized to risk 0.5% of the account. 3. Bought at $19.10 on the trigger. 4. Moved the stop down to $17 when it got close.', key: 'Line 4',
    why: 'Line 4. Widening a stop as price nears it turns a planned loss into a bigger one. The stop was set for a reason.', line: 'A stop can move up. It never moves down.',
    wrong: { 'Line 1': 'Line 1 is fine. The stop came first.', 'Line 2': 'Line 2 is fine. A small, planned risk.', 'Line 3': 'Line 3 is fine. The entry on its trigger.' },
    source: 'SEC, Investor.gov: Trading Basics (Investor Bulletin, 2024)' },
]
// a story the splitter cannot read as four lines: the game shows it whole over the plain tiles
const PLAIN = { id: 'si_plain', difficulty: 1, story: 'My plan: 1. Buy the flag. 2. Risk 1%. 3. Stop under the low. 4. No journal entry, I will remember it.', key: 'Line 4',
  why: 'Line 4. A trade you do not write down cannot be reviewed.', line: 'Write every trade down.',
  wrong: { 'Line 1': 'Line 1 is fine.', 'Line 2': 'Line 2 is fine.', 'Line 3': 'Line 3 is fine.' }, source: 'CME Group: Building a Trade Plan (CME Group education course)' }
const BY_ID = Object.fromEntries([...BANK, PLAIN].map((b) => [b.id, b]))
const itemOf = (b) => ({ id: b.id, version: 1, type: 'scenario', skill_id: 'process.mistakes', module: 'F12', difficulty: b.difficulty, prompt_json: { q: 'Which line breaks the plan?', kind: 'mcq', story: b.story, choices: CHOICES }, tier_scale_id: null, has_chart: false })
const ITEMS = BANK.map(itemOf)
const SET = (items = ITEMS) => ({ session_id: 'sess-1', kind: 'skill', day_et: null, items, answered_item_ids: [], finished_at: null })
const revealOf = (b) => ({ unit: 'F12.07', why: b.why, lesson_line: b.line, facts: {}, depth: { summary: '', sources: [SRC(b.source)] }, wrong: b.wrong, answer: { answer: b.key }, lesson: `${b.why} ${b.line}`, ref: 'abc123' })

const flush = async () => { await act(async () => { for (let k = 0; k < 12; k++) await Promise.resolve() }) }
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const deck = (items = ITEMS) => deckOf(questionsOf(SET(items)), SEED)
const tile = (n) => screen.getByTestId(`mistake-tile-${n}`)
const shown = (d) => d.find((q) => screen.getByTestId('mistake-lines').textContent.includes(q.lines ? q.lines[0] : q.story) && BY_ID[q.id])
const keyOf = (qn) => lineOf(BY_ID[qn.id].key)
const otherOf = (qn) => (keyOf(qn) === 1 ? 2 : 1)

/** The server: the skill session, and each attempt scored against the bank's key with the XP it grants. */
function bankFetcher({ items = ITEMS, attempt = null } = {}) {
  const calls = []
  let xp = 990
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url, body: opts.body })
    if (url === SESSIONS) return SET(items)
    if (url === ATTEMPTS) {
      if (attempt) { const out = attempt(opts.body, calls.filter((c) => c.url === ATTEMPTS).length); if (out !== undefined) return out }
      const b = BY_ID[opts.body.item_id]
      const correct = opts.body.answer.choice === b.key
      const gained = correct ? 10 : 2
      xp += gained
      return { attempt_id: calls.length, item_id: b.id, correct, score: correct ? 1 : 0, unscored: false, reveal: revealOf(b), progress: { xp_gained: gained, xp, level: 3, streak: 1, badges_new: [] }, skill: {} }
    }
    throw new Error(`unexpected ${url}`)
  })
  fn.calls = calls
  return fn
}
const attempts = (fetcher) => fetcher.calls.filter((c) => c.url === ATTEMPTS)

async function startRun(fetcher, props = {}) {
  const view = render(<SpotMistakeGame fetcher={fetcher} {...props} />)
  await flush()
  fireEvent.click(screen.getByTestId('mistake-start'))
  return view
}

/** Answers the entry on screen with line `n`: tap, Check, wait for the server. */
async function answer(n) {
  fireEvent.click(tile(n))
  fireEvent.click(screen.getByTestId('mistake-check'))
  await flush()
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('SpotMistakeGame', () => {
  it('registers itself with a real icon, one of the landing accents and the skill group', () => {
    expect(GAME).toEqual({ kind: 'mistake', title: 'Spot the Mistake', sub: expect.any(String), icon: 'journal', plate: 'Mistake', accent: 'red', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[–—]|\bfirm\b/i)
  })

  it('opens on the start arena: the stakes, the three steps, the best run and the draw it asked for', async () => {
    localStorage.setItem('study.mistake.best', '6')
    const fetcher = bankFetcher()
    render(<SpotMistakeGame fetcher={fetcher} />)
    expect(screen.getByTestId('mistake-start')).toBeDisabled()                           // the draw is still loading
    expect(screen.getByTestId('mistake-start')).toHaveTextContent('Loading the entries')
    await flush()
    expect(fetcher.calls).toEqual([{ url: SESSIONS, body: { kind: 'skill', skill_id: 'process.mistakes', size: 8 } }])
    const intro = screen.getByTestId('mistake-intro')
    expect(intro).toHaveTextContent('Spot the Mistake')
    expect(intro).toHaveTextContent('8entries')
    expect(intro).toHaveTextContent('3hearts')
    expect(intro).toHaveTextContent('1line breaks a rule')
    expect(screen.getByTestId('mistake-best')).toHaveTextContent('Your best run: 6 of 8 spotted')
    expect(screen.getByTestId('mistake-pool-line')).toHaveTextContent('9 entries in this draw')
    const how = screen.getByTestId('mistake-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the entry', 'Tap the broken line', 'Three hearts']) expect(how).toHaveTextContent(t)
    expect(how).toHaveTextContent('F12.07')
    expect(intro.textContent).not.toMatch(/[–—]|the firm|undefined|NaN/i)
    expect(screen.getByTestId('mistake-start')).not.toBeDisabled()
    expect(screen.getByTestId('mistake-start')).toHaveTextContent('Open the journal')
  })

  it('plays a run: the lines are the tiles, a right answer takes over with the lesson, a miss teaches every line, the hearts end it, the run log and the XP', async () => {
    const fetcher = bankFetcher()
    const onClose = vi.fn()
    render(<SpotMistakeGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    fireEvent.keyDown(window, { key: 'Enter' })                                             // Enter opens the journal
    const d = deck()
    expect(d).toHaveLength(8)
    expect(screen.getByTestId('mistake-round')).toHaveAttribute('data-state', 'ask')
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 1 of 8')
    expect(screen.getByTestId('mistake-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByTestId('mistake-question')).toHaveTextContent('Which line breaks the plan?')

    // entry 1: the story's four lines, each a tile with its number and its own words; Check waits for a line
    const q1 = shown(d)
    expect(q1).toBe(d[0])
    expect(screen.getByTestId('mistake-entry')).toHaveAttribute('data-split', '1')
    expect(screen.queryByTestId('mistake-story')).toBeNull()
    q1.lines.forEach((text, k) => expect(tile(k + 1)).toHaveTextContent(text))
    expect(within(screen.getByTestId('mistake-lines')).getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByTestId('mistake-check')).toBeDisabled()
    expect(screen.getByTestId('mistake-check')).toHaveTextContent('Tap a line')
    // the number key picks a line and Check names it; Enter checks
    fireEvent.keyDown(window, { key: String(keyOf(q1)) })
    expect(tile(keyOf(q1))).toHaveAttribute('data-state', 'sel')
    expect(tile(keyOf(q1))).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('mistake-check')).toHaveTextContent(`Check line ${keyOf(q1)}`)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('mistake-round')).toHaveAttribute('data-state', 'checking')
    fireEvent.keyDown(window, { key: 'Enter' })                                             // a second Enter posts nothing
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)
    expect(attempts(fetcher)[0].body).toEqual({ item_id: q1.id, answer: { choice: BY_ID[q1.id].key }, time_ms: 0, session_id: 'sess-1' })
    // the answer takes over the screen: the verdict, the line, why, the lesson line and the XP
    const tk1 = screen.getByTestId('mistake-takeover')
    expect(tk1).toHaveAttribute('data-correct', '1')
    expect(tk1).toHaveTextContent('Spotted it.')
    expect(tk1).toHaveTextContent(`Line ${keyOf(q1)}`)
    expect(screen.getByTestId('mistake-takeover-why')).toHaveTextContent(whyOf(revealOf(BY_ID[q1.id])))
    expect(tk1).toHaveTextContent(BY_ID[q1.id].line)
    expect(tk1).toHaveTextContent('+10 XP')
    expect(screen.getByTestId('mistake-takeover-go')).toHaveTextContent('See the lesson')
    expect(tk1.textContent).not.toMatch(/^Line [1-4]\. /)
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    expect(screen.queryByTestId('mistake-takeover')).toBeNull()
    // the review: the broken line lit, every line with its note, the lesson card
    expect(tile(keyOf(q1))).toHaveAttribute('data-state', 'right')
    expect(screen.getByTestId(`mistake-note-${keyOf(q1)}`)).toHaveAttribute('data-broke', '1')
    expect(screen.getByTestId(`mistake-note-${keyOf(q1)}`)).toHaveTextContent('Breaks the plan')
    const fine1 = fineOf(revealOf(BY_ID[q1.id]), keyOf(q1))
    for (const n of [1, 2, 3, 4].filter((k) => k !== keyOf(q1))) {
      expect(tile(n)).toHaveAttribute('data-state', 'quiet')
      expect(screen.getByTestId(`mistake-note-${n}`)).toHaveTextContent('Fine')
      expect(screen.getByTestId(`mistake-note-${n}`)).toHaveTextContent(fine1[n])
      expect(screen.getByTestId(`mistake-note-${n}`).textContent).not.toMatch(/is fine\./)
    }
    expect(screen.getByTestId('mistake-lesson')).toHaveTextContent(BY_ID[q1.id].line)
    expect(screen.getByTestId('mistake-why')).toHaveTextContent(whyOf(revealOf(BY_ID[q1.id])))
    expect(screen.getByTestId('mistake-lesson')).toHaveTextContent('Course unit F12.07')
    expect(screen.getByTestId('mistake-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByTestId('mistake-next')).toHaveTextContent('Next entry')
    expect(screen.getByTestId('mistake-round').textContent).not.toMatch(/[–—]|the firm|undefined|NaN/i)
    fireEvent.keyDown(window, { key: 'Enter' })                                             // Enter is Next

    // entry 2: the wrong line; the answer takes over with the broken line, why and the hearts left
    const q2 = shown(d)
    expect(q2).toBe(d[1])
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 2 of 8')
    await answer(otherOf(q2))
    const tk2 = screen.getByTestId('mistake-takeover')
    expect(tk2).toHaveAttribute('data-correct', '0')
    expect(tk2).toHaveTextContent(`It was line ${keyOf(q2)}.`)
    expect(tk2).toHaveTextContent(`The answerLine ${keyOf(q2)}`)
    expect(screen.getByTestId('mistake-takeover-why')).toHaveTextContent(whyOf(revealOf(BY_ID[q2.id])))
    expect(screen.getByTestId('mistake-takeover-hearts')).toHaveTextContent('2 hearts left')
    expect(screen.getByTestId('mistake-takeover-go')).toHaveTextContent('See why')
    expect(tk2).toHaveTextContent('+2 XP')                                                 // what the server granted, as it granted it
    expect(tk2.textContent).not.toMatch(/[–—]|the firm|undefined|NaN/i)
    // a number key under the takeover changes nothing
    fireEvent.keyDown(window, { key: String(keyOf(q2)) })
    expect(attempts(fetcher)).toHaveLength(2)
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    // the review: the broken line glows, the pick is marked wrong, the other two are quiet; the notes say why
    expect(tile(keyOf(q2))).toHaveAttribute('data-state', 'right')
    expect(tile(otherOf(q2))).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByTestId(`mistake-note-${keyOf(q2)}`)).toHaveAttribute('data-broke', '1')
    expect(screen.getByTestId(`mistake-note-${keyOf(q2)}`)).toHaveTextContent(whyOf(revealOf(BY_ID[q2.id])))
    const fine2 = fineOf(revealOf(BY_ID[q2.id]), keyOf(q2))
    expect(screen.getByTestId(`mistake-note-${otherOf(q2)}`)).toHaveTextContent(fine2[otherOf(q2)])
    expect(screen.getByTestId('mistake-hearts')).toHaveAttribute('data-left', '2')
    expect(screen.getByTestId('mistake-lesson')).toHaveTextContent(BY_ID[q2.id].line)
    expect(within(screen.getByTestId('mistake-fine')).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByTestId('mistake-next'))

    // entries 3 and 4: two more misses spend the hearts; the fourth entry ends the run
    const q3 = shown(d)
    await answer(otherOf(q3))
    expect(screen.getByTestId('mistake-takeover-hearts')).toHaveTextContent('1 heart left')
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    fireEvent.click(screen.getByTestId('mistake-next'))
    const q4 = shown(d)
    await answer(otherOf(q4))
    expect(screen.getByTestId('mistake-takeover-hearts')).toHaveTextContent('Out of hearts')
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    expect(screen.getByTestId('mistake-hearts')).toHaveAttribute('data-left', '0')
    expect(screen.getByTestId('mistake-next')).toHaveTextContent('See the run')
    fireEvent.click(screen.getByTestId('mistake-next'))

    // the end screen: the run on the entries played, the log, the XP the attempts earned, no game run posted
    const done = screen.getByTestId('mistake-done')
    tick(2000)                                                                              // the XP counts up
    expect(done).toHaveTextContent('Out of hearts')
    expect(screen.getByTestId('mistake-right')).toHaveTextContent('1/4')
    expect(screen.getByTestId('mistake-xp')).toHaveTextContent('+16 XP')                   // 10 + 2 + 2 + 2
    expect(screen.getByTestId('mistake-level')).toHaveTextContent('+16 XP this run')
    expect(screen.getByTestId('mistake-best-line')).toHaveTextContent('The hearts ran out on entry 4 of 8.')
    expect(screen.getByTestId('mistake-best-line')).toHaveTextContent('A new best all the same: 1 spotted.')
    expect(screen.getByTestId('mistake-end-note')).toHaveTextContent('Each of the 3 misses below shows the line that broke the plan, and why.')
    expect(fetcher.calls.filter((c) => c.url === GAME_RUNS)).toHaveLength(0)
    expect(attempts(fetcher)).toHaveLength(4)
    const cards = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    ;[[q1, keyOf(q1)], [q2, otherOf(q2)], [q3, otherOf(q3)], [q4, otherOf(q4)]].forEach(([q, said], k) => {
      const b = BY_ID[q.id]
      expect(cards[k]).toHaveTextContent(q.lines[lineOf(b.key) - 1])                      // the broken line's own words
      expect(cards[k]).toHaveTextContent(`Line ${lineOf(b.key)} broke the plan`)
      expect(cards[k]).toHaveTextContent(`You tapped line ${said}`)
      expect(cards[k]).toHaveTextContent(b.line)
    })
    expect(localStorage.getItem('study.mistake.best')).toBe('1')
    expect(done.textContent).not.toMatch(/[–—]|the firm|undefined|NaN/i)

    // Back to Study closes; Again returns to the arena on a fresh draw
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('mistake-again'))
    await flush()
    expect(screen.getByTestId('mistake-intro')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-best')).toHaveTextContent('Your best run: 1 of 8 spotted')
    expect(fetcher.calls.filter((c) => c.url === SESSIONS)).toHaveLength(2)
  })

  it('spots all eight: every heart kept, the full run named, every attempt on the level bar', async () => {
    const fetcher = bankFetcher()
    await startRun(fetcher)
    const d = deck()
    for (let k = 0; k < MISTAKE_TOTAL; k++) {
      const q = shown(d)
      expect(q).toBe(d[k])
      await answer(keyOf(q))
      fireEvent.click(screen.getByTestId('mistake-takeover-go'))
      expect(screen.getByTestId('mistake-next')).toHaveTextContent(k === MISTAKE_TOTAL - 1 ? 'See the run' : 'Next entry')
      fireEvent.click(screen.getByTestId('mistake-next'))
    }
    const done = screen.getByTestId('mistake-done')
    tick(2000)
    expect(done).toHaveTextContent('Every mistake spotted')
    expect(screen.getByTestId('mistake-right')).toHaveTextContent('8/8')
    expect(screen.getByTestId('mistake-xp')).toHaveTextContent('+80 XP')
    expect(screen.getByTestId('mistake-level')).toHaveTextContent('+80 XP this run')
    expect(screen.getByTestId('mistake-best-line')).toHaveTextContent('Eight for eight.')
    expect(screen.getByTestId('mistake-end-note')).toHaveTextContent('No misses.')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(8)
    expect(attempts(fetcher)).toHaveLength(8)
    expect(fetcher.calls.filter((c) => c.url === GAME_RUNS)).toHaveLength(0)
  })

  it('shows a story it cannot split whole, over the plain Line tiles, and still scores the line', async () => {
    const items = [itemOf(PLAIN), ...ITEMS.slice(0, 2)]
    const fetcher = bankFetcher({ items })
    await startRun(fetcher)
    const d = deck(items)
    expect(d.map((q) => q.id)).toContain('si_plain')
    // play up to the plain entry
    while (!screen.queryByTestId('mistake-story')) {
      const q = shown(d)
      await answer(keyOf(q))
      fireEvent.click(screen.getByTestId('mistake-takeover-go'))
      fireEvent.click(screen.getByTestId('mistake-next'))
    }
    expect(screen.getByTestId('mistake-entry')).toHaveAttribute('data-split', '0')
    expect(screen.getByTestId('mistake-story')).toHaveTextContent(PLAIN.story)
    ;[1, 2, 3, 4].forEach((n) => expect(tile(n)).toHaveTextContent(`Line ${n}`))
    await answer(1)
    expect(attempts(fetcher).at(-1).body).toMatchObject({ item_id: 'si_plain', answer: { choice: 'Line 1' } })
    expect(screen.getByTestId('mistake-takeover')).toHaveTextContent('It was line 4.')
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    expect(tile(4)).toHaveAttribute('data-state', 'right')
    expect(tile(1)).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByTestId('mistake-note-4')).toHaveTextContent('A trade you do not write down cannot be reviewed.')
    expect(screen.getByTestId('mistake-note-1')).toHaveTextContent('Fine')
    expect(screen.getByTestId('mistake-note-1')).toHaveTextContent('Line 1 is fine.')      // nothing more to lift off
  })

  it('says so honestly when the draw is thin or empty, with a way back', async () => {
    for (const items of [ITEMS.slice(0, 2), [], null]) {
      const onClose = vi.fn()
      render(<SpotMistakeGame fetcher={bankFetcher({ items })} onClose={onClose} />)
      await flush()
      const empty = screen.getByTestId('mistake-empty')
      // two approved entries is thin, not empty: it says how many and when the game opens
      expect(screen.getByTestId('mistake-empty-line')).toHaveTextContent(items?.length ? 'Only 2 entries are approved so far. The game opens at 3.' : EMPTY_LINE)
      expect(screen.getByTestId('mistake-start')).toBeDisabled()
      expect(screen.getByTestId('mistake-start')).toHaveTextContent(items?.length ? 'Not enough entries yet' : 'No entries yet')
      expect(screen.queryByTestId('mistake-howto')).toBeNull()
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByTestId('mistake-round')).toBeNull()
      expect(empty.textContent).not.toMatch(/[–—]|the firm|undefined|NaN/i)
      fireEvent.click(screen.getByTestId('mistake-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('shows a failed draw with a retry and a way back, a draw that never answers fails instead of spinning, and a signed-out draw offers the sign-in', async () => {
    let fail = true
    const fetcher = vi.fn(async () => {
      if (fail) { const e = new Error('500'); e.status = 500; throw e }
      return SET()
    })
    const onClose = vi.fn()
    render(<SpotMistakeGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('mistake-failed')).toHaveTextContent("Couldn't load the Spot the Mistake entries.")
    fireEvent.click(screen.getByTestId('mistake-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await flush()
    expect(screen.getByTestId('mistake-intro')).toBeInTheDocument()
    cleanup()

    render(<SpotMistakeGame fetcher={vi.fn(() => new Promise(() => {}))} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('mistake-start')).toHaveTextContent('Loading the entries')
    tick(15000)
    expect(screen.getByTestId('mistake-failed')).toBeInTheDocument()
    cleanup()

    const out = vi.fn(async () => { const e = new Error('401'); e.status = 401; throw e })
    render(<SpotMistakeGame fetcher={out} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    await flush()
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('does not count an answer that never reaches the server, says so on the next entry, and stops after three in a row', async () => {
    const down = (body, n) => { if (n <= 4) { const e = new Error('500'); e.status = 500; throw e } }
    // the first answer hangs past the time-out; the next two fail outright
    const fetcher = bankFetcher({ attempt: (body, n) => (n === 1 ? new Promise(() => {}) : down(body, n)) })
    await startRun(fetcher)
    const d = deck()
    fireEvent.click(tile(1))
    fireEvent.click(screen.getByTestId('mistake-check'))
    expect(screen.getByTestId('mistake-check')).toHaveTextContent('Checking')
    tick(8000)                                                                              // the answer took too long
    await flush()
    expect(screen.getByTestId('mistake-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 2 of 8')
    expect(screen.getByTestId('mistake-lines')).toHaveTextContent(d[1].lines[0])
    expect(screen.getByTestId('mistake-hearts')).toHaveAttribute('data-left', '3')        // not a miss
    await answer(2)
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 3 of 8')
    await answer(3)
    expect(screen.getByTestId('mistake-done')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-offline')).toHaveTextContent('The server stopped answering, so the run ended early.')
    expect(screen.getByTestId('mistake-right')).toHaveTextContent('0/0')
    expect(screen.getByTestId('mistake-done')).toHaveTextContent('No entries this run')
    expect(screen.queryByTestId('mistake-lost')).toBeNull()
  })

  it('never reads a reply without a verdict as a miss: it is not counted, no line lights, and the run goes on', async () => {
    const fetcher = bankFetcher({ attempt: (body, n) => (n === 1 ? { reveal: revealOf(BY_ID[body.item_id]), progress: {} } : undefined) })
    await startRun(fetcher)
    const d = deck()
    await answer(otherOf(d[0]))
    expect(screen.queryByTestId('mistake-takeover')).toBeNull()
    expect(screen.getByTestId('mistake-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 2 of 8')
    for (let k = 1; k < MISTAKE_TOTAL; k++) {
      await answer(keyOf(shown(d)))
      fireEvent.click(screen.getByTestId('mistake-takeover-go'))
      fireEvent.click(screen.getByTestId('mistake-next'))
    }
    expect(screen.getByTestId('mistake-done')).toBeInTheDocument()
    tick(2000)
    expect(screen.getByTestId('mistake-right')).toHaveTextContent('7/7')
    expect(screen.getByTestId('mistake-done')).toHaveTextContent('Sharp eye')               // seven of seven is not a full run
    expect(screen.getByTestId('mistake-lost')).toHaveTextContent('1 entry could not be checked, so it does not count.')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(7)
  })

  it('stops the run when the session ends mid-run and offers the sign-in', async () => {
    const fetcher = bankFetcher({ attempt: (body, n) => { if (n === 2) { const e = new Error('401'); e.status = 401; throw e } } })
    await startRun(fetcher, { signedOut: <a data-testid="sign-in" href="/login">Sign in</a> })
    const d = deck()
    await answer(keyOf(d[0]))
    fireEvent.click(screen.getByTestId('mistake-takeover-go'))
    fireEvent.click(screen.getByTestId('mistake-next'))
    await answer(1)
    expect(screen.getByTestId('mistake-done')).toBeInTheDocument()
    expect(screen.getByTestId('mistake-signed-out')).toHaveTextContent('You are signed out, so the run stopped there.')
    expect(screen.getByTestId('mistake-right')).toHaveTextContent('1/1')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('posts one attempt per Check and one key handler under StrictMode', async () => {
    const fetcher = bankFetcher()
    render(<StrictMode><SpotMistakeGame fetcher={fetcher} /></StrictMode>)
    await flush()
    fireEvent.click(screen.getByTestId('mistake-start'))
    const d = deck()
    fireEvent.keyDown(window, { key: String(keyOf(d[0])) })
    expect(tile(keyOf(d[0]))).toHaveAttribute('data-state', 'sel')
    fireEvent.keyDown(window, { key: 'Enter' })
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)                                              // one Enter, one answer
    expect(screen.getByTestId('mistake-takeover')).toHaveTextContent('Spotted it.')
    fireEvent.keyDown(window, { key: 'Enter' })                                             // the takeover's own button
    expect(screen.queryByTestId('mistake-takeover')).toBeNull()
    fireEvent.keyDown(window, { key: 'Enter' })                                             // Next, once
    expect(screen.getByTestId('mistake-step')).toHaveTextContent('entry 2 of 8')
    expect(screen.getByTestId('mistake-lines')).toHaveTextContent(d[1].lines[0])
  })

  it('closed mid-run, it stops its timers and its keys, and a late answer changes nothing', async () => {
    const fetcher = bankFetcher()
    const { unmount } = await startRun(fetcher)
    const d = deck()
    await answer(otherOf(d[0]))
    expect(screen.getByTestId('mistake-takeover')).toBeInTheDocument()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)
    expect(document.body.style.overflow).toBe('')                                           // the takeover gave the page back

    // closed while an answer is on the wire: its time-out goes with it, and a late answer changes nothing
    let late = null
    const slow = bankFetcher({ attempt: () => new Promise((resolve) => { late = resolve }) })
    const second = await startRun(slow)
    fireEvent.click(tile(1))
    fireEvent.click(screen.getByTestId('mistake-check'))
    await flush()
    expect(screen.getByTestId('mistake-round')).toHaveAttribute('data-state', 'checking')
    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
    late({ correct: true, reveal: {}, progress: { xp: 5, xp_gained: 5 } })
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })
})
