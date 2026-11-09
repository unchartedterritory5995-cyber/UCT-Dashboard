/**
 * History Detective rails (docs/study/GAMES.md, kind `history`). It registers from one export as a chart challenge; the
 * start arena carries the stakes and the three steps and asks for the unit's own skill session; cases come easiest first;
 * a right answer posts through /attempts (the XP flows there, no game run is ever posted) and takes over the screen with
 * the answer, the XP and the lesson line; a wrong one costs a heart and takes over with the answer and why the pick was
 * not it (or the working for a computed answer); the case file then reads the chart's ticker and last day, why, the
 * working, the lesson line and the sources; a chart case hides its ticker until the answer and runs on into what came
 * next; the end screen counts the cases solved, logs each one and fills the level bar from the attempts; the hearts end a
 * run; an empty, thin or failed draw and an answer the server did not score each say so honestly.
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart" data-bars={(props.barsOverride || []).length} data-sym={props.sym}
      data-callouts={(props.callouts || []).map((c) => `${c.index}:${c.text}`).join('|')} />
  ),
}))
vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: null }) }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const StockChart = (await import('../../../components/StockChart')).default
  return { default: (props) => <div data-testid="chart-pane">{props.identityLabel}<StockChart sym={props.sym} {...(props.stockChartProps || {})} /></div> }
})
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: { chart_settings: {} } }) }))

import HistoryDetectiveGame, { GAME } from './HistoryDetectiveGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { EMPTY_LINE, FAILED_LINE, HISTORY_BEST_KEY, SIGNED_OUT_LINE, thinLine } from './games/history'

const SESSIONS = '/api/study/sessions'
const ATTEMPTS = '/api/study/attempts'
const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const LOW = Date.UTC(2009, 2, 9)
// the chart: sixty sessions down into the March 9, 2009 low, then six sessions of what came next
const BARS = Array.from({ length: 60 }, (_, i) => { const c = 120 - i; return { t: iso(LOW - (59 - i) * DAY), o: c + 0.5, h: c + 1, l: c - 1, c, v: 1000 } })
const FORWARD = Array.from({ length: 6 }, (_, i) => { const c = 62 + i * 2; return { t: iso(LOW + (i + 1) * DAY), o: c - 1, h: c + 1, l: c - 2, c, v: 1200 } })

const SRC = {
  fed: { name: 'Federal Reserve History (Federal Reserve System): The Great Recession (Robert Rich, written as of November 22, 2013)', url: 'https://www.federalreservehistory.org/essays/great-recession-of-200709' },
  nber: { name: 'NBER Business Cycle Dating Committee: Business Cycle Dating Committee announcement, September 20, 2010 (June 2009 trough)', url: 'https://www.nber.org/news/business-cycle-dating-committee-announcement-september-20-2010' },
  fred: { name: 'Federal Reserve Bank of St. Louis, FRED (data: S&P Dow Jones Indices LLC): S&P 500 (SP500), daily close (CSV)', url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500' },
  sec: { name: 'SEC, Investor.gov: Stop, Stop-Limit, and Trailing Stop Orders: Investor Bulletin', url: 'https://www.investor.gov/stop-orders' },
}
const cite = (s, quote) => ({ ...s, quote, accessed: '2026-11-09', tier: 1 })

// F7.08's own questions and reveals, as scripts/study/courses_lib.build_items makes them; served in this order
const CASES = [
  {
    item: { id: 'si_q01', type: 'recall', skill_id: 'history.detective', difficulty: 1, has_chart: false,
      prompt_json: { q: 'Since 2000, which fall cut the S&P 500 the most from peak to low?', kind: 'mcq',
        choices: ['The 2007-09 financial crisis', 'The 2000-02 dot-com bust', 'The 2020 COVID crash', 'The 2022 inflation bear'] } },
    key: 'The 2007-09 financial crisis',
    reveal: { why: 'The 2007-09 financial crisis. The S&P 500 fell 57% from its October 2007 peak to its March 2009 trough, the deepest of the four.',
      lesson_line: "The worst of these falls took 57% off the index. Never assume a drop can't go that deep.",
      wrong: { 'The 2020 COVID crash': 'It was the fastest, not the deepest. The S&P 500 fell 33.9% from February 19 to March 23, 2020.' },
      depth: { sources: [cite(SRC.fed, 'the S&P 500 index fell 57 percent from its October 2007 peak to its trough in March 2009.')] } },
  },
  {
    item: { id: 'si_q05', type: 'recall', skill_id: 'history.detective', difficulty: 1, has_chart: true,
      prompt_json: { q: 'When the index made this low, the recession had already ended.', kind: 'tf', choices: ['True', 'False'], chart: { window_bars: 60, tf: 'D' } },
      bars: { symbol: 'si_q05', tf: 'D', bars: BARS } },
    key: 'False', sym: 'SPY', asof: '2009-03-09', forward: true,
    reveal: { why: 'False. The S&P 500 hit its trough in March 2009, but the recession ran until June 2009. Stocks turned months before the economy did.',
      lesson_line: "In 2009 stocks turned while the recession was still on. Bad news alone doesn't tell you where the low is.",
      depth: { sources: [cite(SRC.nber, 'the trough occurred in June 2009')] } },
  },
  {
    item: { id: 'si_q08', type: 'recall', skill_id: 'history.detective', difficulty: 2, has_chart: false,
      prompt_json: { q: 'The S&P 500 closed at a 2,930.75 peak in September 2018 and at 2,351.10 on December 24. How far did it fall, in %? One decimal.', kind: 'fill_numeric', suffix: '%' } },
    key: 19.8, accept: ['19.8', '19.80', '19.800'],
    reveal: { why: '19.8%. From 2,930.75 down to 2,351.10, on worries about earnings, global growth, trade and the Fed. It stopped just short of the 20% fall that generally marks a bear market.',
      lesson_line: 'Measure from the closing peak. Late 2018 came within a hair of 20%, then turned.',
      facts: { calc: { fn: 'drawdown_pct', args: { peak: 2930.75, trough: 2351.1 }, result: 19.8 } },
      depth: { sources: [cite(SRC.fred, '2018-12-24, 2351.10')] } },
  },
  {
    item: { id: 'si_q02', type: 'recall', skill_id: 'history.detective', difficulty: 2, has_chart: false,
      prompt_json: { q: 'Tap the word that fits the blank.', kind: 'fill', sentence: 'The 2007-09 bear market grew out of a collapse in ___ prices.', bank: ['home', 'oil', 'tech', 'gold', 'food'] } },
    key: 'home',
    reveal: { why: 'Home. Falling home prices helped spark the financial crisis of 2007-08.', lesson_line: '2007-09 started in housing, then spread through the banks to the whole market.',
      depth: { sources: [cite(SRC.fed, 'home prices fell')] } },
  },
  {
    item: { id: 'si_q15', type: 'scenario', skill_id: 'history.detective', difficulty: 3, has_chart: false,
      prompt_json: { q: 'What happens to your stop order?', kind: 'mcq', story: "Stock index futures hit their 5% limit down before the open. Your sell stop sits 6% below Friday's close.",
        choices: ['It becomes a market order and sells', 'It fills at exactly your stop price', 'It waits for the price to recover', 'It cancels when trading turns wild'] } },
    key: 'It becomes a market order and sells',
    reveal: { why: 'It becomes a market order and sells. A stop price is a trigger, not a promised fill.', lesson_line: 'A stop is a trigger, not a price. In a wild open it can sell you near the low.',
      wrong: { 'It fills at exactly your stop price': "No. The stop price is not a guaranteed fill. Once it triggers, it's a market order and takes the next prices available." },
      depth: { sources: [cite(SRC.sec, 'a stop price is not a guaranteed execution price')] } },
  },
]
const BY_ID = Object.fromEntries(CASES.map((c) => [c.item.id, c]))
const norm = (v) => String(v).trim().toLowerCase()

/** The server, shaped as the routes answer: the skill session, each answer scored against a key the browser never saw,
 *  the reveal with the ticker and day for a chart, three forward bars of six, the rest through /step, and the XP with
 *  the member's running total. */
