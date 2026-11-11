// app/src/components/chart/engine/runtime/__tests__/w4TextFns.test.js
//
// W4-T11 -- `str.substring`, `str.replace`, `str.tonumber`, `str.pos` and
// `str.format_time` (New York) over RUNTIME text. Every fixture MUTATES (see
// `strBuiltins.test.js`: a pure text subtree is handed to the columnar lane first),
// every assertion EXECUTES, and the sentinel initial value fails every assertion.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { PineRuntimeError } from '../collections.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const OPTS = { bars: BARS, inputs: {}, symbol: { ticker: 'SPY', exchange: 'NYSE Arca' } }
const head = '//@version=6\nindicator("t", overlay = true)\n'

function run(src) {
  const built = buildRuntimeIr(head + src, OPTS)
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}
const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, OPTS)
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}
const fill = (v) => new Array(N).fill(v)
// text `s` holds `init` on every bar (close > open); the plotted expression reads it.
const withS = (init, plotted) => `string s = "!none"\nif close > open\n    s := ${init}\nplot(${plotted})\n`
const cond = (init, test) => withS(init, `(${test}) ? 1 : 0`)

describe('str.substring: 0-based, end exclusive', () => {
  it('three arguments keep [begin, end)', () => {
    expect(run(cond('"abcdef"', 'str.substring(s, 1, 3) == "bc"'))).toEqual(fill(1))
    expect(run(cond('"abcdef"', 'str.substring(s, 0, 1) == "a"'))).toEqual(fill(1))
    expect(run(cond('"abcdef"', 'str.substring(s, 2, 2) == ""'))).toEqual(fill(1))
  })
  it('two arguments run to the end', () => {
    expect(run(cond('"abcdef"', 'str.substring(s, 4) == "ef"'))).toEqual(fill(1))
    expect(run(cond('"abcdef"', 'str.substring(s, 6) == ""'))).toEqual(fill(1))
  })
  it('the position is a runtime value', () => {
    expect(run(cond('"abcdef"', 'str.substring(s, 1, 1 + 2) == "bc"'))).toEqual(fill(1))
  })
  it('a position outside the text stops the script (not a clamp)', () => {
    expect(() => run(cond('"abc"', 'str.substring(s, 0, 9) == "abc"'))).toThrow(/outside a text of length 3/)
    expect(() => run(cond('"abc"', 'str.substring(s, 5) == ""'))).toThrow(/outside a text/)
    expect(() => run(cond('"abc"', 'str.substring(s, 2, 1) == ""'))).toThrow(/outside a text/)
    expect(() => run(cond('"abc"', 'str.substring(s, -1, 2) == ""'))).toThrow(/outside a text/)
  })
  it('a fractional position stops the script', () => {
    expect(() => run(cond('"abc"', 'str.substring(s, 0.5, 2) == "a"'))).toThrow(/whole-number positions/)
  })
  it('CONTROL: a text slot holds the result', () => {
    expect(run(cond('"abcdef"', '(str.substring(s, 1, 3) + "!") == "bc!"'))).toEqual(fill(1))
  })
})

describe('str.replace: the Nth occurrence, literal, from 0', () => {
  it('default is the first occurrence only', () => {
    expect(run(cond('"a.b.c"', 'str.replace(s, ".", "-") == "a-b.c"'))).toEqual(fill(1))
  })
  it('an explicit occurrence counts from 0', () => {
    expect(run(cond('"a.b.c"', 'str.replace(s, ".", "-", 0) == "a-b.c"'))).toEqual(fill(1))
    expect(run(cond('"a.b.c"', 'str.replace(s, ".", "-", 1) == "a.b-c"'))).toEqual(fill(1))
  })
  it('a missing occurrence leaves the text unchanged', () => {
    expect(run(cond('"a.b.c"', 'str.replace(s, ".", "-", 2) == "a.b.c"'))).toEqual(fill(1))
    expect(run(cond('"abc"', 'str.replace(s, "z", "-") == "abc"'))).toEqual(fill(1))
  })
  it('occurrences do not overlap', () => {
    expect(run(cond('"aaa"', 'str.replace(s, "aa", "X", 1) == "aaa"'))).toEqual(fill(1))
  })
  it('a fractional or negative occurrence stops the script', () => {
    expect(() => run(cond('"a.b"', 'str.replace(s, ".", "-", 0.5) == "a-b"'))).toThrow(/occurrence/)
    expect(() => run(cond('"a.b"', 'str.replace(s, ".", "-", -1) == "a-b"'))).toThrow(/occurrence/)
  })
  it('an empty target stops the script', () => {
    expect(() => run(cond('"abc"', 'str.replace(s, "", "-") == "abc"'))).toThrow(/empty target/)
  })
})

describe('str.tonumber and str.pos', () => {
  it('tonumber reads a plain decimal', () => {
    expect(run(withS('"12.5"', 'str.tonumber(s)'))).toEqual(fill(12.5))
    expect(run(withS('"-3"', 'str.tonumber(s)'))).toEqual(fill(-3))
    expect(run(withS('"1e3"', 'str.tonumber(s)'))).toEqual(fill(1000))
  })
  it('tonumber answers na for anything else', () => {
    for (const bad of ['""', '"abc"', '"0x10"', '"Infinity"', '"1,5"']) {
      expect(run(withS(bad, 'na(str.tonumber(s)) ? 1 : 0')), bad).toEqual(fill(1))
    }
  })
  it('pos is 0-based and na when absent', () => {
    expect(run(withS('"abcabc"', 'str.pos(s, "c")'))).toEqual(fill(2))
    expect(run(withS('"abcabc"', 'str.pos(s, "a")'))).toEqual(fill(0))
    expect(run(withS('"abc"', 'na(str.pos(s, "z")) ? 1 : 0'))).toEqual(fill(1))
  })
})

