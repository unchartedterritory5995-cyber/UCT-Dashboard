import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ─── `?instances=` — the parity route's engine switch (Task 8) ───────────────
//
// THE VACUITY THIS EXISTS TO KILL. The dark rehearsal renders legacy RSI on side
// A and engine RSI on side B and expects 0 changed pixels. If `?instances=`
// silently failed to arm the engine, side B would draw the LEGACY RSI — and the
// gate would report a beautiful, meaningless 0. "The two pictures match because
// they are the same picture" is the most expensive way to pass a parity gate.
//
// So: one param, two things, both asserted. It must set `engineEnabled: true`
// (StockChart reads it `=== true`, so a string or a truthy would be silently
// ignored) AND it must carry the instances through.
//
// StockChart is stubbed to a prop recorder deliberately: this is a test of what
// the ROUTE resolves, and mounting the real chart would answer a different
// question much more slowly.

const H = vi.hoisted(() => ({ props: [], reset() { H.props.length = 0 } }))

vi.mock('../components/StockChart', () => ({
  default: (props) => { H.props.push(props); return <div data-testid="stock-chart" /> },
}))

const { default: ChartRender } = await import('./ChartRender')

const b64url = (obj) => btoa(JSON.stringify(obj))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const RSI_INSTANCE = {
  instanceId: 'legacy:rsi',
  defId: 'rsi',
  defVersion: 1,
  inputs: { period: 14, color: '#7b68ee' },
  placement: { target: 'pane' },
  hidden: false,
}

async function renderRoute(query) {
  render(
    <MemoryRouter initialEntries={[`/r/chart?sym=PARITY&tf=D${query}`]}>
      <ChartRender />
    </MemoryRouter>,
  )
  await waitFor(() => expect(H.props.length).toBeGreaterThan(0))
  return () => H.props.at(-1).settingsOverride
}

beforeEach(() => {
  cleanup()
  H.reset()
  // Fails closed to "no owner settings", which is what a logged-out capture gets.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
})

describe('ChartRender ?instances=', () => {
  it('arms the engine with the instances it was given', async () => {
    const latest = await renderRoute(`&instances=${b64url([RSI_INSTANCE])}`)
    await waitFor(() => expect(latest()?.indicatorInstances).toBeTruthy())

    const cs = latest()
    // `=== true`, not truthy: StockChart's flag read is strict, so anything else
    // here would leave the engine dark and make the parity result meaningless.
    expect(cs.engineEnabled).toBe(true)
    expect(cs.indicatorInstances).toEqual([RSI_INSTANCE])
  })

  it('composes with ?indicators= — the legacy toggle stays ON, which is what reserves the band', async () => {
    // Flip A renders the engine into the band `computePaneMargins` reserves from
    // `cs.indicators.rsi.enabled`. If this route dropped the settings blob when
    // instances were present, the engine would land in the fallback band and the
    // whole chart would re-lay-out.
    const settings = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
    const latest = await renderRoute(
      `&indicators=${b64url(settings)}&instances=${b64url([RSI_INSTANCE])}`,
    )
    await waitFor(() => expect(latest()?.indicatorInstances).toBeTruthy())

    const cs = latest()
    expect(cs.indicators.rsi.enabled).toBe(true)
    expect(cs.engineEnabled).toBe(true)
    expect(cs.indicatorInstances).toEqual([RSI_INSTANCE])
  })

  it('leaves the engine DARK without the param — side A of every case', async () => {
    const settings = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
    const latest = await renderRoute(`&indicators=${b64url(settings)}`)
    await waitFor(() => expect(latest()?.indicators).toBeTruthy())

    const cs = latest()
    expect(cs.engineEnabled).toBeUndefined()
    expect(cs.indicatorInstances).toBeUndefined()
  })

  it('a malformed, empty or non-array param arms nothing', async () => {
    for (const raw of ['not-base64!!', b64url({}), b64url([]), b64url('rsi')]) {
      cleanup(); H.reset()
      const latest = await renderRoute(`&instances=${raw}`)
      const cs = latest()
      expect(cs?.engineEnabled, raw).toBeUndefined()
    }
  })
})
