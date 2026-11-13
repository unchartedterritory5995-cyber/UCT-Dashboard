/**
 * Weekend Watchlist's rules (games/watchlist.js). The deal is the seed's and spreads across the setups; a flag posts
 * Hard mode's Yes for the chart's own setup and a pass its "Nothing fired"; what fired is read from the reveal's key; a
 * failed attempt is left out, never counted as a miss; every number the screen shows is counted here from known bars,
 * and the copy is honest about the count (there is no set number) and never says "the firm" or uses a long dash.
 */
import { describe, it, expect } from 'vitest'
import { NOTHING } from '../hardMode'
import {
  WATCH_KIND, WATCH_TOTAL, bankLine, boardCounts, boardPrompt, boardVerdict, callLine, cardRun, chartHead, chartNote, dateLabel, dealBoard,
  endNote, firstMiss, focusPeak, focusTitle, isShort, logRows, missLines, moveLabel, moveLine, moveOf, openLabel, perChartMs, readChart,
  scoredStep, setupList, startLead, summaryLines, takeoverLabel, tally, watchAnswer, whereLabel,
} from './watchlist'
import { SETUP_NAMES } from '../challengeBank'

const bars = (n = 3) => Array.from({ length: n }, (_, i) => ({ t: `2025-01-0${i + 1}`, o: 10, h: 11, l: 9, c: 10 + i * 0.1, v: 100 }))
const item = (id, skill, name) => ({ id, skill, name, bars: bars(), choices: ['Yes', 'No'] })
// three setups, four charts each, as the Hard pool hands them over
const POOL = [
  ...['k1', 'k2', 'k3', 'k4'].map((id) => item(id, 'setup.family3.kicker', 'Kicker')),
  ...['o1', 'o2', 'o3', 'o4'].map((id) => item(id, 'setup.family4.oops', 'Oops Reversal')),
  ...['b1', 'b2', 'b3', 'b4'].map((id) => item(id, 'setup.family3.bear_gap', 'Bear gap')),
]
const KICKER = { id: 'k1', name: 'Kicker' }
const att = (correct, answer, extra = {}) => ({ correct, reveal: { answer, sym: 'JBI', asof: '2025-03-04', ...(extra.reveal || {}) }, progress: { xp_gained: extra.xp ?? (correct ? 10 : 0) } })

describe('the deal', () => {
  it('deals eight, the same board for the same seed and a different one for another', () => {
    const a = dealBoard(POOL, 42)
    expect(WATCH_TOTAL).toBe(8)
    expect(a).toHaveLength(8)
    expect(a.map((x) => x.id)).toEqual(dealBoard(POOL, 42).map((x) => x.id))
    expect(dealBoard(POOL, 7).map((x) => x.id)).not.toEqual(a.map((x) => x.id))
  })
  it('takes the setups round robin, so eight from three setups is three, three and two', () => {
    const counts = {}
    for (const it of dealBoard(POOL, 42)) counts[it.name] = (counts[it.name] || 0) + 1
    expect(Object.values(counts).sort()).toEqual([2, 3, 3])
    // the first three charts are one of each setup
    expect(new Set(dealBoard(POOL, 42).slice(0, 3).map((x) => x.name)).size).toBe(3)
  })
  it('keeps each chart once, drops a chart with fewer than two bars, and deals a thin pool whole', () => {
    const thin = [item('a', 's1', 'Kicker'), item('a', 's1', 'Kicker'), { ...item('c', 's2', 'Oops Reversal'), bars: [bars(1)[0]] }, item('d', 's3', 'Bear gap'), null]
    const got = dealBoard(thin, 3)
    expect(got.map((x) => x.id).sort()).toEqual(['a', 'd'])
    expect(dealBoard([], 3)).toEqual([])
    expect(dealBoard(undefined, 3)).toEqual([])
    expect(dealBoard(POOL, 3, 5)).toHaveLength(5)
  })
})

describe('what a chart posts', () => {
  it("a flag is Hard mode's Yes for the chart's own setup, a pass its \"Nothing fired\"", () => {
    expect(watchAnswer(KICKER, true)).toEqual({ choice: 'Yes', picked_setup: 'Kicker' })
    expect(watchAnswer(KICKER, false)).toEqual({ choice: 'No', picked_setup: NOTHING })
    expect(watchAnswer(KICKER, true, 'Y', 'N')).toEqual({ choice: 'Y', picked_setup: 'Kicker' })
  })
  it('shares the board time across its charts', () => {
    expect(perChartMs(80000, 8)).toBe(10000)
    expect(perChartMs(1001, 2)).toBe(501)
    expect(perChartMs(-5, 8)).toBe(0)
    expect(perChartMs(NaN, 8)).toBe(0)
    expect(perChartMs(900, 0)).toBe(900)
  })
})

