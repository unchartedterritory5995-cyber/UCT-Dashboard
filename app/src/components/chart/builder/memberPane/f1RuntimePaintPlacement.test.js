// @vitest-environment node
// app/src/components/chart/builder/memberPane/f1RuntimePaintPlacement.test.js
//
// ─── ⭐ F1 — a runtime paint with a whole-number `offset` installs, and keeps it ────
//
// CAP round 4 (`vw-bgcolor-barcolor-spy-1d-2026-10-02`) witnessed that `offset` and
// `show_last` are render-time only: the colour is computed on the unshifted bar and
// the chart shades it `offset` bars over. F1 carries the two numbers on the host
// lane's paint record; the runtime lane (RT6) must carry them too, or it would draw
// the right colour on the wrong bar. And a runtime document with no drawn row keeps
// `value` for RT5's anchor row, so a paint's colour column never takes that key.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'

const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const source = (slug) => fs.readFileSync(path.join(CORPUS, fs.readdirSync(CORPUS).find((f) => f.startsWith(`${slug}__`))), 'utf8')

afterEach(() => { vi.unstubAllEnvs() })

const runtimeDoc = (src, id) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source: src, id, name: 'f1' })
}

describe('⭐ F1 — the runtime lane places a paint where the host lane does', () => {
  it('wyckoff: its only output, `barcolor(..., offset = -2)`, rides with its offset and installs', () => {
    const built = runtimeDoc(source('wyckoff-accumulation-distribution'), 'u_00000000f1a1')
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const [paint] = built.definition.paints
    expect(paint).toMatchObject({ kind: 'barcolor', line: 39, offset: -2 })
    // the colour column is not the RT5 anchor's `value`
    const keys = built.definition.plots.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(paint.colorMode).not.toBe('column:value')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(errors).toEqual([])
    expect(installed).toHaveLength(1)
    registry.uninstallUserDefinition(built.definition.id)
  })

  it('⛔ control: inside-bar-range — runtime paints with no offset carry none, and its drawn row keeps `value`', () => {
    const built = runtimeDoc(source('inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat'), 'u_00000000f1a2')
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(built.definition.paints.length).toBeGreaterThan(0)
    for (const p of built.definition.paints) expect(p.offset, p.kind).toBeUndefined()
    expect(built.definition.plots[0].key).toBe('value')
    expect(built.definition.plots[0].hidden).not.toBe(true)
  })
})
