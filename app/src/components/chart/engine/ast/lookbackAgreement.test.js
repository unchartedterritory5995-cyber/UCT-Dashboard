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
import { translatePine } from './pine.js'
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

/** Every distinct tree the two corpora produce, in BOTH lanes. */
function walk() {
  const seen = new Map()
  for (const [tag, dir] of SOURCES) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pine')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const strict of [false, true]) {
        let t
        try {
          t = translatePine(src, strict
            ? { strict: true, budgetMs: 3000 } : { budgetMs: 3000 })
        } catch { continue }
        for (const o of (t.outputs || [])) {
          if (!o || !o.ast) continue
          const json = JSON.stringify(o.ast)
          const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)
          if (seen.has(hash)) continue
          seen.set(hash, {
            hash,
            from: `${tag}/${f}`,
            lane: strict ? 'host' : 'screener',
            title: o.title || null,
            shapes: shapesIn(o.ast),
            ...readBoth(o.ast),
            ast: o.ast,
          })
        }
      }
    }
  }
  return [...seen.values()]
}

describe('⭐⭐ the lookback readers agree, and the rail can say when they do not', () => {
  const rows = walk()

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
      distinct_trees_walked: rows.length,
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
