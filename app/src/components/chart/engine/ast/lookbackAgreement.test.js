// app/src/components/chart/engine/ast/lookbackAgreement.test.js
//
// ─── ⭐⭐ R-G — FOUR READERS OF ONE WINDOW, HELD TO ONE ANSWER ───────────────
//
// Owner ruling, 2026-09-12: *"that disagreement is the defect class, and the
// ternary was just the instance that surfaced it."*
//
// There are four readers of "how far back does this tree reach", two per lane:
//
//     lint.js::maxLookback          ast_lint.max_lookback
//     interpret.js::maxLookback     ast_interpret.max_lookback
//
// and they had drifted THREE separate ways, each one invisible because every
// disagreement fails CLOSED — a refusal or a `repaints` badge, never a wrong
// number:
//
//   1. the bind-foldable window   `isweekly ? lenWeekly : lenDaily`
//      lint.js bounded it; the other three refused. This is the one that made
//      `uncharted-volume-v2.pine` uninstallable.
//   2. bind-time text             `str` / `symtext` / `textop`
//      ast_lint.py had the arm; lint.js had none, and its default branch's own
//      message listed those three types among the ones it claimed to accept.
//   3. `lookback: "series"`       `ta.cum`
//      ast_lint.py had the arm — added by a parity test that "caught this one
//      missing" — and nobody carried it across to lint.js.
//
// ⚰️ MEASURED ACROSS `corpus/committed` + `tests/fixtures/member`, both lanes,
// 1,302 trees: **24 disagreements at HEAD, 0 after.** Badges moved with them —
// `repaints` **20 → 0**, because those twenty were trees this linter could not
// read rather than trees that repaint.
//
// ⛔ AND THE CORPUS ALONE CANNOT PROVE ANY OF IT. Measured before writing this:
// `corpus/committed` on its own agrees 643/643 BOTH BEFORE AND AFTER the fix —
// it contains none of the three shapes. A rail pointed only there would have
// passed identically on both sides of the defect. That is why the population is
// corpus + member fixtures, why the shapes are asserted PRESENT by name, and why
// the comparison itself is exercised against a synthetic disagreement below.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { translatePine, withTranslateClock } from './pine.js'
import { TABLE } from './parse.js'
import { maxLookback as interpretMax } from './interpret.js'
import { maxLookback as lintMax } from './lint.js'

const REPO = path.resolve(process.cwd(), '..')
const SOURCES = [
  ['corpus', path.join(REPO, 'corpus/committed')],
  ['member', path.join(REPO, 'tests/fixtures/member')],
]
/** ⭐ THE CROSS-LANE ORACLE. `tests/test_ast_lookback_agreement.py` reads THIS
 *  file, so the Python readers are measured against the same trees and the same
 *  numbers rather than against a second corpus walk that could drift. */
const ORACLE = path.join(REPO, 'tools/lookback_agreement.json')

/** ⭐ THE THREE SHAPES THAT DISCRIMINATE, classified from the MANIFEST rather
 *  than from a list of function names — `series-lookback` is whatever the table
 *  declares that way, today `ta.cum` and tomorrow whatever joins it. */
function shapesIn(ast) {
  const fns = TABLE.functions || {}
  const tags = new Set()
  const stack = [ast]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'str' || n.type === 'symtext' || n.type === 'textop') tags.add('bind-time-text')
    if (n.type === 'call') {
      const spec = fns[n.name] || {}
      if (spec.lookback === 'series') tags.add('series-lookback')
      const args = n.args || []
      for (let i = 0; i < args.length; i++) {
        if ((spec.args || [])[i] === 'int' && args[i] && args[i].type !== 'num') {
          tags.add('bind-foldable-window')
        }
      }
    }
    for (const a of (n.args || [])) stack.push(a)
  }
  return [...tags].sort()
}

