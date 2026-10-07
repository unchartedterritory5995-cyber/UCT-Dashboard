// P3 truth matrix, slice "vocab" — CONVERSATION CAN NOW AUTHOR WHAT THE ENGINE
// AND THE MANUAL BUILDER ALREADY DRAW (no model calls anywhere in this file).
//
//   1. LEVELS      `set_levels {values}` — the Builder's Levels box (one hlines guide)
//   2. LINE STYLE  `set_style {lineStyle}` — and a STORED dashed plot is no longer
//                  `authoring:unrepresentable`
//   3. FILL        `set_fill {output, with, color?, opacity?}` / `remove_fill`
//
// Every case states ASKED / CLAIMED / DID and its outcome class. The "model" is
// a hand-written patch under `builder/authoring/patchSchema.json` (still
// uct.authoring.patch/1 — the ops are additive). Builder-equivalence: each
// result deep-equals `buildDefinition` over the rows a member would hold.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula } from '../ast/parse'
import { validateUserDefinitions } from '../nativeRegistry'
import { PLOT_LINE_STYLES } from '../defSchema'
import { buildDefinition } from '../../builder/BuilderSheet'
import { evaluateFormula } from '../../builder/FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'
import { preservePresentation, restorableRowFields } from '../../builder/presentationPreserve'
import {
  applyPatch, applyTurn, undo, newAuthoringState, openAuthoringState, prepareSave, compactView, readback,
  validatePatchShape, modelOf, fidelityResidual, OP_NAMES, PATCH_LIMITS, PATCH_SCHEMA, vocabularyLines,
} from '../../builder/authoring'
import { HANDLED_OPS } from '../../builder/authoring/applyPatch'
import { diffPaths, stableJson } from '../../builder/authoring/model'

const C = 'uct.authoring.patch/1'
const env = (revision, ops, extra = {}) => ({ contract: C, baseRevision: revision, ops, ...extra })
const DEF_ID = 'u_00000000p3v1'
const FIXTURE_PATH = path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/ast/p3_vocab_docs.json')
const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

/** A row exactly as the Builder holds one after `evaluateFormula` settles. */
function builderRow(key, text, extra = {}) {
  const ev = evaluateFormula(text, BUILDER_INPUT_SCOPE)
  if (!ev.ok) throw new Error(`${text}: ${ev.error}`)
  return { key, label: '', style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
    hidden: false, source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback, ...extra }
}
/** What `BuilderSheet.save()` would POST for these rows (its `documentFor`). */
function builderSave({ name, rows, scanPlot = null, placement = null, levels = null, defId = DEF_ID }) {
  const r0 = rows[0]
  const plain = rows.length === 1 && !placement && !(levels && levels.length) && r0.style === 'line' && r0.key === 'value'
    && !r0.lineStyle && !r0.fill
  return buildDefinition({
    defId, version: 1, name, source: r0.source, ast: r0.ast, mode: r0.mode, readback: r0.readback,
    inputs: [...BUILDER_INPUTS],
    ...(plain ? {} : { plots: rows, scanPlot: scanPlot || r0.key, placement, levels: levels && levels.length ? levels : null }),
  })
}

const rsiDoc = () => builderSave({ name: 'My RSI', rows: [builderRow('value', 'rsi(close, 14)')] })
const twoEmaRows = (fastExtra = {}, slowExtra = {}) => [
  builderRow('fast', 'ema(close, 10)', fastExtra), builderRow('slow', 'ema(close, 30)', slowExtra)]
const twoEmaDoc = (fastExtra, slowExtra) => builderSave({ name: 'Two EMAs', rows: twoEmaRows(fastExtra, slowExtra) })

// ═══ 0 — the contract ═══════════════════════════════════════════════════════