function makeFetcher({ items = CASES.map((c) => c.item), poolError = null, attempt = null } = {}) {
  const calls = []
  let xp = 990
  let seq = 100
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url, body: opts.body })
    if (url === SESSIONS) { if (poolError) throw poolError; return { session_id: 'sess-h', kind: 'skill', items } }
    if (url === ATTEMPTS) {
      if (attempt) { const out = attempt(opts.body, calls.filter((c) => c.url === ATTEMPTS).length); if (out !== undefined) return out }
      const c = BY_ID[opts.body.item_id]
      const got = opts.body.answer.choice
      const correct = typeof c.key === 'number' ? Number(got) === c.key : norm(got) === norm(c.key)
      const gained = correct ? 10 : 2
      xp += gained
      return {
        attempt_id: (seq += 1), item_id: c.item.id, correct, score: correct ? 1 : 0, unscored: false,
        reveal: { unit: 'F7.08', ...c.reveal, lesson: `${c.reveal.why} ${c.reveal.lesson_line}`, answer: { answer: c.key, ...(c.accept ? { accept: c.accept } : {}) },
          sym: c.sym || null, asof: c.asof || null, ref: 'abc123', ...(c.forward ? { forward_bars: FORWARD.slice(0, 3), forward_total: FORWARD.length } : {}) },
        progress: { xp_gained: gained, xp, level: 2, streak: 1, badges_new: [] }, skill: {},
      }
    }
    const step = /^\/api\/study\/attempts\/(\d+)\/step$/.exec(url)
    if (step) { const { offset, n } = opts.body; return { bars: FORWARD.slice(offset, offset + n), forward_total: FORWARD.length } }
    throw new Error(`unexpected ${url}`)
  })
  fn.calls = calls
  return fn
}