describe('str.format_time: New York, literal pattern', () => {
  const ts = 'timestamp("America/New_York", 2024, 3, 5, 14, 7, 9)'
  it('formats the exchange wall clock', () => {
    expect(run(cond('"x"', `str.format_time(${ts}, "yyyy-MM-dd HH:mm:ss") == "2024-03-05 14:07:09"`))).toEqual(fill(1))
    expect(run(cond('"x"', `str.format_time(${ts}, "d/M/yy H:m:s") == "5/3/24 14:7:9"`))).toEqual(fill(1))
    expect(run(cond('"x"', `str.format_time(${ts}, "yyyy'T'HH") == "2024T14"`))).toEqual(fill(1))
  })
  it('reads the exchange zone across the offset change', () => {
    // 2024-03-09 12:00 UTC is 07:00 EST; 2024-03-10 12:00 UTC is 08:00 EDT
    expect(run(cond('"x"', 'str.format_time(1709985600000, "HH:mm") == "07:00"'))).toEqual(fill(1))
    expect(run(cond('"x"', 'str.format_time(1710072000000, "HH:mm") == "08:00"'))).toEqual(fill(1))
  })
  it('the printed time is text: it concatenates', () => {
    expect(run(cond('"x"', 'str.format_time(1710072000000, "HH:mm", "America/New_York") + "!" == "08:00!"'))).toEqual(fill(1))
  })
  it('an explicit New York zone is the same answer', () => {
    expect(run(cond('"x"', 'str.format_time(1710072000000, "HH:mm", "America/New_York") == "08:00"'))).toEqual(fill(1))
  })
  it('the exchange zone on a chart whose symbol is unknown is refused by name', () => {
    const built = buildRuntimeIr(`${head}${cond('"x"', 'str.format_time(1710072000000, "HH:mm") == "08:00"')}`,
      { bars: BARS, inputs: {} })
    expect(built.ok).toBe(false)
    expect(built.refusal.message).toMatch(/str\.format_time/)
  })
  it('another zone is refused by name', () => {
    expect(refusalOf(cond('"x"', 'str.format_time(1710072000000, "HH:mm", "UTC") == "12:00"')).message)
      .toMatch(/str\.format_time/)
  })
  it('a pattern letter this lane does not print is refused by name', () => {
    expect(refusalOf(cond('"x"', 'str.format_time(1710072000000, "EEE") == "Sat"')).message)
      .toMatch(/str\.format_time/)
  })
})

describe('CONTROL: unserved str.* still refuses by name', () => {
  it('str.match', () => {
    expect(refusalOf(cond('"abcd"', 'str.match(s, "b+") == "b"')).message).toMatch(/str\.match/)
  })
})

// ⭐⭐ B1 (review W4-T11): the error is the ONE `PineRuntimeError`, so the pane pipeline STOPS the
// script. A plain Error here was retried by the objects wrapper WITHOUT drawings and the plots
// were drawn where TradingView shows the error. Through the real `computeRuntimeColumns`.
describe('a str.* runtime error stops the whole script through the pane pipeline', () => {
  const ROWS = BARS.map((b) => ({ ...b }))
  const doc = (src) => ({
    id: 'w4t11-stop',
    compute: { kind: 'runtime', fn: 'runtime:w4t11-stop', source: head + src, outputs: { v: 0 }, objects: true },
  })
  const OVER = 'string s = "!none"\nif close > open\n    s := "abc"\nplot(close)\n'
  const stopOf = (src) => {
    let err = null
    let out = null
    try { out = computeRuntimeColumns(doc(src), ROWS, { tf: 'D' }) } catch (e) { err = e }
    return { err, out }
  }
  it('str.substring reached only by a LABEL stops the script, nothing is plotted', () => {
    const { err, out } = stopOf(OVER + 'label.new(bar_index, high, str.substring(s, 0, 9))\n')
    expect(out, 'the plots must not be drawn').toBe(null)
    expect(err).toBeInstanceOf(PineRuntimeError)
    expect(err.name).toBe('runtime.error')
    expect(err.guard).toBe('runtime:runtime.error')
  })
  it('str.replace with an empty target stops it the same way', () => {
    const { err, out } = stopOf(OVER + 'label.new(bar_index, high, str.replace(s, "", "x"))\n')
    expect(out).toBe(null)
    expect(err && err.guard).toBe('runtime:runtime.error')
  })
  it('a fractional position and a fractional occurrence stop it the same way', () => {
    for (const call of ['str.substring(s, 0.5, 2)', 'str.replace(s, "a", "x", 0.5)', 'str.replace(s, "a", "x", -1)']) {
      const { err, out } = stopOf(OVER + `label.new(bar_index, high, ${call})
`)
      expect(out, call).toBe(null)
      expect(err && err.guard, call).toBe('runtime:runtime.error')
    }
  })
  it('CONTROL: an in-range substring draws the plot and the label', () => {
    const { err, out } = stopOf(OVER + 'label.new(bar_index, high, str.substring(s, 0, 2))\n')
    expect(err).toBe(null)
    expect(out).not.toBe(null)
  })
})
