// app/src/components/chart/engine/__tests__/runtimeObjectsSchemaParity.test.js
//
// ⭐⭐ ENGINE 53 — ONE RULE SET FOR A HOST DOCUMENT'S RUN HALF (`compute.runtimeObjects`),
// CLIENT AND SERVER (`defSchema.runtimeObjectsErrors` ⇄
// `api/services/presentation_schema._check_runtime_objects`), by ONE fixture both suites read
// (`tests/fixtures/runtime_objects_schema.json`; the pytest twin is
// `tests/test_runtime_objects_schema_parity.py`). Each case names the error PATHS both sides
// report, so a rule one side has and the other lacks is red on one side by name.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeObjectsErrors, validateDefinition, RUNTIME_OBJECTS_FIELDS } from '../defSchema'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/runtime_objects_schema.json'), 'utf8'))
const SERVER = fs.readFileSync(path.join(REPO, 'api/services/presentation_schema.py'), 'utf8')

/** The path an error sentence names (everything before its first `: `). */
const pathOf = (e) => String(e).split(': ')[0]

describe('compute.runtimeObjects — one rule set, both sides', () => {
  for (const c of FIXTURE.cases) {
    it(`${c.name} → ${c.paths.length ? c.paths.join(', ') : 'valid'}`, () => {
      const errs = runtimeObjectsErrors({ kind: c.kind, runtimeObjects: c.runtimeObjects,
        ...(c.runtimeColours ? { runtimeColours: c.runtimeColours } : {}) }, new Set(c.plots))
      expect([...new Set(errs.map(pathOf))].sort()).toEqual([...c.paths].sort())
    })
  }

  it('the closed field list is the server\'s, field for field', () => {
    const m = /RUNTIME_OBJECTS_FIELDS = \(([^)]*)\)/.exec(SERVER)
    expect(m, 'presentation_schema.RUNTIME_OBJECTS_FIELDS').toBeTruthy()
    const server = [...m[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((x) => x[1])
    expect(server).toEqual([...RUNTIME_OBJECTS_FIELDS])
  })

  it('validateDefinition carries the rule: a member-door document refused only for its run half', () => {
    const b = memberPaneDefinition({ source: '//@version=5\nindicator("p")\nplot(ta.sma(close, 5), "a")\n', id: 'u_member-pane-roparity' })
    expect(b.ok, b.reason).toBe(true)
    const good = JSON.parse(JSON.stringify(b.definition))
    good.compute.runtimeObjects = { source: 'x', outputs: { value: 0 } }
    const ok = validateDefinition(good)
    expect(ok.ok, (ok.errors || []).join(' | ')).toBe(true)
    // the validated copy keeps the run half (it is read at bind)
    expect(ok.def.compute.runtimeObjects).toEqual({ source: 'x', outputs: { value: 0 } })
    const bad = JSON.parse(JSON.stringify(good))
    bad.compute.runtimeObjects.outputs = { nope: 0 }
    const no = validateDefinition(bad)
    expect(no.ok).toBe(false)
    expect(no.errors.some((e) => e.startsWith('compute.runtimeObjects.outputs.nope'))).toBe(true)
  })
})
