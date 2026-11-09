// app/src/components/chart/engine/__tests__/objectsNotShownNote.test.jsx
//
// ─── ⭐⭐ OZ — A DRAWING FAMILY SHOWN AS NONE FOR THE ENGINE'S OWN REASON IS SAID ──
//
// DIVERGE triage 2026-11-08, lane 5: seven scripts (ATR S/R, Liquidity Heatmap, Poor
// Man's VP, Volume Profile, K-Clustering, HTF Candle Footprint, Max Pain) ran with the
// object lane `ok`, withheld nothing by name, and drew no line / label / box where
// TradingView draws dozens. The engine knew why every time: the translation lost the
// creates (`lostCreates`), or every create the run reached was withheld, or every
// object it made carried a value it could not compute. Nothing outside the run said so.
//
// The sentence rides the existing drawing-note route (W-C22-DEL + DIV-3 r2):
//   run.withheldWhy → binder.publishDrops(why) → setObjectRenderDrops →
//   AttachedPineDisclosures → objectLoss.withRenderDrops
// on the HOST lane (`objectRuntime.js` `notShown`) and on the RUNTIME lane (the run's
// own withheld families, `runtimeWithheldWhy`). This rail drives the member door, the
// real binder on RDDT daily bars and the disclosure strip, and reads the note TEXT.
// Every case has a control of the same shape that draws and says nothing.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
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
import { NOT_SHOWN, notShownSentence, withRenderDrops } from '../ast/objectLoss'
import { runtimeColumnsFor } from '../runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../runtimeKill'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'

const LF = String.fromCharCode(10)
const REPO = path.resolve(process.cwd(), '..')
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness',
  'poor-man039s-volume-profile-rddt-1d-2026-09-28.json'), 'utf8'))

const H = ['//@version=6', 'indicator("oz", overlay = true)']
const src = (lines) => [...H, ...lines].join(LF)
// HOST — the label's text reads another symbol's series the engine cannot serve, so the
// translation loses the create (`lostCreates: ['label']`); the table beside it is carried.
const LOST = (text) => src(['var t = table.new(position.bottom_left, 1, 1)',
  'v = request.security("FOO:BAR", "W", close)', 'if barstate.islast',
  '    table.cell(t, 0, 0, "hi")', `    label.new(bar_index, high, ${text})`, 'plot(close)'])
// HOST — a line whose guard reads a window two sites add to on the SAME bar: which
// element Pine reads there is not measured (C22), so the create is withheld on every
// bar it is reached (`famUnknown`). Control: one site adds, the read is settled, it draws.
const WINDOW = (both) => src(['var float[] w = array.new_float()', 'if close > 0', '    w.unshift(high)',
  ...(both ? ['if close > 0', '    w.unshift(low)'] : []), 'if w.size() > 3', '    w.pop()',
  'if barstate.islast and w.size() >= 2', '    line.new(bar_index - 1, w.get(1), bar_index, w.get(1))', 'plot(close)'])
// RUNTIME — a running `var` total only a per-bar run computes, so the document's
// drawings ride its run (`compute.objects`).
const RT = (body) => src(['var float acc = 0', 'acc += close', 'plot(acc)', 'if barstate.islast', ...body.map((l) => `    ${l}`)])
const RT_MERGED = src(['var float acc = 0', 'acc += close', 'plot(acc)', 'var t = table.new(position.top_right, 3, 2)',
  'if barstate.islast', '    table.cell(t, 0, 0, str.tostring(acc, "#"))', '    table.merge_cells(t, 0, 0, 1, 0)',
  '    table.cell(t, 0, 0, "again")'])
const RT_ENUM_NA = RT(['label.new(bar_index, close, str.tostring(acc, "#"), style = close > 0 ? na : label.style_label_up)'])
const RT_OK = RT(['label.new(bar_index, close, str.tostring(acc, "#"))'])

beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterAll(() => { registry.registerRuntimeLane(null); vi.unstubAllEnvs() })
afterEach(() => { cleanup(); resetObjectRenderDrops(); registry.uninstallUserDefinition(HARNESS_DEF_ID) })

