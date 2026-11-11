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
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

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

  it('⛔ the validator: `withholdRuns` is a GRAPH column only — a value kind that can be tainted is refused', () => {
    const t = translate(500)
    const op = lineCreate(t)
    const withRuns = (runs) => ({ ...t.objects, ops: t.objects.ops.map((o) => (o === op ? { ...o, withholdRuns: runs } : o)) })
    for (const bad of [{ v: 'const', value: 1 }, { v: 'num', id: 'n0' }, { v: 'unknown' },
      { v: 'bool', op: 'and', args: [{ v: 'const', value: 1 }, { v: 'unknown' }] }, 1]) {
      expect(() => assertObjectProgram(withRuns(bad))).toThrow(/withholdRuns must be a graph column/)
    }
    // CONTROLS: the unbound form (a tree) and the bound form (a graph column) pass
    expect(() => assertObjectProgram(withRuns(op.withholdRuns))).not.toThrow()
    expect(() => assertObjectProgram({ programVersion: 1, regs: [], colls: [], trees: [],
      ops: [{ k: 'create', family: 'label', site: 's1', into: null, when: null,
        props: { x: { v: 'bar' }, y: { v: 'const', value: 1 }, text: { v: 'text', node: { t: 'lit', s: 'a' } } },
        withhold: { v: 'const', value: 1 }, withholdRuns: { v: 'graph', node: 0 } }] })).not.toThrow()
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

  it('⛔ past the collector\'s trigger the line family is NAMED, and only the lines certainly among what TradingView keeps are drawn (W-C22-DEL r3/r4)', () => {
    const t = translate(50)
    const r = run(t, { trace: true })
    // the rule by hand, off the run's own trace: a line's rank from TradingView's newest
    // is at most 1 + (our line creates after it) + (line creates Pine MAY have made
    // after it); the collector always leaves the newest 50, so rank <= 50 is certain
    const creates = r.events.filter((e) => e.k === 'create' && e.family === 'line')
    const marks = []
    let made = 0
    for (const e of r.events) {
      if (e.family !== 'line') continue
      if (e.k === 'create') made += 1
      else if (e.k === 'withheld') marks.push(made)
    }
    // P: one slot per register that may hold a line (objectPool.js C7) — none in this script
    const P = (t.objects.regs || []).filter((g) => g.family === 'line' || !g.family || g.family === '*').length
    expect(P).toBe(0)
    const want = creates.filter((c, seq) => 1 + (creates.length - seq - 1) + marks.filter((m) => m > seq).length + P <= 50)
      .map((c) => c.id)
    expect(marks.length).toBeGreaterThan(0)
    expect(want.length).toBeGreaterThan(5)
    expect(want.length).toBeLessThan(50)
    expect(r.live.filter((o) => o.family === 'line').map((o) => o.id)).toEqual(want)
    expect(r.withheld.line).toBeGreaterThan(0)
    expect(r.withheldBy).toEqual({ 'objects:collector': ['line'] })
  })

  it('⛔ the boundary is exact: a line whose bound rank is EXACTLY the cap is drawn (the collector leaves the newest `cap`), across caps 50..80', () => {
    let boundaryHits = 0
    for (let cap = 50; cap <= 80; cap += 1) {
      const t = translate(cap)
      const r = run(t, { trace: true })
      const creates = r.events.filter((e) => e.k === 'create' && e.family === 'line')
      const marks = []
      let made = 0
      for (const e of r.events) {
        if (e.family !== 'line') continue
        if (e.k === 'create') made += 1
        else if (e.k === 'withheld') marks.push(made)
      }
      if (!r.withheldBy) continue
      const P = (t.objects.regs || []).filter((g) => g.family === 'line' || !g.family || g.family === '*').length
      const rank = (seq) => 1 + (creates.length - seq - 1) + marks.filter((m) => m > seq).length + P
      if (creates.some((c, seq) => rank(seq) === cap)) boundaryHits += 1
      const want = creates.filter((c, seq) => rank(seq) <= cap).map((c) => c.id)
      expect(r.live.filter((o) => o.family === 'line').map((o) => o.id), `cap ${cap}`).toEqual(want)
    }
    // non-vacuity: some cap really puts a line at rank === cap
    expect(boundaryHits).toBeGreaterThan(0)
  })

  it('⛔ CONTROL: below the trigger (max_lines_count=500) nothing is collected, the unambiguous lines are drawn and nothing is named', () => {
    const r = run(translate(500))
    expect(r.live.filter((o) => o.family === 'line').length).toBeGreaterThan(20)
    expect(r.withheldBy).toBeUndefined()
  })
})

