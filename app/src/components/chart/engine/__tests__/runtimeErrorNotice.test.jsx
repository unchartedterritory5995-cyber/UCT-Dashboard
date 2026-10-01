// app/src/components/chart/engine/__tests__/runtimeErrorNotice.test.jsx
//
// ─── C43 — A STOPPED SCRIPT TELLS THE MEMBER WHY ITS PANE IS EMPTY ──────────────
//
// `vendorHarness.c43RuntimeError` pins the DECISION (reached / not / unknown) on
// TradingView's captures. This file pins the WIRE: the binder that computes an
// instance publishes the sentence, the disclosure strip under the chart renders
// it, and the sentence leaves with the instance. Each half was green alone before
// either was connected to the other, which is the failure this repo keeps paying
// for — so the test drives the real binder, the real registry and the real strip.
//
// And the runtime lane (dark flag): C35's `PineRuntimeError` now ends in the same
// witnessed result — no column, the script's message in TradingView's words.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

import { createBinder } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import {
  setRuntimeErrorNotice, runtimeErrorNoticeFor, runtimeErrorNotices, resetRuntimeErrorNotices,
} from '../runtimeErrorNotice'
import { runtimeErrorWords, RUNTIME_ERROR_TITLE } from '../runtimeErrorText'
import AttachedPineDisclosures, { attachedRuntimeErrors } from '../../pane/AttachedPineDisclosures'
import { objectReaderFor } from '../objectColumns'
import { runtimeColumnsFor } from '../runtime/runtimeColumns'

const LF = String.fromCharCode(10)
const DEF_ID = 'u_c43_notice'
// reached only when the member lowers `lim` below the close (~100+), on the newest bar
const SCRIPT = ['//@version=6', 'indicator("c43 notice")', 'lim = input.float(100000.0, "Limit")',
  'plot(close, "c")', 'if barstate.islast and close > lim', '    runtime.error("close is above the limit")', ''].join(LF)

