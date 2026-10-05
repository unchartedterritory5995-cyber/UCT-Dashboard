// @vitest-environment node
// The UCT Terminal command-line grammar, TABLE-DRIVEN. Every row is one input and the one
// answer the shell must act on. ⛔ No row may expect silence: an input either parses or
// says why not (and, where it can, what was meant).
import { describe, it, expect } from 'vitest'
import parseCommand, { formatCommand, normalizeInput } from './parseCommand'

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
  ['CAL TODAY',            'CAL',   null,    ['TODAY']],
  ['NVDA GP W',            'GP',    'NVDA',  ['W']],    // the timeframe the shell honours (args.js)
  // OSCR / OBT were ABSENT answers until 2026-10-02 (V1): both surfaces are built.
  ['OSCR',                 'OSCR',  null,    []],
  ['NVDA OBT',             'OBT',   'NVDA',  []],
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
  ['#!',                'Unknown command',                 []],   // (a bare number of 1-3 digits is row <GO>; see below)
  ['1234',              'Unknown command',                 []],   // …of at most 3 digits
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
    // E … Z are groups a board can ADD (boardModel nextChannelId), so they parse; whether THIS
    // board has one is the shell's answer (channelTarget), said out loud there.
    expect(parseCommand('@Z NVDA')).toMatchObject({ ok: true, channel: 'Z' })
    expect(parseCommand('@e nvda gp')).toMatchObject({ ok: true, channel: 'E', code: 'GP' })
    expect(parseCommand('@C27 NVDA')).toMatchObject({ ok: true, channel: 'C27' })
    expect(parseCommand('@5 NVDA').ok).toBe(false)     // there is no panel 5
    expect(parseCommand('@AB NVDA').ok).toBe(false)
  })

  it('@B ASK <question> is accepted — ASK opens a panel, so a channel-targeted ASK is valid', () => {
    const r = parseCommand('@B ASK why is NVDA down')
    expect(r).toMatchObject({ ok: true, type: 'ask', channel: 'B', question: 'why is NVDA down' })
    expect(formatCommand(r)).toBe('@B ASK why is NVDA down')
    // `@B <question>` (ASK implied via the question fallback) is likewise accepted.
    const r2 = parseCommand('@2 what is driving the market today')
    expect(r2).toMatchObject({ ok: true, type: 'ask', channel: '2' })
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
    expect(parseCommand('NVDA OMN').ok).toBe(false)      // a near-miss keeps its "did you mean"
  })

  it('aliases: define, refuse collisions, expand one level, delete, list', () => {
    expect(parseCommand('ALIAS SEMIS = SMH GP')).toEqual({ ok: true, type: 'alias-define', name: 'SEMIS', expansion: 'SMH GP' })
    expect(parseCommand('alias semis smh gp')).toMatchObject({ type: 'alias-define', name: 'SEMIS', expansion: 'smh gp' })
    expect(parseCommand('ALIAS GP = NVDA GP').error).toContain('already a function')
    expect(parseCommand('ALIAS OSCR = NVDA GP').error).toContain('already a function')   // T1 made OSCR live
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

  // 2026-10-05 collision-list audit: cross-checked against api/data/cap_universe.json.
  // GP/MB/LIVE/DP/COMM were REMOVED (none is a real tracked ticker — a false collision);
  // CAL/TECH/FA/EE/PPL/CMP/NB/EXP were ADDED (each IS a real tracked ticker that was missing
  // its warning). DASH/CF/FORM/RES stay — all four verified still in the universe.
  it.each(['DASH', 'CF', 'FORM', 'RES', 'CAL', 'TECH', 'FA', 'EE', 'PPL', 'NB', 'EXP'])(
    'V5: bare %s runs the function and is FLAGGED as a ticker collision; $ reads the ticker', (code) => {
      expect(parseCommand(code)).toMatchObject({ ok: true, type: 'function', code, collision: code })
      expect(parseCommand(`$${code}`)).toMatchObject({ code: 'DES', sym: code })
      expect(parseCommand(`${code} DES`)).toMatchObject({ code: 'DES', sym: code })
      expect(parseCommand(`${code} DES`).collision).toBeUndefined()
    })

  it('a non-colliding bare code carries no collision flag', () => {
    // GP/MB/LIVE/DP/COMM were removed from TICKER_COLLISIONS — none is a real ticker.
    expect(parseCommand('GP').collision).toBeUndefined()
    expect(parseCommand('MB').collision).toBeUndefined()
    expect(parseCommand('GP NVDA').collision).toBeUndefined()
  })
})

