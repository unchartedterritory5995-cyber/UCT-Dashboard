// @vitest-environment node
// app/src/components/chart/builder/memberPane/memberDoorWorkerGraph.test.js
//
// ─── ⭐⭐ THE PASTE WORKER — THE WORKER-ONLY RESOLUTION: THE SAME FUNCTIONS, AND NOTHING ELSE ALIASED ────────────────
//
// `scripts/memberDoorWorkerPure.mjs` (vite `worker.plugins`): inside a WORKER bundle the member door's two sheet imports
// (`../BuilderSheet`, `../FormulaField`, from `memberPaneDefinition.js` only) resolve to the pure modules, so the
// member door's worker holds no React. On the page the door imports the sheet as it always did. So:
//   1. the SAME functions either way: what the sheet exports IS what the pure module exports (identity, not equality);
//   2. the door imports exactly those two names from exactly those two specifiers, and the pure modules export them;
//   3. the resolver matches those two (specifier, importer) pairs and NOTHING ELSE: every other specifier from that
//      file, the same specifiers from any other file (a test, a namesake in another folder, a near-miss name), and the
//      prototype's own keys answer null;
//   4. over EVERY relative import of every non-test module in app/src, it matches exactly those two (with a control:
//      the walk reads the door's own imports, so "nothing matched" cannot pass by reading nothing).
// The census proves the bundle's ANSWER equals the page's (docs/pine/evidence/2026-11-20-paste-worker, section 4);
// this rail proves the alias cannot reach anything it was not written for.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as sheet from '../BuilderSheet'
import * as pureBuild from '../buildDefinition'
import * as field from '../FormulaField'
import * as pureEval from '../evaluateFormula'
import {
  memberDoorWorkerPureTarget, MEMBER_DOOR_WORKER_PURE, MEMBER_DOOR_FILE,
} from '../../../../../scripts/memberDoorWorkerPure.mjs'

const APP = path.resolve(__dirname, '../../../../..')
const DOOR = path.join(APP, MEMBER_DOOR_FILE)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

describe('⭐⭐ the member door worker resolves the sheet to the pure modules, and nothing else', () => {
  it('1. the same functions on the page and in the worker (identity)', () => {
    expect(sheet.buildDefinition).toBe(pureBuild.buildDefinition)
    expect(field.evaluateFormula).toBe(pureEval.evaluateFormula)
    expect(field.canSaveFormula).toBe(pureEval.canSaveFormula)
    expect(typeof pureBuild.buildDefinition).toBe('function')
  })

  it('2. the door imports exactly those names from exactly those specifiers, and each target exports them', () => {
    const src = strip(fs.readFileSync(DOOR, 'utf8'))
    const fromSheet = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/BuilderSheet'/g)].map((m) => m[1].trim())
    const fromField = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/FormulaField'/g)].map((m) => m[1].trim())
    expect(fromSheet).toEqual(['buildDefinition'])
    expect(fromField).toEqual(['evaluateFormula'])
    expect(Object.keys(MEMBER_DOOR_WORKER_PURE).sort()).toEqual(['../BuilderSheet', '../FormulaField'])
    expect(MEMBER_DOOR_WORKER_PURE['../BuilderSheet']).toBe('../buildDefinition.js')
    expect(MEMBER_DOOR_WORKER_PURE['../FormulaField']).toBe('../evaluateFormula.js')
    expect(fs.existsSync(path.resolve(path.dirname(DOOR), '../buildDefinition.js'))).toBe(true)
    expect(fs.existsSync(path.resolve(path.dirname(DOOR), '../evaluateFormula.js'))).toBe(true)
  })

  it('3. the resolver matches those two pairs and nothing else', () => {
    const posix = DOOR.split(path.sep).join('/')
    expect(memberDoorWorkerPureTarget('../BuilderSheet', DOOR)).toBe('../buildDefinition.js')
    expect(memberDoorWorkerPureTarget('../FormulaField', DOOR)).toBe('../evaluateFormula.js')
    expect(memberDoorWorkerPureTarget('../FormulaField', `${posix}?worker_file&type=module`)).toBe('../evaluateFormula.js')
    const dir = path.dirname(DOOR)
    const otherImporters = [
      path.join(dir, 'MemberPane.jsx'), path.join(dir, 'memberDoorWorkerCore.js'),
      path.join(dir, 'memberPaneDefinition.test.js'), path.join(dir, 'xmemberPaneDefinition.js'),
      path.join(dir, 'memberPaneDefinition.jsx'), path.join(APP, 'src', 'memberPaneDefinition.js'),
      path.join(APP, 'src/components/chart/builder/memberPaneDefinition.js'),
      path.join(dir, '..', 'BuilderSheet.jsx'), '', null, undefined,
    ]
    for (const imp of otherImporters) {
      for (const spec of Object.keys(MEMBER_DOOR_WORKER_PURE)) expect(memberDoorWorkerPureTarget(spec, imp), `${spec} from ${imp}`).toBe(null)
    }
    for (const spec of ['../BuilderSheet.jsx', '../FormulaField.jsx', './BuilderSheet', '../pineParamManifest', '../buildDefinition',
      'react', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '', null, undefined]) {
      expect(memberDoorWorkerPureTarget(spec, DOOR), `${spec} from the door`).toBe(null)
    }
  })

  it('4. over every relative import of every non-test module in app/src, exactly those two match (with a control)', () => {
    const files = []
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n)
        if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p) } else if (/\.(js|jsx|mjs)$/.test(n) && !/\.test\.|\.spec\./.test(n)) files.push(p)
      }
    }
    walk(path.join(APP, 'src'))
    const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
    const matched = []
    let doorImports = 0
    for (const f of files) {
      for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(SPEC)) {
        if (f === DOOR) doorImports += 1
        if (memberDoorWorkerPureTarget(m[2], f)) matched.push(`${path.relative(APP, f).split(path.sep).join('/')} ${m[2]}`)
      }
    }
    expect(files.length, 'the walk read the app').toBeGreaterThan(1000)
    expect(doorImports, 'the control: the walk read the door\'s own imports').toBeGreaterThan(20)
    expect(matched.sort()).toEqual([`${MEMBER_DOOR_FILE} ../BuilderSheet`, `${MEMBER_DOOR_FILE} ../FormulaField`])
  })
})
