// app/src/components/chart/engine/__tests__/objectCollectorWithheld.test.jsx
//
// ─── ⭐⭐ W-C22-DEL — A STEP WITHHELD BY A WINDOW AMBIGUITY MOVES THE COLLECTOR ──
//
// Found on vdubus-pattern-gen SPY 1D replayed from the listing (DIV-1,
// `vendorHarness.f6SpyDrawings.test.js`): the C22 window-ambiguity withholding
// (`op.withhold`) withheld CREATES on bars where Pine ran them. The script deletes
// nothing; its lines leave only by Pine's collector (`max_lines_count`). This run
// therefore made fewer lines than TradingView, its collector lagged TradingView's,
// and 48 old lines TradingView had already collected were DRAWN here.
//
// The fix is C33's collector rule, not a second one: a create withheld by
// `op.withhold` is one Pine MAY have made (`noteUnknownCreate`), so once ours plus
// those can pass the family's trigger the family is withheld whole and NAMED
// (`withheldBy['objects:collector']` → the binder → the member's drawing note).
// A bar where the guard's MEASURED conjuncts are false (`op.withholdRuns`) is a
// certain skip (C17's known-false rule): Pine did not run the step there, so it is
// neither withheld nor counted.
//
// Every case has its control.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine, printFormula } from '../ast/pine'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'
import { assertObjectProgram } from '../ast/objectProgram'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { setObjectRenderDrops, objectRenderDropsFor, resetObjectRenderDrops } from '../objectRenderNotice'
import { withRenderDrops, collectorFamiliesSentence, DRAWING_NOTE_NAME } from '../ast/objectLoss'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'
import { compareObjects } from '../../../../../../tools/vendor_harness/compare.mjs'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const N = 160
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const up = (i) => BARS[i].c > BARS[i].o
const higher = (i) => i > 0 && BARS[i].h > BARS[i - 1].h
const rising = (i) => i > 0 && BARS[i].c > BARS[i - 1].c

/** A zig-zag-like window two sites add to (a bar both run on is ambiguous, C22), and
 *  one line per bar whose guard is `<window read> and close > close[1]`. */
const script = (maxLines) => [
  '//@version=5',
  `indicator(${Q}w${Q}, overlay=true, max_lines_count=${maxLines})`,
  'var float[] w = array.new_float()',
  'if close > open',
  '    w.unshift(high)',
  'if high > high[1]',
  '    w.unshift(low)',
  'if w.size() > 3',
  '    w.pop()',
  'if w.size() >= 2 and close > close[1]',
  '    line.new(bar_index - 1, w.get(1), bar_index, w.get(1))',
  'plot(close)',
].join(LF)
const translate = (maxLines) => translatePine(`${script(maxLines)}${LF}`)
const run = (t, ctx = {}) => {
  const reader = objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown, ...ctx,
  })
}
/** Pine's own arrays by hand: per bar, is the read ambiguous (a doubled event among
 *  the last 3), and does the measured conjunct (`close > close[1]`) hold. */
function byHand() {
  const events = []
  const rows = []
  for (let i = 0; i < N; i += 1) {
    const a = up(i)
    const b = higher(i)
    if (a || b) events.unshift(a && b)
    rows.push({ i, ambiguous: events.slice(0, 3).some(Boolean), measured: rising(i) })
  }
  return rows
}
const lineCreate = (t) => t.objects.ops.find((o) => o.k === 'create' && o.family === 'line')

afterEach(() => { cleanup(); resetObjectRenderDrops() })

describe('⭐ the converter: the guard\'s measured conjuncts ride beside the withhold (`withholdRuns`)', () => {
  it('a guard `<window read> and close > close[1]` carries `withholdRuns` = the conjunct that reads no window', () => {
    const t = translate(500)
    const op = lineCreate(t)
    expect(op.withhold).toBeTruthy()
    expect(op.withholdRuns).toBeTruthy()
    const runs = printFormula(t.objects.trees[op.withholdRuns.tree])
    expect(runs).toMatch(/close > close\[1\]/)
    expect(runs).not.toMatch(/valuewhen/)
    expect(() => assertObjectProgram(t.objects)).not.toThrow()
  })

  it('⛔ CONTROL: a guard that is ONLY the window read carries no `withholdRuns`', () => {
    const t = translatePine([
      '//@version=5', `indicator(${Q}w${Q}, overlay=true)`,
      'var float[] w = array.new_float()', 'if close > open', '    w.unshift(high)',
      'if high > high[1]', '    w.unshift(low)', 'if w.size() > 3', '    w.pop()',
      'if w.size() >= 2', '    line.new(bar_index - 1, w.get(1), bar_index, w.get(1))', 'plot(close)', ''].join(LF))
    const op = lineCreate(t)
    expect(op.withhold).toBeTruthy()
    expect(op.withholdRuns).toBeUndefined()
  })

  it('⛔ the validator: `withholdRuns` is legal only beside a `withhold`', () => {
    const t = translate(500)
    const op = lineCreate(t)
    const bad = { ...t.objects, ops: t.objects.ops.map((o) => (o === op ? { ...o, withhold: undefined } : o)) }
    expect(() => assertObjectProgram(bad)).toThrow(/withholdRuns is legal only beside a withhold/)
  })
})

