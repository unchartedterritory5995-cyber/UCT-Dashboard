// Wave 9 lane 6 (discoverability): every code has a realistic example that runs as typed, and a
// trader's plain word finds the right code in the command line AND in the Ctrl/Cmd-K palette.
// Everything is read from functions.js (FUNCTIONS, the appended FUNCTION_WORDS); nothing is a list.
import { describe, it, expect } from 'vitest'
import { FUNCTIONS, BY_CODE, CODE_ALIASES, FUNCTION_WORD_CODES, exampleFor, codesForWords, variantFor } from './functions'
import parseCommand from './parseCommand'
import { applyArgs } from './args'
import { rankCandidates } from './ranking'
import { registrySuggestions, acceptSuggestion } from './CommandLine'
import { terminalCommandRow, wordCommand } from './paletteGrammar'

/** What a swing trader types, and the code it must find first. The words are the brief's. */
const TRADER_WORDS = {
  breakout: 'BRKO', insider: 'INS', 'position size': 'SIZE', sentiment: 'SENT', peers: 'PEER',
  regime: 'REGM', scatter: 'SCAT', plan: 'PLAN', theme: 'THMS', movers: 'MOST', watchlist: 'MON',
  correlation: 'CORR', checklist: 'CHK', 'relative strength': 'RSL',
}

describe('the word data is registry data', () => {
  it('every key is a registered code (never an alias, never a typo)', () => {
    const codes = new Set(FUNCTIONS.map((f) => f.code))
    expect(FUNCTION_WORD_CODES.length).toBeGreaterThan(40)
    for (const k of FUNCTION_WORD_CODES) {
      expect(codes.has(k), `${k} is not a registered code`).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(CODE_ALIASES, k)).toBe(false)
    }
  })

  it('keywords are lower case and no keyword is also a function code (a code needs no keyword)', () => {
    for (const f of FUNCTIONS) {
      for (const k of f.keywords || []) {
        expect(k).toBe(k.toLowerCase())
        expect(k.trim()).toBe(k)
      }
    }
  })

  it('every code has an example, and it opens that code with every argument applied', () => {
    for (const f of FUNCTIONS) {
      const ex = exampleFor(f)
      expect(ex, f.code).toBeTruthy()
      const p = parseCommand(ex)
      expect(p.ok, `${f.code}: ${ex}`).toBe(true)
      expect(p.type, `${f.code}: ${ex}`).toBe('function')
      expect(p.code, `${f.code}: ${ex}`).toBe(f.code)
      const { variant } = variantFor(p.code, !!p.sym)
      expect(variant, `${f.code}: ${ex}`).toBeTruthy()
      const out = applyArgs(variant, p.args || [], { today: '2026-10-09' })
      expect(out.ignored, `${f.code}: ${ex} has an argument that is not applied`).toEqual([])
    }
  })

  it('every new code of today has a keyword (the ones a member cannot guess)', () => {
    for (const code of ['NEWS', 'REGM', 'INS', 'RSL', 'THMS', 'PEER', 'ETF', 'TWT', 'SIZE', 'SENT', 'SCAT', 'CHK', 'BRKO', 'PLAN']) {
      expect(BY_CODE[code]?.keywords?.length, code).toBeGreaterThan(0)
    }
  })
})

describe('a plain word finds the code', () => {
  it.each(Object.entries(TRADER_WORDS))('"%s" names %s first', (word, code) => {
    expect(codesForWords(word)[0]).toBe(code)
  })

  it.each(Object.entries(TRADER_WORDS).filter(([w]) => !w.includes(' ')))(
    'the command line suggests %s for "%s" and accepting it writes the code', (word, code) => {
      const rows = registrySuggestions(word, { limit: 6 })
      const row = rows.find((r) => r.kind === 'function' && r.value === code)
      expect(row, `${word} → ${code}`).toBeTruthy()
      expect(rows.filter((r) => r.kind === 'function')[0].value).toBe(code)
      expect(acceptSuggestion(word, row)).toBe(`${code} `)
    })

  it('the Ctrl/Cmd-K palette offers each word as the command it names', () => {
    for (const [word, code] of Object.entries(TRADER_WORDS)) {
      const r = terminalCommandRow(word)
      expect(r, word).toBeTruthy()
      expect(r.row.command, word).toBe(code)
    }
  })

  it('a ticker before a word keeps the ticker for a code that takes one', () => {
    expect(wordCommand('nvda peers')).toBe('NVDA PEER')
    expect(terminalCommandRow('nvda peers').row.command).toBe('NVDA PEER')
    expect(terminalCommandRow('nvda peers').placement).toBe('lead')
  })

  it('a word sits BELOW every spelling match: an exact ticker or code is never pushed down', () => {
    const rows = rankCandidates('PLAN', { tickers: [{ value: 'PLAN', label: 'Anaplan' }] })
    expect(rows[0]).toMatchObject({ kind: 'function', value: 'PLAN', rank: 'verb' })
    const tick = rankCandidates('TIGHT', { tickers: [{ value: 'TIGHT', label: 'x' }] })
    expect(tick[0]).toMatchObject({ kind: 'ticker', value: 'TIGHT' })
    expect(tick.find((r) => r.value === 'BRKO')?.rank).toBe('word')
  })

  it('CONTROL: a ticker, a short token and gibberish name no code', () => {
    expect(codesForWords('nvda')).toEqual([])
    expect(codesForWords('ab')).toEqual([])
    expect(codesForWords('zzqx')).toEqual([])
    expect(terminalCommandRow('NVDA')).toBeNull()
    // A short word reads as a ticker first: only an exact keyword names a code there.
    expect(terminalCommandRow('COMP')).toBeNull()
    expect(terminalCommandRow('HEA')).toBeNull()
    expect(rankCandidates('NV').some((r) => r.rank === 'word')).toBe(false)
  })

  it('the palette keeps an explicit command as typed (NVDA GP is never re-read as a word)', () => {
    expect(terminalCommandRow('nvda gp').row.command).toBe('NVDA GP')
    expect(terminalCommandRow('CAL').row.command).toBe('CAL')
  })
})
