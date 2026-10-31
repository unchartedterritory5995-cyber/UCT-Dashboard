// app/src/components/chart/engine/__tests__/noticeScope.test.jsx
//
// ─── ⭐⭐ ONE INSTANCE ID, TWO CHARTS, TWO SETS OF NOTES ────────────────────────
//
// The three bind-time notice stores (`chartClockNotice`, `objectRenderNotice`,
// `runtimeErrorNotice`) were keyed by instance id alone. In the multi-chart grid and
// in seeded workspace widgets one instance id is drawn by several binders, on other
// symbols and timeframes — so chart A's notes showed in chart B's strip, and B's
// prune or teardown cleared A's. Each binder now publishes under its own `scope`
// (`createBinder({scope})`; `StockChart` → `ChartPane` hands the strip the same id),
// and the strip reads only its own. These rails drive the REAL binder and the REAL
// strip for each store: two binders, one instance id, separate notes; one binder's
// prune and teardown clear only its own.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart, makeBars } from './fakeChart'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { setChartClockNotes, chartClockNotesFor, resetChartClockNotes } from '../chartClockNotice'
import { setObjectRenderDrops, objectRenderDropsFor, resetObjectRenderDrops } from '../objectRenderNotice'
import {
  setRuntimeErrorNotice, runtimeErrorNoticeFor, runtimeErrorNotices, resetRuntimeErrorNotices,
} from '../runtimeErrorNotice'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const D1 = load('vw-time-tf-spy-1d-2026-09-28.json')
const H60 = load('vw-time-tf-spy-60-2026-09-28.json')
const RDDT = load('poor-man039s-volume-profile-rddt-1d-2026-09-28.json')

const resetAll = () => { resetChartClockNotes(); resetObjectRenderDrops(); resetRuntimeErrorNotices() }
beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })
beforeEach(resetAll)
afterEach(() => { cleanup(); registry.uninstallUserDefinition(HARNESS_DEF_ID); registry.uninstallUserDefinition(RT_DEF); resetAll() })

describe('the stores — one instance id under two scopes is two entries', () => {
  const A = { code: 'time-anchor:not-daily', reason: 'r-A' }
  const B = { code: 'time-anchor:not-daily', reason: 'r-B' }

  it('chart clock: separate notes; clearing one scope keeps the other', () => {
    setChartClockNotes('i1', 'plots', [A], 'chart-A')
    setChartClockNotes('i1', 'plots', [B], 'chart-B')
    expect(chartClockNotesFor(['i1'], 'chart-A')).toEqual([A])
    expect(chartClockNotesFor(['i1'], 'chart-B')).toEqual([B])
    expect(chartClockNotesFor(['i1'])).toEqual([])            // the unscoped strip reads neither
    setChartClockNotes('i1', 'plots', [], 'chart-B')
    expect(chartClockNotesFor(['i1'], 'chart-A')).toEqual([A])
    expect(chartClockNotesFor(['i1'], 'chart-B')).toEqual([])
  })

  it('render drops: separate counts; clearing one scope keeps the other', () => {
    setObjectRenderDrops('i1', 2, 5, 'chart-A')
    setObjectRenderDrops('i1', 1, 3, 'chart-B')
    expect(objectRenderDropsFor('i1', 'chart-A')).toEqual({ dropped: 2, held: 5 })
    expect(objectRenderDropsFor('i1', 'chart-B')).toEqual({ dropped: 1, held: 3 })
    expect(objectRenderDropsFor('i1')).toBe(null)
    setObjectRenderDrops('i1', 0, 0, 'chart-B')
    expect(objectRenderDropsFor('i1', 'chart-A')).toEqual({ dropped: 2, held: 5 })
    expect(objectRenderDropsFor('i1', 'chart-B')).toBe(null)
  })

  it('runtime error: separate sentences; clearing one scope keeps the other', () => {
    setRuntimeErrorNotice('i1', 'stopped on A', 'chart-A')
    setRuntimeErrorNotice('i1', 'stopped on B', 'chart-B')
    expect(runtimeErrorNoticeFor('i1', 'chart-A')).toBe('stopped on A')
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toBe('stopped on B')
    expect(runtimeErrorNoticeFor('i1')).toBe(null)
    setRuntimeErrorNotice('i1', null, 'chart-B')
    expect(runtimeErrorNotices('chart-A')).toEqual([['i1', 'stopped on A']])
    expect(runtimeErrorNotices('chart-B')).toEqual([])
  })
})

/** Two REAL binders over two recording charts, the same document and the same
 *  instance id on both — the grid / seeded-widget shape. */
function pair(source) {
  const door = enterMemberDoor(source)
  if (!door.def) throw new Error(door.refusal)
  const def = door.def
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const one = (scope) => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope })
    const sync = (capture, tf, over = {}) => binder.sync({
      enabled: true, cs, instances, registry,
      bars: toProductBars(capture), tf,
      symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
      ...over,
    })
    return { binder, sync }
  }
  return { cs, ids: instances.map((i) => i.instanceId), a: one('chart-A'), b: one('chart-B') }
}

