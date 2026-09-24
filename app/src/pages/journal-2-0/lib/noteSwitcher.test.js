/**
 * The quick switcher's placement rule, as data. The palette test drives the
 * rule through the real component; this pins each branch of it so a change to
 * the ORDER cannot hide behind a change to the fetch mocks.
 */
import { describe, it, expect } from 'vitest'
import {
  ENTER_WAIT_MS, enterMustWait, extendsExhausted, normalizeSwitcherQuery, noteContextLine, noteSwitcherUrl,
  orderPaletteRows, splitTitleMatch, tickerLeads, toNoteRow,
} from './noteSwitcher'

const TICKER_LIKE = /^[A-Z0-9.\-]{1,10}$/
const cmd = { kind: 'command', id: 'nb-trash', label: 'Open Trash' }
const kw = { kind: 'note', id: 'k1', title: 'Kept', badge: 'Recent' }
const tk = (ticker, extra = {}) => ({ kind: 'ticker', ticker, ...extra })
// The server's own flags (review S3): placement reads THESE, never a tier number.
const nt = (id, { strong = false, exact = false, tier = null } = {}) => toNoteRow({
  id, title: `T${id}`, matchTier: tier, strong, exact,
})

describe('orderPaletteRows', () => {
  it('a ticker-shaped query keeps EVERY ticker row above every note', () => {
    const rows = orderPaletteRows({
      commands: [cmd], keywordNotes: [kw],
      tickers: [tk('AAPL'), tk('APPS'), tk('APP', { _typed: true })],
      noteMatches: [nt('a', { strong: true }), nt('b')],
      qUpper: 'APP', tickerLead: true, tickersSettled: true,
    })
    expect(rows.map((r) => r.ticker || r.id)).toEqual(['nb-trash', 'k1', 'AAPL', 'APPS', 'APP', 'a', 'b'])
  })

  it('a note-shaped query: exact ticker, then strong notes, then other tickers, then weak notes', () => {
    const rows = orderPaletteRows({
      commands: [], keywordNotes: [],
      tickers: [tk('EARNS'), tk('EARNINGS'), tk('EARNINGS', { _typed: true })],
      noteMatches: [nt('strong', { strong: true }), nt('weak')],
      qUpper: 'EARNINGS', tickerLead: false,
    })
    expect(rows.map((r) => (r._typed ? 'typed' : r.ticker || r.id)))
      .toEqual(['EARNINGS', 'strong', 'EARNS', 'typed', 'weak'])
  })

  it('the synthetic typed row never counts as an exact ticker hit', () => {
    const rows = orderPaletteRows({
      tickers: [tk('Q3 PLAN', { _typed: true })],
      noteMatches: [nt('s', { strong: true })], qUpper: 'Q3 PLAN', tickerLead: false,
    })
    expect(rows[0].id).toBe('s')
  })

  it('a note already listed by keyword is never listed twice', () => {
    const rows = orderPaletteRows({
      keywordNotes: [kw], noteMatches: [nt('k1', { strong: true }), nt('z', { strong: true })], tickerLead: false,
    })
    expect(rows.filter((r) => r.id === 'k1')).toHaveLength(1)
    expect(rows.map((r) => r.id)).toEqual(['k1', 'z'])
  })
})