describe('a chart, checked', () => {
  it('a flag on a chart that fired is right, and says what fired, where and when', () => {
    expect(readChart(KICKER, true, att(true, { answer: 'yes' }))).toEqual({ scored: true, flagged: true, right: true, fired: true, truth: 'Kicker', ticker: 'JBI', asof: '2025-03-04', xp: 10 })
  })
  it('a flag where nothing fired is a miss, and the key says nothing fired', () => {
    const r = readChart(KICKER, true, att(false, { answer: 'no' }))
    expect(r).toMatchObject({ right: false, fired: false, truth: NOTHING, xp: 0 })
  })
  it('a pass where the setup fired is a miss; a pass where nothing fired is right', () => {
    expect(readChart(KICKER, false, att(false, { answer: 'yes' }))).toMatchObject({ right: false, fired: true, truth: 'Kicker' })
    expect(readChart(KICKER, false, att(true, { answer: 'no' }))).toMatchObject({ right: true, fired: false, truth: NOTHING })
  })
  it('without a yes / no key in the reveal, reads what fired from the verdict on what was posted', () => {
    expect(readChart(KICKER, true, att(true, null)).fired).toBe(true)
    expect(readChart(KICKER, true, att(false, null)).fired).toBe(false)
    expect(readChart(KICKER, false, att(true, null)).fired).toBe(false)
    expect(readChart(KICKER, false, att(false, null)).fired).toBe(true)
  })
  it('a failed attempt is not scored, so it is never counted as a miss', () => {
    expect(readChart(KICKER, true, null)).toMatchObject({ scored: false, flagged: true, right: null, fired: null })
    expect(chartHead(readChart(KICKER, true, null), 'Kicker')).toBe('Not checked')
  })
  it('heads each chart with what fired, or that nothing did', () => {
    expect(chartHead(readChart(KICKER, true, att(true, { answer: 'yes' })), 'Kicker')).toBe('Kicker fired')
    expect(chartHead(readChart(KICKER, false, att(true, { answer: 'no' })), 'Kicker')).toBe(NOTHING)
  })
})

// the board of the component's test: three fired (k1, o1, b1), five where nothing did
const BOARD = [{ name: 'Kicker' }, { name: 'Launchpad' }, { name: 'Oops Reversal' }, { name: 'Slingshot' }, { name: 'Bear gap' }, { name: 'Gap Support' }, { name: 'High Volume Edge' }, { name: 'Kicker' }]
const row = (flagged, fired, extra = {}) => ({ scored: true, flagged, fired, right: flagged === fired, truth: fired ? 'X' : NOTHING, ticker: 'JBI', asof: '2025-03-04', xp: flagged === fired ? 10 : 0, ...extra })

