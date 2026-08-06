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
// ⭐ IT USED TO BE ONE PARAM AND TWO THINGS. The second was `engineEnabled: true`
// — StockChart read it `=== true`, so a string or a truthy would have been
// silently ignored, and an un-armed engine is what turns the gate vacuous.
//
// **B5 Task 4 deleted the flag**, and this was the ONLY place in shipped source
// that ever wrote it `true`. So the param carries one thing: the instances. The
// vacuity it guards against is unchanged and is now guarded by the instance
// assertion alone — a `?instances=` that carried nothing would leave side B
// drawing from the legacy-toggle projection, i.e. the same picture as side A, and
// the gate would report a beautiful meaningless 0 exactly as before.
// Record: `docs/decisions/2026-08-04-engine-enabled-deleted.md` §2, site 5.
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
    expect(cs.indicatorInstances).toEqual([RSI_INSTANCE])
    // …and it arms nothing ELSE. The route wrote `engineEnabled: true` beside the
    // instances until B5 Task 4; asserting its absence is what stops it coming
    // back as an undeclared key on the one surface that ever set it.
    expect('engineEnabled' in cs).toBe(false)
  })

  it('composes with ?indicators= — BOTH params survive, neither replaces the other', async () => {
    // ⚠️ THE REASON CHANGED AT B5 TASK 12; THE CLAIM DID NOT. This used to read
    // *"Flip A renders the engine into the band `computePaneMargins` reserves from
    // `cs.indicators.rsi.enabled`"* — that function is deleted and the geometry
    // reads the INSTANCE LIST now (`paneLayout.computePaneLayout`), so the legacy
    // section no longer reserves anything. What it still carries is the SETTINGS
    // the capture is framed by, and the v1→v2 fold's input for any indicator the
    // `?instances=` param does not name. A route that dropped the blob when
    // instances were present would take those with it — and side A of every parity
    // case is `?indicators=` alone, so the two params have to compose.
    const settings = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
    const latest = await renderRoute(
      `&indicators=${b64url(settings)}&instances=${b64url([RSI_INSTANCE])}`,
    )
    await waitFor(() => expect(latest()?.indicatorInstances).toBeTruthy())

    const cs = latest()
    expect(cs.indicators.rsi.enabled).toBe(true)
    expect(cs.indicatorInstances).toEqual([RSI_INSTANCE])
    expect('engineEnabled' in cs).toBe(false)
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
      // ⚠️ `indicatorInstances`, not the deleted flag. This case read
      // `cs?.engineEnabled` until B5 Task 4 — and after the deletion that would
      // have been `undefined` on the un-fixed code too, i.e. a check that passes
      // whatever the route does. The instance list is the thing the param arms.
      expect(cs?.indicatorInstances, raw).toBeUndefined()
    }
  })
  // ── ?priceline=0 — a DETERMINISM control, and the only one of its kind ────
  //
  // Over 40 runs of `engine_rsi_toggle_off` the dashed LAST-PRICE LINE rasterised
  // into one of two states, independently on both sides (legacy 5/40, engine 7/40),
  // with every capture proven pixel-stable first. It is drawn by the CANDLE series,
  // no case measures it, and both sides always get the same param — so removing it
  // from the one case that lands on the unstable geometry is the footer-clock
  // treatment, not a tolerance. Pinned because a silent removal would put a
  // ~15%-per-run coin flip back into the branch's only pixel gate.
  it('?priceline=0 hides the last-price line, and its absence changes nothing', async () => {
    await renderRoute('&priceline=0')
    expect(H.props.at(-1).hidePriceLine).toBe(true)
    cleanup(); H.reset()
    await renderRoute('')
    expect(H.props.at(-1).hidePriceLine).toBe(false)
  })
})
