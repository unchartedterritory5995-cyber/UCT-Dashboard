// app/src/components/chart/engine/__tests__/staleHandleParity.test.js
//
// ⭐⭐ ONE STALE-HANDLE REPAIR, CLIENT AND SERVER. The chart repairs a param-edited
// document whose `compute.fn` is the UNEDITED tree's hash on load
// (`memberDocumentMigration.migrateMemberDocument`); the server mirrors the exact
// rule (`api/services/user_definitions.refresh_stale_handle`) at its save door and
// `scan_definition.def_hash`, so the same document draws AND scans/alerts. Both
// suites read ONE fixture (`tests/fixtures/stale_handle_cases.json`); the pytest
// twin is `tests/test_stale_handle_parity.py`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateMemberDocument } from '../memberDocumentMigration'
import { astHash } from '../ast/parse.js'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/stale_handle_cases.json'), 'utf8'))
const BASE = JSON.parse(fs.readFileSync(path.join(REPO, FIXTURE.base), 'utf8')).definition

function transformed(name) {
  const d = JSON.parse(JSON.stringify(BASE))
  const c = d.compute
  if (name === 'dropTreesHash') delete c.treesHash
  else if (name === 'dropManifest') delete c.paramManifest
  else if (name === 'tamperTree') c.trees[Object.keys(c.trees).sort().at(-1)] = { type: 'num', value: 7 }
  else if (name === 'dropFn') delete c.fn
  else if (name === 'freshFn') c.fn = FIXTURE.expectFn
  else if (name === 'kindJs') c.kind = 'js'
  return d
}

describe('one stale-handle rule, by one fixture', () => {
  it('the browser\'s hash is the one the fixture (and the server) expects', () => {
    expect(astHash(BASE.compute.ast)).toBe(FIXTURE.expectFn)
    expect(BASE.compute.fn).not.toBe(FIXTURE.expectFn)
  })
  for (const c of FIXTURE.cases) {
    it(`${c.name} → ${c.repaired ? 'repaired' : 'left as given'}`, () => {
      const doc = transformed(c.transform)
      const before = JSON.stringify(doc)
      const out = migrateMemberDocument(doc)
      expect(JSON.stringify(doc)).toBe(before)
      if (c.repaired) {
        expect(out).not.toBe(doc)
        expect(out.compute.fn).toBe(FIXTURE.expectFn)
        expect({ ...out.compute, fn: null }).toEqual({ ...doc.compute, fn: null })
      } else {
        expect(out).toBe(doc)
      }
    })
  }
})
