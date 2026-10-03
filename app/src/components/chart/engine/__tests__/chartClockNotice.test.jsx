// app/src/components/chart/engine/__tests__/chartClockNotice.test.jsx
//
// ─── ⭐⭐ C36 — A WITHHELD `time(<timeframe>)` SAYS SO WHERE A MEMBER CAN READ IT ──
//
// C30 withheld every bar of `time("W" / "M" / "3M" / "12M")` on a chart that is
// not daily and said nothing: a member who switched a chart to 60 minutes saw the
// indicator's lines vanish. This file follows the sentence the whole way —
//
//   interpret.js::periodAnchorMask (decides, names the reason)
//     → nativeRegistry.chartClockReport / the object reader's chartClock
//     → binder.sync (publishes both lanes)            ← the REAL binder
//     → chartClockNotice (the store)
//     → AttachedPineDisclosures (the strip a member reads)   ← the REAL component
//
// — and asserts RENDERED TEXT at the end of it, because a state that is set and
// never shown is the failure this repo keeps shipping. Nothing on that path is
// mocked; the chart is the recording double the vendor harness already uses.
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { CHART_CLOCK_WITHHELD } from '../ast/interpret'
import {
  setChartClockNotes, chartClockNotesFor, onChartClockChange, resetChartClockNotes,
} from '../chartClockNotice'
import AttachedPineDisclosures, { attachedInstanceIds } from '../../pane/AttachedPineDisclosures'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const D1 = load('vw-time-tf-spy-1d-2026-09-28.json')
const H60 = load('vw-time-tf-spy-60-2026-09-28.json')
const pine = (lines) => ['//@version=6', 'indicator("c36 notice", overlay=true)', ...lines].join('\n')

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })
beforeEach(() => { resetChartClockNotes() })
afterEach(() => { cleanup(); registry.uninstallUserDefinition(HARNESS_DEF_ID); resetChartClockNotes() })

describe('the store — what one lane of one instance withholds, and why', () => {
  const A = { code: 'time-anchor:not-daily', reason: 'r1' }
  const B = { code: 'time-own:chart-unwitnessed', reason: 'r2' }

  it('holds per (instance, lane), reads back deduped across lanes and instances', () => {
    setChartClockNotes('i1', 'plots', [A])
    setChartClockNotes('i1', 'objects', [A, B])
    setChartClockNotes('i2', 'plots', [B])
    expect(chartClockNotesFor(['i1'])).toEqual([A, B])
    expect(chartClockNotesFor(['i2', 'i1'])).toEqual([B, A])
    expect(chartClockNotesFor(['nobody'])).toEqual([])
    expect(chartClockNotesFor([])).toEqual([])
  })

  it('an empty list CLEARS the lane — and only that lane', () => {
    setChartClockNotes('i1', 'plots', [A])
    setChartClockNotes('i1', 'objects', [B])
    setChartClockNotes('i1', 'plots', [])
    expect(chartClockNotesFor(['i1'])).toEqual([B])
  })

  it('emits on a real change only — an identical republish (every sync) costs nothing', () => {
    const fn = vi.fn()
    const off = onChartClockChange(fn)
    setChartClockNotes('i1', 'plots', [A])
    setChartClockNotes('i1', 'plots', [{ ...A }])
    setChartClockNotes('i1', 'plots', [A])
    expect(fn).toHaveBeenCalledTimes(1)
    setChartClockNotes('i1', 'plots', [])
    setChartClockNotes('i1', 'plots', [])
    expect(fn).toHaveBeenCalledTimes(2)
    off()
    setChartClockNotes('i1', 'plots', [A])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('refuses a malformed row rather than rendering `undefined` to a member', () => {
    setChartClockNotes('i1', 'plots', [{ code: 'x' }, null, { reason: 'y' }, A])
    expect(chartClockNotesFor(['i1'])).toEqual([A])
    setChartClockNotes('', 'plots', [A])
    expect(chartClockNotesFor([''])).toEqual([])
  })
})

/** The real binder over the recording chart, on a capture's bars at a timeframe. */
function mount(source) {
  const door = enterMemberDoor(source)
  if (!door.def) throw new Error(door.refusal)
  const def = door.def
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const sync = (capture, tf, over = {}) => binder.sync({
    enabled: true, cs, instances, registry,
    bars: toProductBars(capture), tf,
    symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false,
    adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
    ...over,
  })
  return { binder, cs, instances, sync, ids: instances.map((i) => i.instanceId) }
}

describe('the binder publishes what the mask decided — plots and objects', () => {
  // ⭐ C49 — the unmeasured chart in this file is a 30-minute one. It was the
  // 60-minute chart until `time(<period>)` was measured there and served
  // (`vendorHarness.c49CapturedClock.test.js`); the plumbing under test is the same.
  it('⭐ 30m: the plot lane\'s reason reaches the store; back on 1D it is gone', () => {
    const m = mount(pine(['plot(time("W"), "w")']))
    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids)).toEqual([
      { code: 'time-anchor:not-daily', reason: CHART_CLOCK_WITHHELD['time-anchor:not-daily']('30') },
    ])
    m.sync(D1, 'D')
    expect(chartClockNotesFor(m.ids)).toEqual([])
    m.binder.teardown()
  })

  it('an OBJECTS-ONLY script (no plot reads the anchor) still says why its drawings are gone', () => {
    const m = mount(pine(['plot(close)', 'if barstate.islast', '    label.new(bar_index, high, na(time("M")) ? "na" : "known")']))
    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids).map((n) => n.code)).toEqual(['time-anchor:not-daily'])
    m.binder.teardown()
  })

  it('⛔ an indicator that leaves the chart takes its sentence with it — removed, hidden, torn down, engine off', () => {
    const m = mount(pine(['plot(time("W"), "w")', 'if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids).length).toBe(1)
    m.sync(H60, '30', { instances: [] })
    expect(chartClockNotesFor(m.ids)).toEqual([])

    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids).length).toBe(1)
    m.sync(H60, '30', { instances: m.instances.map((i) => ({ ...i, hidden: true })) })
    expect(chartClockNotesFor(m.ids)).toEqual([])

    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids).length).toBe(1)
    m.sync(H60, '30', { enabled: false })
    expect(chartClockNotesFor(m.ids)).toEqual([])

    m.sync(H60, '30')
    expect(chartClockNotesFor(m.ids).length).toBe(1)
    m.binder.teardown()
    expect(chartClockNotesFor(m.ids)).toEqual([])
  })

  it('CONTROL — a script that reads no `time(<timeframe>)` publishes nothing on any chart', () => {
    const m = mount(pine(['plot(close)']))
    const fn = vi.fn()
    onChartClockChange(fn)
    m.sync(H60, '30')
    m.sync(D1, 'D')
    expect(chartClockNotesFor(m.ids)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
    m.binder.teardown()
  })

  it('a registry without the report (a test double) publishes nothing and breaks nothing', () => {
    const m = mount(pine(['plot(time("W"), "w")']))
    const bare = { ...registry, chartClockReport: undefined }
    const res = m.sync(H60, '30', { registry: bare, createObjectLayer: undefined })
    expect(res.ok).toBe(true)
    expect(chartClockNotesFor(m.ids)).toEqual([])
    m.binder.teardown()
  })
})

