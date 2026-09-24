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

/** ⭐ ONE TRANSLATION PER SCRIPT, shared by every case below. The expensive
 *  half is `columns` (400 bars of `accum`), not the translation — but the
 *  ceiling census at the bottom of this file needs the same documents the cases
 *  do, and translating them twice would make the two disagree the day one of
 *  them moves. */
const DOCS = new Map()
const doc = (name) => {
  if (!DOCS.has(name)) {
    try { DOCS.set(name, document(name)) } catch { DOCS.set(name, null) }
  }
  return DOCS.get(name)
}

/** ⭐⭐ THE EXPANSION, OR THE BOMB GUARD'S REFUSAL — NAMED, NEVER THROWN PAST.
 *
 *  ⚰️ 2026-09-23, THE MERGE. `mid_engagement__22-rsi-levels-regime-map` used to
 *  expand to a 118-node root per plot; it now refuses at 13,035 against the
 *  2,048 per-plot ceiling — and that is a CAPABILITY GAIN arriving as a
 *  refusal, not a regression. Measured on the two parents:
 *
 *      before: 10 refusals, 18 kept rows, the tail of them `EXP_*` diagnostics
 *      after :  2 refusals, 26 kept rows — Positive/Negative reversal, Entry,
 *               Stop and Target now translate, and those three are `accum`
 *               recurrences wrapped around the whole RSI chain
 *
 *  So the document really does describe a 13k-node forest now. `expandedSizes`
 *  calls itself THE BOMB GUARD and it is firing on exactly the shape it names:
 *  227 shared nodes that inline to thirteen thousand.
 *
 *  ⛔ IT IS NOT A MEMBER-FACING BREAK, and that was checked rather than assumed:
 *  `graphDocument.hydrateGraphDocument` catches this and returns the definition
 *  unchanged, and `buildGraph` — which is what the chart path runs — does not
 *  call `expandedSizes` at all and builds the 227-node graph fine.
 *
 *  ⚰️ 2026-09-24, PORTED TO MASTER (sweep/lane-1) FROM `merge/pine-up-to-master`
 *  526b5e2aa — AND IT HOLDS WITHOUT THE PINE ENGINE WORK. Master's own grammar
 *  commits after this file was born (#153..#170, "joins the engine grammar")
 *  grew the same document: measured on master 451aed688, 28 outputs, 12 kept,
 *  2 refused, a 227-node shared graph whose `out10` refuses at 13,009 (the
 *  merged tree says 13,035). The other three expand to 681 / 423 / 436 nodes,
 *  the same forests as on the merged tree, so SPECIMEN below is right here too.
 *  The 10-commit window 877dd173c..451aed688 never touched `engine/ast/`, so
 *  this is not a window regression. Mutation: SPECIMEN set back to
 *  `mid_engagement__22` reds C2C.19's non-vacuity assertion ("expected
 *  [Function] to not throw"). ⚠️ The server carries the SAME 2048 ceiling
 *  (`api/services/compute_graph.py`), so a document over the byte budget that
 *  reduces to this graph meets the store's refusal — the pre-existing size
 *  refusal `reduceIfOversized` documents, reported upstream, not decided here.
 *
 *  ⛔ AND A CEILING IS NOT A SKIP. A case that quietly `return`s on this would
 *  go vacuous the day the ceiling starts firing on everything; the caller below
 *  asserts the refusal BY NAME and the census asserts how many documents really
 *  ran the comparison. */
const expandOrCeiling = (d) => {
  const graph = buildGraph(d.trees)
  try { return { graph, shared: expandGraph(graph) } } catch (e) {
    return { graph, ceiling: String((e && e.message) || e) }
  }
}

// ⚰⚰ `high_engagement__03-supertrend-kivancozbilgic` LEFT THIS ROSTER ON 2026-09-12
// and it was the headline case: ten plots sharing one Supertrend band, which is what
// made the shared memo worth measuring. R-F refused nine of its columns and ruling 1.2
// refused the tenth — the author's untitled `ohlc4` fill edge — so it now carries no
// trees, and `buildGraph` correctly answers "an empty trees map names no plot".
// ⛔ A SCRIPT THAT CARRIES NOTHING IS NOT A MEMO CASE, and it must not be skipped
// silently either: `NO_TREES` below asserts that this is exactly why it is gone, so the
// day it translates again the roster gains it back by failing here.
const SCRIPTS = [
  'mid_engagement__22-rsi-levels-regime-map',
  'mid_engagement__14-master-line-lite',
  'high_engagement__12-cm-ultimate-rsi-mtf-chrismoody',
  'high_engagement__24-coppock-curve-multi-filter-markittick',
]

const NO_TREES = 'high_engagement__03-supertrend-kivancozbilgic'