/** Both readers on one tree. `null` means "refused / unanalysable". */
function readBoth(ast) {
  let interpret = null
  let lint = null
  try { interpret = interpretMax(ast) } catch { interpret = null }
  try { lint = lintMax(ast) } catch { lint = null }
  return {
    interpret: typeof interpret === 'number' ? interpret : null,
    lint: typeof lint === 'number' ? lint : null,
  }
}

/** ⭐⭐ THE COMPARISON, AS A PURE FUNCTION, so it can be shown to fail.
 *  A disagreement is EITHER a different number OR one reader answering while the
 *  other refuses — the second form is the one that shipped, three times. */
export function disagreements(rows) {
  return rows.filter((r) => r.interpret !== r.lint)
}

// ─── ⭐⭐ THE ORACLE IS A FUNCTION OF THE FIXTURES, NEVER OF THE MACHINE ───────────
//
// ⚰️ MEASURED 2026-11-06: with `budgetMs: 3000` this walk wrote 608, 607 and 605
// distinct trees on three runs of one commit. `corpus/cc-yata__bd898a1af0.pine`
// needs ~3,050-3,250 ms in the screener lane; the per-script clock expired part way
// through its output loop, every later output was refused `pine:timeout`, and the
// trees it HAD finished were kept: 23, 25 or 26 of them, by machine load. So every
// full run could rewrite a tracked file. Widening the budget does not fix it, it
// only moves which script sits on the edge (60,000 ms still ended four walks in
// `pine:timeout`, all of them on the STEP CAP, not the clock).
//
// ⭐ TWO RULES, EACH WITH ONE AUTHORITY:
//
//   1. THE CLOCK NEVER DECIDES. `translateUnit` hands the translator a clock that
//      never advances. Ruling R3 (design 9.1): a host that injects a clock that
//      never advances keeps only the deterministic limbs, the step cap
//      (`PINE_TRANSLATE_MAX_STEPS`) and the depth bound (`PINE_TRANSLATE_MAX_DEPTH`).
//      Those count work, not time, so they stop on the same step on every host and
//      under any load, and a script sitting right at the edge cannot flip between
//      "finished" and "timed out" from run to run.
//   2. A WALK THAT ENDS IN `pine:timeout` CONTRIBUTES NOTHING. All or nothing, per
//      script and lane: a partial set is a function of where the translator
//      stopped, not of what the script writes. The unit is recorded BY NAME in the
//      oracle's `timed_out`, so the exclusion is visible rather than silent.
const FROZEN_CLOCK = () => 0

/** One script in one lane, on the frozen clock. The ONLY place this file translates
 *  a corpus script. */
export function translateUnit(src, strict) {
  return translatePine(src, strict ? { strict: true, now: FROZEN_CLOCK } : { now: FROZEN_CLOCK })
}

/** The `pine:timeout` refusals a translation carries, wherever they sit: the
 *  top-level verdict, the refusal list, or one output's own refusal (the screener
 *  lane keeps going after an output times out and returns the rest, which is how
 *  the partial sets reached the oracle unnoticed). */
export function timeoutsIn(t) {
  const all = [t && t.refusal, ...((t && t.refusals) || []),
    ...((t && t.outputs) || []).map((o) => o && o.refusal)]
  return all.filter((r) => r && r.guard === 'pine:timeout')
}

/** ⭐⭐ THE FOLD, AS A PURE FUNCTION, so the all-or-nothing rule can be shown to
 *  hold on units built here. `units` = `[{ from, lane, timedOut, outputs }]` in
 *  walk order; a timed-out unit adds no tree and is listed in `timedOut`. */
