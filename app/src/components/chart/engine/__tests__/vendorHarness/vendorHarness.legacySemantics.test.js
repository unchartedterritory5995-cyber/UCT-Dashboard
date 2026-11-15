// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.legacySemantics.test.js
//
// ─── LEGACY SEMANTICS (B1, B2) — `n` IS THE BAR INDEX IN v1-v3, AND v1's ONE-ARGUMENT `barssince` ─
//
// Witnesses (our probes, NYSE:RDDT 1D from the listing, committed beside their captures):
//   S17 `vw-ternary-arm-legacy-v1/v2/v3` and `vw-cs2-bool-na-v1/v3` read the bar index as `n`;
//   S18 re-took the same probes with `cum(1) - 1` in its place (`-cum`), and TradingView's columns are
//   the same bar for bar. Before this change every `n` probe was refused `pine:undefined`, and the v1
//   (no pragma) `-cum` probe was refused `pine:arity` ("barssince was given 1 argument").
//   v1 reference: `barssince(condition)` (https://www.tradingview.com/pine-script-reference/v1/#fun_barssince);
//   v3 reference: `n` "Bar index" (https://www.tradingview.com/pine-script-reference/v3/#var_n).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, lexPine, legacyBarIndexTokens, pineV1Declared } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const H = (id) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${id}-rddt-1d-2026-11-15.json`), 'utf8'))
const PROBE = (name) => fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes', `${name}.pine`), 'utf8')
const barsOf = (d) => d.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const same = (a, b) => (b === null || b === undefined ? !Number.isFinite(a)
  : Number.isFinite(a) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const identical = (a, b) => (Number.isFinite(a) || Number.isFinite(b) ? a === b : true)
const idents = (src) => lexPine(src).tokens.filter((t) => t.kind === 'ident').map((t) => t.value)

/** the host lane's columns, plot order (null where an output is refused) */
function hostCols(src, bars) {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal || null)).toBe(true)
  return t.outputs.filter((o) => o.kind !== 'alertcondition')
    .map((o) => (o.refusal || !o.ast ? null
      : Array.from(interpret(o.ast, bars, undefined, undefined, undefined, { tf: 'D', historyFromListing: true }))))
}
/** the runtime lane's columns, plot order, or `{ err }` */
function runCols(src, bars, plots) {
  const outputs = Object.fromEntries(plots.map((p, k) => [`p${k}`, k]))
  try {
    const cols = computeRuntimeColumns({ id: 'leg', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:leg', outputs, source: src } }, bars,
    { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    return plots.map((p, k) => Array.from(cols[`p${k}`]))
  } catch (err) { return { err } }
}

describe('⭐ B1 — the lex: every bare `n` is the bar index in v1-v3, and nowhere else', () => {
  it('v1 (no pragma, declared `study(`), v2 and v3: `n` -> `bar_index`; a dotted `x.n` is untouched', () => {
    expect(idents('//@version=3\nstudy("x")\nplot(n[1] + x.n)\n')).toEqual(['study', 'plot', 'bar_index', 'x.n'])
    expect(idents('//@version=2\nstudy("x")\nplot(n)\n')).toEqual(['study', 'plot', 'bar_index'])
    expect(idents('study("x")\nplot(n)\n')).toEqual(['study', 'plot', 'bar_index'])
  })
  it('⛔ v4+ has no `n`, and a pragma-less source that never declares `study(` is the formula box', () => {
    expect(idents('//@version=4\nstudy("x")\nplot(n)\n')).toContain('n')
    expect(idents('//@version=5\nindicator("x")\nplot(n)\n')).toContain('n')
    expect(idents('sma(close, 5) > n')).toContain('n')
    expect(pineV1Declared(lexPine('plot(n)').tokens, null)).toBe(false)
    expect(lexPine('study("x")\nplot(close)\n').v1Declared).toBe(true)
    expect(lexPine('//@version=3\nstudy("x")\nplot(close)\n').v1Declared).toBe(false)
  })
  it('⛔ a script that binds its own `n` keeps it: assignment, reassignment, parameter, loop counter, tuple part', () => {
    for (const src of [
      '//@version=3\nstudy("x")\nn = 5\nplot(close[n])\n',
      '//@version=3\nstudy("x")\nn = 0\nn := n + 1\nplot(n)\n',
      '//@version=3\nstudy("x")\nf(a, n) => a + n\nplot(f(close, 1))\n',
      '//@version=3\nstudy("x")\nx = 0.0\nfor n = 0 to 3\n    x := x + n\nplot(x)\n',
      '//@version=3\nstudy("x")\nf() => [1, 2]\n[q, n] = f()\nplot(q + n)\n',
    ]) expect(idents(src), src).not.toContain('bar_index')
  })
  it('the function is the one rule both lanes lex through (a token list in, a token list out)', () => {
    const toks = lexPine('//@version=4\nstudy("x")\nplot(n)\n').tokens
    expect(legacyBarIndexTokens(toks, 3, false).some((t) => t.value === 'bar_index' && t.legacyName === 'n')).toBe(true)
    expect(legacyBarIndexTokens(toks, 4, false)).toBe(toks)
    expect(legacyBarIndexTokens(toks, null, false)).toBe(toks)
  })
})

describe('⭐⭐ B1 + B2 — the S17 `n` probes draw what TradingView draws, the same as their S18 `-cum` re-takes', () => {
  for (const v of ['v1', 'v2', 'v3']) {
    it(`vw-ternary-arm-legacy-${v}: every column on the host lane, 0 mismatches, and n === cum(1) - 1`, () => {
      const d = H(`vw-ternary-arm-legacy-${v}`)
      const c = H(`vw-ternary-arm-legacy-${v}-cum`)
      expect(d.source.text).toBe(PROBE(`vw-ternary-arm-legacy-${v}`))
      const bars = barsOf(d)
      const ours = hostCols(d.source.text, bars)
      const cum = hostCols(c.source.text, barsOf(c))
      expect(ours.length).toBe(d.study.plots.length)
      ours.forEach((col, k) => {
        expect(col, `${d.study.plots[k].title} refused`).not.toBeNull()
        const tv = d.plotValues.rows.map((r) => r[k + 1])
        expect(tv.reduce((n, x, i) => n + (same(col[i], x) ? 0 : 1), 0), d.study.plots[k].title).toBe(0)
        expect(col.every((x, i) => identical(x, cum[k][i])), `${d.study.plots[k].title}: n vs cum`).toBe(true)
      })
      // TradingView's own two takes agree too (the witness that `n` IS `cum(1) - 1` there)
      d.plotValues.rows.forEach((r, i) => expect(r.slice(1)).toEqual(c.plotValues.rows[i].slice(1)))
    })
  }

  it('⭐ B2 — v1\'s one-argument `barssince(cond)` (no pragma, `study(`): served, the unbounded count', () => {
    const d = H('vw-ternary-arm-legacy-v1-cum')
    expect(lexPine(d.source.text).version).toBeNull()
    expect(lexPine(d.source.text).v1Declared).toBe(true)
    const k = d.study.plots.findIndex((p) => p.title === 'E_barssince')
    const col = hostCols(d.source.text, barsOf(d))[k]
    const tv = d.plotValues.rows.map((r) => r[k + 1])
    expect(tv.reduce((n, x, i) => n + (same(col[i], x) ? 0 : 1), 0)).toBe(0)
    expect(Math.max(...col.filter(Number.isFinite))).toBeGreaterThan(5) // non-vacuity: not a capped window
  })

  it('⛔ B2 — the formula box (no pragma, no declaration) keeps the table\'s two-argument `barssince`', () => {
    const t = translatePine('plot(barssince(close > open))\n', { strict: true, basePeriod: 'D' })
    const why = JSON.stringify(t.refusal || (t.outputs || []).map((o) => o.refusal))
    expect(why).toMatch(/pine:arity/)
  })

  for (const v of ['v1', 'v3']) {
    it(`vw-cs2-bool-na-${v}: the \`n\` probe and its \`-cum\` re-take draw the same columns on both lanes`, () => {
      const d = H(`vw-cs2-bool-na-${v}`)
      const c = H(`vw-cs2-bool-na-${v}-cum`)
      const ours = hostCols(d.source.text, barsOf(d))
      const cum = hostCols(c.source.text, barsOf(c))
      ours.forEach((col, k) => {
        if (col === null || cum[k] === null) { expect(col === null && cum[k] === null).toBe(true); return }
        expect(col.every((x, i) => identical(x, cum[k][i])), `host ${d.study.plots[k].title}`).toBe(true)
      })
      const rn = runCols(d.source.text, barsOf(d), d.study.plots)
      const rc = runCols(c.source.text, barsOf(c), c.study.plots)
      expect(rn.err, rn.err && rn.err.message).toBeUndefined()
      expect(rc.err, rc.err && rc.err.message).toBeUndefined()
      rn.forEach((col, k) => expect(col.every((x, i) => identical(x, rc[k][i])), `runtime ${d.study.plots[k].title}`).toBe(true))
      // the bar-index control column is TradingView's on both lanes
      const bi = d.study.plots.findIndex((p) => /bar_?index|^BI|CONTROL/i.test(p.title))
      if (bi >= 0) {
        const tv = d.plotValues.rows.map((r) => r[bi + 1])
        expect(tv.reduce((n, x, i) => n + (same(ours[bi][i], x) ? 0 : 1), 0)).toBe(0)
        expect(tv.reduce((n, x, i) => n + (same(rn[bi][i], x) ? 0 : 1), 0)).toBe(0)
      }
    })
  }
})
