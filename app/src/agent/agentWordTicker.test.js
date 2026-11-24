// ⭐ P0.2 (INV1 C, assessment 2026-11-23) — the rule itself, generated from classes (the panel test runs a sample end to end):
//   (a) a plan's ticker VALUE taken from an ordinary word in a verb / command position is asked (wordOnlyTickers), never applied;
//   (b) the same word names no TARGET ticker (targetTickers): "NOW the right one too" on a board showing NOW and ON is no
//       "You named NOW, but … shows ON" (e2eBench e2-t11), and "fix that" names no FIX target.
// words = common English words that ARE symbols in the universe /api/ticker-search serves (api/data/cap_universe.json, read here).
// No market value is read: the universe file is symbols only.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { tickerWordRole, wordOnlyTickers, targetTickers, tickerTokens, ENGLISH_TICKER_WORDS, isEnglishWord } from './deixis'

const here = dirname(fileURLToPath(import.meta.url))
const UNIVERSE = new Set(JSON.parse(readFileSync(resolve(here, '../../../api/data/cap_universe.json'), 'utf8')).map(s => String(s).toUpperCase()))
const ENGLISH = ('fix run edit go play real safe open ship fly eat talk pay flex cash rock sky sun car fun man pen ice hum mod path tech am ' +
  'fox hog wash tap dash nice pump shop snap spot step swim team boot cake care chef coin fast fate five form four gain glad gold good grab ' +
  'hood hope iron keys land life line lion luck next pack pool post rare road root site snow task tree trip unit well west wing wolf ' +
  'now on it all so be').split(' ')
const WORDS = ENGLISH.filter(w => UNIVERSE.has(w.toUpperCase()))

// verb / command frames × positions
const VERB_FRAMES = [
  w => `${w} that`, w => `${w} it`, w => `${w} this`, w => `${w} them`, w => `${w} those`, w => `${w} it again`, w => `${w} the chart`,
  w => `${w} my rsi`, w => `${w} that please`, w => `please ${w} that`, w => `pls ${w} it`, w => `can you ${w} it`, w => `could you ${w} this for me`,
  w => `would you ${w} the chart`, w => `ok, ${w} that`, w => `ok so ${w} it`, w => `now ${w} them`, w => `and ${w} it`,
  w => `switch to weekly and ${w} it`, w => `switch to weekly, then ${w} that`, w => `i want to ${w} that`, w => `i need to ${w} it`,
  w => `let me ${w} it`, w => `you ${w} it wrong`, w => `why did you ${w} that`, w => `don't ${w} it`, w => `${w} up the chart`,
  w => `${w} it back`, w => `${w} everything`,
]
// strong frames: a pronoun object / particle / modal (used where the word would RAISE a target question)
const STRONG = new Set([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28])
const CASES = [['lower', s => s], ['title', s => s[0].toUpperCase() + s.slice(1)], ['shouted', s => s.toUpperCase()]]
// explicit references: capitals, $, a ticker frame
const EXPLICIT = [
  w => `switch to ${w.toUpperCase()}`, w => `${w.toUpperCase()} that`, w => `$${w}`, w => `can you load $${w}`, w => `show me ${w} stock`,
  w => `${w} shares`, w => `the ticker ${w}`, w => `symbol ${w} please`, w => `put up the ${w} chart`,
]
// other positions: the existing rule (unchanged): after a chart verb, alone, before a non-object word
const OTHER = [w => `switch to ${w}`, w => `pull up ${w}`, w => `show me ${w}`, w => `load ${w}`, w => `change it to ${w}`, w => `${w}`, w => `${w} please`, w => `${w} on the weekly`]
const FILLERS = new Set(['now', 'so', 'well', 'next', 'first'])
const setSymbol = (T) => [{ action: 'chart.setSymbol', target: 'chart:c', args: { symbol: T } }]
const getCapability = (a) => (a === 'chart.setSymbol' || a === 'chart.setTimeframe' ? { target: 'chart' } : a === 'quote.get' ? { target: null, query: true } : null)