describe('the board, counted', () => {
  // flagged 0 (fired), 1 (nothing), 2 (fired); passed 4 (fired) and the rest (nothing); chart 7 failed to check
  const rows = [row(true, true), row(true, false), row(true, true), row(false, false), row(false, true), row(false, false), row(false, false), { scored: false, flagged: false }]
  const t = tally(rows)
  it('counts calls, picks, passes, what fired and what was caught, over the charts that were checked', () => {
    expect(t).toEqual({ total: 7, right: 5, picks: 3, picksRight: 2, passes: 4, passesRight: 3, fired: 3, caught: 2, unscored: 1, xp: 50 })
  })
  it('the verdict: a clean board, a clean board where nothing fired, a board with misses, a board never checked', () => {
    expect(boardVerdict(t)).toEqual({ ok: false, title: '5 of 7 called right.', stamp: null })
    expect(boardVerdict(tally([row(true, true), row(false, false)]))).toEqual({ ok: true, title: 'Clean scan. You caught the one that fired.', stamp: 'Clean' })
    expect(boardVerdict(tally([row(true, true), row(true, true), row(false, false)])).title).toBe('Clean scan. You caught all 2.')
    expect(boardVerdict(tally([row(false, false), row(false, false)]))).toEqual({ ok: true, title: 'Nothing fired. Right to sit on your hands.', stamp: 'Clean' })
    expect(boardVerdict(tally([{ scored: false }]))).toEqual({ ok: false, title: 'Your list could not be checked.', stamp: null })
  })
  it('says the list and the board in two lines, and owns up to a chart that was not checked', () => {
    expect(summaryLines(t)).toEqual(['Your list: 3 picks, 2 fired.', '3 of 7 fired on this board. You caught 2.', '1 chart could not be checked and is left out.'])
    expect(summaryLines(tally([row(false, false)]))).toEqual(['Your list: empty. You passed on every chart.', 'Nothing fired on this board.'])
    expect(summaryLines(tally([]))).toEqual([])
  })
  it('a board where no chart could be checked says so, and offers the board back instead of a run', () => {
    const none = tally([{ scored: false, flagged: true }, { scored: false, flagged: false }, { scored: false, flagged: false }])
    expect(none).toMatchObject({ total: 0, unscored: 3 })
    expect(boardVerdict(none).title).toBe('Your list could not be checked.')
    expect(summaryLines(none)).toEqual(['None of the 3 charts could be checked.', 'Check your connection and try again.'])
    expect(summaryLines(tally([{ scored: false }]))).toEqual(['The chart could not be checked.', 'Check your connection and try again.'])
    expect(takeoverLabel(none, -1)).toBe('Back to the board')
    expect(takeoverLabel(t, firstMiss(rows))).toBe('See the misses')
    expect(takeoverLabel(tally([row(true, true)]), -1)).toBe('See what came next')
  })
  it('walks the review over the checked charts only, either way', () => {
    // 0 checked, 1 not, 2 checked, 3 not, 4 checked
    const mix = [row(true, true), { scored: false }, row(false, false), { scored: false }, row(false, true)]
    expect(scoredStep(mix, 0, 1)).toBe(2)
    expect(scoredStep(mix, 2, 1)).toBe(4)
    expect(scoredStep(mix, 4, 1)).toBe(-1)
    expect(scoredStep(mix, 4, -1)).toBe(2)
    expect(scoredStep(mix, 2, -1)).toBe(0)
    expect(scoredStep(mix, 0, -1)).toBe(-1)
    expect(scoredStep(null, 0, 1)).toBe(-1)
  })
  it("the card's way in names what is behind it: the lesson on a miss, the trade on a setup, why on a quiet chart", () => {
    expect(openLabel(row(true, true))).toBe('See the trade')
    expect(openLabel(row(false, false))).toBe('See why')
    expect(openLabel(row(true, false))).toBe('See the lesson')
    expect(openLabel(row(false, true))).toBe('See the lesson')
    expect(openLabel({ scored: false })).toBe('')
  })
  it('names the misses, two at most, the rest counted, and finds the first', () => {
    expect(missLines(BOARD, rows)).toEqual(['Chart 2: nothing fired, you flagged it.', 'Chart 5: a Bear gap fired, you passed.'])
    expect(missLines(BOARD, rows, 1)).toEqual(['Chart 2: nothing fired, you flagged it.', 'And 1 more on the board.'])
    expect(missLines(BOARD, [row(false, true)])).toEqual(['Chart 1: a Kicker fired, you passed.'])
    expect(firstMiss(rows)).toBe(1)
    expect(firstMiss([row(true, true)])).toBe(-1)
  })
  it('the end note: picks right of the picks made, and the board', () => {
    expect(endNote(t)).toBe('Picks right: 2 of 3. 3 fired on the board and you caught 2.')
    expect(endNote(tally([row(false, false)]))).toBe('You passed on every chart. Nothing fired on the board.')
    expect(endNote(tally([]))).toBe('')
  })
  it('logs each checked chart with its ticker and date, and on a miss what was said', () => {
    const log = logRows(BOARD, [row(true, true, { truth: 'Kicker' }), row(true, false), row(false, true, { truth: 'Oops Reversal', ticker: '', asof: null }), { scored: false }])
    expect(log).toEqual([
      { name: 'Kicker', ticker: 'JBI · Mar 4, 2025', ok: true, said: null },
      { name: NOTHING, ticker: 'JBI · Mar 4, 2025', ok: false, said: 'a setup fired' },
      { name: 'Oops Reversal', ticker: '', ok: false, said: 'nothing fired' },
    ])
  })
})

