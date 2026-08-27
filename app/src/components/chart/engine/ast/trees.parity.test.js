// ─── THE JS HALF OF THE MULTI-TREE PARITY RAIL (W1b.7) ──────────────────────
//
// `tests/fixtures/ast/multi_tree_parity.json` is a PUBLISHED INTERFACE, not a
// private fixture: W1b.8 reads the same file from the Python lane
// (`tools/ast_conformance.run_js`/`compare_lanes`) and holds `ast_interpret.py`
// to the identical `treesHash` and the identical per-column arithmetic this
// file proves here. Both lanes must (a) parse/accept the same four trees,
// (b) reproduce `treesHash`, (c) agree on every column at 1e-9.
//
// ⭐ THE FIXTURE'S TREES ARE THE PARSER'S OWN OUTPUT, NOT A HAND GUESS HELD TO
// BE RIGHT. The first `it` below is what makes that true: if a hand-written
// tree in the JSON ever disagreed with `parseFormula(source).ast`, the fix is
// to correct the FIXTURE, never this assertion — the fixture's whole value is
// that it cannot drift from the grammar `parse.js` owns.
//
// ⛔ THE HASH PIN IS MEASURED, THEN PINNED, BOTH DIRECTIONS. `treesHash` was
// run once to fill in the committed value; a future change to the trees, to
// `astHash`'s canonical form, or to `treesHash`'s own composition must move
// this file's `treesHash` in the same commit or the second `it` goes red —
// that is the point of pinning it at all.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFormula } from './parse'
import { treesHash } from './trees'
import { interpret } from './interpret'

// ⭐ THE HOUSE IDIOM FOR REACHING `tests/fixtures/ast/` FROM THIS DIRECTORY —
// copied from `clockParity.test.js`, not `__dirname` (unavailable under Vite's
// ESM test runner). `app/src/components/chart/engine/ast/` is six levels below
// the repo root, so six `..` segments land back at it before descending into
// `tests/fixtures/ast/`.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, '..', '..', '..', '..', '..', '..',
  'tests', 'fixtures', 'ast', 'multi_tree_parity.json')

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))

// ⛔ THIS LANE DOES NOT READ `fx.bars`. It synthesizes its own 300-bar series
// below — see the fixture's own `_` field, which says the same thing from the
// other side so nobody mistakes the pointer for a claim this file consumed it.
const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 8 + i * 0.06
  return { o: c - 0.3, h: c + 0.8, l: c - 0.8, c, v: 100000 }
})