describe('⛔ N1 — the skip is claimed only where it is certain', () => {
  // `or` lowers to `||` (`pine.js` boolean operators): a measured term of an `||` proves
  // nothing about whether the step ran, so it is NEVER split into `withholdRuns`
  const orScript = [
    '//@version=5', `indicator(${Q}w${Q}, overlay=true)`,
    'var float[] w = array.new_float()', 'if close > open', '    w.unshift(high)',
    'if high > high[1]', '    w.unshift(low)', 'if w.size() > 3', '    w.pop()',
    'if w.size() >= 2 or close > close[1]', '    line.new(bar_index - 1, w.get(1), bar_index, w.get(1))',
    'plot(close)', ''].join(LF)

  it('an `<ambiguous> or x` guard carries NO `withholdRuns`, and is withheld on EVERY ambiguous bar (hand-run)', () => {
    const t = translatePine(orScript)
    const op = lineCreate(t)
    expect(op.withhold).toBeTruthy()
    expect(op.withholdRuns).toBeUndefined()
    const rows = byHand()
    const ambiguous = rows.filter((r) => r.ambiguous).map((r) => r.i)
    // the bars a split over `||` would have skipped: ambiguous, with the measured term false
    expect(rows.filter((r) => r.ambiguous && !r.measured).length).toBeGreaterThan(5)
    const r = run(t, { trace: true })
    const lineWithheld = r.events.filter((e) => e.k === 'withheld' && e.family === 'line').map((e) => e.bar)
    expect(lineWithheld).toEqual(ambiguous)
  })

  // a hand-built program (the validator's own shape): one create withheld on every bar,
  // its measured conjunct a GRAPH column (the only form `withholdRuns` takes once bound)
  const prog = () => ({
    programVersion: 1, regs: [], colls: [], trees: [],
    ops: [{ k: 'create', family: 'label', site: 's1', into: null, when: null,
      props: { x: { v: 'bar' }, y: { v: 'const', value: 1 }, text: { v: 'text', node: { t: 'lit', s: 'a' } } },
      withhold: { v: 'const', value: 1 }, withholdRuns: { v: 'graph', node: 0 } }],
  })
  /** `col` is the measured conjunct's value on every bar; `unknown`, whether this run can say it. */
  const runProg = (col, unknown) => evaluateObjects(prog(), {
    barCount: 6, readNode: () => col, readTime: () => 0, readUnknown: unknown ? (n) => n === 0 : undefined,
  })

  it('⛔ a measured conjunct whose value is UNKNOWN (it reads 0 here, the curtain says unknown) is withheld, never skipped', () => {
    expect(() => assertObjectProgram(prog())).not.toThrow()
    const r = runProg(0, true)
    expect(r.stats.withheldUnknown).toBe(6)
    expect(r.live).toEqual([])
  })

  it('⛔ CONTROLS: a KNOWN false measured conjunct is skipped (nothing withheld); a known true one is withheld', () => {
    const no = runProg(0, false)
    expect(no.stats.withheldUnknown).toBeUndefined()
    expect(no.live).toEqual([])
    expect(runProg(1, false).stats.withheldUnknown).toBe(6)
  })
})

describe('⭐ the member is told, by name', () => {
  it('the sentences name the families and say why; partial says the newest are drawn, whole says none is', () => {
    const s = collectorFamiliesSentence(['line', 'linefill'])
    expect(s).toMatch(/^Older lines and fills between lines are held back on this chart: /)
    expect(s).toMatch(/TradingView has already removed/)
    expect(s).toMatch(/The newest ones are drawn\.$/)
    expect(s).not.toMatch(/certainly/)
    const w = collectorFamiliesSentence(['line', 'linefill'], { whole: true })
    expect(w).toMatch(/^No lines and fills between lines are shown on this chart: /)
    expect(w).not.toMatch(/drawn/)
    expect(withRenderDrops(null, { dropped: 0, held: 0, families: ['line'] }))
      .toEqual({ name: DRAWING_NOTE_NAME, note: collectorFamiliesSentence(['line']) })
    expect(withRenderDrops(null, { dropped: 0, held: 0, familiesAll: ['line'] }))
      .toEqual({ name: DRAWING_NOTE_NAME, note: collectorFamiliesSentence(['line'], { whole: true }) })
    expect(withRenderDrops({ name: DRAWING_NOTE_NAME, note: 'A partial.' }, { dropped: 0, held: 0, families: ['box'] }).note)
      .toBe(`A partial. ${collectorFamiliesSentence(['box'])}`)
    // ⛔ CONTROL: no families and no drops ⇒ the document's own note, untouched
    expect(withRenderDrops({ name: DRAWING_NOTE_NAME, note: 'A partial.' }, { dropped: 0, held: 3 }))
      .toEqual({ name: DRAWING_NOTE_NAME, note: 'A partial.' })
  })

  it('the store keeps an entry that names families with nothing dropped, and clears when neither is left', () => {
    setObjectRenderDrops('x', 0, 0, '', { families: ['line'] })
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 0, held: 0, families: ['line'] })
    setObjectRenderDrops('x', 0, 0, '', { familiesAll: ['box'] })
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 0, held: 0, familiesAll: ['box'] })
    setObjectRenderDrops('x', 2, 4)
    expect(objectRenderDropsFor('x')).toEqual({ dropped: 2, held: 4 })
    setObjectRenderDrops('x', 0, 4, '', {})
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

