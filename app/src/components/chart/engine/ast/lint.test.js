// ─── THE LINTER'S OWN RAILS ─────────────────────────────────────────────────
//
// This file exists to make the badge CHECKABLE, and the product's whole market
// position is that the badge is checkable. So the cases below are written
// against the nine obligations the decision record states — not against the
// linter's implementation — and several of them are controls whose only job is
// to prove another case is capable of failing.
//
//   1  decidable on the AST, with NO execution     → `no evaluator is reachable…`
//   2  the forward set derived from the MANIFEST   → `the forward reach comes…`
//   3  a corpus that must be branded repainting    → `every case in the corpus…`
//   4  a positive control the OTHER way            → `…and the corpus is not…`
//   5  the guard-deleted control                   → `with the forward-reference…`
//   6  no exemption surface, proven by AST         → `there is no exemption…`
//   7  it can disagree, and the disagreement lives → `the measurement over the…`
//   8  natives/server in scope of the MEASUREMENT  → same case, `decided` counts
//   9  per-plot granularity, before a badge moves  → same case, addresses
//
// ⛔ NOTHING HERE EDITS A BADGE. The measurement's only available response to a
// disagreement is to name it, and the record is where it is named.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJs } from 'acorn'
import * as lint from './lint.js'
import { TABLE, parseFormula, isPointwise, SESSION_LOOKBACK, SESSION_MAX_BARS } from './parse.js'
// ⚠️ IMPORTED BY THE TEST, NEVER BY THE LINTER — see the agreement case below.
import { maxLookback as interpretMaxLookback, ownLookback } from './interpret.js'
import * as engineRegistry from '../nativeRegistry'

/** The repo root, found by walking up. `import.meta.url` is an `http:` URL under
 *  this environment's vite transform and `process.cwd()` is `app/` for the
 *  documented runner and the repo root for some editors — walking finds both and
 *  THROWS BY NAME if neither. Same helper, same reason, as the ledger's. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`lint.test.js: could not find the repo root from ${process.cwd()}`)
})()

/** ⚠️ CRLF IS NORMALISED AT THE DOOR. `core.autocrlf` is on in this checkout, so
 *  every file read here comes back with `\r\n`; a multi-line `\n` anchor then
 *  matches zero times and a `split('\n')` leaves a `\r` on every line. That has
 *  cost this programme a measurement already. */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const LINT_SRC_REL = 'app/src/components/chart/engine/ast/lint.js'
const RECORD_REL = 'docs/decisions/2026-08-06-machine-repaint-linter.md'
const CORPUS_REL = 'tests/fixtures/ast/must_repaint.json'

const CORPUS = JSON.parse(read(CORPUS_REL))

/** The corpus's declared v2 entries merged ON TOP of the shipped manifest.
 *  ⛔ THE SHIPPED HALF IS NEVER COPIED — it is `TABLE`, the same object
 *  `parse.js` configures the parser from. A corpus carrying its own full grammar
 *  would be a second manifest, which is the exact defect the manifest exists to
 *  prevent. */
const CORPUS_TABLE = {
  ...TABLE,
  functions: { ...TABLE.functions, ...CORPUS.tableOverlay.functions },
}

const caseById = (id) => {
  const found = CORPUS.cases.find((c) => c.id === id)
  if (!found) throw new Error(`must_repaint.json has no case ${JSON.stringify(id)}`)
  return found
}

// --------------------------------------------------------------------------- //
// obligation 3 + 4 — the corpus, and its own non-vacuity
// --------------------------------------------------------------------------- //

describe('the must-repaint corpus is the linter\'s positive control, in both directions', () => {
  it('every case in the corpus gets the verdict it declares, and the reason is not empty', () => {
    const wrong = []
    for (const c of CORPUS.cases) {
      const got = lint.lintRepaint(c.ast, { table: CORPUS_TABLE })
      if (got.mode !== c.expect) wrong.push(`${c.id}: expected ${c.expect}, measured ${got.mode}`)
      expect(got.reasons.length, `${c.id} produced a verdict with no reason`).toBeGreaterThan(0)
    }
    expect(wrong,
      'a hand-derived case the linter disagrees with. Each case in must_repaint.json carries its ' +
      'own `why`; read that before changing either side, because the corpus is the thing the badge ' +
      'is checked against and "make the corpus match the linter" is how a measurement becomes a ' +
      'tautology.',
    ).toEqual([])
  })

  it('…and the corpus is not degenerate: all three verdicts are expected, in both directions', () => {
    const expected = CORPUS.cases.map((c) => c.expect)
    const count = (m) => expected.filter((e) => e === m).length

    expect({
      // ⭐ OBLIGATION 4. Without a clean case a linter that returns `repaints`
      // unconditionally passes every dirty case and is indistinguishable from
      // one that works.
      clean: count('non-repainting') >= 2,
      // ⭐ OBLIGATION 3, and the corpus's own non-vacuity: a corpus in which
      // every case is clean measures nothing.
      previewRepaints: count('preview-repaints') >= 1,
      repaints: count('repaints') >= 1,
      // ⭐ EVERY VALUE IN THE VOCABULARY IS REACHED BY A HAND-DERIVED CASE. The
      // record's §3 warns that a vocabulary value nothing can emit is a value
      // that does not exist — `preview-repaints` is emitted by nothing today,
      // and this is what stops that being true of any of the three tomorrow.
      unexpectedTokens: [...new Set(expected)].filter((e) => !lint.REPAINT_MODES.includes(e)),
      vocabularyFullyExercised: lint.REPAINT_MODES.every((m) => expected.includes(m)),
      // …and every case carries a written reason, so "hand-derived" is a fact
      // about the file rather than a claim in a report.
      caseWithNoWhy: CORPUS.cases.filter((c) => !(c.why || '').trim()).map((c) => c.id),
    }).toEqual({
      clean: true,
      previewRepaints: true,
      repaints: true,
      unexpectedTokens: [],
      vocabularyFullyExercised: true,
      caseWithNoWhy: [],
    })
  })

  // ⭐ THE OBVIOUS VERSION OF THIS CASE IS WRONG, AND IT WAS MEASURED.
  //
  // The plan's sketch asserted `parseFormula(sourceOf(id)).ok === false` for the
  // dirty cases, on the reasoning that v1's table has no offset form so nothing
  // a user types can repaint. But `parse.js` DELIBERATELY DOES NOT VALIDATE
  // IDENTIFIERS at the canonical boundary (see the `Identifier` case in
  // `convert`, and the three escape-census cases it fates to `resolve:name`), so
  // `offset(close, 26)` parses perfectly well — it is refused one layer down, by
  // the table, not by the parser. The sketch's assertion would have been RED on
  // the day it was written; asserting it for the wrong reason would have been
  // worse, because it would have passed.
  //
  // So the claim is made per case, in the vocabulary the corpus declares, and
  // BOTH kinds of unreachability are required to be present — otherwise "the
  // dirty cases are unreachable" could be satisfied by a corpus that only ever
  // uses one mechanism.
  it('the corpus\'s reachability claims are TRUE — parser-refuses, not-in-table, reachable-today', () => {
    const wrong = []
    const seen = new Set()
    for (const c of CORPUS.cases) {
      seen.add(c.v1Reachability)
      const parsed = parseFormula(c.source)
      const namesInTable = (node) => {
        if (!node || typeof node !== 'object') return true
        if (node.type === 'call' && !TABLE.functions[node.name]) return false
        if (node.type === 'series' && !TABLE.series[node.name]) return false
        return (node.args || []).every(namesInTable)
      }
      if (c.v1Reachability === 'parser-refuses') {
        if (parsed.ok) wrong.push(`${c.id}: PARSED — v1 grew a form and nobody said so`)
      } else if (c.v1Reachability === 'not-in-table') {
        if (!parsed.ok) wrong.push(`${c.id}: did not parse, so it is refused by the PARSER, not by the table`)
        else if (namesInTable(parsed.ast)) wrong.push(`${c.id}: every name IS in the shipped table — the case is reachable today`)
      } else if (c.v1Reachability === 'reachable-today') {
        if (!parsed.ok) wrong.push(`${c.id}: does not parse: ${parsed.error}`)
        else if (!namesInTable(parsed.ast)) wrong.push(`${c.id}: names something the table does not declare`)
        // …and the hand-written tree really is the tree the parser produces, so
        // the corpus cannot drift into asserting things about a shape no source
        // can make.
        else if (JSON.stringify(parsed.ast) !== JSON.stringify(c.ast)) {
          wrong.push(`${c.id}: the declared tree is not what \`${c.source}\` parses to — got ${JSON.stringify(parsed.ast)}`)
        }
      } else {
        wrong.push(`${c.id}: v1Reachability ${JSON.stringify(c.v1Reachability)} is not one of the three`)
      }
    }
    expect(wrong).toEqual([])
    // …and all three mechanisms are represented, so the corpus is neither purely
    // hypothetical nor purely about today.
    expect([...seen].sort()).toEqual(['not-in-table', 'parser-refuses', 'reachable-today'])
  })
})

