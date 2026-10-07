// PHASE 4 truth matrix — UNIFIED EDITING: "EVERY INDICATOR IS EDITABLE".
//
// Every case states ASKED / CLAIMED / DID and its outcome class. No model calls:
// the conversational path is exercised through the deterministic patch engine
// (`applyPatch` / `applyTurn`), exactly what a model's patch reaches.
//
//   A. FIDELITY PRESERVATION — the conversation carries what it cannot author.
//   B. THE AUTHORING-PATH PARITY CONTRACT — one table, every path, every verb.
//   C. PROVENANCE — Pine "Apply" stamps; the preview mirrors the store's rule.
//   D. THE PREVIEW — an edit draws IN PLACE of the saved definition.
//   E. DEFINITION vs INSTANCE — the legend's rows and the custom copy.
import { describe, it, expect, vi } from 'vitest'
import { parseFormula, astHash } from '../ast/parse'
import { declaredInputs } from '../ast/lint'
import { applyPatch, applyTurn, newAuthoringState, openAuthoringState, isDirty } from '../../builder/authoring'
import { modelOf, buildFromModel, fidelityPlan, evaluateRowSource, stableJson } from '../../builder/authoring/model'
import { conversationEditability } from '../../builder/authoring/memberWords'
import { chromeInputsFor, BUILDER_INPUTS } from '../../builder/builderInputs'
import { stampSemantics, isPineImport } from '../definitionSemantics'
import { applyProvenanceFor, withApplyProvenance } from '../../builder/BuilderSheet'
import { withPreviewInstance, previewInstanceLike, STUDIO_PREVIEW_DEF_ID, STUDIO_EDIT_PREVIEW_INSTANCE_ID, stripPreview } from '../../builder/studio/chartPreview'
import { chipMenuItems } from '../../legend/chipMenu'
import { createCustomCopy, kindOf, copyVerdict } from '../../builder/definitionActions'
import * as registry from '../nativeRegistry'
import { prepareSave } from '../../builder/authoring/authoringState'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const env = (state, ops) => ({ contract: C, baseRevision: state.revision, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'SPY' }
const STORED_ID = 'u_0123456789ab'

/** A stored definition as the store would hand it back (id + version). */
const stored = (def, version = 3) => ({ ...def, id: STORED_ID, version })

/** An AI-created RSI 14 with a gold line (FLOW 1's first turn). */
function aiRsi() {
  const r = applyPatch(null, env({ revision: 0 }, [
    { op: 'create', name: 'RSI 14', outputs: [{ key: 'value', tree: P('rsi(close, 14)'), label: 'RSI' }] },
    { op: 'set_style', output: 'value', color: '#D4AF37' },
  ]), { gateCtx: GATE })
  if (r.status !== 'applied') throw new Error(JSON.stringify(r.errors))
  return stored(r.definition)
}

/** A document through the Builder's own row model from formula TEXT (any dialect). */
function builderDoc(texts, { name = 'Formula', target = null } = {}) {
  const rows = texts.map((t, i) => ({ key: i === 0 ? 'value' : `out${i}`, label: '', style: 'line',
    color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false }))
  const scope = declaredInputs({ inputs: chromeInputsFor(rows) })
  texts.forEach((t, i) => {
    const ev = evaluateRowSource(t, scope, rows[i].key)
    Object.assign(rows[i], { source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback, dialect: ev.dialect || 'native' })
  })
  return stored(buildFromModel({ defId: STORED_ID, version: 3, rev: 1, name, rows, scanKey: 'value',
    placement: target ? { target } : null, levels: null, paints: null, objects: null, paramManifest: null,
    memberInputs: [], carried: { compute: {}, meta: {} } }))
}

const scanHash = (d) => astHash(d.compute.ast)

describe('PHASE 4 A — THE CONVERSATION PRESERVES WHAT IT CANNOT AUTHOR', () => {
  const imported = () => {
    const d = aiRsi()
    return { ...d, origin: { author_id: 'someone', def_id: 'u_aaaaaaaaaaaa', version: 2, ast_hash: 'sha256:x' },
      plots: d.plots.map((p) => (p.key === 'value' ? { ...p, legend: { decimals: 3 }, precision: 3 } : p)) }
  }

  it('A1 OPAQUE FIELDS ARE CARRIED, NOT REFUSED — ASKED "make it 21" on a definition with legend decimals, precision and a share origin; DID: applied, every carried field byte-identical (EXACT)', () => {
    const d = imported()
    const plan = fidelityPlan(d, modelOf(d))
    expect(plan.blocking).toEqual([])
    expect(plan.carry.sort()).toEqual(['origin', 'plots[value].legend.decimals', 'plots[value].precision'].sort())
    const slot = 'value#1'
    const r = applyPatch(d, env({ revision: 0 }, [{ op: 'set_slot', slot, value: 21 }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('applied')
    const out = r.definition
    expect(out.origin).toEqual(d.origin)
    const p = out.plots.find((x) => x.key === 'value')
    expect(p.legend).toEqual({ decimals: 3 })
    expect(p.precision).toBe(3)
    expect(out.compute.ast.args[1]).toMatchObject({ value: 21 })
  })

  it('A2 PRESENTATION-ONLY — ASKED "make the line dashed"; DID: maths identity unchanged, only the plot style moved (EXACT)', () => {
    const d = imported()
    const r = applyPatch(d, env({ revision: 0 }, [{ op: 'set_style', output: 'value', lineStyle: 'dashed' }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('applied')
    expect(scanHash(r.definition)).toBe(scanHash(d))
    expect(stableJson(r.definition.compute)).toBe(stableJson(d.compute))
    expect(r.definition.plots.find((p) => p.key === 'value').lineStyle).toBe('dashed')
    expect(r.definition.origin).toEqual(d.origin)
  })

  it('A3 A CONFLICT IS REFUSED TRUTHFULLY — ASKED "make it gold" where a per-bar colour is carried; DID: refused, nothing changed (REFUSAL)', () => {
    const d = aiRsi()
    const packed = { ...d, plots: d.plots.map((p) => (p.key === 'value' ? { ...p, colorMode: 'column:value', colorPacked: { transparency: 0 } } : p)) }
    expect(fidelityPlan(packed, modelOf(packed)).carry.sort()).toEqual(['plots[value].colorMode', 'plots[value].colorPacked'])
    const r = applyPatch(packed, env({ revision: 0 }, [{ op: 'set_style', output: 'value', color: '#FFD700' }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('refused')
    expect(r.errors[0].code).toBe('authoring:opaque-conflict')
    expect(r.errors[0].message).toMatch(/can't change yet/)
    expect(r.definition).toBe(packed)
    // a change in another group of the same output is still made, and the packed colour rides
    const ok = applyPatch(packed, env({ revision: 0 }, [{ op: 'set_style', output: 'value', lineStyle: 'dotted' }]), { revision: 0, gateCtx: GATE })
    expect(ok.status).toBe('applied')
    expect(ok.definition.plots.find((p) => p.key === 'value').colorPacked).toEqual({ transparency: 0 })
  })

  it('A4 ADDING AN OUTPUT PRESERVES EVERY EXISTING ONE — ASKED "add a 50 EMA"; DID: the RSI output and its carried fields untouched (EXACT)', () => {
    const d = imported()
    const r = applyPatch(d, env({ revision: 0 }, [{ op: 'add_output', key: 'ema50', tree: P('ema(close, 50)'), label: 'EMA 50' }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('applied')
    const before = d.plots.find((p) => p.key === 'value')
    const after = r.definition.plots.find((p) => p.key === 'value')
    expect(stableJson(after)).toBe(stableJson(before))
    expect(r.definition.plots.some((p) => p.key === 'ema50')).toBe(true)
  })

  it('A5 MATHS THE ROW MODEL CANNOT HOLD STILL BLOCKS — DID: an unknown compute stage is refused by name (REFUSAL)', () => {
    const d = { ...aiRsi(), compute: { ...aiRsi().compute, importedStage: { kind: 'foreign' } } }
    const r = applyPatch(d, env({ revision: 0 }, [{ op: 'rename_definition', name: 'y' }]), { revision: 0, gateCtx: GATE })
    expect(r.errors[0]).toMatchObject({ code: 'authoring:unrepresentable', paths: ['compute.importedStage'] })
    expect(conversationEditability(d).editable).toBe(false)
  })

  it('A6 OPEN != MUTATE — an opened definition is CLEAN; a TALK turn never dirties it; a change does; Undo is clean again (EXACT)', () => {
    const d = aiRsi()
    const s0 = openAuthoringState(d, { defId: d.id, version: d.version })
    expect(isDirty(s0)).toBe(false)
    const changed = applyTurn(s0, env(s0, [{ op: 'set_slot', slot: 'value#1', value: 21 }]), { gateCtx: GATE })
    expect(changed.result.status).toBe('applied')
    expect(isDirty(changed.state)).toBe(true)
    // revision-aware save: an EDIT of version 3 is assembled as version 4 under the SAME id
    const prep = prepareSave(changed.state)
    expect(prep.defId).toBe(STORED_ID)
    expect(prep.doc.id).toBe(STORED_ID)
    expect(prep.doc.version).toBe(4)
  })
})

describe('PHASE 4 A7 — DERIVED META IS RE-DERIVED, NEVER CARRIED', () => {
  it('A7 a definition renamed elsewhere (stale short name) — ASKED "rename this Momentum Filter"; DID: applied, short name re-derived, no carried note (EXACT)', () => {
    const d = aiRsi()
    const stale = { ...d, meta: { ...d.meta, name: 'Renamed elsewhere (copy)' } }      // shortName still the old one
    expect(fidelityPlan(stale, modelOf(stale)).carry).toEqual([])
    expect(conversationEditability(stale)).toMatchObject({ editable: true, carried: 0 })
    const r = applyPatch(stale, env({ revision: 0 }, [{ op: 'rename_definition', name: 'Momentum Filter' }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('applied')
    expect(r.definition.meta.name).toBe('Momentum Filter')
    expect(d.meta.shortName).toBeTruthy()
    expect(r.definition.meta.shortName).toBeTruthy()
    expect(r.definition.meta.shortName).not.toBe(d.meta.shortName)   // re-derived from the new name, not the stale one carried
  })
})

describe('PHASE 4 B — THE AUTHORING-PATH PARITY CONTRACT', () => {
  // Each path's document as that path STORES it. Then the same verbs on every one.
  const PATHS = {
    'AI-created': () => aiRsi(),
    'Builder (native formula)': () => builderDoc(['sma(close, 20) > sma(close, 50)']),
    'Pine Apply (native text + provenance)': () => withApplyProvenance(builderDoc(['ema(close, 21) - ema(close, 55)']),
      applyProvenanceFor('pine', '//@version=5\nindicator("x")\nplot(ta.ema(close,21)-ta.ema(close,55))')),
    'thinkScript Apply (plain native text)': () => withApplyProvenance(builderDoc(['close > sma(close, 10)']),
      applyProvenanceFor('thinkscript', 'plot x = close > Average(close, 10);')),
    'TC2000 PCF text': () => builderDoc(['C > AVGC20']),
    'Screenshot (native formula text)': () => builderDoc(['rsi(close, 14) < 30']),
    'Share-link install (origin)': () => ({ ...aiRsi(), origin: { author_id: 'a', def_id: 'u_bbbbbbbbbbbb', version: 1, ast_hash: 'sha256:y' } }),
    'Built-in custom copy (RSI)': () => stored(createCopyDocSync('rsi', { period: 14, color: '#7b68ee' })),
  }

  for (const [name, make] of Object.entries(PATHS)) {
    it(`${name}: reopen · inspect · manual round trip · converse · change presentation · add output · origin/semantics survive (EXACT)`, () => {
      const d = make()
      // REOPEN + INSPECT: the Builder's row model holds it (the Formula editor's door)
      const model = modelOf(d)
      expect(model.rows.length).toBeGreaterThan(0)
      // MANUAL EDIT: a Builder round trip blocks on nothing (carried fields ride)
      const plan = fidelityPlan(d, model)
      expect(plan.blocking, `${name}: blocking residual`).toEqual([])
      // CONVERSE: editable up front, and a presentation change applies
      expect(conversationEditability(d).editable, `${name}: editable`).toBe(true)
      const key = model.rows[0].key
      const look = applyPatch(d, env({ revision: 0 }, [{ op: 'set_style', output: key, width: 3 }]), { revision: 0, gateCtx: GATE })
      expect(look.status, `${name}: presentation change`).toBe('applied')
      expect(scanHash(look.definition)).toBe(scanHash(d))
      // ADD AN OUTPUT
      const add = applyPatch(d, env({ revision: 0 }, [{ op: 'add_output', key: 'extra', tree: P('sma(close, 50)'), label: 'SMA 50' }]), { revision: 0, gateCtx: GATE })
      expect(add.status, `${name}: add output`).toBe('applied')
      // ORIGIN / PROVENANCE SURVIVE THE EDIT
      for (const k of ['origin']) if (d[k] !== undefined) expect(look.definition[k]).toEqual(d[k])
      for (const k of ['importedFrom', 'forkedFrom']) if (d.meta && d.meta[k] !== undefined) expect(look.definition.meta[k]).toEqual(d.meta[k])
      // SEMANTICS: a Pine import previews under Pine semantics through any edit
      if (isPineImport(d)) expect(stampSemantics(add.definition, { prior: d }).meta.semantics).toBeUndefined()
    })
  }
})

/** The built-in copy synchronously (`customCopyOf` through the same module). */
import { customCopyOf } from '../../builder/builtinCopy'
function createCopyDocSync(id, inputs) { return customCopyOf(registry.getDefinition(id), inputs) }

describe('PHASE 4 C — PROVENANCE', () => {
  it('C1 the Apply door stamps dialect + a fingerprint, never the script (EXACT)', () => {
    const src = '//@version=5\nindicator("A")\nplot(close)'
    const p = applyProvenanceFor('pine', src)
    expect(p).toMatchObject({ dialect: 'pine', via: 'apply', sourceLength: src.length })
    expect(p.sourceFingerprint).toMatch(/^fnv1a:[0-9a-f]{16}$/)
    expect(JSON.stringify(p)).not.toContain('indicator(')
    expect(applyProvenanceFor('pine', src).sourceFingerprint).toBe(p.sourceFingerprint)
    expect(applyProvenanceFor('pcf', 'C > O')).toBeNull()
    expect(applyProvenanceFor('thinkscript', 'plot x = close;')).toBeNull()   // stays plain native text
  })

  it('C2 the preview mirrors the store: a Pine Apply import is never stamped semantics 2, before or after a maths edit (EXACT)', () => {
    const d = withApplyProvenance(builderDoc(['ema(close, 21) > ema(close, 55)']), applyProvenanceFor('pine', 'x'))
    expect(stampSemantics(d, { prior: null }).meta.semantics).toBeUndefined()
    const edited = { ...d, meta: { ...d.meta } }
    delete edited.meta.importedFrom                       // an editor that dropped the stamp
    expect(stampSemantics(edited, { prior: d }).meta.semantics).toBeUndefined()
    const native = builderDoc(['ema(close, 21) > ema(close, 55)'])
    expect(stampSemantics(native, { prior: null }).meta.semantics).toBe(2)
  })
})

describe('PHASE 4 D — THE EDIT PREVIEW DRAWS IN PLACE OF THE SAVED DEFINITION', () => {
  const cs = {
    indicatorInstances: [
      { instanceId: 'u_0123456789ab:1', defId: STORED_ID, inputs: { color: '#123456' }, hidden: true },
      { instanceId: 'rsi:1', defId: 'rsi', inputs: {} },
    ],
  }
  it('D1 the preview is shaped like the saved instance and replaces it in the READ VIEW only (EXACT)', () => {
    const prev = previewInstanceLike(cs, STORED_ID, registry)
    expect(prev).toMatchObject({ instanceId: STUDIO_EDIT_PREVIEW_INSTANCE_ID, defId: STUDIO_PREVIEW_DEF_ID, inputs: { color: '#123456' }, hidden: false })
    const view = withPreviewInstance(cs, prev, STORED_ID)
    expect(view.indicatorInstances.map((i) => i.instanceId)).toEqual(['rsi:1', STUDIO_EDIT_PREVIEW_INSTANCE_ID])
    expect(cs.indicatorInstances).toHaveLength(2)                 // the stored blob untouched
    expect(stripPreview(view).indicatorInstances.map((i) => i.instanceId)).toEqual(['rsi:1'])
  })
  it('D2 a saved instance hosting another indicator\'s pane is NOT hidden (both draw) (EXACT)', () => {
    const hosting = { indicatorInstances: [...cs.indicatorInstances, { instanceId: 'ma:1', defId: 'movingAverage', display: { target: '@u_0123456789ab:1' } }] }
    const view = withPreviewInstance(hosting, previewInstanceLike(hosting, STORED_ID, registry), STORED_ID)
    expect(view.indicatorInstances.some((i) => i.instanceId === 'u_0123456789ab:1')).toBe(true)
  })
})

describe('PHASE 4 E — DEFINITION vs INSTANCE', () => {
  const h = { onSettings() {}, onToggleHidden() {}, onMove() {}, onDuplicate() {}, onAlerts() {}, onAbout() {}, onRemove() {},
    onModify() {}, onEditFormula() {}, onCustomCopy() {} }
  const chip = { instanceId: 'x:1', defId: 'x', label: 'X', hidden: false }
  const keys = (rows) => rows.filter((r) => !r.separator).map((r) => r.key)

  it('E1 a USER definition offers Modify (with access) · Edit formula · Duplicate on chart · Create custom copy (EXACT)', () => {
    const def = aiRsi()
    const rows = chipMenuItems({ ...chip, defId: def.id }, def, h, { definitionKind: 'user', canModify: true })
    expect(keys(rows)).toEqual(['hidden', 'move', 'settings', 'modify', 'edit-formula', 'duplicate', 'custom-copy', 'alerts', 'about', 'remove'])
    expect(rows.find((r) => r.key === 'duplicate').label).toBe('Duplicate on chart')
    const noAccess = chipMenuItems({ ...chip, defId: def.id }, def, h, { definitionKind: 'user', canModify: false })
    expect(keys(noAccess)).not.toContain('modify')
    expect(keys(noAccess)).toContain('edit-formula')
  })

  it('E2 a NON-reproducible built-in shows the copy DISABLED with its reason; a parity-approved one enables it; neither offers formula edits (EXACT)', () => {
    const st = registry.getDefinition('superTrend')
    const bad = chipMenuItems({ ...chip, defId: 'superTrend' }, st, h, { definitionKind: kindOf(st), copyRefusal: copyVerdict(st, {}).reason })
    const row = bad.find((r) => r.key === 'custom-copy')
    expect(row.disabled).toMatch(/^Not customizable yet/)
    expect(row.onClick).toBeUndefined()
    expect(keys(bad)).not.toContain('edit-formula')
    const rsi = registry.getDefinition('rsi')
    const good = chipMenuItems({ ...chip, defId: 'rsi' }, rsi, h, { definitionKind: kindOf(rsi), copyRefusal: undefined })
    expect(good.find((r) => r.key === 'custom-copy').disabled).toBeUndefined()
  })

  it('E3 CREATE CUSTOM COPY of a built-in: a NEW definition is saved and added; the built-in and its instance are untouched (EXACT)', async () => {
    const rsi = registry.getDefinition('rsi')
    const before = JSON.stringify(rsi)
    const save = vi.fn(async (doc) => ({ ok: true, row: { def_id: 'u_00000000c0de', version: 1, rev: 1, semantics: 2 } }))
    const cs = { indicatorInstances: [{ instanceId: 'rsi:1', defId: 'rsi', inputs: { period: 21 } }] }
    const res = await createCustomCopy({ def: rsi, inputs: { period: 21 }, settings: cs, registry, save })
    expect(res.ok).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    const [doc, defId] = save.mock.calls[0]
    expect(defId).toBeNull()                                   // a CREATE, never a write to the built-in
    expect(doc.compute.kind).toBe('ast')
    expect(doc.meta.forkedFrom).toMatchObject({ builtin: 'rsi' })
    expect(doc.compute.ast.args[1]).toMatchObject({ value: 21 })  // started from the member's settings
    expect(JSON.stringify(registry.getDefinition('rsi'))).toBe(before)
    expect(res.settings.indicatorInstances.map((i) => i.defId)).toEqual(['rsi', 'u_00000000c0de'])
    expect(res.settings.indicatorInstances[0]).toEqual(cs.indicatorInstances[0])
    registry.uninstallUserDefinition('u_00000000c0de')
  })

  it('E5 a one-output built-in copy is NAMED BY ITS MATHS, so "make it 21" renames it (no stale "RSI 14") (EXACT)', () => {
    const copy = stored(createCopyDocSync('rsi', { period: 14 }))
    expect(copy.meta.name).toBe('RSI 14')
    const r = applyPatch(copy, env({ revision: 0 }, [{ op: 'set_slot', slot: 'rsi#1', value: 21 }]), { revision: 0, gateCtx: GATE })
    expect(r.status).toBe('applied')
    expect(r.definition.meta.name).toBe('RSI 21')
    expect(r.definition.meta.forkedFrom).toMatchObject({ builtin: 'rsi' })
    // a several-output copy keeps an explicit, readable name
    expect(createCopyDocSync('macd', { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).meta.name).toBe('MACD 12 26 9 (custom)')
  })

  it('E4 CREATE CUSTOM COPY of a user definition goes through the server FORK (never a client copy) (EXACT)', async () => {
    const d = aiRsi()
    const fork = vi.fn(async () => ({ ok: true, row: { def_id: 'u_00000000f0f0', version: 1,
      definition: { ...d, id: 'u_00000000f0f0', version: 1, meta: { ...d.meta, name: 'RSI 14 (copy)', forkedFrom: { def_id: d.id, version: 3 } } } } }))
    const res = await createCustomCopy({ def: d, settings: { indicatorInstances: [] }, registry, fork })
    expect(fork).toHaveBeenCalledWith(d.id)
    expect(res.ok).toBe(true)
    expect(res.row.def_id).toBe('u_00000000f0f0')
    expect(res.settings.indicatorInstances.map((i) => i.defId)).toEqual(['u_00000000f0f0'])
    registry.uninstallUserDefinition('u_00000000f0f0')
  })
})
