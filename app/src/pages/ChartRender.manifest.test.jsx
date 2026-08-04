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
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hermetic'))))
})

afterEach(() => {
  if (unregister) { unregister(); unregister = null }
  cleanup()
  delete window.__paneManifest
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
