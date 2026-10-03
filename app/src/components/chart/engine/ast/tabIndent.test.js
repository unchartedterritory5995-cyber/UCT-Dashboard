// app/src/components/chart/engine/ast/tabIndent.test.js
//
// ─── ⭐ L2 — A TAB IS ONE INDENT LEVEL (four columns), NOT ONE COLUMN ──────────
//
// Pine: "a local block is indented by four spaces or a tab". TradingView's own
// published `TradingView/ta/9` writes ONE function body with a tab on one line and
// four spaces on the next (`supertrend`, lines 546-547); it compiles there, so
// both lines are the same block. The lexer counted a tab as ONE column, so the
// four-space line read as DEEPER than its tab-indented neighbour and the body
// split (`pine:statement` in the imported library, line 547).
//
// ⭐ Measured before/after over all 266 committed scripts, both lanes, with and
// without the 50 library-store libraries: no compiled script's output changed
// (digest of host formulas and runtime IR); three refusals moved.
import { describe, it, expect } from 'vitest'

import { lexPine, translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'

const HEAD = '//@version=5\nindicator("t")\n'
const body = (a, b) => `${HEAD}f(x) =>\n${a}float y = x * 2\n${b}y + 1\nplot(f(close))\n`

describe('⭐ L2 — tab indentation', () => {
  it('⭐ a tab and four spaces are the same indent; a tab after spaces reaches the next stop', () => {
    const { indents } = lexPine(`${HEAD}\tA\n    B\n  \tC\n\t\tD\n`)
    expect(indents.slice(2, 6)).toEqual([4, 4, 4, 8])
  })

  it('⭐ a body mixing a tab line and a four-space line compiles as the all-spaces body (both lanes)', () => {
    const mixed = body('\t', '    ')
    const spaces = body('    ', '    ')
    const h1 = translatePine(mixed, { mode: 'host' })
    const h2 = translatePine(spaces, { mode: 'host' })
    expect(h1.ok, JSON.stringify(h1.refusal)).toBe(true)
    expect(h1.outputs.map((o) => o.formula)).toEqual(h2.outputs.map((o) => o.formula))
    const r1 = buildRuntimeIr(mixed, { tf: 'D', ...runtimeClockOpts(false) })
    const r2 = buildRuntimeIr(spaces, { tf: 'D', ...runtimeClockOpts(false) })
    expect(r1.ok, JSON.stringify(r1.refusal)).toBe(true)
    const shape = (ir) => JSON.stringify(ir, (k, v) => (['column', 'index', 'token', 'at'].includes(k) ? undefined : v))
    expect(shape(r1.ir)).toBe(shape(r2.ir))
  })

  it('⛔ CONTROL: the comparison can tell — a DIFFERENT body is a different IR', () => {
    const shape = (ir) => JSON.stringify(ir, (k, v) => (['column', 'index', 'token', 'at'].includes(k) ? undefined : v))
    const a = buildRuntimeIr(body('    ', '    '), { tf: 'D', ...runtimeClockOpts(false) })
    const b = buildRuntimeIr(body('    ', '    ').replace('y + 1', 'y + 2'), { tf: 'D', ...runtimeClockOpts(false) })
    expect(shape(a.ir)).not.toBe(shape(b.ir))
  })
})
