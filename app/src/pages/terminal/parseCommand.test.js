// @vitest-environment node
// The UCT Terminal command-line grammar, TABLE-DRIVEN. Every row is one input and the one
// answer the shell must act on. ⛔ No row may expect silence: an input either parses or
// says why not (and, where it can, what was meant).
import { describe, it, expect } from 'vitest'
import parseCommand, { formatCommand } from './parseCommand'

const OK = [
  // input                 code     sym      args
  ['NVDA',                 'DES',   'NVDA',  []],
  ['nvda',                 'DES',   'NVDA',  []],
  ['  aapl  ',             'DES',   'AAPL',  []],
  ['NVDA GP',              'GP',    'NVDA',  []],
  ['nvda gp',              'GP',    'NVDA',  []],
  ['AAPL FIL',             'FIL',   'AAPL',  []],
  ['AAPL FA',              'FA',    'AAPL',  []],
  ['MSFT OMON',            'OMON',  'MSFT',  []],
  ['BRK.B DES',            'DES',   'BRK.B', []],
  ['NVDA FLOW',            'FLOW',  'NVDA',  []],
  ['NVDA HIS 1Y',          'HIS',   'NVDA',  ['1Y']],
  ['CAL',                  'CAL',   null,    []],
  ['cal',                  'CAL',   null,    []],
  ['BRD',                  'BRD',   null,    []],
  ['WIRE',                 'WIRE',  null,    []],
  ['FLOW',                 'FLOW',  null,    []],
  ['GP',                   'GP',    null,    []],   // security-only code: the shell supplies the linked one
  ['GP NVDA',              'GP',    'NVDA',  []],   // FUNC TICKER is accepted too
  ['OWN',                  'OWN',   null,    []],   // a code alone is the code…
  ['OWN DES',              'DES',   'OWN',   []],   // …a code in second place makes the first a ticker
  ['$CAL',                 'DES',   'CAL',   []],   // `$` forces a ticker (CAL is a real one)
  ['$CAL FA',              'FA',    'CAL',   []],
  ['GAP',                  'DES',   'GAP',   []],   // a real ticker that is not a code
  ['NVDA ERN',             'ERN',   'NVDA',  []],
  ['HELP',                 'HELP',  null,    []],
  ['help gp',              'HELP',  null,    ['GP']],
  ['?',                    'HELP',  null,    []],
  ['CAL NEXT',             'CAL',   null,    ['NEXT']], // a market code keeps a non-ticker arg
]

const ADDRESSES = [
  ['L:12', 'L:12'],
  ['w:3', 'W:3'],
  ['S:7', 'S:7'],
  ['T:theme-9', 'T:theme-9'],
  ['F:41', 'F:41'],
  ['P:5', 'P:5'],
]

const FAIL = [
  // input              error contains                    suggestions include
  ['',                  'empty',                          []],
  ['NVDA GPX',          'Unknown function "GPX" for NVDA', ['GP']],
  ['NVDA OMN',          'Unknown function "OMN"',          ['OMON']],
  ['#!',                'Unknown command',                 []],   // (a bare number is now row <GO>; see below)
  ['1234',              'Unknown command',                 []],   // …of at most 3 digits
  ['OSCR',              'options screener',                []],
  ['NVDA OBT',          'backtester',                      []],
  ['12AB FA',           'is not a ticker',                 []],
]

describe('parseCommand — the grammar', () => {
  it.each(OK)('%j -> %s on %s', (input, code, sym, args) => {
    const r = parseCommand(input)
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.type).toBe('function')
    expect(r.code).toBe(code)
    expect(r.sym).toBe(sym)
    expect(r.args).toEqual(args)
  })

  it.each(ADDRESSES)('%j is an address-space address', (input, address) => {
    expect(parseCommand(input)).toEqual({ ok: true, type: 'address', address })
  })

  it.each(FAIL)('%j fails OUT LOUD', (input, contains, suggestions) => {
    const r = parseCommand(input)
    expect(r.ok).toBe(false)
    expect(r.error).toContain(contains)
    for (const s of suggestions) expect(r.suggestions).toContain(s)
  })

  it('formatCommand round-trips what history stores', () => {
    expect(formatCommand(parseCommand('nvda gp'))).toBe('NVDA GP')
    expect(formatCommand(parseCommand('cal'))).toBe('CAL')
    expect(formatCommand(parseCommand('l:12'))).toBe('L:12')
  })

  it('non-vacuity: the table exercises every grammar branch', () => {
    expect(OK.length).toBeGreaterThan(20)
    expect(FAIL.some(([i]) => i === '')).toBe(true)
  })
})

