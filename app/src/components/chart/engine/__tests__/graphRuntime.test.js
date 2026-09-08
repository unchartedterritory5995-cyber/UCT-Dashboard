// app/src/components/chart/engine/__tests__/graphRuntime.test.js
//
// ─── C2C.11/.19: SHARING THE STORAGE, THEN SHARING THE WORK ─────────────────
//
// C2A measured that 77-84% of a real multi-plot document's counted nodes are
// REPEATED subtrees, and `interpret`'s existing memo could not see any of it:
// it is keyed on a structural id within ONE tree, and the repetition is BETWEEN
// trees. C2C's storage work makes those subtrees literally the same object, so
// a memo keyed on object identity collapses them.
//
// ⛔⛔ THE FIRST TEST IS NOT THE SPEED — IT IS THAT THE NUMBERS DO NOT MOVE.
// A memo that cached a subtree reading a recurrence bind would freeze that
// recurrence at its first step: a WRONG NUMBER, silently, on a chart that still
// draws. Every claim below is measured against columns computed with the memo
// OFF, bar for bar.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../ast/pine'
import { interpret } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { buildGraph, expandGraph } from '../ast/graph'
import { memberInputTranslation } from '../../builder/builderInputs'

const OOS = path.resolve(process.cwd(), '../tools/c0_oos_fixtures')
// ⚠️ 400 BARS, NOT THE 5,000 A CHART LOADS, AND THE REASON IS THE RECURRENCE
// CEILING RATHER THAN IMPATIENCE. Two of these scripts are `accum` documents
// whose cost is `bars × PINE_STATE_WARMUP` (C2A measured ~374 ns/step), so at
// chart scale ONE document pass is fifteen seconds: the first version of this
// file ran at 3,000 bars, took 519s and timed out, which is a test nobody keeps.
// The question it asks — do two columns that share a subtree compute it twice —
// is scale-free, so the bar count buys nothing but wall clock.
const N = 400

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400,
  o: 100 + Math.sin(i / 11) * 8, h: 104 + Math.sin(i / 11) * 8,
  l: 96 + Math.sin(i / 11) * 8, c: 100 + Math.sin(i / 7) * 9,
  v: 1_000_000 + (i % 53) * 5000,
}))

/** The kept columns of a script, as a `{plotKey: tree}` map plus its inputs. */
function document(file) {
  const src = fs.readFileSync(path.join(OOS, `${file}.pine`), 'utf8')
  const t = memberInputTranslation(translatePine, src, {})
  const outs = (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden).slice(0, 12)
  const inputs = {}
  for (const o of outs) for (const r of (o.memberInputs || [])) inputs[r.key] = r.default
  const trees = {}
  outs.forEach((o, i) => { trees[i === 0 ? 'value' : `out${i + 1}`] = o.ast })
  return { trees, inputs }
}

/** Every column, optionally through one shared memo. Failed columns are
 *  omitted, exactly as `astColumnsFor` does — the comparison is over the
 *  columns that computed either way. */
function columns(trees, inputs, crossMemo) {
  const out = {}
  for (const [k, tree] of Object.entries(trees)) {
    try {
      out[k] = interpret(tree, bars(N), inputs, DEFAULT_BUDGET,
        undefined, crossMemo ? { crossMemo } : undefined)
    } catch { /* a refused column is a refused column, with or without a memo */ }
  }
  return out
}

const SCRIPTS = [
  'high_engagement__03-supertrend-kivancozbilgic',
  'mid_engagement__22-rsi-levels-regime-map',
  'mid_engagement__14-master-line-lite',
  'high_engagement__12-cm-ultimate-rsi-mtf-chrismoody',
]