describe('⭐ the runtime: a known-false measured conjunct is a certain skip; every other ambiguous bar is withheld AND counted', () => {
  it('withheld exactly on the ambiguous bars whose measured conjunct holds (hand-run)', () => {
    const rows = byHand()
    const want = rows.filter((r) => r.ambiguous && r.measured).map((r) => r.i)
    const skipped = rows.filter((r) => r.ambiguous && !r.measured).length
    expect(want.length).toBeGreaterThan(5)
    expect(skipped).toBeGreaterThan(5)
    const r = run(translate(500), { trace: true })
    const lineWithheld = r.events.filter((e) => e.k === 'withheld' && e.family === 'line').map((e) => e.bar)
    // ⛔ `w.size() >= 2` is false on the first bars, so a bar can be ambiguous with no
    // line Pine could make: every withheld bar is one the hand-run allows
    expect(lineWithheld.length).toBeGreaterThan(5)
    for (const b of lineWithheld) expect(want).toContain(b)
    // and none of the bars the measured conjunct rules out
    for (const r0 of rows.filter((x) => x.ambiguous && !x.measured)) expect(lineWithheld).not.toContain(r0.i)
  })

  it('⛔ past the collector\'s trigger the family is withheld WHOLE and NAMED; nothing of it is drawn', () => {
    const r = run(translate(50))
    expect(r.live.filter((o) => o.family === 'line')).toEqual([])
    expect(r.withheld.line).toBeGreaterThan(0)
    expect(r.withheldBy).toEqual({ 'objects:collector': ['line'] })
  })

  it('⛔ CONTROL: below the trigger (max_lines_count=500) nothing is collected, the unambiguous lines are drawn and nothing is named', () => {
    const r = run(translate(500))
    expect(r.live.filter((o) => o.family === 'line').length).toBeGreaterThan(20)
    expect(r.withheldBy).toBeUndefined()
  })
})

describe('⭐ the member is told, by name', () => {
  it('the sentence names the families and says why; it joins a document note and stands alone', () => {
    const s = collectorFamiliesSentence(['line', 'linefill'])
    expect(s).toMatch(/^No line or fill between lines is shown on this chart: /)
    expect(s).toMatch(/TradingView has already removed/)
    expect(withRenderDrops(null, { dropped: 0, held: 0, families: ['line'] }))
      .toEqual({ name: DRAWING_NOTE_NAME, note: collectorFamiliesSentence(['line']) })
    expect(withRenderDrops({ name: DRAWING_NOTE_NAME, note: 'A partial.' }, { dropped: 0, held: 0, families: ['box'] }).note)
      .toBe(`A partial. ${collectorFamiliesSentence(['box'])}`)
    // ⛔ CONTROL: no families and no drops ⇒ the document's own note, untouched
    expect(withRenderDrops({ name: DRAWING_NOTE_NAME, note: 'A partial.' }, { dropped: 0, held: 3 }))
      .toEqual({ name: DRAWING_NOTE_NAME, note: 'A partial.' })
  })

  it('the store keeps an entry that names families with nothing dropped, and clears when neither is left', () => {
    setObjectRenderDrops('x', 0, 0, '', ['line'])
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 0, held: 0, families: ['line'] })
    setObjectRenderDrops('x', 2, 4)
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 2, held: 4 })
    setObjectRenderDrops('x', 0, 4, '', [])
    expect(objectRenderDropsFor('x')).toBe(null)
  })
})

describe('⭐⭐ the binder publishes the withheld family and the strip says it (RDDT daily bars)', () => {
  const REPO = path.resolve(process.cwd(), '..')
  const RDDT = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness',
    'poor-man039s-volume-profile-rddt-1d-2026-09-28.json'), 'utf8'))
  beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
  afterAll(() => { vi.unstubAllEnvs() })
  afterEach(() => { registry.uninstallUserDefinition(HARNESS_DEF_ID) })
  function mount(source) {
    const door = enterMemberDoor(source)
    if (!door.def) throw new Error(door.refusal)
    const def = door.def
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const sync = (over = {}) => binder.sync({
      enabled: true, cs, instances, registry,
      bars: toProductBars(RDDT), tf: 'D',
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
      ...over,
    })
    return { binder, cs, sync, id: instances[0].instanceId }
  }

  it('past the trigger: the line family is named in the drawing note; leaving the chart clears it', () => {
    const m = mount(script(50))
    m.sync()
    expect(objectRenderDropsFor(m.id)).toMatchObject({ families: ['line'] })
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain(collectorFamiliesSentence(['line']))
    act(() => { m.sync({ instances: [] }) })
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })

  it('⛔ CONTROL: below the trigger nothing is named', () => {
    const m = mount(script(500))
    m.sync()
    expect(objectRenderDropsFor(m.id)).toBe(null)
    m.binder.teardown()
  })
})

describe('⭐ the vendor harness grades a family withheld by name as a gap, never a MATCH', () => {
  const vendor = { counts: { lines: 504, labels: 129, boxes: 0, tables: 0, tableCells: 0 }, texts: { labels: ['a'], tableCells: [] } }
  const ours = (over = {}) => ({ drawsObjects: true, ok: true,
    counts: { lines: 0, labels: 129, boxes: 0, tables: 0, tableCells: 0 }, texts: { labels: ['a'], tableCells: [] }, ...over })
  it('withheld lines, labels agree ⇒ INCONCLUSIVE, named', () => {
    const v = compareObjects(vendor, ours({ withheldFamilies: ['line', 'linefill'] }))
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.withheld).toBe('objects:collector')
    expect(v.counts.find((r) => r.family === 'lines')).toMatchObject({ vendor: 504, ours: null, withheld: true })
  })
  it('⛔ CONTROL: unnamed, the same counts DIVERGE; and a shown family that differs still DIVERGES', () => {
    expect(compareObjects(vendor, ours()).verdict).toBe('DIVERGE')
    const v = compareObjects(vendor, ours({ withheldFamilies: ['line'], counts: { ...ours().counts, labels: 128 } }))
    expect(v.verdict).toBe('DIVERGE')
  })
})
