// app/src/components/chart/engine/runtime/__tests__/bareNameStatement.test.js
//
// ─── ⭐ A LONE NAME AS A STATEMENT READS A VALUE AND DOES NOTHING WITH IT ─────
//
// In Pine a block's last line is the block's value; an `if` or `for` written as a
// STATEMENT discards that value. So
//
//     if buy
//         countBuy += 1
//         countBuy
//
// is exactly `if buy countBuy += 1` — the second line has no effect. The runtime
// lane refused it as "a statement shape this front end does not recognise", which
// walled the btc-charlie macro-trend scanner.
//
// ⛔ ONLY A NAME THE SCRIPT BOUND TO A SLOT is skipped. A name nothing binds is a
// TradingView compile error and keeps its refusal — skipping it would accept a
// script the vendor rejects.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
// close alternates up/down: 100, 101, 100, 101, …
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + (i % 2), v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) { return buildRuntimeIr(src, { bars: BARS, inputs: {} }) }
function runPine(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('⭐ a bare name as the last line of a statement `if` is a no-op', () => {
  it('⭐⭐ the btc-charlie counter shape computes the counter', () => {
    // up bars are the odd ones (close 101 > 100 of the bar before); the counter
    // counts up bars and never resets here: bar i → floor((i + 1) / 2)
    const src = `${head}var countBuy = 0\nup = close > close[1]\nif up\n    countBuy += 1\n    countBuy\nplot(countBuy)\n`
    const out = runPine(src)
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(Math.floor((i + 1) / 2))
  })

  it('⛔ CONTROL — the same script without the bare line gives the same numbers', () => {
    const a = runPine(`${head}var c = 0\nif close > close[1]\n    c += 1\n    c\nplot(c)\n`)
    const b = runPine(`${head}var c = 0\nif close > close[1]\n    c += 1\nplot(c)\n`)
    expect(a).toEqual(b)
  })

  it('⛔ a name nothing binds is still refused by name', () => {
    const b = build(`${head}var c = 0\nif close > 0\n    c += 1\n    nosuchname\nplot(c)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:statement')
  })
})
