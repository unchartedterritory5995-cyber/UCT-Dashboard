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
import { NOT_SHOWN, notShownSentence, withRenderDrops, STOPPED_KEY, plainStopReason, stoppedRunSentence, runtimeWithheldWhy } from '../ast/objectLoss'
import { runtimeColumnsFor } from '../runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../runtimeKill'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'
import { evaluateObjects } from '../objectRuntime'
import { assertObjectProgram } from '../ast/objectProgram'

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
// RUNTIME — every bar pushes a label into a list, the script's limit is 1: TradingView's
// collector reaches a label held only in the list (C7: unmeasured), the family is withheld.
const RT_COLLECTOR = ['//@version=6', 'indicator("oz", overlay = true, max_labels_count = 1)',
  'var float acc = 0', 'acc += close', 'plot(acc)', 'var arr = array.new_label()',
  'arr.push(label.new(bar_index, close, str.tostring(acc, "#")))'].join(LF)
// RUNTIME — a cell written outside its table: the run stops on a step no capture settles (C40).
const RT_STOP = (col) => src(['var float acc = 0', 'acc += close', 'plot(acc)', 'var t = table.new(position.top_right, 2, 2)',
  'if barstate.islast', `    table.cell(t, ${col}, 0, str.tostring(acc, "#"))`])
// HOST — a history offset that goes NEGATIVE on bar 120: a Pine runtime error (C9).
const HOST_STOP = (bad) => src([`n = bar_index == 120 ? ${bad} : 0`, 'if bar_index % 20 == 0',
  '    label.new(bar_index, close[n], "x")', 'plot(close)'])
// HOST — review O4: the same stop (a line read at a NEGATIVE offset on bar 120) in a
// program that also LOSES a create (a label whose text reads another symbol).
const STOP_AND_LOST = (bad) => src(['v = request.security("FOO:BAR", "W", close)',
  `n = bar_index == 120 ? ${bad} : 0`, 'if bar_index % 20 == 0',
  '    line.new(bar_index, close[n], bar_index + 1, close[n])', 'if barstate.islast',
  '    label.new(bar_index, high, str.tostring(v))', 'plot(close)'])
// HOST — a label reading `time("60")` on a daily chart (the C36 clock note says why) beside
// the window-ambiguity line (withheld for a reason the clock note does NOT give).
const CLOCK_AND_OTHER = src(['var float[] w = array.new_float()', 'if close > 0', '    w.unshift(high)',
  'if close > 0', '    w.unshift(low)', 'if w.size() > 3', '    w.pop()',
  'if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "a" : "b")',
  'if barstate.islast and w.size() >= 2', '    line.new(bar_index - 1, w.get(1), bar_index, w.get(1))', 'plot(close)'])
// HOST — the same clock label beside a line placed on the FIRST bar at a `var` the lane
// cannot compute before its warm-up off the listing (C12): withheld through `readUnknown`,
// for a reason the clock note does not give.
const CLOCK_AND_WARMUP = src(['var float acc = 0', 'acc := acc * 0.9 + close',
  'if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "a" : "b")',
  'if barstate.isfirst', '    line.new(bar_index, acc, bar_index + 1, acc)', 'plot(close)'])
// HOST — a label made on the first bar, its text later set from a `time("W")` read: the
// update is withheld by the clock alone, so the taint it leaves is the clock's too (C17).
const CLOCK_TAINT = src(['var label l = na', 'if barstate.isfirst', '    l := label.new(bar_index, high, "x")',
  'if barstate.islast', '    label.set_text(l, na(time("W")) ? "a" : "b")', 'plot(close)'])
// HOST — review O6: a label made KNOWN on the last bar whose text is then set from a
// `time("W")` read. The create reads nothing unknown, so the label is held only for the
// TAINT the clock-withheld update leaves (C17, `taintHeld`), never as a withheld create.
// (CLOCK_TAINT above reaches `famUnknown`: off the listing its `barstate.isfirst` create
// is itself withheld.) The mirror reads the window ambiguity in place of the clock.
const CLOCK_TAINT_HELD = src(['if barstate.islast', '    l = label.new(bar_index, high, "x")',
  '    label.set_text(l, na(time("W")) ? "a" : "b")', 'plot(close)'])