// ─── ⭐ r5 (N-g) — a COLLECTION-held object the collector reaches: BOTH lanes withhold the family WHOLE ───
// objectPool.js C7: whether TradingView's collector spares an object held only in an
// array is unmeasured. The runtime lane withholds the family when its collector
// reaches one (`runtime/objectStore.js::collect`); the host lane now does the same,
// under `withheldBy['objects:collector-all']` (the whole-family sentence).
describe('⭐ r5/r6 (N-g) — a `var` array of lines pushed past the cap: the line family is withheld WHOLE on BOTH lanes (not witnessed, Q-C22-1); boxes are witnessed', () => {
  const NB = 300
  const days = Array.from({ length: NB }, (_, i) => new Date(Date.UTC(2021, 0, 4) + i * 86400000))
  const px = (i) => 100 + i * 0.05
  const PRODUCT = days.map((d, i) => ({ t: d.toISOString().slice(0, 10), o: px(i) - 0.5, h: px(i) + 1, l: px(i) - 1, c: px(i), v: 1000 }))
  const RT_BARS = days.map((d, i) => ({ t: Math.floor(d.getTime() / 1000), o: px(i) - 0.5, h: px(i) + 1, l: px(i) - 1, c: px(i), v: 1000 }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(RT_BARS.map((b) => b[k])))
  const src = (hold) => ['//@version=6', 'indicator("t", overlay = true, max_lines_count = 5)',
    ...(hold ? ['var lines = array.new_line()', 'if close > open', '    lines.push(line.new(bar_index, close, bar_index + 1, close))']
      : ['if close > open', '    line.new(bar_index, close, bar_index + 1, close)']), ''].join(LF)
  const hostLane = (hold) => {
    const t = translatePine(src(hold))
    expect(t.objects, 'the host lane carries the program').toBeTruthy()
    const reader = objectReaderFor({ objects: t.objects }, PRODUCT, { tf: 'D', newestBarIsForming: false })
    return evaluateObjects(reader.program, { barCount: NB, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown })
  }
  const runtimeLane = (hold) => {
    const b = buildRuntimeIr(src(hold), { bars: RT_BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    if (!b.ok) throw new Error(`refused: ${b.refusal.guard} — ${b.refusal.message}`)
    const p = lowerIrProgram(b.ir)
    return execute(p, { bars: NB, series: SERIES, columns: p.columns, confirmed: true, barTimes: RT_BARS.map((x) => x.t) }).objects.finish()
  }

  it('held in an array: the host lane withholds lines WHOLE (collector-all), the runtime lane withholds them too', () => {
    const host = hostLane(true)
    expect(host.withheldBy).toEqual({ 'objects:collector-all': ['line'] })
    expect(host.live.filter((o) => o.family === 'line')).toEqual([])
    expect(runtimeLane(true).withheld.line).toMatch(/held in an array or a user type/)
  })

  it('⭐ r6 — BOXES in a `var` array are WITNESSED collected (sonarlab-order-blocks-spy-1d): neither lane withholds, the host lane draws them', () => {
    const boxSrc = ['//@version=6', 'indicator("t", overlay = true, max_boxes_count = 5)', 'var bxs = array.new_box()',
      'if close > open', '    bxs.push(box.new(bar_index, high, bar_index + 1, low))', ''].join(LF)
    const t = translatePine(boxSrc)
    expect(t.objects, 'the host lane carries the program').toBeTruthy()
    const reader = objectReaderFor({ objects: t.objects }, PRODUCT, { tf: 'D', newestBarIsForming: false })
    const host = evaluateObjects(reader.program, { barCount: NB, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown })
    expect(host.withheldBy).toBeUndefined()
    expect(host.live.filter((o) => o.family === 'box').length).toBeGreaterThanOrEqual(5)
    const b = buildRuntimeIr(boxSrc, { bars: RT_BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    if (!b.ok) throw new Error(`refused: ${b.refusal.guard} — ${b.refusal.message}`)
    const p2 = lowerIrProgram(b.ir)
    const fin = execute(p2, { bars: NB, series: SERIES, columns: p2.columns, confirmed: true, barTimes: RT_BARS.map((x) => x.t) }).objects.finish()
    expect(fin.withheld.box).toBeUndefined()
  })

  it('⛔ CONTROL: the same lines held by nothing — the collector is measured, both lanes draw and name nothing', () => {
    const host = hostLane(false)
    expect(host.withheldBy).toBeUndefined()
    expect(host.live.filter((o) => o.family === 'line').length).toBeGreaterThanOrEqual(5)
    expect(runtimeLane(false).withheld.line).toBeUndefined()
  })
})
