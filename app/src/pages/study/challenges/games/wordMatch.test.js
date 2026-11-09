/**
 * Word Match's pure half (docs/study/GAMES.md §1 rule 6): the pool read and checked (the plain checks, then each pair's
 * own question), the rounds packed with no two look-alike meanings together, the deal from a seed, every tap of a run
 * (select, drop, match, a miss charged to the pair the member started from), the lesson a miss teaches, the keys, the
 * clock that counts up, holds and takes a penalty, the best on this device and the end screen's lines. Known values
 * throughout, and two rails over the real course files: the unit names and the whole vocabulary corpus.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import {
  CLOCK0, EMPTY_RUN, MATCH_DRAWS, MATCH_PENALTY_MS, MATCH_PER_ROUND, MATCH_POOL_SIZE, MATCH_ROUNDS, MISS_TITLE, UNIT_OF_SKILL,
  bestKeyOf, bestLine, bestOf, clockAt, clockText, clockWords, dealRun, drawPairs, holdClock, inLine, isFatalCheck, isNewBest,
  keyPick, levelOf, lookAlike,
  meaningProblem, meaningPromptProblem, mentions, missLesson, missLine, narrowedTo, nextRound, paceOf, pairOf, pairsOf, penalize,
  pick, planRounds, rngOf, roundsWord, runClock, runIdOf, startRun, stemsOf, streakOf, tallyOf, totalOf, unitOf, verifyPairs,
} from './wordMatch'

const P = (id, term, meaning, skill = 'vocab.chart_terms') => ({ id, term, meaning, skill })
/** An item's prompt as GET /api/study/items/{id} returns it (no key, no subject). */
const item = (q, choices, extra = {}, top = {}) => ({ id: 'si_x', version: 1, type: 'recall', skill_id: 'vocab.chart_terms', has_chart: false, prompt_json: { q, kind: 'mcq', choices, ...extra }, ...top })
const DISTRACT = ['Lower highs and lower lows', 'A close above yesterday', 'Price above last year']
const mcqFor = (pair, q) => item(q, [pair.meaning, ...DISTRACT])

// fifteen distinct pairs from the real vocabulary units, none alike
const FIFTEEN = [
  P('up', 'Uptrend', 'Higher highs and higher lows'),
  P('sup', 'Support', 'Where buyers tend to stop a fall'),
  P('bo', 'Breakout', 'A move through resistance or support'),
  P('pb', 'Pullback', 'A short dip inside an uptrend'),
  P('doji', 'Doji', 'Open and close about equal', 'vocab.candle_terms'),
  P('ham', 'Hammer', 'Long lower shadow after a decline', 'vocab.candle_terms'),
  P('in', 'Inside day', 'High and low inside the prior range', 'vocab.candle_terms'),
  P('mkt', 'Market order', 'Trade now at the best price available', 'vocab.order_terms'),
  P('slip', 'Slippage', 'Your fill vs. the price you expected', 'vocab.order_terms'),
  P('sq', 'Short squeeze', 'Shorts rushing to cover lift the price', 'vocab.order_terms'),
  P('dd', 'Drawdown', 'A drop from a peak to a low', 'vocab.risk_terms'),
  P('heat', 'Portfolio heat', 'Total open risk across your trades', 'vocab.risk_terms'),
  P('gap', 'Gap risk', 'Price opens past your stop', 'vocab.risk_terms'),
  P('eps', 'EPS', 'Net income per share', 'vocab.fund_terms'),
  P('fomo', 'FOMO', 'Fear of missing out', 'vocab.psych_terms'),
]