export function collect(units) {
  const seen = new Map()
  const timedOut = []
  for (const u of units) {
    if (u.timedOut) { timedOut.push({ from: u.from, lane: u.lane }); continue }
    for (const o of (u.outputs || [])) {
      if (!o || !o.ast) continue
      const json = JSON.stringify(o.ast)
      const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)
      if (seen.has(hash)) continue
      seen.set(hash, {
        hash,
        from: u.from,
        lane: u.lane,
        title: o.title || null,
        shapes: shapesIn(o.ast),
        ...readBoth(o.ast),
        ast: o.ast,
      })
    }
  }
  const key = (u) => `${u.from}\u0000${u.lane}`
  timedOut.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0))
  return { rows: [...seen.values()], timedOut }
}

/** Every script in the two corpora, in BOTH lanes. */
function walk() {
  const units = []
  const timeoutMessages = []
  for (const [tag, dir] of SOURCES) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pine')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const strict of [false, true]) {
        const from = `${tag}/${f}`
        const lane = strict ? 'host' : 'screener'
        let t
        try {
          t = translateUnit(src, strict)
        } catch (err) {
          // A thrown timeout is a timed-out unit like any other, and is listed.
          if (err && err.guard === 'pine:timeout') {
            units.push({ from, lane, timedOut: true, timeouts: 1, outputs: [] })
            timeoutMessages.push(String(err.message || ''))
          }
          continue
        }
        const tos = timeoutsIn(t)
        for (const r of tos) timeoutMessages.push(String(r.message || ''))
        units.push({ from, lane, timedOut: tos.length > 0, timeouts: tos.length, outputs: t.outputs || [] })
      }
    }
  }
  return { units, timeoutMessages, ...collect(units) }
}