describe('orderPaletteRows — placement reads the server\'s flags (S3) and an exact title can take Enter (S5)', () => {
  const plan = nt('plan', { strong: true, exact: true })
  const typed = tk('PLAN', { _typed: true })

  it('⛔ a tier number alone places nothing: strong comes only from the server', () => {
    const rows = orderPaletteRows({
      tickers: [tk('EARNS')], noteMatches: [nt('t0', { tier: 0 })], qUpper: 'EARNINGS', tickerLead: false,
    })
    expect(rows.map((r) => r.ticker || r.id)).toEqual(['EARNS', 't0'])
  })

  it('a short query whose ticker search found NO exact ticker: the exact note title is the Enter target', () => {
    const rows = orderPaletteRows({
      tickers: [tk('PLNT'), typed], noteMatches: [nt('other', { strong: true }), plan],
      qUpper: 'PLAN', tickerLead: true, tickersSettled: true,
    })
    expect(rows.map((r) => (r._typed ? 'typed' : r.ticker || r.id))).toEqual(['plan', 'PLNT', 'typed', 'other'])
  })

  it('⛔ before the ticker search answers, the tickers lead whatever the notes said', () => {
    const rows = orderPaletteRows({
      tickers: [typed], noteMatches: [plan], qUpper: 'PLAN', tickerLead: true, tickersSettled: false,
    })
    expect(rows[0]._typed).toBe(true)
  })

  it('⛔ a ticker that IS the query keeps Enter, even beside an exact note title', () => {
    const rows = orderPaletteRows({
      tickers: [tk('PLAN')], noteMatches: [plan], qUpper: 'PLAN', tickerLead: true, tickersSettled: true,
    })
    expect(rows.map((r) => r.ticker || r.id)).toEqual(['PLAN', 'plan'])
  })

  it('a strong but not exact note never takes Enter from a ticker-shaped query', () => {
    const rows = orderPaletteRows({
      tickers: [typed], noteMatches: [nt('planning', { strong: true })],
      qUpper: 'PLAN', tickerLead: true, tickersSettled: true,
    })
    expect(rows[0]._typed).toBe(true)
  })

  it('toNoteRow takes the flags only when the server set them', () => {
    expect(toNoteRow({ id: 'a', strong: true, exact: true })).toMatchObject({ strong: true, exact: true })
    expect(toNoteRow({ id: 'a', matchTier: 0 })).toMatchObject({ strong: false, exact: false })
  })
})

describe('N1 — a query the server says no note can match, however it grows', () => {
  it('normalises the way the server does', () => {
    expect(normalizeSwitcherQuery('  ZZZZ   Q ')).toBe('zzzz q')
  })
  it('an extension of an exhausted query is skipped; a different query is asked', () => {
    expect(extendsExhausted('zzzz', 'zzzzq')).toBe(true)
    expect(extendsExhausted('zzzz', 'ZZZZ  x')).toBe(true)
    expect(extendsExhausted('zzzz', 'zzz')).toBe(false)     // a backspace past it
    expect(extendsExhausted('zzzz', 'nvda')).toBe(false)
    expect(extendsExhausted(null, 'zzzz')).toBe(false)
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

describe('R1-N2 — enterMustWait: Enter waits only while its target is still a guess', () => {
  const exactNote = nt('p', { strong: true, exact: true })
  const base = { tickerLead: true, notesSettled: true, tickersSettled: true, noteMatches: [] }
  it('waits while the notes have not answered a ticker-shaped query (an exact title may yet arrive)', () => {
    expect(enterMustWait({ ...base, notesSettled: false })).toBe(true)
  })
  it('waits while an exact title is in and the ticker search has not answered', () => {
    expect(enterMustWait({ ...base, tickersSettled: false, noteMatches: [exactNote] })).toBe(true)
  })
  it('does not wait once both answered, or when the notes answered with no exact title', () => {
    expect(enterMustWait({ ...base, noteMatches: [exactNote] })).toBe(false)
    expect(enterMustWait({ ...base, tickersSettled: false, noteMatches: [nt('x', { strong: true })] })).toBe(false)
  })
  it('never waits when a command or keyword row leads, or for a note-shaped query', () => {
    expect(enterMustWait({ ...base, notesSettled: false, hasFixedLeaders: true })).toBe(false)
    expect(enterMustWait({ ...base, notesSettled: false, tickerLead: false })).toBe(false)
  })
  it('the bound is short enough to read as a pause, not a hang', () => {
    expect(ENTER_WAIT_MS).toBeGreaterThan(0)
    expect(ENTER_WAIT_MS).toBeLessThanOrEqual(400)
  })
})
