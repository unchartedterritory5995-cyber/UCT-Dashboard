// @vitest-environment node
// app/src/components/chart/builder/memberPane/runtimeDocumentRoundTrip.test.js
//
// ─── ⭐⭐ RF — A SAVED RUNTIME DOCUMENT RELOADS AS THE ONE THE DOOR MINTED ────────
//
// The client half of the save/load round trip for the runtime pane (the server
// half is `tests/test_runtime_document_round_trip.py`, which saves, reloads and
// kill-lists the SAME fixture with `PINE_RUNTIME_SAVE_ENABLED` on in a test).
//
// `tests/fixtures/runtime_documents/documents.json` holds the document the member
// door mints today for each corpus script that attaches ONLY through the runtime
// lane (the member-door census' `runtime` state minus its `on` state, measured
// 2026-10-02: six scripts). This file holds the door to it — if the door's output
// moves, this goes red and the fixture is re-written ON PURPOSE:
//   cd app && RF_WRITE_FIXTURE=1 node node_modules/vitest/vitest.mjs run \
//     src/components/chart/builder/memberPane/runtimeDocumentRoundTrip.test.js
// ⛔ The list of six is the census' answer, not a choice; if the census moves,
// re-measure (`memberDoorCensus.measure.test.js`, VENDOR_BATCH_CENSUS_RUNTIME=1).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'runtime_documents', 'documents.json')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const DAILY = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const WRITE = process.env.RF_WRITE_FIXTURE === '1'

const RUNTIME_ONLY = [
  'adx-and-di-for-v4',
  'delta-rsi-oscillator-strategy',
  'fibonacci-dolphintradebot',
  'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat',
  'trend-targets-algoalpha',
  'wyckoff-accumulation-distribution',
]
const idOf = (k) => `u_0000000000${(0xf1 + k).toString(16)}`

afterEach(() => { vi.unstubAllEnvs() })

const flagsOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const fileOf = (slug) => fs.readdirSync(CORPUS).find((f) => f.startsWith(`${slug}__`) || f === `${slug}.pine`)
const mint = (slug, k) => {
  const file = fileOf(slug)
  const source = fs.readFileSync(path.join(CORPUS, file), 'utf8')
  const built = memberPaneDefinition({ source, id: idOf(k), name: slug })
  return { file: `corpus/committed/${file}`, built }
}

describe('RF — the runtime-only documents, as the door mints them', () => {
  it('⭐ every one of the six is a runtime document, and the fixture is exactly what the door mints', () => {
    flagsOn()
    const docs = RUNTIME_ONLY.map((slug, k) => {
      const { file, built } = mint(slug, k)
      expect(built.ok, `${slug}: ${built.reason}`).toBe(true)
      expect(built.lane, slug).toBe('runtime')
      return { slug, file, definition: JSON.parse(JSON.stringify(built.definition)) }
    })
    if (WRITE) {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
      fs.writeFileSync(FIXTURE, `${JSON.stringify({
        generatedBy: 'app/src/components/chart/builder/memberPane/runtimeDocumentRoundTrip.test.js (RF_WRITE_FIXTURE=1)',
        documents: docs,
      }, null, 1)}\n`)
    }
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(fixture.documents.map((d) => d.slug)).toEqual(RUNTIME_ONLY)
    for (let k = 0; k < docs.length; k += 1) expect(fixture.documents[k].definition, docs[k].slug).toEqual(docs[k].definition)
  }, 120000)
})

describe('RF — a reloaded document (as the store serves it back) installs and draws the same columns', () => {
  it('⭐ JSON round trip → install door → the same columns as the freshly minted document, on 5,000 daily bars', () => {
    flagsOn()
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const rows = JSON.parse(fs.readFileSync(DAILY, 'utf8')).bars.rows.slice(-5000)
    const bars = () => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    let compared = 0
    for (const [k, doc] of fixture.documents.entries()) {
      const { built } = mint(doc.slug, k) // registers the lane, as the door does
      const fresh = registry.installUserDefinitions([built.definition]).installed[0]
      const a = registry.computeFor(fresh, bars(), undefined, ctx)
      registry.uninstallUserDefinition(doc.definition.id)
      const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(doc.definition))])
      expect(installed.length, `${doc.slug}: ${errors.join(' | ')}`).toBe(1)
      const b = registry.computeFor(installed[0], bars(), undefined, ctx)
      registry.uninstallUserDefinition(doc.definition.id)
      // the GUARD per column, not its sentence: a wall-clock budget stop names the bar it
      // reached, which differs run to run (fibonacci-dolphintradebot stops this way here)
      const guards = (cols) => Object.fromEntries(Object.entries(registry.columnErrors(cols)).map(([k, e]) => [k, e.guard]))
      expect(guards(b), doc.slug).toEqual(guards(a))
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
      for (const key of Object.keys(a)) { expect(b[key], `${doc.slug}.${key}`).toEqual(a[key]); compared += 1 }
    }
    expect(compared).toBeGreaterThan(0) // non-vacuity: at least one script drew a column on these bars
  }, 120000)

  it('⭐ a member\'s style edit (colour, width) is an instance input: the run columns do not move', () => {
    flagsOn()
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const doc = fixture.documents[0].definition
    const keys = doc.inputs.map((i) => i.key)
    expect(keys).toContain('color')
    expect(keys).toContain('lineWidth')
    mint(fixture.documents[0].slug, 0)
    const { installed } = registry.installUserDefinitions([doc])
    const rows = JSON.parse(fs.readFileSync(DAILY, 'utf8')).bars.rows.slice(-500)
    const bars = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    const base = registry.computeFor(installed[0], bars, {}, ctx)
    const edited = registry.computeFor(installed[0], bars, { color: '#ff0000', lineWidth: 3 }, ctx)
    registry.uninstallUserDefinition(doc.id)
    expect(Object.keys(base).length).toBeGreaterThan(0)
    for (const key of Object.keys(base)) expect(edited[key]).toEqual(base[key])
  }, 60000)
})

describe('RF — what a runtime document does not draw is named, paints included', () => {
  it('⭐ RT6 — inside-bar-range writes two `barcolor`s TradingView paints; the runtime document now DRAWS both, from the run', () => {
    flagsOn()
    const k = RUNTIME_ONLY.indexOf('inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat')
    const { built } = mint(RUNTIME_ONLY[k], k)
    const paints = (built.translation.presentation || {}).paints || []
    expect(paints.filter((p) => p.kind === 'barcolor').length).toBe(2) // non-vacuity: the paints exist
    // RF disclosed them as undrawn; RT6 carries each as a colour column of the run
    expect(built.definition.paints.map((p) => p.kind)).toEqual(['barcolor', 'barcolor'])
    for (const p of built.definition.paints) {
      expect(p.colorMode).toMatch(/^column:/)
      expect(p.colorPacked).toEqual({})
      expect(Number.isInteger(built.definition.compute.outputs[p.colorMode.slice('column:'.length)])).toBe(true)
    }
    expect(built.definition.meta.disclosures.map((d) => d.name)).not.toContain('Not drawn by this pane')
  })

  it('⭐ CONTROL — a runtime document whose script paints nothing carries no such note', () => {
    flagsOn()
    const { built } = mint(RUNTIME_ONLY[0], 0) // adx-and-di-for-v4
    expect(((built.translation.presentation || {}).paints || []).length).toBe(0)
    expect(built.definition.meta.disclosures.map((d) => d.name)).not.toContain('Not drawn by this pane')
  })
})
