/**
 * Sector Race rails (docs/study/GAMES.md §1 rule 6): the start arena with its stakes, its three steps and the draw (one
 * skill session of the Sector leadership questions); a right answer scored on the server (POST /api/study/attempts) that
 * runs the runner one leg and climbs the multiplier, the next question at once; a miss that takes over the screen with
 * the right answer, why, the lesson line and the source, moving on by itself or on a tap, the clock waiting while it
 * shows and while an answer is on the wire; every kind of question drawn as itself (a situation, a sentence with its
 * blank, True then False); every answer right crossing the line with its bonus; the end screen with the distance run,
 * the answers right and the log; the XP from the attempts on the level bar and never a game run posted; a thin, failed,
 * refused or silent draw shown honestly with a way back; an answer that never reaches the server not counted;
 * StrictMode and an unmount mid-race. Time is faked, so the seed (Date.now() at start) and the deal are known.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import SectorRaceGame, { GAME } from './SectorRaceGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import {
  EMPTY_LINE, RACE_CROSS_MS, TAKEOVER_GUARD_MS, TAKEOVER_MAX_MS, deckOf, missWhy, norm, questionsOf, rowOf, takeoverMs, verdictTitle,
} from './games/sectorRace'

const SEED = 1731100000000
const SESSIONS = '/api/study/sessions'
const ATTEMPTS = '/api/study/attempts'
const SRC = (name) => ({ name, url: 'https://www.sec.gov/page', quote: 'quoted text' })

// F7.09's own questions, as the bank builds them (scripts/study/courses_lib.build_items), with their keys and reveals
const BANK = [
  { id: 'si_q08', difficulty: 2, prompt: { q: 'In 2022 the S&P 500 lost 18.11%. Which sector index did best?', kind: 'mcq', choices: ['Energy', 'Utilities', 'Technology', 'Consumer Staples'] }, key: 'Energy',
    why: 'Energy, by a mile. The energy index gained 64.56%. The next best, utilities, gained 1.57%.', line: 'Even in a bad year, some group leads. In 2022 it was energy.',
    wrong: { Utilities: 'Utilities came second, up 1.57%. Energy gained 64.56%.' }, source: 'SEC EDGAR: Prospectus, January 2023: returns for periods ending 12/31/22' },
  { id: 'si_q09', difficulty: 2, prompt: { q: 'In 2022 the S&P 500 lost 18.11%. The utilities, staples and health care indexes each finished within 3% of flat.', kind: 'tf', choices: ['True', 'False'] }, key: 'True',
    why: 'True. Utilities gained 1.57%, staples lost 0.70% and health care lost 1.95%. The defensive groups held up while the market fell.', line: 'When the market falls, note which groups hold up. In 2022, energy and the defensive groups did.',
    source: 'SEC EDGAR: Prospectus, January 2023: returns for periods ending 12/31/22' },
  { id: 'si_q04', difficulty: 1, prompt: { q: 'Fill in the blank.', kind: 'fill', sentence: 'Divide a sector fund by the S&P 500 and chart it. A rising line shows relative ___.', bank: ['strength', 'weakness', 'volume', 'value'] }, key: 'strength',
    why: "Strength. The ratio rises when the sector gains more than the S&P 500, or falls less. That's relative strength.", line: 'Sector divided by the market. A rising line means the sector is leading.',
    source: 'StockCharts.com ChartSchool: Price Relative/Relative Strength' },
  // q12 cites two prospectuses as the unit does: the story's 2020 figures (first) and the 2021 gain the lines quote
  { id: 'si_q12', difficulty: 3, type: 'scenario', prompt: { q: 'How did energy do in 2021?', kind: 'mcq', story: '2020: the energy index loses 32.84% while the S&P 500 gains 18.40%. A friend says energy is finished and you should ignore it in 2021.', choices: ['It was the best sector that year', 'It fell again and kept lagging', 'It roughly matched the S&P 500'] }, key: 'It was the best sector that year',
    why: 'It was the best sector that year. The energy index gained 53.43% against 28.71% for the S&P 500. Real estate came next at 46.19%.', line: "Last year's ranking isn't this year's. Judge a group by what it's doing now.",
    wrong: { 'It fell again and kept lagging': 'The opposite. Energy finished the year up 53.43%.' }, source: 'SEC EDGAR: Prospectus, January 2022: returns for periods ending 12/31/21',
    sources: [
      { name: 'SEC EDGAR: Prospectus, January 2021: returns for periods ending 12/31/20', url: 'https://www.sec.gov/2021', quote: 'Energy Select Sector Index (reflects no deduction for fees, expenses or taxes) -32.84%' },
      { name: 'SEC EDGAR: Prospectus, January 2022: returns for periods ending 12/31/21', url: 'https://www.sec.gov/2022', quote: 'Energy Select Sector Index (reflects no deduction for fees, expenses or taxes) 53.43%' },
    ] },
  { id: 'si_q01', difficulty: 1, prompt: { q: 'GICS sorts stocks into sectors. How many sectors does it have?', kind: 'mcq', choices: ['11', '9', '25', '163'] }, key: '11',
    why: '11. GICS has four levels: 11 sectors, then 25 industry groups, 74 industries and 163 sub-industries.', line: 'Eleven sectors on top. Every S&P 500 stock sits in exactly one of them.',
    wrong: { 9: 'Nine was the number of sector SPDR funds around 2007. Today there are 11 sectors and a fund for each.' }, source: 'MSCI: Global Industry Classification Standard Methodology, April 2026' },
  { id: 'si_q15', difficulty: 2, prompt: { q: 'Utilities are defensive. In 2023 their index lost 7.08% while the S&P 500 gained 26.29%. What weighed on them?', kind: 'mcq', choices: ['High interest rates', 'Falling oil prices', 'Weak consumer spending'] }, key: 'High interest rates',
    why: 'High interest rates. Many utilities borrow heavily, and their stocks tend to move opposite to rates.', line: 'Defensive isn\'t rate-proof. When rates stay high, utilities can lag even in a strong market.',
    source: 'SEC EDGAR: Prospectus, January 2024: returns for periods ending 12/31/23' },
]
const NUMERIC = { id: 'si_q11', version: 1, type: 'recall', skill_id: 'history.sectors', module: 'F7', difficulty: 3, prompt_json: { q: 'By how many points did energy beat it?', kind: 'fill_numeric', suffix: 'points' }, tier_scale_id: null, has_chart: false }
const BY_ID = Object.fromEntries(BANK.map((b) => [b.id, b]))
const itemOf = (b) => ({ id: b.id, version: 1, type: b.type || 'recall', skill_id: 'history.sectors', module: 'F7', difficulty: b.difficulty, prompt_json: b.prompt, tier_scale_id: null, has_chart: false })
const ITEMS = [...BANK.map(itemOf), NUMERIC]
const SET = (items = ITEMS) => ({ session_id: 'sess-1', kind: 'skill', day_et: null, items, answered_item_ids: [], finished_at: null })
const revealOf = (b) => ({ unit: 'F7.09', why: b.why, lesson_line: b.line, facts: {}, depth: { summary: '', sources: b.sources || [SRC(b.source)] }, answer: { answer: b.key }, ...(b.wrong ? { wrong: b.wrong } : {}), lesson: `${b.why} ${b.line}`, ref: 'abc123' })

const flush = async () => { await act(async () => { for (let k = 0; k < 12; k++) await Promise.resolve() }) }
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })
const tile = (label) => within(screen.getByTestId('sectors-choices')).getByRole('button', { name: label })
// a tile reads its number (hidden from a screen reader), its label, and its end mark: the label is the one span not hidden
const tileLabels = () => within(screen.getByTestId('sectors-choices')).getAllByRole('button').map((t) => t.querySelector('span:not([aria-hidden])').textContent)
const rightOf = (qn) => qn.choices.find((c) => norm(c.value) === norm(BY_ID[qn.id].key))
const wrongOf = (qn) => qn.choices.find((c) => norm(c.value) !== norm(BY_ID[qn.id].key))
const missRow = (qn, said) => rowOf({ question: qn, said: said.value, correct: false, reveal: revealOf(BY_ID[qn.id]) })
const deck = (items = ITEMS) => deckOf(questionsOf(SET(items)), SEED)

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
      const correct = norm(opts.body.answer.choice) === norm(b.key)
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

async function startRace(fetcher, props = {}) {
  const view = render(<SectorRaceGame fetcher={fetcher} {...props} />)
  await flush()
  fireEvent.click(screen.getByTestId('sectors-start'))
  return view
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('SectorRaceGame', () => {
  it('registers itself with a real icon, one of the landing accents and the skill group', () => {
    expect(GAME).toEqual({ kind: 'sectors', title: 'Sector Race', sub: expect.any(String), icon: 'flag', plate: 'Sectors', accent: 'amber', group: 'skill' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(UICON_NAMES).toContain('user')                                                   // the runner's mark
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('opens on the start arena: the stakes, the three steps, the best score and the draw it asked for', async () => {
    localStorage.setItem('study.sectors.best', '210')
    const fetcher = bankFetcher()
    render(<SectorRaceGame fetcher={fetcher} />)
    expect(screen.getByTestId('sectors-start')).toBeDisabled()                               // the draw is still loading
    expect(screen.getByTestId('sectors-start')).toHaveTextContent('Loading the questions')
    await flush()
    expect(fetcher.calls).toEqual([{ url: SESSIONS, body: { kind: 'skill', skill_id: 'history.sectors', size: 10 } }])
    const intro = screen.getByTestId('sectors-intro')
    expect(intro).toHaveTextContent('Sector Race')
    expect(intro).toHaveTextContent('60seconds')
    expect(intro).toHaveTextContent('600 mtrack')                                           // six playable questions, six legs
    expect(intro).toHaveTextContent('x4top multiplier')                                     // six in a row tops out at x4, never x5
    expect(intro).toHaveTextContent('Sector leadership course')
    expect(screen.getByTestId('sectors-best')).toHaveTextContent('210')
    expect(screen.getByTestId('sectors-pool-line')).toHaveTextContent('6 questions in this draw · 6 legs of 100 m')
    const how = screen.getByTestId('sectors-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the question', 'Run a leg', 'Build the multiplier']) expect(how).toHaveTextContent(t)
    expect(how).toHaveTextContent('each second left there is worth 5 points')
    expect(how).toHaveTextContent('up to x4')
    expect(how.textContent).not.toMatch(/x5/)
    expect(intro.textContent).not.toMatch(/[—–]|the firm/i)
    expect(screen.getByTestId('sectors-start')).not.toBeDisabled()
    expect(screen.getByTestId('sectors-start')).toHaveTextContent('Start the race')
  })

  it('runs a race: a right answer runs a leg, a miss takes over and teaches, the clock waits, time ends it with the distance, the log and the XP', async () => {
    const fetcher = bankFetcher()
    const onClose = vi.fn()
    render(<SectorRaceGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    fireEvent.keyDown(window, { key: 'Enter' })                                               // Enter starts the race
    const play = screen.getByTestId('sectors-play')
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')
    expect(screen.getByTestId('sectors-track-ran')).toHaveTextContent('0 m')
    expect(screen.getByTestId('sectors-track')).toHaveAttribute('aria-label', '0 m of 600 m run, 0 right')
    const d = deck()
    expect(play).toHaveTextContent('Question 1 of 6')

    // question 1: the right tile; the clock waits while the answer is on the wire
    fireEvent.click(tile(rightOf(d[0]).label))
    expect(screen.getByTestId('sectors-play')).toHaveAttribute('data-state', 'checking')
    tick(3000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)
    expect(attempts(fetcher)[0].body).toEqual({ item_id: d[0].id, answer: { choice: rightOf(d[0]).value }, time_ms: 0, session_id: 'sess-1' })
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')
    expect(screen.getByTestId('sectors-track-ran')).toHaveTextContent('100 m')                 // one leg run
    expect(Number(screen.getByTestId('sectors-track-runner').getAttribute('data-at'))).toBeCloseTo(100 / 6, 5)
    expect(screen.getByTestId('sectors-track-gain')).toHaveTextContent('+100 m')
    expect(screen.queryByTestId('sectors-takeover')).toBeNull()
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 2 of 6')            // the next one, at once

    // two seconds of thinking cost two seconds
    tick(2000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('58s left')

    // question 2: a wrong tile; the answer takes over with the right answer, why, the lesson line and the source
    const said = wrongOf(d[1])
    fireEvent.click(tile(said.label))
    await flush()
    const row = missRow(d[1], said)
    const tk = screen.getByTestId('sectors-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(verdictTitle(row))
    if (d[1].kind !== 'tf') expect(tk).toHaveTextContent(`The answer${rightOf(d[1]).label}`)
    expect(screen.getByTestId('sectors-takeover-why')).toHaveTextContent(missWhy(row))
    expect(missWhy(row)).not.toBe('')
    expect(screen.getByTestId('sectors-takeover-line')).toHaveTextContent(BY_ID[d[1].id].line)
    expect(screen.getByTestId('sectors-takeover-source')).toHaveTextContent(BY_ID[d[1].id].source)
    expect(screen.getByTestId('sectors-takeover-go')).toHaveTextContent('Next question')
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')                          // a miss scores nothing
    expect(screen.getByTestId('sectors-track-ran')).toHaveTextContent('100 m')                 // and runs no leg
    expect(tk.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // the clock waits while it shows, and a key does nothing under it
    tick(2000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('58s left')
    fireEvent.keyDown(window, { key: '1' })
    expect(attempts(fetcher)).toHaveLength(2)
    // it holds as long as its lines take to read, then moves on by itself, once
    const hold = takeoverMs(missWhy(row), row.line)
    tick(hold - 2001)
    expect(screen.getByTestId('sectors-takeover')).toBeInTheDocument()
    tick(1)
    expect(screen.queryByTestId('sectors-takeover')).toBeNull()
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 3 of 6')
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('58s left')

    // question 3: right, by its number key; the multiplier starts again at x2
    const at = d[2].choices.indexOf(rightOf(d[2]))
    fireEvent.keyDown(window, { key: String(at + 1) })
    await flush()
    expect(attempts(fetcher)[2].body.answer).toEqual({ choice: rightOf(d[2]).value })
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('40')
    expect(screen.getByTestId('sectors-track-ran')).toHaveTextContent('200 m')
    expect(screen.getByTestId('sectors-track')).toHaveAttribute('aria-label', '200 m of 600 m run, 2 right, 1 miss')

    // time ends the race
    tick(57900)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('1s left')
    tick(100)
    const done = screen.getByTestId('sectors-done')
    tick(2000)                                                                                  // the points count up
    expect(screen.getByTestId('sectors-right')).toHaveTextContent('2/3')
    expect(screen.getByTestId('sectors-xp')).toHaveTextContent('+40 points')
    expect(done).toHaveTextContent('Solid run')
    expect(screen.getByTestId('sectors-distance')).toHaveTextContent('The clock ran out at 200 m of the 600 m track.')
    expect(screen.getByTestId('sectors-final-ran')).toHaveTextContent('200 m')
    expect(screen.getByTestId('sectors-misses')).toHaveTextContent('The miss below carries its answer, its lesson and its source.')

    // every question with the answer, the member's call, the lesson line and the source
    const cards = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    const played = [[d[0], rightOf(d[0])], [d[1], said], [d[2], rightOf(d[2])]]
    played.forEach(([qn, pick], k) => {
      const b = BY_ID[qn.id]
      expect(cards[k]).toHaveTextContent(qn.kind === 'fill' ? 'Divide a sector fund by the S&P 500' : qn.q)
      expect(cards[k]).toHaveTextContent(`Answer ${rightOf(qn).label}`)
      expect(cards[k]).toHaveTextContent(`You said ${pick.label}`)
      expect(cards[k]).toHaveTextContent(b.line)
      const link = within(cards[k]).getByRole('link', { name: b.source })
      expect(link).toHaveAttribute('href', 'https://www.sec.gov/page')
      expect(link).toHaveAttribute('target', '_blank')
    })
    expect(cards[1]).toHaveTextContent(row.reason)                                              // the miss keeps its why

    // the XP the three attempts earned fills the level bar; nothing is posted as a game run
    expect(screen.getByTestId('sectors-level')).toHaveTextContent('+22 XP this run')
    expect(fetcher.calls.filter((c) => c.url === '/api/study/game-runs')).toHaveLength(0)
    expect(attempts(fetcher)).toHaveLength(3)
    expect(screen.getByTestId('sectors-best-line')).toHaveTextContent('A new best.')
    expect(localStorage.getItem('study.sectors.best')).toBe('40')
    expect(done.textContent).not.toMatch(/[—–]|the firm|NaN|undefined/i)

    // Back to Study closes; Race again returns to the arena on a fresh draw
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sectors-again'))
    await flush()
    expect(screen.getByTestId('sectors-intro')).toBeInTheDocument()
    expect(fetcher.calls.filter((c) => c.url === SESSIONS)).toHaveLength(2)
  })

  it('draws every kind as itself and, every answer right, crosses the line with its bonus', async () => {
    const fetcher = bankFetcher()
    await startRace(fetcher)
    const d = deck()
    expect(d.map((q) => q.difficulty)).toEqual([1, 1, 2, 2, 2, 3])                             // the race warms up
    const seen = new Set()
    for (let k = 0; k < d.length; k++) {
      const qn = d[k]
      const play = screen.getByTestId('sectors-play')
      expect(play).toHaveTextContent(`Question ${k + 1} of 6`)
      if (qn.scenario) {
        expect(screen.getByTestId('sectors-story')).toHaveTextContent(qn.story)
        expect(play).toHaveTextContent('your call')
        seen.add('scenario')
      } else expect(screen.queryByTestId('sectors-story')).toBeNull()
      if (qn.kind === 'fill') {
        const s = screen.getByTestId('sectors-sentence')
        expect(s).toHaveTextContent('Divide a sector fund by the S&P 500 and chart it. A rising line shows relative')
        expect(within(s).getByLabelText('blank')).toBeInTheDocument()
        expect(s.textContent).not.toMatch(/___/)
        seen.add('fill')
      }
      if (qn.kind === 'tf') {
        expect(tileLabels()).toEqual(['True', 'False'])
        seen.add('tf')
      } else {
        expect(tileLabels()).toEqual(qn.choices.map((c) => c.label))                           // the dealt order
      }
      fireEvent.click(tile(rightOf(qn).label))
      await flush()
    }
    expect([...seen].sort()).toEqual(['fill', 'scenario', 'tf'])
    // the answer the courses write first is not always the first tile
    expect(d.filter((q) => q.kind !== 'tf').some((q) => q.choices.indexOf(rightOf(q)) > 0)).toBe(true)

    // the last leg: the runner reaches the line and the clock stops; nothing more is answered
    expect(screen.getByTestId('sectors-play')).toHaveAttribute('data-state', 'crossing')
    expect(screen.getByTestId('sectors-track-runner')).toHaveAttribute('data-at', '100')
    expect(screen.getByTestId('sectors-track')).toHaveTextContent('Across the line')
    expect(screen.queryByTestId('sectors-done')).toBeNull()
    fireEvent.click(tile(rightOf(d[5]).label))
    fireEvent.keyDown(window, { key: '1' })
    await flush()
    expect(attempts(fetcher)).toHaveLength(6)
    tick(RACE_CROSS_MS)
    const done = screen.getByTestId('sectors-done')
    tick(2000)
    expect(done).toHaveTextContent('Crossed the line')
    expect(screen.getByTestId('sectors-right')).toHaveTextContent('6/6')
    // 20 + 20 + 30 + 30 + 30 + 40 for the answers, and 60 seconds left at the line at 5 points each
    expect(screen.getByTestId('sectors-xp')).toHaveTextContent('+470 points')
    expect(screen.getByTestId('sectors-distance')).toHaveTextContent('You ran the full 600 m with 60 seconds to spare, worth +300 points.')
    expect(screen.getByTestId('sectors-final-ran')).toHaveTextContent('600 m')
    expect(screen.getByTestId('sectors-misses')).toHaveTextContent('No misses.')
    expect(screen.getByTestId('sectors-level')).toHaveTextContent('+60 XP this run')
    expect(localStorage.getItem('study.sectors.best')).toBe('470')
  })

  it('ends at the end of the draw when a leg was missed', async () => {
    const items = BANK.slice(0, 4).map(itemOf)
    const fetcher = bankFetcher({ items })
    await startRace(fetcher)
    const d = deck(items)
    fireEvent.click(tile(wrongOf(d[0]).label))
    await flush()
    tick(TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('sectors-takeover-go'))
    for (let k = 1; k < 4; k++) { fireEvent.click(tile(rightOf(d[k]).label)); await flush() }
    const done = screen.getByTestId('sectors-done')
    tick(2000)
    expect(done).toHaveTextContent('Solid run')
    expect(screen.getByTestId('sectors-right')).toHaveTextContent('3/4')
    expect(screen.getByTestId('sectors-distance')).toHaveTextContent('You ran 300 m of the 400 m track.')
    expect(screen.getByTestId('sectors-deck-out')).toHaveTextContent('You answered every question in this draw.')
    expect(screen.getByTestId('sectors-xp')).toHaveTextContent('+70 points')                   // 20 + 20 + 30, no line, no bonus
  })

  it('names the page behind the figures a miss shows, on the takeover and in the log', async () => {
    const fetcher = bankFetcher()
    await startRace(fetcher)
    const d = deck()
    for (let k = 0; k < 5; k++) { fireEvent.click(tile(rightOf(d[k]).label)); await flush() }
    expect(d[5].id).toBe('si_q12')                                                              // the hardest rung, last
    fireEvent.click(tile('It fell again and kept lagging'))
    await flush()
    // the note says energy finished 2021 up 53.43%: that is the January 2022 prospectus, not the January 2021 one cited first
    expect(screen.getByTestId('sectors-takeover-why')).toHaveTextContent('Energy finished the year up 53.43%.')
    expect(screen.getByTestId('sectors-takeover-source')).toHaveTextContent('SEC EDGAR: Prospectus, January 2022: returns for periods ending 12/31/21')
    expect(screen.getByTestId('sectors-takeover-source')).not.toHaveTextContent('January 2021')
    tick(TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('sectors-takeover-go'))
    expect(screen.getByTestId('sectors-done')).toBeInTheDocument()
    const cards = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(cards).toHaveLength(6)
    const link = within(cards[5]).getByRole('link', { name: 'SEC EDGAR: Prospectus, January 2022: returns for periods ending 12/31/21' })
    expect(link).toHaveAttribute('href', 'https://www.sec.gov/2022')
    expect(screen.getByTestId('sectors-distance')).toHaveTextContent('You ran 500 m of the 600 m track.')
  })

  it('promises x5 only on a track long enough to reach it', async () => {
    // ten questions: nine in a row is possible, so the start screen says x5
    const extra = [7, 8, 9, 10].map((n) => ({ ...BANK[4], id: `si_x${n}`, prompt: { ...BANK[4].prompt, q: `${BANK[4].prompt.q} (${n})` } }))
    const items = [...BANK, ...extra].map(itemOf)
    render(<SectorRaceGame fetcher={bankFetcher({ items })} />)
    await flush()
    expect(screen.getByTestId('sectors-intro')).toHaveTextContent('1,000 mtrack')
    expect(screen.getByTestId('sectors-intro')).toHaveTextContent('x5top multiplier')
    expect(screen.getByTestId('sectors-howto')).toHaveTextContent('up to x5')
  })

  it('says so honestly when the draw is thin or empty, with a way back', async () => {
    for (const items of [BANK.slice(0, 3).map(itemOf), [NUMERIC], [], null]) {
      const onClose = vi.fn()
      render(<SectorRaceGame fetcher={bankFetcher({ items })} onClose={onClose} />)
      await flush()
      const empty = screen.getByTestId('sectors-empty')
      expect(screen.getByTestId('sectors-empty-line')).toHaveTextContent(EMPTY_LINE)
      // the stakes are the full race it will be, the same however thin the draw (never a 300 m track that cannot run)
      expect(empty).toHaveTextContent('1,000 mtrack')
      expect(empty).toHaveTextContent('x5top multiplier')
      expect(screen.getByTestId('sectors-start')).toBeDisabled()
      expect(screen.getByTestId('sectors-start')).toHaveTextContent('No questions yet')
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(screen.queryByTestId('sectors-play')).toBeNull()
      expect(empty.textContent).not.toMatch(/[—–]|the firm/i)
      fireEvent.click(screen.getByTestId('sectors-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('shows a failed draw with a retry and a way back, and a draw that never answers fails instead of spinning', async () => {
    let fail = true
    const fetcher = vi.fn(async () => {
      if (fail) { const e = new Error('500'); e.status = 500; throw e }
      return SET()
    })
    const onClose = vi.fn()
    render(<SectorRaceGame fetcher={fetcher} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('sectors-failed')).toHaveTextContent("Couldn't load the Sector Race questions.")
    fireEvent.click(screen.getByTestId('sectors-back'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    await flush()
    expect(screen.getByTestId('sectors-intro')).toBeInTheDocument()
    cleanup()

    render(<SectorRaceGame fetcher={vi.fn(() => new Promise(() => {}))} onClose={onClose} />)
    await flush()
    expect(screen.getByTestId('sectors-start')).toHaveTextContent('Loading the questions')
    tick(15000)
    expect(screen.getByTestId('sectors-failed')).toBeInTheDocument()
    cleanup()

    const out = vi.fn(async () => { const e = new Error('401'); e.status = 401; throw e })
    render(<SectorRaceGame fetcher={out} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    await flush()
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('does not count an answer that never reaches the server, and stops after three in a row', async () => {
    const down = (body, n) => { if (n <= 4) { const e = new Error('500'); e.status = 500; throw e } }
    // the first call hangs past the timeout; the next two fail outright
    const fetcher = bankFetcher({ attempt: (body, n) => (n === 1 ? new Promise(() => {}) : down(body, n)) })
    await startRace(fetcher)
    const d = deck()
    fireEvent.click(tile(rightOf(d[0]).label))
    tick(8000)                                                                                  // the answer took too long
    await flush()
    expect(screen.getByTestId('sectors-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 2 of 6')
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')                  // the wait cost nothing
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('0')
    expect(screen.getByTestId('sectors-track-ran')).toHaveTextContent('0 m')
    fireEvent.click(tile(rightOf(d[1]).label))
    await flush()
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 3 of 6')
    fireEvent.click(tile(rightOf(d[2]).label))
    await flush()
    expect(screen.getByTestId('sectors-done')).toBeInTheDocument()
    expect(screen.getByTestId('sectors-offline')).toHaveTextContent('The server stopped answering, so the race ended early.')
    expect(screen.getByTestId('sectors-right')).toHaveTextContent('0/0')
    expect(screen.getByTestId('sectors-done')).toHaveTextContent('No answers this run')
  })

  it('never reads a reply without a verdict as a miss: it is not counted and no answer is shown', async () => {
    const fetcher = bankFetcher({ attempt: (body, n) => (n === 1 ? { reveal: revealOf(BY_ID[body.item_id]), progress: {} } : undefined) })
    await startRace(fetcher)
    const d = deck()
    fireEvent.click(tile(wrongOf(d[0]).label))
    await flush()
    expect(screen.queryByTestId('sectors-takeover')).toBeNull()
    expect(screen.getByTestId('sectors-note')).toHaveTextContent('We could not check that one, so it does not count.')
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 2 of 6')
  })

  it('stops the race when the session ends mid-race and offers the sign-in', async () => {
    const fetcher = bankFetcher({ attempt: (body, n) => { if (n === 2) { const e = new Error('401'); e.status = 401; throw e } } })
    await startRace(fetcher, { signedOut: <a data-testid="sign-in" href="/login">Sign in</a> })
    const d = deck()
    fireEvent.click(tile(rightOf(d[0]).label))
    await flush()
    fireEvent.click(tile(rightOf(d[1]).label))
    await flush()
    expect(screen.getByTestId('sectors-done')).toBeInTheDocument()
    expect(screen.getByTestId('sectors-signed-out')).toHaveTextContent('You are signed out, so the race stopped there.')
    expect(screen.getByTestId('sectors-right')).toHaveTextContent('1/1')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('runs one clock, one key handler and one takeover timer under StrictMode', async () => {
    const fetcher = bankFetcher()
    render(<StrictMode><SectorRaceGame fetcher={fetcher} /></StrictMode>)
    await flush()
    fireEvent.click(screen.getByTestId('sectors-start'))
    const d = deck()
    fireEvent.keyDown(window, { key: String(d[0].choices.indexOf(rightOf(d[0])) + 1) })
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)                                                  // one key, one answer
    expect(screen.getByTestId('blitz-score')).toHaveTextContent('20')
    tick(10000)
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('50s left')                  // one clock, not two
    const said = wrongOf(d[1])
    fireEvent.click(tile(said.label))
    await flush()
    expect(screen.getByTestId('sectors-takeover')).toBeInTheDocument()
    const row = missRow(d[1], said)
    tick(takeoverMs(missWhy(row), row.line))
    expect(screen.queryByTestId('sectors-takeover')).toBeNull()
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 3 of 6')            // moved on once, not twice
    // the takeover's own button (its click also reaches the tap-anywhere layer) and Enter each move on exactly one
    fireEvent.click(tile(wrongOf(d[2]).label))
    await flush()
    fireEvent.click(screen.getByTestId('sectors-takeover'))                                    // a stray second tap: ignored
    expect(screen.getByTestId('sectors-takeover')).toBeInTheDocument()
    tick(TAKEOVER_GUARD_MS)
    fireEvent.click(screen.getByTestId('sectors-takeover-go'))
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 4 of 6')
    fireEvent.click(tile(wrongOf(d[3]).label))
    await flush()
    tick(TAKEOVER_GUARD_MS)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('sectors-takeover')).toBeNull()
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 5 of 6')
    tick(TAKEOVER_MAX_MS)
    expect(screen.getByTestId('sectors-play')).toHaveTextContent('Question 5 of 6')
  })

  it('closed mid-race, it stops its clock, its timers and its keys', async () => {
    // closed while a miss holds the screen
    const fetcher = bankFetcher()
    const { unmount } = await startRace(fetcher)
    const d = deck()
    fireEvent.click(tile(wrongOf(d[0]).label))
    await flush()
    expect(screen.getByTestId('sectors-takeover')).toBeInTheDocument()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    tick(60000)
    fireEvent.keyDown(window, { key: '1' })
    await flush()
    expect(attempts(fetcher)).toHaveLength(1)
    expect(document.body.style.overflow).toBe('')                                             // the takeover gave the page back

    // closed while the runner crosses the line: the end screen never comes
    const items = BANK.slice(0, 4).map(itemOf)
    vi.setSystemTime(SEED)                                                                      // the deal is seeded from the start time
    const quick = bankFetcher({ items })
    const view = await startRace(quick)
    const d4 = deck(items)
    for (let k = 0; k < 4; k++) { fireEvent.click(tile(rightOf(d4[k]).label)); await flush() }
    expect(screen.getByTestId('sectors-play')).toHaveAttribute('data-state', 'crossing')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)

    // closed while an answer is on the wire: its time-out goes with it, and a late answer changes nothing
    let late = null
    const slow = bankFetcher({ attempt: () => new Promise((resolve) => { late = resolve }) })
    vi.setSystemTime(SEED)
    const second = await startRace(slow)
    fireEvent.click(tile(rightOf(deck()[0]).label))
    await flush()
    expect(screen.getByTestId('sectors-play')).toHaveAttribute('data-state', 'checking')
    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
    late({ correct: true, reveal: {}, progress: { xp: 5, xp_gained: 5 } })
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })
})
