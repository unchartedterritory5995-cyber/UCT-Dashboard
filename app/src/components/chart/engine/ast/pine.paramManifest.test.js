// 🎯 TRACK F (DEC-006, v1.1 2026-09-06) — Pine `input.int`/`input.float`/
// `input.bool` → an adjustable, server-protected parameter.
//
// ⭐⭐ THE MECHANISM, PROVEN HERE, NOT ASSUMED: `resolveInput` still folds
// every eligible input to a plain literal exactly as it always has (a length
// argument NEVER becomes an identifier — `_no_offset`/`windowLiteral` stay
// satisfied at every step, unlike `declareInputs`'s `series`-node mechanism
// a few sections up, which is why THAT one refuses window-bound names and
// this one does not need to). The only addition is a non-enumerable
// `__uctParamId` tag on whichever node the fold returns, opt-in via
// `translatePine(src, { paramManifest: true })`, off by default. This file
// and `pineParamManifest.test.js` (builder-layer astPath discovery) are the
// two halves of the translator's own proof; `tests/test_param_manifest.py`
// (Python) is the server-side enforcement proof; the two meet at the
// `{treeIndex, astPath}` locator shape both sides independently agree on.
//
// ⭐ VERIFIED BY DIRECT PROBE BEFORE THIS FILE WAS WRITTEN, NOT ASSUMED: this
// translator does not constant-fold pure-literal arithmetic, so the tag
// survives arbitrary structural wrapping (`close + length * 2` keeps the
// tag on the inner `14`, not just on a bare `sma(close, length)` argument).
// See `pineParamManifest.js`'s own header for what CAN still lose it and why
// that is always safe, never wrong.

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { FOLDED_INPUT_TYPES } from '../../builder/builderInputs.js'
import { buildParamManifest } from '../../builder/pineParamManifest.js'

const translate = (src, opts) => translatePine(src, opts)

function tree(src, opts = {}) {
  const out = translate(src, { ...opts, paramManifest: true })
  expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
  return { out, ast: out.outputs[out.selected].ast }
}

// --------------------------------------------------------------------------- //
// eligibility — pinned against builderInputs.js so the two never drift
// --------------------------------------------------------------------------- //

describe('Track F eligibility never drifts from builderInputs.js', () => {
  it('⛔⛔ the same three kinds, named the same way, in both files', () => {
    // `PARAM_MANIFEST_ELIGIBLE_KINDS` is not exported (module-private in
    // pine.js) — asserted indirectly, by kind, below. This test pins the
    // OTHER direction: every kind `FOLDED_INPUT_TYPES` names is one this
    // file's own eligibility tests exercise, so a kind added to one without
    // the other is caught by a MISSING test case, not just a code review.
    expect(Object.keys(FOLDED_INPUT_TYPES).sort())
      .toEqual(['input', 'input.bool', 'input.float', 'input.int'].sort())
  })
})

// --------------------------------------------------------------------------- //
// what becomes an adjustable parameter
// --------------------------------------------------------------------------- //

