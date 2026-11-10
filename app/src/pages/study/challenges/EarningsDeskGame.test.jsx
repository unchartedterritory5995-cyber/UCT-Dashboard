/**
 * Earnings Desk rails (docs/study/GAMES.md, kind `earnings`). It registers from one export as a skill game; the start
 * arena carries the stakes and the three steps and asks for the unit's own skill session; reports come easiest first; the
 * card reads the company and the quarter off the bank's own words; a right answer posts through /attempts (the XP flows
 * there, no game run is ever posted) and takes over the screen with the answer, the XP, the lesson line and what the stock
 * did; a wrong one costs a heart and takes over with the answer and why the call was not it (the note for that pick, the
 * near thing a typed number missed by, or the working for a computed answer); the desk note then reads your call, why,
 * what the stock did, the working, the lesson line and the sources, every sentence the reveal's own; the end screen counts
 * the calls right, logs each report and fills the level bar from the attempts; the hearts end a run; an empty, thin or
 * failed draw and an answer the server did not score each say so honestly.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import EarningsDeskGame, { GAME } from './EarningsDeskGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { EARNINGS_BEST_KEY, EMPTY_LINE, FAILED_LINE, SIGNED_OUT_LINE, thinLine } from './games/earnings'

const SESSIONS = '/api/study/sessions'
const ATTEMPTS = '/api/study/attempts'
const SKILL = 'fund.earnings_desk'

// F5.08's own sources, cited the way courses_lib._source_cite writes them: {name: "<publisher>: <title>", url, quote}
const SRC = {
  finra: { name: 'FINRA: What Is Earnings Season? (Investor Insights, July 23, 2024)', url: 'https://www.finra.org/investors/insights/earnings-season' },
  nflx: { name: 'CNBC: Netflix shares crater 25% after company reports it lost subscribers for the first time in more than 10 years (Sarah Whitten, April 19, 2022)', url: 'https://www.cnbc.com/2022/04/19/netflix-nflx-earnings-q1-2022.html' },
  wmt: { name: 'CNBC: Walmart shares fall as higher costs, supply chain problems and inventories eat into profits (Melissa Repko, May 17, 2022)', url: 'https://www.cnbc.com/2022/05/17/walmart-wmt-q1-2023-earnings.html' },
  zacks: { name: 'Zacks Investment Research: Zacks Research System (Zacks Pro) report descriptions: EPS Surprises', url: 'https://www.zacks.com/zrs/report_descriptions' },
  googl: { name: 'CNBC: Alphabet shares jump 14% on earnings beat, first-ever dividend (Jennifer Elias, April 25, 2024)', url: 'https://www.cnbc.com/2024/04/25/alphabet-q1-earnings-report-2024.html' },
  nke: { name: 'CNBC: Nike shares plunge after retailer says quarterly sales will fall 10%, warns on China weakness (Gabrielle Fonrouge, June 27, 2024, updated June 28)', url: 'https://www.cnbc.com/2024/06/27/nike-nke-earnings-q4-2024.html' },
}
const cite = (s, quote) => ({ ...s, quote, accessed: '2026-11-09', tier: 1 })

// F5.08's own questions and reveals, as scripts/study/courses_lib.build_items makes them; served in this order (the deck sorts
// them easiest first, the server's order within a difficulty: Netflix, Walmart, the blank, then Alphabet's number, then Nike)
const REPORTS = [  {
    item: { id: 'ed_q09', type: 'recall', skill_id: SKILL, difficulty: 2, has_chart: false,
      prompt_json: { q: 'Alphabet, first quarter 2024: EPS $1.89. The LSEG consensus was $1.51. What was the surprise, in percent?', kind: 'fill_numeric', suffix: '%' } },
    key: 25.2, accept: ['25.2', '25.20', '25.200'],
    reveal: { why: '25.2%. $1.89 minus $1.51, divided by $1.51, times 100. A big beat.', lesson_line: 'Work every surprise in percent. Then a big company and a small one read on one scale.',
      facts: { calc: { fn: 'pct_change', args: { start: 1.51, end: 1.89 }, result: 25.2 } },
      depth: { sources: [cite(SRC.googl, 'Earnings per share: $1.89 vs. $1.51 expected'), cite(SRC.zacks, 'the difference between actual and estimated EPS, divided by the estimated EPS')] } },
  },
  {
    item: { id: 'ed_q14', type: 'scenario', skill_id: SKILL, difficulty: 2, has_chart: false,
      prompt_json: { q: 'Which line in this report worries you most?', kind: 'mcq',
        story: 'Nike, fiscal Q4 2024: adjusted EPS $1.01 vs 83 cents expected. Revenue $12.61 billion vs $12.84 billion expected. On the call, it guides fiscal 2025 sales down mid-single digits. Analysts expected a 0.9% rise.',
        choices: ['The full-year sales guide', 'The EPS line', 'The revenue miss', 'Nothing: EPS beat'] } },
    key: 'The full-year sales guide',
    reveal: { why: 'The full-year sales guide. Analysts saw the year growing 0.9%, and Nike guided to a drop. Guidance looks ahead and often sets the near-term price. Shares plunged nearly 20% the next day.',
      lesson_line: 'Read the guide before you celebrate the beat. The beat is last quarter; the guide is the year ahead.',
      wrong: { 'The EPS line': "It beat: $1.01 against 83 cents expected. And it's the quarter just gone.", 'The revenue miss': "It matters, but it's one quarter. The guide marks down the whole year ahead.", 'Nothing: EPS beat': "A beat doesn't cancel a weak outlook. CNBC tied the plunge to the guidance cut." },
      depth: { sources: [cite(SRC.nke, 'Nike shares plunged nearly 20% on Friday')] } },
  },
  {
    item: { id: 'ed_q01', type: 'recall', skill_id: SKILL, difficulty: 1, has_chart: false,
      prompt_json: { q: 'Netflix, first quarter 2022: EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?', kind: 'mcq', choices: ['A beat', 'A miss', 'In line'] } },
    key: 'A beat',
    reveal: { why: 'A beat. $3.53 is well above the $2.89 consensus, and actual above the estimate is a beat.',
      lesson_line: 'Actual against the consensus. Above is a beat, below is a miss, equal is in line.',
      wrong: { 'A miss': 'A miss means actual came in below the estimate. $3.53 is above $2.89.', 'In line': 'In line means actual equals the estimate. $3.53 and $2.89 are far apart.' },
      depth: { sources: [cite(SRC.nflx, 'Earnings per share: $3.53 vs. $2.89 expected, according to a Refinitiv survey of analysts'), cite(SRC.finra, 'A company beats (exceeds) the estimate or misses (falls short of) the estimate')] } },
  },
  {
    item: { id: 'ed_q02', type: 'recall', skill_id: SKILL, difficulty: 1, has_chart: false,
      prompt_json: { q: "Walmart, first quarter of fiscal 2023: adjusted EPS of $1.30 against $1.48 expected. That's a beat.", kind: 'tf', choices: ['True', 'False'] } },
    key: 'False',
    reveal: { why: "False. $1.30 is below the $1.48 estimate, so it's a miss. CNBC called it a miss by a wide margin.",
      lesson_line: 'Below the consensus is a miss. Get the direction right before anything else.',
      depth: { sources: [cite(SRC.wmt, 'Adjusted earnings per share: $1.30 vs. $1.48 expected')] } },
  },
  {
    item: { id: 'ed_q03', type: 'recall', skill_id: SKILL, difficulty: 1, has_chart: false,
      prompt_json: { q: 'Tap the word that fits the blank.', kind: 'fill', sentence: 'Actual EPS minus the consensus, divided by the consensus, times 100, is the earnings ___ in percent.', bank: ['surprise', 'margin', 'guidance', 'growth', 'multiple'] } },
    key: 'surprise',
    reveal: { why: 'Surprise. Zacks works it as actual minus consensus, over the consensus, times 100. Positive is a beat, negative a miss.',
      lesson_line: 'The surprise in percent puts a beat at Netflix and a miss at Walmart on the same scale.',
      depth: { sources: [cite(SRC.zacks, 'Positive values indicate a positive surprise')] } },
  },

]
const BY_ID = Object.fromEntries(REPORTS.map((c) => [c.item.id, c]))
const norm = (v) => String(v).trim().toLowerCase()

/** The server, shaped as the routes answer: the skill session, each answer scored against a key the browser never saw
 *  (a typed number compared as a value, as study_scoring.score_exact does), the reveal, and the XP with the member's
 *  running total. */