const bars = makeBars()
const install = (source = SCRIPT) => {
  const built = memberPaneDefinition({ source, id: DEF_ID, name: 'Limit check' })
  expect(built.ok, built.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
const inst = (inputs = {}, extra = {}) => ({ instanceId: 'i1', defId: DEF_ID, inputs, hidden: false, ...extra })
const ctxFor = (instances, extra = {}) => ({
  enabled: true,
  instances,
  registry,
  bars,
  tf: 'D',
  newestBarIsForming: false,
  adjustTime: (t) => t,
  plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
  ...extra,
})

let fake
let binder
beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  resetRuntimeErrorNotices()
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => {
  cleanup()
  binder.teardown()
  registry.uninstallUserDefinition(DEF_ID)
  resetRuntimeErrorNotices()
  vi.unstubAllEnvs()
})

describe('C43 — the binder publishes a reached `runtime.error`, per instance', () => {
  it('⭐ at the default the script draws and nothing is published', () => {
    install()
    binder.sync(ctxFor([inst()]))
    expect(runtimeErrorNotices()).toEqual([])
    expect(binder.bindings().length).toBeGreaterThan(0)
  })

  it('⭐ at the member\'s own setting the script stops: no series is bound and the sentence is published', () => {
    install()
    binder.sync(ctxFor([inst({ lim: 1 })]))
    expect(binder.bindings()).toEqual([])
    const sentence = runtimeErrorNoticeFor('i1')
    expect(sentence).toContain('close is above the limit')
    expect(sentence.startsWith(`${RUNTIME_ERROR_TITLE}: `)).toBe(true)
  })

  it('⭐ the sentence leaves when the setting no longer reaches the error, when the instance is hidden, removed, or the binder is released', () => {
    install()
    binder.sync(ctxFor([inst({ lim: 1 })]))
    expect(runtimeErrorNoticeFor('i1')).toBeTruthy()
    binder.sync(ctxFor([inst({ lim: 100000 })]))
    expect(runtimeErrorNoticeFor('i1')).toBeNull()

    binder.sync(ctxFor([inst({ lim: 1 })]))
    binder.sync(ctxFor([inst({ lim: 1 }, { hidden: true })]))
    expect(runtimeErrorNoticeFor('i1')).toBeNull()

    binder.sync(ctxFor([inst({ lim: 1 })]))
    binder.sync(ctxFor([]))
    expect(runtimeErrorNoticeFor('i1')).toBeNull()

    binder.sync(ctxFor([inst({ lim: 1 })]))
    expect(runtimeErrorNoticeFor('i1')).toBeTruthy()
    binder.teardown()
    expect(runtimeErrorNotices()).toEqual([])
  })

  it('⛔ CONTROL — with the stop evaluator unregistered the plot lane computes as it did before C43', async () => {
    const def = install()
    const { runtimeErrorStopFor } = await import('../runtimeErrorStop')
    registry.registerRuntimeErrorStop(null)
    try {
      const cols = registry.computeFor(def, bars, { lim: 1 }, { tf: 'D', newestBarIsForming: false })
      expect(Object.keys(cols)).toEqual(['value'])
      expect(registry.runtimeErrorStopOf(cols)).toBeNull()
    } finally {
      registry.registerRuntimeErrorStop(runtimeErrorStopFor)
    }
    // and registered again it stops
    expect(Object.keys(registry.computeFor(def, bars, { lim: 1 }, { tf: 'D', newestBarIsForming: false }))).toEqual([])
  })
})

describe('C43 — the disclosure strip renders it', () => {
  const settings = (over = {}) => ({ indicatorInstances: [{ instanceId: 'i1', defId: DEF_ID, hidden: false, ...over }] })

  it('⭐ the row names the script and carries the sentence; it appears and leaves with the notice', () => {
    install()
    render(<AttachedPineDisclosures settings={settings()} registry={registry} />)
    expect(screen.queryByText(/stopped itself/)).toBeNull()
    const { sentence } = runtimeErrorWords({ message: 'close is above the limit', bar: 259, barKnown: false })
    act(() => { setRuntimeErrorNotice('i1', sentence) })
    const row = screen.getByText(/close is above the limit/)
    expect(row.textContent).toBe(`Limit check — ${sentence}`)
    act(() => { setRuntimeErrorNotice('i1', null) })
    expect(screen.queryByText(/close is above the limit/)).toBeNull()
  })

  it('⛔ a hidden instance, and an instance of another chart, say nothing', () => {
    install()
    setRuntimeErrorNotice('i1', 'User-defined error: x')
    expect(attachedRuntimeErrors(settings({ hidden: true }), registry)).toEqual([])
    expect(attachedRuntimeErrors({ indicatorInstances: [{ instanceId: 'other', defId: DEF_ID }] }, registry)).toEqual([])
    expect(attachedRuntimeErrors(settings(), registry)).toHaveLength(1)
  })
})

describe('C43 — the words: TradingView\'s sentence, and what is not said', () => {
  it('⭐ a known bar says TradingView\'s text; an unknown one says the message without a bar number', () => {
    const known = runtimeErrorWords({ message: 'UCTPROBE stop at bar 100', bar: 100, barKnown: true })
    expect(known.tradingViewText).toBe('Error on bar 100: UCTPROBE stop at bar 100')
    expect(known.sentence).toContain('Error on bar 100: UCTPROBE stop at bar 100')
    const unknown = runtimeErrorWords({ message: 'UCTPROBE stop at bar 100', bar: 4, barKnown: false })
    expect(unknown.tradingViewText).toBeNull()
    expect(unknown.sentence).toContain('UCTPROBE stop at bar 100')
    expect(unknown.sentence).not.toMatch(/Error on bar/)
  })

  it('⛔ a message this lane could not read is not invented', () => {
    const w = runtimeErrorWords({ message: null, bar: 0, barKnown: true })
    expect(w.tradingViewText).toBeNull()
    expect(w.sentence).toMatch(/whose message is built from values this chart does not read as text/)
  })
})

describe('C43 — the runtime lane (dark flag): C35\'s `PineRuntimeError` ends in the same result', () => {
  const RT_ID = 'u_c43_rt'
  const rtDef = (source) => ({
    id: RT_ID,
    version: 1,
    // `fn` is the document's hash of its source: the lane memoises a run on it
    compute: { kind: 'runtime', fn: `c43-rt:${source.length}:${source}`, source, outputs: { value: 0 } },
    meta: { name: 'rt' },
    plots: [{ key: 'value' }],
    objects: { programVersion: 1, regs: [], colls: [], trees: [],
      ops: [{ k: 'create', family: 'label', site: 's1', into: null, when: null, props: { x: { v: 'bar' }, y: { v: 'const', value: 1 } } }] },
  })
  const SRC = (bar) => ['//@version=6', 'indicator("c43 rt")', `if bar_index == ${bar}`,
    '    runtime.error("stop at seven")', 'plot(close)', ''].join(LF)
  // the member door registers the lane when it routes a script to it; here it is
  // registered directly, and taken out again
  beforeEach(() => { registry.registerRuntimeLane(runtimeColumnsFor) })
  afterEach(() => { registry.registerRuntimeLane(null) })

  it('⭐ reached on bar 7: no column, the guard and sentence by name, the bar the run stopped on — and no drawing', () => {
    const def = rtDef(SRC(7))
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    const cols = registry.computeFor(def, bars, undefined, ctx)
    expect(Object.keys(cols)).toEqual([])
    expect(registry.columnErrors(cols).value.guard).toBe(registry.RUNTIME_ERROR_GUARD)
    const stop = registry.runtimeErrorStopOf(cols)
    expect([stop.reached, stop.bar, stop.barKnown]).toEqual([true, 7, true])
    expect(stop.tradingViewText).toBe('Error on bar 7: stop at seven')
    // off the listing the bar number is not TradingView's, and is not said
    const off = registry.runtimeErrorStopOf(registry.computeFor(def, bars.slice(), undefined, { tf: 'D', newestBarIsForming: false }))
    expect([off.reached, off.barKnown, off.tradingViewText]).toEqual([true, false, null])
    // the document's drawings go with it
    expect(objectReaderFor(def, bars, ctx)).toBeNull()
  })

  it('⛔ CONTROL — not reached (a bar past the series): the run completes and the column is the close', () => {
    const def = rtDef(SRC(bars.length + 5))
    const cols = registry.computeFor(def, bars, undefined, { tf: 'D', newestBarIsForming: false })
    expect(Object.keys(cols)).toEqual(['value'])
    expect(cols.value).toEqual(bars.map((b) => b.c))
    expect(registry.runtimeErrorStopOf(cols)).toBeNull()
    expect(objectReaderFor(def, bars, { tf: 'D', newestBarIsForming: false })).not.toBeNull()
  })
})