describe('the plain checks', () => {
  it('names why a pair cannot be a word and its meaning, with the real cases from the pool', () => {
    expect(meaningProblem('timeframe', 'True')).toBe('one word')                          // a true/false item
    expect(meaningProblem('double top', 'double')).toBe('one word')                       // a fill-in
    expect(meaningProblem('Morning star', '3')).toBe('a number')                          // "How many bars make a Morning star?"
    expect(meaningProblem('Basis point', '0.01 percentage point')).toBeNull()
    expect(meaningProblem('Earnings call', 'The earnings call')).toBe('names the word')    // an item read backwards
    expect(meaningProblem('Trading range', 'trading range')).toBe('names the word')
    expect(meaningProblem('ATR', 'A quarter ATR under the lower average')).toBe('names the word')
    expect(meaningProblem('R', 'Your planned loss, entry to stop')).toBeNull()            // "r" is not a word inside "your"
    expect(meaningProblem('breakout volume', 'A, on heavy volume')).toBe('an option letter')
    expect(meaningProblem('relative strength', 'A: it fell less than the index')).toBe('an option letter')
    expect(meaningProblem('A stock', 'A stock outperforming the market')).toBe('names the word')
    expect(meaningProblem('Leader', 'A stock outperforming the market')).toBeNull()
    expect(meaningProblem('higher low', 'Just under $33')).toBe('a price')
    expect(meaningProblem('Gap Support', '$49.60, today\'s low')).toBe('a price')
    expect(meaningProblem('Delta', 'Its move per $1 move in the stock')).toBeNull()        // a plain $1 is part of a meaning
    expect(meaningProblem('', 'Higher highs')).toBe('empty')
    expect(meaningProblem('Base', 'x '.repeat(70))).toBe('too long')
  })

  it('keeps each pair once, cleaned for print, and drops what is not a pair', () => {
    const items = [
      { id: 'up', term: 'uptrend', meaning: 'higher highs and higher lows' },
      { id: 'tf', term: 'timeframe', meaning: 'True' },
      { id: 'ec', term: 'Earnings call', meaning: 'The earnings call' },
      { id: 'up', term: 'Support', meaning: 'Where buyers tend to stop a fall' },           // the same id again
      { id: 'up2', term: 'UPTREND', meaning: 'Price rising over time' },                    // the same word again
      { id: 'pb', term: 'pullback', meaning: 'Higher Highs and Higher Lows' },              // the same meaning again
      { id: 'firm', term: 'Base', meaning: "the firm's word for a sideways range — weeks long" },
      { id: 'V.02#q01', term: 'V.02#q01', meaning: 'A course key, not a word' },
      { id: '', term: 'Empty', meaning: 'No id at all' },
      { id: 'n', term: 5, meaning: 'Not a word' },
      null, 'text',
    ]
    expect(pairsOf(items)).toEqual([
      { id: 'up', term: 'Uptrend', meaning: 'Higher highs and higher lows' },
      { id: 'firm', term: 'Base', meaning: "UCT's word for a sideways range, weeks long" },
    ])
    expect(pairsOf(null)).toEqual([])
    expect(pairsOf({ items: [] })).toEqual([])
  })

  it('sets aside a meaning that reads exactly as another pair\'s word (the two columns never show the same text)', () => {
    const out = pairsOf([
      { id: 'coil', term: 'Coil', meaning: 'Symmetrical triangle' },
      { id: 'tri', term: 'Symmetrical triangle', meaning: 'Two lines closing in on each other' },
    ])
    expect(out.map((p) => p.id)).toEqual(['tri'])
  })
})

