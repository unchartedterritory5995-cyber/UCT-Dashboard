// Joystick hub — Phase 2 wiring evidence: Layout's orb/FAB gate, HubRoot's
// navigate/run/confirm/home firing, and the VirtualResults/ResultCards
// scrollToIndex seam (spec exception (d)).
// See docs/plans/joystick/00-master-spec-v1.4.md §2c (the corner), §6 (Phase 3
// scope — "NOTHING IN PHASE 2 WRITES"), §2d (the virtualized-cursor seam).
//
// ⚠️ `HubPad.jsx`, `HubKnob.jsx`, `HubFan.jsx`, `HubChip.jsx`, `HubScrim.jsx`
// and `HubActionsButton.jsx` are being written by other agents in this same
// worktree. This file mocks all six to trivial stand-ins so the tests below
// exercise the REAL `HubRoot.jsx` (incl. its exported `useHubActive`),
// `HubContext.jsx`, `registry.js`, `fanGeometry.js`, `useJoystick.js` and
// `hubViewport.js` — the actual wiring under test — without depending on
// those six files existing or matching a guessed internal shape. `HubPad` is
// the one mock worth real behaviour: it forwards `ref` and the four pointer
// handlers, because that IS the seam `useJoystick` drives.
//
// ⛔ ONE set of leaf mocks, used by BOTH the Layout tests and the HubRoot
// tests below — `vi.mock` is hoisted to file scope regardless of which
// `describe` block it is textually inside, so mocking `HubRoot` itself here
// (to fake "is the hub active") would silently replace the REAL HubRoot the
// second half of this file needs to actually exercise. Layout's gate is
// therefore tested through the SAME real `useHubActive()` computation
// HubRoot uses (via the capability stubs below), never a second, hand-faked
// "is it active" signal.
//
// ⛔ RAIL (house convention — mirrors useJoystick.test.js / useHubCursor.test.js):
// `vitest -t <regex>` is a regex filter, and a filter matching nothing exits 0
// and reads as a PASS. `definedCount`/`executedCount` catch a `-t` typo or a
// stray `.only`/`.skip` that would otherwise report fewer green tests as a full
// pass.
import { describe, it as vitestIt, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { forwardRef, createRef } from 'react'
import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'
import VirtualResults from '../pages/screener/shell/VirtualResults'
import ResultCards from '../pages/screener/shell/ResultCards'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── Shared leaf-component mocks (both describe blocks below) ────────────────
let mockPrefs = {}
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPrefMerged: vi.fn(), loading: false }),
  // ⚠️ A mock of this module MUST declare `parsePref` — Vitest's mocked
  // module namespace is a Proxy that THROWS on any export the mock omits,
  // and useHubSettings.js imports it directly (see its own header comment).
  parsePref: (raw) => {
    if (raw == null) return undefined
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return undefined }
  },
}))

vi.mock('./HubPad', () => ({
  default: forwardRef(function MockHubPad(
    { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }, ref,
  ) {
    return (
      <div
        data-testid="mock-hub-pad"
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    )
  }),
}))
vi.mock('./HubKnob', () => ({ default: () => null }))
vi.mock('./HubFan', () => ({ default: () => null }))
vi.mock('./HubChip', () => ({ default: () => null }))
vi.mock('./HubScrim', () => ({ default: () => null }))
vi.mock('./HubActionsButton', () => ({ default: () => null }))

vi.mock('../components/FeedbackWidget', () => ({ default: () => <div data-testid="mock-feedback-widget" /> }))

/** Every capability HubRoot's own `useHubActive()` checks, forced ON. Mirrors
 *  `HubRoot.test.jsx`'s own `stubCapable()` — same query, same shape — so this
 *  file's "hub is active" state means exactly what HubRoot's real gate means,
 *  never a second, hand-typed approximation of it. */