describe('an eligible input.int/input.float mints a logical parameter', () => {
  it('⭐ a window-bound length is eligible — the case declareInputs refuses', () => {
    const { out, ast } = tree(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(sma(close, length))
`)
    expect(out.inputParams).toEqual([{
      id: '__uct_param_1', sourceName: 'length', title: 'Length', type: 'int',
      default: 14, min: null, max: null, step: null, options: null,
    }])
    const manifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
    expect(manifest).toEqual({
      __uct_param_1: {
        sourceName: 'length', title: 'Length', type: 'int', default: 14,
        min: null, max: null, step: null, options: null,
        locators: [{ treeIndex: null, astPath: ['args', 1] }],
      },
    })
    // ⛔ THE TREE ITSELF STILL HOLDS A PLAIN LITERAL — never an identifier.
    expect(ast.args[1]).toEqual({ type: 'num', value: 14 })
  })

  it('⭐ min/max/step all survive, exactly as declared', () => {
    const { out } = tree(`//@version=5
indicator("t")
length = input.int(14, "Length", minval=1, maxval=200, step=1)
plot(sma(close, length))
`)
    expect(out.inputParams[0]).toMatchObject({ min: 1, max: 200, step: 1 })
  })

  it('⭐ a bare v3/v4 `input(...)` decides int vs float by the default\'s own shape', () => {
    const intCase = tree(`//@version=5
indicator("t")
length = input(title="Length", type=integer, defval=14)
plot(sma(close, length))
`)
    expect(intCase.out.inputParams[0]).toMatchObject({ type: 'int', default: 14 })

    const floatCase = tree(`//@version=5
indicator("t")
mult = input(title="Mult", defval=2.5)
plot(close * mult)
`)
    expect(floatCase.out.inputParams[0]).toMatchObject({ type: 'float', default: 2.5 })
  })

  it('⭐ arithmetic wrapping does not lose the tag — no constant-fold pass exists', () => {
    const { out, ast } = tree(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(close + length * 2)
`)
    const manifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
    expect(manifest.__uct_param_1.locators).toEqual([
      { treeIndex: null, astPath: ['args', 1, 'args', 0] },
    ])
  })

  it('⭐⭐ Track F v1.1 (2026-09-06): a window-bound `input.bool` is eligible too — the SAME case `length` proves above, one type over', () => {
    // ⭐ THE EXACT SHAPE VERIFIED LIVE BEFORE THIS TEST WAS WRITTEN: a boolean
    // used AS a window/length argument is excluded from `declareInputs` for
    // the identical reason `length` is (both translation passes fold it to
    // the SAME literal at the SAME position), so the two passes agree and
    // the manifest's locator lands on real, saved, live data — never a
    // synthetic-only fixture. Real corpus evidence for the PROMOTION itself
    // (an ORDINARY, non-window-bound `input.bool` gate) lives in
    // `18-minervini-trend-template.pine`/`27-support-resistance-channels
    // .pine`, closed by `builderInputs.js`'s OWN eligibility (a SEPARATE,
    // parity-linked mechanism this file's first test above pins) — this
    // fixture proves TRACK F'S OWN manifest specifically, mirroring
    // `length`'s pattern one section up because that is the ONLY shape
    // Track F's non-`declareInputs` pass can ever attach a boolean through
    // (see this file's own "no locator survives a collapsed conditional"
    // case below for the shape that does NOT attach, and why).
    const { out, ast } = tree(`//@version=5
indicator("t")
useLong = input.bool(true, "Use Long Length")
plot(sma(close, useLong))
`)
    expect(out.inputParams).toEqual([{
      id: '__uct_param_1', sourceName: 'useLong', title: 'Use Long Length', type: 'bool',
      default: 1, min: null, max: null, step: null, options: null,
    }])
    const manifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
    expect(manifest).toEqual({
      __uct_param_1: {
        sourceName: 'useLong', title: 'Use Long Length', type: 'bool', default: 1,
        min: null, max: null, step: null, options: null,
        locators: [{ treeIndex: null, astPath: ['args', 1] }],
      },
    })
    expect(ast.args[1]).toEqual({ type: 'num', value: 1 })
  })

  it('⭐ `input.bool(false, …)` folds to 0, not 1 — the default is read, not assumed', () => {
    const { out } = tree(`//@version=5
indicator("t")
useLong = input.bool(false, "Use Long Length")
plot(sma(close, useLong))
`)
    expect(out.inputParams[0]).toMatchObject({ type: 'bool', default: 0 })
  })

  it('⭐⭐ one Pine input feeding two output trees mints ONE id, TWO locators (ADR V2.2 §1)', () => {
    // ⚠️ THE SECOND PLOT MUST READ A BAR. `plot(length * 2)` alone is a pure
    // constant (no series reference at all) and is correctly marked `hidden`
    // ("a tree that reads no bar is scaffolding too" — see `translatePine`'s
    // own `readsBars`/`flat` comment) — a test-fixture bug caught here, not a
    // real one: `close + length * 2` reads `close`, so it is a genuine second
    // output, exactly like the real "one length feeding two plots" shape.
    const out = translate(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(sma(close, length))
plot(close + length * 2)
`, { paramManifest: true })
    expect(out.inputParams).toHaveLength(1)
    const kept = out.outputs
      .filter((o) => o.ast && !o.hidden)
      .map((o, i) => ({ treeIndex: i === 0 ? 'scan' : 'plot2', ast: o.ast }))
    expect(kept).toHaveLength(2)
    const manifest = buildParamManifest(out.inputParams, kept)
    expect(manifest.__uct_param_1.locators).toEqual(
      expect.arrayContaining([
        { treeIndex: 'scan', astPath: ['args', 1] },
        { treeIndex: 'plot2', astPath: ['args', 1, 'args', 0] },
      ]),
    )
    expect(manifest.__uct_param_1.locators).toHaveLength(2)
  })
})

// --------------------------------------------------------------------------- //
// what stays out of v1 scope — the owner's own exclusion list
// --------------------------------------------------------------------------- //

describe('excluded kinds mint nothing, by name, exactly as the owner scoped v1', () => {
  it('⛔ a CONDITIONALLY-used input.bool is DECLARED-eligible but attaches NO locator — the collapse, not the kind, is why', () => {
    // ⚰️ THIS TEST USED TO ASSERT `out.inputParams` WAS EMPTY, back when
    // `bool` was excluded outright (pre Track F v1.1, 2026-09-06). It is
    // NOT empty now — `showIt` is eligible and IS recorded here, exactly
    // like `useLong` two sections up. What is still true, and is the actual
    // point this test proves, is that `showIt ? close : 0`'s CONDITION is
    // compile-time decidable (a `true` literal), so the whole ternary
    // constant-folds to its taken branch and `showIt`'s own tagged node is
    // pruned along with the branch that never runs — `buildParamManifest`
    // then finds no surviving locator anywhere in the kept tree. This is
    // the SAME reason a plain boolean toggle (the corpus's own, ordinary
    // "only show this if the member turned it on" idiom) can be READBACK-
    // resolvable via `builderInputs.js`'s eligibility (this file's first
    // test pins the parity) while STILL never becoming a Track F slider —
    // the two mechanisms solve different problems, and this shape is
    // exactly the one Track F's own non-`declareInputs` pass cannot reach,
    // regardless of `bool`'s own eligibility.
    const { out, ast } = tree(`//@version=5
indicator("t")
showIt = input.bool(true, "Show")
plot(showIt ? close : 0)
`)
    expect(out.inputParams).toEqual([{
      id: '__uct_param_1', sourceName: 'showIt', title: 'Show', type: 'bool',
      default: 1, min: null, max: null, step: null, options: null,
    }])
    const manifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
    expect(manifest).toEqual({})
  })

  it('⛔ input.string / options-enum inputs never become a parameter', () => {
    // The real RISK-013 fixture's own shape (tests/fixtures/pine/07-rsi.pine
    // line 10): `srcInput = input(title="Source", defval="close", options=[...])`.
    const { out } = tree(`//@version=5
indicator("t")
srcInput = input(title="Source", defval="close", options=["open", "close"])
plot(srcInput == "close" ? close : open)
`)
    expect(out.inputParams).toEqual([])
  })

  it('⛔ input.source never becomes a parameter (folds to a column, not a number)', () => {
    const { out } = tree(`//@version=5
indicator("t")
src = input.source(hl2, "Source")
plot(src)
`)
    expect(out.inputParams).toEqual([])
  })
})

// --------------------------------------------------------------------------- //
// byte-identical for every existing caller — the opt-in contract
// --------------------------------------------------------------------------- //

describe('opt-in, off by default — every existing caller is untouched', () => {
  const src = `//@version=5
indicator("t")
length = input.int(14, "Length")
plot(sma(close, length))
`

  it('⛔⛔ no option at all → inputParams is empty and no node is tagged', () => {
    const out = translatePine(src)
    expect(out.inputParams).toEqual([])
    const ast = out.outputs[out.selected].ast
    expect(ast.args[1].__uctParamId).toBeUndefined()
  })

  it('⛔ the emitted AST is byte-for-byte identical with the option on or off', () => {
    const off = translatePine(src)
    const on = translatePine(src, { paramManifest: true })
    // ⭐ `toEqual` compares structurally over OWN ENUMERABLE keys, so a
    // non-enumerable `__uctParamId` on the `on` run's tree does not fail
    // this — which is the point being asserted: the CANONICAL tree the
    // engine hashes and the server ever sees is unaffected either way.
    expect(on.outputs[on.selected].ast).toEqual(off.outputs[off.selected].ast)
    expect(JSON.stringify(on.outputs[on.selected].ast)).toBe(JSON.stringify(off.outputs[off.selected].ast))
  })
})

// --------------------------------------------------------------------------- //
// buildParamManifest in isolation — the "nowhere to point" rule
// --------------------------------------------------------------------------- //

describe('buildParamManifest never advertises a control with nowhere to point', () => {
  it('⛔ an id absent from every kept tree is dropped entirely, not shown detached', () => {
    const inputParams = [{
      id: '__uct_param_1', sourceName: 'len', title: 'Len', type: 'int',
      default: 14, min: null, max: null, step: null, options: null,
    }]
    const manifest = buildParamManifest(inputParams, [
      { treeIndex: null, ast: { type: 'num', value: 99 } }, // no tag anywhere
    ])
    expect(manifest).toEqual({})
  })

  it('⭐ one surviving locator out of two candidate trees is still ATTACHED-shaped', () => {
    const tagged = { type: 'num', value: 14 }
    Object.defineProperty(tagged, '__uctParamId', { value: '__uct_param_1', enumerable: false })
    const inputParams = [{
      id: '__uct_param_1', sourceName: 'len', title: 'Len', type: 'int',
      default: 14, min: 1, max: 200, step: 1, options: null,
    }]
    const manifest = buildParamManifest(inputParams, [
      { treeIndex: 'a', ast: { type: 'num', value: 99 } },
      { treeIndex: 'b', ast: { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, tagged] } },
    ])
    expect(manifest.__uct_param_1.locators).toEqual([{ treeIndex: 'b', astPath: ['args', 1] }])
  })
})
