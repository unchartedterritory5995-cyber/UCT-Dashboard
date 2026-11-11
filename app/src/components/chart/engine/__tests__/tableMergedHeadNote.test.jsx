// app/src/components/chart/engine/__tests__/tableMergedHeadNote.test.jsx
//
// ─── ⭐⭐ DIV-3 r2 — A MERGED-HEAD REWRITE IS SAID TO THE MEMBER, NOT DROPPED ────
//
// r1 withheld the table family on the HOST lane when a `table.cell` rewrites a
// merged head cell (`objectCells.js`, `MERGED_HEAD_REWRITE`), and set
// `withheldBy` / `withheldWhy` on the run. Review (NO-GO): nothing outside the run
// read `withheldWhy`, so the member saw the table vanish with no note.
//
// r2 carries it through the drawing note's existing route (W-C22-DEL's
// `publishDrops` → `setObjectRenderDrops` → `AttachedPineDisclosures` →
// `objectLoss.js::withRenderDrops`), extended by one field, `why` (family →
// sentence). This rail drives the HOST lane end to end — the member door, the
// binder's sync on real RDDT daily bars, the disclosure strip — and asserts the
// TEXT the member reads.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { objectRenderDropsFor, resetObjectRenderDrops } from '../objectRenderNotice'
import { MERGED_HEAD_REWRITE_SENTENCE } from '../objectCells'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'

const LF = String.fromCharCode(10)
const REPO = path.resolve(process.cwd(), '..')
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness',
  'poor-man039s-volume-profile-rddt-1d-2026-09-28.json'), 'utf8'))

const script = (body) => [
  '//@version=6',
  'indicator("div3 r2", overlay = true)',
  'var t = table.new(position.top_right, 3, 2)',
  'if barstate.islast',
  ...body.map((l) => `    ${l}`),
  'plot(close)',
].join(LF)
const REWRITE = script([
  'table.cell(t, 0, 0, "head", bgcolor = color.blue)',
  'table.merge_cells(t, 0, 0, 1, 0)',
  'table.cell(t, 0, 0, "again")',
])
const NO_REWRITE = script([
  'table.cell(t, 0, 0, "head", bgcolor = color.blue)',
  'table.merge_cells(t, 0, 0, 1, 0)',
  'table.cell_set_text(t, 0, 0, "set")',
])

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })
afterEach(() => { cleanup(); resetObjectRenderDrops(); registry.uninstallUserDefinition(HARNESS_DEF_ID) })

function mount(source) {
  const door = enterMemberDoor(source)
  if (!door.def) throw new Error(door.refusal)
  const def = door.def
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const layerStates = []
  const sync = (over = {}) => binder.sync({
    enabled: true, cs, instances, registry,
    bars: toProductBars(RDDT), tf: 'D',
    symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: (state) => { layerStates.push(state) }, clear: () => {} }),
    ...over,
  })
  return { binder, cs, sync, id: instances[0].instanceId, def, layerStates }
}
const stripText = () => screen.getByTestId('pine-attached-disclosures').textContent

describe('⭐⭐ DIV-3 r2 — the host lane\'s merged-head withholding reaches the member\'s drawing note', () => {
  it('the HOST lane draws it (non-vacuity): an object program, no runtime lane', () => {
    const m = mount(REWRITE)
    expect(m.def.objects).toBeTruthy()
    m.sync()
    // the table is withheld whole: the layer holds no table
    expect(m.layerStates.length).toBeGreaterThan(0)
    expect(m.layerStates[m.layerStates.length - 1].tables).toEqual([])
    m.binder.teardown()
  })

  it('⭐ the member reads the sentence in the drawing note; leaving the chart clears it', () => {
    const m = mount(REWRITE)
    m.sync()
    expect(objectRenderDropsFor(m.id)).toMatchObject({ why: { table: MERGED_HEAD_REWRITE_SENTENCE } })
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} />)
    expect(stripText()).toContain(MERGED_HEAD_REWRITE_SENTENCE)
    expect(stripText()).toContain('This table is not shown')
    act(() => { m.sync({ instances: [] }) })
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('⛔ CONTROL — a patch on the merged head is drawn and nothing is said', () => {
    const m = mount(NO_REWRITE)
    m.sync()
    expect(objectRenderDropsFor(m.id)).toBe(null)
    const last = m.layerStates[m.layerStates.length - 1]
    expect(last.tables).toHaveLength(1)
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} />)
    expect(screen.queryByTestId('pine-attached-disclosures')?.textContent || '').not.toContain('This table is not shown')
    m.binder.teardown()
  })
})