describe('the class is the real one', () => {
  it('universe and words', () => {
    expect(UNIVERSE.size).toBeGreaterThan(1000)
    expect(WORDS.length).toBeGreaterThanOrEqual(60)
    for (const w of ['fix', 'run', 'edit', 'go', 'now', 'on']) expect(WORDS).toContain(w)
  })
})

describe('(a) a plan ticker from a verb-position word is flagged — every word × frame × case', () => {
  for (const w of WORDS) {
    it(`${w}`, () => {
      const T = w.toUpperCase()
      for (const f of VERB_FRAMES) {
        for (const [cn, c] of CASES) {
          const text = c(f(w))
          expect([cn, text, tickerWordRole(text, T)]).toEqual([cn, text, 'verb'])
          expect([text, wordOnlyTickers({ ops: setSymbol(T), text, getCapability })]).toEqual([text, [{ ticker: T, word: w }]])
        }
      }
      for (const f of EXPLICIT) {
        const text = f(w)
        expect([text, tickerWordRole(text, T)]).toEqual([text, 'explicit'])
        expect([text, wordOnlyTickers({ ops: setSymbol(T), text, getCapability })]).toEqual([text, []])
      }
      for (const f of OTHER) {
        const text = f(w)
        if (FILLERS.has(w) && /^\S+ \S/.test(text) && text.startsWith(w)) continue      // "now please": a filler at the head is a role of its own
        expect([text, wordOnlyTickers({ ops: setSymbol(T), text, getCapability })]).toEqual([text, []])
      }
    })
  }
  it('only WRITES are checked, and every symbol-valued argument is', () => {
    expect(wordOnlyTickers({ ops: [{ action: 'quote.get', args: { symbol: 'FIX' } }], text: 'fix that', getCapability })).toEqual([])
    expect(wordOnlyTickers({ ops: [{ action: 'chart.setSymbol', args: { tickers: ['NVDA', 'FIX'] } }], text: 'fix that', getCapability })).toEqual([{ ticker: 'FIX', word: 'fix' }])
    expect(wordOnlyTickers({ ops: [{ action: 'chart.setSymbol', args: { nested: { symbols: ['$fix'] } } }], text: 'can you fix it', getCapability })).toEqual([{ ticker: 'FIX', word: 'fix' }])
    expect(wordOnlyTickers({ ops: [{ action: 'chart.setTimeframe', args: { timeframe: 'W' } }], text: 'fix that', getCapability })).toEqual([])
  })
  it('a symbol the words never spell is not this rule\'s business', () => {
    expect(wordOnlyTickers({ ops: setSymbol('AAPL'), text: 'switch to apple', getCapability })).toEqual([])
    expect(tickerWordRole('switch to apple', 'AAPL')).toBe(null)
  })
  it('one explicit mention anywhere settles it', () => {
    expect(wordOnlyTickers({ ops: setSymbol('FIX'), text: 'fix that, I mean switch to FIX', getCapability })).toEqual([])
    expect(wordOnlyTickers({ ops: setSymbol('FIX'), text: 'fix that and load $fix', getCapability })).toEqual([])
  })
  it('non-English tickers typed lowercase keep the existing rule', () => {
    for (const t of ['nvda', 'pull up pltr', 'can you show me nvda', 'pltr please', 'nvda on the weekly']) {
      const T = /pltr/.test(t) ? 'PLTR' : 'NVDA'
      expect([t, wordOnlyTickers({ ops: setSymbol(T), text: t, getCapability })]).toEqual([t, []])
    }
  })
})

