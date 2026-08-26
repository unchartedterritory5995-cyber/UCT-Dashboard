// ─── THE SECOND VERDICT'S RAILS — the JS lane ───────────────────────────────
//
// ⭐⭐ THE HEADLINE THIS FILE EXISTS FOR: `astReach` answers `forward: 0` for a
// table-declared scalar, so the repaint gate brands `market_cap > 1e9`
// `non-repainting` — CORRECTLY, because a per-symbol number depends on no later
// bar — and therefore PASSES a value that is up to a day old with nothing else
// firing. The zero is a true answer to a question nobody asked, which is why
// `meta.freshness` is a GATE and not a label.
//
// ⛔ THE BINDING TO THE OTHER LANE IS THE FIXTURE, NOT A COMMENT.
// `tests/fixtures/ast/scalars.json` carries `freshness` and `repaint` per tree
// and BOTH lanes assert against those fields, so a divergence is a failing test
// rather than a discovery six months later. `tests/test_ast_scalars.py` reads
// this file's source and fails if that path stops appearing here.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { freshnessFor, scalarsIn, FRESHNESS_MODES } from './freshness.js'
import { lintRepaint } from './lint.js'
import { TABLE, astHash, parseFormula } from './parse.js'
import { interpret } from './interpret.js'
import { FRESHNESS_MODES as SCHEMA_MODES, validateDefinition } from '../defSchema'
import { validateUserDefinitions } from '../nativeRegistry'

