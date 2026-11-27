// app/src/components/chart/engine/__tests__/validationMemo.test.js
//
// ⭐⭐ (e101 S4) AN UNCHANGED LIST IS NOT VALIDATED TWICE (`nativeRegistry.js::pureValidationOf`), AND EVERY LIVE GATE IS
// STILL ASKED ON EVERY CALL. Measured (27 member documents, node): validate 125-178 ms, the SAME list installed again
// 153 ms. The rails, as the coordinator set them:
//   V1 an identical list on the second landing does no validation work (and its install prints nothing, bumps nothing)
//   V2 a changed document is validated again
//   V3 a kill-list change, V4 a held-divergence stamp, V5 the runtime pane's permission: each changes the verdict at once
//   V6 the verdicts are byte-identical to the unmemoised path on all 27 documents
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { setRuntimeKillList } from '../runtimeKill'
import { HELD_DIVERGENCE_STAMP } from '../heldWithholds'
import { asMember } from '../../../../testing/runtimeGate'

vi.setConfig({ testTimeout: 300000 })
asMember({ allow: true, pane: true, hkd: true })
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const idOf = (i) => `u_${(0xe10100000000 + i).toString(16)}`
let DOCS = []
const clone = () => JSON.parse(JSON.stringify(DOCS))
const verdict = (r) => JSON.stringify({ defs: r.defs, errors: r.errors, killedIds: r.killedIds })
const stats = () => registry.validationMemoStats()

beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  for (const f of files) {
    if (DOCS.length >= 27) break
    try {
      const b = memberPaneDefinition({ source: fs.readFileSync(path.join(CORPUS, f), 'utf8'), id: idOf(DOCS.length), name: f })
      if (b.ok) DOCS.push(JSON.parse(JSON.stringify(b.definition)))
    } catch { /* a script the door refuses is not a member document */ }
  }
  vi.unstubAllEnvs()
})
afterEach(() => {
  vi.unstubAllEnvs()
  registry.__validationMemoOffForTests(false)
  registry.clearUserDefinitions()
  setRuntimeKillList([])
})
const paneOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}

describe('an unchanged list is not validated twice; every live gate is asked every time', () => {
  it('non-vacuity: 27 member documents, both lanes', () => {
    expect(DOCS.length).toBe(27)
    const kinds = new Set(DOCS.map((d) => d.compute.kind))
    expect(kinds.has('ast') && kinds.has('runtime')).toBe(true)
  })

  it('V1 the second landing of an identical list does no validation work, and its install bumps nothing', () => {
    paneOn()
    registry.__validationMemoOffForTests(false)
    const first = registry.installUserDefinitions(clone())
    const gen = registry.registryGeneration()
    const runs = stats().pureRuns
    const hits = stats().hits
    const again = registry.installUserDefinitions(clone())        // a new array of new objects, the same content
    expect(stats().pureRuns, 'no pure validation ran').toBe(runs)
    expect(stats().hits).toBe(hits + 1)
    expect(registry.registryGeneration(), 'nothing was installed again').toBe(gen)
    expect(again.installed.map((d) => d.id)).toEqual(first.installed.map((d) => d.id))
    expect(again.errors).toEqual(first.errors)
  })

  it('V2 a changed document is validated again (and only the new list is answered)', () => {
    paneOn()
    registry.validateUserDefinitions(clone())
    const runs = stats().pureRuns
    const changed = clone()
    changed[3].name = `${changed[3].name || 'x'} (renamed)`
    const r = registry.validateUserDefinitions(changed)
    expect(stats().pureRuns).toBe(runs + 1)
    const fresh = (() => { registry.__validationMemoOffForTests(true); try { return registry.validateUserDefinitions(JSON.parse(JSON.stringify(changed))) } finally { registry.__validationMemoOffForTests(false) } })()
    expect(verdict(r)).toBe(verdict(fresh))
  })

  it('V3 a kill-list change refuses a runtime document at once, on a memo hit', () => {
    paneOn()
    const runtimeDoc = DOCS.find((d) => d.compute.kind === 'runtime')
    registry.validateUserDefinitions(clone())
    const runs = stats().pureRuns
    setRuntimeKillList([runtimeDoc.id])
    const r = registry.validateUserDefinitions(clone())
    expect(stats().pureRuns, 'a memo hit').toBe(runs)
    expect(r.killedIds).toContain(runtimeDoc.id)
    expect(r.defs.map((d) => d.id)).not.toContain(runtimeDoc.id)
    setRuntimeKillList([])
    expect(registry.validateUserDefinitions(clone()).defs.map((d) => d.id)).toContain(runtimeDoc.id)
  })

  it('V4 a held-divergence stamp refuses the document (a stamp is content: the list is validated again)', () => {
    paneOn()
    registry.validateUserDefinitions(clone())
    const stamped = clone()
    const target = stamped.find((d) => d.compute.kind === 'ast')
    target.meta = { ...(target.meta || {}), [HELD_DIVERGENCE_STAMP]: 'held for a divergence (rail)' }
    const r = registry.validateUserDefinitions(stamped)
    expect(r.killedIds).toContain(target.id)
    expect(r.defs.map((d) => d.id)).not.toContain(target.id)
  })

  it('V5 the runtime pane switched off refuses every runtime document at once, on a memo hit', () => {
    paneOn()
    const on = registry.validateUserDefinitions(clone())
    const runs = stats().pureRuns
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
    const off = registry.validateUserDefinitions(clone())
    expect(stats().pureRuns, 'a memo hit').toBe(runs)
    const runtimeIds = DOCS.filter((d) => d.compute.kind === 'runtime').map((d) => d.id)
    expect(on.defs.map((d) => d.id)).toEqual(expect.arrayContaining(runtimeIds))
    for (const id of runtimeIds) expect(off.defs.map((d) => d.id)).not.toContain(id)
  })

  it('V6 the verdicts are byte-identical to the unmemoised path on all 27 documents (cold, and on a hit)', () => {
    paneOn()
    registry.__validationMemoOffForTests(true)
    const fresh = verdict(registry.validateUserDefinitions(clone()))
    registry.__validationMemoOffForTests(false)
    const cold = verdict(registry.validateUserDefinitions(clone()))
    const hit = verdict(registry.validateUserDefinitions(clone()))
    expect(cold).toBe(fresh)
    expect(hit).toBe(fresh)
    expect(JSON.parse(fresh).defs.length, 'non-vacuity: documents were admitted').toBeGreaterThan(20)
  })
})
