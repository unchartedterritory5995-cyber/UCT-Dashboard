// app/src/components/chart/engine/runtime/__tests__/runtimeComputingNote.test.jsx
//
// ⭐ (engine 86) — WHILE A RUNTIME RUN IS IN THE WORKER, THE STRIP SAYS IT IS COMPUTING.
//
// A runtime document answers `{}` while its run is in the worker (`runtimeColumnsFor`), and a host document's run
// half is `pending`: the pane was empty with nothing said. Now the per-instance strip says the background worker
// is still computing it (`nativeRegistry.runtimeRunPendingOf`, published by the binder), on a first load and on a
// symbol or timeframe switch, and goes when the run lands. ⛔ Never on a live chart's next bar (a picture is drawn,
// and a sentence on every update is noise), never a guard id, never on a hidden instance; a refusal replaces it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { createFakeChart, makeBars } from '../../__tests__/fakeChart'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { runtimeErrorNotices, resetRuntimeErrorNotices } from '../../runtimeErrorNotice'
import AttachedPineDisclosures from '../../../pane/AttachedPineDisclosures'
import { computeRuntimeColumns, setRuntimeRunner } from '../runtimeColumns'
import { workerRunner, resetRuntimeAsync } from '../runtimeAsync'
import { withRunHalfState } from '../runtimeObjects'
import { withColumnErrors } from '../../astColumns'
// (engine 86 train, #2044 x #2045) the page's remembered time-budget stops, forgotten between cases
import { resetRuntimeBudgetStops, retryRuntimeBudgetStops } from '../../runtimeBudgetStops'

const REPO = path.resolve(process.cwd(), '..')
const ADX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'adx-and-di-for-v4-rddt-1d-2026-09-27.json')
const ADX_SOURCE = JSON.parse(fs.readFileSync(ADX, 'utf8')).source.text
const DEF_ID = 'u_rt_computing'
const COMPUTING = /the background worker is still computing this script bar by bar on this chart; it is drawn when that finishes/

/** Workers that hold each message until `flush()`; `fail` answers with a named refusal instead. */
function manualWorkers() {
  const made = []
  const factory = () => {
    const w = {
      posted: [], queue: [], fail: null,
      postMessage(msg) { this.posted.push(msg); this.queue.push(msg) },
      flush() {
        const q = this.queue
        this.queue = []
        for (const msg of q) {
          if (!this.onmessage) continue
          if (this.fail) { this.onmessage({ data: { id: msg.id, ok: false, error: { name: 'Error', message: this.fail.message, guard: this.fail.guard } } }); continue }
          const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
          this.onmessage({ data: { id: msg.id, ok: true, columns } })
        }
      },
      terminate() {},
    }
    made.push(w)
    return w
  }
  return { factory, made }
}

