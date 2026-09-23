/**
 * The quick switcher's placement rule, as data. The palette test drives the
 * rule through the real component; this pins each branch of it so a change to
 * the ORDER cannot hide behind a change to the fetch mocks.
 */
import { describe, it, expect } from 'vitest'
import {
  noteContextLine, noteSwitcherUrl, orderPaletteRows, splitTitleMatch,
  STRONG_NOTE_TIER_MAX, tickerLeads, toNoteRow,
} from './noteSwitcher'

const TICKER_LIKE = /^[A-Z0-9.\-]{1,10}$/
const cmd = { kind: 'command', id: 'nb-trash', label: 'Open Trash' }
const kw = { kind: 'note', id: 'k1', title: 'Kept', badge: 'Recent' }
const tk = (ticker, extra = {}) => ({ kind: 'ticker', ticker, ...extra })
const nt = (id, tier) => toNoteRow({ id, title: `T${id}`, matchTier: tier })

describe('orderPaletteRows', () => {
  it('a ticker-shaped query keeps EVERY ticker row above every note', () => {
    const rows = orderPaletteRows({
      commands: [cmd], keywordNotes: [kw],
      tickers: [tk('AAPL'), tk('APPS'), tk('APP', { _typed: true })],
      noteMatches: [nt('a', 0), nt('b', 4)],
      qUpper: 'APP', tickerLead: true,
    })
    expect(rows.map((r) => r.ticker || r.id)).toEqual(['nb-trash', 'k1', 'AAPL', 'APPS', 'APP', 'a', 'b'])
  })

  it('a note-shaped query: exact ticker, then strong notes, then other tickers, then weak notes', () => {
    const rows = orderPaletteRows({
      commands: [], keywordNotes: [],
      tickers: [tk('EARNS'), tk('EARNINGS'), tk('EARNINGS', { _typed: true })],
      noteMatches: [nt('strong', STRONG_NOTE_TIER_MAX), nt('weak', STRONG_NOTE_TIER_MAX + 1)],
      qUpper: 'EARNINGS', tickerLead: false,
    })
    expect(rows.map((r) => (r._typed ? 'typed' : r.ticker || r.id)))
      .toEqual(['EARNINGS', 'strong', 'EARNS', 'typed', 'weak'])
  })

  it('the synthetic typed row never counts as an exact ticker hit', () => {
    const rows = orderPaletteRows({
      tickers: [tk('Q3 PLAN', { _typed: true })],
      noteMatches: [nt('s', 1)], qUpper: 'Q3 PLAN', tickerLead: false,
    })
    expect(rows[0].id).toBe('s')
  })

  it('a note already listed by keyword is never listed twice', () => {
    const rows = orderPaletteRows({
      keywordNotes: [kw], noteMatches: [nt('k1', 0), nt('z', 1)], tickerLead: false,
    })
    expect(rows.filter((r) => r.id === 'k1')).toHaveLength(1)
    expect(rows.map((r) => r.id)).toEqual(['k1', 'z'])
  })
})

describe('tickerLeads', () => {
  it('short ticker-shaped queries lead with tickers', () => {
    expect(tickerLeads('NVDA', TICKER_LIKE)).toBe(true)
    expect(tickerLeads('BRK.B', TICKER_LIKE)).toBe(true)
  })
  it('long or multi-word queries do not', () => {
    expect(tickerLeads('EARNINGS', TICKER_LIKE)).toBe(false)
    expect(tickerLeads('Q3 PLAN', TICKER_LIKE)).toBe(false)
    expect(tickerLeads('', TICKER_LIKE)).toBe(false)
  })
})

describe('row text helpers', () => {
  it('splitTitleMatch finds the first case-insensitive occurrence', () => {
    expect(splitTitleMatch('Semis Rotation', 'rot')).toEqual(['Semis ', 'Rot', 'ation'])
    expect(splitTitleMatch('Semis', 'xyz')).toEqual(['Semis', '', ''])
    expect(splitTitleMatch('Semis', '')).toEqual(['Semis', '', ''])
  })
  it('noteContextLine names the folder (or Unfiled) and the ticker', () => {
    expect(noteContextLine({ folderPath: 'A / B', ticker: 'NVDA' })).toBe('A / B · $NVDA')
    expect(noteContextLine({ folderPath: null, ticker: null })).toBe('Unfiled')
  })
  it('toNoteRow badges a favourite over a recent, and titles an empty note', () => {
    expect(toNoteRow({ id: 'x', title: '', isFavorite: true, isRecent: true }).badge).toBe('Favorite')
    expect(toNoteRow({ id: 'x', title: '', isRecent: true }).badge).toBe('Recent')
    expect(toNoteRow({ id: 'x', title: '  ' }).title).toBe('Untitled')
  })
  it('noteSwitcherUrl encodes the query', () => {
    expect(noteSwitcherUrl('a&b c')).toBe('/api/j2/notes/switcher?q=a%26b%20c&limit=8')
  })
})