function stubHubCapable() {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = {
    width: 375, height: 812,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    // True only for the hub's own width+coarse mount query. hubViewport's
    // chart-portrait (max-width:640px) and landscape-immersive queries both
    // read false here, which is what keeps the hub fully visible (not
    // hidden) rather than hidden by an unrelated device gate.
    matches: /max-width:\s*1023px/.test(q),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

function unstubHubCapable() {
  delete globalThis.CSS
  delete window.visualViewport
  vi.unstubAllGlobals()
}

// ============================================================================
// Part 1 — Layout: the orb/feedback-FAB mount gate (spec §2 exception (a))
// ============================================================================
describe('Layout — orb/feedback-FAB mount gate (spec exception a)', () => {
  afterEach(unstubHubCapable)

  it('hub disabled (default jsdom: no CSS.supports/visualViewport): FeedbackWidget renders, the hub does not', async () => {
    mockPrefs = {}
    const { default: Layout } = await import('../components/Layout')
    const { renderWithProviders } = await import('../test-utils')
    renderWithProviders(<Layout><div>child</div></Layout>)
    expect(screen.getByTestId('mock-feedback-widget')).toBeInTheDocument()
    expect(screen.queryByTestId('hub-root')).not.toBeInTheDocument()
  })

  it('hub enabled on a touch viewport: FeedbackWidget does NOT render, the hub does', async () => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
    const { default: Layout } = await import('../components/Layout')
    const { renderWithProviders } = await import('../test-utils')
    renderWithProviders(<Layout><div>child</div></Layout>)
    expect(screen.queryByTestId('mock-feedback-widget')).not.toBeInTheDocument()
    expect(screen.getByTestId('hub-root')).toBeInTheDocument()
  })

  // Mechanical record of a real architecture finding made while wiring this:
  // FloatingOrb does NOT mount from Layout.jsx — it mounts from
  // `GlobalVoiceLayer`, a SIBLING of the routed <Layout/> tree in App.jsx
  // (`<GlobalVoiceGate/>`), so Layout cannot gate its mount condition without
  // editing App.jsx or FloatingOrb.jsx — both outside this session's file
  // scope. Asserted directly off Layout.jsx's own source (not left as a
  // comment) so the next reader gets a failing test, not stale prose, if
  // that ever changes.
  it('FloatingOrb is not reachable from Layout.jsx — the touch gate covers FeedbackWidget only', () => {
    const src = nodeFs.readFileSync(
      nodePath.resolve(process.cwd(), 'src/components/Layout.jsx'),
      'utf8',
    )
    // Not merely "the string never appears" — Layout.jsx's own comment names
    // FloatingOrb to explain exactly this gap. What must never appear is an
    // import or a render of it.
    expect(src).not.toMatch(/^\s*import\s+FloatingOrb/m)
    expect(src).not.toMatch(/<FloatingOrb[\s/>]/)
    expect(src).toMatch(/useHubActive/)
    expect(src).toMatch(/!hubActive\s*&&\s*<FeedbackWidget/)
  })
})

// ============================================================================
// Part 2 — HubRoot: navigate / run+confirm-toast+no-write / home
// ============================================================================
function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

async function renderHub(route) {
  const { default: HubRoot } = await import('./HubRoot')
  const { HubProvider } = await import('./HubContext')
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HubProvider>
        <HubRoot />
        <LocationProbe />
      </HubProvider>
    </MemoryRouter>,
  )
}

/** A point at `dist` px from the pad centre, at `angleDeg` standard math
 *  degrees (0=right, 90=up) — the exact inverse of `fanGeometry.pointerAngle`,
 *  matching `useJoystick.test.js`'s own fixture idiom rather than a second,
 *  hand-typed table of coordinates. */
function vecAtAngle(dist, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: Math.cos(rad) * dist, dy: -Math.sin(rad) * dist }
}