describe("each pair's own question", () => {
  it('accepts the questions that ask what a word means (real course questions)', () => {
    const real = [
      ['Uptrend', 'On a chart, what makes an uptrend?', 'Higher highs and higher lows'],
      ['Extended', 'When we call a stock extended, what do we mean?', 'Stretched far above its moving averages'],
      ['Market order', 'What does a market order tell your broker?', 'Trade now at the best price available'],
      ['Time in force', 'On an order ticket, what does the time in force set?', 'How long the order stays live'],
      ['Year over year (YoY)', 'What does YoY mean on an earnings release?', 'Vs. the same period a year earlier'],
      ['Unemployment rate', 'How does BLS define the unemployment rate?', 'Unemployed as a share of the labor force'],
      ['Dual mandate', "People call the Fed's job a dual mandate. Which two goals does that mean?", 'Maximum employment and stable prices'],
      ['Stop-loss', 'What job does the stop-loss do in your plan?', 'Sets your planned exit if wrong'],
      ['Rolling', 'What does it mean to roll an option position?', 'Close it, open a new strike or date'],
      ['R', 'What does R mean on a trade?', 'Your planned loss, entry to stop'],
      ['Spinning top', 'What does a spinning top look like?', 'Small body, shadows longer than it'],
      ['Hollow candle', 'On a standard candlestick chart, what does a hollow (or green) body tell you?', 'It closed above its open'],
      ['New high', 'On a breadth page, what counts as a new high?', 'A stock at its highest price in a year'],
    ]
    for (const [term, q, meaning] of real) expect(meaningPromptProblem(mcqFor(P('x', term, meaning), q), P('x', term, meaning)), q).toBeNull()
    // a glossary item from the bank carries no kind: still a choice question
    const g = P('g', 'Higher low', 'A pullback that bottoms above the last one')
    expect(meaningPromptProblem(item('At the desk, what does “higher low” mean?', [g.meaning, ...DISTRACT], { kind: undefined }), g)).toBeNull()
  })

  it('rejects everything else, by name', () => {
    const p = P('x', 'Rounding bottom', 'The weekly chart')
    const at = (q, extra, top) => meaningPromptProblem(item(q, [p.meaning, ...DISTRACT], extra, top), p)
    expect(at('Which chart shows a rounding bottom best?')).toBe('asks something else')
    expect(at('When do the minutes of a rounding bottom come out?')).toBe('asks something else')
    expect(at('What happens to a rounding bottom after it ends?')).toBe('asks something else')
    expect(at('What is a rounding bottom?', { kind: 'tf' })).toBe('not a choice question')
    expect(at('What is a rounding bottom?', { kind: 'fill' })).toBe('not a choice question')
    expect(at('What is a rounding bottom?', { kind: 'fill_numeric' })).toBe('not a choice question')
    expect(at('What is a rounding bottom?', { story: 'A stock bases for six months.' })).toBe('a scenario')
    expect(at('What is a rounding bottom?', {}, { has_chart: true })).toBe('a chart question')
    expect(at('What is a rounding bottom?', { choices: DISTRACT })).toBe('not among its choices')
    expect(at('', {})).toBe('no question')
    const put = P('x', 'Put option', 'Put')
    expect(meaningPromptProblem(item('Which word is this: the right to sell 100 shares at a set price until a set date?', ['Put', 'Call', 'Strike', 'Premium']), put)).toBe('asks for a word')
    const call = P('x', 'Earnings call', 'The earnings call')
    expect(meaningPromptProblem(item("After the release, management takes analysts' questions live. What is that event?", [call.meaning, ...DISTRACT]), call)).toBe('asks for a word')
    const note = P('x', 'Treasury note', 'A Treasury note')
    expect(meaningPromptProblem(item('Traders talk about the 10-year. What type of Treasury security is it?', [note.meaning, ...DISTRACT]), note)).toBe('asks for a word')
    const qoq = P('x', 'Quarter over quarter (QoQ)', 'Q3 with Q2 of the same fiscal year')
    expect(meaningPromptProblem(item("NVIDIA's table shows Q3 fiscal 2026 revenue up 22% in the Q/Q column. What does Q/Q compare?", [qoq.meaning, ...DISTRACT]), qoq)).toBe('about another word')
    const callOpt = P('x', 'Call option', 'The right to buy at the strike')
    expect(meaningPromptProblem(item('What does buying a call give you?', [callOpt.meaning, ...DISTRACT]), callOpt)).toBe('about another word')
    expect(meaningPromptProblem(null, p)).toBe('no item')
  })

  it('sets aside a meaning its question narrowed to one side: true there, wrong beside the bare word (V.08#q09, V.04#q18)', () => {
    const itm = P('x', 'In the money', 'The stock is above the strike')          // a put is in the money BELOW the strike
    expect(meaningPromptProblem(mcqFor(itm, 'What does in the money mean for a call?'), itm)).toBe('one side only')
    expect(narrowedTo('What does in the money mean for a call?', 'In the money')).toBe('call')
    const neck = P('x', 'Neckline', 'Line through the lows between peaks')        // a bottom's neckline runs through the highs
    expect(meaningPromptProblem(mcqFor(neck, 'In a head and shoulders top, what is the neckline?'), neck)).toBe('one side only')
    expect(narrowedTo('In a head and shoulders top, what is the neckline?', 'Neckline')).toBe('top')
    // a side the word itself names is no narrowing, and "call" the verb is not an option
    const kept = [
      ['Double bottom', 'What does double bottom mean?', 'Two similar lows with a peak between'],
      ['Spinning top', 'What does a spinning top look like?', 'Small body, shadows longer than it'],
      ['Bottom line', 'What does the bottom line mean on an income statement?', 'Net income, after all expenses'],
      ['Protective put', 'What is a protective put?', 'A put bought to hedge stock you own'],
      ['Extended', 'When we call a stock extended, what do we mean?', 'Stretched far above its moving averages'],
      ['Hawk', 'On the Fed, what does it mean to call an official a hawk?', 'Favors tighter policy to curb inflation'],
      ['Lip', "On a cup with handle, what is a lip?", "A high at the cup's top edge"],
    ]
    for (const [term, q, meaning] of kept) expect(meaningPromptProblem(mcqFor(P('x', term, meaning), q), P('x', term, meaning)), q).toBeNull()
    expect(narrowedTo('', 'Neckline')).toBeNull()
  })

  it('finds the word in its question: whole, by its bracket, or by its parts, and never a letter inside a word', () => {
    expect(mentions('What does R mean on a trade?', 'R')).toBe(true)
    expect(mentions('What does risk mean on a trade?', 'R')).toBe(false)
    expect(mentions('What does YoY mean on an earnings release?', 'Year over year (YoY)')).toBe(true)
    expect(mentions('What does the year over year column show?', 'Year over year (YoY)')).toBe(true)
    expect(mentions('On a standard candlestick chart, what does a hollow (or green) body tell you?', 'Hollow candle')).toBe(true)
    expect(mentions('What does it mean to roll an option position?', 'Rolling')).toBe(true)
    expect(mentions('What does volatility-based position sizing do?', 'Volatility-based sizing')).toBe(true)
    expect(mentions('What does Q/Q compare?', 'Quarter over quarter (QoQ)')).toBe(false)
    expect(mentions('', 'R')).toBe(false)
  })
})

