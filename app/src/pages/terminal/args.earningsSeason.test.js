// The earnings season screen (2026-11-17): the argument kinds of ERNS.
//
// args.js keeps its own small copies of vocabularies the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins each copy to its owner.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, EARNINGS_DAY_REACH, EARNINGS_DAY_WORDS, EARNINGS_SESSION_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import parseCommand, { formatCommand } from './parseCommand'
import {
  EARNINGS_DAYS, EARNINGS_DAY_ARG_WORDS, EARNINGS_SESSIONS, EARNINGS_SESSION_ARG_WORDS, NEAREST_DAY_REACH, TONIGHT_TOKEN,
  earningsChoice, earningsSeasonCommandArgs, parseEarningsDay, parseEarningsSession,
} from './panels/earningsSeasonModel'

const TODAY = '2026-11-17'
const ctx = { today: TODAY }

describe('the earnings season argument kinds match the panel that owns the words', () => {
  it('the word copies equal the model, word for word, and every chip token is taken', () => {
    expect(EARNINGS_DAY_WORDS).toEqual(EARNINGS_DAY_ARG_WORDS)
    expect(EARNINGS_SESSION_WORDS).toEqual(EARNINGS_SESSION_ARG_WORDS)
    expect(EARNINGS_DAY_REACH).toBe(NEAREST_DAY_REACH)
    for (const [word, value] of Object.entries(EARNINGS_DAY_ARG_WORDS)) {
      expect(ARG_KINDS.earningsDay.parse(word.toLowerCase(), ctx), word).toBe(value)
    }
    for (const [word, value] of Object.entries(EARNINGS_SESSION_ARG_WORDS)) {
      expect(ARG_KINDS.earningsSession.parse(word.toLowerCase()), word).toBe(value)
      expect(parseEarningsSession(word), word).toBe(value)
    }
    for (const [key, d] of Object.entries(EARNINGS_DAYS)) if (d.token) expect(ARG_KINDS.earningsDay.parse(d.token, ctx)).toBe(key)
    for (const [key, s] of Object.entries(EARNINGS_SESSIONS)) if (s.token) expect(ARG_KINDS.earningsSession.parse(s.token)).toBe(key)
    expect(ARG_KINDS.earningsDay.parse(TONIGHT_TOKEN, ctx)).toBe('tonight')
  })

  it.each([
    'TODAY', 'tonight', 'Tomorrow', '2026-11-18', '2026-02-30', '2026-13-01', '11/19', '1/5', '12/30', '5/18', '5/17', '7/4',
    '2/29', '2/30', '13/1', '0/5', 'NVDA', 'NEXT', 'AMC', '', '11-19', '20261118', 'constructor',
  ])('a day typed as "%s" reads the same in the registry and in the model', (token) => {
    expect(ARG_KINDS.earningsDay.parse(token, ctx)).toBe(parseEarningsDay(token, ctx))
    // early January, when a December date is the one just gone
    const jan = { today: '2027-01-04' }
    expect(ARG_KINDS.earningsDay.parse(token, jan)).toBe(parseEarningsDay(token, jan))
  })

  it('a day ahead is taken (unlike a past-session date), and a word is kept as a word', () => {
    expect(ARG_KINDS.earningsDay.parse('2026-11-25', ctx)).toBe('2026-11-25')
    expect(ARG_KINDS.etDate.parse('2026-11-25', ctx)).toBeNull()
    expect(ARG_KINDS.earningsDay.parse('TOMORROW', ctx)).toBe('tomorrow')
    expect(ARG_KINDS.earningsDay.describe('tonight')).toBe('today, after the close')
    expect(ARG_KINDS.earningsDay.describe('2026-11-25')).toBe('day 2026-11-25')
    expect(ARG_KINDS.earningsSession.describe('bmo')).toBe('before the open')
    expect(ARG_KINDS.earningsSession.describe('amc')).toBe('after the close')
    expect(ARG_KINDS.earningsSession.parse('NVDA')).toBeNull()
    // with no clock handed in it reads the real one, so the command line's own check still works
    expect(ARG_KINDS.earningsDay.parse('TODAY')).toBe('today')
    expect(typeof ARG_KINDS.earningsDay.parse('1/15')).toBe('string')
  })

  it('no word is taken by both kinds, so the order typed does not matter', () => {
    const words = [...Object.keys(EARNINGS_DAY_WORDS), ...Object.keys(EARNINGS_SESSION_WORDS)]
    expect(new Set(words).size).toBe(words.length)
    for (const w of Object.keys(EARNINGS_SESSION_WORDS)) expect(ARG_KINDS.earningsDay.parse(w, ctx)).toBeNull()
    for (const w of Object.keys(EARNINGS_DAY_WORDS)) expect(ARG_KINDS.earningsSession.parse(w)).toBeNull()
  })

  it('the registry applies each word to the prop the panel reads, in any order', () => {
    const run = (tokens) => applyArgs(BY_CODE.ERNS.market, tokens, ctx)
    expect(run(['TOMORROW', 'AMC']).props).toEqual({ day: 'tomorrow', session: 'amc' })
    expect(run(['amc', 'tomorrow']).props).toEqual({ day: 'tomorrow', session: 'amc' })
    expect(run(['TONIGHT']).props).toEqual({ day: 'tonight' })
    expect(run(['11/19']).props).toEqual({ day: '2026-11-19' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['TODAY', 'TOMORROW']).ignored).toEqual(['TOMORROW'])     // one day at a time
    // what the panel writes back is read as the same choice
    for (const day of ['next', 'today', 'tomorrow', '2026-11-12']) {
      for (const session of ['all', 'bmo', 'amc']) {
        const out = run(earningsSeasonCommandArgs({ day, session }, TODAY))
        expect(out.ignored, `${day} ${session}`).toEqual([])
        expect(earningsChoice(out.props, TODAY), `${day} ${session}`).toEqual({ day, session })
      }
    }
  })

  it('the command line reads the words as arguments, never as tickers', () => {
    for (const [line, args] of [['ERNS', []], ['ERNS TONIGHT', ['TONIGHT']], ['erns tomorrow amc', ['TOMORROW', 'AMC']],
      ['ERNS AMC', ['AMC']], ['ERNS 11/19', ['11/19']], ['ERNS 2026-11-19 BMO', ['2026-11-19', 'BMO']]]) {
      const cmd = parseCommand(line)
      expect([cmd.ok, cmd.type, cmd.code, cmd.sym, cmd.args], line).toEqual([true, 'function', 'ERNS', null, args])
      expect(formatCommand(cmd)).toBe(['ERNS', ...args].join(' '))
    }
    expect(BY_CODE.ERNS.ticker).toBeUndefined()
    expect(BY_CODE.ERNS.market.flag).toBeUndefined()
  })
})