// --------------------------------------------------------------------------- //
// obligation 1 — decidable on the AST, with no execution
// --------------------------------------------------------------------------- //

describe('the verdict is decided on the tree, and nothing is ever run', () => {
  // ⛔ PROVEN BY THE IMPORT GRAPH, NOT BY A PROMISE. An empirical "we ran it and
  // nothing moved" is a statement about one bar window and the badge's claim is
  // universal — so the linter must be structurally incapable of running a
  // formula. It imports exactly one module, and that module is the parser's
  // manifest reader.
  it('no evaluator is reachable from the linter — its import graph is one module wide', () => {
    const tree = parseJs(read(LINT_SRC_REL), { ecmaVersion: 2022, sourceType: 'module' })
    const imports = tree.body
      .filter((n) => n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' ||
        (n.type === 'ExportNamedDeclaration' && n.source))
      .map((n) => n.source.value)
    const dynamic = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'ImportExpression') dynamic.push(node)
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
    }
    walk(tree)
    expect({ imports, dynamicImports: dynamic.length },
      'the linter reaches a second module. If that module can compute an indicator, the verdict ' +
      'could be reached by RUNNING the formula instead of by reading the tree — and a claim ' +
      'measured on one bar window is not the universal claim the badge makes.',
    ).toEqual({ imports: ['./parse.js'], dynamicImports: 0 })
  })

  it('the same tree gets the same verdict with no bars in sight — the verdict takes only a tree', () => {
    const c = caseById('future_offset_series')
    const a = lint.lintRepaint(c.ast, { table: CORPUS_TABLE })
    const b = lint.lintRepaint(JSON.parse(JSON.stringify(c.ast)), { table: CORPUS_TABLE })
    expect(a.mode).toBe(b.mode)

    // ⚠️ THE PARAMETER LIST IS READ OFF THE AST, NOT OFF `Function.length` — a
    // default value makes `.length` stop counting the parameter, so
    // `lintRepaint.length` is 1 for `(ast, opts = {})` and an assertion on it
    // would be measuring the DEFAULT rather than the signature.
    const tree = parseJs(read(LINT_SRC_REL), { ecmaVersion: 2022, sourceType: 'module' })
    const decl = tree.body
      .filter((n) => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration')
      .map((n) => n.declaration)
      .find((d) => d.id.name === 'lintRepaint')
    const paramNames = decl.params.map((p) => (p.type === 'AssignmentPattern' ? p.left.name : p.name))
    expect(paramNames,
      'lintRepaint takes (ast, opts) and nothing else — a third parameter is where a bar window ' +
      'would arrive, and a bar window is how a universal claim becomes a claim about one week',
    ).toEqual(['ast', 'opts'])
  })
})

// --------------------------------------------------------------------------- //
// obligation 2 — the forward set comes from the manifest, not from a second list
// --------------------------------------------------------------------------- //