describe('verifyPairs', () => {
  const pairs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => P(id, `Word ${id}`, `The meaning of word ${id}`))
  const prompts = {
    a: item('What is word a?', ['The meaning of word a']), b: item('Which chart shows word b best?', ['The meaning of word b']),
    d: item('What is word d?', ['The meaning of word d'], {}, { skill_id: 'vocab.risk_terms' }), f: item('What does word f mean?', ['The meaning of word f']),
    g: item('What is word g?', ['The meaning of word g']),
  }
  const err = (status) => Object.assign(new Error(String(status)), { status })
  const fetchPrompt = (fails = {}) => vi.fn(async (id) => { if (fails[id]) throw err(fails[id]); return prompts[id] })

  it('checks one at a time until enough pass, sets aside a failed check and an un-approved item, and keeps the pool\'s order', async () => {
    const f = fetchPrompt({ c: 500, e: 404 })
    const out = await verifyPairs(pairs, f, { want: 3, concurrency: 1 })
    expect(out.pairs.map((p) => p.id)).toEqual(['a', 'd', 'f'])
    expect(out.pairs[1].skill).toBe('vocab.risk_terms')                   // the skill rides along for the lesson's unit
    expect(out.failed).toBe(1)                                             // the 500; a 404 is a rejection, not a failure
    expect(out.fatal).toBeNull()
    expect(f.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])   // g is never asked for
  })

  it('never has more checks in flight than it is allowed', async () => {
    let inFlight = 0, most = 0
    const slow = vi.fn(async (id) => { inFlight += 1; most = Math.max(most, inFlight); await Promise.resolve(); await Promise.resolve(); inFlight -= 1; return prompts[id] || prompts.a })
    const out = await verifyPairs(pairs, slow, { want: 99, concurrency: 2 })
    expect(most).toBe(2)
    expect(slow).toHaveBeenCalledTimes(7)
    expect(out.pairs.map((p) => p.id)).toEqual(['a', 'd', 'f', 'g'])      // c and e fall back to prompt a, whose meaning is not theirs
  })

  it('stops the whole draw on a refusal (signed out, unpaid), and keeps nothing', async () => {
    const out = await verifyPairs(pairs, fetchPrompt({ b: 401 }), { want: 5, concurrency: 1 })
    expect(out.fatal?.status).toBe(401)
    expect(out.pairs).toEqual([])
    expect(isFatalCheck(err(402))).toBe(true)
    expect(isFatalCheck(err(403))).toBe(true)
    expect(isFatalCheck(err(404))).toBe(false)
    expect(isFatalCheck(err(500))).toBe(false)
  })

  it('remembers each verdict across draws, but asks again after a failed check', async () => {
    const cache = new Map()
    const first = fetchPrompt({ c: 500 })
    await verifyPairs(pairs.slice(0, 4), first, { want: 9, concurrency: 1, cache })
    expect(first).toHaveBeenCalledTimes(4)
    const second = fetchPrompt()
    const out = await verifyPairs(pairs.slice(0, 4), second, { want: 9, concurrency: 1, cache })
    expect(second.mock.calls.map((c) => c[0])).toEqual(['c'])
    expect(out.pairs.map((p) => p.id)).toEqual(['a', 'd'])                // c's prompt is undefined here: set aside
    expect(await verifyPairs([], fetchPrompt())).toEqual({ pairs: [], failed: 0, fatal: null })
  })
})

