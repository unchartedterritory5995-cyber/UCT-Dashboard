// app/src/components/chart/engine/__tests__/w9T13bReportWire.test.jsx
//
// W9-T13b — THE WIRE, end to end: the real member door builds a strategy, the real binder runs it
// on the runtime lane, publishes the run's `strategy` record (`strategyReportNotice.js`), and the
// real mount under the chart (`AttachedStrategyReports`) renders the report panel from it. The
// record leaves with the instance. Each half green alone is not the claim; this file is.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

vi.mock('../runtime/brokerPins.js', () => ({ pinned: () => true }))
vi.setConfig({ testTimeout: 120000 })

import { createBinder } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor } from '../runtime/runtimeColumns'
import { strategyRecordShapeErrors } from '../runtime/strategyRecord'
import { strategyRecordFor, resetStrategyRecords } from '../strategyReportNotice'
import AttachedStrategyReports from '../../pane/AttachedStrategyReports'
import { runtimeErrorNoticeFor, resetRuntimeErrorNotices } from '../runtimeErrorNotice'

const LF = String.fromCharCode(10)
const DEF_ID = 'u_w9t13b-wire'
const SRC = ['//@version=5', 'strategy("wire")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'plot(strategy.position_size, "pos")', ''].join(LF)
const bars = makeBars()

const flags = (broker) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  if (broker) vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
}
const inst = (extra = {}) => ({ instanceId: 'i1', defId: DEF_ID, inputs: {}, hidden: false, ...extra })
// ⭐ W9-T11-F1: the chart now hands a strategy run its window (`ctx.historyWindowBars`, from the
// server through `strategyWindow.js`; the binder forwards it to strategy documents, railed in
// `w9T11F1ChartWindow.test.jsx`). This file still hands it through a registry SEAM (`windowed`) so
// this wire stays about the record and the panel; a ctx with NO window still refuses
// `runtime:strategy-start` by name (the third case below). Door, binder, store, mount, panel are the product's.
// 5000 (`bars_window.HISTORY_WINDOW_BARS`) covers this chart's bars, which reach the listing: an
// off-listing window refuses this script `runtime:strategy-unsettled` (Q-S1n, B-START), by design.
const WINDOW = 5000
const windowed = { ...registry, computeFor: (def, b, inputs, c) => registry.computeFor(def, b, inputs, { ...(c || {}), historyWindowBars: WINDOW }) }
const ctxFor = (instances, reg = windowed) => ({
  enabled: true, instances, registry: reg, bars, tf: 'D', newestBarIsForming: false,
  historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  adjustTime: (t) => t, plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
})

let fake
let binder
beforeEach(() => {
  resetStrategyRecords()
  registry.registerRuntimeLane(runtimeColumnsFor)
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => {
  cleanup()
  binder.teardown()
  registry.uninstallUserDefinition(DEF_ID)
  registry.registerRuntimeLane(null)
  resetStrategyRecords()
  resetRuntimeErrorNotices()
  vi.unstubAllEnvs()
})

const installStrategy = () => {
  const d = memberPaneDefinition({ source: SRC, id: DEF_ID, name: 'Wire strategy' })
  expect(d.ok, d.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}

describe('W9-T13b the binder publishes a strategy run\'s record, and the mount renders it', () => {
  it('broker gate ON: record published under the instance, the panel renders it, and it leaves with the instance', async () => {
    flags(true)
    installStrategy()
    binder.sync(ctxFor([inst()]))
    const rec = strategyRecordFor('i1')
    expect(rec, 'the binder published no record').not.toBe(null)
    expect(strategyRecordShapeErrors(rec)).toEqual([])

    const settings = { indicatorInstances: [inst()] }
    const { container } = render(<AttachedStrategyReports settings={settings} />)
    // the report half is lazily loaded (engine-40 bytes): wait for it
    await screen.findByTestId('strategy-reports')
    expect(container.querySelector('summary').textContent).toBe('Wire strategy: strategy report')
    // a run from the listing: D2 ALWAYS (r1), the record's sentence is shown verbatim
    expect(rec.window.fromListing).toBe(true)
    expect(rec.window.startSentence).toBe(`this backtest starts on ${rec.window.startDate} (UTC); TradingView may start elsewhere`)
    expect(screen.getByTestId('strategy-report-start-sentence').textContent).toBe(rec.window.startSentence)
    expect(screen.getByTestId('strategy-report-asof').textContent.startsWith(`Starts ${rec.window.startDate} (UTC) · `)).toBe(true)
    // the report is the product default's: the committed ledger is mocked pinned here, so metrics serve
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    // the instance leaves the chart: its record (and so its report) goes with it
    act(() => { binder.sync(ctxFor([])) })
    expect(strategyRecordFor('i1')).toBe(null)
    expect(screen.queryByTestId('strategy-reports')).toBe(null)
  })

  it('r2 (review M8): the binder RELEASE path (teardown -> releaseAll) takes its strategy records with it', () => {
    flags(true)
    installStrategy()
    binder.sync(ctxFor([inst()]))
    expect(strategyRecordFor('i1')).not.toBe(null)
    binder.teardown()
    expect(strategyRecordFor('i1')).toBe(null)
  })

  it('a chart ctx holding no window (gate off, or the server has not answered) refuses by name and publishes no record', () => {
    flags(true)
    const def = installStrategy()
    binder.sync(ctxFor([inst()], registry))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(def.meta.runtimeHistory).toBe('strategy-window')
    // the binder's own published stop names why (the C43 strip), and it is the window refusal
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-start/)
  })

  it('broker gate OFF: the strategy is not drawn bar by bar, no record exists, and the mount is empty', () => {
    flags(false)
    const d = memberPaneDefinition({ source: SRC, id: DEF_ID, name: 'Wire strategy' })
    expect(d.ok).toBe(false)
    const { container } = render(<AttachedStrategyReports settings={{ indicatorInstances: [inst()] }} />)
    expect(container.innerHTML).toBe('')
  })
})
