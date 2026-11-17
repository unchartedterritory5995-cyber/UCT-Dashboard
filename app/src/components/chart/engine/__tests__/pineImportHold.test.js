// app/src/components/chart/engine/__tests__/pineImportHold.test.js
//
// ─── ⭐⭐ COND-TA (coordinator ruling 2026-11-15) — THE PINE-IMPORT HOLD, the chart half ──
//
// A Pine import saved by the Builder's Apply door is a FORMULA document with no script, and before
// COND-TA no engine stamp; its formula may be the every-bar reading of a `ta.*` call that runs only
// on some bars (`vw-call-site-history` C03: 242 of 635 bars wrong), which cannot be told without the
// script. Such a row applied before `PINE_IMPORT_FIX_ENGINE` is NOT DRAWN, by name, exactly where
// the server lanes withhold it (`user_definitions.engine_withheld_reason`,
// `tests/test_pine_import_hold.py`). Re-applying the import (`applyProvenanceFor` stamps today's
// engine) lifts it; a formula that is not a Pine import, or one holding its script, is untouched.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { SCRIPT_ENGINE_VERSION, PINE_IMPORT_FIX_ENGINE, PINE_IMPORT_HELD_SENTENCE } from '../scriptEngineVersion'
import { pineImportHeld, conditionalHistoryCandidate } from '../pineImportHold'
import { upgradeKindOf, resolveRow } from '../../builder/memberPane/savedScriptUpgrade'
import { applyProvenanceFor, withApplyProvenance } from '../../builder/BuilderSheet'

const ROOT = path.resolve(process.cwd(), '..')
const S = (name) => ({ type: 'series', name })
const CALL = (name, ...a) => ({ type: 'call', name, args: a.map((value) => ({ value })) })
const OP = (name, ...args) => ({ type: 'op', name, args })
const NUM = (value) => ({ type: 'num', value })
const NA = OP('/', NUM(0), NUM(0))
const UP = OP('>', S('close'), S('open'))
// the trees the old screener lane wrote (CANDIDATES) — the same cases `tests/test_pine_import_hold.py` holds
const BLOCK_SMA = OP('?:', UP, CALL('sma', S('close'), NUM(3)), NA)
const ARM_OFFSET = OP('?:', UP, { type: 'offset', value: 1, args: [OP('*', S('close'), NUM(2))] }, NA)
const IFF_CALL = CALL('iff', UP, CALL('sma', S('close'), NUM(3)), S('close'))
// NOT candidates
const PLAIN = OP('-', CALL('sma', S('close'), NUM(3)), { type: 'offset', value: 1, args: [S('close')] })
const CALL_IN_TEST = OP('?:', OP('>', CALL('rsi', S('close'), NUM(14)), NUM(50)), S('close'), S('open'))
const ARMS_PLAIN = OP('?:', UP, S('high'), S('low'))
const IFF_OFFSET = CALL('iff', UP, { type: 'offset', value: 1, args: [S('close')] }, S('close'))
const FORMULA = { id: 'u_imported', compute: { kind: 'ast', ast: BLOCK_SMA }, meta: { name: 'imported' } }
const OLD = { dialect: 'pine', via: 'apply', sourceLength: 40, sourceFingerprint: 'fnv1a:0123456789abcdef' }
const rowOf = (importedFrom, extra = {}, ast = BLOCK_SMA) => ({
  def_id: 'u_imported', version: 3,
  definition: { ...FORMULA, compute: { ...FORMULA.compute, ast }, meta: { ...FORMULA.meta, ...(importedFrom ? { importedFrom } : {}) } },
  ...extra,
})

