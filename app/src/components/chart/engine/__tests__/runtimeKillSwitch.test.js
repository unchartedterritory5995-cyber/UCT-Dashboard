// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimeKillSwitch.test.js
//
// ─── ⭐⭐ RF — THE RUNTIME KILL LIST, END TO END ON THE CLIENT ──────────────────
//
// The server half (`tests/test_runtime_document_round_trip.py`) proves a listed
// script's stored row is SERVED stamped `meta.runtimeKilled`, untouched in the
// store, and unstamped again when unlisted. This is the client half, on a REAL
// runtime-only document (the RF fixture):
//   * the next read that serves the stamp takes the INSTALLED copy off this tab
//     (measured before RF: it stayed installed and kept drawing until a reload);
//   * the latched list (by source hash or id) does the same, and the member
//     door's preview falls back to the host lane's refusal;
//   * unlisting brings it back on the next read; nothing is deleted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../nativeRegistry'
import { setRuntimeKillList } from '../runtimeKill'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'runtime_documents', 'documents.json')
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).documents[0]

afterEach(() => {
  setRuntimeKillList([])
  vi.unstubAllEnvs()
})

const flagsOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}

describe('RF — a kill reaches an already-installed runtime document on the next read', () => {
  it('⛔ the served stamp: refused AND the installed copy leaves; unlisting brings it back', () => {
    flagsOn()
    const { definition } = doc()
    const id = definition.id
    try {
      expect(registry.installUserDefinitions([definition]).installed.length).toBe(1)
      expect(registry.getDefinition(id)).not.toBeNull()
      const gen = registry.registryGeneration()
      // the next read: the same row, now stamped by the server (`stamp_served`)
      const stamped = { ...definition, meta: { ...definition.meta, runtimeKilled: `definition \`${id}\` is on the server's runtime kill list` } }
      const r = registry.installUserDefinitions([stamped])
      expect(r.installed).toEqual([])
      expect(r.errors.join(' ')).toMatch(/kill list.*kept/)
      expect(registry.getDefinition(id)).toBeNull() // ⭐ off this tab
      expect(registry.registryGeneration()).toBeGreaterThan(gen) // the chart repaints
      // unlisted: the next read serves it unstamped and it is drawn again
      expect(registry.installUserDefinitions([definition]).installed.length).toBe(1)
      expect(registry.getDefinition(id)).not.toBeNull()
    } finally { registry.uninstallUserDefinition(id) }
  })

  it('⛔ the latched list by source hash does the same, and the preview reads the host refusal', () => {
    flagsOn()
    const { definition } = doc()
    const id = definition.id
    try {
      registry.installUserDefinitions([definition])
      expect(memberPaneDefinition({ source: definition.compute.source, id }).lane).toBe('runtime')
      setRuntimeKillList([definition.meta.runtimeSourceHash.slice(0, 12)])
      registry.installUserDefinitions([definition])
      expect(registry.getDefinition(id)).toBeNull()
      const preview = memberPaneDefinition({ source: definition.compute.source, id })
      expect(preview.ok).toBe(false)
      expect(preview.runtimeDeclined.code).toBe('runtime:killed')
    } finally { registry.uninstallUserDefinition(id) }
  })

  it('⭐ CONTROL — another document in the same read is untouched by the kill', () => {
    flagsOn()
    const docs = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).documents
    const a = docs[0].definition
    const b = docs[1].definition
    try {
      registry.installUserDefinitions([a, b])
      setRuntimeKillList([a.id])
      const r = registry.installUserDefinitions([a, b])
      expect(r.installed.map((d) => d.id)).toEqual([b.id])
      expect(registry.getDefinition(a.id)).toBeNull()
      expect(registry.getDefinition(b.id)).not.toBeNull()
    } finally { registry.uninstallUserDefinition(a.id); registry.uninstallUserDefinition(b.id) }
  })
})