describe('P3 vocab — the contract stays uct.authoring.patch/1, additively', () => {
  it('ASKED can conversation author levels / line style / fill? CLAIMED three new ops + one set_style field, engine and schema agree, the view advertises them · DID (EXACT)', () => {
    expect(C).toBe('uct.authoring.patch/1')
    for (const op of ['set_levels', 'set_fill', 'remove_fill']) {
      expect(OP_NAMES).toContain(op)
      expect(HANDLED_OPS).toContain(op)
    }
    expect([...OP_NAMES].sort()).toEqual([...HANDLED_OPS].sort())
    const cap = compactView(null, {}).capabilities
    expect(cap.ops).toEqual(OP_NAMES)
    expect(cap.lineStyles).toEqual(PLOT_LINE_STYLES)
    expect(cap.maxLevels).toBe(PATCH_LIMITS.maxLevels)
    // the schema's lineStyle enum IS defSchema's vocabulary — no second list
    expect(PATCH_SCHEMA.$defs.op_set_style.properties.lineStyle.enum).toEqual([...PLOT_LINE_STYLES])
    expect(PATCH_SCHEMA.$defs.op_set_levels.properties.values.maxItems).toBe(PATCH_LIMITS.maxLevels)
  })

  it('an OLD envelope (no new op, no new field) validates exactly as before (EXACT)', () => {
    expect(validatePatchShape(env(0, [{ op: 'set_style', output: 'value', color: '#2962FF', width: 2 }])).ok).toBe(true)
    expect(validatePatchShape(env(0, [{ op: 'set_style', output: 'value' }])).ok).toBe(false) // still "names nothing"
  })
})

// ═══ 1 — LEVELS ═════════════════════════════════════════════════════════════

describe('P3 vocab 1 — levels (horizontal lines)', () => {
  it('1a ASKED "add lines at 70 and 30"; CLAIMED a 70/30 guide, maths untouched; DID: the Builder\'s own Levels document (EXACT)', () => {
    const d = deepFreeze(rsiDoc())
    const r = applyPatch(d, env(0, [{ op: 'set_levels', values: [70, 30] }]))
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    // ⭐ ONE DEFINITION ARCHITECTURE — the manual Builder with "70, 30" in Levels
    expect(stableJson(r.definition)).toBe(stableJson(builderSave({ name: 'My RSI', rows: [builderRow('value', 'rsi(close, 14)')], levels: [70, 30] })))
    const guide = r.definition.plots.find((p) => p.style === 'hlines')
    expect(guide).toMatchObject({ key: 'levels', levels: [70, 30] })
    expect(stableJson(r.definition.compute.ast)).toBe(stableJson(d.compute.ast))
    expect(validateUserDefinitions([r.definition]).errors).toEqual([])
    expect(readback(r.definition).lines).toContain('Look: horizontal lines at 70, 30')
    expect(readback(r.definition).outputs.map((o) => o.key)).toEqual(['value']) // a guide is not an output
    expect(r.changes).toContainEqual(expect.objectContaining({ kind: 'levels-set', from: [], to: [70, 30] }))
  })

  it('1b ASKED "remove the lines"; DID: values [] drops the guide and the document is byte-identical to the one before (EXACT)', () => {
    const d = deepFreeze(rsiDoc())
    const withLevels = applyPatch(d, env(0, [{ op: 'set_levels', values: [70, 30] }])).definition
    const r = applyPatch(withLevels, env(1, [{ op: 'set_levels', values: [] }]))
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.definition)).toBe(JSON.stringify(d))
    expect(r.changes[0]).toMatchObject({ kind: 'levels-removed', from: [70, 30] })
    // no guide and asked for none → unchanged, not an error
    const same = applyPatch(d, env(0, [{ op: 'set_levels', values: [] }]))
    expect(same.ok).toBe(true)
    expect(JSON.stringify(same.definition)).toBe(JSON.stringify(d))
  })

  it('1c ASKED "make the lines 80 and 20" on a STORED Builder doc with levels; DID: only the guide moves, presentation byte-identical (EXACT)', () => {
    const rows = twoEmaRows({ colorMode: 'column:slow', colorUp: '#00ff00', colorDown: '#ff0000' })
    const d = deepFreeze(builderSave({ name: 'Two EMAs', rows, placement: { target: 'price' }, levels: [70, 30] }))
    expect(fidelityResidual(d, modelOf(d))).toEqual([])
    const r = applyPatch(d, env(0, [{ op: 'set_levels', values: [80, 20] }]))
    expect(r.ok).toBe(true)
    expect(diffPaths(d, r.definition)).toEqual(['plots[levels].levels'])
    for (const k of ['compute', 'inputs', 'placement', 'meta']) expect(JSON.stringify(r.definition[k])).toBe(JSON.stringify(d[k]))
  })

  it('1d ASKED invalid levels; CLAIMED refused WHOLE, nothing moves; DID: a string, nine levels, a bad op beside a good one — same object back (REFUSAL)', () => {
    const d = deepFreeze(rsiDoc())
    const cases = [
      [[{ op: 'set_levels', values: ['70'] }], 'schema:type'],
      [[{ op: 'set_levels', values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }], 'schema:items'],
      [[{ op: 'set_levels', values: [70] }, { op: 'set_style', output: 'value', lineStyle: 'wavy' }], 'schema:enum'],
      [[{ op: 'set_levels', values: [70] }, { op: 'set_fill', output: 'value', with: 'nope' }], 'output:unknown'],
    ]
    for (const [ops, code] of cases) {
      const r = applyPatch(d, env(0, ops))
      expect(r.ok, code).toBe(false)
      expect(r.definition).toBe(d)
      expect(r.errors.map((e) => e.code)).toContain(code)
    }
    // NaN/Infinity cannot even cross JSON; the walker refuses them by type too
    expect(applyPatch(d, env(0, [{ op: 'set_levels', values: [Number.NaN] }])).errors[0].code).toBe('schema:type')
  })

  it('1e ASKED levels before any indicator exists; DID: refused, nothing created (REFUSAL)', () => {
    const r = applyPatch(null, env(0, [{ op: 'set_levels', values: [70] }]))
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('definition:none')
  })
})

