// app/src/components/chart/engine/__tests__/savedDocumentUpgradeParity.test.js
//
// ⭐⭐ ONE SAVED-DOCUMENT WIDTH-CONTROL UPGRADE, CLIENT AND SERVER. A plot's width
// control saved before #526 stops at 4 (the Builder's old constant), so the settings
// dialog clamped a member at "Maximum is 4" while TradingView draws a Pine linewidth
// up to 10. The chart raises that `max` on load (`memberDocumentMigration`); the
// server mirrors the exact rule at its save door
// (`api/services/user_definitions.refresh_width_control_max`). Both suites read ONE
// fixture (`tests/fixtures/saved_document_upgrade_cases.json`); the pytest twin is
// `tests/test_saved_document_upgrade_parity.py`. The fixture's `_about` is also the
// table of what a saved document CANNOT prove, and so what no upgrade claims.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateMemberDocument } from '../memberDocumentMigration'
import { astHash } from '../ast/parse.js'
import { validateDefinition } from '../defSchema'
import { validateUserDefinitions, resolveInputs } from '../nativeRegistry'
import { chromeInputsFor } from '../../builder/builderInputs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/saved_document_upgrade_cases.json'), 'utf8'))
const SAVED = JSON.parse(fs.readFileSync(path.join(REPO, FIXTURE.base), 'utf8')).definition

/** The base with its handle already current, so ONLY the width rule can move it. */
function fresh() {
  const d = JSON.parse(JSON.stringify(SAVED))
  d.compute.fn = astHash(d.compute.ast)
  return d
}

function applyOps(doc, ops) {
  for (const op of ops) {
    if (op.op === 'allWidthControls') {
      for (const s of doc.inputs) if (FIXTURE.widthControlKeys.includes(s.key)) Object.assign(s, op.set)
    } else if (op.op === 'input') {
      Object.assign(doc.inputs.find((s) => s.key === op.key), op.set)
    } else if (op.op === 'addInput') {
      doc.inputs.push(JSON.parse(JSON.stringify(op.spec)))
    } else if (op.op === 'plotWidth') {
      doc.plots.find((p) => p.key === op.plot).width = op.value
    } else if (op.op === 'dropPlots') {
      delete doc.plots
    } else {
      throw new Error(`unknown op ${op.op}`)
    }
  }
  return doc
}

function expected(doc, c) {
  const want = JSON.parse(JSON.stringify(doc))
  for (const s of want.inputs) {
    if (c.upgraded.includes(s.key)) s.max = (c.max && c.max[s.key]) || FIXTURE.defaultMax
  }
  return want
}

describe('one width-control upgrade, by one fixture', () => {
  it('the fixture is not vacuous: the saved base really carries the old 1..4 control on every plot', () => {
    expect(FIXTURE.widthControlKeys).toHaveLength(SAVED.plots.length)
    for (const k of FIXTURE.widthControlKeys) {
      expect(SAVED.inputs.find((s) => s.key === k)).toMatchObject({ type: 'int', min: 1, max: 4, step: 1 })
    }
  })

  for (const c of FIXTURE.cases) {
    it(`${c.name} → ${c.upgraded.length ? `${c.upgraded.length} raised` : 'left as given'}`, () => {
      const doc = applyOps(fresh(), c.ops)
      const before = JSON.stringify(doc)
      const out = migrateMemberDocument(doc)
      expect(JSON.stringify(doc), 'pure: the input is never mutated').toBe(before)
      if (!c.upgraded.length) {
        expect(out).toBe(doc)
        return
      }
      expect(out).not.toBe(doc)
      // ⭐ EVERY OTHER BYTE AS GIVEN: compute, plots, meta, the defaults, other inputs.
      expect(out).toEqual(expected(doc, c))
      expect(out.compute).toBe(doc.compute)
      expect(out.plots).toBe(doc.plots)
    })
  }

  it('the raised max is exactly what today\'s Builder mints for the same rows (one rule, not two)', () => {
    const out = migrateMemberDocument(fresh())
    const minted = chromeInputsFor(out.plots.map((p) => ({
      key: p.key, width: out.inputs.find((s) => `$${s.key}` === p.width).default,
    })))
    for (const k of FIXTURE.widthControlKeys) {
      expect(out.inputs.find((s) => s.key === k).max, k).toBe(minted.find((s) => s.key === k).max)
    }
  })
})

describe('on load: the installed document, the member\'s values, idempotence', () => {
  it('⭐ the chart installs the saved document with a 1..10 control (validateUserDefinitions is the seam)', () => {
    const { defs, errors } = validateUserDefinitions([JSON.parse(JSON.stringify(SAVED))])
    expect(errors).toEqual([])
    const inst = defs.find((d) => d.id === SAVED.id)
    expect(inst).toBeTruthy()
    for (const k of FIXTURE.widthControlKeys) expect(inst.inputs.find((s) => s.key === k).max, k).toBe(10)
    expect(validateDefinition(inst).ok).toBe(true)
  })

  it('⛔ CONTROL: a member\'s instance width and every default survive exactly', () => {
    const out = migrateMemberDocument(fresh())
    // the member's own settings live on the INSTANCE and resolve over the document
    const member = { out2Width: 3, lineWidth: 2, out2Color: '#123456' }
    const before = resolveInputs(SAVED, member)
    const after = resolveInputs(out, member)
    expect(after).toEqual(before)
    expect(after.out2Width).toBe(3)
    // and the document's own defaults (the author's widths) are unmoved
    for (const s of SAVED.inputs) expect(out.inputs.find((x) => x.key === s.key).default).toEqual(s.default)
    // a member input that is not a width control keeps its own bounds
    const showMA1 = SAVED.inputs.find((s) => s.key === 'showMA1')
    expect(out.inputs.find((s) => s.key === 'showMA1')).toEqual(showMA1)
  })

  it('idempotent: a second load changes nothing (same object, same bytes, no hash moved)', () => {
    const doc = JSON.parse(JSON.stringify(SAVED))
    const once = migrateMemberDocument(doc)
    expect(migrateMemberDocument(once)).toBe(once)
    expect(migrateMemberDocument(doc)).toBe(once)
    // a fresh parse of the upgraded bytes (what a re-save and a re-load would hand back)
    const again = JSON.parse(JSON.stringify(once))
    expect(migrateMemberDocument(again)).toBe(again)
    expect(astHash(once.compute.ast)).toBe(astHash(SAVED.compute.ast))
    expect(once.compute.treesHash).toBe(SAVED.compute.treesHash)
  })
})