describe('the forward-reference set is derived from the manifest both lanes read', () => {
  it('the forward reach comes out of the DECLARED window — change the declaration, change the verdict', () => {
    const ast = { type: 'call', name: 'probe', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 7 }] }
    const withTable = (fnSpec) => lint.lintRepaint(ast, {
      table: { ...TABLE, functions: { ...TABLE.functions, probe: fnSpec } },
    })

    expect({
      // a plain backward window
      backward: withTable({ args: ['series', 'int'], lookback: 'arg1' }).mode,
      // the SAME call, with the SIGN of the declared window flipped. Nothing in
      // the linter changed; the manifest did.
      signFlipped: withTable({ args: ['series', 'int'], lookback: -3 }).mode,
      signFlippedReach: withTable({ args: ['series', 'int'], lookback: -3 }).forward,
      // an explicitly declared forward window, taken from an argument
      declaredForward: withTable({ args: ['series', 'int'], lookback: 0, forward: 'arg1' }).forward,
      // and an unbounded one
      unbounded: withTable({ args: ['series', 'int'], lookback: 0, forward: 'unbounded' }).mode,
    },
    'the linter is not reading the manifest. Obligation 2: the maximum forward index an entry can ' +
    'read must come from the table BOTH LANES READ, so that the day an offset form is added its ' +
    'reach is already decided. A per-function offset table kept beside the manifest is a second ' +
    'grammar and it drifts silently.',
    ).toEqual({
      backward: 'non-repainting',
      signFlipped: 'preview-repaints',
      signFlippedReach: 3,
      declaredForward: 7,
      unbounded: 'repaints',
    })
  })

  it('the linter carries no offset table of its own — every function it can name comes from the manifest', () => {
    // ⛔ AST, NOT GREP. A grep for a function name finds the ten in this file's
    // own comments. The question is which string literals the MODULE contains,
    // and the answer must not include a single manifest function name.
    const src = read(LINT_SRC_REL)
    const literals = stringLiteralsOf(src)
    const manifestNames = [...Object.keys(TABLE.functions), ...Object.keys(TABLE.series)]
    expect(literals.filter((s) => manifestNames.includes(s)),
      'the linter names a manifest entry in its own source. That is the second grammar obligation 2 ' +
      'forbids: it drifts the day the manifest moves, and it drifts silently.',
    ).toEqual([])
  })

  it('`maxLookback` is the BACKWARD window and is never a bound on the forward one', () => {
    const sma20 = caseById('plain_sma').ast
    const r = lint.astReach(sma20, { table: CORPUS_TABLE })
    expect({ back: r.back, forward: r.forward, mode: lint.lintRepaint(sma20, { table: CORPUS_TABLE }).mode },
      'a 20-bar lookback read as a forward bound brands `sma(close, 20)` as reading 20 bars ahead. ' +
      'Every clean case in the corpus goes with it, and the builder ships nothing.',
    ).toEqual({ back: 20, forward: 0, mode: 'non-repainting' })
    expect(lint.maxLookback(sma20, { table: CORPUS_TABLE })).toBe(20)
    // a composed window really sums, so `back` is a number somebody could use
    expect(lint.maxLookback(caseById('cross_of_emas').ast, { table: CORPUS_TABLE })).toBe(22)
  })

  // ⭐ THE SENTINEL FOR "A LOOKBACK READ AS A FORWARD BOUND", AND IT IS BUILT
  // HERE RATHER THAN READ FROM THE CORPUS ON PURPOSE.
  //
  // Measured: the mutation that makes `maxLookback` bound the forward dependency
  // too had NO UNIQUE KILLER — every test that caught it was also caught by the
  // fail-closed mutation or by deleting the corpus's clean cases, so a report
  // could have said "killed" without anything being able to say WHICH defect it
  // saw. This case reads no fixture and no manifest entry beyond the two shipped
  // functions it names, so it can fail for exactly one reason.
  it('a purely backward composition reaches ZERO bars forward — nothing else can make this fail', () => {
    const tree = {
      type: 'call',
      name: 'sma',
      args: [
        { type: 'call', name: 'ema', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 4 }] },
        { type: 'num', value: 6 },
      ],
    }
    expect(lint.astReach(tree),
      'the backward windows summed to a FORWARD reach. `sma(ema(close, 4), 6)` looks back ten bars ' +
      'and ahead none; anything else here means the two halves of one declaration have been crossed.',
    ).toEqual({ back: 10, forward: 0, reasons: [] })
    expect(lint.lintRepaint(tree).mode).toBe('non-repainting')
  })

  // ⭐⭐ TWO `maxLookback`s NOW EXIST IN THIS DIRECTORY, AND THAT IS DECLARED
  // RATHER THAN DISCOVERED. Task 4's interpreter landed while this task was
  // being written and exports its own `maxLookback(ast)`. The linter does NOT
  // import it, for two measured reasons:
  //
  //   * `interpret.js` also exports `interpret(ast, bars, inputs)` — an
  //     EVALUATOR. Importing it would put a way to RUN a formula inside the
  //     linter's import graph, and obligation 1 is that the verdict is decided
  //     on the tree with no execution. The import-graph case above is what
  //     enforces that, and it would go red.
  //   * the interpreter's version THROWS on a shape it cannot read and takes no
  //     manifest override, so it can neither fail closed nor lint a grammar that
  //     has not shipped yet — which is exactly what the corpus's v2 overlay is.
  //
  // ⛔ SO THE DUPLICATION IS PAID FOR WITH A RAIL, NOT WITH A COMMENT. On every
  // tree BOTH can read, the two must return the SAME number. If they ever
  // disagree, one of the two lanes' warm-up windows is wrong and this says which
  // trees it happens on.
  it('the linter\'s backward window agrees with the interpreter\'s on every tree both can read', () => {
    const agreed = []
    const disagreed = []
    const interpreterAnsweredWhereTheLinterWouldNot = []
    for (const c of CORPUS.cases) {
      let theirs
      try { theirs = interpretMaxLookback(c.ast) } catch { continue }
      const mine = lint.maxLookback(c.ast)
      if (mine === lint.UNKNOWN) { interpreterAnsweredWhereTheLinterWouldNot.push(`${c.id}=${theirs}`); continue }
      if (mine !== theirs) disagreed.push(`${c.id}: linter ${mine}, interpreter ${theirs}`)
      else agreed.push(c.id)
    }

    expect(disagreed,
      'the two `maxLookback` implementations in this directory return DIFFERENT numbers for a tree ' +
      'they both read. One of the two lanes will warm up on the wrong window.',
    ).toEqual([])
    expect(agreed.sort(),
      'the interpreter can no longer read ANY corpus case, so this agreement is a claim about ' +
      'nothing. Two `maxLookback` implementations exist in this directory and only this case ties ' +
      'them together.',
    ).toEqual(['cross_of_emas', 'nested_arithmetic', 'plain_sma', 'ternary_gate'])

    // 🔴 A FINDING, PINNED RATHER THAN FIXED — `interpret.js` IS TASK 4's FILE.
    //
    // `interpret.maxLookback` answers **0** for `{type:'series', name:'globalThis'}`
    // — a name the closed table does not declare. Its walk treats every `series`
    // node as reach 0 without asking whether the name resolves, so as a
    // STANDALONE measurement it produces a warm-up window for a tree its own
    // `interpret()` would refuse at `resolve:name`. It is not a live defect today
    // (nothing calls `maxLookback` on an unresolvable tree, and the parse lane
    // deliberately lets the identifier through so `resolve:name` can catch it),
    // but it is exactly the shape the repaint linter must not copy: this lane
    // answers UNKNOWN and therefore `repaints`, because a name whose data cannot
    // be identified has a window that cannot be stated.
    expect(interpreterAnsweredWhereTheLinterWouldNot,
      'the set of trees where the interpreter measures a window and the linter refuses to has ' +
      'changed. Either Task 4\'s walk started validating series names (good — say so here) or the ' +
      'linter stopped failing closed (bad).',
    ).toEqual(['unknown_series=0'])
  })
})

// --------------------------------------------------------------------------- //
// obligation 5 — the guard-deleted control
// --------------------------------------------------------------------------- //

/** Write a MUTATED COPY of `lint.js` beside it, import it, and delete it.
 *
 *  ⛔ A COPY, NOT A PATCH. The harness that "restored the file it patched, not
 *  the one the mutation wrote" is a defect this programme has already paid for;
 *  a copy has nothing to restore. The copy lives in the same directory so its
 *  `./parse.js` import still resolves, and the specifier is RELATIVE so vitest's
 *  module runner transforms it (a `file://` import would reach bare node, which
 *  cannot import `closedTable.json` without an attribute).
 */
async function withDeletion(fragment, replacement, fn) {
  const src = read(LINT_SRC_REL)
  if (!src.includes(fragment)) {
    throw new Error(`guard-deleted control: the fragment to delete is not in lint.js:\n  ${fragment}`)
  }
  if (src.split(fragment).length - 1 !== 1) {
    throw new Error(`guard-deleted control: ${JSON.stringify(fragment)} appears more than once — the deletion is ambiguous`)
  }
  const name = `__guardDeleted_${Math.random().toString(36).slice(2)}.js`
  const abs = path.join(ROOT, 'app/src/components/chart/engine/ast', name)
  fs.writeFileSync(abs, src.replace(fragment, replacement), 'utf8')
  try {
    return await fn(await import(/* @vite-ignore */ `./${name}`))
  } finally {
    try { fs.unlinkSync(abs) } catch { /* the next run's random name is not this one */ }
  }
}