// ═══ 2 — LINE STYLE ═════════════════════════════════════════════════════════

describe('P3 vocab 2 — line style (dashed / dotted)', () => {
  it('2a ASKED "make the slow line dashed"; CLAIMED only its look; DID: plots[slow].lineStyle, maths + every other plot byte-identical, Builder-equal (EXACT)', () => {
    const d = deepFreeze(twoEmaDoc())
    const r = applyPatch(d, env(0, [{ op: 'set_style', output: 'slow', lineStyle: 'dashed' }]))
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(diffPaths(d, r.definition)).toEqual(['plots[slow].lineStyle'])
    expect(stableJson(r.definition)).toBe(stableJson(twoEmaDoc({}, { lineStyle: 'dashed' })))
    expect(validateUserDefinitions([r.definition]).errors).toEqual([])
    expect(readback(r.definition).lines).toContain('Look: slow: drawn dashed')
    expect(compactView(r.definition, { revision: 1 }).definition.outputs.find((o) => o.key === 'slow').presentation.lineStyle).toBe('dashed')
    // back to solid = NO field: byte-identical to the undashed document
    const back = applyPatch(r.definition, env(1, [{ op: 'set_style', output: 'slow', lineStyle: 'solid' }]))
    expect(JSON.stringify(back.definition)).toBe(JSON.stringify(d))
  })

  it('2b ASKED "dotted" on a single plain plot; DID: leaves the schema-1 body for the v2 one the Builder writes for that row (EXACT)', () => {
    const d = deepFreeze(rsiDoc())
    const r = applyPatch(d, env(0, [{ op: 'set_style', output: 'value', lineStyle: 'dotted' }]))
    expect(r.ok).toBe(true)
    expect(stableJson(r.definition)).toBe(stableJson(builderSave({ name: 'My RSI', rows: [builderRow('value', 'rsi(close, 14)', { lineStyle: 'dotted' })] })))
    expect(r.definition.plots[0].lineStyle).toBe('dotted')
    expect(stableJson(r.definition.compute.ast)).toBe(stableJson(d.compute.ast))
    expect(validateUserDefinitions([r.definition]).errors).toEqual([])
  })

  it('2c ASKED "dashed" on a histogram / markers; CLAIMED no line to dash; DID: refused whole, with the op before it (REFUSAL)', () => {
    const d = deepFreeze(twoEmaDoc({}, { style: 'histogram' }))
    const r = applyPatch(d, env(0, [{ op: 'set_levels', values: [0] }, { op: 'set_style', output: 'slow', lineStyle: 'dashed' }]))
    expect(r.ok).toBe(false)
    expect(r.definition).toBe(d)
    expect(r.errors[0]).toMatchObject({ op: 1, code: 'style:line-style-inert' })
    expect(r.wouldApplyAlone).toEqual([0])
    // in the same op that makes it a line, it is fine
    const ok = applyPatch(d, env(0, [{ op: 'set_style', output: 'slow', style: 'line', lineStyle: 'dashed' }]))
    expect(ok.ok).toBe(true)
    // a line style kept on a plot drawn another way is never CLAIMED by the readback
    const hist = applyPatch(ok.definition, env(1, [{ op: 'set_style', output: 'slow', style: 'histogram' }]))
    expect(hist.ok).toBe(true)
    expect(readback(hist.definition).lines.some((l) => /dashed/.test(l))).toBe(false)
  })

  it('2d ⭐ ASKED edit a STORED dashed definition; BEFORE: authoring:unrepresentable (plots[x].lineStyle); DID: it opens, edits, saves, reopens round-trip (EXACT)', () => {
    // The stored document as the MANUAL Builder writes it: rows without a line
    // style, the stored one carried by `preservePresentation` (appended last).
    const prior = twoEmaDoc({}, { lineStyle: 'dashed' })
    const manual = preservePresentation(twoEmaDoc(), prior).doc
    expect(manual.plots.find((p) => p.key === 'slow').lineStyle).toBe('dashed')
    const stored = deepFreeze({ ...manual, meta: { ...manual.meta, semantics: 2 } })
    expect(fidelityResidual(stored, modelOf(stored))).toEqual([])

    let s = openAuthoringState(stored, { defId: DEF_ID, version: 1, lineage: 'auth_000000p3vocab' })
    const t = applyTurn(s, env(s.revision, [{ op: 'set_slot', slot: 'fast#1', value: 12 }]))
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    s = t.state
    expect(s.working.plots.find((p) => p.key === 'slow').lineStyle).toBe('dashed')
    expect(JSON.stringify(s.working.plots)).toBe(JSON.stringify(stored.plots)) // presentation byte-identical
    const saved = prepareSave(s)
    expect(saved.errors).toEqual([])
    expect(saved.doc.version).toBe(2)
    // reopen the saved row: still representable, and a no-op patch round-trips identically
    const reopened = openAuthoringState(saved.doc, { defId: DEF_ID, version: 2 })
    expect(fidelityResidual(saved.doc, modelOf(saved.doc))).toEqual([])
    const again = applyPatch(reopened.working, env(0, [{ op: 'set_placement', target: 'pane' }]))
    expect(again.ok).toBe(true)
    expect(stableJson(again.definition)).toBe(stableJson(saved.doc))
    // the manual Builder's reopen of the conversational save: same document back
    const manualAgain = preservePresentation(twoEmaDoc({}, {}), saved.doc).doc
    expect(manualAgain.plots.find((p) => p.key === 'slow').lineStyle).toBe('dashed')
  })

  it('2e the manual sheet is unchanged: its reopen does NOT restore lineStyle into the row (preservePresentation still carries it) (EXACT)', () => {
    expect(restorableRowFields({ key: 'v', style: 'line', lineStyle: 'dashed' })).toEqual({})
    // and a row WITHOUT a line style builds exactly as before (no field)
    expect(twoEmaDoc().plots.every((p) => !('lineStyle' in p) || p.key === 'levels')).toBe(true)
  })
})