describe('⭐ chart clock, through the binder and the strip', () => {
  const SRC = ['//@version=6', 'indicator("scope clock", overlay=true)', 'plot(time("W"), "w")'].join('\n')

  it('A on 30m withholds, B on 1D does not: A\'s strip says so, B\'s strip is empty', () => {
    const m = pair(SRC)
    m.a.sync(H60, '30')
    m.b.sync(D1, 'D')
    expect(chartClockNotesFor(m.ids, 'chart-A').map((n) => n.code)).toEqual(['time-anchor:not-daily'])
    expect(chartClockNotesFor(m.ids, 'chart-B')).toEqual([])
    render(<AttachedPineDisclosures settings={m.cs} barsLoaded={300} noticeScope="chart-B" />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    cleanup()
    render(<AttachedPineDisclosures settings={m.cs} barsLoaded={300} noticeScope="chart-A" />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain('This chart\'s timeframe is `30`')
    m.a.binder.teardown()
    m.b.binder.teardown()
  })

  it('⛔ B\'s prune and B\'s teardown leave A\'s note; A\'s teardown takes it', () => {
    const m = pair(SRC)
    m.a.sync(H60, '30')
    m.b.sync(H60, '30')
    expect(chartClockNotesFor(m.ids, 'chart-B').length).toBe(1)
    act(() => { m.b.sync(H60, '30', { instances: [] }) })          // B prunes
    expect(chartClockNotesFor(m.ids, 'chart-B')).toEqual([])
    expect(chartClockNotesFor(m.ids, 'chart-A').length).toBe(1)
    m.b.sync(H60, '30')
    m.b.binder.teardown()                                          // B tears down
    expect(chartClockNotesFor(m.ids, 'chart-A').length).toBe(1)
    m.a.binder.teardown()
    expect(chartClockNotesFor(m.ids, 'chart-A')).toEqual([])
  })
})

describe('⭐ render drops, through the binder and the strip', () => {
  const SRC = ['//@version=6', 'indicator("scope drops", overlay=true)', 'if barstate.islast',
    '    label.new(bar_index, high, "placed")',
    '    label.new(time + 3 * 86400000 + 9000000, low, "where", xloc = xloc.bar_time)'].join('\n')

  it('A counts a drop, B (indicator off) has none: only A\'s strip says so; B\'s teardown leaves A\'s count', () => {
    const m = pair(SRC)
    m.a.sync(RDDT, 'D')
    m.b.sync(RDDT, 'D', { instances: [] })
    const [id] = m.ids
    expect(objectRenderDropsFor(id, 'chart-A')).toEqual({ dropped: 1, held: 2 })
    expect(objectRenderDropsFor(id, 'chart-B')).toBe(null)
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} noticeScope="chart-B" />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    cleanup()
    render(<AttachedPineDisclosures settings={m.cs} registry={registry} noticeScope="chart-A" />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .toMatch(/1 of the 2 drawings this script holds on this chart could not be placed/)
    cleanup()
    m.b.sync(RDDT, 'D')
    expect(objectRenderDropsFor(id, 'chart-B')).toEqual({ dropped: 1, held: 2 })
    m.b.binder.teardown()
    expect(objectRenderDropsFor(id, 'chart-B')).toBe(null)
    expect(objectRenderDropsFor(id, 'chart-A')).toEqual({ dropped: 1, held: 2 })
    m.a.binder.teardown()
    expect(objectRenderDropsFor(id, 'chart-A')).toBe(null)
  })
})

const RT_DEF = 'u_scope_rt'
describe('⭐ runtime error, through the binder and the strip', () => {
  const SCRIPT = ['//@version=6', 'indicator("scope rt")', 'lim = input.float(100000.0, "Limit")',
    'plot(close, "c")', 'if barstate.islast and close > lim', '    runtime.error("close is above the limit")', ''].join('\n')
  const bars = makeBars()
  const ctxFor = (instances, extra = {}) => ({
    enabled: true, instances, registry, bars, tf: 'D', newestBarIsForming: false,
    adjustTime: (t) => t, plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
    resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
    ...extra,
  })
  const inst = (inputs) => ({ instanceId: 'i1', defId: RT_DEF, inputs, hidden: false })

  it('A stops (its settings reach the error), B does not: separate; B\'s engine-off and teardown leave A\'s', () => {
    const built = memberPaneDefinition({ source: SCRIPT, id: RT_DEF, name: 'Limit check' })
    expect(built.ok, built.reason).toBe(true)
    expect(registry.installUserDefinitions([built.definition]).installed.length).toBe(1)
    const fa = createFakeChart()
    const fb = createFakeChart()
    const a = createBinder({ chart: fa.chart, LWC: fa.LWC, scope: 'chart-A' })
    const b = createBinder({ chart: fb.chart, LWC: fb.LWC, scope: 'chart-B' })
    a.sync(ctxFor([inst({ lim: 1 })]))
    b.sync(ctxFor([inst({ lim: 100000 })]))
    expect(runtimeErrorNoticeFor('i1', 'chart-A')).toContain('close is above the limit')
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toBe(null)
    const settings = { indicatorInstances: [inst({})] }
    render(<AttachedPineDisclosures settings={settings} registry={registry} noticeScope="chart-B" />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    cleanup()
    render(<AttachedPineDisclosures settings={settings} registry={registry} noticeScope="chart-A" />)
    expect(screen.getByTestId('pine-attached-disclosures').textContent).toContain('close is above the limit')
    cleanup()

    b.sync(ctxFor([inst({ lim: 1 })]))
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toContain('close is above the limit')
    b.sync(ctxFor([inst({ lim: 1 })], { enabled: false }))                 // B: engine off
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toBe(null)
    expect(runtimeErrorNoticeFor('i1', 'chart-A')).toContain('close is above the limit')
    b.sync(ctxFor([inst({ lim: 1 })]))
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toContain('close is above the limit')
    b.teardown()                                                           // B: teardown
    expect(runtimeErrorNoticeFor('i1', 'chart-B')).toBe(null)
    expect(runtimeErrorNoticeFor('i1', 'chart-A')).toContain('close is above the limit')
    a.teardown()
    expect(runtimeErrorNotices('chart-A')).toEqual([])
  })
})