describe('the linter is demonstrated CAPABLE OF BEING WRONG — the guard-deleted control', () => {
  const dirty = () => CORPUS.cases.filter((c) => c.expect !== 'non-repainting')

  it('with the forward-reference check deleted, the must-repaint corpus comes back non-zero clean', async () => {
    // ⛔ THE MUTATION IS PROVEN TO HAVE APPLIED — `withDeletion` throws by name
    // if the fragment is absent or ambiguous. A control that silently mutated
    // nothing would report "still red" and read as a working gate.
    const wrongfullyClean = await withDeletion(
      "  if (forward > 0) return 'preview-repaints'\n",
      '',
      (mutated) => dirty()
        .filter((c) => mutated.lintRepaint(c.ast, { table: CORPUS_TABLE }).mode === 'non-repainting')
        .map((c) => c.id),
    )
    expect(wrongfullyClean.length,
      'THE GATE CANNOT FAIL. With the forward-reference branch deleted the corpus still comes back ' +
      'entirely dirty, which means the verdicts are not being produced by the check this linter ' +
      'claims to be. A gate that cannot fail is not a gate.',
    ).toBeGreaterThan(0)
    // …and it is a PARTIAL collapse, which is the honest shape: the fail-closed
    // cases stay dirty because they never reached the forward branch at all.
    expect(wrongfullyClean.length).toBeLessThan(dirty().length)
    expect(wrongfullyClean.sort()).toEqual(['centred_window', 'future_index', 'future_offset_series'])
  })

  it('and with the DECLARED window ignored, the manifest-derived cases collapse too', async () => {
    const wrongfullyClean = await withDeletion(
      '    const forward = addReach(own.forward, argForward)',
      '    const forward = argForward',
      (mutated) => dirty()
        .filter((c) => mutated.lintRepaint(c.ast, { table: CORPUS_TABLE }).mode === 'non-repainting')
        .map((c) => c.id),
    )
    expect(wrongfullyClean.sort(),
      'the second guard-deleted control changed nothing, so the manifest\'s declared window is not ' +
      'what the verdict is made of.',
    ).toEqual(['centred_window', 'future_index', 'future_offset_series', 'unbounded_forward'])
    // ⚠️ FOUR, NOT THREE — MEASURED, AND THE FOURTH IS THE INTERESTING ONE.
    // `unbounded_forward` is the case whose verdict is `repaints` on a DECLARED
    // unbounded window rather than on a fail-closed guess, so ignoring the
    // declared window launders it clean too. The three cases the FIRST control
    // collapses are the bounded ones; this control is strictly wider, and the
    // difference is the measurement that says the two deletions are not the same
    // deletion wearing two names.
    expect(wrongfullyClean.length).toBeGreaterThan(3)
  })

  it('control: the unmutated module brands every dirty case dirty — the two above are not measuring noise', () => {
    const clean = dirty().filter((c) => lint.lintRepaint(c.ast, { table: CORPUS_TABLE }).mode === 'non-repainting')
    expect(clean.map((c) => c.id)).toEqual([])
  })
})

// --------------------------------------------------------------------------- //
// THE DEFINITION'S OWN INPUTS — a DECLARED SCALAR, never an undeclared series
// --------------------------------------------------------------------------- //
//
// 🔴 THE DEFECT. `parse.js` turns every identifier into a `series` node and
// `BuilderSheet.buildDefinition` puts `lineWidth` on every definition it builds,
// so the first member to type a knob's name into a formula got `repaints` —
// "unanalysable: `lineWidth` is not a series this table declares" — and could
// never arm it. An input is a per-instance SCALAR: one number for the whole
// column, so its window is `[i, i]`.
//
// ⛔ AND THE CLOSED TABLE STAYS CLOSED. What an input adds is exactly the names
// the DOCUMENT declares — nothing else — and both directions are asserted here
// and in `tests/test_ast_lint.py`, which is the mirrored pair this file exists
// to keep from diverging.

/** `close * lineWidth` — the audit's own example. */
const INPUT_TIMES_CLOSE = {
  type: 'op',
  name: '*',
  args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'lineWidth' }],
}

const defnWith = (ast, inputs) => ({
  id: 'u_probe',
  compute: { kind: 'ast', ast },
  plots: [{ key: 'value' }],
  inputs: inputs === undefined ? [{ key: 'lineWidth', type: 'int', default: 1 }] : inputs,
})

describe('a reference to a DECLARED input is a scalar, and an undeclared name still is not', () => {
  it('a declared input reaches no bar at all — back 0, forward 0, non-repainting', () => {
    const declared = lint.lintRepaint(INPUT_TIMES_CLOSE, { inputs: { lineWidth: 1 } })
    expect({ mode: declared.mode, back: declared.back, forward: declared.forward })
      .toEqual({ mode: 'non-repainting', back: 0, forward: 0 })
  })

  it('control: handed NO inputs the same tree is unanalysable, exactly as before', () => {
    const bare = lint.lintRepaint(INPUT_TIMES_CLOSE)
    expect(bare.mode).toBe('repaints')
    expect(bare.reasons.join(' ')).toContain('lineWidth')
  })

  it('lintDefinition DERIVES the scalar set from the definition — `inputs[].key`, and `name` is not a fallback', () => {
    expect(lint.lintDefinition(defnWith(INPUT_TIMES_CLOSE)).plots[0].mode).toBe('non-repainting')
    // ⛔ ONE VOCABULARY. `defSchema.validateInput` REQUIRES `input.key`;
    // `alert_user_series._inputs_for` read `name` for its whole life and agreed
    // with nobody. A linter that took either would rebuild that divergence.
    const legacy = defnWith(INPUT_TIMES_CLOSE, [{ name: 'lineWidth', default: 1 }])
    expect(lint.declaredInputs(legacy)).toEqual({})
    expect(lint.lintDefinition(legacy).plots[0].mode).toBe('repaints')
  })

  it('a caller cannot WIDEN a definition\'s own input set', () => {
    // ⛔ NOT AN ALLOW-LIST. `lintDefinition` overwrites `opts.inputs` with the
    // definition's own declaration, so a caller handing one in cannot turn a
    // declared knob into a general escape hatch for any name at all.
    expect(lint.lintDefinition(defnWith(INPUT_TIMES_CLOSE, []), { inputs: { lineWidth: 1 } })
      .plots[0].mode).toBe('repaints')
  })

  it('a declared input may NOT decide a window — `sma(close, lineWidth)` still fails closed', () => {
    // `resolveDeclaration` bounds an `argK` from a literal `num` node and a
    // per-instance knob is not one. Reading the knob's VALUE is the tempting fix
    // and it is the wrong one: the window would then change with a setting, and
    // the badge promises a property of the FORMULA.
    const tree = {
      type: 'call',
      name: 'sma',
      args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'lineWidth' }],
    }
    const verdict = lint.lintDefinition(defnWith(tree)).plots[0]
    expect(verdict.mode).toBe('repaints')
    expect(verdict.reasons.join(' ')).toContain('sma')
  })

  it('the TABLE is consulted first, so an input that shadows `close` changes nothing', () => {
    // ⛔ THE ORDER IS LOAD-BEARING — verbatim `sentence.js::renderName`'s
    // reasoning. A shadowing input is a wiring defect `interpret` throws on; what
    // this must never do is let the ANSWER depend on which map was second.
    const shadowing = defnWith({ type: 'series', name: 'close' }, [{ key: 'close', default: 7 }])
    const verdict = lint.lintDefinition(shadowing).plots[0]
    expect({ mode: verdict.mode, back: verdict.back, forward: verdict.forward })
      .toEqual({ mode: 'non-repainting', back: 0, forward: 0 })
  })

  it('a prototype name is NOT an input just because the map has a prototype', () => {
    // `own()`, never `inputs[name]` — the same lock `interpret`'s scope carries.
    for (const name of ['toString', 'constructor', '__proto__', 'valueOf']) {
      expect(lint.lintRepaint({ type: 'series', name }, { inputs: {} }).mode).toBe('repaints')
    }
  })

  it('an input reference does NOT launder a genuinely repainting tree', () => {
    // The operator is POINTWISE, so the forward reach of the whole is the
    // forward reach of the dirty half. EVERY dirty corpus case is checked, so
    // this cannot pass by covering only the one shape somebody thought of.
    const wrap = (ast) => ({ type: 'op', name: '*', args: [ast, { type: 'series', name: 'lineWidth' }] })
    const opts = { table: CORPUS_TABLE, inputs: { lineWidth: 1 } }
    const moved = CORPUS.cases.filter((c) => lint.lintRepaint(wrap(c.ast), opts).mode !== c.expect)
    expect(moved.map((c) => c.id),
      'multiplying a declared scalar into a corpus case changed its verdict',
    ).toEqual([])
  })

  it('declaredInputs ignores everything that is not a non-empty string key', () => {
    expect(lint.declaredInputs(null)).toEqual({})
    expect(lint.declaredInputs({ inputs: 'lineWidth' })).toEqual({})
    expect(lint.declaredInputs({ inputs: [null, 3, { key: '' }, { key: 7 }, { key: 'ok' }] }))
      .toEqual({ ok: true })
  })

  it('THE GUARD-DELETED CONTROL, IN THE FAIL-OPEN DIRECTION: with the membership test gone, any name reads clean', async () => {
    // ⭐ The dangerous mutation is not "inputs stop working" — that is loud and
    // every case above goes red. It is the MEMBERSHIP test quietly going away,
    // so that any identifier is treated as a declared scalar and the closed
    // table is open again with every gate still green.
    const unknown = caseById('unknown_series')
    expect(unknown.expect).toBe('repaints')
    const mutatedMode = await withDeletion(
      '        if (own(inputs, node.name)) {\n',
      "        if (typeof node.name === 'string') {\n",
      (mutated) => mutated.lintRepaint(unknown.ast, { table: CORPUS_TABLE }).mode,
    )
    expect(mutatedMode,
      'deleting the input membership test did not open the door, so the test is not the thing ' +
      'keeping an undeclared name out',
    ).toBe('non-repainting')
    // …and the unmutated module, so the line above is a control and not chance.
    expect(lint.lintRepaint(unknown.ast, { table: CORPUS_TABLE }).mode).toBe('repaints')
  })
})