describe('drawPairs: the whole draw, asked again while the rounds come up short', () => {
  const asPool = (ps) => ps.map(({ id, term, meaning }) => ({ id, term, meaning }))
  const promptOf = Object.fromEntries(FIFTEEN.map((p) => [p.id, item(`What is ${p.term.toLowerCase()}?`, [p.meaning, ...DISTRACT], {}, { skill_id: p.skill })]))
  const err = (status) => Object.assign(new Error(String(status)), { status })
  const prompts = () => vi.fn(async (id) => { if (!promptOf[id]) throw err(404); return promptOf[id] })
  const draws = (...lists) => vi.fn(async (n) => { const l = lists[Math.min(n, lists.length - 1)]; if (l instanceof Error) throw l; return asPool(l) })

  it('asks once when one draw fills the three rounds', async () => {
    const pool = draws(FIFTEEN), f = prompts()
    const out = await drawPairs(pool, f)
    expect(pool).toHaveBeenCalledTimes(1)
    expect(out.pairs.map((p) => p.id)).toEqual(FIFTEEN.map((p) => p.id))
    expect(out.pairs[4].skill).toBe('vocab.candle_terms')
    expect(planRounds(out.pairs)).toHaveLength(3)
    expect(f).toHaveBeenCalledTimes(15)
    expect(MATCH_POOL_SIZE).toBe(60)                                         // study_store.game_pool's ceiling: more is clamped
    expect(MATCH_DRAWS).toBe(3)
  })

  it('asks again when the first draw is thin, joins the draws, and checks no pair twice', async () => {
    const pool = draws(FIFTEEN.slice(0, 10), [...FIFTEEN.slice(5), FIFTEEN[0]]), f = prompts()
    const out = await drawPairs(pool, f)
    expect(pool).toHaveBeenCalledTimes(2)
    expect(out.pairs.map((p) => p.id)).toEqual(FIFTEEN.map((p) => p.id))       // the first draw's order, then the new
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual(FIFTEEN.map((p) => p.id).sort())   // fifteen checks, one each
  })

  it('stops when a draw brings nothing new, and never asks more than its draws', async () => {
    const thin = draws(FIFTEEN.slice(0, 7))
    const out = await drawPairs(thin, prompts())
    expect(thin).toHaveBeenCalledTimes(2)                                    // the second brought nothing new
    expect(planRounds(out.pairs)).toHaveLength(1)
    const trickle = draws(FIFTEEN.slice(0, 2), FIFTEEN.slice(2, 4), FIFTEEN.slice(4, 6), FIFTEEN.slice(6))
    const some = await drawPairs(trickle, prompts())
    expect(trickle).toHaveBeenCalledTimes(MATCH_DRAWS)
    expect(some.pairs).toHaveLength(6)
    expect(await drawPairs(draws([]), prompts())).toEqual({ pairs: [], failed: 0, fatal: null })
  })

  it('fails on the first draw\'s failure, plays what it has on a later one, and stops on a refusal', async () => {
    await expect(drawPairs(draws(err(500)), prompts())).rejects.toMatchObject({ status: 500 })
    const later = await drawPairs(draws(FIFTEEN.slice(0, 10), err(500)), prompts())
    expect(later.pairs).toHaveLength(10)
    await expect(drawPairs(draws(FIFTEEN.slice(0, 10), err(401)), prompts())).rejects.toMatchObject({ status: 401 })
    const refused = await drawPairs(draws(FIFTEEN), vi.fn(async () => { throw err(402) }))
    expect(refused.fatal?.status).toBe(402)
    expect(refused.pairs).toEqual([])
  })

  it('stops between requests once the sheet is gone', async () => {
    let on = true
    const pool = vi.fn(async () => { on = false; return asPool(FIFTEEN) })
    const f = prompts()
    expect(await drawPairs(pool, f, { alive: () => on })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('checks further when enough pairs passed but read too alike to pack a round', async () => {
    const alike = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => P(id, `Word ${id}`, `A sideways range lasting weeks ${id}`))
    const all = [...alike, ...FIFTEEN.slice(0, 5)]
    const local = { ...promptOf, ...Object.fromEntries(alike.map((p) => [p.id, item(`What is ${p.term.toLowerCase()}?`, [p.meaning, ...DISTRACT])])) }
    const f = vi.fn(async (id) => local[id])
    const pool = draws(all)
    const out = await drawPairs(pool, f, { want: 5, rounds: 1 })
    expect(pool).toHaveBeenCalledTimes(2)                                    // the same items: no new draw, a deeper check
    expect(planRounds(out.pairs, { rounds: 1 }).map((r) => r.map((p) => p.id))).toEqual([['a1', 'up', 'sup', 'bo', 'pb']])
    expect(f).toHaveBeenCalledTimes(10)                                      // the first five alike, then five more, once each
  })
})

describe('rounds', () => {
  it('keeps two pairs whose meanings read alike out of one round, and lets real contrasts be', () => {
    const alike = [
      [P('r1', '1R', 'Your risk per share, entry to stop'), P('r', 'R', 'Your planned loss, entry to stop')],
      [P('b', 'Base', 'A sideways range lasting weeks or more'), P('fb', 'Flat base', 'Sideways for several weeks or months')],
      [P('iv', 'Implied volatility', 'The move the option price implies'), P('im', 'Implied move', 'The move options are pricing in')],
      [P('res', 'Resulting', 'Judging a decision by its outcome'), P('ob', 'Outcome bias', 'Judging a decision by how it turned out')],
      [P('doji', 'Doji', 'Open and close about equal'), P('sb', 'Short body', 'Little change from open to close')],
      [P('x', 'Leader', 'A stock outperforming the market'), P('y', 'leader', 'Something else entirely here')],
      [P('x', 'Leader', 'A stock outperforming the market'), P('y', 'Winner', 'A STOCK OUTPERFORMING THE MARKET')],
    ]
    for (const [a, b] of alike) expect(lookAlike(a, b), `${a.term} / ${b.term}`).toBe(true)
    const apart = [
      [P('gm', 'Gross margin', 'Gross profit as a % of revenue'), P('om', 'Operating margin', 'Operating income divided by revenue')],
      [P('mc', 'Market cap', 'Share price times shares outstanding'), P('fl', 'Float', 'Shares free for the public to trade')],
      [FIFTEEN[0], FIFTEEN[1]],
      [P('pb', 'Pullback', 'A short dip inside an uptrend'), P('h', 'Handle', 'The short pullback after the cup')],
    ]
    for (const [a, b] of apart) expect(lookAlike(a, b), `${a.term} / ${b.term}`).toBe(false)
    expect([...stemsOf('The move options are pricing in')]).toEqual(['move', 'opti', 'pric'])
  })

  it('packs the pool into three full rounds of five, in the pool\'s order', () => {
    const plan = planRounds(FIFTEEN)
    expect(plan.map((r) => r.map((p) => p.id))).toEqual([
      ['up', 'sup', 'bo', 'pb', 'doji'], ['ham', 'in', 'mkt', 'slip', 'sq'], ['dd', 'heat', 'gap', 'eps', 'fomo'],
    ])
    expect(MATCH_ROUNDS * MATCH_PER_ROUND).toBe(15)
  })

  it('moves a look-alike to the next round, keeps only full rounds, and plays nothing under five', () => {
    const base = P('b', 'Base', 'A sideways range lasting weeks or more')
    const flat = P('fb', 'Flat base', 'Sideways for several weeks or months')
    const plan = planRounds([base, flat, ...FIFTEEN.slice(0, 13)])
    expect(plan.map((r) => r.map((p) => p.id))).toEqual([
      ['b', 'up', 'sup', 'bo', 'pb'], ['fb', 'doji', 'ham', 'in', 'mkt'], ['slip', 'sq', 'dd', 'heat', 'gap'],
    ])
    expect(planRounds(FIFTEEN.slice(0, 12)).length).toBe(2)
    expect(planRounds(FIFTEEN.slice(0, 7)).length).toBe(1)
    expect(planRounds(FIFTEEN.slice(0, 4))).toEqual([])
    expect(planRounds(null)).toEqual([])
    const allAlike = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => P(id, `Word ${id}`, `A sideways range lasting weeks ${id}`))
    expect(planRounds(allAlike)).toEqual([])
  })

  it('deals the same run from the same seed and a different one from another', () => {
    const plan = planRounds(FIFTEEN)
    expect(dealRun(plan, 42)).toEqual(dealRun(plan, 42))
    const seen = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(dealRun(plan, s).order)))
    expect(seen.size).toBeGreaterThan(1)
    const r1 = rngOf(7), r2 = rngOf(7)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })

  it('shuffles every round within itself, and never lines up more than one meaning beside its word', () => {
    const plan = planRounds(FIFTEEN)
    for (let seed = 1; seed <= 400; seed++) {
      const { rounds, order } = dealRun(plan, seed * 7919)
      expect(rounds.map((r) => r.map((p) => p.id).sort()).sort()).toEqual(plan.map((r) => r.map((p) => p.id).sort()).sort())
      rounds.forEach((r, k) => {
        const ids = r.map((p) => p.id).sort()
        expect([...order[k].words].sort()).toEqual(ids)
        expect([...order[k].meanings].sort()).toEqual(ids)
        expect(inLine(order[k].words, order[k].meanings)).toBeLessThanOrEqual(1)
      })
    }
    expect(inLine(['a', 'b', 'c'], ['a', 'c', 'b'])).toBe(1)
    expect(inLine(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3)
  })
})