describe('C2C.11 — the shared memo computes the SAME numbers', () => {
  for (const name of SCRIPTS) {
    it(name, { timeout: 60000 }, () => {
      let d
      try { d = document(name) } catch { return }
      const shared = expandGraph(buildGraph(d.trees))
      const plain = columns(d.trees, d.inputs, null)
      const memoed = columns(shared, d.inputs, new Map())
      expect(Object.keys(memoed).sort()).toEqual(Object.keys(plain).sort())
      for (const k of Object.keys(plain)) {
        const a = plain[k]
        const b = memoed[k]
        expect(b.length).toBe(a.length)
        // ⛔ BAR FOR BAR, NaN INCLUDED. A column that went all-NaN would compare
        // equal under a naive `toEqual` on Float64Arrays in some runners; this
        // asks the question directly.
        let diffs = 0
        for (let i = 0; i < a.length; i += 1) {
          const same = (Number.isNaN(a[i]) && Number.isNaN(b[i])) || a[i] === b[i]
          if (!same) diffs += 1
        }
        expect(diffs, `${k}: ${diffs} of ${a.length} bars differ`).toBe(0)
      }
    })
  }

  it('⛔ THE CONTROL: a recurrence is not frozen by the memo', () => {
    // `accum(seed, update, warmup)` where the update READS `self`. If the memo
    // cached a bind-reading subtree the column would go constant, so this is the
    // fixture that separates "the guard works" from "nothing exercised it".
    const accum = {
      type: 'call',
      name: 'accum',
      args: [
        { type: 'num', value: 0 },
        {
          type: 'op',
          name: '?:',
          args: [
            { type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }] },
            { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 1 }] },
            { type: 'series', name: 'self' },
          ],
        },
        { type: 'num', value: 60 },
      ],
    }
    const trees = { value: accum, out2: accum }
    const memo = new Map()
    const a = interpret(trees.value, bars(500), {}, DEFAULT_BUDGET, undefined, { crossMemo: memo })
    const b = interpret(trees.out2, bars(500), {}, DEFAULT_BUDGET, undefined, { crossMemo: memo })
    const plain = interpret(accum, bars(500), {}, DEFAULT_BUDGET)
    for (let i = 0; i < plain.length; i += 1) {
      expect(a[i]).toBe(plain[i])
      expect(b[i]).toBe(plain[i])
    }
    // and the column really does move — a frozen recurrence would be constant
    expect(new Set(Array.from(plain).filter(Number.isFinite)).size).toBeGreaterThan(2)
  })
})

describe('C2C.19 — what the sharing costs, and what it saves', () => {
  it('wall clock per document, with and without the shared memo', { timeout: 120000 }, () => {
    const lines = []
    for (const name of SCRIPTS) {
      let d
      try { d = document(name) } catch { continue }
      const shared = expandGraph(buildGraph(d.trees))
      // ⚠️ NO WARM PASS. These documents run for seconds, so JIT warm-up is a
      // rounding error against them and a warm pass would double the file's
      // wall clock to buy nothing.
      const t0 = Date.now()
      const plain = columns(d.trees, d.inputs, null)
      const plainMs = Date.now() - t0
      const t1 = Date.now()
      const memoed = columns(shared, d.inputs, new Map())
      const memoMs = Date.now() - t1
      const t2 = Date.now()
      buildGraph(d.trees)
      const buildMs = Date.now() - t2
      lines.push(`  ${String(plainMs).padStart(5)}ms -> ${String(memoMs).padStart(5)}ms  `
        + `(${plainMs ? `${Math.round((100 * (plainMs - memoMs)) / plainMs)}% saved` : 'n/a'})  `
        + `graph build ${buildMs}ms  ${Object.keys(plain).length}/${Object.keys(d.trees).length} columns  ${name}`)
      expect(Object.keys(memoed).length).toBe(Object.keys(plain).length)
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== C2C.19 COMPUTE COST, ${N} bars ===\n${lines.join('\n')}`)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('expanding a graph costs about what walking the trees costs', { timeout: 60000 }, () => {
    // ⛔ THE COST NOBODY BUDGETED FOR. A read now materialises the forest; if
    // that were expensive the storage win would be paid back on every open.
    const d = document('high_engagement__03-supertrend-kivancozbilgic')
    const graph = buildGraph(d.trees)
    const t0 = Date.now()
    for (let i = 0; i < 20; i += 1) expandGraph(graph)
    const expandMs = (Date.now() - t0) / 20
    const t1 = Date.now()
    for (let i = 0; i < 20; i += 1) JSON.parse(JSON.stringify(d.trees))
    const cloneMs = (Date.now() - t1) / 20
    // eslint-disable-next-line no-console
    console.log(`\n  expandGraph ${expandMs.toFixed(2)}ms vs a JSON clone of the same forest ${cloneMs.toFixed(2)}ms`)
    expect(expandMs).toBeLessThan(Math.max(cloneMs * 4, 25))
  })
})