describe('COND-TA — a Pine import applied before the fix is held on the chart, by name', () => {
  it('an old Pine import with no script: `import-held`, not drawn, the sentence named', () => {
    for (const r of [rowOf(OLD), rowOf({ ...OLD, engine: PINE_IMPORT_FIX_ENGINE - 1 })]) {
      expect(pineImportHeld(r)).toBe(true)
      expect(upgradeKindOf(r)).toBe('import-held')
      const res = resolveRow(r)
      expect(res.definition).toBeNull()
      expect(res.refusal).toBe(`imported: ${PINE_IMPORT_HELD_SENTENCE}`)
    }
  })

  it('⭐ NARROWED: only a structural candidate is held; a Pine import with no conditional history is drawn', () => {
    for (const ast of [BLOCK_SMA, ARM_OFFSET, IFF_CALL]) {
      expect(conditionalHistoryCandidate({ compute: { ast } })).toBe(true)
      expect(upgradeKindOf(rowOf(OLD, {}, ast))).toBe('import-held')
    }
    for (const ast of [PLAIN, CALL_IN_TEST, ARMS_PLAIN, IFF_OFFSET]) {
      expect(conditionalHistoryCandidate({ compute: { ast } })).toBe(false)
      const r = rowOf(OLD, {}, ast)
      expect(upgradeKindOf(r)).toBe('none')
      expect(resolveRow(r).refusal).toBeNull()
    }
    // every plot's tree is read, not only the scan plot's
    expect(conditionalHistoryCandidate({ compute: { ast: PLAIN, trees: { value: PLAIN, out2: BLOCK_SMA } } })).toBe(true)
  })

  it('⭐ a `?:` whose test is bar-constant (the shared `barConstantTree`) is not a candidate; a varying one nested in its arm still is', () => {
    const weekly = OP('?:', OP('!', S('isweekly')), CALL('sma', S('close'), NUM(3)), NA)
    expect(conditionalHistoryCandidate({ compute: { ast: weekly } })).toBe(false)
    expect(conditionalHistoryCandidate({ compute: { ast: OP('?:', S('isweekly'), BLOCK_SMA, NA) } })).toBe(true)
  })

  it('⛔ a Pine v1 import (door stamp `pineVersion` null = no pragma, or 1) is drawn: a v1 arm is eager (witnessed); with no door stamp it stays held', () => {
    expect(pineImportHeld(rowOf(OLD))).toBe(true)
    for (const pineVersion of [null, 1]) {
      const r = { ...rowOf(OLD) }
      r.definition = { ...r.definition, meta: { ...r.definition.meta, pineVersion } }
      expect(pineImportHeld(r), String(pineVersion)).toBe(false)
    }
    const v4 = { ...rowOf(OLD) }
    v4.definition = { ...v4.definition, meta: { ...v4.definition.meta, pineVersion: 4 } }
    expect(pineImportHeld(v4)).toBe(true)
  })

  it('a RE-APPLIED import is drawn: the Apply door stamps today\'s engine', () => {
    const prov = applyProvenanceFor('pine', '//@version=6\nindicator("x")\nplot(close)')
    expect(prov.engine).toBe(SCRIPT_ENGINE_VERSION)
    expect(JSON.stringify(prov)).not.toContain('indicator(')   // never the script
    const doc = withApplyProvenance(FORMULA, prov)
    const r = { def_id: 'u_imported', version: 4, definition: doc }
    expect(pineImportHeld(r)).toBe(false)
    expect(upgradeKindOf(r)).toBe('none')
    expect(resolveRow(r).definition).toBe(doc)
  })

  it('⛔ untouched: a native formula, another dialect, a row that holds its script', () => {
    const untouched = [
      rowOf(null),
      rowOf({ dialect: 'thinkscript', via: 'apply' }),
      rowOf(OLD, { pine_source: '//@version=6\nindicator("x")\nplot(close)' }),
      rowOf(OLD, { has_pine_source: true }),
    ]
    for (const r of untouched) {
      expect(pineImportHeld(r)).toBe(false)
      expect(upgradeKindOf(r)).not.toBe('import-held')
      expect(resolveRow(r).refusal).toBeNull()
    }
  })

  it('⛔ an engine stamp that is not an integer never lifts it; a recorded refusal keeps its own sentence', () => {
    for (const bad of ['55', 55.5, true, null]) expect(pineImportHeld(rowOf({ ...OLD, engine: bad })), String(bad)).toBe(true)
    const refused = rowOf(OLD, { engine_status: { status: 'refused', engine: SCRIPT_ENGINE_VERSION, reason: 'pine:block — x' } })
    expect(upgradeKindOf(refused)).toBe('refused')
  })

  it('one number, one sentence: the fix engine is COND-TA\'s history line and the server reads both', () => {
    const js = fs.readFileSync(path.join(ROOT, 'app/src/components/chart/engine/scriptEngineVersion.js'), 'utf8')
    expect(js).toMatch(new RegExp(`/\\*\\* ${PINE_IMPORT_FIX_ENGINE} = COND-TA`))
    expect(PINE_IMPORT_FIX_ENGINE).toBeLessThanOrEqual(SCRIPT_ENGINE_VERSION)
    const py = fs.readFileSync(path.join(ROOT, 'api/services/user_definitions.py'), 'utf8')
    const m = py.match(/PINE_IMPORT_HELD_SENTENCE = \("([^"]*)"\s*\r?\n\s*"([^"]*)"\)/)
    expect(m && m[1] + m[2]).toBe(PINE_IMPORT_HELD_SENTENCE)
  })
})