describe('a run, tap by tap', () => {
  // one known round: words a b c d e, meanings b c d e a
  const R = [P('a', 'Uptrend', 'Higher highs and higher lows'), P('b', 'Support', 'Where buyers tend to stop a fall'),
    P('c', 'Breakout', 'A move through resistance or support'), P('d', 'Pullback', 'A short dip inside an uptrend'),
    P('e', 'Doji', 'Open and close about equal', 'vocab.candle_terms')]
  const R2 = FIFTEEN.slice(5, 10)
  const known = (rounds) => ({ ...EMPTY_RUN, token: 1, runId: runIdOf(1, 1), rounds, order: rounds.map((r) => ({ words: r.map((p) => p.id), meanings: [...r.slice(1), r[0]].map((p) => p.id) })) })

  it('picks, drops and moves a pick', () => {
    let { run, event } = pick(known([R]), 'word', 'a')
    expect(event).toEqual({ type: 'select', side: 'word', id: 'a' })
    expect(run.sel).toEqual({ side: 'word', id: 'a' });
    ({ run, event } = pick(run, 'word', 'a'))
    expect(event.type).toBe('deselect')
    expect(run.sel).toBeNull();
    ({ run, event } = pick(run, 'meaning', 'c'));
    ({ run, event } = pick(run, 'meaning', 'd'))
    expect(event).toEqual({ type: 'select', side: 'meaning', id: 'd' })
    expect(run.sel).toEqual({ side: 'meaning', id: 'd' })
  })

  it('matches a pair either way round, right on the first try', () => {
    let { run, event } = pick(known([R]), 'word', 'a');
    ({ run, event } = pick(run, 'meaning', 'a'))
    expect(event).toEqual({ type: 'match', id: 'a', ok: true, first: 'word', roundClear: false, finished: false })
    expect(run.matched).toEqual(['a'])
    expect(run.results).toEqual([true])
    expect(run.log).toEqual([{ id: 'a', term: 'Uptrend', meaning: 'Higher highs and higher lows', skill: 'vocab.chart_terms', ok: true, mixed: [] }]);
    ({ run, event } = pick(run, 'meaning', 'b'));
    ({ run, event } = pick(run, 'word', 'b'))
    expect(event).toMatchObject({ type: 'match', id: 'b', ok: true, first: 'meaning' })
    // a matched tile, a tile from no round and a side that is not one do nothing
    for (const [side, id] of [['word', 'a'], ['meaning', 'a'], ['word', 'zz'], ['middle', 'c']]) expect(pick(run, side, id).event.type).toBe('none')
  })

  it('charges a miss to the pair the member started from, and teaches both pairs', () => {
    // word first: Breakout, then the meaning of Pullback
    let { run, event } = pick(known([R]), 'word', 'c');
    ({ run, event } = pick(run, 'meaning', 'd'))
    expect(event).toEqual({ type: 'miss', first: 'word', charged: 'c', other: 'd', word: 'c', meaning: 'd' })
    expect(run.misses).toBe(1)
    expect(run.missed).toEqual({ c: ['d'] })
    expect(run.sel).toBeNull()
    expect(run.matched).toEqual([])
    expect(missLesson(run, event)).toEqual({
      first: 'word', title: MISS_TITLE, why: 'That meaning goes with Pullback.',
      right: { term: 'Breakout', meaning: 'A move through resistance or support' }, mixed: { term: 'Pullback', meaning: 'A short dip inside an uptrend' },
      from: 'Chart words', cost: '+3 seconds',
    })
    // meaning first: the meaning of Doji, then the word Breakout; Doji is charged, Breakout is not charged again
    let second;
    ({ run, event: second } = pick(run, 'meaning', 'e'));
    ({ run, event: second } = pick(run, 'word', 'c'))
    expect(second).toEqual({ type: 'miss', first: 'meaning', charged: 'e', other: 'c', word: 'c', meaning: 'e' })
    expect(run.missed).toEqual({ c: ['d'], e: ['c'] })
    const lesson = missLesson(run, second)
    expect(lesson.why).toBe('That meaning goes with Doji, not Breakout.')
    expect(lesson.right).toEqual({ term: 'Doji', meaning: 'Open and close about equal' })
    expect(lesson.from).toBe('Candle words')
    // the same mistake twice is listed once on the end screen
    ;({ run } = pick(run, 'word', 'c'));
    ({ run } = pick(run, 'meaning', 'd'));
    ({ run, event } = pick(run, 'word', 'c'));
    ({ run, event } = pick(run, 'meaning', 'c'))
    expect(event).toMatchObject({ type: 'match', id: 'c', ok: false })
    expect(run.log.at(-1)).toMatchObject({ term: 'Breakout', ok: false, mixed: ['Pullback'] })
    expect(tallyOf(run)).toEqual({ right: 0, total: 1, misses: 3 })
    expect(missLesson(run, { charged: 'zz', other: 'c' })).toBeNull()
  })

  it('clears a round, moves to the next, and finishes on the last pair', () => {
    let run = known([R, R2])
    expect(totalOf(run)).toBe(10)
    let event
    for (const id of ['a', 'b', 'c', 'd']) { ({ run, event } = pick(run, 'word', id)); ({ run, event } = pick(run, 'meaning', id)) }
    expect(event).toMatchObject({ roundClear: false })
    ;({ run } = pick(run, 'word', 'e'));
    ({ run, event } = pick(run, 'meaning', 'e'))
    expect(event).toMatchObject({ type: 'match', roundClear: true, finished: false })
    expect(pick(run, 'word', 'ham').event.type).toBe('none')             // the next round's tiles wait for nextRound
    run = nextRound(run)
    expect(run.round).toBe(1)
    for (const p of R2) { ({ run } = pick(run, 'meaning', p.id)); ({ run, event } = pick(run, 'word', p.id)) }
    expect(event).toMatchObject({ type: 'match', roundClear: true, finished: true })
    expect(run.done).toBe(true)
    expect(nextRound(run)).toBe(run)
    expect(pick(run, 'word', 'ham').event.type).toBe('none')
    expect(tallyOf(run)).toEqual({ right: 10, total: 10, misses: 0 })
    expect(pairOf(run, 'slip').term).toBe('Slippage')
    expect(pairOf(run, 'zz')).toBeNull()
  })

  it('starts a run from a plan and a seed, numbered for its report', () => {
    const plan = planRounds(FIFTEEN)
    const run = startRun(plan, 1731100000000, 1)
    expect(run.runId).toBe('match-m3988sn4-1')
    expect(run.token).toBe(1)
    expect(run.order).toEqual(dealRun(plan, 1731100000000).order)
    expect(totalOf(run)).toBe(15)
    expect(runIdOf(-5, 2)).toBe('match-5-2')
  })

  it('reads the keys: 1 to 5 a word, A to E a meaning, nothing else', () => {
    expect(keyPick('1')).toEqual({ side: 'word', index: 0 })
    expect(keyPick('5')).toEqual({ side: 'word', index: 4 })
    expect(keyPick('a')).toEqual({ side: 'meaning', index: 0 })
    expect(keyPick('E')).toEqual({ side: 'meaning', index: 4 })
    for (const k of ['6', '0', 'f', 'F', 'Escape', 'Enter', '', 'ab', undefined]) expect(keyPick(k)).toBeNull()
  })

  it('counts the streak to the latest pair', () => {
    expect(streakOf([true, false, true, true])).toBe(2)
    expect(streakOf([true, true, false])).toBe(0)
    expect(streakOf([])).toBe(0)
  })
})