/** The repo root, found by walking up — the same helper and the same reason as
 *  `lint.test.js`'s: `process.cwd()` is `app/` for the documented runner and the
 *  repo root for some editors. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`freshness.test.js: could not find the repo root from ${process.cwd()}`)
})()

/** ⚠️ CRLF IS NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const FIXTURE_REL = 'tests/fixtures/ast/scalars.json'
const DOC = JSON.parse(read(FIXTURE_REL))

const NUM = (value) => ({ type: 'num', value })
const SER = (name) => ({ type: 'series', name })
const OP = (name, ...args) => ({ type: 'op', name, args })

const BARS = Array.from({ length: 6 }, (_, i) => ({
  t: 1780000000 + i * 300, o: 10, h: 11, l: 9, c: 10 + i, v: 100 * (i + 1),
}))

describe('the closed table declares scalars, and both lanes read the same one', () => {
  it('declares a fourth section whose entries carry a source, an as-of column, a cadence and a yield', () => {
    const names = Object.keys(TABLE.scalars)
    // 108 -> 111 on 2026-08-25: the three NUMERIC columns of the 8/24 candle
    // library (`candle_recent_bars_ago`, `avg_body`, `avg_range`) declared, all
    // `bars_asof` off the candle producer. Mirrored in `tests/test_ast_scalars.py`.
    expect(names.length).toBe(111)
    for (const name of names) {
      const spec = TABLE.scalars[name]
      expect(spec.source.store).toBe('screener_rows')
      expect(spec.source.column).toBe(name)
      expect(['snapshot_date', 'bars_asof']).toContain(spec.as_of.column)
      expect(spec.cadence).toBeTruthy()
      expect(['num', 'bool']).toContain(spec.yields)
      expect(typeof spec.sentence).toBe('string')
    }
    // ⛔ AND THE EXCLUDED HALF IS DECLARED TOO, each with a stated reason. A
    // granted list without a refused list is a list of what somebody remembered.
    const excluded = TABLE._scalars_excluded
    // 52 -> 77 on 2026-08-24: Wave 7 added 25 fundamental columns that were
    // already inside the bulk FMP payloads the snapshot pulls. All 25 land
    // EXCLUDED under R8 — no production build has written them yet, and a
    // column no build has filled makes every expression over it silently
    // NULL. Promote them after a clean nightly fill.
    // ⛔ THIS COUNT IS MIRRORED IN `tests/test_ast_scalars.py`, because
    // ONE table is read by BOTH lanes. Moving one and not the other is how
    // this went red: the Python side was updated with the columns and this
    // one was not, so the JS lane failed on a table the Python lane had
    // already accepted. Change them together or not at all.
    // 77 -> 89 on 2026-08-25: the 8/24 candle library's twelve TEXT labels
    // (`candle_label`, `candle_matches`, `candle_trend`, `bar_character*`,
    // `candle_recent*`, `candle_weekly*`, `candle_monthly*`) refused for
    // `candle_type`'s reason — a classification is not a magnitude — while its
    // three numerics were DECLARED (108 -> 111 above). Same Python mirror.
    expect(Object.keys(excluded).length).toBe(89)
    for (const [column, why] of Object.entries(excluded)) {
      expect(names, `${column} is in BOTH halves of the partition`).not.toContain(column)
      expect(String(why).length).toBeGreaterThan(20)
    }
  })

  it('declares `yields` on every operator and function — so nobody hand-lists the comparisons twice', () => {
    for (const [name, spec] of Object.entries(TABLE.operators)) {
      expect(['num', 'bool', 'passthrough'], `operators.${name}`).toContain(spec.yields)
    }
    for (const [name, spec] of Object.entries(TABLE.functions)) {
      expect(['num', 'bool'], `functions.${name}`).toContain(spec.yields)
    }
    const boolOps = Object.keys(TABLE.operators).filter((n) => TABLE.operators[n].yields === 'bool')
    expect(boolOps.sort()).toEqual(['!', '!=', '&&', '<', '<=', '==', '>', '>=', '||'])
    // The ternary is the ONE entry whose result kind is the join of its branches.
    expect(TABLE.operators['?:'].yields).toBe('passthrough')
  })

  it('resolves every declared scalar and NEVER an excluded column', () => {
    for (const name of Object.keys(TABLE.scalars)) {
      const col = interpret(SER(name), BARS, {}, undefined, { [name]: 7.25 })
      expect([...col], name).toEqual(new Array(BARS.length).fill(7.25))
    }
    for (const column of Object.keys(TABLE._scalars_excluded)) {
      expect(() => interpret(SER(column), BARS, {}, undefined, { [column]: 1 }))
        .toThrow(/unknown name/)
    }
  })

  it('seeds a missing scalar as a HOLE and never as a zero — and the hole survives arithmetic', () => {
    const leaf = SER('market_cap')
    expect([...interpret(leaf, BARS, {}, undefined, { market_cap: 2e9 })])
      .toEqual(new Array(BARS.length).fill(2e9))
    for (const col of [interpret(leaf, BARS), interpret(leaf, BARS, {}, undefined, {}),
      interpret(leaf, BARS, {}, undefined, { market_cap: null })]) {
      expect([...col].every(Number.isNaN)).toBe(true)
    }
    expect([...interpret(OP('*', leaf, NUM(2)), BARS)].every(Number.isNaN)).toBe(true)
  })

  it('⛔ …but a COMPARISON eats the hole, in this lane too, and the two lanes agree about that', () => {
    // 🔴 THE FINDING. `cmp` answers 0 when either side is NaN — the pinned
    // cross-lane rule, correct for a bar warmup and wrong for a missing scalar.
    // The Python lane measures the same thing and answers it the same way, and
    // `unresolved_scalars` (server-side, where a universe sweep lives) is the
    // question a caller must ask instead of reading the column.
    const tree = OP('>', SER('market_cap'), NUM(1e9))
    expect([...interpret(tree, BARS)]).toEqual(new Array(BARS.length).fill(0))
    expect([...interpret(tree, BARS, {}, undefined, { market_cap: 2e9 })])
      .toEqual(new Array(BARS.length).fill(1))
  })

  it('refuses an input that shadows a declared scalar, and it is NOT a table refusal', () => {
    expect(() => interpret(SER('market_cap'), BARS, { market_cap: 5 }))
      .toThrow(/shadows a table name/)
    try {
      interpret(SER('close'), BARS, { rs_rank: 5 })
      throw new Error('a shadowing input was accepted')
    } catch (err) {
      expect(err.name).not.toBe('TableRefusal')
      expect(err.message).toMatch(/shadows a table name/)
    }
  })
})

describe('freshness — the verdict the repaint zero cannot give', () => {
  it.each(DOC.trees.map((c) => [c.id, c]))('%s', (_id, c) => {
    const got = freshnessFor(c.ast)
    expect(got.mode, `${c.id}: ${got.reasons.join('; ')}`).toBe(c.freshness)
    expect(got.scalars).toEqual(c.scalars)
    expect(got.reasons.length).toBeGreaterThan(0)
    // ⭐ BOTH VERDICTS ON THE SAME TREE, so neither can be obtained alone.
    expect(lintRepaint(c.ast).mode).toBe(c.repaint)
    expect(String(c.why || '').trim().length).toBeGreaterThan(0)
  })

  it('the corpus reaches all three values, in both directions', () => {
    const seen = DOC.trees.map((c) => c.freshness)
    expect([...new Set(seen)].sort()).toEqual([...FRESHNESS_MODES].sort())
    expect(FRESHNESS_MODES).toEqual(['live', 'as-of-snapshot', 'unknown'])
    expect(SCHEMA_MODES).toEqual(FRESHNESS_MODES)
  })

  it('names the scalars a tree reads, at any depth, and nothing else', () => {
    expect([...scalarsIn(OP('>', SER('close'), NUM(1)))]).toEqual([])
    const deep = OP('&&', OP('>', SER('rs_rank'), NUM(80)),
      OP('>', OP('*', SER('market_cap'), NUM(2)), NUM(1e9)))
    expect([...scalarsIn(deep)].sort()).toEqual(['market_cap', 'rs_rank'])
  })

  it('FAILS CLOSED to `unknown` when a scalar cannot be dated — never to `live`', () => {
    const tree = OP('>', SER('market_cap'), NUM(1))
    for (const broken of [{ cadence: 'nightly' },
      { as_of: { column: 'snapshot_date' } },
      { as_of: { column: '' }, cadence: 'nightly' },
      { as_of: { column: 'snapshot_date' }, cadence: '' }]) {
      const table = { ...TABLE, scalars: { ...TABLE.scalars, market_cap: broken } }
      const got = freshnessFor(tree, { table })
      expect(got.mode, JSON.stringify(broken)).toBe('unknown')
    }
    // the control: the SAME tree against the real table is decided
    expect(freshnessFor(tree).mode).toBe('as-of-snapshot')
  })

  it('reads a PLANTED table, so neither lane owns a copy of the vocabulary', () => {
    const planted = {
      ...TABLE,
      scalars: {
        zzz_planted_scalar: {
          source: { store: 'zzz', column: 'zzz_planted_scalar' },
          as_of: { column: 'zzz_dated_by', grain: 'date' },
          cadence: 'hourly', yields: 'bool', sentence: 'the planted probe',
        },
      },
    }
    const tree = OP('>', SER('zzz_planted_scalar'), NUM(0))
    expect(lintRepaint(tree, { table: planted }).mode).toBe('non-repainting')
    const got = freshnessFor(tree, { table: planted })
    expect(got.mode).toBe('as-of-snapshot')
    expect(got.cadences).toEqual(['hourly'])
    // the control: against the REAL table the same name is unresolvable
    expect(lintRepaint(tree).mode).toBe('repaints')
    expect(freshnessFor(tree).mode).toBe('unknown')
  })

  it("a definition's own input is dated by nothing and never ages a formula", () => {
    const tree = OP('*', SER('close'), SER('lineWidth'))
    expect(freshnessFor(tree, { inputs: { lineWidth: true } }).mode).toBe('live')
    expect(freshnessFor(tree).mode).toBe('unknown')
  })
})

describe('the badge is a MEASUREMENT — the schema and the lane gate', () => {
  // ⚠️ THE SOURCE IS PARSED, NOT TYPED BESIDE THE TREE. `defSchema` re-parses
  // `compute.source` and refuses a pair that disagree, so a hand-written `'x'`
  // would fail this door before ever reaching the freshness gate — and every
  // assertion below would then be testing the wrong refusal.
  const astDoc = (over = {}) => {
    const source = over.source || 'market_cap > 1000000000'
    const ast = over.ast || parseFormula(source).ast
    return {
      schemaVersion: 1,
      id: 'u_freshprobe01',
      version: 1,
      compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source },
      meta: {
        name: 'Probe', shortName: 'Probe', category: 'Custom',
        tier: 'premium', repaint: 'non-repainting',
        freshness: 'as-of-snapshot', ...(over.meta || {}),
      },
      placement: { target: 'pane', pane: { height: 0.15 } },
      plots: [{ key: 'value', label: 'v', style: 'line', color: '#fff', ...(over.plotOver || {}) }],
    }
  }

  it('the control: a scalar formula with the MEASURED badge is accepted', () => {
    const res = validateUserDefinitions([astDoc()])
    expect(res.errors).toEqual([])
    expect(res.defs).toHaveLength(1)
  })

  it('⛔ requires the badge — because the repaint gate passes a scalar and nothing else fires', () => {
    const doc = astDoc()
    delete doc.meta.freshness
    const res = validateUserDefinitions([doc])
    expect(res.errors.join('\n')).toMatch(/meta\.freshness — required/)
    expect(res.defs).toHaveLength(0)
    // …and GATE 3 really does pass this tree, which is the whole argument
    expect(lintRepaint(doc.compute.ast).mode).toBe('non-repainting')
  })

  it('⛔ refuses a disagreement in BOTH directions', () => {
    const over = validateUserDefinitions([astDoc({ meta: { freshness: 'live' } })])
    expect(over.errors.join('\n')).toMatch(/meta\.freshness — declared "live"/)
    expect(over.defs).toHaveLength(0)

    const price = { source: 'close > 10' }
    const under = validateUserDefinitions([astDoc({
      ...price, meta: { freshness: 'as-of-snapshot' },
    })])
    expect(under.errors.join('\n')).toMatch(/meta\.freshness — declared "as-of-snapshot"/)
    expect(under.defs).toHaveLength(0)
    // the control: the same price tree with the measured badge is accepted
    expect(validateUserDefinitions([astDoc({ ...price, meta: { freshness: 'live' } })])
      .errors).toEqual([])
  })

  it('⛔ refuses `plots[].freshness` BY NAME — a hand-set badge is as false as a hand-set repaint one', () => {
    for (const mode of FRESHNESS_MODES) {
      const { errors } = validateDefinition(astDoc({ plotOver: { freshness: mode } }))
      expect(errors.join('\n'), `plots[].freshness ${mode} was accepted`)
        .toMatch(/plots\[0\]\.freshness — a plot may not declare a freshness badge/)
    }
    // the control: without the field the same document is well-formed
    expect(validateDefinition(astDoc()).ok).toBe(true)
  })

  it('⛔ refuses a `meta.freshness` outside the vocabulary at the SCHEMA door', () => {
    const { errors } = validateDefinition(astDoc({ meta: { freshness: 'snapshot:nightly' } }))
    expect(errors.join('\n')).toMatch(/meta\.freshness/)
  })
})