// ═══ 3 — FILL ═══════════════════════════════════════════════════════════════

describe('P3 vocab 3 — fill between two outputs', () => {
  it('3a ASKED "shade between the two EMAs in teal"; CLAIMED a band on fast→slow; DID: plots[fast].fill/fillColor/fillOpacity, Builder-equal, maths byte-identical (EXACT)', () => {
    const d = deepFreeze(twoEmaDoc())
    const r = applyPatch(d, env(0, [{ op: 'set_fill', output: 'fast', with: 'slow', color: '#26a69a', opacity: 0.2 }]))
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(diffPaths(d, r.definition).sort()).toEqual(['plots[fast].fill', 'plots[fast].fillColor', 'plots[fast].fillOpacity'])
    expect(stableJson(r.definition)).toBe(stableJson(twoEmaDoc({ fill: { with: 'slow' }, fillColor: '#26a69a', fillOpacity: 0.2 })))
    expect(JSON.stringify(r.definition.compute)).toBe(JSON.stringify(d.compute))
    expect(validateUserDefinitions([r.definition]).errors).toEqual([])
    expect(readback(r.definition).lines).toContain('Look: area between Two EMAs and slow shaded, colour #26a69a, 20% opaque')
    expect(compactView(r.definition, { revision: 1 }).definition.outputs[0].presentation.fill)
      .toEqual({ with: 'slow', color: '#26a69a', opacity: 0.2 })
  })

  it('3b ASKED "fill between them" with no colour; DID: {with} only, the readback says its own colour (EXACT)', () => {
    const r = applyPatch(deepFreeze(twoEmaDoc()), env(0, [{ op: 'set_fill', output: 'fast', with: 'slow' }]))
    expect(r.definition.plots[0].fill).toEqual({ with: 'slow' })
    expect('fillColor' in r.definition.plots[0]).toBe(false)
    expect(readback(r.definition).lines).toContain('Look: area between Two EMAs and slow shaded in its own colour')
  })

  it('3c ASKED "remove the shading"; DID: byte-identical to the unfilled document (EXACT)', () => {
    const d = deepFreeze(twoEmaDoc())
    const filled = applyPatch(d, env(0, [{ op: 'set_fill', output: 'fast', with: 'slow', color: '#26a69a' }])).definition
    const r = applyPatch(filled, env(1, [{ op: 'remove_fill', output: 'fast' }]))
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.definition)).toBe(JSON.stringify(d))
    expect(applyPatch(d, env(0, [{ op: 'remove_fill', output: 'fast' }])).errors[0].code).toBe('fill:none')
  })

  it('3d ASKED fills that have no honest area; CLAIMED refused, nothing moves; DID: a yes/no edge, itself, an unknown output, a reverse duplicate, an edge turned yes/no later (REFUSAL)', () => {
    const cond = deepFreeze(builderSave({ name: 'Mixed', rows: [builderRow('fast', 'ema(close, 10)'), builderRow('up', 'close > ema(close, 10)')] }))
    const bad = (d, ops, code, revision = 0) => {
      const r = applyPatch(d, env(revision, ops))
      expect(r.ok, code).toBe(false)
      expect(r.definition).toBe(d)
      expect(r.errors.map((e) => e.code)).toContain(code)
    }
    bad(cond, [{ op: 'set_fill', output: 'fast', with: 'up' }], 'fill:not-series')
    bad(cond, [{ op: 'set_fill', output: 'up', with: 'fast' }], 'fill:not-series')
    const d = deepFreeze(twoEmaDoc())
    bad(d, [{ op: 'set_fill', output: 'fast', with: 'fast' }], 'fill:self')
    bad(d, [{ op: 'set_fill', output: 'fast', with: 'nope' }], 'output:unknown')
    const filled = deepFreeze(applyPatch(d, env(0, [{ op: 'set_fill', output: 'fast', with: 'slow' }])).definition)
    bad(filled, [{ op: 'set_fill', output: 'slow', with: 'fast' }], 'fill:duplicate', 1)
    // an edge turned into a yes/no by a LATER maths edit is refused too (the band would shade 0..1)
    bad(filled, [{ op: 'set_output_tree', output: 'slow', tree: P('close > ema(close, 30)') }], 'fill:not-series', 1)
    // removing a band's other edge is refused by the existing rule
    bad(filled, [{ op: 'remove_output', output: 'slow' }], 'output:referenced', 1)
  })

  it('3e ASKED to overwrite / remove an IMPORTED conditional band; DID: refused, the import is kept (REFUSAL)', () => {
    const d = deepFreeze(builderSave({ name: 'Imported band', rows: [
      builderRow('fast', 'ema(close, 10)', { fill: { with: 'slow', colorMode: 'column:up', colorUp: '#00ff00', colorDown: '#ff0000' } }),
      builderRow('slow', 'ema(close, 30)'),
      builderRow('up', 'ema(close, 10) > ema(close, 30)', { hidden: true }),
    ] }))
    expect(fidelityResidual(d, modelOf(d))).toEqual([])
    for (const op of [{ op: 'set_fill', output: 'fast', with: 'slow' }, { op: 'remove_fill', output: 'fast' }]) {
      const r = applyPatch(d, env(0, [op]))
      expect(r.errors[0].code).toBe('fill:foreign')
      expect(r.definition).toBe(d)
    }
    expect(readback(d).lines).toEqual(expect.arrayContaining(['Look: area between Imported and slow shaded (its colour follows an imported rule)']))
  })
})