// --------------------------------------------------------------------------- //
// obligation 6 — no exemption surface, proven structurally
// --------------------------------------------------------------------------- //

/** Every string literal a module contains, by AST.
 *  ⛔ NOT A GREP. On this branch a grep has counted comments in BOTH directions:
 *  it found a "declaration" that was a tombstone, and it found four sites where
 *  three existed because the fourth was a comment quoting the code shape. A
 *  comment cannot be a literal, and that is the entire point. */
function stringLiteralsOf(src) {
  const out = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value)
    if (node.type === 'TemplateLiteral') for (const q of node.quasis) out.push(q.value.cooked ?? '')
    if (node.type === 'Property' && !node.computed && node.key && node.key.type === 'Identifier') out.push(node.key.name)
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
  }
  walk(parseJs(src, { ecmaVersion: 2022, sourceType: 'module' }))
  return out
}

describe('there is no exemption surface, and the absence is proven over the linter\'s own AST', () => {
  const SHIPPED_IDS = engineRegistry.listDefinitions().map((d) => d.id)

  it('there is no exemption for anything: the linter\'s source names no shipped indicator', () => {
    const literals = stringLiteralsOf(read(LINT_SRC_REL))
    expect(literals.filter((s) => SHIPPED_IDS.includes(s)),
      'the linter names a shipped indicator in a string literal. An allow-list, an `author` branch, ' +
      'an id-keyed override and a "known-good" set all take this shape, and every one of them is ' +
      'the hand-audited metadata this linter exists to replace. If an exemption is genuinely needed ' +
      'it is a change to the decision record FIRST and to code second.',
    ).toEqual([])
    // …and the catalogue is not empty, so the filter above is filtering something.
    expect(SHIPPED_IDS.length).toBeGreaterThan(10)
  })

  // ⛔ THE DETECTOR'S OWN POSITIVE CONTROL. Three green filters prove only that
  // `includes` returns false sometimes. This is the exemption the case above
  // forbids, written out, and the detector must FIND it.
  it('control: the same detector finds an exemption when one is really there', () => {
    const EXEMPT = "export function lintRepaint(ast, opts) {\n" +
      "  if (opts.defId === 'ichimoku') return { mode: 'non-repainting', reasons: ['ours'] }\n" +
      "  return { mode: 'repaints', reasons: [] }\n}\n"
    expect(stringLiteralsOf(EXEMPT).filter((s) => SHIPPED_IDS.includes(s)),
      'the detector cannot see an exemption written in plain sight, so its silence over lint.js ' +
      'means nothing at all',
    ).toEqual(['ichimoku'])
    // …and a comment mentioning the same id is NOT an exemption. This is the
    // half a grep gets wrong, and it gets it wrong in the direction that fails a
    // clean file.
    expect(stringLiteralsOf("// ichimoku is not exempt\nexport const A = 1\n")
      .filter((s) => SHIPPED_IDS.includes(s))).toEqual([])
  })

  it('and the verdict is id-BLIND behaviourally: the same tree answers the same under every id', () => {
    const tree = caseById('future_offset_series').ast
    const base = lint.lintRepaint(tree, { table: CORPUS_TABLE })
    const answers = new Set()
    for (const id of [...SHIPPED_IDS, 'uct', 'ichimoku', '', 'anything']) {
      // every extra key the caller could smuggle a claim in through
      answers.add(lint.lintRepaint(tree, {
        table: CORPUS_TABLE, defId: id, id, author: 'uct', tier: 'free', trusted: true,
      }).mode)
    }
    expect([...answers],
      'the verdict moved when something other than the tree and the manifest changed',
    ).toEqual([base.mode])
  })
})

// --------------------------------------------------------------------------- //
// obligations 7, 8, 9 — THE MEASUREMENT
// --------------------------------------------------------------------------- //

/** `"<compute.fn>.<column>" → trailing pad length`, MEASURED off the committed
 *  golden fixtures rather than typed.
 *
 *  ⭐ THIS IS THE ONLY WAY THE LINTER LEARNS ANYTHING ABOUT A HAND-WRITTEN
 *  COMPUTE, and it is a fact that was already pinned before this task existed:
 *  `tests/test_indicator_golden.py`'s `TRAILING_PAD` declares it as a number and
 *  `test_the_declared_trailing_pad_is_exactly_that_long` holds both ends of it.
 *  The Python lane reads that declaration; this lane measures the ARTIFACT the
 *  declaration describes, so the two lanes agree by construction on a fact
 *  neither of them typed. A hand-copied 26 would be a second declaration of one
 *  fact and it would rot the first time the pad moved. */
function declaredForwardFactsFromGoldenFixtures() {
  const dir = path.join(ROOT, 'tests', 'fixtures', 'indicators')
  const facts = {}
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    const expected = doc && doc.expected
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) continue
    for (const [col, values] of Object.entries(expected)) {
      if (!Array.isArray(values) || !values.length) continue
      let trailing = 0
      for (let i = values.length - 1; i >= 0 && values[i] === null; i--) trailing++
      if (!trailing) continue
      if (trailing === values.length) {
        throw new Error(`${file}.${col} is entirely null — that is not a trailing pad, it is an empty column`)
      }
      facts[`${doc.kind}.${col}`] = trailing
    }
  }
  return facts
}