function mount(source, { fromListing = false } = {}) {
  const door = enterMemberDoor(source)
  if (!door.def) throw new Error(door.refusal)
  const def = door.def
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const layerStates = []
  binder.sync({
    enabled: true, cs, instances, registry,
    bars: toProductBars(RDDT), tf: 'D',
    symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
    ...(fromListing ? { historyFromListing: true } : {}),
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: (state) => { layerStates.push(state) }, clear: () => {} }),
  })
  const last = layerStates.length ? layerStates[layerStates.length - 1] : null
  render(<AttachedPineDisclosures settings={cs} registry={registry} />)
  const text = screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
  return { binder, def, id: instances[0].instanceId, last, text }
}

const LOST_LABEL = notShownSentence(['label'], NOT_SHOWN.NOT_CARRIED)
const UNKNOWN_LINE = notShownSentence(['line'], NOT_SHOWN.NOT_COMPUTABLE)
const UNMEASURED_LABEL = notShownSentence(['label'], NOT_SHOWN.UNMEASURED)

describe('⭐⭐ OZ — the HOST lane says why a family is shown as none', () => {
  it('⭐ a lost create: no label is drawn, and the member reads why', () => {
    const m = mount(LOST('str.tostring(v)'))
    expect(m.def.objects).toBeTruthy()
    expect(m.def.compute && m.def.compute.kind).not.toBe('runtime')
    expect(m.last.labels).toEqual([])
    expect(m.last.tables).toHaveLength(1) // the carried table still draws
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: LOST_LABEL })
    expect(m.text).toContain(LOST_LABEL)
    expect(m.text).toContain('No label is shown on this chart')
    m.binder.teardown()
  })

  it('⛔ CONTROL — the same program with a label the engine carries draws it and says nothing', () => {
    const m = mount(LOST('str.tostring(close)'))
    expect(m.last.labels.length).toBe(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).not.toContain('is shown on this chart')
    m.binder.teardown()
  })

  it('⛔ CONTROL — a family still partly drawn is not named (the lost create is the translation\'s "incomplete" note)', () => {
    const m = mount(LOST('str.tostring(v)').replace('plot(close)', '    label.new(bar_index, low, "kept")' + LF + 'plot(close)'))
    expect(m.last.labels.length).toBe(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).not.toContain('is shown on this chart')
    m.binder.teardown()
  })

  it('⭐ every create withheld (an unmeasured window read): the member reads why', () => {
    const m = mount(WINDOW(true))
    expect(m.def.objects).toBeTruthy()
    expect(m.last.lines).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ line: UNKNOWN_LINE })
    expect(m.text).toContain(UNKNOWN_LINE)
    m.binder.teardown()
  })

  it('⛔ CONTROL — one site adds to the window: the read is settled, the line draws, nothing is said', () => {
    const m = mount(WINDOW(false))
    expect(m.last.lines.length).toBe(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).not.toContain('is shown on this chart')
    m.binder.teardown()
  })
})

describe('⭐⭐ OZ — the RUNTIME lane says why a family it withheld is shown as none', () => {
  it('⭐ a family the run withheld by a rule of its own: the member reads why', () => {
    const m = mount(RT_ENUM_NA, { fromListing: true })
    expect(m.def.compute.kind).toBe('runtime')
    expect(m.def.compute.objects).toBe(true)
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: UNMEASURED_LABEL })
    expect(m.text).toContain(UNMEASURED_LABEL)
    m.binder.teardown()
  })

  it('⭐ a merged-head rewrite says the same sentence the host lane says', () => {
    const m = mount(RT_MERGED, { fromListing: true })
    expect(m.def.compute.objects).toBe(true)
    expect(m.last.tables).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ table: MERGED_HEAD_REWRITE_SENTENCE })
    expect(m.text).toContain(MERGED_HEAD_REWRITE_SENTENCE)
    m.binder.teardown()
  })

  it('⛔ CONTROL — a runtime label the run draws says nothing', () => {
    const m = mount(RT_OK, { fromListing: true })
    expect(m.def.compute.objects).toBe(true)
    expect(m.last.labels.length).toBe(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).not.toContain('is shown on this chart')
    m.binder.teardown()
  })
})

describe('OZ — the note says a shared sentence once', () => {
  it('two families under one sentence read as one sentence', () => {
    const t = notShownSentence(['line', 'box'], NOT_SHOWN.NOT_CARRIED)
    expect(t).toBe("No line or box is shown on this chart: the script makes them in steps this chart can't "
      + 'follow yet, so none are drawn here, though TradingView may draw some.')
    const n = withRenderDrops(null, { dropped: 0, held: 0, why: { line: t, box: t } })
    expect(n.note).toBe(t)
  })
})