const WINDOW_TAINT_HELD = src(['var float[] w = array.new_float()', 'if close > 0', '    w.unshift(high)',
  'if close > 0', '    w.unshift(low)', 'if w.size() > 3', '    w.pop()',
  'if barstate.islast', '    l = label.new(bar_index, high, "x")',
  '    label.set_text(l, str.tostring(w.get(1)))', 'plot(close)'])
// RUNTIME — `line.get_price` of a vertical line: a step whose answer is not measured (C40).
const RT_GETPRICE = src(['var float acc = 0', 'acc += close', 'plot(acc)', 'if barstate.islast',
  '    l = line.new(bar_index, low, bar_index, high)', '    label.new(bar_index, line.get_price(l, bar_index), str.tostring(acc, "#"))'])
// HOST — a create the clock withholds leaves its register unknown; a second create that
// tests that register (`not na(l)`) is withheld for the TAINT, which is the clock's too.
const CLOCK_TAINT_CREATE = src(['var label l = na', 'if barstate.islast and na(time("W"))',
  '    l := label.new(bar_index, high, "a")', 'if barstate.islast and not na(l)', '    label.new(bar_index, low, "b")', 'plot(close)'])
// HOST — the same shape with the window ambiguity in place of the clock: the register's
// taint is NOT the clock's, so the line the second create would draw is named too.
const WINDOW_TAINT_CREATE = src(['var float[] w = array.new_float()', 'if close > 0', '    w.unshift(high)',
  'if close > 0', '    w.unshift(low)', 'if w.size() > 3', '    w.pop()', 'var label l = na',
  'if barstate.islast and w.size() >= 2', '    l := label.new(bar_index, w.get(1), "x")',
  'if barstate.islast and not na(l)', '    line.new(bar_index - 1, low, bar_index, low)', 'plot(close)'])
const CLOCK_ONLY = src(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "a" : "b")', 'plot(close)'])
// RUNTIME — a plot that converges from any first bar (a decaying max) beside a label
// whose text is a running total: off the listing two starts end with different drawings.
const RT_TWO_STARTS = src(['var float m = 0', 'm := math.max(m * 0.5, close)', 'plot(m)',
  'var float acc = 0', 'acc += close', 'if barstate.islast', '    label.new(bar_index, close, str.tostring(acc, "#"))'])

beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterAll(() => { registry.registerRuntimeLane(null); vi.unstubAllEnvs() })
afterEach(() => { cleanup(); resetObjectRenderDrops(); registry.uninstallUserDefinition(HARNESS_DEF_ID) })

function mount(source, { fromListing = false, tf = 'D' } = {}) {
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
    bars: toProductBars(RDDT), tf,
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
const ENUM_NA_LABEL = notShownSentence(['label'], NOT_SHOWN.ENUM_NA)
const COLLECTOR_LABEL = notShownSentence(['label'], NOT_SHOWN.COLLECTOR_HELD)

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
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: ENUM_NA_LABEL })
    expect(m.text).toContain(ENUM_NA_LABEL)
    expect(m.text).not.toContain('Q-HS1')
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

describe("⭐⭐ OZ r1 — the runtime store's own reasons, each in its own plain words", () => {
  it('⭐ the collector reaching a label held in a list', () => {
    const m = mount(RT_COLLECTOR, { fromListing: true })
    expect(m.def.compute.objects).toBe(true)
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: COLLECTOR_LABEL })
    expect(m.text).toContain(COLLECTOR_LABEL)
    m.binder.teardown()
  })
})

