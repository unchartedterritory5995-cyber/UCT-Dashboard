// app/src/components/chart/engine/runtime/__tests__/s4InputDeadDataArms.test.js
//
// ─── PINE DATA UNIT S4-1: A DATA READ THE MEMBER'S INPUTS NEVER TAKE IS NOT A WALL ─────────────
//
// TradingView's own VWAP reads `request.earnings` / `request.dividends` / `request.splits` only
// inside the `"Earnings"` / `"Dividends"` / `"Splits"` arms of `switch anchor`, where `anchor` is
// `var anchor = input.string(defval = "Session", …)`. At the default the Session arm runs on every
// bar and the data is never read, so the run needs none of it. Pine runs the arm a `switch` takes
// and no other; `pineRuntimeFrontend.js::dataDeadSwitchArm` lowers only that arm when an arm NOT
// taken reads data, and the member's own value decides which arm that is. The sources below are
// written here (the VWAP's shape, never its text).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { textInputVarsOf } from '../runtimeInputs.js'
import { blockStatements, lexPine } from '../../ast/pine.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: i % 2 ? 101 : 99, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("s4-1 probe", overlay = true)\n'

const build = (src, inputs) => buildRuntimeIr(head + src, { bars: BARS, inputs: inputs || {} })

function run(src, inputs) {
  const built = build(src, inputs)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(outputs[0])
}

const refusal = (src, inputs) => {
  const built = build(src, inputs)
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

const OPTIONS = 'options = ["Earnings", "Dividends", "Splits", "Session"]'
const ARMS = [
  'isNew = switch anchor',
  '    "Earnings" =>',
  '        e = request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(e)',
  '    "Dividends" =>',
  '        d = request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(d)',
  '    "Splits" =>',
  '        s = request.splits(syminfo.tickerid, splits.denominator, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(s)',
  '    "Session" => close > open',
  '    => false',
  'plot(isNew ? 1 : 0, "a")',
]
const VWAP_SHAPE = [`var anchor = input.string(defval = "Session", title = "Anchor", ${OPTIONS})`, ...ARMS].join('\n')
const PLAIN_INPUT = [`anchor = input.string("Session", "Anchor", ${OPTIONS})`, ...ARMS].join('\n')
// the taken arm's value on BARS: close > open on the odd bars
const SESSION = [0, 1, 0, 1]

describe('S4-1: a data read in a switch arm the inputs never take', () => {
  it('⭐ the VWAP shape builds at its default and draws the Session arm on every bar', () => {
    expect(run(VWAP_SHAPE)).toEqual(SESSION)
  })

  it('⭐ a plain (non-`var`) text input does the same', () => {
    expect(run(PLAIN_INPUT)).toEqual(SESSION)
  })

  it.each(['Earnings', 'Dividends', 'Splits'])('⛔ the member picks %s: the arm that reads data is built and refused by name', (pick) => {
    const call = { Earnings: 'request.earnings', Dividends: 'request.dividends', Splits: 'request.splits' }[pick]
    for (const src of [VWAP_SHAPE, PLAIN_INPUT]) {
      const r = refusal(src, { anchor: pick })
      expect(`${r.guard} ${r.message}`).toContain(call)
    }
  })

  it('the member picking the default arm by name draws it', () => {
    expect(run(VWAP_SHAPE, { anchor: 'Session' })).toEqual(SESSION)
  })

  it('⛔ a member value outside the author\'s options keeps its refusal by name', () => {
    const r = refusal(VWAP_SHAPE, { anchor: 'Quarter' })
    expect(r.message).toContain('Quarter')
  })

  it('⛔ a `var` the script reassigns is not fixed text: the data arm keeps its refusal', () => {
    const src = VWAP_SHAPE.replace('isNew = switch anchor', 'if bar_index == 2\n    anchor := "Earnings"\nisNew = switch anchor')
    expect(refusal(src).message).toContain('request.earnings')
  })

  it('⛔ a per-bar subject is not fixed text: the data arm keeps its refusal', () => {
    const src = ARMS.join('\n').replace('isNew = switch anchor', 'anchor = close > open ? "Session" : "Earnings"\nisNew = switch anchor')
    expect(refusal(src).message).toContain('request.earnings')
  })

  it('⛔ NARROW: a fixed switch whose untaken arm holds a non-data wall keeps that wall', () => {
    const src = [
      `anchor = input.string("Session", "Anchor", options = ["Lower", "Session"])`,
      'x = switch anchor',
      '    "Lower" =>',
      '        lt = request.security_lower_tf(syminfo.tickerid, "1", close)',
      '        array.size(lt)',
      '    "Session" => close',
      '    => 0',
      'plot(x, "a")',
    ].join('\n')
    const r = refusal(src)
    expect(`${r.guard} ${r.message}`).toMatch(/security_lower_tf|lower/i)
  })

  it('⭐ the `?:` form (Black-Scholes\' `usediv ? request.dividends(…) : 0`) at its default is not a wall', () => {
    const src = [
      'usediv = input.bool(false, "Adjust for dividends?")',
      'q = usediv ? request.dividends(syminfo.tickerid) / close * 4 : 0',
      'plot(close + q, "a")',
    ].join('\n')
    expect(run(src)).toEqual(BARS.map((b) => b.c))
    expect(`${refusal(src, { usediv: 1 }).message}`).toContain('request.dividends')
  })
})

describe('textInputVarsOf (the `var` that holds an input)', () => {
  const stmtsOf = (src) => {
    const { tokens, indents } = lexPine(head + src)
    return blockStatements(tokens, indents, 0)
  }

  it('finds `var NAME = input.string(…)` declared once and never reassigned, stamped with its name', () => {
    const m = textInputVarsOf(stmtsOf(VWAP_SHAPE))
    expect([...m.keys()]).toEqual(['anchor'])
    expect(m.get('anchor').boundName).toBe('anchor')
  })

  it('⛔ not a reassigned one, not a number input, not a non-`var`', () => {
    expect(textInputVarsOf(stmtsOf(`${VWAP_SHAPE}\nanchor := "Earnings"`)).size).toBe(0)
    expect(textInputVarsOf(stmtsOf('var n = input.int(3, "n")\nplot(n)')).size).toBe(0)
    expect(textInputVarsOf(stmtsOf(PLAIN_INPUT)).size).toBe(0)
  })
})