describe('the clock', () => {
  it('counts up, holds, takes the penalty while held, and runs on from where it stood', () => {
    const c0 = runClock(CLOCK0, 1000)
    expect(c0).toEqual({ acc: 0, since: 1000 })
    expect(clockAt(c0, 3500)).toBe(2500)
    expect(clockAt(c0, 500)).toBe(0)                                       // never below zero
    expect(runClock(c0, 9000)).toBe(c0)                                    // running already
    const held = holdClock(c0, 4000)
    expect(held).toEqual({ acc: 3000, since: null })
    expect(clockAt(held, 99999)).toBe(3000)
    expect(holdClock(held, 5000)).toEqual(held)
    const hit = penalize(held)
    expect(hit).toEqual({ acc: 3000 + MATCH_PENALTY_MS, since: null })
    expect(clockAt(runClock(hit, 10000), 10500)).toBe(6500)
  })

  it('reads in minutes, seconds and tenths, never rounding a tenth up', () => {
    expect(clockText(0)).toBe('0:00.0')
    expect(clockText(42349)).toBe('0:42.3')
    expect(clockText(59999)).toBe('0:59.9')
    expect(clockText(60000)).toBe('1:00.0')
    expect(clockText(75050)).toBe('1:15.0')
    expect(clockText(3599999)).toBe('59:59.9')
    expect(clockText(-5)).toBe('0:00.0')
    expect(clockText(NaN)).toBe('0:00.0')
    expect(clockWords(42349)).toBe('42.3 seconds')
    expect(clockWords(65000)).toBe('1 minute 5.0 seconds')
    expect(clockWords(125000)).toBe('2 minutes 5.0 seconds')
  })
})