describe('⭐⭐ OZ r1 — a STOPPED run draws nothing and says why, on both lanes', () => {
  it('⭐ host: a negative history offset stops the run (C9); the member reads the reason', () => {
    const m = mount(HOST_STOP('-1'), { fromListing: true })
    expect(m.def.objects).toBeTruthy()
    expect(m.last.labels).toEqual([])
    const why = objectRenderDropsFor(m.id).why
    expect(Object.keys(why)).toEqual([STOPPED_KEY])
    expect(why[STOPPED_KEY]).toMatch(/^None of this script's drawings are shown on this chart: it stops with an error here \(.*bar 120/)
    expect(why[STOPPED_KEY]).not.toContain('`')
    expect(why[STOPPED_KEY]).not.toMatch(/captured|—/)
    // ⭐ OZ r3 (N-2) — the offset as the script writes it, never our placeholder `x`
    expect(why[STOPPED_KEY]).toContain('a history read [-1] ')
    expect(why[STOPPED_KEY]).not.toContain('x[')
    expect(m.text).toContain(why[STOPPED_KEY])
    m.binder.teardown()
  })

  it('⛔ CONTROL — host: the offset stays 0, the labels draw, nothing is said', () => {
    const m = mount(HOST_STOP('0'), { fromListing: true })
    expect(m.last.labels.length).toBeGreaterThan(0)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('⭐ runtime: a cell outside its table stops the run (C40); the member reads the reason', () => {
    const m = mount(RT_STOP(3), { fromListing: true })
    expect(m.def.compute.objects).toBe(true)
    expect(m.last.tables).toEqual([])
    const why = objectRenderDropsFor(m.id).why
    expect(why[STOPPED_KEY]).toMatch(/^None of this script's drawings are shown on this chart: it reaches a step whose result on TradingView has not been measured yet \(table.cell addresses cell \(3, 0\) outside a 2 x 2 table\)/)
    expect(m.text).toContain(why[STOPPED_KEY])
    m.binder.teardown()
  })

  it('⭐ runtime: a step whose answer is not measured is said in plain words (no "captured")', () => {
    const m = mount(RT_GETPRICE, { fromListing: true })
    expect(m.def.compute.objects).toBe(true)
    const why = objectRenderDropsFor(m.id).why
    expect(why[STOPPED_KEY]).toContain('line.get_price of a vertical line: what TradingView answers has not been measured yet')
    expect(why[STOPPED_KEY]).not.toMatch(/captured|`/)
    expect(m.text).toContain(why[STOPPED_KEY])
    m.binder.teardown()
  })

  it('⛔ CONTROL — runtime: the cell is inside the table, it draws, nothing is said', () => {
    const m = mount(RT_STOP(1), { fromListing: true })
    expect(m.last.tables).toHaveLength(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  // ⭐ review O4 — a stopped run names NO family: its one sentence is the stop's. The
  // control proves the same program, run to the end, WOULD name the lost label, so the
  // stopped case is not vacuous.
  it('⛔ O4 — host: a stopped run that also lost a create says only the stop, never the family', () => {
    const m = mount(STOP_AND_LOST('-1'), { fromListing: true })
    expect(m.def.objects).toBeTruthy()
    expect(m.last.lines).toEqual([])
    expect(m.last.labels).toEqual([])
    const why = objectRenderDropsFor(m.id).why
    expect(Object.keys(why)).toEqual([STOPPED_KEY])
    expect(why[STOPPED_KEY]).toMatch(/^None of this script's drawings are shown on this chart: it stops with an error here/)
    expect(m.text).not.toContain(LOST_LABEL)
    m.binder.teardown()
  })

  it('⛔ O4 CONTROL — the same program run to the end draws its lines and names the lost label', () => {
    const m = mount(STOP_AND_LOST('0'), { fromListing: true })
    expect(m.last.lines.length).toBeGreaterThan(0)
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: LOST_LABEL })
    expect(m.text).toContain(LOST_LABEL)
    m.binder.teardown()
  })

  it('⭐ runtime: drawings withheld whole off the listing (two starts disagree); the member reads the reason', () => {
    const m = mount(RT_TWO_STARTS)
    expect(m.def.compute.objects).toBe(true)
    const why = objectRenderDropsFor(m.id).why
    expect(why[STOPPED_KEY]).toMatch(/^None of this script's drawings are shown on this chart: its drawings are not drawn on a chart whose history does not start/)
    expect(m.text).toContain(why[STOPPED_KEY])
    m.binder.teardown()
  })
})

describe('⭐⭐ OZ r1 — with a chart-clock note, a family withheld for ANOTHER reason is still said', () => {
  it('⭐ the clock-withheld label is left to the clock note; the window-withheld line is named', () => {
    const m = mount(CLOCK_AND_OTHER, { tf: '30' })
    expect(m.last.labels).toEqual([])
    expect(m.last.lines).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ line: UNKNOWN_LINE })
    expect(m.text).toContain(UNKNOWN_LINE)
    expect(m.text).toContain('time(')
    expect(m.text).not.toContain(notShownSentence(['label'], NOT_SHOWN.NOT_COMPUTABLE))
    m.binder.teardown()
  })

  it('⭐ a warm-up unknown (not the clock) withholds the line through the same read: it is named', () => {
    const m = mount(CLOCK_AND_WARMUP, { tf: '30' })
    expect(m.def.objects).toBeTruthy()
    expect(m.last.labels).toEqual([])
    expect(m.last.lines).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ line: UNKNOWN_LINE })
    expect(m.text).toContain('time(')
    m.binder.teardown()
  })

  it("⛔ a taint the clock alone left (a withheld set_text) is the clock note's, not a second sentence", () => {
    const m = mount(CLOCK_TAINT, { tf: "30" })
    expect(m.def.objects).toBeTruthy()
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).toContain('time(')
    m.binder.teardown()
  })

  it("⛔ a create withheld for a clock-left TAINT is the clock note's too", () => {
    const m = mount(CLOCK_TAINT_CREATE, { tf: '30' })
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).toContain('time(')
    m.binder.teardown()
  })

  it('⭐ a create withheld for a taint the clock did NOT leave is named with the rest', () => {
    const m = mount(WINDOW_TAINT_CREATE)
    expect(m.last.labels).toEqual([])
    expect(m.last.lines).toEqual([])
    const t = notShownSentence(['line', 'label'], NOT_SHOWN.NOT_COMPUTABLE)
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: t, line: t })
    m.binder.teardown()
  })

  // ⭐ review O6 — the clock filter on the TAINT-HELD path (`taintOtherSeen`)
  it("⛔ O6 — a label held only for a taint the clock left is the clock note's, not a second sentence", () => {
    const m = mount(CLOCK_TAINT_HELD, { tf: '30' })
    expect(m.def.objects).toBeTruthy()
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).toContain('time(')
    m.binder.teardown()
  })

  it('⛔ O6 CONTROL — the same label on a daily chart draws: on 30 minutes only the update is held', () => {
    const m = mount(CLOCK_TAINT_HELD, { tf: 'D' })
    expect(m.last.labels).toHaveLength(1)
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('⭐ O6 — a label held for a taint the window ambiguity left is named', () => {
    const m = mount(WINDOW_TAINT_HELD)
    expect(m.def.objects).toBeTruthy()
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id).why).toEqual({ label: notShownSentence(['label'], NOT_SHOWN.NOT_COMPUTABLE) })
    m.binder.teardown()
  })

  it("⛔ CONTROL — the clock alone: one note (the clock's), no drawing sentence", () => {
    const m = mount(CLOCK_ONLY, { tf: '30' })
    expect(m.last.labels).toEqual([])
    expect(objectRenderDropsFor(m.id)).toBe(null)
    expect(m.text).toContain('time(')
    m.binder.teardown()
  })
})

describe("OZ r2 (N-e) — a stop reason in the member's words", () => {
  const HOST_REASON = '`array.get` index 7 is out of bounds of an array of 3 on bar 120 — TradingView stops the script there'
  it('from the listing the bar is named; no code marks, no em dash', () => {
    expect(plainStopReason(HOST_REASON, true)).toBe('array.get index 7 is out of bounds of an array of 3 on bar 120, TradingView stops the script there')
  })
  it("off the listing no bar number is given (bar_index is this chart's count)", () => {
    const t = stoppedRunSentence(HOST_REASON, 'error', { fromListing: false })
    expect(t).toContain('on a bar of this chart')
    expect(t).not.toMatch(/bar 120|\d{3}/)
  })
  it('"is not captured" is said as has not been measured yet', () => {
    expect(plainStopReason("the script tests `na()` of a drawing that was deleted; whether TradingView answers true there is not captured", true))
      .toBe('the script tests na() of a drawing that was deleted; whether TradingView answers true there has not been measured yet')
  })
  it('"not yet captured" is said as not measured yet', () => {
    expect(plainStopReason('what TradingView draws there is not yet captured', true))
      .toBe('what TradingView draws there is not measured yet')
  })
})

describe('OZ (C22 merge) — the runtime collector sentence follows C22\'s rule', () => {
  const REASON = "TradingView's collector deletes the oldest boxs past 6; one it reaches here is held in an array or a user type, and no capture shows whether such an object is spared"
  it('a box (withheld only for a map, a matrix or a field) never reads "an array"', () => {
    const t = runtimeWithheldWhy({ box: REASON }).box
    expect(t).toBe(notShownSentence(['box'], NOT_SHOWN.COLLECTOR_HELD_BOX))
    expect(t).not.toMatch(/array|list/)
  })
  it('a line or label held in an array does say so; families sharing a cause share a sentence', () => {
    const w = runtimeWithheldWhy({ line: REASON.replace('boxs', 'lines'), label: REASON.replace('boxs', 'labels'), box: REASON })
    expect(w.line).toBe(notShownSentence(['label', 'line'], NOT_SHOWN.COLLECTOR_HELD))
    expect(w.label).toBe(w.line)
    expect(w.line).toContain('an array')
    expect(w.box).toBe(notShownSentence(['box'], NOT_SHOWN.COLLECTOR_HELD_BOX))
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

// ⭐⭐ OZ r3 (review B1) — r2 booked a withhold for a taint as the CLOCK'S whenever no other
// taint had landed. A getter's history two bars back (C48) is unknown and lands no mark, so
// on a chart that never read the clock every box was withheld and NOTHING was said.
describe("⭐⭐ OZ r3 (B1) — a withhold is the clock's only when the clock left a taint", () => {
  const GET2 = { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y', back: 2 }
  const BOX = { k: 'create', family: 'box', site: 's1', into: null,
    props: { left: { v: 'bar' }, top: { v: 'const', value: 2 }, right: { v: 'bar' }, bottom: { v: 'const', value: 1 } } }
  // a label made into r0 every bar; `n0 := label.get_y(r0)[2]`; a box when `n0 > -1`
  const histProg = (clockLabel) => ({ programVersion: 1,
    regs: [{ id: 'r0', family: 'label' }, ...(clockLabel ? [{ id: 'r1', family: 'label' }] : [])],
    colls: [], nums: [{ id: 'n0', init: 0 }],
    ops: [
      // the clock's own withhold (a label whose y reads a column only the clock leaves unknown)
      ...(clockLabel ? [{ k: 'create', family: 'label', site: 's9', into: 'r1', when: null,
        props: { x: { v: 'bar' }, y: { v: 'graph', node: 0 } } }] : []),
      { k: 'create', family: 'label', site: 's0', into: 'r0', when: null, props: { x: { v: 'bar' }, y: { v: 'bar' } } },
      { k: 'setnum', num: 'n0', value: GET2, when: null },
      { ...BOX, when: { v: 'cmp', op: '>', args: [{ v: 'num', id: 'n0' }, { v: 'const', value: -1 }] } },
    ] })
  // CONTROL — the clock alone: a label withheld by the clock into r0, a box guarded by its getter
  const clockProg = () => ({ programVersion: 1, regs: [{ id: 'r0', family: 'label' }], colls: [], nums: [],
    ops: [
      { k: 'create', family: 'label', site: 's0', into: 'r0', when: null, props: { x: { v: 'bar' }, y: { v: 'graph', node: 0 } } },
      { ...BOX, when: { v: 'cmp', op: '>', args: [{ v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y' }, { v: 'const', value: -1 }] } },
    ] })
  // graph node 0 is unknown on every bar, and only through the chart clock's channel
  const CLOCK_CTX = { readUnknown: (n) => n === 0, readUnknownOther: () => false }
  const runIt = (p, ctx = {}) => evaluateObjects(p, { barCount: 12, readNode: () => 1, readTime: (b) => b, ...ctx })
  const boxes = (r) => r.live.filter((o) => o.family === 'box')
  const BOX_NOT_COMPUTABLE = notShownSentence(['box'], NOT_SHOWN.NOT_COMPUTABLE)

  it("⭐ the reviewer's program (no clock anywhere): every box is withheld, and the box family is NAMED", () => {
    expect(() => assertObjectProgram(histProg(false))).not.toThrow()
    const r = runIt(histProg(false))
    expect(boxes(r)).toEqual([])
    expect(r.stats.withheldTainted).toBe(10)
    expect(r.withheldBy).toEqual({ 'objects:not-computable': ['box'] })
    expect(r.withheldWhy).toEqual({ box: BOX_NOT_COMPUTABLE })
    expect(withRenderDrops(null, { dropped: 0, held: 0, why: r.withheldWhy }).note).toBe(BOX_NOT_COMPUTABLE)
  })

  it('⭐ the same history read beside a genuine clock withhold: the box is still named (the clock did not cause it)', () => {
    const r = runIt(histProg(true), CLOCK_CTX)
    expect(boxes(r)).toEqual([])
    expect(r.stats.withheldTainted).toBe(10)
    // the clock-withheld label is the clock note's (r0's labels draw, so no label sentence)
    expect(r.live.filter((o) => o.family === 'label').length).toBe(12)
    expect(r.withheldBy).toEqual({ 'objects:not-computable': ['box'] })
    expect(r.withheldWhy).toEqual({ box: BOX_NOT_COMPUTABLE })
  })

  it("⛔ CONTROL — a box withheld for a taint the clock alone left is the clock note's: no second sentence", () => {
    const r = runIt(clockProg(), CLOCK_CTX)
    expect(boxes(r)).toEqual([])
    expect(r.live).toEqual([])
    expect(r.stats.withheldTainted).toBe(12)
    expect(r.withheldBy).toBeUndefined()
    expect(r.withheldWhy).toBeUndefined()
  })

  it('⛔ CONTROL — the same program off the clock split (every unknown is "other"): both families are named', () => {
    const r = runIt(clockProg(), { readUnknown: (n) => n === 0 })
    expect(r.withheldBy).toEqual({ 'objects:not-computable': ['label', 'box'] })
  })
})

// ⭐⭐ OZ r3 (delta review N-3) — PART (a) OF THE CAUSE RULE CARRIES WEIGHT ON ITS OWN.
// `taintCause = taintClockSeen && !taintOtherSeen && !unknownOtherSeen ? 'clock' : 'other'`.
// `unknownOtherSeen` (part b) misses a CARRIED crossing: `observeCrossings` runs before
// every skip, so an unknown operand on a bar a last-bar-only op does not run sets
// `crossTaintUntil = bar + 1` and lands nothing. On the next bar `tainted({v:'cross'})`
// answers true and sets neither flag. Only `taintClockSeen` (no clock withhold happened)
// then keeps the withhold 'other', so the box family is named. Drop it (mutant MBa) and
// the box is withheld with NOTHING said: the silent zero again. Witness: reviewer's
// `rev-oz-private/zzRevOzCross.test.js`, validator-legal.
describe("⭐⭐ OZ r3 (N-3) — a carried crossing taint with no clock anywhere: the family is named", () => {
  const crossProg = () => ({ programVersion: 1, regs: [{ id: 'r0', family: 'label' }], colls: [],
    ops: [
      { k: 'create', family: 'label', site: 's0', into: 'r0', once: true, when: null,
        props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } } },
      { k: 'create', family: 'box', site: 's1', into: null, lastBarOnly: true,
        when: { v: 'cross', dir: 'over', args: [{ v: 'graph', node: 0 }, { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y' }] },
        props: { left: { v: 'bar' }, top: { v: 'const', value: 2 }, right: { v: 'bar' }, bottom: { v: 'const', value: 1 } } },
    ] })
  const BOX_NOT_COMPUTABLE = notShownSentence(['box'], NOT_SHOWN.NOT_COMPUTABLE)

  it('⭐ a non-clock curtain on bar 5 carried into the last bar: the box is withheld AND named', () => {
    expect(() => assertObjectProgram(crossProg())).not.toThrow()
    // graph node 0 is 0 until bar 5 (unknown there, not through the clock), 2 from bar 6
    const r = evaluateObjects(crossProg(), { barCount: 7, readNode: (n, bar) => (bar >= 6 ? 2 : 0),
      readTime: (b) => b, readUnknown: (n, bar) => n === 0 && bar === 5 })
    expect(r.live.filter((o) => o.family === 'box')).toEqual([])
    expect(r.live.filter((o) => o.family === 'label').length).toBe(1)
    expect(r.withheldBy).toEqual({ 'objects:not-computable': ['box'] })
    expect(r.withheldWhy).toEqual({ box: BOX_NOT_COMPUTABLE })
    expect(withRenderDrops(null, { dropped: 0, held: 0, why: r.withheldWhy }).note).toBe(BOX_NOT_COMPUTABLE)
  })

  it('⛔ CONTROL — the same program with no unknown bar: the box draws and nothing is said', () => {
    const r = evaluateObjects(crossProg(), { barCount: 7, readNode: (n, bar) => (bar >= 6 ? 2 : 0),
      readTime: (b) => b, readUnknown: () => false })
    expect(r.live.filter((o) => o.family === 'box').length).toBe(1)
    expect(r.withheldBy).toBeUndefined()
    expect(r.withheldWhy).toBeUndefined()
  })
})