// ── 2026-10-05 shell audit (round 2): each row was a reproduced defect ────────────────────
describe('parseCommand — audit round 2 regressions', () => {
  it('#6: a `$` on the SECOND token (or the comparator) forces a ticker and is not part of it', () => {
    expect(parseCommand('GP $NVDA')).toMatchObject({ ok: true, code: 'GP', sym: 'NVDA', args: [] })
    expect(parseCommand('ASK $NVDA')).toMatchObject({ ok: true, type: 'function', code: 'ASK', sym: 'NVDA' })
    expect(parseCommand('GP $CF')).toMatchObject({ code: 'GP', sym: 'CF' })
    const cmp = parseCommand('NVDA CMP $AMD')
    expect(cmp).toMatchObject({ code: 'CMP', sym: 'NVDA', args: ['AMD'], compareMode: 'security' })
    expect(formatCommand(cmp)).toBe('NVDA CMP AMD')
  })

  it('#8: BRK/B is the share-class ticker BRK.B, not a comparison of BRK and B', () => {
    expect(parseCommand('BRK/B')).toMatchObject({ ok: true, code: 'DES', sym: 'BRK.B' })
    expect(parseCommand('BRK/B GP')).toMatchObject({ ok: true, code: 'GP', sym: 'BRK.B' })
    // two real tickers still compare, and `$B` keeps the one-letter ticker
    expect(parseCommand('NVDA/AMD')).toMatchObject({ code: 'CMP', sym: 'NVDA', args: ['AMD'] })
    expect(parseCommand('NVDA/$B')).toMatchObject({ code: 'CMP', sym: 'NVDA', args: ['B'] })
  })

  it('#15: a pasted upper-case ticker LIST is refused with a pointer, never sent to AI Search', () => {
    const r = parseCommand('NVDA AMD MSFT TSLA')
    expect(r.ok).toBe(false)
    expect(r.type).toBe('list')
    expect(r.error).toMatch(/list of tickers/)
    expect(r.error).toMatch(/one ticker/)
    expect(parseCommand('NVDA, AMD, MSFT').type).toBe('list')
    // prose and questions still go to AI Search
    expect(parseCommand('what is moving semis')).toMatchObject({ type: 'ask' })
    expect(parseCommand('WHY IS NVDA DOWN')).toMatchObject({ type: 'ask' })
    expect(parseCommand('NVDA AMD MSFT TSLA?')).toMatchObject({ type: 'ask' })
  })

  it('#21: `GP W` reads W as GP\'s timeframe (what the echo already showed); `GP $W` is the ticker', () => {
    expect(parseCommand('GP W')).toMatchObject({ ok: true, code: 'GP', sym: null, args: ['W'], argNotTicker: 'W' })
    expect(parseCommand('GP 60')).toMatchObject({ code: 'GP', sym: null, args: ['60'] })
    expect(parseCommand('GP $W')).toMatchObject({ code: 'GP', sym: 'W', args: [] })
    expect(parseCommand('W GP')).toMatchObject({ code: 'GP', sym: 'W' })          // first position untouched
    expect(parseCommand('GP NVDA')).toMatchObject({ code: 'GP', sym: 'NVDA' })
    expect(parseCommand('DES W')).toMatchObject({ code: 'DES', sym: 'W' })        // DES takes no timeframe
  })

  it('#22: full-width characters, smart quotes and trailing punctuation are cleaned before parsing', () => {
    expect(normalizeInput('ＮＶＤＡ ＧＰ')).toBe('NVDA GP')
    expect(parseCommand('ＮＶＤＡ')).toMatchObject({ ok: true, code: 'DES', sym: 'NVDA' })
    expect(parseCommand('“NVDA”')).toMatchObject({ ok: true, code: 'DES', sym: 'NVDA' })
    expect(parseCommand('‘NVDA’ GP')).toMatchObject({ ok: true, code: 'GP', sym: 'NVDA' })
    expect(parseCommand('NVDA,')).toMatchObject({ ok: true, code: 'DES', sym: 'NVDA' })
    expect(parseCommand('NVDA GP.')).toMatchObject({ ok: true, code: 'GP', sym: 'NVDA', args: [] })
    expect(parseCommand('BRK.B.')).toMatchObject({ ok: true, sym: 'BRK.B' })
    expect(parseCommand('?')).toMatchObject({ code: 'HELP' })                   // `?` survives
    expect(parseCommand("ASK what's driving it")).toMatchObject({ type: 'ask', question: "what's driving it" })
  })
})
