// app/src/components/chart/engine/runtime/__tests__/splitAndWalk.test.js
//
// ─── `str.split`, THE BRIDGE FROM A PASTED LIST TO A COLLECTION ─────────────
//
// ⛔⛔ PINE'S `str.split` ON AN EMPTY STRING YIELDS ONE EMPTY ELEMENT, NOT AN
// EMPTY ARRAY — and both acceptance scripts lean on the empty-token skip that
// follows it. Get this wrong and a watchlist pasted with a trailing newline
// gains a PHANTOM SYMBOL, which is then requested, fails, and reads to the
// member as a dead ticker. Every case below that could hide it is here: the
// empty input, the trailing separator, and the doubled separator in the middle.
//
// ⚠️ THE FULL PARSE IDIOM — replace newlines, split, trim each token, skip the
// empties, prefix a default exchange — walks the result with a FOR LOOP, which
// this runtime does not have yet. That test belongs with the loop (plan 5) and
// is deliberately not faked here with an unrolled walk: an unrolled version
// would pass while the real script still refused, which is the kind of green
// that reads as coverage and is not.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function runPine(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const all = (v) => new Array(N).fill(v)

describe('str.split', () => {
  it('splits on a literal separator', () => {
    expect(runPine(
      'p = str.split("AAPL,MSFT,NVDA", ",")\n'
      + 'plot(array.size(p) == 3 and array.get(p, 2) == "NVDA" ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔ an EMPTY input yields ONE EMPTY element, not an empty array', () => {
    // This is the vendor-documented behaviour and the reason the scripts' skip
    // step exists. A runtime that answered "empty array" would make the skip
    // look unnecessary, and the difference would only surface on a real paste.
    expect(runPine(
      'p = str.split("", ",")\n'
      + 'plot(array.size(p) == 1 and str.length(array.get(p, 0)) == 0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔ a TRAILING separator yields a trailing empty element', () => {
    // The phantom-symbol case: "AAPL," is two tokens, the second empty.
    expect(runPine(
      'p = str.split("AAPL,", ",")\n'
      + 'plot(array.size(p) == 2 and str.length(array.get(p, 1)) == 0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('⛔ a DOUBLED separator yields an empty element between them', () => {
    expect(runPine(
      'p = str.split("A,,B", ",")\n'
      + 'plot(array.size(p) == 3 and str.length(array.get(p, 1)) == 0 ? 1 : 0)\n')).toEqual(all(1))
  })

  it('the separator is LITERAL, not a regex', () => {
    // `.` must split on a dot, not on every character.
    expect(runPine(
      'p = str.split("BRK.B", ".")\n'
      + 'plot(array.size(p) == 2 and array.get(p, 0) == "BRK" ? 1 : 0)\n')).toEqual(all(1))
  })

  it('composes with the rest of the parse: replace_all then split then trim', () => {
    // ⭐ The first three steps of both scripts' parsers, without the walk. The
    // walk needs a loop; these three do not, and getting them wrong is what
    // would corrupt the list before the walk ever saw it.
    expect(runPine(
      's = str.replace_all("AAPL\\nMSFT", "\\n", ",")\n'
      + 'p = str.split(s, ",")\n'
      + 'plot(array.size(p) == 2 and str.trim(array.get(p, 1)) == "MSFT" ? 1 : 0)\n')).toEqual(all(1))
  })

  it('CONTROL: the result is a real array — push and size work on it', () => {
    expect(runPine(
      'p = str.split("A,B", ",")\n'
      + 'array.push(p, "C")\n'
      + 'plot(array.size(p) == 3 and array.get(p, 2) == "C" ? 1 : 0)\n')).toEqual(all(1))
  })

  it('CONTROL: a non-string operand is refused BY NAME', () => {
    expect(() => runPine('p = str.split(close, ",")\nplot(array.size(p))\n'))
      .toThrow(/`str\.split` argument 1 takes a string, got number/)
  })
})