describe('the move after the last candle, measured', () => {
  const sig = { c: 100, h: 101, l: 97 }
  const fwd = [{ h: 103, l: 99, c: 102 }, { h: 112, l: 101, c: 110 }, { h: 108, l: 95, c: 96 }, { h: 130, l: 94, c: 128 }]
  it('fired, long: the best high while the setup was alive (the close under the signal low ends it)', () => {
    const m = moveOf(sig, fwd, { fired: true })
    expect(m).toEqual({ kind: 'peak', short: false, pct: expect.closeTo(12, 6), sessions: 2, broke: 3 })
    expect(moveLabel(m)).toBe('Best move: +12.0% in 2 sessions')
  })
  it('fired, short: the best low until a close over the signal high', () => {
    const m = moveOf({ c: 100, h: 104, l: 97 }, [{ h: 101, l: 96, c: 97 }, { h: 99, l: 92.5, c: 93 }, { h: 106, l: 98, c: 105 }], { fired: true, short: true })
    expect(m).toEqual({ kind: 'peak', short: true, pct: expect.closeTo(-7.5, 6), sessions: 2, broke: 3 })
    expect(moveLabel(m)).toBe('Best move: fell 7.5% in 2 sessions')
  })
  it('a setup that never went its way says so', () => {
    expect(moveLabel({ kind: 'peak', short: false, pct: -1, sessions: 1 })).toBe('Never traded over the signal close')
    expect(moveLabel({ kind: 'peak', short: true, pct: 0.4, sessions: 1 })).toBe('Never traded under the signal close')
  })
  it('nothing fired: the plain change from the last close to the last bar shown', () => {
    const m = moveOf(sig, fwd)
    expect(m).toEqual({ kind: 'drift', short: false, pct: expect.closeTo(28, 6), sessions: 4 })
    expect(moveLabel(m)).toBe('Next 4 sessions: +28.0%')
    expect(moveLabel({ kind: 'drift', pct: -3.04, sessions: 1 })).toBe('Next 1 session: −3.0%')
  })
  it('nothing to measure says nothing', () => {
    expect(moveOf(sig, [])).toBe(null)
    expect(moveOf(null, fwd)).toBe(null)
    expect(moveOf({ c: 0 }, fwd)).toBe(null)
    expect(moveLabel(null)).toBe('')
  })
  it('marks the best point in the focused review the way Hard mode does', () => {
    const plan = { kind: 'plan', long: true, bestSessions: 3, advancePct: 18.24 }
    expect(focusPeak(plan, null, 60, 2)).toBe(null)
    expect(focusPeak(plan, null, 60, 3)).toEqual({ index: 62, text: '+18.2% from entry in 3 sessions' })
    expect(focusPeak({ kind: 'plan', long: false, bestSessions: 1, advancePct: 6.5 }, null, 60, 1)).toEqual({ index: 60, text: 'fell 6.5% from entry in 1 session' })
    expect(focusPeak(null, { offset: 1, sessions: 2, pct: 12 }, 60, 2)).toEqual({ index: 61, text: '+12.0% in 2 sessions' })
    expect(focusPeak(null, { offset: 1, sessions: 2, pct: 12 }, 60, 1)).toBe(null)
    expect(focusPeak(null, null, 60, 5)).toBe(null)
  })
  it("the card's line says what the focused review draws: the plan's best from the entry, a stop-out, or the culmination", () => {
    // the Kicker plan of the component's test, reviewed: best 14.5 against an entry of 13.11, on the second session
    const plan = { kind: 'plan', long: true, bestSessions: 2, advancePct: (14.5 / 13.11 - 1) * 100, stoppedSession: null }
    expect(moveLine({ fired: true, trade: plan })).toBe('Best move: +10.6% from entry in 2 sessions')
    expect(moveLine({ fired: true, trade: { kind: 'plan', long: false, bestSessions: 1, advancePct: 6.5 } })).toBe('Best move: fell 6.5% from entry in 1 session')
    expect(moveLine({ fired: true, trade: { kind: 'plan', long: true, bestSessions: null, stoppedSession: 2 } })).toBe('Stopped out in 2 sessions')
    expect(moveLine({ fired: true, trade: { kind: 'signal' }, culm: { pct: 12, sessions: 2 } })).toBe('Best move: +12.0% in 2 sessions')
    expect(moveLine({ fired: true, culm: { pct: -7.5, sessions: 2 }, short: true })).toBe('Best move: fell 7.5% in 2 sessions')
    expect(moveLine({ fired: false, drift: { kind: 'drift', pct: 2.04, sessions: 20 } })).toBe('Next 20 sessions: +2.0%')
    expect(moveLine({ fired: true })).toBe('')
    expect(moveLine({ fired: null })).toBe('')
  })
  it("runs a card on to Hard mode's length, stretched to the plan's best (or its stop), never past the strip", () => {
    // Hard mode's length: at least 12, to the culmination and five past it; nothing fired runs 30
    expect(cardRun(20, { fired: true, culm: { offset: 1 } })).toBe(12)
    expect(cardRun(80, { fired: true, culm: { offset: 20 } })).toBe(26)
    expect(cardRun(80, { fired: false })).toBe(30)
    expect(cardRun(12, { fired: false })).toBe(12)
    // the plan peaked on session 30: the card runs to it and five past it
    expect(cardRun(80, { fired: true, culm: { offset: 1 }, trade: { kind: 'plan', bestSessions: 30 } })).toBe(35)
    expect(cardRun(32, { fired: true, culm: { offset: 1 }, trade: { kind: 'plan', bestSessions: 30 } })).toBe(32)
    expect(cardRun(80, { fired: true, culm: { offset: 1 }, trade: { kind: 'plan', bestSessions: null, stoppedSession: 3 } })).toBe(12)
    expect(cardRun(0, { fired: true })).toBe(0)
  })
  it('knows which setups are short', () => {
    expect(isShort({ name: 'Bear gap' })).toBe(true)
    expect(isShort({ name: 'Kicker' })).toBe(false)
  })
})