// ═══ 4 — atomic, undo, readback determinism, save, shared golden documents ══

describe('P3 vocab 4 — one turn, all three, through the state and the save door', () => {
  const turn = () => {
    const s0 = openAuthoringState(deepFreeze(twoEmaDoc()), { defId: DEF_ID, version: 1, lineage: 'auth_000000p3vocb' })
    return applyTurn(s0, env(0, [
      { op: 'set_levels', values: [0] },
      { op: 'set_style', output: 'slow', lineStyle: 'dotted' },
      { op: 'set_fill', output: 'fast', with: 'slow', color: 'rgba(38, 166, 154, 0.3)' },
    ]))
  }

  it('ASKED all three at once; DID: one revision, Builder-equal, deterministic readback, undo restores EXACTLY (EXACT)', () => {
    const { state, result, readback: rb } = turn()
    expect(result.status).toBe('applied')
    expect(state.revision).toBe(1)
    expect(stableJson(state.working)).toBe(stableJson(builderSave({ name: 'Two EMAs', levels: [0],
      rows: twoEmaRows({ fill: { with: 'slow' }, fillColor: 'rgba(38, 166, 154, 0.3)' }, { lineStyle: 'dotted' }) })))
    expect(rb.lines).toEqual(turn().readback.lines) // deterministic
    expect(rb.lines).toEqual(expect.arrayContaining([
      'Look: slow: drawn dotted',
      'Look: area between Two EMAs and slow shaded, colour rgba(38, 166, 154, 0.3)',
      'Look: horizontal line at 0',
    ]))
    expect(vocabularyLines(state.working)).toHaveLength(3)
    const u = undo(state)
    expect(u.working).toBe(state.history[0].working)
    expect(JSON.stringify(u.working)).toBe(JSON.stringify(twoEmaDoc()))
  })

  it('the shared golden documents (tests/fixtures/ast/p3_vocab_docs.json) are what conversation saves — the Python lane posts them to the real save door (EXACT)', () => {
    const levels = applyPatch(deepFreeze(rsiDoc()), env(0, [{ op: 'set_levels', values: [70, 30] }])).definition
    const dashed = applyPatch(deepFreeze(twoEmaDoc()), env(0, [{ op: 'set_style', output: 'slow', lineStyle: 'dashed' }])).definition
    const filled = applyPatch(deepFreeze(twoEmaDoc()), env(0, [{ op: 'set_fill', output: 'fast', with: 'slow', color: '#26a69a', opacity: 0.2 }])).definition
    const all = turn().state
    const docs = { levels, dashed, filled, all: prepareSave(all).doc }
    for (const d of Object.values(docs)) expect(validateUserDefinitions([d]).errors).toEqual([])
    if (globalThis.process.env.P3_WRITE_FIXTURE === '1') {
      fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify({ _: 'P3 vocab — documents conversation saves for set_levels / set_style.lineStyle / set_fill. JS: p3.vocab.truth.test.js builds them; Python: tests/test_p3_truth_vocab.py saves them through user_definitions.save.', docs }, null, 1)}\n`)
    }
    const golden = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')).docs
    for (const k of Object.keys(docs)) expect(stableJson(docs[k]), k).toBe(stableJson(golden[k]))
  })
})