// ── lane T3: the grammar's second half (rules published in grammar.js) ─────────
describe('parseCommand — T3: rows, channels, expressions, ASK, aliases, collisions', () => {
  it('a bare 1-3 digit number is row <GO> addressing', () => {
    expect(parseCommand('3')).toEqual({ ok: true, type: 'row', n: 3 })
    expect(parseCommand('123')).toEqual({ ok: true, type: 'row', n: 123 })
  })

  it.each([
    ['@B NVDA', 'B', 'DES', 'NVDA'],
    ['@b nvda gp', 'B', 'GP', 'NVDA'],
    ['@2 AAPL FA', '2', 'FA', 'AAPL'],
    ['@A CAL', 'A', 'CAL', null],
  ])('%j targets channel %s', (input, channel, code, sym) => {
    const r = parseCommand(input)
    expect(r).toMatchObject({ ok: true, type: 'function', channel, code, sym })
    expect(formatCommand(r)).toBe(`@${channel} ${[sym, code].filter(Boolean).join(' ')}`)
  })

  it('a channel with nothing after it, or a non-panel command after it, fails out loud', () => {
    expect(parseCommand('@B').error).toContain('needs a command')
    expect(parseCommand('@B L:12').error).toContain('does not open one')
    expect(parseCommand('@Z NVDA').ok).toBe(false)     // E is not a group
  })

  it('a symbol expression A/B in the noun slot is a comparison, and only CMP takes one', () => {
    expect(parseCommand('NVDA/QQQ')).toMatchObject({ ok: true, code: 'CMP', sym: 'NVDA', args: ['QQQ'], expr: 'NVDA/QQQ', compareMode: 'security' })
    expect(parseCommand('spy/qqq cmp')).toMatchObject({ code: 'CMP', sym: 'SPY', args: ['QQQ'], compareMode: 'index' })
    const bad = parseCommand('NVDA/QQQ GP')
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('works with CMP')
  })

  it('comparison modes: vs sector, index vs index, security vs security', () => {
    expect(parseCommand('NVDA CMP sector')).toMatchObject({ code: 'CMP', sym: 'NVDA', args: ['SECTOR'], compareMode: 'sector' })
    expect(parseCommand('SPY CMP IWM')).toMatchObject({ compareMode: 'index' })
    expect(parseCommand('NVDA CMP AMD')).toMatchObject({ compareMode: 'security', args: ['AMD'] })
  })

  it('ASK <question> is free text; ASK TICKER stays the Ask-AI panel', () => {
    expect(parseCommand('ASK why are semis weak today')).toEqual({ ok: true, type: 'ask', question: 'why are semis weak today' })
    expect(parseCommand('ASK NVDA')).toMatchObject({ type: 'function', code: 'ASK', sym: 'NVDA' })
    expect(parseCommand('NVDA ASK what drove the gap')).toEqual({ ok: true, type: 'ask', question: '$NVDA what drove the gap' })
    expect(formatCommand(parseCommand('ASK is breadth improving'))).toBe('ASK is breadth improving')
  })

  it('a line that is not a command but reads like a question falls back to ASK — never refused', () => {
    expect(parseCommand('what is moving semis')).toMatchObject({ ok: true, type: 'ask', fallback: true })
    expect(parseCommand('nvda earnings date?')).toMatchObject({ ok: true, type: 'ask', fallback: true })
    // …but a near-miss code is still corrected, not shipped to AI Search.
    expect(parseCommand('NVDA GPX').ok).toBe(false)
    expect(parseCommand('OSCR').ok).toBe(false)          // ABSENT keeps its own answer
  })

  it('aliases: define, refuse collisions, expand one level, delete, list', () => {
    expect(parseCommand('ALIAS SEMIS = SMH GP')).toEqual({ ok: true, type: 'alias-define', name: 'SEMIS', expansion: 'SMH GP' })
    expect(parseCommand('alias semis smh gp')).toMatchObject({ type: 'alias-define', name: 'SEMIS', expansion: 'smh gp' })
    expect(parseCommand('ALIAS GP = NVDA GP').error).toContain('already a function')
    expect(parseCommand('ALIAS OSCR = NVDA GP').error).toContain('reserved function code')
    expect(parseCommand('ALIAS SECTOR = NVDA GP').error).toContain('reserved word')
    expect(parseCommand('ALIAS X = NVDA GP').error).toContain('not a valid alias name')
    expect(parseCommand('ALIAS BAD = NVDA GPX').error).toContain('must expand to a command')
    expect(parseCommand('ALIAS LOOP = ALIAS X = Y').ok).toBe(false)
    const aliases = { SEMIS: 'SMH GP', MYQ: 'ASK what is QQQ doing' }
    expect(parseCommand('semis', { aliases })).toMatchObject({ ok: true, code: 'GP', sym: 'SMH', alias: 'SEMIS' })
    expect(parseCommand('myq', { aliases })).toMatchObject({ type: 'ask', alias: 'MYQ' })
    expect(parseCommand('$SEMIS', { aliases })).toMatchObject({ code: 'DES', sym: 'SEMIS' })   // $ forces the ticker
    expect(parseCommand('UNALIAS semis')).toEqual({ ok: true, type: 'alias-delete', name: 'SEMIS' })
    expect(parseCommand('ALIAS')).toEqual({ ok: true, type: 'alias-list' })
  })

  it('an alias expands ONE level — an expansion naming another alias is not re-expanded', () => {
    const aliases = { AA: 'BB', BB: 'NVDA GP' }
    expect(parseCommand('AA', { aliases })).toMatchObject({ code: 'DES', sym: 'BB', alias: 'AA' })
  })

  it.each(['DASH', 'CF', 'GP', 'FORM', 'COMM', 'RES', 'LIVE', 'MB', 'DP'])(
    'V5: bare %s runs the function and is FLAGGED as a ticker collision; $ reads the ticker', (code) => {
      expect(parseCommand(code)).toMatchObject({ ok: true, type: 'function', code, collision: code })
      expect(parseCommand(`$${code}`)).toMatchObject({ code: 'DES', sym: code })
      expect(parseCommand(`${code} DES`)).toMatchObject({ code: 'DES', sym: code })
      expect(parseCommand(`${code} DES`).collision).toBeUndefined()
    })

  it('a non-colliding bare code carries no collision flag', () => {
    expect(parseCommand('CAL').collision).toBeUndefined()
    expect(parseCommand('GP NVDA').collision).toBeUndefined()
  })
})
