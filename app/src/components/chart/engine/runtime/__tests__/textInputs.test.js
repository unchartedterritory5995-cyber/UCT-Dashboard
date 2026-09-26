// app/src/components/chart/engine/runtime/__tests__/textInputs.test.js
//
// ─── THE DOOR A MEMBER PASTES THEIR WATCHLIST THROUGH ───────────────────────
//
// ⭐⭐ THIS IS WHERE THE SLICE'S WALL MOVED TO. With the value model, `str.*`,
// arrays and the loop all landed, the committed acceptance script's first
// refusal became `pine:input-kind` on `input.text_area` — the paste box itself.
// Everything downstream of it already runs.
//
// ⛔⛔ THE COLUMNAR LANE'S REFUSAL IS CORRECT AND STAYS. `pine.js` admits only
// NUMERIC input kinds, and says at length why: a string has no carrier in that
// lane's grammar. This lane has one, so it takes the text inputs and leaves
// that rule exactly where it is — the same shape as every other text capability
// in this wave.
//
// ⛔ A MEMBER'S VALUE WINS OVER THE AUTHOR'S DEFAULT, and only ever a value the
// author's own `options` admit. An out-of-list value is refused BY NAME rather
// than quietly replaced with the default: replacing it would compute a
// different indicator under the member's own setting, silently, which is the
// one thing this door exists to prevent.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src, inputs) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const all = (v) => new Array(N).fill(v)

const refusalOf = (src, inputs) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: inputs || {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('text inputs reach the runtime', () => {
  it('input.text_area carries its author default', () => {
    expect(runPine(
      'raw = input.text_area("AAPL,MSFT", "Symbols")\n'
      + 'p = str.split(raw, ",")\n'
      + 'plot(array.size(p))\n')).toEqual(all(2))
  })

  it("⭐ the MEMBER's value wins over the author's default", () => {
    expect(runPine(
      'raw = input.text_area("AAPL,MSFT", "Symbols")\n'
      + 'p = str.split(raw, ",")\n'
      + 'plot(array.size(p))\n', { raw: 'A,B,C,D' })).toEqual(all(4))
  })

  it('input.string carries its default and compares', () => {
    expect(runPine(
      'mode = input.string("EMA", "MA type", options = ["EMA", "SMA"])\n'
      + 'plot(mode == "EMA" ? 1 : 0)\n')).toEqual(all(1))
  })

  it("…and the member's choice is what the script then sees", () => {
    expect(runPine(
      'mode = input.string("EMA", "MA type", options = ["EMA", "SMA"])\n'
      + 'plot(mode == "SMA" ? 1 : 0)\n', { mode: 'SMA' })).toEqual(all(1))
  })

  it('⛔ a member value OUTSIDE the author\'s options is refused BY NAME', () => {
    // ⛔ Not silently replaced with the default. The member set something; the
    // script would compute a different indicator under it, and they would have
    // no way to tell. This is the string twin of the numeric minval/maxval
    // refusal the columnar lane already makes.
    const r = refusalOf(
      'mode = input.string("EMA", "MA type", options = ["EMA", "SMA"])\n'
      + 'plot(mode == "SMA" ? 1 : 0)\n', { mode: 'WMA' })
    expect(r.message).toMatch(/`mode`/)
    expect(r.message).toMatch(/EMA|SMA/)
  })

  it('CONTROL: with no options declared, any member value is accepted', () => {
    // `input.text_area` never declares options — a watchlist is free text.
    expect(runPine(
      'raw = input.text_area("AAPL", "Symbols")\n'
      + 'plot(raw == "anything at all" ? 1 : 0)\n', { raw: 'anything at all' })).toEqual(all(1))
  })

  it('CONTROL: a NUMERIC input is untouched — still the columnar lane\'s', () => {
    expect(runPine(
      'len = input.int(5, "Length")\n'
      + 'plot(len)\n')).toEqual(all(5))
  })

  it("⛔⛔ a NUMERIC input follows the member too — it did not, and nothing said so", () => {
    // ⚰️ MEASURED 2026-09-20: this lane built its resolver with no
    // `inputValues`, so EVERY numeric input folded to the author's default. A
    // member who changed a length in the settings got the script's original
    // number, on screen, with nothing to say their setting had been ignored.
    // It is a pre-existing gap rather than one this wave introduced, and it is
    // the quiet kind of wrong the whole engine exists to refuse.
    expect(runPine('len = input.int(5, "Length")\nplot(len)\n', { len: 7 })).toEqual(all(7))
  })

  it('CONTROL: a numeric input still honours its author bounds', () => {
    const r = refusalOf('len = input.int(5, "Length", minval = 1, maxval = 10)\nplot(len)\n',
      { len: 99 })
    expect(r.message).toMatch(/len/)
  })

  it('the whole watchlist door: paste, split, walk, prefix', () => {
    expect(runPine(
      'raw = input.text_area("AAPL,MSFT\\nNVDA", "Symbols")\n'
      + 's = str.replace_all(raw, "\\n", ",")\n'
      + 'p = str.split(s, ",")\n'
      + 'out = array.new<string>()\n'
      + 'for i = 0 to array.size(p) - 1\n'
      + '    t = str.trim(array.get(p, i))\n'
      + '    if str.length(t) > 0\n'
      + '        array.push(out, str.contains(t, ":") ? t : "NASDAQ:" + t)\n'
      + 'plot(array.size(out) == 3 and array.get(out, 2) == "NASDAQ:NVDA" ? 1 : 0)\n'))
      .toEqual(all(1))
  })
})