describe('the measurement over the shipped definitions — and it is allowed to disagree with us', () => {
  it('the measurement over the shipped catalogue is the one written in the decision record', () => {
    const defs = engineRegistry.listDefinitions()
    const facts = declaredForwardFactsFromGoldenFixtures()

    // ⛔ THE FACTS ARE NOT VACUOUS. If the trailing-pad measurement came back
    // empty, every plot below would read `undecidable-hand-written`, the decided
    // count would be zero and this case would still be comparing two agreeing
    // numbers. It would be a measurement of nothing, reported as agreement.
    expect(Object.keys(facts).sort(),
      'the trailing-pad measurement over the golden fixtures found nothing (or found something new). ' +
      'It is the only fact this linter has about a hand-written compute; empty means every verdict ' +
      'below is "could not read it" and the agreement is with silence.',
    ).toEqual(['ichimoku.chikou'])

    const rows = lint.lintCatalogue(defs, { declaredForwardFacts: facts })
    const decided = rows.filter((r) => r.decidability === 'decided')
    const found = lint.disagreements(rows, defs)

    // 🔴 PRINTED IN FULL. The record carries the summary; the console carries
    // the row-by-row table, because a measurement nobody can see is a claim.
    // eslint-disable-next-line no-console
    console.log(
      '\n── REPAINT LINTER — THE FULL VERDICT TABLE ──\n' +
      rows.map((r) => `  ${r.address.padEnd(24)} ${String(r.decidability).padEnd(26)} ${r.mode === null ? '—' : r.mode}`).join('\n') +
      `\n  ${rows.length} plots across ${defs.length} definitions · ${decided.length} decided · ` +
      `${rows.length - decided.length} undecidable-hand-written\n` +
      (found.length
        ? found.map((d) => `  ⚠ DISAGREEMENT ${d.address}: shipped=${d.shipped} measured=${d.measured}\n     ${d.reasons.join('\n     ')}`).join('\n')
        : '  (no disagreement)') + '\n')

    /** The record's machine-readable block. ⛔ Parsed out of the REPO, because
     *  `.superpowers/` is gitignored and a number that lives only there does not
     *  exist. */
    const md = read(RECORD_REL)
    const blocks = md.split('```').filter((b) => b.trimStart().startsWith('LINTER-MEASUREMENT-V1'))
    expect(blocks.length,
      'the decision record must carry exactly ONE `LINTER-MEASUREMENT-V1` block. Zero means the ' +
      'measurement lives nowhere durable; two means the first one has stopped being the answer.',
    ).toBe(1)
    const recorded = blocks[0].trim().split('\n').map((l) => l.trim()).filter(Boolean)

    const measured = [
      'LINTER-MEASUREMENT-V1',
      `definitions ${defs.length}`,
      `plots ${rows.length}`,
      `decided ${decided.length}`,
      `undecidable-hand-written ${rows.length - decided.length}`,
      ...decided.map((r) => `verdict ${r.address} ${r.mode} forward=${r.forward}`).sort(),
      ...found.map((d) => `disagreement ${d.address} shipped=${d.shipped} measured=${d.measured}`).sort(),
    ]

    expect(recorded,
      '⛔ THE LINTER\'S VERDICT TABLE AND THE DECISION RECORD HAVE DIVERGED, AND THAT IS A FINDING ' +
      'FOR THE OWNER RATHER THAN A NUMBER TO EDIT. A new disagreement cannot arrive silently — and ' +
      'a recorded one cannot be quietly resolved either, because deleting the row here goes red in ' +
      'exactly the same way. ⚠️ The one response that is NOT available is editing `meta.repaint` to ' +
      'make the disagreement go away: that also fails the enumeration ledger\'s biconditional, which ' +
      'reads the same record\'s header. The failure direction is "the finding is loud".',
    ).toEqual(measured)
  })

  it('⭐ the linter states, per plot, whether it could decide AT ALL — so "it agreed" cannot be written over silence', () => {
    const defs = engineRegistry.listDefinitions()
    const rows = lint.lintCatalogue(defs, { declaredForwardFacts: declaredForwardFactsFromGoldenFixtures() })

    expect({
      // ⭐ OBLIGATION 9 — the output shape is `(defId, plotKey) → verdict`, and
      // it exists BEFORE any badge moves. That is the order the record demands:
      // the ruling is per plot, `meta.repaint` is per definition, and a ruling
      // that cannot be expressed cannot be applied without lying.
      everyRowIsAddressed: rows.every((r) => r.address === `${r.defId}.${r.plotKey}` && !!r.plotKey),
      // ⭐ OBLIGATION 8 — every lane is in scope of the MEASUREMENT. The natives
      // and the server definition cannot be ASSIGNED a badge (spec §11 forbids
      // static analysis of hand-written JS) and the linter says so per plot
      // instead of reporting a clean answer it did not earn.
      lanes: [...new Set(rows.map((r) => r.lane))].sort(),
      decidabilityTokens: [...new Set(rows.map((r) => r.decidability))].sort(),
      unknownDecidability: rows.filter((r) => !lint.DECIDABILITY.includes(r.decidability)).map((r) => r.address),
      // an undecided row carries NO mode. "No opinion" and "agrees" are different
      // sentences and conflating them is the one this obligation forbids.
      undecidedWithAMode: rows.filter((r) => r.decidability === 'undecidable-hand-written' && r.mode !== null)
        .map((r) => r.address),
      decidedWithoutAMode: rows.filter((r) => r.decidability === 'decided' && r.mode === null).map((r) => r.address),
      everyRowHasAReason: rows.every((r) => Array.isArray(r.reasons) && r.reasons.length > 0),
      // …and there IS a catalogue, so none of the above is a claim about zero rows.
      rowsExist: rows.length > 20,
    }).toEqual({
      everyRowIsAddressed: true,
      lanes: ['native', 'server'],
      decidabilityTokens: ['decided', 'undecidable-hand-written'],
      unknownDecidability: [],
      undecidedWithAMode: [],
      decidedWithoutAMode: [],
      everyRowHasAReason: true,
      rowsExist: true,
    })
  })

  it('and this task moved no badge — the catalogue still answers exactly what it answered before', () => {
    // ⛔ THE NON-MEASUREMENT ASSERTION. Task 7 measures a badge and changes none;
    // the record's §2 makes that a rule and this is the rule as a test. The
    // uniformity is asserted here as a MEASUREMENT of today, and
    // `indicatorCatalog.test.js` carries the per-id table that lets it stop being
    // uniform without anyone deleting a control.
    const defs = engineRegistry.listDefinitions()
    expect({
      badgeValues: [...new Set(defs.map((d) => d.meta.repaint))].sort(),
      plotsWithOwnBadge: defs.flatMap((d) => (d.plots || [])
        .filter((p) => p && Object.prototype.hasOwnProperty.call(p, 'repaint'))
        .map((p) => `${d.id}.${p.key}`)),
    }).toEqual({ badgeValues: ['non-repainting'], plotsWithOwnBadge: [] })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// THE BOUNDED BACKWARD OFFSET — the node that must not be able to repaint
// ═════════════════════════════════════════════════════════════════════════════

describe('the bounded backward offset, linted', () => {
  const treeOf = (src) => {
    const r = parseFormula(src)
    expect(r.ok, `${src}: ${r.error}`).toBe(true)
    return r.ast
  }

  it('🔴 AN OFFSET GROWS `back` AND LEAVES `forward` AT ZERO', () => {
    // ⭐ THE PROPERTY `closedTable.json::_no_offset` EXISTED TO PROTECT. Its
    // argument was that a general `close[n]` "makes a FORWARD reference
    // expressible in the first place". A BOUNDED, BACKWARD-ONLY, LITERAL offset
    // does not: the sign is refused at the parse door and the node shape has no
    // slot for an expression that could evaluate to one, so this arm cannot
    // produce a positive `forward` no matter what it is handed.
    for (const [src, back] of [
      ['close[1]', 1],
      ['close[0]', 0],
      ['close - close[1]', 1],
      ['sma(close[2], 20)', 22],
      ['sma(close, 20)[2]', 22],
      ['close[1] > close[3]', 3],
    ]) {
      const r = lint.astReach(treeOf(src))
      expect(r.forward, `${src} reached forward`).toBe(0)
      expect(r.back, `${src} back`).toBe(back)
      expect(lint.lintRepaint(treeOf(src)).mode, src).toBe('non-repainting')
    }
  })

  it('the two lookback readings AGREE — the linter and the evaluator', () => {
    // ⛔ TWO READINGS OF ONE DECLARATION. `lint.maxLookback` and
    // `interpret.maxLookback` are separate functions on purpose and must not be
    // allowed to disagree about a node type only one of them learned about.
    for (const src of ['close[1]', 'sma(close[2], 20)', 'sma(close, 20)[2]',
      'close[1] > close[3]', 'sma(ema(close[1], 5)[2], 20)']) {
      expect(lint.maxLookback(treeOf(src)), src)
        .toBe(interpretMaxLookback(treeOf(src)))
    }
  })

  it('a MALFORMED stored offset is UNKNOWN, which is the fail-closed answer', () => {
    // A stored tree never went through the parse door. `unknown` decides
    // `repaints` — the stalest claim — rather than a confident zero.
    for (const bad of [
      { type: 'offset', value: -26, args: [{ type: 'series', name: 'close' }] },
      { type: 'offset', value: 1.5, args: [{ type: 'series', name: 'close' }] },
      { type: 'offset', value: 1, args: [] },
    ]) {
      const r = lint.astReach(bad)
      expect(r.forward).toBe(lint.UNKNOWN)
      expect(lint.lintRepaint(bad).mode).toBe('repaints')
    }
  })

  it('⭐⭐ `ichimoku.chikou` IS STILL DECIDED — the reason the restriction existed', () => {
    // 🔴 THE GATE. `_no_offset` named `chikou[j] === close[j+26]` as the exact
    // construction the linter has to be able to decide. If adding a backward
    // offset had cost that, the feature would be wrong at any price. The verdict
    // still comes from ONE authority — the manifest's own `forward` declaration
    // — because the offset arm above contributes to `back` alone.
    const facts = { 'ichimoku.chikou': 26 }
    const defs = engineRegistry.listDefinitions()
    const rows = lint.lintCatalogue(defs, { declaredForwardFacts: facts })
    const chikou = rows.find((r) => r.address === 'ichimoku.chikou')
    expect(chikou, 'ichimoku.chikou is not in the catalogue').toBeTruthy()
    expect(chikou.decidability).toBe('decided')
    expect(chikou.mode).toBe('preview-repaints')
    expect(chikou.forward).toBe(26)
  })

  it('...and a forward reach still reads as one when the MANIFEST declares it', () => {
    // ⛔ THE CONTROL. Without it, "no offset tree repaints" could be true because
    // this linter had stopped being able to see a forward reach at all.
    const table = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        peek: { args: ['series'], lookback: -5, yields: 'num', sentence: 'peek {0}' },
      },
    }
    const tree = {
      type: 'offset',
      value: 2,
      args: [{ type: 'call', name: 'peek', args: [{ type: 'series', name: 'close' }] }],
    }
    const r = lint.astReach(tree, { table })
    expect(r.forward).toBe(5)
    expect(r.back).toBe(2)
    expect(lint.lintRepaint(tree, { table }).mode).toBe('preview-repaints')
  })
})

// ─── A MULTIPLIED WINDOW IS BOUNDABLE ───────────────────────────────────────
//
// ⚰️ MEASURED IN THE DEPLOYED BUILDER 2026-08-11, seconds after ADX shipped.
// `ADX14.14 > 25` read correctly, computed correctly, reported its 28-bar
// lookback correctly — and then wore "⚠️ Repaints — unanalysable: `adx` declares
// a window this linter cannot bound". False, and not cosmetic: `canSaveFormula`
// refuses `repaints` outright, so a correct indicator could not be saved.
//
// ⛔ THE LINTER HELD THE **FOURTH** HAND-WRITTEN COPY OF THE LOOKBACK GRAMMAR.
// Three others were found when `2*argN` landed; this one survived because no test
// had ever declared a function with a multiplied window AND asked the linter about
// it. The unit suite could not see it. The browser could.
describe('🔴 a `k*argN` window is bounded, not unanalysable', () => {
  const adx = (n = 14) => ({
    type: 'call',
    name: 'adx',
    args: [
      { type: 'series', name: 'high' },
      { type: 'series', name: 'low' },
      { type: 'series', name: 'close' },
      { type: 'num', value: n },
    ],
  })

  it('adx is NON-REPAINTING, and reads no future bar', () => {
    const v = lint.lintRepaint(adx())
    expect(v.mode, `adx was branded ${v.mode}: ${(v.reasons || []).join(' / ')}`)
      .toBe('non-repainting')
    expect(v.forward).toBe(0)
  })

  it('and the window it reports is the MULTIPLIED one', () => {
    // ⭐ 28, not 14 — the whole point. A linter that bounded it at `arg3` would
    // call it analysable and still be wrong about how far back it reaches.
    expect(lint.lintRepaint(adx(14)).back).toBe(28)
    expect(lint.lintRepaint(adx(7)).back).toBe(14)
  })

  it('⛔ THE CONTROL — an undeclared window is STILL unanalysable', () => {
    // Without this, a linter that returned 0 for everything it could not read
    // would pass both cases above and silently stop refusing real hazards.
    const bogus = { type: 'call', name: 'adx', args: [
      { type: 'series', name: 'high' },
      { type: 'series', name: 'low' },
      { type: 'series', name: 'close' },
      { type: 'series', name: 'close' },   // a SERIES where the period goes
    ] }
    expect(lint.lintRepaint(bogus).mode).not.toBe('non-repainting')
  })
})


describe('the clock, linted — the window comes from the MANIFEST, not from this file', () => {
  // ⛔ THESE RAILS EXIST BECAUSE THE BRANCH SHIPPED WITHOUT ONE. `astReach` gained
  // a clock arm with closed table v2 and no test in this file named a clock entry,
  // so deleting the arm kept every suite green —
  // `lesson_built_tested_green_and_unreachable`.

  it('every clock leaf is bounded by ITS OWN declared lookback', () => {
    const declared = TABLE.clock
    expect(Object.keys(declared).length).toBeGreaterThan(0)
    for (const [name, spec] of Object.entries(declared)) {
      const reach = lint.astReach({ type: 'series', name })
      expect(reach.back, `${name}: linter says ${reach.back}, manifest declares ${spec.lookback}`)
        .toBe(spec.lookback)
      expect(reach.forward, `${name} claims to read a later bar`).toBe(0)
      expect(reach.reasons, `${name} was unanalysable`).toEqual([])
    }
  })

  it('⭐ and at least one of them has a REAL window — or the rail above cannot tell a derived reach from a hardcoded zero', () => {
    // `sessionfirst` compares this bar's ET day against the PREVIOUS bar's, so it
    // is a function of two bars exactly as `change(close)` is. It declared
    // `lookback: 0` until 2026-08-26 and the linter hardcoded a matching zero —
    // two authorities agreeing on one false statement.
    const windowed = Object.entries(TABLE.clock).filter(([, s]) => s.lookback > 0)
    expect(windowed.map(([n]) => n)).toEqual(['sessionfirst'])
    expect(lint.maxLookback({ type: 'series', name: 'sessionfirst' })).toBe(1)
    // …and it agrees with the function that reads exactly the same history.
    expect(lint.maxLookback(parseFormula('change(close)').ast))
      .toBe(lint.maxLookback({ type: 'series', name: 'sessionfirst' }))
  })

  it('⛔ a PLANTED clock entry with a three-bar window is bounded at three — the derivation is real', () => {
    const table = { ...TABLE, clock: { ...TABLE.clock, zzPlantedWindow: { lookback: 3, yields: 'num', sentence: 'planted' } } }
    const reach = lint.astReach({ type: 'series', name: 'zzPlantedWindow' }, { table })
    expect([reach.back, reach.forward]).toEqual([3, 0])
    // THE CONTROL: without the plant the same name is unanalysable, so the line
    // above is measuring the manifest rather than a name this file knows.
    expect(lint.astReach({ type: 'series', name: 'zzPlantedWindow' }).reasons.length)
      .toBeGreaterThan(0)
  })
})

// --------------------------------------------------------------------------- //
// the `session` window, and the planted-`forward` rail the pivots will rest on
// --------------------------------------------------------------------------- //

describe('a declared window that names a SESSION, and one that reaches FORWARD', () => {
  const SER = { type: 'series', name: 'close' }
  const num = (v) => ({ type: 'num', value: v })
  const call = (name, ...args) => ({ type: 'call', name, args })

  /** A grammar the shipped manifest does not contain, merged onto the manifest
   *  itself — the corpus's own overlay idiom. ⛔ The shipped half is NEVER
   *  copied: a second full grammar here would be a second manifest. */
  const planted = (spec) => ({
    ...TABLE,
    functions: { ...TABLE.functions, zzPlanted: { yields: 'num', sentence: 'planted', ...spec } },
  })

  it('reads `session` as a NUMBER, not as unanalysable', () => {
    // ⛔ THE FAILURE THIS PREVENTS IS NOT HYPOTHETICAL. The narrow `argN` regex
    // read `2*arg3` as unanalysable and branded ADX `repaints` in production;
    // `canSaveFormula` refuses `repaints` outright. A lane that read `session`
    // the same way would do it to every session-anchored indicator.
    const table = planted({ args: ['series'], lookback: SESSION_LOOKBACK })
    const reach = lint.astReach(call('zzPlanted', SER), { table })
    expect([reach.back, reach.forward]).toEqual([SESSION_MAX_BARS, 0])
    expect(reach.reasons).toEqual([])
    expect(lint.modeFromReach(reach.forward)).toBe('non-repainting')
  })

  it('⛔ and the number is the manifest\'s, not this file\'s — the two lanes read one key', () => {
    expect(SESSION_MAX_BARS).toBe(TABLE.sessionMaxBars)
    expect(Number.isInteger(SESSION_MAX_BARS) && SESSION_MAX_BARS > 0).toBe(true)
  })

  it('the INTERPRETER\'s own reader resolves `session` to the same number', () => {
    // ⛔ THE MIRRORED HALF, RAILED IN ITS OWN LANE. `ownLookback` is what
    // `maxLookback` sums, and it is reachable from here only because it is
    // exported — its manifest is frozen at import, so a planted declaration
    // cannot arrive through `fnSpec`. Deleting its `session` branch must make
    // THIS lane red; asserting it through the linter would leave the branch
    // unproved on the side that actually fetches the bars.
    const node = call('zzPlanted', SER)
    expect(ownLookback(node, { args: ['series'], lookback: SESSION_LOOKBACK }))
      .toBe(SESSION_MAX_BARS)
    // ⛔ THE CONTROL: an unreadable declaration still refuses, so the line
    // above is not a reader that says yes to everything.
    expect(() => ownLookback(node, { args: ['series'], lookback: 'sessions' })).toThrow()
  })

  it('a `session` window is never POINTWISE — it may not be stepped one bar at a time', () => {
    // `isPointwise` is `lookback === 0`, and it decides whether a value may be
    // applied inside a recurrence step. A session-anchored value reads a whole
    // day, so it must never qualify — asked of the shipped reader rather than
    // trusted to `'session' !== 0`.
    expect(isPointwise({ args: ['series'], lookback: SESSION_LOOKBACK })).toBe(false)
    expect(isPointwise({ args: ['series'], lookback: 0 })).toBe(true)
  })

  it('⭐ the linter and the interpreter bound a session window at the SAME number', () => {
    // The two `maxLookback`s in this directory may not disagree — see the
    // agreement case above. This is that agreement on the one declaration
    // neither of them can reach the other's copy of.
    const table = planted({ args: ['series'], lookback: SESSION_LOOKBACK })
    expect(lint.maxLookback(call('zzPlanted', SER), { table })).toBe(SESSION_MAX_BARS)
    // ⚠️ The interpreter cannot be handed an overlay (its table is frozen at
    // import), so its half is asserted on the constant BOTH readers resolve to.
    expect(interpretMaxLookback({ type: 'series', name: 'close' })).toBe(0)
    expect(SESSION_MAX_BARS).toBe(TABLE.sessionMaxBars)
  })

  it('a session window is BACKWARD, so it never turns a clean tree into a repainting one', () => {
    const table = planted({ args: ['series'], lookback: SESSION_LOOKBACK })
    const tree = { type: 'op', name: '>', args: [call('zzPlanted', SER), SER] }
    expect(lint.lintRepaint(tree, { table }).mode).toBe('non-repainting')
  })

  // ⛔⛔ THE PLANTED-`forward` RAIL. `ichimokuChikou` already proves `forward:
  // "argN"` works — for ONE entry, whose argument is always 26. The pivot work
  // will declare `forward: "arg2"` with an argument a member types, so the claim
  // that has to hold is "a tree that reaches forward cannot pass as
  // non-repainting FOR ANY k", and that is what these rows measure.
  const FORWARD_TABLE = planted({ args: ['series', 'int'], lookback: 'arg1', forward: 'arg1' })

  it.each([[1], [3], [26], [400]])('a declared forward reach of %i decides preview-repaints', (k) => {
    const v = lint.lintRepaint(call('zzPlanted', SER, num(k)), { table: FORWARD_TABLE })
    expect(v.forward).toBe(k)
    expect(v.mode).toBe('preview-repaints')
  })

  it('⛔ THE NON-VACUITY CONTROL — the same entry with k = 0 is non-repainting', () => {
    // Without this row, a linter that answered `preview-repaints` for the mere
    // PRESENCE of a `forward` key would pass every row above.
    const v = lint.lintRepaint(call('zzPlanted', SER, num(0)), { table: FORWARD_TABLE })
    expect(v.forward).toBe(0)
    expect(v.mode).toBe('non-repainting')
  })

  it('a forward reach is not laundered by arithmetic around it', () => {
    const tree = { type: 'op', name: '>', args: [call('zzPlanted', SER, num(4)), SER] }
    const v = lint.lintRepaint(tree, { table: FORWARD_TABLE })
    expect([v.forward, v.mode]).toEqual([4, 'preview-repaints'])
  })

  it('⛔ nor by a SESSION lookback declared beside it — the one interaction of this task\'s two halves', () => {
    const table = planted({ args: ['series', 'int'], lookback: SESSION_LOOKBACK, forward: 'arg1' })
    const v = lint.lintRepaint(call('zzPlanted', SER, num(2)), { table })
    expect([v.back, v.forward, v.mode]).toEqual([SESSION_MAX_BARS, 2, 'preview-repaints'])
  })

  it('⛔ THE PLANT ITSELF IS LOAD-BEARING — without the overlay the same name is unanalysable', () => {
    // Same control the planted-clock case carries: proves every row above is
    // measuring the manifest rather than a name this file taught the linter.
    const bare = lint.lintRepaint(call('zzPlanted', SER, num(3)))
    expect(bare.mode).toBe('repaints')
    expect(bare.reasons.length).toBeGreaterThan(0)
  })
})