describe('(b) the same word names no TARGET ticker — both directions', () => {
  const board = (a, b) => [{ ref: 'c0', symbol: a, label: `Left chart (${a})` }, { ref: 'c1', symbol: b, label: `Right chart (${b})` }]
  for (const w of WORDS) {
    it(`${w}`, () => {
      const T = w.toUpperCase()
      const known = new Map([[w, T]])
      VERB_FRAMES.forEach((f, k) => {
        for (const [cn, c] of CASES) {
          const text = c(f(w))
          const isOrd = ['now', 'on', 'it', 'all', 'so', 'be', 'go'].includes(w)
          // an ordinary word (even in capitals, even shown on the board) and any word in a strong role: no target
          if (isOrd || STRONG.has(k)) {
            expect([cn, text, targetTickers(text, board(T, 'QQQ'), known).includes(T)]).toEqual([cn, text, false])
          }
        }
      })
      // controls: an explicit reference IS a target
      for (const text of [`$${w} to weekly`, `the ticker ${w} to weekly`].filter(t => tickerTokens(t).some(x => x.upper === T))) expect([text, targetTickers(text, board('QQQ', 'SPY'), known)]).toEqual([text, [T]])
    })
  }
  it('the e2e case e2-t11: "NOW the right one too, and keep ON on the weekly" names no NOW target', () => {
    const charts = board('ON', 'NOW')
    expect(targetTickers('NOW the right one too, and keep ON on the weekly', charts)).not.toContain('NOW')
    expect(targetTickers('now the right one too', charts, new Map([['now', 'NOW']]))).toEqual([])
  })
  it('controls: a real ticker reference still names its target', () => {
    const charts = board('ON', 'NOW')
    expect(targetTickers('switch NOW to weekly', charts)).toEqual(['NOW'])
    expect(targetTickers('put the NOW chart on weekly', charts)).toEqual(['NOW'])
    expect(targetTickers('nvda the daily', board('QQQ', 'SPY'), new Map([['nvda', 'NVDA']]))).toEqual(['NVDA'])
    expect(targetTickers('NVDA to weekly', board('QQQ', 'SPY'))).toEqual(['NVDA'])
    expect(targetTickers('$now to weekly', charts)).toEqual(['NOW'])
  })
})

// ── AUDIT NO-GO F2 (11-23): the role rules are about ORDINARY ENGLISH WORDS only ──────────────────────────────────────────────
// A ticker that is no English word, typed lowercase at a clause head before a follow word ("nvda the right one", "amd back on the
// right chart"), is a ticker: never asked (direction 1), still a named target (direction 2). Non-word tickers are generated from
// the real universe: symbols of 3–4 letters with no vowel (no English word) plus the common names AUDIT used.
const NONWORD = [...new Set(['NVDA', 'AMD', 'TSLA', 'PLTR', 'MSFT', ...[...UNIVERSE].filter(t => /^[B-DF-HJ-NP-TV-Z]{3,4}$/.test(t)).slice(0, 40)])]
  .filter(t => UNIVERSE.has(t) && !ENGLISH.includes(t.toLowerCase()))
const F2_FRAMES = [w => `${w} the right one`, w => `${w} back on the right chart`, w => `${w} up on the right`, w => `${w} again on the right one`,
  w => `ok now ${w} the right one`, w => `${w} all day on the right one`, w => `${w} it on the right one`, w => `please ${w} that`, w => `can you ${w} it`]
describe('F2: a ticker that is no English word is never asked, whatever its position', () => {
  it('the class: every English ticker word is listed in the universe (or is one of the app\'s own ordinary words), and the non-word sample is real', () => {
    expect([...ENGLISH_TICKER_WORDS].filter(w => !UNIVERSE.has(w.toUpperCase()))).toEqual([])
    expect(NONWORD.length).toBeGreaterThanOrEqual(30)
    for (const w of WORDS) expect([w, isEnglishWord(w)]).toEqual([w, true])
  })
  it.each(NONWORD)('%s × every frame × lower / title: applied (direction 1), still a named target (direction 2)', (T) => {
    const w = T.toLowerCase()
    for (const f of [...F2_FRAMES, ...VERB_FRAMES]) {
      for (const c of [s => s, s => s[0].toUpperCase() + s.slice(1)]) {
        const text = c(f(w))
        expect([text, wordOnlyTickers({ ops: setSymbol(T), text, getCapability })]).toEqual([text, []])
        // direction 2 on AUDIT's frames (the target rail's other readers keep their own rules for the rest)
        if (F2_FRAMES.includes(f)) expect([text, targetTickers(text, [{ ref: 'c0', symbol: T }, { ref: 'c1', symbol: 'QQQ' }], new Map([[w, T]])).includes(T)]).toEqual([text, true])
      }
    }
  })
})

