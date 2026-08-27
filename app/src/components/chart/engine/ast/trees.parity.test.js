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

  it('hist = macd − signal at 1e-9 and hist_up is 0/1 — the arithmetic identity across trees', () => {
    const col = (k) => [...interpret(fx.trees[k], bars, {}, undefined, {})]
    const [m, s, h, u] = ['macd', 'signal', 'hist', 'hist_up'].map(col)
    let finite = 0
    for (let i = 0; i < bars.length; i++) {
      if (!Number.isFinite(h[i])) continue
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
  })
})