describe('the words', () => {
  it('reads the date the reveal sends, either way it comes', () => {
    expect(dateLabel('2025-03-04')).toBe('Mar 4, 2025')
    expect(dateLabel(20251231)).toBe('Dec 31, 2025')
    expect(dateLabel('1996-03-04T00:00:00')).toBe('Mar 4, 1996')
    expect(dateLabel('2025-13-04')).toBe('')
    expect(dateLabel('soon')).toBe('')
    expect(dateLabel(null)).toBe('')
    expect(whereLabel({ ticker: 'JBI', asof: '2025-03-04' })).toBe('JBI · Mar 4, 2025')
    expect(whereLabel({ ticker: '', asof: '2025-03-04' })).toBe('Mar 4, 2025')
  })
  it("takes the chart's line from the bank's own lesson, never writing one", () => {
    const fired = { scored: true, fired: true }
    const none = { scored: true, fired: false }
    expect(chartNote(fired, 'Kicker: the day before closes red; then the next day gaps up. Here the stock gapped 4.9% over the red day and closed near its high. Volume was 2.1x.', 'Kicker'))
      .toBe('Here the stock gapped 4.9% over the red day and closed near its high.')
    expect(chartNote(none, "Launchpad: the firm's detector does not fire on the last bar of this chart. the close sat 0.4% under the 50-day. More text.", 'Launchpad'))
      .toBe('Not a Launchpad: the close sat 0.4% under the 50-day.')
    expect(chartNote(fired, 'Kicker: a rule with no chart line.', 'Kicker')).toBe('')
    // a reason that opens on a ticker or a shorthand keeps its capitals ("RVOL", never "rVOL")
    expect(chartNote(none, "Kicker: the firm's detector does not fire on the last bar of this chart. RVOL was 1.1x, under the 1.5x it asks for.", 'Kicker'))
      .toBe('Not a Kicker: RVOL was 1.1x, under the 1.5x it asks for.')
    expect(chartNote(none, '', 'Kicker')).toBe('')
    expect(chartNote({ scored: false }, 'Kicker: x. Here y.', 'Kicker')).toBe('')
  })
  it('counts the flags, says the bank, heads the focused chart and says the call back', () => {
    expect(boardCounts([true, false, true, false, false])).toEqual({ charts: 5, flagged: 2, passed: 3 })
    expect(boardCounts(undefined)).toEqual({ charts: 0, flagged: 0, passed: 0 })
    expect(bankLine(8)).toBe('8 charts from the UCT bank, a fresh board every run')
    expect(bankLine(3)).toBe('The bank has 3 charts ready, so this board has 3')
    expect(bankLine(0)).toBe('')
    expect(startLead(8)).toBe('Sunday night, eight charts, tickers hidden. Flag each one where one of our setups fired on the last candle and pass on the rest. Then see what came next.')
    expect(startLead(5)).toMatch(/^Sunday night, 5 charts, tickers hidden\./)
    expect(startLead(0)).toMatch(/^Sunday night, eight charts/)
    expect(focusTitle({ scored: true, fired: true }, 'Oops Reversal')).toBe('An Oops Reversal fired.')
    expect(focusTitle({ scored: true, fired: true }, 'Kicker')).toBe('A Kicker fired.')
    expect(focusTitle({ scored: true, fired: false }, 'Kicker')).toBe('Nothing fired.')
    expect(focusTitle({ scored: false }, 'Kicker')).toBe('Not checked.')
    expect(callLine({ scored: true, flagged: true, right: true })).toBe('You flagged it. Right call.')
    expect(callLine({ scored: true, flagged: true, right: false })).toBe('You flagged it, but nothing fired.')
    expect(callLine({ scored: true, flagged: false, right: true })).toBe('You passed. Right call.')
    expect(callLine({ scored: true, flagged: false, right: false })).toBe('You passed, but it fired.')
    expect(callLine({ scored: false })).toBe('This chart could not be checked.')
  })
  it('the prompt is honest about the count, says which setups it means, and says when the board is thin', () => {
    const full = boardPrompt(8)
    expect(full.eyebrow).toBe('Weekend Watchlist · 8 charts · tickers hidden')
    expect(full.q).toBe('Which of these fired on the last candle?')
    expect(full.detail).toBe('Flag every chart where one of our setups fired on its last candle and pass on the rest. '
      + 'Our setups: Kicker, Launchpad, Slingshot, Oops Reversal, High Volume Edge, Gap Support and Bear gap. '
      + 'There is no set number: it could be none of them, or all 8.')
    expect(full.detail).not.toContain('The bank had')
    expect(boardPrompt(5).detail).toContain('The bank had 5 charts ready, so this board has 5.')
    expect(boardPrompt(1).eyebrow).toBe('Weekend Watchlist · 1 chart · tickers hidden')
    expect(boardPrompt(1).detail).toContain('There is no set number: it could be this one or none.')
    // the list is the bank's own setups (the seven the Hard pool is swept against), every one of them named
    for (const name of SETUP_NAMES) expect(full.detail).toContain(name)
    expect(setupList(['A', 'B', 'C'])).toBe('A, B and C')
    expect(setupList(['A'])).toBe('A')
    expect(setupList([])).toBe('')
    // VOICE.md: a question's sentence is 22 words at most
    for (const p of [full, boardPrompt(5), boardPrompt(1)]) {
      for (const sentence of `${p.q} ${p.detail}`.split(/(?<=[.?])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(22)
    }
  })
  it('never says "the firm", never uses a long dash, never shouts', () => {
    const t = tally([row(true, true), row(true, false), row(false, true)])
    const copy = [
      ...Object.values(boardPrompt(8)), ...Object.values(boardPrompt(3)), boardVerdict(t).title, ...summaryLines(t), ...missLines(BOARD, [row(true, false), row(false, true)]),
      endNote(t), moveLabel({ kind: 'drift', pct: 2, sessions: 20 }), chartNote({ scored: true, fired: false }, "Kicker: the firm's detector does not fire on the last bar of this chart. weak close.", 'Kicker'),
      startLead(8), startLead(3), bankLine(8), bankLine(3), focusTitle({ scored: true, fired: true }, 'Kicker'), ...[true, false].flatMap((f) => [true, false].map((ok) => callLine({ scored: true, flagged: f, right: ok }))),
      moveLine({ fired: true, trade: { kind: 'plan', long: true, bestSessions: 2, advancePct: 4 } }), moveLine({ fired: true, trade: { kind: 'plan', stoppedSession: 1 } }),
      ...summaryLines(tally([{ scored: false }, { scored: false }])), takeoverLabel(tally([{ scored: false }])), takeoverLabel(t, 0), takeoverLabel(tally([row(true, true)])),
      openLabel(row(true, true)), openLabel(row(false, false)), openLabel(row(true, false)), boardPrompt(1).detail,
    ].join(' ')
    expect(copy).not.toMatch(/\bfirm\b/i)
    expect(copy).not.toMatch(/—|–/)
    expect(copy).not.toMatch(/!/)
    expect(WATCH_KIND).toBe('watchlist')
  })
})
