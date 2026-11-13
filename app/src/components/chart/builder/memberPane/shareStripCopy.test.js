// @vitest-environment node
// app/src/components/chart/builder/memberPane/shareStripCopy.test.js
//
// ─── ⛔⛔ THE AUTHOR'S PINE NEVER TRAVELS WITH A SHARE — what a copy without it draws ──────────
//
// A share preview and an installed copy carry `runtime_definitions.without_run_reads(document)`:
// DIV-4's `compute.runtimeColours` (the whole script, as `.source`) and the paints reading its
// columns are gone. One fixture both suites read, `tests/fixtures/share_strip_div4.json`:
// pytest (`tests/test_share_strips_run_reads.py`) holds `copy` to the server's strip; this file
// holds `document`/`laneOff` to the member door's output and proves the copy draws host colours
// with no stale disclosure.
//
// How the client handles the absence (read, then measured here): `computeFor` runs
// `withRuntimeColours` only when `def.compute.runtimeColours` is present (an `ast` document
// without it returns its host columns untouched), and `runtimeColourStopOf` answers null when it
// is absent, so the chart's runtime strip has nothing to say.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../engine/nativeRegistry'
import { validateDefinition } from '../../engine/defSchema'
import { memberPaneDefinition } from './memberPaneDefinition'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { runtimeErrorNotices } from '../../engine/runtimeErrorNotice'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from '../../engine/runtimeKill'

const FIX = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../../../tests/fixtures/share_strip_div4.json'), 'utf8'))

afterEach(() => {
  vi.unstubAllEnvs()
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})

const door = (runtime) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
  return memberPaneDefinition({ source: FIX.source, id: 'u_00000000d4a1', name: 'div4' })
}

// deterministic bars with turns both ways (the DIV-4 rail's)
const BARS = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 5) + (i % 7) * 0.3
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const CTX = { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false }
const plain = (cols) => Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, Array.from(v)]))

/** The binder's view on a fake chart: the bar colours it set and what the runtime strip said. */
function drawn(def, scope, listing) {
  const installed = registry.installUserDefinitions([def])
  expect(installed.errors).toEqual([])
  const barColours = []
  try {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries || 'CandlestickSeries', {}, 0)
    binder.sync({
      priceSeries: () => candles, setBarColours: (c) => barColours.push(c), enabled: true, cs, instances, registry,
      bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false, historyFromListing: listing,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    })
    const said = runtimeErrorNotices(scope).map(([, s]) => s)
    binder.teardown()
    return { barColours: JSON.parse(JSON.stringify(barColours)), said }
  } finally {
    registry.uninstallUserDefinition(def.id)
  }
}

describe('⛔ the cross-suite fixture is what the member door writes', () => {
  it('`document` is the DIV-4 door document and `laneOff` the runtime-lane-off one', () => {
    expect(JSON.parse(JSON.stringify(door(true).definition))).toEqual(FIX.document)
    expect(JSON.parse(JSON.stringify(door(false).definition))).toEqual(FIX.laneOff)
    expect(FIX.document.compute.runtimeColours.source).toBe(FIX.source) // CONTROL: it carried the script
  })
})

describe('⭐⭐ a shared copy without `runtimeColours` draws host colours and says nothing stale', () => {
  it('carries no script, validates, installs', () => {
    expect(JSON.stringify(FIX.copy)).not.toContain('runtimeColours')
    expect(JSON.stringify(FIX.copy)).not.toContain(JSON.stringify(FIX.source).slice(1, -1))
    expect(validateDefinition(FIX.copy).errors).toBeUndefined()
  })

  it('computes exactly the lane-off document\'s columns: no run colour column, no column error', () => {
    const copy = registry.computeFor(FIX.copy, BARS, undefined, CTX)
    const off = registry.computeFor(FIX.laneOff, BARS, undefined, CTX)
    expect(copy.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(copy).rtcolour1).toBeUndefined()
    expect(plain(copy)).toEqual(plain(off))
    expect(registry.runtimeColourStopOf(FIX.copy, copy)).toBeNull()
    // CONTROL: the unstripped document on the same bars takes the run-read path (its column is
    // served, or refused by name; which one depends on whether this worker loaded the run)
    const doc = registry.computeFor(FIX.document, BARS, undefined, CTX)
    expect(doc.rtcolour1 instanceof Float64Array || registry.columnErrors(doc).rtcolour1?.guard)
      .toBeTruthy()
  })

  it('on a chart: the candles keep their own colours, as with the lane off, and the strip is silent', () => {
    for (const listing of [true, false]) {
      const copy = drawn({ ...FIX.copy, id: 'u_00000000c0e1' }, `copy${listing}`, listing)
      const off = drawn({ ...FIX.laneOff, id: 'u_00000000c0e1' }, `off${listing}`, listing)
      expect(copy).toEqual(off)
      expect(copy.said).toEqual([])
    }
    // CONTROL: the author's document off the listing does say why its run colour is missing
    expect(drawn({ ...FIX.document }, 'docoff', false).said.join(' ')).toMatch(/The colours from `barcolor` \(line 13\)/)
  })

  it('its disclosure says the bar colour is not drawn, never that the run draws it', () => {
    const notes = FIX.copy.meta.disclosures.map((n) => n.note)
    expect(notes.some((n) => /takes its colour from running the script/.test(n))).toBe(false)
    expect(notes).toContain("`barcolor` (line 13) is not drawn: its colour is worked out by running the author's "
      + 'script bar by bar, and a shared copy does not carry the script.')
  })
})