/** The largest forest on the roster that still EXPANDS — see C2C.19's second
 *  case for why this is not `mid_engagement__22` any more. */
const SPECIMEN = 'mid_engagement__14-master-line-lite'

describe('⚰ the script that left the roster, asserted rather than forgotten', () => {
  it(`${NO_TREES} carries no trees at all`, () => {
    // ⛔ THE POINT IS THE DAY THIS GOES RED. If the fold or the hidden rule is ever
    // narrowed, this script produces columns again and belongs back in SCRIPTS — it is
    // the only case in the frozen set where ten plots share one band, which is the
    // shape the shared memo exists for.
    const d = document(NO_TREES)
    expect(Object.keys(d.trees)).toEqual([])
    expect(() => buildGraph(d.trees)).toThrow(/empty trees map/)
  })
})

/** Filled by the cases below, read by the census that follows them. */
const COMPARED = []
const CEILED = []

describe('C2C.11 — the shared memo computes the SAME numbers', () => {
  for (const name of SCRIPTS) {
    it(name, { timeout: 60000 }, () => {
      const d = doc(name)
      if (!d) return
      const { graph, shared, ceiling } = expandOrCeiling(d)
      if (ceiling) {
        // ⛔⛔ THE BOMB GUARD FIRED, AND THIS SAYS SO BY NAME RATHER THAN
        // CRASHING OR SKIPPING. Both halves are asserted, because either one
        // alone would pass for the wrong reason: the refusal must be the
        // PER-PLOT ceiling (not some other throw wearing the same catch), and
        // the graph must be SMALL — which is the whole claim. A graph that had
        // itself grown to thirteen thousand nodes would be a real regression
        // and would look identical from the message alone.
        expect(ceiling).toMatch(/over the \d+ per-plot ceiling/)
        expect(graph.nodes.length,
          'the SHARED graph must still be small — that is what sharing means')
          .toBeLessThan(512)
        CEILED.push(name)
        return
      }
      COMPARED.push(name)
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

describe('⛔⛔ the roster is not quietly emptying — the census of what ran', () => {
  // ⚰️ WRITTEN WITH THE CEILING BRANCH, AND IT IS THE HALF THAT MATTERS. A
  // per-script `return` on a refusal is how a file of four cases becomes a file
  // of zero without a single red line. This asserts that the comparison really
  // ran, on more than one document, and reports which ones did not.
  //
  // ⚠️ It reads state the cases above filled, so it must run AFTER them — which
  // is why it is its own `describe` placed here and not a case inside theirs.
  it('at least two documents really compared plain against memoed', () => {
    expect(COMPARED.length,
      `only ${COMPARED.length} of ${SCRIPTS.length} documents compared; ceiling-refused: `
      + `${CEILED.join(', ') || 'none'}`).toBeGreaterThanOrEqual(2)
    expect(COMPARED.length + CEILED.length,
      'a document neither compared nor refused — it vanished').toBe(SCRIPTS.length)
  })
})

describe('C2C.19 — what the sharing costs, and what it saves', () => {
  it('wall clock per document, with and without the shared memo', { timeout: 120000 }, () => {
    const lines = []
    for (const name of SCRIPTS) {
      const d = doc(name)
      if (!d) continue
      const { shared, ceiling } = expandOrCeiling(d)
      // ⛔ A DOCUMENT THE BOMB GUARD REFUSES STILL GETS A LINE. This case is a
      // measurement REPORT, and a report that silently drops its largest
      // specimen reads as the cost having fallen.
      if (ceiling) { lines.push(`  ${'ceiling-refused'.padStart(28)}  ${name}`); continue }
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
    // ⚰ the specimen moved with the roster above; this is the largest forest left.
    //
    // ⚰️ AND IT MOVED AGAIN ON 2026-09-23. It was
    // `mid_engagement__22-rsi-levels-regime-map`, which the merge pushed past the
    // per-plot ceiling (see `expandOrCeiling` for the measurement and why that is
    // a capability gain arriving as a refusal). A specimen that cannot be
    // expanded cannot time an expansion. Measured over the whole roster on the
    // merged tree, the largest forest that still expands is `master-line-lite`
    // at 681 nodes, against 423 and 436 for the two `high_engagement__` scripts.
    const d = doc(SPECIMEN)
    const graph = buildGraph(d.trees)
    // ⛔ NON-VACUITY: the specimen must really expand, and to a forest worth
    // timing. Without this the case would keep "passing" against whatever the
    // roster degraded to — and an expansion of nothing is very fast indeed.
    expect(() => expandGraph(graph)).not.toThrow()
    expect(Object.keys(expandGraph(graph)).length).toBeGreaterThan(1)
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