describe('⭐ the strip — the sentence, as RENDERED TEXT, on the member\'s own chart', () => {
  it('a 30m chart shows the reason; switching the chart to 1D removes it', () => {
    const m = mount(pine(['plot(time("W"), "w")']))
    render(<AttachedPineDisclosures settings={m.cs} barsLoaded={300} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()

    act(() => { m.sync(H60, '30') })
    const strip = screen.getByTestId('pine-attached-disclosures')
    expect(strip.textContent).toContain('are read here on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts')
    expect(strip.textContent).toContain('This chart\'s timeframe is `30`')
    expect(strip.textContent).toContain('What would settle it here: the `vw-time-tf` probe measured on this timeframe.')
    expect(strip.textContent).toContain(CHART_CLOCK_WITHHELD['time-anchor:not-daily']('30'))

    act(() => { m.sync(D1, 'D') })
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    m.binder.teardown()
  })

  it('`time(timeframe.period)` on a chart no capture measured: its own sentence', () => {
    const m = mount(pine(['plot(time(timeframe.period), "own")']))
    render(<AttachedPineDisclosures settings={m.cs} barsLoaded={300} />)
    act(() => { m.sync(H60, '30') })
    expect(screen.getByTestId('pine-attached-disclosures').textContent)
      .toContain('`time(timeframe.period)` and `time("60")` are read on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts')
    act(() => { m.sync(H60, '60') })
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    m.binder.teardown()
  })

  it('⛔ ONLY this pane\'s instances: another pane\'s withheld indicator does not speak here', () => {
    const m = mount(pine(['plot(time("W"), "w")']))
    act(() => { m.sync(H60, '30') })
    const other = { indicatorInstances: [{ instanceId: 'someone-else', defId: HARNESS_DEF_ID }] }
    render(<AttachedPineDisclosures settings={other} barsLoaded={300} />)
    expect(screen.queryByTestId('pine-attached-disclosures')).toBeNull()
    m.binder.teardown()
  })

  it('a HIDDEN instance draws nothing, so it discloses nothing', () => {
    expect(attachedInstanceIds({ indicatorInstances: [
      { instanceId: 'a', defId: 'x' }, { instanceId: 'b', defId: 'x', hidden: true }, null, { defId: 'x' },
    ] })).toEqual(['a'])
    expect(attachedInstanceIds(null)).toEqual([])
  })

  it('one sentence, however many lanes and plots raise it', () => {
    const m = mount(pine(['plot(time("W"), "w")', 'plot(time("M"), "m")', 'if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    render(<AttachedPineDisclosures settings={m.cs} barsLoaded={300} />)
    act(() => { m.sync(H60, '30') })
    expect(screen.getByTestId('pine-attached-disclosures').querySelectorAll('li').length).toBe(1)
    m.binder.teardown()
  })
})