const tiles = () => within(screen.getByTestId('history-cards')).getAllByRole('button')
const labelOf = (b) => b.textContent.replace(/^\d/, '').trim()
const tile = (label) => tiles().find((b) => labelOf(b) === label)
const posts = (fetcher) => fetcher.calls.filter((c) => c.url === ATTEMPTS).map((c) => c.body)

async function begin(fetcher, props = {}) {
  render(<HistoryDetectiveGame fetcher={fetcher} onClose={() => {}} {...props} />)
  const go = await screen.findByTestId('history-start')
  await waitFor(() => expect(go).not.toBeDisabled())
  fireEvent.click(go)
  return screen.findByTestId('history-play')
}
/** Pick a tile by its label, Check, and wait for the verdict. */
async function answerTile(label) {
  await screen.findByTestId('history-cards')
  fireEvent.click(tile(label))
  fireEvent.click(screen.getByTestId('history-check'))
  return screen.findByTestId('history-takeover')
}
async function answerNumber(text) {
  fireEvent.change(screen.getByTestId('history-number'), { target: { value: text } })
  fireEvent.click(screen.getByTestId('history-check'))
  return screen.findByTestId('history-takeover')
}
const openFile = () => fireEvent.click(screen.getByTestId('history-takeover-go'))
const nextCase = () => fireEvent.click(screen.getByTestId('history-next'))

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('HistoryDetectiveGame', () => {
  it('registers from one export as a chart challenge, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'history', title: 'History Detective', sub: expect.any(String), icon: 'search', plate: 'Detective', accent: 'red', group: 'chart' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('opens on the arena with the stakes and the three steps, and asks for the unit’s skill session', async () => {
    const fetcher = makeFetcher()
    render(<HistoryDetectiveGame fetcher={fetcher} onClose={() => {}} />)
    const intro = screen.getByTestId('history-intro')
    expect(intro).toHaveTextContent('History Detective')
    expect(intro).toHaveTextContent('cases')
    expect(intro).toHaveTextContent('hearts')
    expect(intro).toHaveTextContent('try each')
    expect(intro).toHaveTextContent('Every big fall has a depth, a length, a cause and an aftermath.')
    expect(screen.getByTestId('history-start')).toHaveTextContent('Opening the case files')
    const howto = screen.getByTestId('history-howto')
    expect(howto).toHaveTextContent('Open the case')
    expect(howto).toHaveTextContent('Solve it')
    expect(howto).toHaveTextContent('Three hearts')
    await waitFor(() => expect(screen.getByTestId('history-start')).not.toBeDisabled())
    expect(screen.getByTestId('history-start')).toHaveTextContent('Open the case files')
    expect(screen.getByTestId('history-pool-line')).toHaveTextContent('5 cases in this draw')
    const draw = fetcher.calls.filter((c) => c.url === SESSIONS)
    expect(draw).toHaveLength(1)
    expect(draw[0].body).toEqual({ kind: 'skill', skill_id: 'history.detective', size: 8 })
    expect(intro.textContent).not.toMatch(/[—–]|\bthe firm\b/i)
  })

  it('a right answer: posted through /attempts, the verdict takes over with the answer, the XP and the lesson; the case file reads why and the sources', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    // case 1 has no chart: the case card stands in its place with the question; the header only asks
    expect(screen.queryByTestId('study-chart')).toBeNull()
    expect(screen.getByTestId('history-question')).toHaveTextContent('Since 2000, which fall cut the S&P 500 the most from peak to low?')
    expect(screen.getByTestId('history-case')).toHaveTextContent('Case 1')
    expect(screen.getByTestId('history-step')).toHaveTextContent('case 1 of 5')
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByText('Pick the answer.')).toBeInTheDocument()
    expect(screen.getByTestId('history-check')).toBeDisabled()
    const takeover = await answerTile('The 2007-09 financial crisis')
    expect(posts(fetcher)[0]).toMatchObject({ item_id: 'si_q01', answer: { choice: 'The 2007-09 financial crisis' }, session_id: 'sess-h' })
    expect(typeof posts(fetcher)[0].time_ms).toBe('number')
    expect(takeover).toHaveAttribute('data-correct', '1')
    expect(takeover).toHaveTextContent('Case solved.')
    expect(takeover).toHaveTextContent('The 2007-09 financial crisis')
    expect(takeover).toHaveTextContent('+10 XP')
    expect(screen.getByTestId('history-takeover-line')).toHaveTextContent("The worst of these falls took 57% off the index.")
    openFile()
    expect(screen.queryByTestId('history-takeover')).toBeNull()
    const file = screen.getByTestId('history-file')
    expect(screen.getByTestId('history-file-answer')).toHaveTextContent('The 2007-09 financial crisis')
    // why, without the verdict the title already shows
    expect(screen.getByTestId('history-why')).toHaveTextContent(/^WhyThe S&P 500 fell 57% from its October 2007 peak/)
    expect(screen.getByTestId('history-line')).toHaveTextContent("Never assume a drop can't go that deep.")
    const src = within(screen.getByTestId('history-sources')).getByRole('link', { name: 'Federal Reserve History: The Great Recession' })
    expect(src).toHaveAttribute('href', SRC.fed.url)
    expect(screen.getByTestId('history-evidence')).toHaveTextContent('the S&P 500 index fell 57 percent')
    expect(within(file).queryByTestId('history-pick')).toBeNull()
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
    expect(tile('The 2007-09 financial crisis')).toHaveAttribute('data-state', 'right')
    expect(screen.getByTestId('history-next')).toHaveTextContent('Next case')
    expect(file.textContent).not.toMatch(/[—–]|\bthe firm\b/i)
  })

  it('a wrong answer on a chart case: the ticker stays hidden until the answer, a heart goes, the verdict teaches, and the chart runs on into what came next', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2020 COVID crash')
    // case 1's miss teaches with the note the case keeps for that very pick
    expect(screen.getByTestId('history-takeover-why')).toHaveTextContent('It was the fastest, not the deepest.')
    expect(screen.getByTestId('history-takeover')).toHaveTextContent('The answer')
    expect(screen.getByTestId('history-takeover-hearts')).toHaveTextContent('2 hearts left')
    openFile()
    expect(screen.getByTestId('history-pick')).toHaveTextContent('The 2020 COVID crash. It was the fastest, not the deepest.')
    expect(tile('The 2020 COVID crash')).toHaveAttribute('data-state', 'wrong')
    expect(tile('The 2007-09 financial crisis')).toHaveAttribute('data-state', 'right')
    nextCase()
    // case 2: the index chart is the hero, its ticker masked, the last day ringed; the question sits over the tiles
    const chart = await screen.findByTestId('study-chart')
    expect(chart).toHaveAttribute('data-masked', '1')
    expect(screen.getByTestId('sym-label')).toHaveAttribute('aria-label', 'ticker hidden')
    expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-bars', '60')
    expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-callouts', '59:Last day shown')
    expect(screen.getByText('When the index made this low, the recession had already ended.')).toBeInTheDocument()
    expect(screen.getByTestId('history-play')).toHaveTextContent('Case 2 of 5 · Read the chart · ticker hidden')
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '2')
    expect(tiles().map(labelOf)).toEqual(['True', 'False'])
    const takeover = await answerTile('True')
    expect(takeover).toHaveAttribute('data-correct', '0')
    expect(takeover).toHaveTextContent('Not this one.')
    expect(takeover).toHaveTextContent('False')
    // no wrong note for a true or false: why, without its opening verdict
    expect(screen.getByTestId('history-takeover-why')).toHaveTextContent(/^The S&P 500 hit its trough in March 2009/)
    expect(screen.getByTestId('history-takeover-hearts')).toHaveTextContent('1 heart left')
    openFile()
    // the reveal names the chart: the ticker on the badge, the last day on the pointer and in the case file
    expect(screen.getByTestId('sym-label')).toHaveTextContent('SPY')
    expect(screen.getByTestId('stock-chart').getAttribute('data-callouts')).toBe('59:Mar 9, 2009')
    const facts = screen.getByTestId('history-facts')
    expect(facts).toHaveTextContent('SPY')
    expect(facts).toHaveTextContent('Last day shown March 9, 2009')
    expect(facts).toHaveTextContent('SPY is a fund that tracks the S&P 500. Its moves follow the index closely, not exactly.')
    expect(screen.getByTestId('history-aftermath')).toBeInTheDocument()
    // what came next: the reveal's three bars, then the rest through /step, played onto the chart
    await waitFor(() => expect(fetcher.calls.some((c) => /\/step$/.test(c.url))).toBe(true))
    expect(fetcher.calls.find((c) => /\/step$/.test(c.url)).body).toEqual({ offset: 3, n: 3 })
    await waitFor(() => expect(Number(screen.getByTestId('stock-chart').getAttribute('data-bars'))).toBeGreaterThan(61), { timeout: 3000 })
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '1')
  })

  it('a number case: typed, posted as a number, and a miss shows the answer and the working', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('False'); openFile(); nextCase()
    // keyboard play: on a desktop the field takes the keys as the case opens
    expect(screen.getByTestId('history-number')).toHaveFocus()
    expect(screen.getByTestId('history-question')).toHaveTextContent('How far did it fall, in %? One decimal.')
    expect(screen.getByText('Work it out.')).toBeInTheDocument()
    expect(screen.getByText('Type the number, then press Enter or Check.')).toBeInTheDocument()
    expect(screen.getByTestId('history-check')).toBeDisabled()
    fireEvent.change(screen.getByTestId('history-number'), { target: { value: '19,8' } })
    expect(screen.getByTestId('history-number-hint')).toHaveTextContent('Type a number, like 12.5')
    expect(screen.getByTestId('history-check')).toBeDisabled()
    // Enter in the field checks
    fireEvent.change(screen.getByTestId('history-number'), { target: { value: '20' } })
    fireEvent.keyDown(screen.getByTestId('history-number'), { key: 'Enter' })
    const takeover = await screen.findByTestId('history-takeover')
    expect(posts(fetcher)[2]).toMatchObject({ item_id: 'si_q08', answer: { choice: 20 } })
    expect(takeover).toHaveTextContent('19.8%')
    expect(screen.getByTestId('history-takeover-why')).toHaveTextContent('The fall = (peak − low) ÷ peak = (2,930.75 − 2,351.10) ÷ 2,930.75 = 19.8%')
    openFile()
    expect(screen.getByTestId('history-number-truth')).toHaveTextContent('The answer 19.8%')
    expect(screen.getByTestId('history-working')).toHaveTextContent('= (2,930.75 − 2,351.10) ÷ 2,930.75 = 19.8%')
    expect(screen.getByTestId('history-pick')).toHaveTextContent('20%')
    expect(screen.getByTestId('history-why')).toHaveTextContent(/^WhyFrom 2,930.75 down to 2,351.10/)
  })

  it('a number case plays from the keyboard end to end: the field lets go once answered, so Enter opens the file and then moves on', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('False'); openFile(); nextCase()
    const field = screen.getByTestId('history-number')
    fireEvent.change(field, { target: { value: '19.8' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('history-takeover')).toHaveAttribute('data-correct', '1')
    expect(field).not.toHaveFocus()
    // Enter, wherever the keys now land, opens the case file, and a second Enter goes on to the next case
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Enter' })
    expect(screen.queryByTestId('history-takeover')).toBeNull()
    expect(screen.getByTestId('history-file')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Enter' })
    expect(await screen.findByTestId('history-sentence')).toBeInTheDocument()
    expect(screen.getByTestId('history-step')).toHaveTextContent('case 4 of 5')
  })

  it('a number the server did not score: the field takes the keys back, and Enter sends it again', async () => {
    let failed = false
    const fetcher = makeFetcher({ attempt: (body) => {
      if (body.item_id === 'si_q08' && !failed) { failed = true; throw Object.assign(new Error('POST /api/study/attempts answered 500'), { status: 500 }) }
      return undefined
    } })
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('False'); openFile(); nextCase()
    const field = screen.getByTestId('history-number')
    fireEvent.change(field, { target: { value: '19.8' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('history-note')).toHaveTextContent(FAILED_LINE)
    expect(field).toHaveFocus()
    expect(field).toHaveValue('19.8')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByTestId('history-takeover')).toHaveAttribute('data-correct', '1')
    expect(posts(fetcher).filter((p) => p.item_id === 'si_q08')).toHaveLength(2)
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
  })

  it('a fill case: the picked word drops into the blank, picked by its number key, checked with Enter', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('False'); openFile(); nextCase()
    await answerNumber('19.8'); expect(screen.getByTestId('history-takeover')).toHaveTextContent('Case solved.'); openFile(); nextCase()
    expect(screen.getByTestId('history-sentence')).toHaveTextContent('The 2007-09 bear market grew out of a collapse in prices.')
    expect(screen.getByText('Tap the word that fits the blank.')).toBeInTheDocument()
    const words = tiles().map(labelOf)
    expect([...words].sort()).toEqual(['food', 'gold', 'home', 'oil', 'tech'])
    fireEvent.keyDown(window, { key: String(words.indexOf('home') + 1) })
    expect(screen.getByTestId('history-blank')).toHaveTextContent('home')
    fireEvent.keyDown(window, { key: 'Enter' })
    const takeover = await screen.findByTestId('history-takeover')
    expect(takeover).toHaveTextContent('Case solved.')
    expect(posts(fetcher)[3]).toMatchObject({ item_id: 'si_q02', answer: { choice: 'home' } })
    expect(screen.getByTestId('history-blank')).toHaveAttribute('data-tone', 'ok')
  })

  it('a missed fill case finishes its sentence with the answer, in green, and the case file says what was picked', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('False'); openFile(); nextCase()
    await answerNumber('19.8'); openFile(); nextCase()
    await answerTile('oil')
    expect(screen.getByTestId('history-takeover')).toHaveTextContent('home')
    openFile()
    expect(screen.getByTestId('history-blank')).toHaveTextContent('home')
    expect(screen.getByTestId('history-blank')).toHaveAttribute('data-tone', 'ok')
    expect(screen.getByTestId('history-pick')).toHaveTextContent('oil')
    expect(tile('oil')).toHaveAttribute('data-state', 'wrong')
    expect(tile('home')).toHaveAttribute('data-state', 'right')
  })

  it('a case reports itself once: two presses of Next in one beat never skip a case', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile()
    const btn = screen.getByTestId('history-next')
    act(() => { btn.click(); btn.click() })
    expect(await screen.findByTestId('history-step')).toHaveTextContent('case 2 of 5')
    expect(screen.getByTestId('study-chart')).toBeInTheDocument()
  })

  it('the end: the cases solved, the run log with each answer, ticker and lesson, the XP the attempts earned on the level bar, and never a game run', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('True'); openFile(); nextCase()
    await answerNumber('19.8'); openFile(); nextCase()
    await answerTile('home'); openFile(); nextCase()
    expect(screen.getByTestId('history-story')).toHaveTextContent('Stock index futures hit their 5% limit down before the open.')
    await answerTile('It fills at exactly your stop price')
    expect(screen.getByTestId('history-takeover-why')).toHaveTextContent('The stop price is not a guaranteed fill.')
    openFile()
    expect(screen.getByTestId('history-next')).toHaveTextContent('See the cases')
    nextCase()
    const done = await screen.findByTestId('history-done')
    expect(done).toHaveTextContent('Detective')           // 3 of 5
    expect(done).toHaveTextContent('3 of 5 cases solved')
    expect(screen.getByTestId('history-right')).toHaveTextContent('3/5 solved')
    const log = screen.getByTestId('run-log')
    const rows = within(log).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows[1]).toHaveTextContent('When the index made this low, the recession had already ended.')
    expect(rows[1]).toHaveTextContent('SPY · Mar 9, 2009')
    expect(rows[1]).toHaveTextContent('you said True, it was False')
    expect(rows[1]).toHaveTextContent('In 2009 stocks turned while the recession was still on.')
    expect(rows[4]).toHaveTextContent('you said It fills at exactly your stop price, it was It becomes a market order and sells')
    expect(rows[3]).toHaveTextContent('The 2007-09 bear market grew out of a collapse in ___ prices.')
    // a solved case keeps its answer too, so the log reads as a review sheet; a missed one says what was said and what it was
    expect(within(rows[0]).getByTestId('history-log-answer')).toHaveTextContent('The 2007-09 financial crisis')
    expect(within(rows[2]).getByTestId('history-log-answer')).toHaveTextContent('19.8%')
    expect(within(rows[1]).queryByTestId('history-log-answer')).toBeNull()
    // XP: 10 + 2 + 10 + 10 + 2, the server's own numbers, counted up and on the level bar
    await waitFor(() => expect(screen.getByTestId('history-xp')).toHaveTextContent('+34 XP'))
    expect(screen.getByTestId('history-level')).toHaveTextContent('+34 XP this run')
    expect(fetcher.calls.filter((c) => c.url === '/api/study/game-runs')).toHaveLength(0)
    expect(screen.getByTestId('history-best-line')).toHaveTextContent('A new best: 3 solved.')
    expect(localStorage.getItem(HISTORY_BEST_KEY)).toBe('3')
    expect(done.textContent).not.toMatch(/[—–]|\bthe firm\b/i)
  })

  it('the hearts end a run: three misses and the case file closes on Out of hearts', async () => {
    const fetcher = makeFetcher()
    const onClose = vi.fn()
    await begin(fetcher, { onClose })
    await answerTile('The 2000-02 dot-com bust'); openFile(); nextCase()
    await answerTile('True'); openFile(); nextCase()
    await answerNumber('25')
    expect(screen.getByTestId('history-takeover-hearts')).toHaveTextContent('Out of hearts')
    openFile()
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '0')
    expect(screen.getByTestId('history-next')).toHaveTextContent('See the cases')
    nextCase()
    const done = await screen.findByTestId('history-done')
    expect(done).toHaveTextContent('Out of hearts')
    expect(screen.getByTestId('history-end-line')).toHaveTextContent('The hearts ran out on case 3 of 5.')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(3)
    expect(posts(fetcher)).toHaveLength(3)
    // nothing solved and no best before: no "your best run stands at 0"
    expect(screen.queryByTestId('history-best-line')).toBeNull()
    fireEvent.click(within(done).getByRole('button', { name: 'Back to Study' }))
    expect(onClose).toHaveBeenCalled()
    // Open new cases draws a fresh session
    fireEvent.click(screen.getByTestId('history-again'))
    await waitFor(() => expect(fetcher.calls.filter((c) => c.url === SESSIONS)).toHaveLength(2))
    expect(await screen.findByTestId('history-intro')).toBeInTheDocument()
  })

  it('a third miss on the last case finishes the run: it earns its rank, not "Out of hearts"', async () => {
    const fetcher = makeFetcher()
    await begin(fetcher)
    await answerTile('The 2007-09 financial crisis'); openFile(); nextCase()
    await answerTile('True'); openFile(); nextCase()
    await answerNumber('19.8'); openFile(); nextCase()
    await answerTile('oil'); openFile(); nextCase()
    await answerTile('It waits for the price to recover')
    expect(screen.getByTestId('history-takeover-hearts')).toHaveTextContent('Out of hearts')
    openFile(); nextCase()
    const done = await screen.findByTestId('history-done')
    expect(done).toHaveTextContent('Junior Detective')   // 2 of 5
    expect(done).toHaveTextContent('2 of 5 cases solved')
    expect(screen.getByTestId('history-end-line')).not.toHaveTextContent('hearts ran out')
    expect(within(screen.getByTestId('run-log')).getAllByRole('listitem')).toHaveLength(5)
  })

  it('an empty draw, and a thin one, say so honestly with a way back and never start', async () => {
    for (const [items, line, label] of [[[], EMPTY_LINE, 'No cases yet'], [CASES.slice(0, 2).map((c) => c.item), thinLine(2), 'Not enough cases yet']]) {
      const onClose = vi.fn()
      render(<HistoryDetectiveGame fetcher={makeFetcher({ items })} onClose={onClose} />)
      expect(await screen.findByTestId('history-empty')).toBeInTheDocument()
      expect(screen.getByTestId('history-empty-line')).toHaveTextContent(line)
      expect(screen.getByTestId('history-start')).toBeDisabled()
      expect(screen.getByTestId('history-start')).toHaveTextContent(label)
      // the stakes name the game's own run, never "0 cases" or "2 cases"
      expect(screen.getByTestId('history-empty')).toHaveTextContent('8cases')
      expect(screen.queryByTestId('history-howto')).toBeNull()
      fireEvent.click(screen.getByTestId('history-back'))
      expect(onClose).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('a draw that fails offers a retry and a way back', async () => {
    const e = new Error('POST /api/study/sessions answered 500'); e.status = 500
    const fetcher = makeFetcher({ poolError: e })
    render(<HistoryDetectiveGame fetcher={fetcher} onClose={() => {}} />)
    expect(await screen.findByTestId('history-failed')).toBeInTheDocument()
    expect(screen.getByTestId('history-back')).toBeInTheDocument()
  })

  it('an answer the server did not score costs nothing: it says so, and Check sends it again', async () => {
    let fails = 1
    const fetcher = makeFetcher({ attempt: () => { if (fails > 0) { fails -= 1; const e = new Error('POST /api/study/attempts answered 500'); e.status = 500; throw e } return undefined } })
    await begin(fetcher)
    fireEvent.click(tile('The 2020 COVID crash'))
    fireEvent.click(screen.getByTestId('history-check'))
    expect(await screen.findByTestId('history-note')).toHaveTextContent(FAILED_LINE)
    expect(screen.queryByTestId('history-takeover')).toBeNull()
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByTestId('history-play')).toHaveAttribute('data-state', 'ask')
    fireEvent.click(screen.getByTestId('history-check'))
    expect(await screen.findByTestId('history-takeover')).toHaveAttribute('data-correct', '0')
    expect(screen.queryByTestId('history-note')).toBeNull()
  })

  it('a reply with no verdict is not read as a miss, and a signed-out answer says so', async () => {
    let n = 0
    const out = Object.assign(new Error('401'), { status: 401 })
    const fetcher = makeFetcher({ attempt: () => { n += 1; if (n === 1) return { reveal: {} }; if (n === 2) throw out; return undefined } })
    await begin(fetcher, { signedOut: <span data-testid="sign-in">Sign in</span> })
    fireEvent.click(tile('The 2020 COVID crash'))
    fireEvent.click(screen.getByTestId('history-check'))
    expect(await screen.findByTestId('history-note')).toHaveTextContent(FAILED_LINE)
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
    fireEvent.click(screen.getByTestId('history-check'))
    await waitFor(() => expect(screen.getByTestId('history-note')).toHaveTextContent(SIGNED_OUT_LINE))
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
    expect(screen.getByTestId('history-hearts')).toHaveAttribute('data-left', '3')
  })

  it('signed out in the product (no sign-in of its own): a way to sign in that keeps the run, and Check works after', async () => {
    let n = 0
    const out = Object.assign(new Error('401'), { status: 401 })
    const fetcher = makeFetcher({ attempt: () => { n += 1; if (n === 1) throw out; return undefined } })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await begin(fetcher)
    fireEvent.click(tile('The 2007-09 financial crisis'))
    fireEvent.click(screen.getByTestId('history-check'))
    expect(await screen.findByTestId('history-note')).toHaveTextContent(SIGNED_OUT_LINE)
    fireEvent.click(screen.getByTestId('history-sign-in'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0][0]).toMatch(/^\/login\?next=/)
    expect(open.mock.calls[0][1]).toBe('_blank')
    // the pick is still there; Check sends it again and it scores
    fireEvent.click(screen.getByTestId('history-check'))
    expect(await screen.findByTestId('history-takeover')).toHaveAttribute('data-correct', '1')
    expect(screen.queryByTestId('history-sign-in')).toBeNull()
  })

  it('plays under StrictMode and survives an unmount with an answer on the wire', async () => {
    let release
    const fetcher = makeFetcher({ attempt: () => new Promise((r) => { release = r }) })
    const view = render(<StrictMode><HistoryDetectiveGame fetcher={fetcher} onClose={() => {}} /></StrictMode>)
    const go = await screen.findByTestId('history-start')
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    await screen.findByTestId('history-cards')
    fireEvent.click(tile('The 2007-09 financial crisis'))
    fireEvent.click(screen.getByTestId('history-check'))
    expect(screen.getByTestId('history-check')).toHaveTextContent('Checking')
    // a second press while checking posts nothing more
    fireEvent.click(screen.getByTestId('history-check'))
    expect(posts(fetcher)).toHaveLength(1)
    view.unmount()
    await act(async () => { release({ correct: true, reveal: {}, progress: { xp_gained: 10, xp: 1000 } }) })
  })
})