describe('HubRoot — navigate / run+confirm / home (Phase 2 wiring)', () => {
  let realFetch

  beforeEach(() => {
    mockPrefs = { joystick_hub: JSON.stringify({ enabled: true }) }
    stubHubCapable()
    realFetch = global.fetch
    global.fetch = vi.fn()
    // Fake timers are engaged per-test, AFTER the component tree has
    // mounted with real timers (see the two Home tests below) — mounting a
    // full component tree while `vi.useFakeTimers()` is already active
    // starves whatever React 18's scheduler needs and the render never
    // commits. The flick tests (navigate/run/confirm) need no fake timers:
    // a synchronous down->move->up is a few milliseconds, far under
    // FLICK_MS's 120ms window, on real timers.
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = realFetch
    unstubHubCapable()
  })

  it('a navigate action moves the router (wire mode, "Chart it" -> /charts)', async () => {
    const { wedgeAngles } = await import('./fanGeometry')
    const { modesById } = await import('./registry')

    await renderHub('/morning-wire')
    expect(screen.getByTestId('loc').textContent).toBe('/morning-wire')

    const outer = modesById.wire.fan.filter((a) => a.ring === 0)
    const angles = wedgeAngles(outer.length)
    const idx = outer.findIndex((a) => a.id === 'wire.chartIt')
    expect(outer[idx].kind).toBe('navigate')
    const { dx, dy } = vecAtAngle(30, angles[idx])

    const pad = screen.getByTestId('mock-hub-pad')
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent).toBe('/charts')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ⚰️ TWO TESTS USED TO LIVE HERE asserting that a `run` action ("Flag") and a `confirm`
  // action ("Alert") each fired the exact string "Phase 3" as a toast. Phase 2.5 DELETED that
  // toast on purpose: an unwired action is now ABSENT from the fan, not present-and-inert,
  // because a control that answers a deliberate gesture with "not yet" teaches the member the
  // product is unfinished.
  //
  // ⭐ The replacement asserts something STRONGER than the toast ever did. The old tests proved
  // the action could be reached and said nothing useful; these prove it CANNOT be reached, on
  // every mode at once, which is the actual product claim being shipped.

  it('EVERY mode is accounted for in PREVIEW_MODES — a missing one ships its full fan', async () => {
    const { modes, PREVIEW_MODES } = await import('./registry')

    // ⛔ THIS CAUGHT A REAL OMISSION. `calendar` was left out of the first hand-typed set,
    // and `fanFor` therefore returned its FULL five-action fan into a preview sold as
    // navigation-only. A mode absent from the set does not fail loudly — it silently behaves
    // as though Phase 3 had already shipped it.
    const missing = modes.map((m) => m.id).filter((id) => !PREVIEW_MODES.has(id))
    expect(
      missing,
      `these modes are not in PREVIEW_MODES and will show their FULL fan: ${missing.join(', ')}. `
      + 'Remove a mode from the set only when its Phase 3 section actually ships.',
    ).toEqual([])

    // Non-vacuity: the set must not contain ids that are not modes either.
    const stray = [...PREVIEW_MODES].filter((id) => !modes.some((m) => m.id === id))
    expect(stray, `PREVIEW_MODES names unknown modes: ${stray.join(', ')}`).toEqual([])
  })

  it('the preview fan contains NO run action except Voice, and no confirm action at all', async () => {
    const { modes, fanFor, validatePreview } = await import('./registry')

    const offenders = []
    for (const mode of modes) {
      for (const action of fanFor(mode)) {
        if (action.kind === 'confirm') offenders.push(`${mode.id}/${action.id} confirm`)
        if (action.kind === 'run' && !action.id.endsWith('.voice')) {
          offenders.push(`${mode.id}/${action.id} run`)
        }
      }
    }
    expect(offenders, 'the preview is navigation-only plus Voice').toEqual([])
    expect(validatePreview()).toEqual([])
  })

  it('the actions the toast used to cover are genuinely GONE from their fans', async () => {
    const { modesById, fanFor } = await import('./registry')

    // Both are still DEFINED in the registry — Phase 3 needs them — and neither is shown.
    expect(modesById.wire.fan.some((a) => a.id === 'wire.flag')).toBe(true)
    expect(modesById.scan.fan.some((a) => a.id === 'scan.alert')).toBe(true)

    expect(fanFor(modesById.wire).some((a) => a.id === 'wire.flag')).toBe(false)
    expect(fanFor(modesById.scan).some((a) => a.id === 'scan.alert')).toBe(false)
  })

  it('every non-Home preview fan is exactly [Voice, Home]', async () => {
    const { modes, fanFor, HOME_MODE_ID } = await import('./registry')
    for (const mode of modes) {
      if (mode.id === HOME_MODE_ID) continue
      const ids = fanFor(mode).map((a) => a.id)
      expect(ids.length, `${mode.id} preview fan: ${ids.join(', ')}`).toBeLessThanOrEqual(2)
      for (const id of ids) {
        expect(id.endsWith('.voice') || id.endsWith('.home'),
          `${mode.id} shows ${id} in the preview`).toBe(true)
      }
    }
  })

  it('a hold (no drag) navigates Home to /dashboard', async () => {
    const { HOLD_MS } = await import('./constants')

    await renderHub('/morning-wire')
    const pad = screen.getByTestId('mock-hub-pad')

    // Engaged only now, AFTER the tree has mounted on real timers.
    vi.useFakeTimers()
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(HOLD_MS + 50) })
    fireEvent.pointerUp(pad, { clientX: 0, clientY: 0, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')
  })

  it('an inner-ring kind:"home" fan action also navigates to /dashboard (non-flick push+release)', async () => {
    const { wedgeAngles } = await import('./fanGeometry')
    const { modesById } = await import('./registry')
    const { FLICK_MS } = await import('./constants')

    await renderHub('/morning-wire')

    const inner = modesById.wire.fan.filter((a) => a.ring === 1)
    const angles = wedgeAngles(inner.length)
    const idx = inner.findIndex((a) => a.id === 'wire.home')
    expect(inner[idx].kind).toBe('home')
    // ⛔ AIM WHERE THE INNER BUBBLE IS DRAWN (FAN_RADIUS_INNER = 96), not at a knob-travel
    // distance. This read `15` — "strictly between OPEN_AT_PX and the ring split" — which
    // described the pre-F-2 model where the ring came from knob travel alone. Under reach
    // mode a pointer past REACH_PX picks the nearer DRAWN radius, so 96 is what "the user
    // dragged to the inner ring" now means, and 15 would resolve OUTER.
    const { FAN_RADIUS_INNER } = await import('./constants')
    const { dx, dy } = vecAtAngle(FAN_RADIUS_INNER, angles[idx])

    const pad = screen.getByTestId('mock-hub-pad')
    // Engaged only now, AFTER the tree has mounted on real timers.
    vi.useFakeTimers()
    fireEvent.pointerDown(pad, { clientX: 0, clientY: 0, pointerId: 1 })
    // Past FLICK_MS so release resolves via the ordinary push path
    // (releaseOntoFan), never the forced-outer-ring flick path.
    act(() => { vi.advanceTimersByTime(FLICK_MS + 20) })
    fireEvent.pointerMove(pad, { clientX: dx, clientY: dy, pointerId: 1 })
    fireEvent.pointerUp(pad, { clientX: dx, clientY: dy, pointerId: 1 })

    expect(screen.getByTestId('loc').textContent).toBe('/dashboard')
  })
})

// ============================================================================
// Part 3 — VirtualResults / ResultCards: scrollToIndex through a ref (exception d)
// ============================================================================
vi.mock('../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))

const VIRTUAL_OPTS = {
  // jsdom has no layout engine — offsetWidth/offsetHeight are always 0, and
  // react-virtual's default observeElementRect measures the real (zero) DOM
  // rect synchronously on mount, overwriting `initialRect` before render()
  // even returns. Stub observeElementRect too so the fixed 1200x800 sticks
  // (same shim VirtualResults.test.jsx / ResultCards.test.jsx already use).
  initialRect: { width: 1200, height: 800 },
  observeElementRect: (_instance, cb) => { cb({ width: 1200, height: 800 }); return () => {} },
}
const virtualRows = Array.from({ length: 50 }, (_, i) => ({
  ticker: `T${i}`, company: `Co ${i}`, price: 10 + i, chg_pct_1d: 0,
}))

describe('screener virtualized results — scrollToIndex exposed through a ref (spec exception d)', () => {
  it('VirtualResults exposes a callable scrollToIndex via forwardRef/useImperativeHandle', () => {
    const ref = createRef()
    render(
      <VirtualResults
        ref={ref}
        rows={virtualRows}
        columns={['ticker', 'company', 'price', 'chg_pct_1d']}
        sort={{ key: 'price', dir: 'desc' }}
        onSort={vi.fn()}
        livePrices={{}}
        liveSortOn={false}
        density="compact"
        hasMore={false}
        onLoadMore={vi.fn()}
        isLoading={false}
        virtualOpts={VIRTUAL_OPTS}
      />,
    )

    expect(ref.current).toBeTruthy()
    expect(typeof ref.current.scrollToIndex).toBe('function')
    expect(() => ref.current.scrollToIndex(10)).not.toThrow()
  })

  it('ResultCards exposes a callable scrollToIndex via forwardRef/useImperativeHandle', () => {
    const ref = createRef()
    render(
      <ResultCards
        ref={ref}
        rows={virtualRows}
        columns={['ticker', 'company', 'price', 'chg_pct_1d']}
        livePrices={{}}
        hasMore={false}
        onLoadMore={vi.fn()}
        isLoading={false}
        virtualOpts={VIRTUAL_OPTS}
      />,
    )

    expect(ref.current).toBeTruthy()
    expect(typeof ref.current.scrollToIndex).toBe('function')
    expect(() => ref.current.scrollToIndex(10)).not.toThrow()
  })
})