describe('multi_tree_parity.json — the fixture IS the parser\'s output, and the hash is pinned', () => {
  it('every hand-written tree equals parseFormula(source).ast — the fixture cannot drift from the grammar', () => {
    for (const [k, src] of Object.entries(fx.sources)) {
      const parsed = parseFormula(src)
      expect(parsed.ok, `${k}: ${parsed.error}`).toBe(true)
      expect(parsed.ast, k).toEqual(fx.trees[k])
    }
  })

  it('⛔ the pinned treesHash is what this lane computes (Python asserts the same string)', () => {
    expect(treesHash(fx.trees)).toBe(fx.treesHash)
  })

  it('⛔ `scanPlot` NAMES ONE OF THE TREES — a pointer at an absent key would ship green in BOTH lanes', () => {
    // ⛔ THE FIELD NOTHING WAS ASSERTING. `scanPlot` is part of this fixture's
    // PUBLISHED surface — it names which of the four columns a scan screens on
    // — and neither lane read it, so a typo (`hist-up`), a renamed tree or a
    // deleted one would leave the pointer naming nothing while every existing
    // assertion here and in Python stayed green. That is the whole failure mode
    // a published interface has: the consumer is somewhere else.
    //
    // ⭐ AND IT IS RAILED ON BOTH SIDES. `tests/test_ast_multi_tree_parity.py`
    // makes the same three claims against the same file
    // (`lesson_rail_the_mirror_not_just_the_lane`): a guard added to one lane of
    // a mirrored fixture leaves the twin unguarded, and whichever lane a future
    // engineer consults, they believe it.
    expect(typeof fx.scanPlot, 'the fixture declares no scanPlot').toBe('string')
    expect(Object.keys(fx.trees),
      `scanPlot names ${JSON.stringify(fx.scanPlot)}, which is not a tree in this fixture`)
      .toContain(fx.scanPlot)
    // …and the tree it names is a CONDITION, measured off the column rather than
    // assumed from the name: a `scanPlot` pointed at `macd` would be a legal key
    // and still the wrong KIND of answer, because a scan screens on a yes-or-no
    // column. Every value the named tree produces is 0 or 1, on every bar.
    const scan = [...interpret(fx.trees[fx.scanPlot], bars, {}, undefined, {})]
    expect(scan.length).toBe(bars.length)
    expect([...new Set(scan)].sort(),
      `${fx.scanPlot} is the scan column and it is not 0/1`).toEqual([0, 1])
  })

  it('hist = macd − signal at 1e-9 and hist_up is 0/1 — the arithmetic identity across trees', () => {
    const col = (k) => [...interpret(fx.trees[k], bars, {}, undefined, {})]
    const [m, s, h, u] = ['macd', 'signal', 'hist', 'hist_up'].map(col)
    let finite = 0
    let warmup = 0
    for (let i = 0; i < bars.length; i++) {
      if (!Number.isFinite(h[i])) {
        // ⛔ THE BARS THIS LOOP USED TO STEP OVER IN SILENCE, AND WHAT THEY
        // MEAN. `hist` is computable from bar 33 (MACD(12,26,9)'s warmup);
        // `hist_up` is computable on ALL 300, because a comparison against NaN
        // is 0 and not NaN — `interpret.js` says exactly that above `BINARY`
        // ("A COMPARISON AGAINST NaN IS 0, NOT NaN … it is pinned rather than
        // assumed"). So a plot column and its comparison column DISAGREE about
        // being computable on precisely these bars, by design. Skipping them
        // left that disagreement invisible to the fixture on either lane; it is
        // PINNED here instead, in both halves: the comparison has a value on
        // every bar, and during warmup that value is 0 — "not yet computable"
        // reads as "no", never as "yes" and never as a hole.
        //
        // ⭐ THE PYTHON LANE HOLDS THE SAME RULE FROM THE OTHER SIDE:
        // `test_the_lanes_agree_on_a_tree_that_is_NOT_COMPUTABLE_on_every_bar`
        // reads an all-null column beside its comparison, which is 1 on every
        // bar — same decision, opposite verdict, because there the operand is
        // +Infinity rather than NaN.
        warmup += 1
        expect(Number.isFinite(u[i]),
          `bar ${i}: hist is not computable and hist_up has a HOLE — a comparison must answer on every bar`).toBe(true)
        expect(u[i], `bar ${i}: hist is not computable and hist_up did not read 0`).toBe(0)
        continue
      }
      finite += 1
      expect(Math.abs(h[i] - (m[i] - s[i]))).toBeLessThan(1e-9)
      expect(u[i]).toBe(h[i] > 0 ? 1 : 0)
    }
    // ⛔ THE GUARD AGAINST A VACUOUS LOOP. Without it, a `hist` that came back
    // all-NaN (a broken warmup, a wrong subtree, a wired-wrong fixture) would
    // pass both assertions above by never running them — zero iterations is a
    // pass. 300 synthetic bars minus MACD(12,26,9)'s ~33-bar warmup leaves
    // comfortably more than 200 finite bars; this is the number, not a guess.
    expect(finite).toBeGreaterThan(200)
    // ⚠️ …AND THE WARMUP HALF NEEDS THE SAME GUARD, for the same reason in the
    // other direction: a `hist` that was finite on every bar would satisfy the
    // branch above by never entering it. Both counts are asserted to partition
    // the series, so neither half can quietly stop running.
    expect(warmup, 'no bar was skipped — the warmup half of this case asserts nothing')
      .toBeGreaterThan(0)
    expect(warmup + finite, 'the two halves do not partition the series').toBe(bars.length)
  })

  it('⛔ THE `>` BOUNDARY, EXERCISED: a FLAT series puts `hist` exactly ON 0, and `hist_up` reads 0', () => {
    // ⛔ THE SEAM THE SINE SERIES CANNOT REACH. Measured over those 300 bars,
    // `hist` lands on exactly 0 ZERO times (9 sign changes; closest approach
    // |hist| ≈ 4.7e-3), so the identity above never once evaluates the one place
    // `hist_up` can be subtly wrong — `>` against `>=`. An untested boundary in a
    // comparison is a seam this branch has been bitten by twice, so it is
    // REACHED here rather than disclaimed: on a flat series `ema(close, 12)` and
    // `ema(close, 26)` are the same number, so `macd`, `signal` and `hist` are
    // exactly 0 on every post-warmup bar and the comparison sits ON the boundary.
    //
    // ⭐ AND THE CASE CAN DISTINGUISH, which is the half a boundary test usually
    // skips: the `>=` control is the same operand against the same literal and it
    // reads 1 exactly where `hist_up` reads 0. Without it this case would be
    // green under EITHER operator and prove nothing
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    //
    // ⭐ THE PYTHON LANE ASSERTS THE SAME BOUNDARY ON THE SAME SERIES
    // (`tests/test_ast_multi_tree_parity.py`), through `compare_lanes`, because a
    // comparison operator is mirrored code and a rail in one lane leaves the twin
    // free to answer `>=`.
    const flat = Array.from({ length: 60 }, (_, i) => (
      { t: 1761897600 + i * 300, o: 100, h: 100, l: 100, c: 100, v: 100000 }))
    const run = (tree) => [...interpret(tree, flat, {}, undefined, {})]
    const h = run(fx.trees.hist)
    const u = run(fx.trees.hist_up)
    const ge = run({ type: 'op', name: '>=', args: [fx.trees.hist, { type: 'num', value: 0 }] })
    let onTheBoundary = 0
    for (let i = 0; i < flat.length; i++) {
      if (h[i] !== 0) continue                 // NaN warmup and non-zero alike
      onTheBoundary += 1
      expect(u[i], `bar ${i}: hist is exactly 0 and hist_up did not read 0 — the tree compares >=, not >`).toBe(0)
      expect(ge[i], `bar ${i}: the >= control did not read 1, so this case cannot tell the operators apart`).toBe(1)
    }
    expect(onTheBoundary, 'no bar landed on hist === 0 — this case proves nothing').toBeGreaterThan(0)
  })
})
