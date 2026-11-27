// app/src/components/chart/engine/runtime/__tests__/taintTwoStart.test.js
//
// ─── START-TAINT: THE TWO-START ORACLE — a value tagged C must be the value an earlier start computes ────────────────
//
// The tags' own promise, checked against the thing it promises about: the same script is run twice over one capture,
// once from its first bar (the EARLIER start) and once from bar `s` (a LATER start, an off-listing chart that holds
// less history). Every output bar the later run tags C must equal the earlier run's value on the same bar. Two later
// starts, so a value that agrees with one by accident is still caught. Over every committed corpus script the runtime
// frontend builds directly, plus this file's own fixtures (each family of `taintBuiltins.test.js`).
//
// ⭐ It found the stack-at-join hole (e105): a ternary lowered to branches left its arm's constant tag on the stack
// past the join, and kernel-channel's `midColor` was released clean on its first bar (234 wrong bars, 4 scripts).
// Its mutants (`ci/mutants/e105-taint-builtins.json`, census rows) switch a rule off and this rail must go wrong > 0.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import { execute, executeTainted } from '../vm.js'
import { contextForProgram } from '../lower.js'
import { lowerIrProgram } from '../lowerIr.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { interpret } from '../../ast/interpret.js'
import { columnTaintOf } from '../taintTags.js'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const CAPTURE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'adx-and-di-for-v4-spy-1d-2026-11-17.json')
const BARS = 700
const STARTS = [37, 150]

const X = 'var float v = na\nv := close\nx = v[close > open ? 9 : 0]\n'
const FIXTURES = {
  'fixture: windows': `f(x) => ta.sma(x, 3)\ng(x) => ta.dev(x, 3)\nh(x) => ta.highest(x, 4)\n${X}plot(f(x))\nplot(g(x))\nplot(h(x))\nplot(ta.sma(close, 5))\nplot(ta.wma(close > open ? close : na, 3))`,
  'fixture: events': `f(c) => ta.barssince(c)\ng(c, x) => ta.valuewhen(c, x, 1)\nk(x) => fixnan(x)\n${X}plot(f(x > close[1]))\nplot(g(close > open, close))\nplot(k(x))`,
  'fixture: lags and recurrences': 'f(a, b) => ta.crossover(a, b)\ne(x) => ta.ema(x, 3)\nplot(f(close, open) ? 1 : 0)\nplot(ta.change(close))\nplot(e(close))',
  'fixture: a window under a branch': `${X}float s = na\nif x > 0\n    s := ta.sma(close, 3)\nplot(s)`,
  'fixture: a ternary lowered to branches': 'var float hi = na\nhi := high\nc = hi > hi[1] ? 1.0 : hi < hi[1] ? 2.0 : 3.0\nplot(c)',
}

function run(src, bars, tainted) {
  const trees = []
  let valuesOf = null
  let built
  try {
    built = buildRuntimeIr(src.startsWith('//@version') ? src : `//@version=5\nindicator("t")\n${src}`, { bars, inputs: {},
      columnInterpret: (t, b, i, o) => {
        trees.push(t)
        valuesOf = (n) => interpret(n, b, i, undefined, undefined, o)
        return interpret(t, b, i, undefined, undefined, o)
      } })
  } catch { return null }
  if (!built.ok) return null
  const program = lowerIrProgram(built.ir)
  const ctx = contextForProgram(program, bars)
  try {
    return tainted ? executeTainted(program, ctx, undefined, { taint: columnTaintOf(trees, (n) => valuesOf(n)) }) : execute(program, ctx)
  } catch { return null }
}

const same = (a, b) => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number'
  && (Number.isNaN(a) ? Number.isNaN(b) : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))))

describe('the two-start oracle: every bar tagged C on a later start is the earlier start\'s value', () => {
  it('over the corpus the runtime frontend builds directly and the fixtures: wrong == 0, and it releases', () => {
    const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
    const rows = cap.bars.rows.slice(0, BARS).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const sources = { ...FIXTURES }
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) sources[f] = fs.readFileSync(path.join(CORPUS, f), 'utf8')
    const wrong = []
    let released = 0
    let compared = 0
    let scripts = 0
    for (const [name, src] of Object.entries(sources)) {
      const early = run(src, rows, false)
      if (!early) { expect(name.startsWith('fixture'), `${name} must build`).toBe(false); continue }
      scripts += 1
      for (const s of STARTS) {
        const late = run(src, rows.slice(s), true)
        if (!late) continue
        for (let k = 0; k < late.outputs.length; k += 1) {
          for (let i = 0; i < late.outputs[k].length; i += 1) {
            compared += 1
            if (late.taint.outputs[k][i] !== 0) continue
            released += 1
            if (!same(late.outputs[k][i], early.outputs[k][i + s]) && wrong.length < 40) {
              wrong.push(`${name} (start ${s}) output ${k} bar ${i}: released ${late.outputs[k][i]}, the earlier start has ${early.outputs[k][i + s]}`)
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`two-start oracle: ${JSON.stringify({ scripts, compared, released, wrong: wrong.length })}\n${wrong.join('\n')}`)
    expect(scripts, 'non-vacuity: many scripts ran').toBeGreaterThan(20)
    expect(released, 'non-vacuity: the tags release values').toBeGreaterThan(50000)
    expect(wrong).toEqual([])
  }, 1800000)
})
