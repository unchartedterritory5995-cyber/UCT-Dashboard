import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'

// ─── `?userdefs=` carrying a RUNTIME-LANE document ──────────────────────────
//
// The runtime lane is a lazy chunk (`engine/pineRuntimeLaneGate.js`). The
// headless renderer calls a frame ready once StockChart reports its bars, so a
// `compute.kind: 'pine'` document mounted before the chunk exists would be drawn
// as a "still loading" column error inside a frame the renderer accepts. The
// route therefore holds StockChart until the lane has SETTLED.
//
// ⛔ Nothing in this file imports the lane, so it really is absent at the start —
// the first case asserts that, or the hold would be tested against a lane that
// was already there. StockChart is a prop recorder, as in the sibling tests.

const H = vi.hoisted(() => ({ mounts: 0 }))
vi.mock('../components/StockChart', () => ({
  default: () => { H.mounts += 1; return <div data-testid="stock-chart" /> },
  SESSION_EXT_COLOR: '#f0a000',
}))

const { default: ChartRender } = await import('./ChartRender')
const { loadedPineRuntimeLane } = await import('../components/chart/engine/pineRuntimeLaneGate')

const REPO = path.resolve(process.cwd(), '..')
const DOC = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/pine_store/adx_round_trip.json'), 'utf8')).request.definition
const b64url = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function renderRoute() {
  render(
    <MemoryRouter initialEntries={[`/r/chart?sym=SPY&tf=D&userdefs=${b64url([DOC])}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  H.mounts = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ⛔ ORDER IS THE POINT: the flag-off case runs while the lane is still absent,
// and the flag-on case is the one that loads it.
describe('ChartRender ?userdefs= with a runtime-lane document', () => {
  it('⭐ NON-VACUITY — the lane is absent and the document is a runtime document', () => {
    expect(loadedPineRuntimeLane()).toBe(null)
    expect(DOC.compute.kind).toBe('pine')
  })

  it('flag OFF: nothing is held — the chart mounts on the first render (the install door refuses the doc by name)', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '')
    renderRoute()
    expect(screen.queryByTestId('stock-chart')).not.toBe(null)
    expect(loadedPineRuntimeLane()).toBe(null)
  })

  it('flag ON: the chart is NOT mounted until the lane has loaded, then it is', async () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    renderRoute()
    expect(screen.queryByTestId('stock-chart')).toBe(null)
    expect(H.mounts).toBe(0)
    await waitFor(() => expect(screen.queryByTestId('stock-chart')).not.toBe(null))
    expect(loadedPineRuntimeLane()).not.toBe(null)
  })
})
