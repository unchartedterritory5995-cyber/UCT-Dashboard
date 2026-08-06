// app/src/pages/ChartRender.manifest.test.jsx
//
// ─── `window.__paneManifest` — THE GATE'S STRUCTURAL READ ───────────────────
//
// `tools/chart_parity.py::read_manifest` evaluates `window.__paneManifest ??
// null` after `__chartReady` and diffs A against B as JSON. It is the plan's
// discriminator #3: a change that moves pixels but not the manifest, or the
// manifest but not the pixels, is a regression by definition.
//
// Two properties are pinned, and they pull in opposite directions:
//
//   * it is published ONLY under `?fixedbars=`. An always-on global on the
//     export path is a thing the gate has to be told to ignore, and a thing
//     nobody remembers to tell it.
//   * when it IS published it must READ, not have been read: the manifest
//     describes what the renderer built, and this page never learns when that
//     happened. A getter is the whole reason there is no ordering bug here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { registerManifestChart } from '../components/chart/engine/paneLayout'

vi.mock('../components/StockChart', () => ({
  default: () => <canvas data-testid="stock-chart" width={8} height={8} />,
}))

// The binder is stubbed so the pane-height-alert cases below can put a KNOWN map
// behind the hook. What they pin is ChartRender's WIRING — that the getter reads
// `binder.paneHeightAlerts()` and not a literal; the real counter is driven
// against a real LWC chart in `engine/__tests__/flipCGeometry.test.jsx`.
const hoisted = vi.hoisted(() => ({ alerts: {} }))
// ⚠️ A FRESH COPY PER CALL, exactly as the real one does (`Object.fromEntries`).
// Returning the same object would make the getter and a stored value
// indistinguishable and quietly kill the identity control below.
vi.mock('../components/chart/engine/binder', () => ({
  paneHeightAlerts: () => ({ ...hoisted.alerts }),
}))

const { default: ChartRender } = await import('./ChartRender')

const fakePane = (index, height, series = []) => ({
  paneIndex: () => index,
  getHeight: () => height,
  getStretchFactor: () => height,
  getSeries: () => series,
})

async function mount(query) {
  render(
    <MemoryRouter initialEntries={[`/r/chart?sym=PARITY&tf=D${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
  await act(async () => { await Promise.resolve() })
}

let unregister = null

beforeEach(() => {
  cleanup()
  delete window.__paneManifest
  delete window.__paneHeightAlerts
  hoisted.alerts = {}
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hermetic'))))
})

afterEach(() => {
  if (unregister) { unregister(); unregister = null }
  cleanup()
  delete window.__paneManifest
  delete window.__paneHeightAlerts
})

describe('ChartRender publishes the pane manifest', () => {
  it('reads null under ?fixedbars= while no chart has announced itself', async () => {
    await mount('&fixedbars=intraday_bars')
    // ⚠️ NULL IS THE CONTRACTED VALUE, not an error: `read_manifest` records it
    // with a stated reason and skips the A/B diff. Raising here would abort a
    // 20-run measurement halfway.
    expect(window.__paneManifest).toBeNull()
  })

  it('and reports whatever the renderer announced, at READ time', async () => {
    await mount('&fixedbars=intraday_bars')
    expect(window.__paneManifest).toBeNull()
    // The chart is built AFTER the effect ran. A value published once would
    // still be null here; a getter is not.
    const series = { seriesType: () => 'Line', options: () => ({ priceScaleId: 'rsi' }) }
    unregister = registerManifestChart(
      { panes: () => [fakePane(0, 505), fakePane(1, 88, [series])] },
      () => [{ series, key: 'rsi', scaleId: 'rsi' }],
    )
    const m = window.__paneManifest
    expect(m.panes.map(p => [p.index, p.height])).toEqual([[0, 505], [1, 88]])
    expect(m.panes[1].series).toEqual([{ type: 'Line', scaleId: 'rsi', key: 'rsi' }])
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })

  it('is ABSENT without ?fixedbars=, so nothing new lives on the export path', async () => {
    unregister = registerManifestChart({ panes: () => [fakePane(0, 594)] }, () => [])
    await mount('')
    expect('__paneManifest' in window).toBe(false)
    expect(window.__paneManifest ?? null).toBeNull()
  })

  it('and is removed again when the page unmounts', async () => {
    await mount('&fixedbars=intraday_bars')
    expect('__paneManifest' in window).toBe(true)
    cleanup()
    expect('__paneManifest' in window).toBe(false)
  })
})

// ─── `window.__paneHeightAlerts` — THE READER `paneHeightAlerts()` NEVER HAD ──
//
// `binder.paneHeightAlerts()` counts every pane-height disagreement between the
// layout and the renderer that SURVIVED its own re-apply. B5 made that a report
// rather than a throw deliberately (a blank chart is worse than a 1-px drift),
// but its only output was a `console.warn` nobody collects — which left it as
// the last piece of Flip C residue: a real condition with no consumer.
//
// `tools/chart_parity.py::read_pane_height_alerts` is the consumer, and it
// REFUSES a capture carrying a live alert: the panes are then not the geometry
// `computePaneLayout` computed, so the pixels are not comparable to any `expect`
// measured when they were.
//
// ⛔ WHICH MAKES THIS FILE LOAD-BEARING FOR THAT GATE. `read_pane_height_alerts`
// reports an absent hook as `installed: false` and does NOT fail on it — a build
// older than the hook is a version mismatch, not a wrong geometry. So deleting
// the two lines in ChartRender would turn the refusal into a check with no
// subject, silently, on every capture. These cases are what stops that.

describe('ChartRender publishes the pane-height alert map', () => {
  it('reads the BINDER’s map under ?fixedbars=, at READ time', async () => {
    await mount('&fixedbars=intraday_bars')
    expect(window.__paneHeightAlerts).toEqual({})
    // The alert is recorded by a chart that does not exist when this effect
    // runs. A value published once would be frozen at {} forever; a getter is
    // not — and the harness reads it AFTER the capture settled.
    hoisted.alerts = { 'paneLayout: pane 2 is 77px, expected 78px': 2 }
    expect(window.__paneHeightAlerts).toEqual(
      { 'paneLayout: pane 2 is 77px, expected 78px': 2 })
  })

  it('is a GETTER, not a snapshot — proved without touching the map', async () => {
    // THE CONTROL for the case above. `paneHeightAlerts()` returns a fresh object
    // each call, so two reads of a getter are never the same object while two
    // reads of a stored value always are. This fails on `= paneHeightAlerts()`
    // even when the map happens to be empty, which is the state of every green run.
    hoisted.alerts = { a: 1 }
    await mount('&fixedbars=intraday_bars')
    expect(window.__paneHeightAlerts).not.toBe(window.__paneHeightAlerts)
    expect(window.__paneHeightAlerts).toEqual({ a: 1 })
  })

  it('is ABSENT without ?fixedbars=, so nothing new lives on the export path', async () => {
    await mount('')
    expect('__paneHeightAlerts' in window).toBe(false)
  })

  it('and is removed again when the page unmounts', async () => {
    await mount('&fixedbars=intraday_bars')
    expect('__paneHeightAlerts' in window).toBe(true)
    cleanup()
    expect('__paneHeightAlerts' in window).toBe(false)
  })
})
