import { describe, it, expect } from 'vitest'

import { translatePine, blockStatements, lexPine } from './pine.js'

/**
 * ⭐⭐ H2 (step 69) — a comma line whose segments are statements, `:=` included.
 *
 * Pine runs `a = x, b := y` as the two statements written on two lines, left to
 * right. `blockStatements` split such a line only when EVERY segment was a plain
 * `=` binding and nothing hung beneath it, so
 *
 *     int _direction = na , _direction := switch      — 3-level-zigzag-semafor:18
 *     int _dir = na , _dir := … nz(_dir[1])           — pa-zigzag-fibonacci-fan:16
 *     recent_dn2:=recent_dn1, i_recent_dn2 := i_recent_dn1   — auto-trendline-dojiemoji:119
 *
 * reached the fold as ONE statement, and the reassignment arrived without the
 * binding written beside it (`pine:reassign`), or the `var` it updates was read
 * as never updated (`pine:state`).
 *
 * The rule is checked the strongest way available: the comma form must translate
 * to EXACTLY what the same statements on separate lines translate to (same
 * outputs, same refusals, same trees) — Pine defines the one as the other.
 */
const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

const shapeOf = (out) => JSON.stringify({
  refusal: out.refusal && out.refusal.guard,
  outputs: (out.outputs || []).map((o) => ({
    title: o.title, kind: o.kind, ast: o.ast || null, refusal: o.refusal && o.refusal.guard,
  })),
})

const same = (comma, lines) => {
  const a = translatePine(src(comma))
  const b = translatePine(src(lines))
  expect(shapeOf(a)).toBe(shapeOf(b))
  return a
}

const served = (out) => {
  const o = (out.outputs || []).find((x) => x.refusal === null && x.ast)
  expect(o, JSON.stringify(out.refusal || (out.outputs || []).map((x) => x.refusal))).toBeTruthy()
  return o.ast
}

describe('H2 — a comma line of statements is the statements on separate lines', () => {
  it('⭐ a declaration then its `:=` on one line', () => {
    const out = same(
      'float x = na, x := close * 2\nplot(x)',
      'float x = na\nx := close * 2\nplot(x)')
    expect(served(out)).toEqual({ type: 'op', name: '*', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 2 }] })
  })

  it('⭐ left to right: a later segment reads what an earlier one wrote', () => {
    const out = same(
      'a = close, b = 1.0, b := a + 1\nplot(b)',
      'a = close\nb = 1.0\nb := a + 1\nplot(b)')
    expect(served(out)).toEqual({ type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] })
  })

  it('⭐ a self-reading `:=` beside its declaration (pa-zigzag\'s shape) builds the same recurrence', () => {
    const out = same(
      'int d = na, d := close > open ? 1 : close < open ? -1 : nz(d[1])\nplot(d)',
      'int d = na\nd := close > open ? 1 : close < open ? -1 : nz(d[1])\nplot(d)')
    expect(JSON.stringify(served(out))).toContain('accum')
  })

  it('⭐ two `:=` on one line inside a block, the second reading the first\'s target (auto-trendline\'s shift)', () => {
    const out = same(
      'var float p1 = na\nvar float p2 = na\nif close > open\n    p2 := p1, p1 := close\nplot(p2)',
      'var float p1 = na\nvar float p2 = na\nif close > open\n    p2 := p1\n    p1 := close\nplot(p2)')
    expect(out.outputs.length).toBe(1)
  })

  it('⭐ a block hangs under the LAST segment, and only there', () => {
    const comma = 'f() =>\n    int d = na , d := switch\n        close > open => 1\n        close < open => -1\n        => nz(d[1])\n    d\nplot(f())'
    const lines = 'f() =>\n    int d = na\n    d := switch\n        close > open => 1\n        close < open => -1\n        => nz(d[1])\n    d\nplot(f())'
    same(comma, lines)
    // the statement tree: the body is owned by `d := switch`, the declaration has none
    const { tokens, indents } = lexPine(src(comma))
    const fn = blockStatements(tokens, indents, 0).find((s) => s.header[0].value === 'f')
    const [decl, upd] = fn.sub
    expect(decl.header.map((t) => t.value).join(' ')).toBe('int d = na')
    expect(decl.sub).toEqual([])
    expect(upd.header.map((t) => t.value).join(' ')).toBe('d := switch')
    expect(upd.sub.length).toBe(3)
  })

  // ─── what must NOT split ────────────────────────────────────────────────

  const headersOf = (body) => {
    const { tokens, indents } = lexPine(src(body))
    return blockStatements(tokens, indents, 0).map((s) => s.header.map((t) => t.value).join(' '))
  }

  it('⛔ a segment that is not a statement keeps the whole line whole (all or nothing)', () => {
    // ⭐ RT12 — a bare CALL segment is a statement now (`commaCallSplit`,
    // `rt12CommaCallSplit.test.js`), so `x = 1.0, x := 2, plot(close)` is the three
    // statements; the all-or-nothing rule is kept for a segment that is neither a
    // binding, a mutation nor one call.
    expect(headersOf('x = 1.0, x := 2, plot(close)').slice(1)).toEqual(['x = 1', 'x := 2', 'plot ( close )'])
    const hs = headersOf('x = 1.0, x := 2, close + 1')
    expect(hs.length).toBe(2) // `indicator(…)` and the whole line
    expect(hs[1]).toMatch(/ , x := 2 , close \+ 1$/)
  })

  it('⛔ a block whose opener is NOT in the last segment keeps the line whole', () => {
    // `x := switch` first, a binding after it: the arms below have no honest owner
    expect(headersOf('float x = na\nx := switch, y = 1\n    close > open => 1\n    => 0')).toContain('x := switch , y = 1')
  })

  // ⚠️ A comma line with NO block beneath it is O1's split (`isReassignSegment`,
  // step 67, which runs first and owns that path); the cases below are the ones
  // only H2's reader takes — a block hanging under the last segment.
  it('⛔ a dotted target is not a bare-name mutation, so a line with a block under it stays whole', () => {
    expect(headersOf('a = 1, t.f := switch\n    close > open => 1\n    => 0')).toContain('a = 1 , t.f := switch')
  })
})