describe('⭐⭐ the lookback readers agree, and the rail can say when they do not', () => {
  const { units, rows, timedOut, timeoutMessages } = walk()

  it('⛔ NON-VACUITY — it really read both corpora', () => {
    expect(rows.length).toBeGreaterThan(200)
    expect(rows.some((r) => r.from.startsWith('corpus/'))).toBe(true)
    expect(rows.some((r) => r.from.startsWith('member/'))).toBe(true)
  })

  it('⛔⛔ AND ALL THREE DISCRIMINATING SHAPES ARE PRESENT — by name, not by hope', () => {
    // Without this the whole file passes the day the last `ta.cum` leaves the
    // fixtures, and it passes for the wrong reason: nothing left to disagree
    // about. Measured 2026-09-12: series-lookback 13, bind-time-text 4,
    // bind-foldable-window 3.
    const counts = {}
    for (const r of rows) for (const s of r.shapes) counts[s] = (counts[s] || 0) + 1
    for (const shape of ['series-lookback', 'bind-time-text', 'bind-foldable-window']) {
      expect(counts[shape], `no tree in either corpus exhibits \`${shape}\` any more, `
        + 'so this rail can no longer see the defect class it exists for. Add a '
        + 'fixture that does, or retire the shape from the list with a reason.')
        .toBeGreaterThan(0)
    }
  })

  it('⭐⭐ THE CONTROL — the comparison really fires on a disagreement', () => {
    // The corpus is clean after the fix, so without this a `disagreements()`
    // broken into `() => []` would pass every assertion below.
    expect(disagreements([{ hash: 'x', interpret: 50, lint: 50 }])).toEqual([])
    expect(disagreements([{ hash: 'x', interpret: 50, lint: 20 }])).toHaveLength(1)
    // ⛔ THE FORM THAT ACTUALLY SHIPPED, THREE TIMES: one reader answers, the
    // other refuses. A comparison that only looked at two numbers would have
    // missed every instance of this defect class.
    expect(disagreements([{ hash: 'x', interpret: 50, lint: null }])).toHaveLength(1)
    expect(disagreements([{ hash: 'x', interpret: null, lint: 50 }])).toHaveLength(1)
    // …and "both refuse" is agreement, not a finding.
    expect(disagreements([{ hash: 'x', interpret: null, lint: null }])).toEqual([])
  })

  it('⭐⭐ CONTROL — a timed-out unit contributes NO tree, and is listed by name', () => {
    const tree = (n) => ({ title: `t${n}`, ast: { type: 'num', value: n } })
    const got = collect([
      { from: 'corpus/b.pine', lane: 'host', timedOut: false, outputs: [tree(1)] },
      // ⛔ THE SHAPE THAT SHIPPED: the outputs it finished before it stopped.
      { from: 'corpus/a.pine', lane: 'screener', timedOut: true, outputs: [tree(2), tree(3)] },
      { from: 'corpus/a.pine', lane: 'host', timedOut: true, outputs: [tree(4)] },
    ])
    expect(got.rows.map((r) => r.title)).toEqual(['t1'])
    expect(got.timedOut).toEqual([
      { from: 'corpus/a.pine', lane: 'host' }, { from: 'corpus/a.pine', lane: 'screener' }])
  })

  it('⭐⭐ CONTROL — a timeout is found wherever the translation put it', () => {
    const to = { guard: 'pine:timeout', message: 'x' }
    expect(timeoutsIn({ refusal: to, outputs: [] })).toHaveLength(1)
    expect(timeoutsIn({ refusals: [{ guard: 'pine:function' }, to] })).toHaveLength(1)
    // ⛔ the screener lane's form: no top-level refusal, one output refused.
    expect(timeoutsIn({ refusal: null, refusals: [], outputs: [{ ast: {} }, { refusal: to }] }))
      .toHaveLength(1)
    expect(timeoutsIn({ refusal: { guard: 'pine:function' }, outputs: [{ ast: {} }] })).toEqual([])
  })

  it('⭐⭐ CONTROL — the walk translates on a clock that never advances', () => {
    // An outer clock that leaps a billion ms on every read: a translation that
    // reads any clock but its own times out at once. The walk's unit must not.
    const src = '//@version=5\nindicator("x")\nplot(ta.sma(close, 14))\n'
    let t0 = 0
    const leaping = () => (t0 += 1e9)
    // the control can see: the same script on the leaping clock does time out...
    expect(timeoutsIn(withTranslateClock(leaping, () => translatePine(src))).length)
      .toBeGreaterThan(0)
    // ...and the walk's unit does not, in either lane.
    for (const strict of [false, true]) {
      const t = withTranslateClock(leaping, () => translateUnit(src, strict))
      expect(timeoutsIn(t), `lane strict=${strict}`).toEqual([])
      expect((t.outputs || []).some((o) => o && o.ast)).toBe(true)
    }
  })

  it('⛔⛔ NO TIMED-OUT SCRIPT CONTRIBUTES A TREE — the oracle is all or nothing', () => {
    const out = new Set(timedOut.map((u) => `${u.from}\u0000${u.lane}`))
    const leaked = rows.filter((r) => out.has(`${r.from}\u0000${r.lane}`))
    expect(leaked.map((r) => `${r.from} [${r.lane}] ${r.hash}`),
      'a script whose walk ended in `pine:timeout` contributed trees: its set is '
      + 'where the translator stopped, not what the script writes').toEqual([])
    // every unit that carried a timeout is classed timed out, and no other
    expect(units.filter((u) => u.timedOut !== (u.timeouts > 0)).map((u) => `${u.from} [${u.lane}]`))
      .toEqual([])
    expect(timedOut).toHaveLength(units.filter((u) => u.timeouts > 0).length)
  })

  it('⛔⛔ AND NO TIMEOUT IN THE WALK WAS DECIDED BY THE CLOCK', () => {
    // The limbs left are counts: the step cap ("resolution steps") and the depth
    // bound ("levels"). The clock limb says "gave up after <N>ms"; seeing it here
    // means the oracle depends on machine speed again.
    expect(timeoutMessages.filter((m) => /gave up after \d+ms/.test(m))).toEqual([])
  })

  it('⛔⛔ every tree, both lanes, both readers, one answer', () => {
    const bad = disagreements(rows)
    const detail = bad.slice(0, 8).map((r) => `  ${r.from} [${r.lane}] `
      + `${JSON.stringify(r.title)} shapes=${r.shapes.join('+') || 'none'} `
      + `interpret=${r.interpret === null ? 'REFUSED' : r.interpret} `
      + `lint=${r.lint === null ? 'UNANALYSABLE' : r.lint}`).join('\n')
    expect(bad.length, `${bad.length} of ${rows.length} trees get two different `
      + 'answers about how far back they reach:\n' + detail + '\n\n'
      + 'EVERY FORM OF THIS FAILS CLOSED — a refusal at the install door or a '
      + '`repaints` badge — so nothing else goes red and a member simply cannot '
      + 'use the script. The four readers are `lint.js::maxLookback`, '
      + '`interpret.js::maxLookback`, `ast_lint.max_lookback` and '
      + '`ast_interpret.max_lookback`; the shared walk they must all use is '
      + '`parse.js::bindFoldableWindow` / `ast_table.bind_foldable_window`.')
      .toBe(0)
  })

  it('⭐ …and the same trees are handed to the Python lane', () => {
    // ⛔ THE DISCRIMINATING TREES IN FULL, plus a bounded sample of ordinary ones
    // as controls. Exporting all 288 distinct trees costs 574KB of committed
    // fixture for no extra discrimination; exporting only the interesting ones
    // would leave the Python rail unable to fail for the ordinary case.
    const disc = rows.filter((r) => r.shapes.length > 0)
    const plain = rows.filter((r) => r.shapes.length === 0).slice(0, 40)
    expect(disc.length).toBeGreaterThan(0)
    expect(plain.length).toBeGreaterThan(0)
    const payload = {
      _: 'R-G cross-lane oracle. WRITTEN BY lookbackAgreement.test.js, read by '
        + 'tests/test_ast_lookback_agreement.py. Do not hand-edit: the numbers are '
        + 'the JS readers\' own answers, and a hand-edit would make the Python rail '
        + 'agree with a wish instead of with the other lane.',
      // ⭐⭐ R12 — ONE VERSION FIELD ACROSS THE CONTRACT, AND IT IS `version`.
      //
      // Measured at a7.1 rather than chosen: the contract's four spellings were
      // `tableVersion` (closedTable.json), `version` (conceptVocabulary.json,
      // starterScans.json) and none (symbolScope.json, this file). `version` is the
      // majority and the generic name; `tableVersion` is closedTable's own and that
      // file is a hand-authored manifest, not a JS-written artifact.
      //
      // ⛔ ADDITIVE, AND NOTHING IS REMOVED. No Python reader reads ANY version field
      // today — measured, zero programmatic reads across the 23 rails — so this field
      // is written before it is read, which is the only safe order. Removing the other
      // spellings waits until a reader is measured reading this one, and is its own
      // commit. Written by the WRITER, never hand-edited into the artifact: this file
      // regenerates the oracle, so a hand-edit would vanish on the next run.
      version: 1,
      distinct_trees_walked: rows.length,
      // ⭐ ADDITIVE (R12). The script+lane units whose walk ended in `pine:timeout`
      // and so contributed no tree, sorted, so an exclusion is never silent.
      timed_out: timedOut,
      rows: [...disc, ...plain].map((r) => ({
        hash: r.hash, from: r.from, lane: r.lane, title: r.title,
        shapes: r.shapes, interpret: r.interpret, lint: r.lint, ast: r.ast,
      })),
    }
    fs.mkdirSync(path.dirname(ORACLE), { recursive: true })
    // ⛔ COMPACT, NOT PRETTY. `indent: 1` over these trees is 466KB against
    // 118KB for the same content — a committed fixture nobody reads by eye,
    // whose only consumer is a parser.
    fs.writeFileSync(ORACLE, `${JSON.stringify(payload)}\n`, 'utf8')
    expect(fs.existsSync(ORACLE)).toBe(true)
  })
})
