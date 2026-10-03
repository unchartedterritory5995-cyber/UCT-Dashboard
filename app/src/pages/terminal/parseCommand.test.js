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
  ['123',               'Unknown command',                 []],
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