function makeFetcher({ items = REPORTS.map((c) => c.item), poolError = null, attempt = null } = {}) {
  const calls = []
  let xp = 990
  let seq = 100
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url, body: opts.body })
    if (url === SESSIONS) { if (poolError) throw poolError; return { session_id: 'sess-e', kind: 'skill', items } }
    if (url === ATTEMPTS) {
      if (attempt) { const out = attempt(opts.body, calls.filter((c) => c.url === ATTEMPTS).length); if (out !== undefined) return out }
      const c = BY_ID[opts.body.item_id]
      const got = opts.body.answer.choice
      const correct = typeof c.key === 'number' ? Math.abs(Number(got) - c.key) < 1e-9 : norm(got) === norm(c.key)
      const gained = correct ? 10 : 2
      xp += gained
      return {
        attempt_id: (seq += 1), item_id: c.item.id, correct, score: correct ? 1 : 0, unscored: false,
        reveal: { unit: 'F5.08', ...c.reveal, lesson: `${c.reveal.why} ${c.reveal.lesson_line}`, answer: { answer: c.key, ...(c.accept ? { accept: c.accept } : {}) }, sym: null, asof: null, ref: 'abc123' },
        progress: { xp_gained: gained, xp, level: 2, streak: 1, badges_new: [] }, skill: {},
      }
    }
    throw new Error(`unexpected ${url}`)
  })
  fn.calls = calls
  return fn
}

const tiles = () => within(screen.getByTestId('earnings-cards')).getAllByRole('button')
const labelOf = (b) => b.textContent.replace(/^\d/, '').trim()
const tile = (label) => tiles().find((b) => labelOf(b) === label)
const posts = (fetcher) => fetcher.calls.filter((c) => c.url === ATTEMPTS).map((c) => c.body)