describe('the strip while a runtime run computes (real binder, real strip)', () => {
  let fake
  let binder
  let w
  beforeEach(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    resetRuntimeErrorNotices()
    w = manualWorkers()
    // fresh bars per case: the runtime memo is keyed by the bars array, and a landed run would answer the next case
    BARS = makeBars().map((b) => ({ ...b }))
    setRuntimeRunner(workerRunner(w.factory))
    fake = createFakeChart()
    binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const built = memberPaneDefinition({ source: ADX_SOURCE, id: DEF_ID, name: 'ADX and DI' })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(installed.length, errors.join(' | ')).toBe(1)
  })
  afterEach(() => {
    cleanup()
    binder.teardown()
    registry.uninstallUserDefinition(DEF_ID)
    resetRuntimeErrorNotices()
    resetRuntimeAsync()
    setRuntimeRunner(null)
    // (engine 86 train) #2045 remembers a time-budget stop for the PAGE, keyed on document, symbol, timeframe and
    // settings (never the bars), so the refusal case below would answer the next case's first run without a run
    resetRuntimeBudgetStops()
    vi.unstubAllEnvs()
  })
  let BARS = makeBars()
  const ctxFor = (extra = {}, hidden = false) => ({
    enabled: true,
    instances: [{ instanceId: 'i1', defId: DEF_ID, inputs: {}, hidden }],
    registry,
    bars: BARS,
    tf: 'D',
    sym: 'RDDT',
    newestBarIsForming: false,
    historyFromListing: true,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
    resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
    ...extra,
  })
  const settings = { indicatorInstances: [{ instanceId: 'i1', defId: DEF_ID, hidden: false }] }
  const notes = () => runtimeErrorNotices().map(([, s]) => s)

  it('⭐ a first load says it is computing, and the sentence goes when the run lands', () => {
    binder.sync(ctxFor())
    expect(w.made[0].posted.length).toBe(1)
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).toMatch(COMPUTING)
    render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    const row = screen.getByText(/^ADX and DI — the background worker is still computing/)
    expect(row.textContent).not.toMatch(/\b(runtime|pine|strategy|enum):[a-z-]+/)
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(notes()).toEqual([])
    expect(binder.bindings().length).toBeGreaterThan(0)
  })

  it('⛔ a live chart\'s next bar is computing too, and says NOTHING (a picture is drawn)', () => {
    binder.sync(ctxFor())
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(notes()).toEqual([])
    const next = [...BARS, { ...BARS[BARS.length - 1], t: BARS[BARS.length - 1].t + 86400 }]
    binder.sync(ctxFor({ bars: next }))
    expect(w.made[0].posted.length).toBe(2) // the next bar's run is in the worker
    expect(notes()).toEqual([])
  })

  it('⭐ a timeframe or symbol switch has no picture yet: it says it is computing', () => {
    binder.sync(ctxFor())
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(notes()).toEqual([])
    // a switch hands the chart new bars (the binder's memo is keyed by the bars array)
    const hourly = makeBars().map((b) => ({ ...b }))
    binder.sync(ctxFor({ tf: '60', bars: hourly }))
    expect(notes()[0]).toMatch(COMPUTING)
    w.made[w.made.length - 1].flush()
    binder.sync(ctxFor({ tf: '60', bars: hourly }))
    expect(notes()).toEqual([])
    binder.sync(ctxFor({ tf: '60', sym: 'SPY', bars: makeBars().map((b) => ({ ...b, c: b.c + 1 })) }))
    expect(notes()[0]).toMatch(COMPUTING)
  })

  it('⛔ a refusal replaces it, by name', () => {
    binder.sync(ctxFor())
    expect(notes()[0]).toMatch(COMPUTING)
    w.made[0].fail = { guard: 'runtime:time-budget', message: 'this script took more than 1000 ms to draw bar by bar' }
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).toMatch(/^not drawn on this chart \(runtime:time-budget\)/)
  })

  it('⭐ a released chart keeps no picture: drawn again, its first run says it is computing', () => {
    binder.sync(ctxFor())
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(notes()).toEqual([])
    binder.sync({ ...ctxFor(), enabled: false })
    binder.sync(ctxFor({ bars: makeBars().map((b) => ({ ...b })) }))
    expect(notes()[0]).toMatch(COMPUTING)
  })

  it('⛔ (engine 86 train, #2044 x #2045) a picture the time budget stopped says its stop with Retry, never "computing", and posts no run; Retry computes it again', () => {
    const posted = () => w.made.reduce((n, x) => n + x.posted.length, 0)
    binder.sync(ctxFor())
    w.made[0].fail = { guard: 'runtime:time-budget', message: 'this script took more than 1000 ms to draw bar by bar.' }
    w.made[0].flush()
    binder.sync(ctxFor())
    expect(posted()).toBe(1)
    // the live chart's next update (a new bars array, the same picture): the remembered stop, said by name
    binder.sync(ctxFor({ bars: makeBars().map((b) => ({ ...b })) }))
    expect(posted(), 'no run is posted for a remembered stop').toBe(1)
    expect(notes()).toHaveLength(1)
    expect(notes()[0]).not.toMatch(COMPUTING)
    expect(notes()[0]).toMatch(/^not drawn on this chart \(runtime:time-budget\)/)
    expect(notes()[0]).toMatch(/Retry runs it again/)
    // Retry: the stop is forgotten; the next sync runs (no picture of it yet, so the strip says it is computing)
    expect(retryRuntimeBudgetStops(DEF_ID)).toBe(true)
    binder.sync(ctxFor({ bars: makeBars().map((b) => ({ ...b })) }))
    expect(posted()).toBe(2)
    expect(notes()[0]).toMatch(COMPUTING)
  })

  it('⛔ a hidden instance computes nothing and says nothing', () => {
    binder.sync(ctxFor({}, true))
    expect(notes()).toEqual([])
  })
})

describe('what counts as computing (`runtimeRunPendingOf`)', () => {
  const rt = { id: 'x', compute: { kind: 'runtime', fn: 'x', source: '', outputs: { v: 0 } } }
  const host = { id: 'h', compute: { kind: 'ast', fn: 'h', runtimeObjects: { source: '', outputs: {} } } }
  it('⭐ a runtime document\'s in-flight `{}` is computing; columns, a refusal or a reached error are not', () => {
    expect(registry.runtimeRunPendingOf(rt, {}).what).toBe('values')
    expect(registry.runtimeRunPendingOf(rt, { v: [1, 2] })).toBeNull()
    const refused = withColumnErrors({}, { v: { guard: 'runtime:time-budget', message: 'm' } })
    expect(registry.runtimeRunPendingOf(rt, refused)).toBeNull()
    expect(registry.runtimeRunPendingOf(rt, null)).toBeNull()
  })
  it('⭐ a host document whose run half is pending is computing its DRAWINGS; served or none is not', () => {
    const pending = registry.runtimeRunPendingOf(host, withRunHalfState({ a: [1] }, { state: 'pending' }))
    expect(pending.what).toBe('drawings')
    expect(pending.sentence).toBe(registry.RUNTIME_DRAWINGS_COMPUTING_SENTENCE)
    expect(registry.runtimeRunPendingOf(host, withRunHalfState({ a: [1] }, { state: 'served' }))).toBeNull()
    expect(registry.runtimeRunPendingOf(host, { a: [1] })).toBeNull()
  })
})