describe('the best and the end', () => {
  it('keeps one best per board size, lower is better', () => {
    expect(bestKeyOf(15)).toBe('study.match.best.15')
    expect(bestKeyOf(5)).toBe('study.match.best.5')
    expect(bestOf('42300')).toBe(42300)
    for (const raw of [null, '', 'x', '0', '-3', undefined]) expect(bestOf(raw)).toBeNull()
    expect(isNewBest(40000, null)).toBe(true)
    expect(isNewBest(40000, 42000)).toBe(true)
    expect(isNewBest(42000, 42000)).toBe(false)
    expect(isNewBest(0, null)).toBe(false)
    expect(isNewBest(NaN, null)).toBe(false)
  })

  it('draws the pace against the best and says when it went past it', () => {
    expect(paceOf(21000, 42000)).toEqual({ pct: 50, over: false })
    expect(paceOf(50000, 42000)).toEqual({ pct: 100, over: true })
    expect(paceOf(1000, null)).toBeNull()
  })

  it('says the misses and the best in plain words', () => {
    expect(missLine(0)).toBe('No misses. Every pair went in on the first try.')
    expect(missLine(1)).toBe('1 miss added 3 seconds.')
    expect(missLine(4)).toBe('4 misses added 12 seconds.')
    expect(bestLine(40000, null)).toBe("Your first time on this board. That's the one to beat.")
    expect(bestLine(40000, 42000)).toBe('A new best. You beat 0:42.0.')
    expect(bestLine(45000, 42000)).toBe('Your best stands at 0:42.0.')
    for (const line of [missLine(2), bestLine(1, null), bestLine(1, 2), bestLine(3, 2), MISS_TITLE]) expect(line).not.toMatch(/[—–]|\bfirm\b/i)
  })

  it('names the rounds a draw plays, never more than it fills', () => {
    expect(roundsWord(3)).toBe('Three rounds')
    expect(roundsWord(2)).toBe('Two rounds')
    expect(roundsWord(1)).toBe('One round')
    expect(roundsWord(0)).toBe('No rounds')
    expect(roundsWord(MATCH_ROUNDS)).toBe('Three rounds')
  })

  it('reads the server\'s answer to the run as the level bar, or as not saved', () => {
    expect(levelOf({ xp_gained: 24, progress: { xp: 1024, xp_gained: 24 } })).toEqual({ before: 1000, after: 1024 })
    expect(levelOf({ progress: { xp: 1024, xp_gained: 0 } })).toEqual({ before: 1024, after: 1024 })
    expect(levelOf({})).toBeNull()
    expect(levelOf({ progress: { xp: '5' } })).toBeNull()
    expect(levelOf(null)).toBeNull()
  })

  it('names the unit a pair comes from', () => {
    expect(unitOf('vocab.order_terms')).toBe('Order words')
    expect(unitOf('vocab.candle')).toBeNull()
    expect(unitOf(null)).toBeNull()
  })
})

// ── the real course files ─────────────────────────────────────────────────────────────────────────────────────────
const COURSES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..', 'docs', 'study', 'courses', 'V')
const units = () => fs.readdirSync(COURSES).filter((f) => /^V\.\d+\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(COURSES, f), 'utf8')))

describe('the vocabulary courses (docs/study/courses/V)', () => {
  it('names every unit exactly as its file does', () => {
    const fromFiles = {}
    for (const u of units()) for (const s of u.skills || []) fromFiles[s.id] = u.title
    expect(UNIT_OF_SKILL).toEqual(fromFiles)
  })

  it('plays only real definitions from the whole corpus, as the pool would hand it out', () => {
    // game_pool('match'): approved vocab recall items (a scenario is its own type), answer not the term, up to 60 characters
    const pool = [], prompts = new Map(), formats = new Map()
    for (const u of units()) {
      for (const q of u.questions || []) {
        if (!String(q.skill || '').startsWith('vocab.') || !q.term || q.format === 'scenario') continue
        const meaning = String(q.answer ?? '').trim()
        if (!meaning || meaning.toLowerCase() === String(q.term).trim().toLowerCase() || meaning.length > 60) continue
        const id = `${u.unit}#${q.key}`
        const kind = { mcq: 'mcq', tf: 'tf', fill: 'fill', numeric: 'fill_numeric' }[q.format] || q.format
        pool.push({ id, term: q.term, meaning })
        prompts.set(id, { id, skill_id: q.skill, has_chart: !!q.chart, prompt_json: { q: q.q, kind, choices: q.format === 'mcq' ? q.choices : q.format === 'tf' ? ['True', 'False'] : undefined } })
        formats.set(id, q.format)
      }
    }
    const kept = pairsOf(pool).filter((p) => meaningPromptProblem(prompts.get(p.id), p) == null)
    expect(pool.length).toBeGreaterThan(kept.length)
    expect(kept.length).toBeGreaterThan(100)                               // the checks are not refusing everything
    for (const p of kept) {
      expect(formats.get(p.id), p.term).toBe('mcq')                         // never a true/false, a fill-in or a number
      expect(p.meaning.trim().split(/\s+/).length, p.term).toBeGreaterThan(1)
      expect(p.meaning, p.term).not.toMatch(/^(?:true|false)$/i)
    }
    // every true/false item in the pool is set aside, and so is a meaning keyed for one side only
    expect(pool.filter((p) => formats.get(p.id) === 'tf').every((p) => !kept.some((k) => k.id === p.id))).toBe(true)
    for (const word of ['In the money', 'Neckline']) expect(kept.some((p) => p.term === word), word).toBe(false)
    // and twenty of them, spread across the units as a random draw would be, pack into three full rounds
    expect(planRounds(kept.filter((_, i) => i % 9 === 0).slice(0, 20)).length).toBe(3)
  })
})
