// @vitest-environment node
// app/src/components/chart/engine/runtime/__tests__/topLevelNames.test.js
//
// ⭐ STUDIO R5, half 1 (Indicators backlog 44): `topLevelNames(source) -> [{name, line}]`. Each
// exclusion below has a control the same reader must answer the other way, so a green is the
// rule's and not a reader that sees nothing.
import { describe, it, expect } from 'vitest'
import { topLevelNames } from '../topLevelNames.js'
import * as serverEntry from '../serverEntry.js'

const FIXTURE = [
  '//@version=5',                                           // 1
  'indicator("Names", overlay = false)',                    // 2
  'len = input.int(14, "Length")',                          // 3
  'float level = 70.0',                                     // 4
  'var int count = 0',                                      // 5
  'varip float tick = na',                                  // 6
  'series float smooth = ta.ema(close, len)',               // 7
  '[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)', // 8
  'fast = 1, slow = 2',                                     // 9
  'dir = if close > open',                                  // 10
  '    1',                                                  // 11
  'else',                                                   // 12
  '    -1',                                                 // 13
  'f(x) =>',                                                // 14
  '    inner = x * 2',                                      // 15
  '    inner',                                              // 16
  'if close > level',                                       // 17
  '    blockLocal = 1',                                     // 18
  '    count := count + blockLocal',                        // 19
  'for i = 0 to 9',                                         // 20
  '    loopLocal = i',                                      // 21
  'count += 1',                                             // 22
  'r = ta.rsi(close, len)',                                 // 23
  'plot(r, title = "RSI")',                                 // 24
  'g(y) => z = y + 1, z',                                   // 25: a one-line function's own declaration
].join('\n')

const EXPECTED = [
  { name: 'len', line: 3 },
  { name: 'level', line: 4 },
  { name: 'count', line: 5 },
  { name: 'tick', line: 6 },
  { name: 'smooth', line: 7 },
  { name: 'macdLine', line: 8 },
  { name: 'signalLine', line: 8 },
  { name: 'hist', line: 8 },
  { name: 'fast', line: 9 },
  { name: 'slow', line: 9 },
  { name: 'dir', line: 10 },
  { name: 'r', line: 23 },
]

const names = (src) => topLevelNames(src).map((x) => x.name)

describe('topLevelNames', () => {
  it('answers the fixture script\'s top-level names, in source order, with 1-based lines', () => {
    expect(topLevelNames(FIXTURE)).toEqual(EXPECTED)
  })

  it('answers exactly {name, line} for each entry', () => {
    for (const entry of topLevelNames(FIXTURE)) expect(Object.keys(entry).sort()).toEqual(['line', 'name'])
  })

  it('excludes a name inside a function body or an if-block, and a for loop\'s counter (control: the same names at the top level count)', () => {
    const got = names(FIXTURE)
    for (const n of ['inner', 'blockLocal', 'loopLocal', 'i', 'f', 'x', 'g', 'y', 'z']) expect(got).not.toContain(n)
    // CONTROL: the same declarations written at the top level are read
    const flat = 'inner = 2\nblockLocal = 1\nloopLocal = 0\ni = 3\nz = 4'
    expect(names(flat)).toEqual(['inner', 'blockLocal', 'loopLocal', 'i', 'z'])
  })

  it('does not list a reassignment as a declaration (control: its declaration is listed once)', () => {
    const got = topLevelNames(FIXTURE).filter((x) => x.name === 'count')
    expect(got).toEqual([{ name: 'count', line: 5 }])
  })

  it('does not read a comment or a string that looks like a declaration (control: the same text as code is read)', () => {
    const src = [
      '//@version=5',
      'indicator("x = 1")',
      '// ghost = close',
      'label.new(bar_index, high, "phantom = 2")',
      'real = close',
      'note = "fake = 3"',
      'plot(real)',
    ].join('\n')
    expect(topLevelNames(src)).toEqual([{ name: 'real', line: 5 }, { name: 'note', line: 6 }])
    // CONTROL: uncommented, the "ghost" line is a declaration
    expect(topLevelNames(src.replace('// ghost', 'ghost'))).toContainEqual({ name: 'ghost', line: 3 })
  })

  it('answers the backlog 44 repro', () => {
    expect(topLevelNames('len = input.int(14)\nr = ta.rsi(close, len)\nplot(r)'))
      .toEqual([{ name: 'len', line: 1 }, { name: 'r', line: 2 }])
    expect(topLevelNames('//@version=5\nindicator("t")\n[a, b] = f()\nplot(a)'))
      .toEqual([{ name: 'a', line: 3 }, { name: 'b', line: 3 }])
  })

  it('counts lines across CRLF line endings and a string that spans lines', () => {
    expect(topLevelNames('a = 1\r\nb = 2\r\nc = 3')).toEqual([
      { name: 'a', line: 1 }, { name: 'b', line: 2 }, { name: 'c', line: 3 }])
    expect(topLevelNames('t = "two\nlines"\nafter = 1')).toEqual([{ name: 't', line: 1 }, { name: 'after', line: 3 }])
  })

  it('answers [] for a source that does not parse, and never throws', () => {
    for (const bad of ['x = "unterminated', 'a = 1   b = 2', null, undefined, 42, {}]) {
      expect(() => topLevelNames(bad)).not.toThrow()
      expect(topLevelNames(bad)).toEqual([])
    }
    expect(topLevelNames('')).toEqual([])
  })

  it('is the function the server bundle exports', () => {
    expect(serverEntry.topLevelNames).toBe(topLevelNames)
  })
})