async function begin(fetcher, props = {}) {
  render(<EarningsDeskGame fetcher={fetcher} onClose={() => {}} {...props} />)
  const go = await screen.findByTestId('earnings-start')
  await waitFor(() => expect(go).not.toBeDisabled())
  fireEvent.click(go)
  return screen.findByTestId('earnings-play')
}
/** Pick a tile by its label, Check, and wait for the verdict. */
async function answerTile(label) {
  await screen.findByTestId('earnings-cards')
  fireEvent.click(tile(label))
  fireEvent.click(screen.getByTestId('earnings-check'))
  return screen.findByTestId('earnings-takeover')
}
async function answerNumber(text) {
  fireEvent.change(screen.getByTestId('earnings-number'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('earnings-check'))
  return screen.findByTestId('earnings-takeover')
}
const openNote = () => fireEvent.click(screen.getByTestId('earnings-takeover-go'))
const nextReport = () => fireEvent.click(screen.getByTestId('earnings-next'))
const NO_DASH_NO_FIRM = /[—–]|\bthe firm\b/i

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('EarningsDeskGame', () => {
  it('registers from one export as a skill game, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'earnings', title: 'Earnings Desk', sub: expect.any(String), icon: 'earnings', plate: 'Desk', accent: 'gold', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(NO_DASH_NO_FIRM)
  })

  it('opens on the arena with the stakes and the three steps, and asks for the unit’s skill session', async () => {
    const fetcher = makeFetcher()
    render(<EarningsDeskGame fetcher={fetcher} onClose={() => {}} />)
    const intro = screen.getByTestId('earnings-intro')
    expect(intro).toHaveTextContent('Earnings Desk')
    expect(intro).toHaveTextContent('reports')
    expect(intro).toHaveTextContent('hearts')
    expect(intro).toHaveTextContent('try each')
    expect(intro).toHaveTextContent('Real quarters from real companies')
    expect(screen.getByTestId('earnings-start')).toHaveTextContent('Pulling the reports')
    const howto = screen.getByTestId('earnings-howto')
    expect(howto).toHaveTextContent('Read the report')
    expect(howto).toHaveTextContent('Make the call')
    expect(howto).toHaveTextContent('Three hearts')
    await waitFor(() => expect(screen.getByTestId('earnings-start')).not.toBeDisabled())
    expect(screen.getByTestId('earnings-start')).toHaveTextContent('Open the desk')
    expect(screen.getByTestId('earnings-pool-line')).toHaveTextContent('5 reports on the desk')
    const draw = fetcher.calls.filter((c) => c.url === SESSIONS)
    expect(draw).toHaveLength(1)
    expect(draw[0].body).toEqual({ kind: 'skill', skill_id: SKILL, size: 8 })
    expect(intro.textContent).not.toMatch(NO_DASH_NO_FIRM)
  })

  it('a right answer: the card reads the company and the quarter, the answer posts through /attempts, the verdict takes over with the XP and the lesson, the desk note reads why and the sources', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    // report 1 is easiest: Netflix, first quarter 2022, read off the front of the bank's own question
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Netflix')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('First quarter 2022')
    expect(screen.getByTestId('earnings-question')).toHaveTextContent('EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?')
    expect(screen.getByTestId('earnings-report')).toHaveTextContent('Report 1')
    expect(screen.getByTestId('earnings-report')).toHaveTextContent('Beat or miss')
    expect(screen.getByTestId('earnings-step')).toHaveTextContent('report 1 of 5')
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByText('Make the call.')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-play')).toHaveTextContent('Report 1 of 5 · Beat or miss · Netflix · First quarter 2022')
    expect([...tiles().map(labelOf)].sort()).toEqual(['A beat', 'A miss', 'In line'])
    expect(screen.getByTestId('earnings-check')).toBeDisabled()
    const takeover = await answerTile('A beat')
    expect(posts(fetcher)[0]).toMatchObject({ item_id: 'ed_q01', answer: { choice: 'A beat' }, session_id: 'sess-e' })
    expect(typeof posts(fetcher)[0].time_ms).toBe('number')
    expect(takeover).toHaveAttribute('data-correct', '1')
    expect(takeover).toHaveTextContent('Called it.')
    expect(takeover).toHaveTextContent('A beat')
    expect(takeover).toHaveTextContent('+10 XP')
    expect(screen.getByTestId('earnings-takeover-line')).toHaveTextContent('Actual against the consensus. Above is a beat, below is a miss, equal is in line.')
    expect(screen.queryByTestId('earnings-takeover-hearts')).toBeNull()
    openNote()
    expect(screen.queryByTestId('earnings-takeover')).toBeNull()
    const note = screen.getByTestId('earnings-note')
    expect(note).toHaveTextContent('Report 1 · the desk note · Netflix · First quarter 2022')
    expect(screen.getByTestId('earnings-note-answer')).toHaveTextContent('A beat')
    expect(note).toHaveTextContent('Called right')
    // why, without the verdict the title already shows; nothing about the stock in this reveal, so no such block
    expect(screen.getByTestId('earnings-why')).toHaveTextContent(/^Why\$3\.53 is well above the \$2\.89 consensus, and actual above the estimate is a beat\.$/)
    expect(within(note).queryByTestId('earnings-stock')).toBeNull()
    expect(within(note).queryByTestId('earnings-call')).toBeNull()
    expect(screen.getByTestId('earnings-line')).toHaveTextContent('Actual against the consensus.')
    const sources = screen.getByTestId('earnings-sources')
    expect(sources).toHaveTextContent('The sources')
    expect(within(sources).getByRole('link', { name: 'FINRA: What Is Earnings Season?' })).toHaveAttribute('href', SRC.finra.url)
    expect(within(sources).getByRole('link', { name: /^CNBC: Netflix shares crater 25%/ })).toHaveAttribute('href', SRC.nflx.url)
    expect(screen.getByTestId('earnings-evidence')).toHaveTextContent('Earnings per share: $3.53 vs. $2.89 expected')
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
    expect(tile('A beat')).toHaveAttribute('data-state', 'right')
    expect(screen.getByTestId('earnings-next')).toHaveTextContent('Next report')
    expect(note.textContent).not.toMatch(NO_DASH_NO_FIRM)
  })

  it('a wrong answer: a heart goes, the verdict teaches with the note the bank keeps for that very pick, and the desk note shows the call', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    const takeover = await answerTile('A miss')
    expect(takeover).toHaveAttribute('data-correct', '0')
    expect(takeover).toHaveTextContent('Not this one.')
    expect(takeover).toHaveTextContent('The answer')
    expect(takeover).toHaveTextContent('A beat')
    expect(screen.getByTestId('earnings-takeover-why')).toHaveTextContent('A miss means actual came in below the estimate. $3.53 is above $2.89.')
    expect(screen.getByTestId('earnings-takeover-hearts')).toHaveTextContent('2 hearts left')
    openNote()
    expect(screen.getByTestId('earnings-call')).toHaveTextContent('A miss. A miss means actual came in below the estimate. $3.53 is above $2.89.')
    expect(screen.getByTestId('earnings-note')).toHaveTextContent('Missed')
    expect(tile('A miss')).toHaveAttribute('data-state', 'wrong')
    expect(tile('A beat')).toHaveAttribute('data-state', 'right')
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '2')
    nextReport()
    // report 2: Walmart, true or false; the masthead carries the opening and the card the rest of the statement
    await screen.findByTestId('earnings-cards')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Walmart')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('First quarter of fiscal 2023')
    expect(screen.getByTestId('earnings-question')).toHaveTextContent("Adjusted EPS of $1.30 against $1.48 expected. That's a beat.")
    expect(screen.getByText('True or false?')).toBeInTheDocument()
    expect(tiles().map(labelOf)).toEqual(['True', 'False'])
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '2')
    const t2 = await answerTile('True')
    expect(t2).toHaveTextContent('False')
    // no wrong note for a true or false: why, without its opening verdict
    expect(screen.getByTestId('earnings-takeover-why')).toHaveTextContent(/^\$1\.30 is below the \$1\.48 estimate, so it's a miss\./)
    expect(screen.getByTestId('earnings-takeover-hearts')).toHaveTextContent('1 heart left')
    openNote()
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '1')
  })

  it('a number report: typed, posted as a number; a miss shows the answer and the working, and a near miss is named', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    // keyboard play: on a desktop the field takes the keys as the report opens
    expect(screen.getByTestId('earnings-number')).toHaveFocus()
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Alphabet')
    expect(screen.getByTestId('earnings-question')).toHaveTextContent('EPS $1.89. The LSEG consensus was $1.51. What was the surprise, in percent?')
    expect(screen.getByText('Work it out.')).toBeInTheDocument()
    expect(screen.getByText('Type the number, then press Enter or Check.')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-check')).toBeDisabled()
    fireEvent.change(screen.getByTestId('earnings-number'), { target: { value: '25,2' } })
    expect(screen.getByTestId('earnings-number-hint')).toHaveTextContent('Type a number, like 12.5')
    expect(screen.getByTestId('earnings-check')).toBeDisabled()
    // Enter in the field checks; 25.15 is the right working written to one more decimal, and the near note says so
    fireEvent.change(screen.getByTestId('earnings-number'), { target: { value: '25.15' } })
    fireEvent.keyDown(screen.getByTestId('earnings-number'), { key: 'Enter' })
    const takeover = await screen.findByTestId('earnings-takeover')
    expect(posts(fetcher)[3]).toMatchObject({ item_id: 'ed_q09', answer: { choice: 25.15 } })
    expect(takeover).toHaveAttribute('data-correct', '0')
    expect(takeover).toHaveTextContent('25.2%')
    expect(screen.getByTestId('earnings-takeover-why')).toHaveTextContent('Close. 25.15% rounds to 25.2%, and the answer is given to one decimal.')
    openNote()
    expect(screen.getByTestId('earnings-number-truth')).toHaveTextContent('The answer 25.2%')
    expect(screen.getByTestId('earnings-call')).toHaveTextContent('25.15%. Close. 25.15% rounds to 25.2%')
    expect(screen.getByTestId('earnings-working')).toHaveTextContent('(end − start) ÷ start × 100= (1.89 − 1.51) ÷ 1.51 × 100 = 25.2%')
    expect(screen.getByTestId('earnings-why')).toHaveTextContent(/^Why\$1\.89 minus \$1\.51, divided by \$1\.51, times 100\. A big beat\.$/)
  })

  it('a plain number miss teaches with the working, and the field plays end to end from the keyboard', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    const field = screen.getByTestId('earnings-number')
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('earnings-takeover')).toHaveAttribute('data-correct', '0')
    expect(screen.getByTestId('earnings-takeover-why')).toHaveTextContent('(end − start) ÷ start × 100 = (1.89 − 1.51) ÷ 1.51 × 100 = 25.2%')
    expect(field).not.toHaveFocus()
    // Enter, wherever the keys now land, opens the desk note, and a second Enter goes on to the next report
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Enter' })
    expect(screen.queryByTestId('earnings-takeover')).toBeNull()
    expect(screen.getByTestId('earnings-note')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-call')).toHaveTextContent(/^Your call20%$/)
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Enter' })
    expect(await screen.findByTestId('earnings-story')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-step')).toHaveTextContent('report 5 of 5')
  })

  it('a scenario report: the masthead and the report’s lines on the card; a miss shows what the stock did on the verdict and in the desk note', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    await answerNumber('25.2'); expect(screen.getByTestId('earnings-takeover')).toHaveTextContent('Called it.'); openNote(); nextReport()
    await screen.findByTestId('earnings-cards')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Nike')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Fiscal Q4 2024')
    expect(screen.getByTestId('earnings-story')).toHaveTextContent(/^Adjusted EPS \$1\.01 vs 83 cents expected\. Revenue \$12\.61 billion vs \$12\.84 billion expected\./)
    expect(screen.getByTestId('earnings-question')).toHaveTextContent('Which line in this report worries you most?')
    expect(screen.getByTestId('earnings-report')).toHaveTextContent('Read the report')
    const takeover = await answerTile('The EPS line')
    expect(screen.getByTestId('earnings-takeover-why')).toHaveTextContent("It beat: $1.01 against 83 cents expected. And it's the quarter just gone.")
    expect(screen.getByTestId('earnings-takeover-stock')).toHaveTextContent('Shares plunged nearly 20% the next day.')
    expect(takeover).toHaveTextContent('The full-year sales guide')
    openNote()
    expect(screen.getByTestId('earnings-why')).toHaveTextContent(/^WhyAnalysts saw the year growing 0\.9%, and Nike guided to a drop\. Guidance looks ahead and often sets the near-term price\.$/)
    expect(screen.getByTestId('earnings-stock')).toHaveTextContent(/^What the stock didShares plunged nearly 20% the next day\.$/)
    expect(screen.getByTestId('earnings-next')).toHaveTextContent('See the log')
  })

  it('the verdict and the desk note carry nothing the reveal did not say: every sentence and every number is the bank’s own, the member’s or the server’s', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    // every number a block shows must come from the reveal (why, the notes, the lesson, the calc, the quotes), the
    // question or the story, or be what the member typed and what the server scored it (the near note's numbers)
    const numbersIn = (text) => new Set((String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '')))
    const BLOCKS = ['earnings-takeover-line', 'earnings-takeover-why', 'earnings-takeover-stock', 'earnings-call', 'earnings-why', 'earnings-stock', 'earnings-working', 'earnings-line', 'earnings-evidence']
    const check = (id, typed = '') => {
      const c = BY_ID[id]
      const said = JSON.stringify([c.reveal, c.item.prompt_json, c.key, typed])
      const allowed = numbersIn(said)
      const sentencesOf = (text) => text.split(/(?<=[.!?])\s+(?=[A-Z$0-9"“(])/)
      const corpus = [c.reveal.why, c.reveal.lesson_line, ...Object.values(c.reveal.wrong || {}), ...(c.reveal.depth?.sources || []).map((s) => s.quote)].join(' ')
      for (const tid of BLOCKS) {
        for (const el of screen.queryAllByTestId(tid)) {
          const text = el.textContent.replace(/^(Why|What the stock did|The working|The lesson|Your call|Read the filings and the reports)/, '')
          for (const n of numbersIn(text)) expect(allowed, `${id} ${tid}: ${n} in "${text}"`).toContain(n)
          // a sentence of the reveal's prose is shown whole and unchanged (the working, the near note and the call are the module's own numbers, already checked)
          if (['earnings-why', 'earnings-stock', 'earnings-takeover-stock', 'earnings-line', 'earnings-takeover-line'].includes(tid)) {
            for (const s of sentencesOf(text.replace(/^[A-Z]/, (m) => m.toLowerCase()))) expect(corpus.toLowerCase(), `${id} ${tid}: "${s}"`).toContain(s.toLowerCase())
          }
        }
      }
    }
    await answerTile('A beat'); check('ed_q01'); openNote(); check('ed_q01'); nextReport()
    await answerTile('True'); check('ed_q02'); openNote(); check('ed_q02'); nextReport()
    await answerTile('surprise'); check('ed_q03'); openNote(); check('ed_q03'); nextReport()
    await answerNumber('25.15'); check('ed_q09', '25.15'); openNote(); check('ed_q09', '25.15'); nextReport()
    await answerTile('Nothing: EPS beat'); check('ed_q14'); openNote(); check('ed_q14')
    expect(screen.queryByTestId('earnings-takeover')).toBeNull()
    expect(screen.getByTestId('earnings-stock')).toHaveTextContent('Shares plunged nearly 20% the next day.')
    expect(screen.getByTestId('earnings-call')).toHaveTextContent("Nothing: EPS beat. A beat doesn't cancel a weak outlook. CNBC tied the plunge to the guidance cut.")
  })

  it('a fill report: the picked word drops into the blank, picked by its number key, checked with Enter', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    expect(screen.getByTestId('earnings-sentence')).toHaveTextContent('Actual EPS minus the consensus, divided by the consensus, times 100, is the earnings in percent.')
    expect(screen.getByText('Tap the word that fits the blank.')).toBeInTheDocument()
    expect(screen.queryByTestId('earnings-mast')).toBeNull()
    const words = tiles().map(labelOf)
    expect([...words].sort()).toEqual(['growth', 'guidance', 'margin', 'multiple', 'surprise'])
    fireEvent.keyDown(window, { key: String(words.indexOf('surprise') + 1) })
    expect(screen.getByTestId('earnings-blank')).toHaveTextContent('surprise')
    fireEvent.keyDown(window, { key: 'Enter' })
    const takeover = await screen.findByTestId('earnings-takeover')
    expect(takeover).toHaveTextContent('Called it.')
    expect(posts(fetcher)[2]).toMatchObject({ item_id: 'ed_q03', answer: { choice: 'surprise' } })
    expect(screen.getByTestId('earnings-blank')).toHaveAttribute('data-tone', 'ok')
  })

  it('a missed fill report finishes its sentence with the answer, in green', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('margin')
    expect(screen.getByTestId('earnings-takeover')).toHaveTextContent('surprise')
    openNote()
    expect(screen.getByTestId('earnings-blank')).toHaveTextContent('surprise')
    expect(screen.getByTestId('earnings-blank')).toHaveAttribute('data-tone', 'ok')
    expect(screen.getByTestId('earnings-call')).toHaveTextContent('margin')
    expect(tile('margin')).toHaveAttribute('data-state', 'wrong')
    expect(tile('surprise')).toHaveAttribute('data-state', 'right')
  })

  it('a report reports itself once: two presses of Next in one beat never skip a report', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote()
    const btn = screen.getByTestId('earnings-next')
    act(() => { btn.click(); btn.click() })
    expect(await screen.findByTestId('earnings-step')).toHaveTextContent('report 2 of 5')
    expect(screen.getByTestId('earnings-mast')).toHaveTextContent('Walmart')
  })

  it('the end: the calls right, the run log with each masthead, question, answer, reaction and lesson, the XP the attempts earned on the level bar, and never a game run', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('True'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    await answerNumber('25.2'); openNote(); nextReport()
    await answerTile('The EPS line'); openNote()
    expect(screen.getByTestId('earnings-next')).toHaveTextContent('See the log')
    nextReport()
    const done = await screen.findByTestId('earnings-done')
    expect(done).toHaveTextContent('Analyst')           // 3 of 5
    expect(done).toHaveTextContent('3 of 5 reports called right')
    expect(screen.getByTestId('earnings-right')).toHaveTextContent('3/5 right')
    expect(screen.getByTestId('earnings-end-line')).toHaveTextContent('Each report below keeps its answer, what the stock did, its lesson and its source.')
    // the kind to work on next: of the kinds missed, the lowest share right (a tie goes to the first met)
    expect(screen.getByTestId('earnings-weak-line')).toHaveTextContent('Work on next: True or false. 0 of 1 right this run.')
    const log = screen.getByTestId('run-log')
    const rows = within(log).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('Netflix · First quarter 2022')
    expect(within(rows[0]).getByTestId('earnings-log-ask')).toHaveTextContent('EPS of $3.53. The Refinitiv consensus was $2.89. How does EPS read?')
    expect(within(rows[0]).getByTestId('earnings-log-answer')).toHaveTextContent('A beat')
    expect(rows[1]).toHaveTextContent('Walmart · First quarter of fiscal 2023')
    expect(rows[1]).toHaveTextContent('you said True, it was False')
    expect(rows[1]).toHaveTextContent('Below the consensus is a miss.')
    expect(within(rows[1]).queryByTestId('earnings-log-answer')).toBeNull()
    expect(rows[2]).toHaveTextContent('Actual EPS minus the consensus, divided by the consensus, times 100, is the earnings ___ in percent.')
    expect(within(rows[3]).getByTestId('earnings-log-answer')).toHaveTextContent('25.2%')
    expect(rows[4]).toHaveTextContent('Nike · Fiscal Q4 2024')
    expect(rows[4]).toHaveTextContent('you said The EPS line, it was The full-year sales guide')
    expect(within(rows[4]).getByTestId('earnings-log-stock')).toHaveTextContent('Shares plunged nearly 20% the next day.')
    expect(within(rows[4]).getByRole('link', { name: /^CNBC: Nike shares plunge/ })).toHaveAttribute('href', SRC.nke.url)
    // XP: 10 + 2 + 10 + 10 + 2, the server's own numbers, counted up and on the level bar
    await waitFor(() => expect(screen.getByTestId('earnings-xp')).toHaveTextContent('+34 XP'))
    expect(screen.getByTestId('earnings-level')).toHaveTextContent('+34 XP this run')
    expect(fetcher.calls.filter((c) => c.url === '/api/study/game-runs')).toHaveLength(0)
    expect(screen.getByTestId('earnings-best-line')).toHaveTextContent('A new best: 3 right.')
    expect(localStorage.getItem(EARNINGS_BEST_KEY)).toBe('3')
    expect(done.textContent).not.toMatch(NO_DASH_NO_FIRM)
  })

  it('a perfect run: Head of the desk, every call right, no kind to work on', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    await answerNumber('25.20'); openNote(); nextReport()
    await answerTile('The full-year sales guide')
    expect(screen.getByTestId('earnings-takeover-line')).toHaveTextContent('Read the guide before you celebrate the beat.')
    expect(screen.getByTestId('earnings-takeover-stock')).toHaveTextContent('Shares plunged nearly 20% the next day.')
    openNote(); nextReport()
    const done = await screen.findByTestId('earnings-done')
    expect(done).toHaveTextContent('Head of the desk')
    expect(screen.getByTestId('earnings-end-line')).toHaveTextContent('Every call right.')
    expect(screen.queryByTestId('earnings-weak-line')).toBeNull()
    expect(posts(fetcher)).toHaveLength(5)
  })

  it('the hearts end a run: three misses and the desk closes on Out of hearts', async () => {
    const fetcher = makeFetcher()
    const onClose = vi.fn()
    await begin(fetcher, { onClose })
    await answerTile('In line'); openNote(); nextReport()
    await answerTile('True'); openNote(); nextReport()
    await answerTile('growth')
    expect(screen.getByTestId('earnings-takeover-hearts')).toHaveTextContent('Out of hearts')
    openNote()
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '0')
    expect(screen.getByTestId('earnings-next')).toHaveTextContent('See the log')
    nextReport()
    const done = await screen.findByTestId('earnings-done')
    expect(done).toHaveTextContent('Out of hearts')
    expect(screen.getByTestId('earnings-end-line')).toHaveTextContent('The hearts ran out on report 3 of 5.')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(3)
    expect(posts(fetcher)).toHaveLength(3)
    // nothing right and no best before: no "your best run stands at 0"
    expect(screen.queryByTestId('earnings-best-line')).toBeNull()
    fireEvent.click(within(done).getByRole('button', { name: 'Back to Study' }))
    expect(onClose).toHaveBeenCalled()
    // Open new reports draws a fresh session
    fireEvent.click(screen.getByTestId('earnings-again'))
    await waitFor(() => expect(fetcher.calls.filter((c) => c.url === SESSIONS)).toHaveLength(2))
    expect(await screen.findByTestId('earnings-intro')).toBeInTheDocument()
  })

  it('a third miss on the last report finishes the run: it earns its rank, not "Out of hearts"', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('True'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    await answerNumber('30'); openNote(); nextReport()
    await answerTile('The revenue miss')
    expect(screen.getByTestId('earnings-takeover-hearts')).toHaveTextContent('Out of hearts')
    openNote(); nextReport()
    const done = await screen.findByTestId('earnings-done')
    expect(done).toHaveTextContent('Junior analyst')   // 2 of 5
    expect(done).toHaveTextContent('2 of 5 reports called right')
    expect(screen.getByTestId('earnings-end-line')).not.toHaveTextContent('hearts ran out')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(5)
  })

  it('an empty draw, and a thin one, say so honestly with a way back and never start', async () => {
    for (const [items, line, label] of [[[], EMPTY_LINE, 'No reports yet'], [REPORTS.slice(0, 2).map((c) => c.item), thinLine(2), 'Not enough reports yet']]) {
      const onClose = vi.fn()
      render(<EarningsDeskGame fetcher={makeFetcher({ items })} onClose={onClose} />)
      expect(await screen.findByTestId('earnings-empty')).toBeInTheDocument()
      expect(screen.getByTestId('earnings-empty-line')).toHaveTextContent(line)
      expect(screen.getByTestId('earnings-start')).toBeDisabled()
      expect(screen.getByTestId('earnings-start')).toHaveTextContent(label)
      // the stakes name the game's own run, never "0 reports" or "2 reports"
      expect(screen.getByTestId('earnings-empty')).toHaveTextContent('8reports')
      expect(screen.queryByTestId('earnings-howto')).toBeNull()
      fireEvent.click(screen.getByTestId('earnings-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('a draw with only walk-throughs and chart items is an empty desk, not a crash', async () => {
    const items = [
      { id: 'ed_w1', type: 'walkthrough', skill_id: SKILL, difficulty: 1, has_chart: false, prompt_json: { q: 'Two numbers, one verdict', steps: ['a', 'b'] } },
      { id: 'ed_c1', type: 'recall', skill_id: SKILL, difficulty: 1, has_chart: true, prompt_json: { q: 'What did this gap do?', kind: 'tf', choices: ['True', 'False'] } },
    ]
    render(<EarningsDeskGame fetcher={makeFetcher({ items })} onClose={() => {}} />)
    expect(await screen.findByTestId('earnings-empty')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-empty-line')).toHaveTextContent(EMPTY_LINE)
  })

  it('a draw that fails offers a retry and a way back', async () => {
    const e = new Error('POST /api/study/sessions answered 500'); e.status = 500
    const fetcher = makeFetcher({ poolError: e })
    render(<EarningsDeskGame fetcher={fetcher} onClose={() => {}} />)
    expect(await screen.findByTestId('earnings-failed')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-back')).toBeInTheDocument()
  })

  it('an answer the server did not score costs nothing: it says so, and Check sends it again', async () => {
    let fails = 1
    const fetcher = makeFetcher({ attempt: () => { if (fails > 0) { fails -= 1; const e = new Error('POST /api/study/attempts answered 500'); e.status = 500; throw e } return undefined } })
    await begin(fetcher)
    fireEvent.click(tile('A miss'))
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(await screen.findByTestId('earnings-note-line')).toHaveTextContent(FAILED_LINE)
    expect(screen.queryByTestId('earnings-takeover')).toBeNull()
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByTestId('earnings-play')).toHaveAttribute('data-state', 'ask')
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(await screen.findByTestId('earnings-takeover')).toHaveAttribute('data-correct', '0')
    expect(screen.queryByTestId('earnings-note-line')).toBeNull()
  })

  it('a number the server did not score: the field takes the keys back, and Enter sends it again', async () => {
    let failed = false
    const fetcher = makeFetcher({ attempt: (body) => {
      if (body.item_id === 'ed_q09' && !failed) { failed = true; throw Object.assign(new Error('POST /api/study/attempts answered 500'), { status: 500 }) }
      return undefined
    } })
    await begin(fetcher)
    await answerTile('A beat'); openNote(); nextReport()
    await answerTile('False'); openNote(); nextReport()
    await answerTile('surprise'); openNote(); nextReport()
    const field = screen.getByTestId('earnings-number')
    fireEvent.change(field, { target: { value: '25.2' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('earnings-note-line')).toHaveTextContent(FAILED_LINE)
    expect(field).toHaveFocus()
    expect(field).toHaveValue('25.2')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('earnings-takeover')).toHaveAttribute('data-correct', '1')
    expect(posts(fetcher).filter((p) => p.item_id === 'ed_q09')).toHaveLength(2)
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
  })

  it('a reply with no verdict is not read as a miss, and a signed-out answer says so', async () => {
    let n = 0
    const out = Object.assign(new Error('401'), { status: 401 })
    const fetcher = makeFetcher({ attempt: () => { n += 1; if (n === 1) return { reveal: {} }; if (n === 2) throw out; return undefined } })
    await begin(fetcher, { signedOut: <span data-testid="sign-in">Sign in</span> })
    fireEvent.click(tile('A miss'))
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(await screen.findByTestId('earnings-note-line')).toHaveTextContent(FAILED_LINE)
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
    fireEvent.click(screen.getByTestId('earnings-check'))
    await waitFor(() => expect(screen.getByTestId('earnings-note-line')).toHaveTextContent(SIGNED_OUT_LINE))
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
    expect(screen.getByTestId('earnings-hearts')).toHaveAttribute('data-left', '3')
  })

  it('signed out in the product (no sign-in of its own): a way to sign in that keeps the run, and Check works after', async () => {
    let n = 0
    const out = Object.assign(new Error('401'), { status: 401 })
    const fetcher = makeFetcher({ attempt: () => { n += 1; if (n === 1) throw out; return undefined } })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await begin(fetcher)
    fireEvent.click(tile('A beat'))
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(await screen.findByTestId('earnings-note-line')).toHaveTextContent(SIGNED_OUT_LINE)
    fireEvent.click(screen.getByTestId('earnings-sign-in'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatch(/^\/login\?next=/)
    expect(open.mock.calls[0][1]).toBe('_blank')
    // the pick is still there; Check sends it again and it scores
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(await screen.findByTestId('earnings-takeover')).toHaveAttribute('data-correct', '1')
    expect(screen.queryByTestId('earnings-sign-in')).toBeNull()
  })

  it('plays under StrictMode and survives an unmount with an answer on the wire', async () => {
    let release
    const fetcher = makeFetcher({ attempt: () => new Promise((r) => { release = r }) })
    const view = render(<StrictMode><EarningsDeskGame fetcher={fetcher} onClose={() => {}} /></StrictMode>)
    const go = await screen.findByTestId('earnings-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    await screen.findByTestId('earnings-cards')
    fireEvent.click(tile('A beat'))
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(screen.getByTestId('earnings-check')).toHaveTextContent('Checking')
    expect(screen.getByTestId('earnings-report')).toHaveTextContent('Checking')
    // a second press while checking posts nothing more
    fireEvent.click(screen.getByTestId('earnings-check'))
    expect(posts(fetcher)).toHaveLength(1)
    view.unmount()
    await act(async () => { release({ correct: true, reveal: {}, progress: { xp_gained: 10, xp: 1000 } }) })
  })
})
